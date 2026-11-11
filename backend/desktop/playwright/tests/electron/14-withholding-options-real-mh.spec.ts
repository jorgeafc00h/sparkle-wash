/**
 * Real-MH check of the DTE withholding options (openspec add-dte-withholding-options).
 *
 * Builds, signs and POSTs to the MH TEST environment (apitest.dtes.mh.gob.sv):
 *   1. a Factura de Sujeto Excluido (14) for goods with "Aplicar retención de
 *      renta (10%)" turned OFF → resumen.reteRenta 0, totalPagar = totalCompra;
 *   2. a CCF (03) issued as an agente de percepción to a receptor that is not a
 *      gran contribuyente, gravado base $500.00 → resumen.ivaPerci 5.00,
 *      totalPagar = montoTotalOperacion + ivaPerci (570.00);
 *   3. a Nota de Crédito (05) referencing that CCF, base $50.00 → the
 *      proportional percepción (ivaPerci 0.50, per-item ivaPerci adding up).
 *
 * Every document goes through the app's real pipeline: invoiceSlice-style
 * stored decision + totals (utils/invoiceTotals.computeTotals with
 * applyRentaRetention / applyIvaPerception) → DTEMappingService.mapInvoice →
 * SignerService → /fesv/recepciondte. Asserts MH's answer and that the stored
 * totals equal the resumen MH received.
 *
 * Artifacts (outgoing JSON + raw MH response) land in test-results/dte-withholding-options/.
 */

import { test, expect } from '../../fixtures/electron-launch';
import { MH_TEST_CREDENTIALS } from '../../fixtures/mh-test-credentials';
import { buildInvoicesFor, INVOICE_TYPE, svToday } from '../../fixtures/dte-types';
import { TEST_COMPANY } from '../../fixtures/seed-state';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DUMP_DIR = resolve(__dirname, '..', '..', '..', 'test-results', 'dte-withholding-options');

test.skip(process.env.MH_MOCK === '1', 'Live MH submission is skipped in offline mock mode.');

interface DocResult {
  label: string;
  httpStatus: number;
  body: string;
  outgoing: any;
  storedTotals: any;
  estado?: string;
  descripcionMsg?: string;
  observaciones?: string[];
  codigoGeneracion: string;
  fecEmi: string;
}

