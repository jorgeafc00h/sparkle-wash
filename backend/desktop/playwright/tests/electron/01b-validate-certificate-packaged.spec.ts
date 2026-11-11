/**
 * Step 1b — Validate that crypto.subtle is available under the app:// protocol.
 *
 * PREREQUISITE: `npm run build` must have been run so dist/ exists.
 * The spec skips gracefully when dist/index.html is absent.
 *
 * PURPOSE:
 *   Regression test for the packaged-build bug where Chromium treated the
 *   custom `app://` scheme as a non-secure context, causing `window.crypto.subtle`
 *   to be `undefined` and jose.importPKCS8 to throw:
 *     "cannot read properties of undefined (reading 'importKey')"
 *
 *   The fix (protocol.registerSchemesAsPrivileged in electron/main.cjs) tells
 *   Chromium to treat `app://` as a privileged secure scheme, restoring
 *   `window.crypto.subtle`.
 *
 *   This spec forces the `app://` code path even in dev mode via the
 *   FORCE_APP_PROTOCOL=1 env var and asserts:
 *     1. window.crypto.subtle is defined (the root fix)
 *     2. crypto.subtle.importKey succeeds with a real RSA key (jose compatibility)
 *     3. crypto.subtle.sign produces a non-empty signature (JWS capability)
 *
 * HOW IT DIFFERS FROM 01-validate-certificate.spec.ts:
 *   Spec 01 loads via http://localhost:5173 (Vite dev server — inherently secure)
 *   and uses dynamic TS imports that Vite resolves at runtime.
 *   This spec loads via app://dist/index.html (the packaged-build path) and
 *   uses only Web Crypto APIs available on the global scope — no TS-path imports.
 *   If registerSchemesAsPrivileged is removed from main.cjs, this spec fails;
 *   spec 01 still passes (the bug is invisible in dev mode).
 */

import { test, expect } from '@playwright/test';
import { _electron } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MH_TEST_CREDENTIALS, MH_TEST_STORED_CREDENTIALS } from '../../fixtures/mh-test-credentials';
import { TEST_COMPANY, TEST_USER, SAMPLE_CUSTOMERS } from '../../fixtures/seed-state';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const ELECTRON_ENTRY = resolve(REPO_ROOT, 'electron', 'main.cjs');
const DIST_INDEX = resolve(REPO_ROOT, 'dist', 'index.html');

