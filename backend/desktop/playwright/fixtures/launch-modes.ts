/**
 * Named launch personas for Playwright tests. Mirrors the iOS
 * `XCUIApplication+Launch.swift` pattern: each mode primes the app into a
 * deterministic state before the first render, so tests can assert on flows
 * without navigating through auth/setup steps.
 *
 * All modes seed redux-persist state via `addInitScript` against localStorage
 * (the app's default redux-persist storage). If a mode requires the MH
 * mock, it also sets `localStorage.__mock_mh_api = 'true'` which activates
 * `MhClient.getMhClient()` to route through `MockMhClient`.
 */

import { Page } from '@playwright/test';
import {
  TEST_COMPANY,
  TEST_USER,
  SAMPLE_CUSTOMERS,
  SAMPLE_INVOICES,
} from './seed-state';
import { MH_TEST_CREDENTIALS, MH_TEST_STORED_CREDENTIALS } from './mh-test-credentials';

export type LaunchMode =
  | 'uiTesting'            // Guest mode, no company — blank slate
  | 'seedCompany'          // One company, no certificate, no credentials
  | 'seedCompanyWithCert'  // One company with cert + MH credentials configured
  | 'seedWithInvoices'     // Above + a handful of invoices in various states
  | 'mhLiteSync'           // seedCompanyWithCert + MockMhClient enabled (default E2E mode)
  | 'realMhLiteSync';      // seedCompanyWithCert targeting the real MH test env

interface LaunchOptions {
  /** Optional MockMhClient scenario (only used when mhLiteSync mode is active). */
  mockScenario?: 'success' | 'auth-failure' | 'dte-rejected' | 'duplicate-control' | 'server-error';
  /** Extra invoices to append to the seeded list (for per-type parametrized tests). */
  extraInvoices?: unknown[];
  /** Replace the whole invoice list with this array (overrides SAMPLE_INVOICES). */
  invoices?: unknown[];
}

/**
 * Apply the named launch mode BEFORE the app boots. Must be called after
 * `page.context()` is ready but before navigating to the baseURL, so the
 * init script runs before the first render.
 */
