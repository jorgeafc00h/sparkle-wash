/**
 * Marketing capture spec — Desktop App "Solicitar Autorización a Producción".
 *
 * Records ONE continuous video of the real Electron window walking the
 * production-access homologation flow, with the per-DTE-type progress bars
 * ANIMATING (mock MH + mock signer, so the whole batch runs offline in
 * seconds — we pace it with deliberate pauses so the camera sees each beat).
 *
 * Why a bespoke launcher instead of the electron-launch fixture:
 *   - The demo video config records a Chromium `page` via `video:{mode:'on'}`.
 *     The Electron window is NOT a Chromium browser context, so that does
 *     nothing. Playwright's `_electron.launch()` DOES accept
 *     `recordVideo:{dir,size}`, and the page from `app.firstWindow()` then
 *     exposes `.video()`. So we launch Electron ourselves with recordVideo,
 *     replicating the fixture's `buildSeedFiles` + userDataDir seeding +
 *     mock flags so the bars animate WITHOUT network.
 *
 * Beats (Spanish captions in the sidecar):
 *   1. portal/intro notice        → "Solicita tu acceso a producción a Hacienda"
 *   2. production-requirements     → "Tu empresa cumple los requisitos"
 *   3. "5 por tipo" batch button   → "Elige cuántos documentos de prueba por tipo"
 *   4. btn-start-full-process      → "Procesar todos: la app envía las pruebas a Hacienda"
 *   5. mid-processing (bars climb) → "Se generan y envían automáticamente, con progreso en tiempo real"
 *   6. completion card / ^Completo$→ "Pruebas completadas; pide producción en el portal de Hacienda"
 *
 * Orientation is controlled by DEMO_ORIENTATION=landscape|portrait (default
 * landscape). Landscape → 1920x1080, portrait → 1080x1920.
 *
 * Run (dev server is started by playwright.demo-electron.config.ts):
 *   npx playwright test --config playwright.demo-electron.config.ts --workers=1
 *   DEMO_ORIENTATION=portrait npx playwright test --config playwright.demo-electron.config.ts --workers=1
 */

import { test, _electron, type Page, type Locator, type ElectronApplication } from '@playwright/test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TEST_COMPANY,
  TEST_USER,
  SAMPLE_CUSTOMERS,
} from '../../fixtures/seed-state';
import {
  MH_TEST_CREDENTIALS,
  MH_TEST_STORED_CREDENTIALS,
} from '../../fixtures/mh-test-credentials';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dir, '..', '..', '..');
const ELECTRON_ENTRY = resolve(REPO_ROOT, 'electron', 'main.cjs');
const CERT_FILE = MH_TEST_CREDENTIALS.certificatePath;

const ORIENTATION = (process.env.DEMO_ORIENTATION ?? 'landscape').toLowerCase();
const PORTRAIT = ORIENTATION === 'portrait';
const VIDEO_W = PORTRAIT ? 1080 : 1920;
const VIDEO_H = PORTRAIT ? 1920 : 1080;

const MARKETING_BASE =
  '/Users/jorgeflores/github/FACTURAS SIMPLES/App.ReactNative/Marketing/social-meta-2026/onboarding-videos/source-footage';
const OUTPUT_DIR = PORTRAIT
  ? join(MARKETING_BASE, 'production-access-portrait-hd')
  : join(MARKETING_BASE, 'production-access-desktop-hd');
const VIDEO_NAME = PORTRAIT
  ? 'production-access-portrait.mp4'
  : 'production-access-fullflow.mp4';
const SIDECAR_NAME = PORTRAIT
  ? 'production-access-portrait.timeline.json'
  : 'production-access-fullflow.timeline.json';

// ---------------------------------------------------------------------------
// Seed files — replicate the electron-launch fixture's buildSeedFiles so the
// page rehydrates a fully-configured TEST-ACCOUNT company (cert + cert pwd +
// MH creds), and inject mock flags so MhClient + SignerService never touch the
// network. The bars animate purely from the mock pipeline.
// ---------------------------------------------------------------------------