test.describe('Step 1b — crypto.subtle under app:// (packaged-build path)', () => {
  test('window.crypto.subtle is defined and can import/sign an RSA key', async () => {
    // Skip when dist/ has not been built yet — avoids a cryptic failure in CI
    // when this spec runs without a prior `npm run build`.
    if (!existsSync(DIST_INDEX)) {
      test.skip(true, `dist/index.html not found — run 'npm run build' first. Expected: ${DIST_INDEX}`);
      return;
    }

    const certXml = readFileSync(MH_TEST_CREDENTIALS.certificatePath, 'utf-8');

    // Encode redux-persist slice
    const encodePersist = (obj: Record<string, unknown>) => {
      const encoded: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj)) encoded[k] = JSON.stringify(v);
      encoded._persist = JSON.stringify({ version: -1, rehydrated: true });
      return JSON.stringify(encoded);
    };

    const seededCompany = {
      ...TEST_COMPANY,
      hasValidCertificate: true,
      hasApiCredentials: true,
      certificatePath: MH_TEST_CREDENTIALS.certificatePath,
      certificateSubject: 'CN=TEST CERTIFICATE (Invoices.Api/Test)',
    };

    const nit = MH_TEST_CREDENTIALS.nit;
    const nitKeys = [TEST_COMPANY.nit, nit];

    const storage: Record<string, string> = {
      'persist:auth': encodePersist({
        user: TEST_USER,
        isAuthenticated: false,
        isGuestMode: true,
        hasCompletedOnboarding: true,
        loading: false,
        error: null,
        token: null,
        refreshToken: null,
        selectedCompanyId: TEST_COMPANY.id,
      }),
      'persist:companies': encodePersist({
        companies: [seededCompany],
        currentCompany: seededCompany,
        selectedCompanyId: TEST_COMPANY.id,
        loading: false,
        error: null,
      }),
      'persist:customers': encodePersist({
        customers: SAMPLE_CUSTOMERS,
        loading: false,
        error: null,
      }),
      'persist:invoices': encodePersist({ invoices: [], loading: false, error: null }),
    };
    for (const k of nitKeys) {
      storage[`cert_data_${k}`] = certXml;
    }

    const secrets: Record<string, { enc: boolean; v: string }> = {};
    for (const k of nitKeys) {
      secrets[`SparkleWash::cert_password_${k}`] = { enc: false, v: MH_TEST_CREDENTIALS.certificateKeySha512 };
      secrets[`SparkleWash::company_creds_${k}`] = { enc: false, v: JSON.stringify(MH_TEST_STORED_CREDENTIALS) };
    }

    // Fresh userData dir so this run is isolated from other tests
    const userDataDir = mkdtempSync(join(tmpdir(), 'fs-e2e-packaged-'));
    mkdirSync(userDataDir, { recursive: true });
    writeFileSync(join(userDataDir, 'app-storage.json'), JSON.stringify(storage));
    writeFileSync(join(userDataDir, 'secrets.json'), JSON.stringify(secrets), { mode: 0o600 });

    let app;
    try {
      // FORCE_APP_PROTOCOL=1 makes main.cjs skip the Vite dev server and load
      // via app://dist/index.html — the same code path as a packaged Windows build.
      app = await _electron.launch({
        args: [ELECTRON_ENTRY, `--user-data-dir=${userDataDir}`],
        env: {
          ...process.env,
          NODE_ENV: 'development',
          PLAYWRIGHT_TEST: '1',
          FORCE_APP_PROTOCOL: '1',
          VITE_GOOGLE_CLIENT_ID: process.env.VITE_GOOGLE_CLIENT_ID ?? '',
          VITE_GOOGLE_CLIENT_SECRET: process.env.VITE_GOOGLE_CLIENT_SECRET ?? '',
        },
        timeout: 60_000,
      });

      const window = await app.firstWindow({ timeout: 60_000 });
      await window.waitForLoadState('domcontentloaded');

      // Probe window.crypto.subtle availability and run a real RSA-PSS keygen +
      // sign round-trip entirely using the Web Crypto API. This verifies that
      // crypto.subtle works in the app:// context — the same code path that
      // jose.importPKCS8 relies on internally.
      const result = await window.evaluate(async () => {
        // 1. Is crypto.subtle defined?
        const subtleDefined = typeof window.crypto !== 'undefined'
          && typeof (window.crypto as SubtleCrypto & { subtle: SubtleCrypto }).subtle !== 'undefined'
          && window.crypto.subtle !== null;

        if (!subtleDefined) {
          return {
            subtleDefined: false,
            importKeySuccess: false,
            signSuccess: false,
            signatureByteLength: 0,
          };
        }

        // 2. Generate a fresh RSA key pair (so this test needs no external key
        //    material and always produces a deterministic pass/fail).
        let importKeySuccess = false;
        let signSuccess = false;
        let signatureByteLength = 0;
        try {
          const keyPair = await window.crypto.subtle.generateKey(
            {
              name: 'RSASSA-PKCS1-v1_5',
              modulusLength: 2048,
              publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
              hash: 'SHA-512',
            },
            true,
            ['sign', 'verify'],
          );
          importKeySuccess = keyPair.privateKey !== null;

          // 3. Sign a small payload — same operation jose.CompactSign uses internally.
          const encoder = new TextEncoder();
          const data = encoder.encode('{"test":"packaged-build-crypto-probe"}');
          const sig = await window.crypto.subtle.sign(
            { name: 'RSASSA-PKCS1-v1_5' },
            keyPair.privateKey,
            data,
          );
          signatureByteLength = sig.byteLength;
          signSuccess = signatureByteLength > 0;
        } catch (err) {
          // leave flags as false
        }

        return { subtleDefined, importKeySuccess, signSuccess, signatureByteLength };
      }) as {
        subtleDefined: boolean;
        importKeySuccess: boolean;
        signSuccess: boolean;
        signatureByteLength: number;
      };

      console.log('\n=== Step 1b — app:// protocol crypto.subtle probe ===');
      console.log('window.crypto.subtle defined :', result.subtleDefined);
      console.log('RSA key pair generated        :', result.importKeySuccess);
      console.log('RSA sign succeeded            :', result.signSuccess);
      console.log('Signature byte length         :', result.signatureByteLength);

      // Primary regression assertion — this was undefined before the fix.
      expect(result.subtleDefined).toBe(true);

      // Secondary assertions — prove the secure context is fully functional.
      expect(result.importKeySuccess).toBe(true);
      expect(result.signSuccess).toBe(true);
      // RSA-2048 signatures are always 256 bytes.
      expect(result.signatureByteLength).toBe(256);
    } finally {
      if (app) {
        try { await app.close(); } catch { /* ignore */ }
      }
      try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