test.describe('Real MH — FSE without renta and IVA percepción 1%', () => {
  test('FSE (renta off) + CCF with percepción + NC(CCF) are PROCESADO and match the stored totals', async ({ electronFor }) => {
    const { window } = await electronFor({ real: true });
    mkdirSync(DUMP_DIR, { recursive: true });

    const sujetoExcluido = buildInvoicesFor('SujetoExcluido').target.customer;
    // Business receptor that is NOT a gran contribuyente and has no 1% retention
    // (isolates the percepción).
    const business = {
      ...buildInvoicesFor('CCF').target.customer,
      hasContributorRetention: false,
      isLargeTaxpayer: false,
    };
    const date = svToday();
    const stamp = new Date().toISOString();
    const line = (id: string, productName: string, quantity: number, unitPrice: number, extra: Record<string, unknown> = {}) => ({
      id, productId: id, productName, quantity, unitPrice, obsItem: '', createdAt: stamp, updatedAt: stamp,
      taxCategory: 'GRAVADO', ...extra,
    });

    const fse = {
      label: 'SujetoExcluido',
      invoiceType: INVOICE_TYPE.SujetoExcluido,
      documentType: '14',
      customer: sujetoExcluido,
      // Purchase of goods: the 10% renta does not apply.
      flags: { applyRentaRetention: false },
      items: [
        line('fse-1', 'Maíz en grano (quintal)', 4, 35),
        line('fse-2', 'Frijol rojo (arroba)', 3, 20),
      ],
    };
    const ccf = {
      label: 'CCF',
      invoiceType: INVOICE_TYPE.CCF,
      documentType: '03',
      customer: business,
      // Decision the editor stores for an agente de percepción company selling
      // to a receptor that is not a gran contribuyente (ivaPerceptionApplies).
      flags: { applyIvaPerception: true },
      items: [
        line('ccf-1', 'Equipo de cómputo', 2, 226), // base 400.00
        line('ccf-2', 'Instalación', 1, 113),       // base 100.00
      ],
    };

    const results: DocResult[] = await window.evaluate(
      async (payload: any) => {
        const genSvc = await import('/src/services/invoiceGeneration/InvoiceGenerationService.ts');
        const mapperSvc = await import('/src/services/dte/DTEMappingService.ts');
        const totalsMod = await import('/src/utils/invoiceTotals.ts');
        const signerMod = await import('/src/services/signing/SignerService.ts');
        const parserMod = await import('/src/services/signing/CertificateParser.ts');
        const mhClientMod = await import('/src/services/api/MhClient.ts');
        const secStorageMod = await import('/src/services/security/SecureStorageService.ts');
        const storageMod = await import('/src/services/storage/ElectronStorage.ts');

        const company = payload.company;
        const certXml = await storageMod.appStorage.getItem(`cert_data_${company.nit}`);
        const cert = parserMod.parseCertificateXML(certXml!);
        const signer = signerMod.getSignerService();
        signer.setCachedCertificate(cert.nit, cert);
        const passwordHash = await secStorageMod.SecureStorageService.getCertificatePassword(company.nit);
        const bearer = await new mhClientMod.MhClient(false).authenticate({
          userName: company.nit,
          password: payload.mhPassword,
        });
        const api = (window as any).electronAPI;
        if (!api?.mhFetch) throw new Error('Electron MH fetch bridge not available');

        let sequence = Math.max(1, Math.floor(Date.now() / 1000) % 1_000_000) + 500_000;

        const send = async (doc: any, related?: any) => {
          const seq = sequence++;
          const totals = totalsMod.computeTotals(doc.items, doc.invoiceType, false, doc.flags);
          const codigoGeneracion = genSvc.InvoiceGenerationService.generateCodigoGeneracion();
          const controlNumber = genSvc.InvoiceGenerationService.generateControlNumber(doc.invoiceType, seq, company);
          const invoice = {
            id: `withholding-${doc.label}`,
            invoiceNumber: controlNumber,
            controlNumber,
            generationCode: codigoGeneracion,
            date: payload.date,
            status: 0,
            invoiceType: doc.invoiceType,
            documentType: doc.documentType,
            companyId: company.id,
            customerId: doc.customer.id,
            customer: doc.customer,
            items: doc.items,
            ...doc.flags,
            totals,
            createdAt: payload.stamp,
            updatedAt: payload.stamp,
            ...(related ?? {}),
          };
          const dte = mapperSvc.DTEMappingService.mapInvoice(invoice as any, company, '00');
          const signed = await signer.signAsync({ nit: cert.nit, passwordPri: passwordHash!, dteJson: JSON.stringify(dte) });
          const resp = await api.mhFetch({
            url: 'https://apitest.dtes.mh.gob.sv/fesv/recepciondte',
            method: 'POST',
            headers: { Authorization: bearer, 'Content-Type': 'application/json', Accept: 'application/json' },
            body: {
              ambiente: '00',
              idEnvio: seq,
              version: dte.identificacion.version,
              tipoDte: dte.identificacion.tipoDte,
              documento: signed.body,
              codigoGeneracion: null,
            },
          });
          const body = resp.body ?? resp.error ?? '';
          let parsed: any = null;
          try { parsed = JSON.parse(body); } catch { /* non-JSON */ }
          return {
            label: doc.label,
            httpStatus: resp.status,
            body,
            outgoing: dte,
            storedTotals: totals,
            estado: parsed?.estado,
            descripcionMsg: parsed?.descripcionMsg,
            observaciones: parsed?.observaciones,
            codigoGeneracion: parsed?.codigoGeneracion || codigoGeneracion,
            fecEmi: dte.identificacion.fecEmi,
          };
        };

        const out = [];
        out.push(await send(payload.fse));
        const ccfResult = await send(payload.ccf);
        out.push(ccfResult);
        if (ccfResult.estado === 'PROCESADO') {
          // NC against the CCF just accepted (which carried percepción): two
          // gravado lines, base 50.00 → proportional percepción 0.50.
          out.push(await send(
            {
              label: 'NotaCredito',
              invoiceType: payload.ncType,
              documentType: '05',
              customer: payload.ccf.customer,
              flags: { applyIvaPerception: true },
              items: payload.ncItems,
            },
            {
              relatedDocumentType: '03',
              relatedInvoiceType: payload.ccf.invoiceType,
              relatedGenerationCode: ccfResult.codigoGeneracion,
              relatedDocumentNumber: ccfResult.codigoGeneracion,
              relatedDocumentDate: ccfResult.fecEmi,
            },
          ));
        }
        return out;
      },
      {
        company: { ...TEST_COMPANY, nit: MH_TEST_CREDENTIALS.nit, isPerceptionAgent: true },
        mhPassword: MH_TEST_CREDENTIALS.mhPassword,
        date,
        stamp,
        fse,
        ccf,
        ncType: INVOICE_TYPE.NotaCredito,
        ncItems: [
          line('nc-1', 'Devolución equipo (parcial)', 1, 33.9),  // base 30.00
          line('nc-2', 'Devolución instalación', 1, 22.6),       // base 20.00
        ],
      },
    );

    console.log('\n=== Real-MH withholding options summary ===');
    for (const r of results) {
      const dir = resolve(DUMP_DIR, r.label);
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, 'outgoing.json'), JSON.stringify(r.outgoing, null, 2));
      writeFileSync(resolve(dir, 'response.txt'), r.body);
      console.log(
        r.label.padEnd(15),
        String(r.httpStatus).padEnd(5),
        String(r.estado ?? '').padEnd(11),
        r.estado === 'PROCESADO' ? '' : `${r.descripcionMsg ?? ''} ${JSON.stringify(r.observaciones ?? [])} ${r.body.slice(0, 300)}`,
      );
      console.log('   resumen:', JSON.stringify(r.outgoing.resumen));
    }

    expect(results.map((r) => r.label)).toEqual(['SujetoExcluido', 'CCF', 'NotaCredito']);
    const [fseRes, ccfRes, ncRes] = results;

    for (const r of results) {
      expect.soft(r.estado, `${r.label}: ${r.descripcionMsg ?? ''} ${JSON.stringify(r.observaciones ?? [])}`).toBe('PROCESADO');
      // The stored totals are the figures MH received.
      const res = r.outgoing.resumen;
      expect.soft(r.storedTotals.totalPagar, `${r.label} totalPagar`).toBe(res.totalPagar);
      if (res.pagos) expect.soft(res.pagos[0].montoPago, `${r.label} pagos`).toBe(res.totalPagar);
    }

    // FSE without renta: no withholding, totalPagar = totalCompra.
    expect.soft(fseRes.outgoing.resumen).toMatchObject({ totalCompra: 200, reteRenta: 0, totalPagar: 200 });
    expect.soft(fseRes.storedTotals).toMatchObject({ totalAmount: 200, reteRenta: 0, totalPagar: 200 });

    // CCF with percepción: 1% of the $500.00 gravado base added to the total.
    expect.soft(ccfRes.outgoing.resumen).toMatchObject({
      totalGravada: 500, montoTotalOperacion: 565, ivaPerci: 5, ivaRete: 0, totalPagar: 570,
    });
    expect.soft(ccfRes.outgoing.resumen.tributos[0].valor).toBe(65);
    expect.soft(ccfRes.storedTotals).toMatchObject({ totalAmount: 565, tax: 65, ivaPerci1: 5, totalPagar: 570 });

    // NC: proportional percepción, per-item ivaPerci adding up to the resumen.
    expect.soft(ncRes.outgoing.resumen).toMatchObject({ totalGravada: 50, montoTotalOperacion: 56.5, ivaPerci: 0.5, totalPagar: 57 });
    const ncItemPerci = ncRes.outgoing.cuerpoDocumento.reduce((s: number, i: any) => s + i.ivaPerci, 0);
    expect.soft(Math.round(ncItemPerci * 100) / 100).toBe(0.5);
    expect.soft(ncRes.outgoing.documentoRelacionado[0].numeroDocumento).toBe(ccfRes.codigoGeneracion);

    expect(results.every((r) => r.estado === 'PROCESADO')).toBe(true);
  });
});