function buildSeedFiles() {
  const certXml = readFileSync(CERT_FILE, 'utf-8');
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
    'persist:app': encodePersist({
      isInitialized: true,
      isOnline: true,
      currentTheme: 'light',
      language: 'es',
      environment: 'development',
      syncStatus: 'idle',
      notifications: [],
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
      invoices: [],
      loading: false,
      error: null,
    }),
  };
  for (const nit of nitKeys) {
    storage[`cert_data_${nit}`] = certXml;
  }

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

// ---------------------------------------------------------------------------
// Sidecar timeline
// ---------------------------------------------------------------------------

interface SidecarEvent {
  t: number;
  label: string;
  caption: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const events: SidecarEvent[] = [];
let startMs = 0;

async function record(
  window: Page,
  locator: Locator | null,
  label: string,
  caption: string,
): Promise<void> {
  let box: { x: number; y: number; width: number; height: number } | null = null;
  if (locator) {
    try {
      box = await locator.boundingBox({ timeout: 2000 });
    } catch {
      box = null;
    }
  }
  // Centered fallback box so the editor always has a caption + timestamp.
  const fb = {
    x: Math.round(VIDEO_W * 0.34),
    y: Math.round(VIDEO_H * 0.44),
    width: Math.round(VIDEO_W * 0.32),
    height: Math.round(VIDEO_H * 0.11),
  };
  const b = box ?? fb;
  events.push({
    t: Number(((Date.now() - startMs) / 1000).toFixed(2)),
    label,
    caption,
    x: Math.round(b.x),
    y: Math.round(b.y),
    w: Math.round(b.width),
    h: Math.round(b.height),
  });
}

function writeSidecar(): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const sidecar = { videoW: VIDEO_W, videoH: VIDEO_H, events };
  writeFileSync(resolve(OUTPUT_DIR, SIDECAR_NAME), JSON.stringify(sidecar, null, 2), 'utf-8');
  writeFileSync(
    resolve(__dir, PORTRAIT ? 'last-run-prod-portrait.json' : 'last-run-prod-timeline.json'),
    JSON.stringify(sidecar, null, 2),
    'utf-8',
  );
}

// ---------------------------------------------------------------------------
// Bounded close — Electron + an active recordVideo context can hang on
// app.close(). Race the close against a timeout and fall back to killing the
// underlying process so the test doesn't blow its budget. The WebM is already
// finalized by Playwright when the renderer/page closes.
// ---------------------------------------------------------------------------

// Best-effort transcode of the Playwright VP8/WebM recording to H.264 MP4 so
// the device-framing pipeline gets a standard container. Returns true on a
// non-empty mp4. If ffmpeg is missing, the caller keeps the .webm.
function transcodeToMp4(webmPath: string, mp4Path: string): boolean {
  try {
    const res = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-i', webmPath,
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-preset', 'slow',
        '-crf', '18',
        '-movflags', '+faststart',
        '-an',
        mp4Path,
      ],
      { stdio: 'ignore', timeout: 120_000 },
    );
    if (res.status !== 0) return false;
    return statSync(mp4Path).size > 0;
  } catch {
    return false;
  }
}

