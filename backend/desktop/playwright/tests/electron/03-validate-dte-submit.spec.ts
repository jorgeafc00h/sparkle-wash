/**
 * Step 3 — DTE submission probe.
 *
 * Builds ONE Factura DTE payload exactly as the app would, signs it, and
 * POSTs it directly to `https://apitest.dtes.mh.gob.sv/fesv/recepciondte`
 * with the bearer token from Step 2. Captures the raw request body and the
 * raw MH response.
 *
 * Asserts: estado === 'PROCESADO' (real MH must accept the DTE).
 * Uses a timestamp-derived sequence so each run produces a unique
 * numeroControl — MH rejects duplicates.
 */

import { test, expect } from '../../fixtures/electron-launch';
import { MH_TEST_CREDENTIALS } from '../../fixtures/mh-test-credentials';
import { buildInvoicesFor } from '../../fixtures/dte-types';
import { TEST_COMPANY } from '../../fixtures/seed-state';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DUMP_DIR = resolve(__dirname, '..', '..', '..', 'test-results', 'dte-probe');

test.skip(process.env.MH_MOCK === '1', 'Live MH DTE submission probe is skipped in offline mock mode.');

test.describe('Step 3 — DTE submission', () => {
  test('build + sign + POST Factura — capture MH response', async ({ electronFor }) => {
    const { target } = buildInvoicesFor('Factura');
    const { window } = await electronFor({ real: true, invoices: [target] });

    const result = await window.evaluate(
      async ({ invoiceId, company }) => {
        // Pull the app's real services out of the bundle
        const invoiceSvc = await import('/src/services/api/InvoiceService.ts');
        const genSvc = await import('/src/services/invoiceGeneration/InvoiceGenerationService.ts');
        const mapperSvc = await import('/src/services/dte/DTEMappingService.ts');
        const signerMod = await import('/src/services/signing/SignerService.ts');
        const parserMod = await import('/src/services/signing/CertificateParser.ts');
        const mhClientMod = await import('/src/services/api/MhClient.ts');
        const secStorageMod = await import('/src/services/security/SecureStorageService.ts');
        const storageMod = await import('/src/services/storage/ElectronStorage.ts');

        // Locate invoice in redux-persisted state
        const raw = await storageMod.appStorage.getItem('persist:invoices');
        const decoded = JSON.parse(raw!);
        const invoices = JSON.parse(decoded.invoices);
        const invoice = invoices.find((i: any) => i.id === invoiceId);
        if (!invoice) throw new Error('invoice not seeded');

        // Time-based sequence so each run produces a unique numeroControl.
        // MH rejects "YA EXISTE UN REGISTRO CON ESE VALOR" otherwise.
        const sequence = Math.max(1, Math.floor(Date.now() / 1000) % 1_000_000);
        const codigoGeneracion = genSvc.InvoiceGenerationService.generateCodigoGeneracion();
        const controlNumber = genSvc.InvoiceGenerationService.generateControlNumber(
          invoice.invoiceType,
          sequence,
          company,
        );
        const enriched = {
          ...invoice,
          generationCode: codigoGeneracion,
          controlNumber,
          invoiceNumber: controlNumber,
        };

        // Build DTE payload via the real mapper
        const dte = mapperSvc.DTEMappingService.mapInvoice(enriched, company, '00');
        const dteJson = JSON.stringify(dte);

        // Sign with the cached cert + stored hash
        const certXml = await storageMod.appStorage.getItem(`cert_data_${company.nit}`);
        const cert = parserMod.parseCertificateXML(certXml!);
        const signer = signerMod.getSignerService();
        signer.setCachedCertificate(cert.nit, cert);
        const passwordHash = await secStorageMod.SecureStorageService.getCertificatePassword(
          company.nit,
        );
        const signResp = await signer.signAsync({
          nit: cert.nit,
          passwordPri: passwordHash!,
          dteJson,
        });

        // Auth with MH
        const mh = new mhClientMod.MhClient(false);
        const bearer = await mh.authenticate({
          userName: company.nit,
          password: 'MemoryLeak00.',
        });

        // Direct POST to /fesv/recepciondte. Envelope mirrors MH spec:
        // idEnvio must be a positive integer; DO NOT include codigoGeneracion
        // at the envelope level (it lives inside the signed DTE).
        const idEnvio = Math.max(1, Math.floor(Date.now() / 1000) % 1_000_000);
        const submitBody = {
          ambiente: '00',
          idEnvio,
          version: dte.identificacion.version,
          tipoDte: dte.identificacion.tipoDte,
          documento: signResp.body,
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
        try { parsed = JSON.parse(text); } catch { /* non-JSON body on 4xx */ }

        return {
          dteJson,
          submitBody,
          bearer: bearer.slice(0, 60) + '…',
          httpStatus: resp.status,
          responseBody: text,
          jwsLen: signResp.body.length,
          estado: parsed?.estado,
          selloRecibido: parsed?.selloRecibido,
          descripcionMsg: parsed?.descripcionMsg,
        };
      },
      { invoiceId: target.id, company: { ...TEST_COMPANY, nit: MH_TEST_CREDENTIALS.nit } },
    ) as any;

    // Write artifacts for diffing against invoice2.json
    mkdirSync(DUMP_DIR, { recursive: true });
    writeFileSync(
      resolve(DUMP_DIR, 'outgoing-dte.json'),
      JSON.stringify(JSON.parse(result.dteJson), null, 2),
    );
    writeFileSync(
      resolve(DUMP_DIR, 'submit-body.json'),
      JSON.stringify(result.submitBody, null, 2),
    );
    writeFileSync(resolve(DUMP_DIR, 'mh-response.txt'), result.responseBody);

    console.log('\n=== DTE probe ===');
    console.log('HTTP status       :', result.httpStatus);
    console.log('Estado            :', result.estado);
    console.log('Sello             :', result.selloRecibido);
    console.log('JWS length        :', result.jwsLen);
    console.log('bearer            :', result.bearer);
    if (result.estado !== 'PROCESADO') {
      console.log('response body     :', result.responseBody.slice(0, 2000));
    }
    console.log('Artifacts dumped to:', DUMP_DIR);

    expect(result.httpStatus).toBe(200);
    expect(result.jwsLen).toBeGreaterThan(300);
    expect(
      result.estado,
      `MH rejected: ${result.descripcionMsg ?? result.responseBody.slice(0, 400)}`,
    ).toBe('PROCESADO');
    expect(result.selloRecibido).toBeTruthy();
  });
});
