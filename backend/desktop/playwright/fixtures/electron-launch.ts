/**
 * Playwright fixture for launching the packaged Electron shell against the
 * Vite dev server. Exposes helpers to seed redux-persist state and to push
 * real secrets through the `secure:*` IPC so the app can actually sign + send
 * DTEs to MH.
 */

import { _electron, Page, ElectronApplication, test as base } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TEST_COMPANY,
  TEST_USER,
  SAMPLE_CUSTOMERS,
} from './seed-state';
import { MH_TEST_CREDENTIALS, MH_TEST_STORED_CREDENTIALS, hasMhTestCredentials, readMhTestCertificateXml } from './mh-test-credentials';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const ELECTRON_ENTRY = resolve(REPO_ROOT, 'electron', 'main.cjs');
const CERT_FILE = MH_TEST_CREDENTIALS.certificatePath;

export interface ElectronAppHandle {
  app: ElectronApplication;
  window: Page;
  userDataDir: string;
}

export interface SeedOptions {
  /**
   * If true, use real MH (no mock flags). When omitted, defaults to true
   * unless `MH_MOCK=1` is set in the environment — i.e. tests run against
   * the real MH test API by default. Set `mock: true` (or `MH_MOCK=1`) for
   * fast offline iteration with `MockMhClient` + fake signer.
   *
   * `real: false` is still honoured for explicit opt-out, kept for back-compat.
   */
  real?: boolean;
  /** Force mock mode regardless of env. Overrides `real`. */
  mock?: boolean;
  /** Invoices to seed into the redux store. */
  invoices?: unknown[];
  /** MockMhClient scenario override (mock mode only). */
  mockScenario?: 'success' | 'auth-failure' | 'dte-rejected' | 'duplicate-control' | 'server-error';
  /** Extra raw app-storage.json entries (e.g. `persist:subscription` for tier-gated suites). */
  extraStorage?: Record<string, string>;
  /** Extra renderer localStorage entries set before the first render (e.g. `fs_sync_v2_test`). */
  localStorage?: Record<string, string>;
  /**
   * Keep App Insights telemetry ACTIVE for this launch (no --uitesting flag).
   * Default off so suites stay hermetic; specs that validate the telemetry
   * pipeline set this and intercept the ingestion endpoint with page.route
   * themselves (see 09-support-diagnostics.spec.ts).
   */
  telemetry?: boolean;
}

/**
 * Resolve whether this run should mock MH. Default: real MH (the whole
 * point of the electron suite is to verify against MH's test environment).
 * Opt out by passing `{ mock: true }` (or `{ real: false }`), or by setting
 * `MH_MOCK=1` for a CI / offline fast loop.
 */
function shouldMock(opts: SeedOptions): boolean {
  if (opts.mock === true) return true;
  if (opts.real === false) return true;
  if (process.env.MH_MOCK === '1') return true;
  if (!hasMhTestCredentials) {
    throw new Error(
      'Real-MH Electron run without MH test credentials: set MH_TEST_PASSWORD, MH_TEST_CERT_KEY_SHA512, ' +
      'MH_TEST_API_KEY and MH_TEST_CERT_PATH (or playwright/fixtures/mh-test-credentials.local.json), ' +
      'or run with MH_MOCK=1.',
    );
  }
  return false;
}

/**
 * Build `app-storage.json` + `secrets.json` contents that match what main.cjs
 * writes at runtime. Pre-populating these files before Electron launches
 * means redux-persist sees seeded state on the very first rehydrate — no
 * reload dance, no race.
 */
function buildSeedFiles(opts: SeedOptions) {
  const certXml = readMhTestCertificateXml();
  const nitKeys = [TEST_COMPANY.nit, MH_TEST_CREDENTIALS.nit];

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
    certificatePath: CERT_FILE,
    certificateSubject: 'CN=TEST CERTIFICATE (Invoices.Api/Test)',
  };

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
    'persist:invoices': encodePersist({
      invoices: opts.invoices ?? [],
      loading: false,
      error: null,
    }),
  };
  for (const nit of nitKeys) {
    storage[`cert_data_${nit}`] = certXml;
  }

  // secrets.json: safeStorage entries. Use `enc: false` so the value is stored
  // as-is — bypasses the platform-specific keychain and survives fresh runs.
  const secrets: Record<string, { enc: boolean; v: string }> = {};
  for (const nit of nitKeys) {
    secrets[`SparkleWash::cert_password_${nit}`] = {
      enc: false,
      v: MH_TEST_CREDENTIALS.certificateKeySha512,
    };
    secrets[`SparkleWash::company_creds_${nit}`] = {
      enc: false,
      v: JSON.stringify(MH_TEST_STORED_CREDENTIALS),
    };
  }

  return { storage, secrets };
}