async function closeAppBounded(app: ElectronApplication, ms: number): Promise<void> {
  const timed = new Promise<void>((res) => setTimeout(res, ms));
  await Promise.race([app.close().catch(() => {}), timed]);
  try {
    const proc = app.process();
    if (proc && proc.exitCode === null && !proc.killed) {
      proc.kill('SIGKILL');
    }
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test(`request production access — ${ORIENTATION} marketing capture`, async () => {
  test.setTimeout(180_000);

  const userDataDir = mkdtempSync(join(tmpdir(), 'fs-demo-prod-'));
  mkdirSync(userDataDir, { recursive: true });
  const videoTmpDir = mkdtempSync(join(tmpdir(), 'fs-demo-prod-vid-'));

  const { storage, secrets } = buildSeedFiles();
  writeFileSync(join(userDataDir, 'app-storage.json'), JSON.stringify(storage));
  writeFileSync(join(userDataDir, 'secrets.json'), JSON.stringify(secrets), { mode: 0o600 });

  let app: ElectronApplication | null = null;
  let savedVideoPath: string | null = null;

  try {
    app = await _electron.launch({
      args: [ELECTRON_ENTRY, `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        PLAYWRIGHT_TEST: '1',
        VITE_GOOGLE_CLIENT_ID: process.env.VITE_GOOGLE_CLIENT_ID ?? '',
        VITE_GOOGLE_CLIENT_SECRET: process.env.VITE_GOOGLE_CLIENT_SECRET ?? '',
      },
      recordVideo: { dir: videoTmpDir, size: { width: VIDEO_W, height: VIDEO_H } },
      timeout: 60_000,
    });

    const window = await app.firstWindow({ timeout: 60_000 });
    await window.waitForLoadState('domcontentloaded');

    // Force the BrowserWindow to the exact capture size from the MAIN process.
    await app.evaluate(
      async ({ BrowserWindow }, { w, h }) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) {
          win.setMinimumSize(360, 600);
          win.setContentSize(w, h);
          win.center();
          win.show();
        }
      },
      { w: VIDEO_W, h: VIDEO_H },
    );

    // Inject mock flags so the renderer never hits the network. Reload once so
    // the init script runs before the first React render (matches the fixture).
    await window.addInitScript(() => {
      localStorage.setItem('__mock_mh_api', 'true');
      localStorage.setItem('__mock_signer', 'true');
    });
    await window.reload();
    await window.waitForLoadState('domcontentloaded');

    startMs = Date.now();

    // ── Navigate to the production-access page (HashRouter) ──────────────────
    await window.evaluate(() => {
      location.hash = '#/companies/1/request-production';
    });
    await window.getByTestId('request-production').waitFor({ state: 'visible', timeout: 30_000 });
    // Wait for redux-persist rehydration — "Sin empresa" in the sidebar clears.
    await window.getByText('Sin empresa').waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});
    await window.waitForTimeout(1500);

    // ── BEAT 1 — intro / portal notice ───────────────────────────────────────
    const notice = window.getByTestId('production-portal-notice');
    await notice.scrollIntoViewIfNeeded().catch(() => {});
    await record(window, notice, 'beat1-portal-notice', 'Solicita tu acceso a producción a Hacienda');
    await window.waitForTimeout(6000);

    // ── BEAT 2 — requirements card (all three badges green) ──────────────────
    const reqCard = window.getByTestId('production-requirements');
    await reqCard.scrollIntoViewIfNeeded().catch(() => {});
    await reqCard.waitFor({ state: 'visible', timeout: 10_000 });
    await record(window, reqCard, 'beat2-requirements', 'Tu empresa cumple los requisitos');
    await window.waitForTimeout(11000);

    // ── BEAT 3 — "5 por tipo" batch button ───────────────────────────────────
    const batchBtn5 = window.getByRole('button', { name: '5 por tipo', exact: true });
    await batchBtn5.scrollIntoViewIfNeeded().catch(() => {});
    await batchBtn5.waitFor({ state: 'visible', timeout: 10_000 });
    await record(window, batchBtn5, 'beat3-batch-5', 'Elige cuántos documentos de prueba por tipo');
    await batchBtn5.click();
    await window.waitForTimeout(6000);

    // ── BEAT 4 — start the full process ──────────────────────────────────────
    const startBtn = window.getByTestId('btn-start-full-process');
    await startBtn.scrollIntoViewIfNeeded().catch(() => {});
    await startBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await record(window, startBtn, 'beat4-start-process', 'Procesar todos: la app envía las pruebas a Hacienda');
    await window.waitForTimeout(4000);
    await startBtn.click();

    // Accept any confirmation dialog.
    const confirmBtn = window.getByRole('button', { name: /Confirmar|Aceptar|Sí/i });
    if (await confirmBtn.isVisible({ timeout: 2_500 }).catch(() => false)) {
      await confirmBtn.click();
    }
    await window.waitForTimeout(400);

    // ── BEAT 5 — mid-processing (scroll the type list into view, hold while the
    //            bars climb). The "Tipos de DTE" card holds the per-type bars. ─
    const dteCard = window.getByRole('heading', { name: 'Tipos de DTE' });
    await dteCard.scrollIntoViewIfNeeded().catch(() => {});
    // Give the first couple of type rows time to start moving before we mark
    // the beat, so the camera lands on visibly-climbing bars.
    await window.waitForTimeout(900);
    await record(
      window,
      dteCard,
      'beat5-processing',
      'Se generan y envían automáticamente, con progreso en tiempo real',
    );
    // Hold on the animating list and let the batch run to completion naturally —
    // this is the payoff shot, so we do NOT shorten it. Poll until the
    // "Completo" badge appears (typically ~29s of visible motion), with a
    // generous safety cap so a stalled run still releases the hold.
    const completeBadge = window.getByText(/^Completo$/).first();
    const holdStart = Date.now();
    while (Date.now() - holdStart < 90_000) {
      const done = await completeBadge.isVisible().catch(() => false);
      if (done) break;
      await window.waitForTimeout(500);
    }

    // ── BEAT 6 — completion card + "Completo" badge ──────────────────────────
    await completeBadge.waitFor({ state: 'visible', timeout: 60_000 });
    const completionCard = window.getByTestId('production-completion-card');
    await completionCard.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
    await completionCard.scrollIntoViewIfNeeded().catch(() => {});
    await window.waitForTimeout(800);
    await record(
      window,
      completionCard,
      'beat6-completion',
      'Pruebas completadas; pide producción en el portal de Hacienda',
    );
    await window.waitForTimeout(11000);

    writeSidecar();

    // ── Finalize the video ───────────────────────────────────────────────────
    // window.video() finalizes on context/app close. saveAs handles that for
    // us, but Electron's video plumbing is flaky across versions, so we capture
    // the raw .path() too and fall back to a manual move after app.close().
    let rawPath: string | null = null;
    try {
      rawPath = await window.video()?.path() ?? null;
    } catch {
      rawPath = null;
    }

    mkdirSync(OUTPUT_DIR, { recursive: true });
    const mp4Path = resolve(OUTPUT_DIR, VIDEO_NAME);
    const webmPath = mp4Path.replace(/\.mp4$/, '.webm');

    // Closing the app finalizes the WebM. saveAs after close is unreliable on
    // Electron, so close FIRST (bounded), then move the finalized raw file.
    await closeAppBounded(app, 20_000);
    app = null;

    // Playwright records VP8-in-WebM. Land the raw recording as .webm, then
    // transcode to a real H.264 .mp4 for the device-framing pipeline (keeps the
    // lossless raw alongside). The .mp4 is the primary deliverable.
    let haveRaw = false;
    if (rawPath) {
      try {
        renameSync(rawPath, webmPath);
        haveRaw = true;
      } catch {
        try {
          writeFileSync(webmPath, readFileSync(rawPath));
          haveRaw = true;
        } catch {
          haveRaw = false;
        }
      }
    }
    // Last resort: ask Playwright to save it (works if the app is still alive).
    if (!haveRaw) {
      try {
        await window.video()?.saveAs(webmPath);
        haveRaw = true;
      } catch {
        haveRaw = false;
      }
    }

    if (haveRaw) {
      const ok = transcodeToMp4(webmPath, mp4Path);
      savedVideoPath = ok ? mp4Path : webmPath;
    }

    // eslint-disable-next-line no-console
    console.log(
      `[demo-request-production] orientation=${ORIENTATION} video=${savedVideoPath ?? 'MISSING'} events=${events.length}`,
    );
  } finally {
    try {
      writeSidecar();
    } catch {
      /* ignore */
    }
    if (app) {
      await closeAppBounded(app, 15_000);
    }
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    try {
      rmSync(videoTmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});