export async function launchAs(
  page: Page,
  mode: LaunchMode,
  opts: LaunchOptions = {},
): Promise<void> {
  // Build the seed payload that will be written into localStorage. The
  // redux-persist format is documented in `seed-state.ts`.
  await page.addInitScript(
    ({ mode, opts, TEST_USER, TEST_COMPANY, SAMPLE_CUSTOMERS, SAMPLE_INVOICES, MH_TEST_CREDENTIALS, MH_TEST_STORED_CREDENTIALS }) => {
      // ─── Redux persist helpers ───────────────────────────────────────
      const PREFIX = 'persist:';
      const persistWrite = (key: string, payload: Record<string, unknown>) => {
        const encoded: Record<string, string> = {};
        for (const [k, v] of Object.entries(payload)) {
          encoded[k] = JSON.stringify(v);
        }
        // redux-persist adds a `_persist` flag
        encoded._persist = JSON.stringify({ version: -1, rehydrated: true });
        localStorage.setItem(`${PREFIX}${key}`, JSON.stringify(encoded));
      };

      // Always reset the store before seeding to avoid cross-test leakage
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PREFIX)) localStorage.removeItem(k);
      }
      localStorage.removeItem('__mock_mh_api');
      localStorage.removeItem('secure:company_creds_' + MH_TEST_CREDENTIALS.nit);
      localStorage.removeItem('secure:cert_password_' + MH_TEST_CREDENTIALS.nit);
      localStorage.removeItem('cert_data_' + MH_TEST_CREDENTIALS.nit);

      // Companies, customers, invoices defaults
      const companyWithCert = {
        ...TEST_COMPANY,
        hasValidCertificate: true,
        hasApiCredentials: true,
        certificatePath: 'playwright-fixture',
        certificateSubject: 'CN=TEST CERTIFICATE FOR PLAYWRIGHT',
      };

      if (mode === 'uiTesting') {
        persistWrite('auth', {
          user: null,
          isAuthenticated: false,
          isGuestMode: true,
          hasCompletedOnboarding: true,
          loading: false,
          error: null,
          token: null,
          refreshToken: null,
          selectedCompanyId: null,
        });
        persistWrite('companies', { companies: [], currentCompany: null, selectedCompanyId: null, loading: false, error: null });
        return;
      }

      // Authenticated-ish (guest with onboarding complete) for all seeded modes
      persistWrite('auth', {
        user: TEST_USER,
        isAuthenticated: false,
        isGuestMode: true,
        hasCompletedOnboarding: true,
        loading: false,
        error: null,
        token: null,
        refreshToken: null,
        selectedCompanyId: TEST_COMPANY.id,
      });

      const companyForMode =
        mode === 'seedCompany'
          ? { ...TEST_COMPANY, hasValidCertificate: false, hasApiCredentials: false }
          : companyWithCert;

      persistWrite('companies', {
        companies: [companyForMode],
        currentCompany: companyForMode,
        selectedCompanyId: TEST_COMPANY.id,
        loading: false,
        error: null,
      });

      persistWrite('customers', { customers: SAMPLE_CUSTOMERS, loading: false, error: null });

      const includesSamples =
        mode === 'seedWithInvoices' || mode === 'mhLiteSync' || mode === 'realMhLiteSync';
      const base = opts.invoices ?? (includesSamples ? SAMPLE_INVOICES : []);
      const extra = opts.extraInvoices ?? [];
      persistWrite('invoices', {
        invoices: [...(base as any[]), ...(extra as any[])],
        loading: false,
        error: null,
      });

      // ─── Secure storage — seed cert + credentials for the cert modes ──
      // The app looks up secrets by `company.nit` which is the FORMATTED NIT
      // in TEST_COMPANY. We also seed under the undashed NIT since some
      // code paths strip the separators.
      if (mode === 'seedCompanyWithCert' || mode === 'seedWithInvoices' || mode === 'mhLiteSync' || mode === 'realMhLiteSync') {
        const nitKeys = [TEST_COMPANY.nit, MH_TEST_CREDENTIALS.nit];
        for (const nitKey of nitKeys) {
          localStorage.setItem(
            'secure:cert_password_' + nitKey,
            MH_TEST_CREDENTIALS.certificateKeySha512,
          );
          localStorage.setItem(
            'secure:company_creds_' + nitKey,
            JSON.stringify(MH_TEST_STORED_CREDENTIALS),
          );
          localStorage.setItem('cert_data_' + nitKey, '<CertificadoMH test="playwright"/>');
        }
      }

      // ─── Mock MH API + signer ─────────────────────────────────────────
      if (mode === 'mhLiteSync') {
        localStorage.setItem('__mock_mh_api', 'true');
        localStorage.setItem('__mock_signer', 'true');
        if (opts.mockScenario) {
          localStorage.setItem('__mock_mh_scenario', opts.mockScenario);
        }
      }

      // For `realMhLiteSync`, do NOT set __mock_mh_api — requests go to
      // apitest.dtes.mh.gob.sv. CORS in dev-server mode will block direct
      // calls, so this mode is intended only for a packaged Electron run.
    },
    {
      mode,
      opts,
      TEST_USER,
      TEST_COMPANY,
      SAMPLE_CUSTOMERS,
      SAMPLE_INVOICES,
      MH_TEST_CREDENTIALS,
      MH_TEST_STORED_CREDENTIALS,
    },
  );
}

// Re-export to let specs reach credentials without importing the env fixture twice.
export { MH_TEST_CREDENTIALS, MH_TEST_STORED_CREDENTIALS };
// Re-export seed constants too
export { TEST_USER, TEST_COMPANY, SAMPLE_CUSTOMERS, SAMPLE_INVOICES };