/**
 * Launch Electron with pre-seeded state. Creates a temp userData dir so
 * parallel runs (and repeat runs) don't leak through.
 */
export async function launchElectron(opts: SeedOptions = {}): Promise<ElectronAppHandle> {
  // Fresh userData dir for this test
  const userDataDir = mkdtempSync(join(tmpdir(), 'fs-e2e-'));
  mkdirSync(userDataDir, { recursive: true });

  const { storage, secrets } = buildSeedFiles(opts);
  Object.assign(storage, opts.extraStorage ?? {});
  writeFileSync(join(userDataDir, 'app-storage.json'), JSON.stringify(storage));
  writeFileSync(join(userDataDir, 'secrets.json'), JSON.stringify(secrets), { mode: 0o600 });

  // Default: hermetic runs. main.cjs turns the flag into ?uitesting=1 which the
  // renderer reads to disable telemetry before the SDK ever initializes.
  const launchArgs = [ELECTRON_ENTRY, `--user-data-dir=${userDataDir}`];
  if (!opts.telemetry) launchArgs.push('--uitesting');

  const app = await _electron.launch({
    args: launchArgs,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PLAYWRIGHT_TEST: '1',
      VITE_GOOGLE_CLIENT_ID: process.env.VITE_GOOGLE_CLIENT_ID ?? '',
      VITE_GOOGLE_CLIENT_SECRET: process.env.VITE_GOOGLE_CLIENT_SECRET ?? '',
    },
    timeout: 60_000,
  });
  const window = await app.firstWindow({ timeout: 60_000 });
  await window.waitForLoadState('domcontentloaded');

  // Mock flags live in the renderer's localStorage (read by MhClient /
  // SignerService via `localStorage.getItem`). Inject them via addInitScript
  // so any reload during the test keeps them. Default is real MH; set
  // `MH_MOCK=1` or pass `{ mock: true }` to flip to mock mode.
  if (opts.localStorage && Object.keys(opts.localStorage).length > 0) {
    await window.addInitScript((entries) => {
      for (const [key, value] of Object.entries(entries as Record<string, string>)) {
        localStorage.setItem(key, value);
      }
    }, opts.localStorage);
    if (!shouldMock(opts)) {
      await window.reload();
      await window.waitForLoadState('domcontentloaded');
    }
  }

  if (shouldMock(opts)) {
    await window.addInitScript(
      ({ scenario }) => {
        localStorage.setItem('__mock_mh_api', 'true');
        localStorage.setItem('__mock_signer', 'true');
        if (scenario) localStorage.setItem('__mock_mh_scenario', scenario);
      },
      { scenario: opts.mockScenario ?? null },
    );
    // Reload once so the init script runs before the first render.
    await window.reload();
    await window.waitForLoadState('domcontentloaded');
  }

  return { app, window, userDataDir };
}

/**
 * Relaunch Electron on an EXISTING userData dir (an "app restart"): whatever the
 * previous launch persisted to app-storage.json/secrets.json is what the new
 * process rehydrates. Close the previous handle with `handle.app.close()` (not
 * `closeElectron`, which deletes the dir) before calling this.
 */
export async function relaunchElectron(userDataDir: string): Promise<ElectronAppHandle> {
  const app = await _electron.launch({
    args: [ELECTRON_ENTRY, `--user-data-dir=${userDataDir}`, '--uitesting'],
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PLAYWRIGHT_TEST: '1',
      VITE_GOOGLE_CLIENT_ID: process.env.VITE_GOOGLE_CLIENT_ID ?? '',
      VITE_GOOGLE_CLIENT_SECRET: process.env.VITE_GOOGLE_CLIENT_SECRET ?? '',
    },
    timeout: 60_000,
  });
  const window = await app.firstWindow({ timeout: 60_000 });
  await window.waitForLoadState('domcontentloaded');
  return { app, window, userDataDir };
}

/**
 * Tear down: close the app and clean up the temp userData dir.
 */
