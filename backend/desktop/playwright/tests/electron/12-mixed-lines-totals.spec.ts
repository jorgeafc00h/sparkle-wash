/**
 * Real-MH regression for the 2026-10-31 totals / DTE-mapping fixes.
 *
 * Builds, signs and POSTs to the MH TEST environment (apitest.dtes.mh.gob.sv):
 *   1. a Factura (01) with a discounted gravado line, an EXENTO line, a NO
 *      SUJETO line and a fractional quantity (1.5 × $0.99 — half-cent rounding);
 *   2. a CCF (03) with a discounted gravado line, an EXENTO line, a fractional
 *      quantity and the receptor's 1% IVA retention;
 *   3. a Nota de Crédito (05) referencing that CCF with a discounted gravado
 *      line and an exento line (the discount used to be subtracted twice).
 *
 * Every document goes through the app's real pipeline: invoiceSlice-style
 * totals (utils/invoiceTotals.computeTotals) → DTEMappingService.mapInvoice →
 * SignerService → /fesv/recepciondte. Asserts MH answers PROCESADO for all three
 * and that the stored totals equal the resumen MH accepted.
 *
 * Artifacts (outgoing JSON + raw MH response) land in test-results/dte-mixed-lines/.
 */

import { test, expect } from '../../fixtures/electron-launch';
import { MH_TEST_CREDENTIALS } from '../../fixtures/mh-test-credentials';
import { buildInvoicesFor, INVOICE_TYPE, svToday } from '../../fixtures/dte-types';
import { TEST_COMPANY } from '../../fixtures/seed-state';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DUMP_DIR = resolve(__dirname, '..', '..', '..', 'test-results', 'dte-mixed-lines');

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

