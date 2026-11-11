/**
 * Step 2 — MH authentication endpoint.
 *
 * Proves:
 *   Posting `user` + `pwd` (form-urlencoded) to
 *   `https://apitest.dtes.mh.gob.sv/seguridad/auth` with the test credentials
 *   returns `{ status: 'OK', body: { token: '...' } }`.
 *
 * No signing, no DTE payload. Pure authentication round-trip against the real
 * MH test environment. If this passes, we have a bearer token good for
 * `/fesv/recepciondte`.
 */

import { test, expect } from '../../fixtures/electron-launch';
import { MH_TEST_CREDENTIALS } from '../../fixtures/mh-test-credentials';

test.skip(process.env.MH_MOCK === '1', 'Live MH auth probe is skipped in offline mock mode.');

test.describe('Step 2 — MH auth endpoint', () => {
  test('POST /seguridad/auth with test credentials returns a token', async ({
    electronFor,
  }) => {
    const { window } = await electronFor({ real: true });

    const result = await window.evaluate(
      async (creds) => {
        // Run the real MhClient.authenticate from the app bundle so we
        // exercise the exact headers + body the app uses in production.
        const mod = await import('/src/services/api/MhClient.ts');
        const client = new mod.MhClient(false); // test env
        try {
          const token = await client.authenticate({
            userName: creds.nit,
            password: creds.mhPassword,
          });
          return {
            ok: true,
            token,
            tokenLength: token?.length ?? 0,
          };
        } catch (err) {
          const e = err as any;
          return {
            ok: false,
            message: e?.message ?? String(err),
            status: e?.response?.status ?? null,
            responseBody: e?.response?.data ?? null,
          };
        }
      },
      {
        nit: MH_TEST_CREDENTIALS.nit,
        mhPassword: MH_TEST_CREDENTIALS.mhPassword,
      },
    );

    console.log('\n=== MH Auth probe ===');
    console.log(JSON.stringify(result, null, 2).slice(0, 1000));

    expect(result.ok, `auth failed: ${(result as any).message ?? 'unknown'}`).toBe(true);
    expect(result.tokenLength).toBeGreaterThan(20);
  });
});
