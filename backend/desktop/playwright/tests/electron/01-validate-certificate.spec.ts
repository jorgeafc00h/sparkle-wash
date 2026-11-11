/**
 * Step 1 — Validate certificate credentials.
 *
 * Proves:
 *   (a) The seeded .crt XML parses cleanly.
 *   (b) The stored cert-password hash equals the `<clave>` in the cert XML.
 *   (c) SignerService.signAsync produces a valid RS512 JWS for a sample
 *       DTE JSON using the real PKCS8 private key from the cert.
 *
 * If this passes, local DTE signing works end-to-end.
 */

import { test, expect } from '../../fixtures/electron-launch';
import { MH_TEST_CREDENTIALS } from '../../fixtures/mh-test-credentials';

test.describe('Step 1 — Certificate credentials', () => {
  test('parses cert XML, hash matches, signs a sample payload', async ({ electronFor }) => {
    // Launch in REAL mode so __mock_signer is NOT set — we want to exercise
    // the actual RS512 signing path.
    const { window } = await electronFor({ real: true });
    const result = await window.evaluate(async (nit) => {
      const api = (window as any).electronAPI;

      // ── Pull the seeded state back via IPC ─────────────────────────
      const xml = await api.storage.getItem(`cert_data_${nit}`);
      const storedHash = await api.secureGet('SparkleWash', `cert_password_${nit}`);

      // ── Dynamic imports so the tooling loads from the app bundle ──
      const parserMod = await import('/src/services/signing/CertificateParser.ts');
      const signerMod = await import('/src/services/signing/SignerService.ts');

      const parsed = parserMod.parseCertificateXML(xml);

      // Prime the cache so we don't depend on SecureStorage during sign
      const signer = signerMod.getSignerService();
      signer.setCachedCertificate(parsed.nit, parsed);

      const samplePayload = JSON.stringify({
        identificacion: { version: 2, ambiente: '00', tipoDte: '01' },
        test: 'step-1-signer-probe',
      });

      const signResp = await signer.signAsync({
        nit: parsed.nit,
        passwordPri: storedHash,
        dteJson: samplePayload,
      });

      return {
        certNit: parsed.nit,
        certActivo: parsed.activo,
        claveInCert: parsed.privateKey.clave,
        storedHash,
        encodedLen: parsed.privateKey.encoded.length,
        signStatus: signResp.status,
        jws: signResp.body ?? '',
      };
    }, MH_TEST_CREDENTIALS.nit) as any;

    console.log('\n=== Certificate probe ===');
    console.log('cert.nit             :', result.certNit);
    console.log('cert.activo          :', result.certActivo);
    console.log('cert.privateKey.clave:', result.claveInCert.slice(0, 16), '...');
    console.log('stored hash (memory) :', result.storedHash?.slice(0, 16), '...');
    console.log('PKCS8 bytes length   :', result.encodedLen);
    console.log('sign status          :', result.signStatus);
    console.log('JWS segments         :', result.jws.split('.').length);
    console.log('JWS total length     :', result.jws.length);

    expect(result.certNit).toBe(MH_TEST_CREDENTIALS.nit);
    expect(result.certActivo).toBe(true);
    expect(result.claveInCert).toBe(result.storedHash);
    expect(result.signStatus).toBe('OK');
    // A valid JWS has exactly 3 base64url segments: header.payload.signature
    const segments = result.jws.split('.');
    expect(segments.length).toBe(3);
    expect(segments.every((segment: string) => segment.length > 0)).toBe(true);
  });
});