export async function closeElectron(handle: ElectronAppHandle): Promise<void> {
  try {
    await handle.app.close();
  } finally {
    try {
      rmSync(handle.userDataDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

export type SeedElectronOptions = SeedOptions;

/**
 * @deprecated Use `launchElectron(opts)` which seeds at launch time. Kept for
 * tests that need to re-seed mid-flight (new invoice set between steps).
 */
export async function seedElectron(
  window: Page,
  opts: SeedElectronOptions = {},
): Promise<void> {
  // Real cert XML — only loaded when we're going to use it.
  const certXml = readMhTestCertificateXml();

  const payload = {
    TEST_USER,
    TEST_COMPANY: {
      ...TEST_COMPANY,
      hasValidCertificate: true,
      hasApiCredentials: true,
      certificatePath: CERT_FILE,
      certificateSubject: 'CN=TEST CERTIFICATE (Invoices.Api/Test)',
    },
    SAMPLE_CUSTOMERS,
    INVOICES: opts.invoices ?? [],
    NIT_KEYS: [TEST_COMPANY.nit, MH_TEST_CREDENTIALS.nit],
    CERT_XML: certXml,
    CERT_PASSWORD_HASH: MH_TEST_CREDENTIALS.certificateKeySha512,
    MH_CREDS: MH_TEST_STORED_CREDENTIALS,
    MOCK_MH: shouldMock(opts),
    MOCK_SCENARIO: opts.mockScenario,
  };

  await window.evaluate(async (p) => {
    const PREFIX = 'persist:';

    // The app routes redux-persist + appStorage through `electronAPI.storage`
    // (IPC → file-backed JSON in userData). Secrets go through `secure:*` IPC.
    // Mock feature flags live in `localStorage` directly (read by MhClient /
    // SignerService via `localStorage.getItem`).
    const api = (window as any).electronAPI;
    if (!api?.storage || !api?.secureSet) {
      throw new Error('Electron preload bridge not available — test cannot seed.');
    }

    // ─── Reset previous state ────────────────────────────────────────
    const existingKeys: string[] = await api.storage.getAllKeys();
    for (const k of existingKeys) {
      if (
        k.startsWith(PREFIX) ||
        k.startsWith('secure:') ||
        k.startsWith('cert_data_')
      ) {
        await api.storage.removeItem(k);
      }
    }
    // Mock flags live in window.localStorage
    for (const k of ['__mock_mh_api', '__mock_signer', '__mock_mh_scenario']) {
      localStorage.removeItem(k);
    }

    // ─── Redux-persist state (via IPC storage) ───────────────────────
    const write = async (key: string, obj: Record<string, unknown>) => {
      const encoded: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj)) encoded[k] = JSON.stringify(v);
      encoded._persist = JSON.stringify({ version: -1, rehydrated: true });
      await api.storage.setItem(`${PREFIX}${key}`, JSON.stringify(encoded));
    };

    await write('auth', {
      user: p.TEST_USER,
      isAuthenticated: false,
      isGuestMode: true,
      hasCompletedOnboarding: true,
      loading: false,
      error: null,
      token: null,
      refreshToken: null,
      selectedCompanyId: p.TEST_COMPANY.id,
    });
    await write('companies', {
      companies: [p.TEST_COMPANY],
      currentCompany: p.TEST_COMPANY,
      selectedCompanyId: p.TEST_COMPANY.id,
      loading: false,
      error: null,
    });
    await write('customers', {
      customers: p.SAMPLE_CUSTOMERS,
      loading: false,
      error: null,
    });
    await write('invoices', { invoices: p.INVOICES, loading: false, error: null });

    // ─── Secrets + cert XML (for both dashed and undashed NIT keys) ──
    for (const nit of p.NIT_KEYS) {
      await api.secureSet('SparkleWash', `cert_password_${nit}`, p.CERT_PASSWORD_HASH);
      await api.secureSet(
        'SparkleWash',
        `company_creds_${nit}`,
        JSON.stringify(p.MH_CREDS),
      );
      // cert_data is public cert XML — uses regular appStorage, not secure.
      await api.storage.setItem(`cert_data_${nit}`, p.CERT_XML);
    }

    // ─── Mock flags ──────────────────────────────────────────────────
    if (p.MOCK_MH) {
      localStorage.setItem('__mock_mh_api', 'true');
      localStorage.setItem('__mock_signer', 'true');
      if (p.MOCK_SCENARIO) {
        localStorage.setItem('__mock_mh_scenario', p.MOCK_SCENARIO);
      }
    }
  }, payload);

  // Force a reload so the app re-reads persisted state on boot.
  await window.reload();
  await window.waitForLoadState('domcontentloaded');
}

/**
 * Convenience test fixture — provides a launched Electron app and its first
 * window, with automatic teardown.
 */
export interface ElectronFixtures {
  /** Default launch — mocks everything, empty invoice list. */
  electronApp: ElectronAppHandle;
  /** Factory to launch with custom seed options (invoices, real mode, scenario). */
  electronFor: (opts: SeedOptions) => Promise<ElectronAppHandle>;
}

export const test = base.extend<ElectronFixtures>({
  electronApp: async ({}, use) => {
    const handle = await launchElectron();
    try {
      await use(handle);
    } finally {
      await closeElectron(handle);
    }
  },
  electronFor: async ({}, use) => {
    const launched: ElectronAppHandle[] = [];
    const factory = async (opts: SeedOptions) => {
      const handle = await launchElectron(opts);
      launched.push(handle);
      return handle;
    };
    try {
      await use(factory);
    } finally {
      for (const h of launched) await closeElectron(h);
    }
  },
});
export { expect } from '@playwright/test';
