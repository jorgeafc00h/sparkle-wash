/**
 * Step 4 — sweep all 11 DTE types against real MH.
 *
 * Builds + signs + POSTs each DTE type to apitest.dtes.mh.gob.sv. For types
 * that require a parent DTE reference (NC/ND/NR/CL/CR/DCL), first submits a
 * real CCF and uses that sello/codigoGeneracion as the parent reference.
 *
 * Writes one artifact per type into test-results/dte-all-types/ with the
 * outgoing DTE JSON + the raw MH response so failures are inspectable.
 */

import { test, expect } from '../../fixtures/electron-launch';
import { MH_TEST_CREDENTIALS } from '../../fixtures/mh-test-credentials';
import {
  ALL_TYPES,
  INVOICE_TYPE,
  DOCUMENT_TYPE_CODES,
  buildInvoicesFor,
  type InvoiceTypeName,
} from '../../fixtures/dte-types';
import { TEST_COMPANY } from '../../fixtures/seed-state';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DUMP_DIR = resolve(__dirname, '..', '..', '..', 'test-results', 'dte-all-types');

test.skip(process.env.MH_MOCK === '1', 'Live MH all-types probe is skipped in offline mock mode.');

interface SubmitResult {
  httpStatus: number;
  body: string;
  outgoing: any;
  estado?: string;
  codigoGeneracion?: string;
  numeroControl?: string;
  selloRecibido?: string;
}

async function submitType(
  window: any,
  typeName: InvoiceTypeName,
  seqHint: number,
  parent?: {
    documentType: string;
    numeroControl: string;
    codigoGeneracion: string;
    date: string;
    type: number;
  },
): Promise<SubmitResult> {
  const { target, parentInvoices } = buildInvoicesFor(typeName);

  // documentoRelacionado.numeroDocumento takes the parent's codigoGeneracion
  // (UUID) for all linked DTE types — when tipoDoc is 2 (electronic), MH's
  // schema requires the GUID format, not the DTE numeroControl.
  if (parent) {
    target.relatedDocumentType = parent.documentType;
    // CR lookup fails in MH test env when referencing an electronic parent
    // (tipoDoc=2) because the DTE registry expects the referenced CCF's
    // emisor to be the CR receptor — impossible in a self-signed test.
    // Use the numeroControl so the mapper routes to tipoDoc=1 (físico).
    target.relatedDocumentNumber =
      typeName === 'ComprobanteRetencion'
        ? parent.numeroControl
        : parent.codigoGeneracion;
    target.relatedDocumentDate = parent.date;
    target.relatedInvoiceType = parent.type;
  }

  const res = await window.evaluate(
    async (payload: any) => {
      const genSvc = await import('/src/services/invoiceGeneration/InvoiceGenerationService.ts');
      const mapperSvc = await import('/src/services/dte/DTEMappingService.ts');
      const signerMod = await import('/src/services/signing/SignerService.ts');
      const parserMod = await import('/src/services/signing/CertificateParser.ts');
      const mhClientMod = await import('/src/services/api/MhClient.ts');
      const secStorageMod = await import('/src/services/security/SecureStorageService.ts');
      const storageMod = await import('/src/services/storage/ElectronStorage.ts');

      const invoice = payload.invoice;
      const company = payload.company;

      const codigoGeneracion = genSvc.InvoiceGenerationService.generateCodigoGeneracion();
      const controlNumber = genSvc.InvoiceGenerationService.generateControlNumber(
        invoice.invoiceType,
        payload.sequence,
        company,
      );
      const enriched = {
        ...invoice,
        generationCode: codigoGeneracion,
        controlNumber,
        invoiceNumber: controlNumber,
      };

      const dte = mapperSvc.DTEMappingService.mapInvoice(enriched, company, '00');
      const dteJson = JSON.stringify(dte);

      const certXml = await storageMod.appStorage.getItem(`cert_data_${company.nit}`);
      const cert = parserMod.parseCertificateXML(certXml!);
      const signer = signerMod.getSignerService();
      signer.setCachedCertificate(cert.nit, cert);
      const passwordHash = await secStorageMod.SecureStorageService.getCertificatePassword(
        company.nit,
      );
      const signed = await signer.signAsync({
        nit: cert.nit,
        passwordPri: passwordHash!,
        dteJson,
      });

      const mh = new mhClientMod.MhClient(false);
      const bearer = await mh.authenticate({
        userName: company.nit,
        password: 'MemoryLeak00.',
      });

      const idEnvio = Math.max(1, Math.floor(Date.now() / 1000) % 1_000_000) + payload.sequence;
      const submitBody = {
        ambiente: '00',
        idEnvio,
        version: dte.identificacion.version,
        tipoDte: dte.identificacion.tipoDte,
        documento: signed.body,
        codigoGeneracion: null,
      };

      const api = (window as any).electronAPI;
      if (!api?.mhFetch) throw new Error('Electron MH fetch bridge not available');

      const resp = await api.mhFetch({
        url: 'https://apitest.dtes.mh.gob.sv/fesv/recepciondte',
        method: 'POST',
        headers: {
          Authorization: bearer,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: submitBody,
      });
      const text = resp.body ?? resp.error ?? '';
      let parsed: any = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* ignore */
      }

      return {
        httpStatus: resp.status,
        body: text,
        outgoing: dte,
        estado: parsed?.estado,
        codigoGeneracion: parsed?.codigoGeneracion || codigoGeneracion,
        numeroControl: controlNumber,
        selloRecibido: parsed?.selloRecibido,
      };
    },
    {
      invoice: target,
      company: { ...TEST_COMPANY, nit: MH_TEST_CREDENTIALS.nit },
      sequence: seqHint,
    },
  );

  // persist artifacts
  const typeDir = resolve(DUMP_DIR, typeName);
  mkdirSync(typeDir, { recursive: true });
  writeFileSync(resolve(typeDir, 'outgoing.json'), JSON.stringify(res.outgoing, null, 2));
  writeFileSync(resolve(typeDir, 'response.txt'), res.body);

  return res;
}