test.describe('Real MH — mixed gravado / exento / no sujeto lines, discounts, fractional quantities', () => {
  test('FE + CCF + NC(CCF) are PROCESADO and match the stored totals', async ({ electronFor }) => {
    const { window } = await electronFor({ real: true });
    mkdirSync(DUMP_DIR, { recursive: true });

    const consumer = buildInvoicesFor('Factura').target.customer;
    const business = buildInvoicesFor('CCF').target.customer; // hasContributorRetention: true
    const date = svToday();
    const stamp = new Date().toISOString();
    const line = (id: string, productName: string, quantity: number, unitPrice: number, extra: Record<string, unknown> = {}) => ({
      id, productId: id, productName, quantity, unitPrice, obsItem: '', createdAt: stamp, updatedAt: stamp,
      taxCategory: 'GRAVADO', ...extra,
    });

    const factura = {
      label: 'Factura',
      invoiceType: INVOICE_TYPE.Factura,
      documentType: '01',
      customer: consumer,
      retention: false,
      items: [
        line('fe-1', 'Servicio con descuento', 2, 56.5, { discount: 11.3 }), // 10%
        line('fe-2', 'Libro de texto (exento)', 1, 25, { taxCategory: 'EXENTO' }),
        line('fe-3', 'Tornillos (fraccionario)', 1.5, 0.99),
        line('fe-4', 'Cargo no sujeto', 1, 7.25, { taxCategory: 'NO_GRAVADO' }),
      ],
    };
    const ccf = {
      label: 'CCF',
      invoiceType: INVOICE_TYPE.CCF,
      documentType: '03',
      customer: business,
      retention: true,
      items: [
        line('ccf-1', 'Consultoría con descuento', 2, 113, { discount: 22.6 }), // 10%
        line('ccf-2', 'Servicio exento', 1, 30, { taxCategory: 'EXENTO' }),
        line('ccf-3', 'Material (fraccionario)', 2.5, 4.99),
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

        let sequence = Math.max(1, Math.floor(Date.now() / 1000) % 1_000_000);

        const send = async (doc: any, related?: any) => {
          const seq = sequence++;
          const totals = totalsMod.computeTotals(doc.items, doc.invoiceType, doc.retention);
          const codigoGeneracion = genSvc.InvoiceGenerationService.generateCodigoGeneracion();
          const controlNumber = genSvc.InvoiceGenerationService.generateControlNumber(doc.invoiceType, seq, company);
          const invoice = {
            id: `mixed-${doc.label}`,
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
        out.push(await send(payload.factura));
        const ccfResult = await send(payload.ccf);
        out.push(ccfResult);
        if (ccfResult.estado === 'PROCESADO') {
          // NC against the CCF just accepted: discounted gravado line + an exento line.
          out.push(await send(
            {
              label: 'NotaCredito',
              invoiceType: payload.ncType,
              documentType: '05',
              customer: payload.ccf.customer,
              retention: false,
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
        company: { ...TEST_COMPANY, nit: MH_TEST_CREDENTIALS.nit },
        mhPassword: MH_TEST_CREDENTIALS.mhPassword,
        date,
        stamp,
        factura,
        ccf,
        ncType: INVOICE_TYPE.NotaCredito,
        ncItems: [
          line('nc-1', 'Devolución consultoría con descuento', 1, 113, { discount: 11.3 }),
          line('nc-2', 'Devolución servicio exento', 1, 10, { taxCategory: 'EXENTO' }),
        ],
      },
    );

    console.log('\n=== Real-MH mixed-lines summary ===');
    for (const r of results) {
      const dir = resolve(DUMP_DIR, r.label);
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, 'outgoing.json'), JSON.stringify(r.outgoing, null, 2));
      writeFileSync(resolve(dir, 'response.txt'), r.body);
      console.log(
        r.label.padEnd(12),
        String(r.httpStatus).padEnd(5),
        String(r.estado ?? '').padEnd(11),
        r.estado === 'PROCESADO' ? '' : `${r.descripcionMsg ?? ''} ${JSON.stringify(r.observaciones ?? [])} ${r.body.slice(0, 300)}`,
      );
      console.log('   resumen:', JSON.stringify(r.outgoing.resumen));
    }

    expect(results.map((r) => r.label)).toEqual(['Factura', 'CCF', 'NotaCredito']);

    for (const r of results) {
      expect.soft(r.estado, `${r.label}: ${r.descripcionMsg ?? ''} ${JSON.stringify(r.observaciones ?? [])}`).toBe('PROCESADO');

      // The stored totals are the figures MH accepted.
      const res = r.outgoing.resumen;
      const items: any[] = r.outgoing.cuerpoDocumento;
      const iva = res.tributos ? res.tributos[0].valor : res.totalIva ?? 0;
      expect.soft(r.storedTotals.tax, `${r.label} IVA`).toBe(iva);
      expect.soft(r.storedTotals.totalAmount, `${r.label} montoTotalOperacion`).toBe(res.montoTotalOperacion);
      expect.soft(r.storedTotals.totalPagar, `${r.label} totalPagar`).toBe(res.totalPagar);
      expect.soft(r.storedTotals.totalExenta, `${r.label} totalExenta`).toBe(res.totalExenta);
      expect.soft(res.totalExenta, `${r.label} has an exento line`).toBeGreaterThan(0);
      expect.soft(items.some((i) => i.montoDescu > 0), `${r.label} has a discounted line`).toBe(true);
    }
    // Document-specific checks.
    const [fe, ccfRes, nc] = results;
    expect.soft(fe.outgoing.resumen.totalNoSuj).toBeGreaterThan(0);
    expect.soft(fe.outgoing.cuerpoDocumento.some((i: any) => !Number.isInteger(i.cantidad))).toBe(true);
    expect.soft(ccfRes.outgoing.resumen.ivaRete).toBeGreaterThan(0);
    expect.soft(ccfRes.storedTotals.totalPagar).toBe(
      Math.round((ccfRes.storedTotals.totalAmount - ccfRes.storedTotals.ivaRete1) * 100) / 100,
    );
    expect.soft(nc.outgoing.documentoRelacionado[0].numeroDocumento).toBe(ccfRes.codigoGeneracion);

    expect(results.every((r) => r.estado === 'PROCESADO')).toBe(true);
  });
});