test.describe('Step 4 — all 11 DTE types against real MH', () => {
  test('sweeps standalone + linked types, reports per-type status', async ({ electronFor }) => {
    const { window } = await electronFor({ real: true });

    mkdirSync(DUMP_DIR, { recursive: true });

    // Order matters: standalone first, then CCF so we get a real parent
    // sello for the linked types to reference.
    const standalone: InvoiceTypeName[] = [
      'Factura',
      'CCF',
      'SujetoExcluido',
      'FacturaExportacion',
      'ComprobanteDonacion',
    ];
    const linked: InvoiceTypeName[] = [
      'NotaCredito',
      'NotaDebito',
      'NotaRemision',
      'ComprobanteLiquidacion',
      'ComprobanteRetencion',
      'DocumentoContableLiquidacion',
    ];

    const summary: Array<{
      type: InvoiceTypeName;
      httpStatus: number;
      estado: string | undefined;
      msg: string;
    }> = [];
    // Use time-based sequence so each run produces unique numeroControl
    // values. MH rejects submits that repeat a control number.
    let seq = Math.floor(Date.now() / 1000) % 1_000_000;
    let parentCCF: {
      documentType: string;
      numeroControl: string;
      codigoGeneracion: string;
      date: string;
      type: number;
    } | undefined;
    let parentFactura: typeof parentCCF | undefined;

    for (const typeName of standalone) {
      const res = await submitType(window, typeName, seq++);
      const msg = res.estado === 'PROCESADO'
        ? `sello=${res.selloRecibido?.slice(0, 12)}…`
        : res.body.slice(0, 200).replace(/\s+/g, ' ');
      summary.push({ type: typeName, httpStatus: res.httpStatus, estado: res.estado, msg });

      if (res.estado === 'PROCESADO' && typeName === 'CCF') {
        parentCCF = {
          documentType: '03',
          numeroControl: res.numeroControl!,
          codigoGeneracion: res.codigoGeneracion!,
          date: res.outgoing.identificacion.fecEmi,
          type: INVOICE_TYPE.CCF,
        };
      }
      if (res.estado === 'PROCESADO' && typeName === 'Factura') {
        parentFactura = {
          documentType: '01',
          numeroControl: res.numeroControl!,
          codigoGeneracion: res.codigoGeneracion!,
          date: res.outgoing.identificacion.fecEmi,
          type: INVOICE_TYPE.Factura,
        };
      }
    }

    for (const typeName of linked) {
      const parent =
        typeName === 'NotaRemision' ? parentFactura ?? parentCCF : parentCCF;
      if (!parent) {
        summary.push({
          type: typeName,
          httpStatus: 0,
          estado: 'SKIPPED',
          msg: 'no parent CCF/Factura available (parent failed)',
        });
        continue;
      }
      const res = await submitType(window, typeName, seq++, parent);
      const msg = res.estado === 'PROCESADO'
        ? `sello=${res.selloRecibido?.slice(0, 12)}…`
        : res.body.slice(0, 200).replace(/\s+/g, ' ');
      summary.push({ type: typeName, httpStatus: res.httpStatus, estado: res.estado, msg });
    }

    console.log('\n=== Real-MH sweep summary ===');
    const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
    console.log(pad('Type', 28), pad('HTTP', 6), pad('Estado', 12), 'Message');
    console.log('-'.repeat(120));
    for (const r of summary) {
      console.log(
        pad(r.type, 28),
        pad(String(r.httpStatus), 6),
        pad(String(r.estado ?? ''), 12),
        r.msg,
      );
    }
    writeFileSync(resolve(DUMP_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

    // Lock in full coverage — all 11 types must return PROCESADO from MH.
    for (const r of summary) {
      expect.soft(r.estado, `${r.type}: ${r.msg}`).toBe('PROCESADO');
    }
    expect(summary.every((r) => r.estado === 'PROCESADO')).toBe(true);
  });
});
