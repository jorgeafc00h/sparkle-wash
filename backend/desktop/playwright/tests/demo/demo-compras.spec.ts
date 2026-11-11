/**
 * Marketing capture spec — Desktop App "Compras" module + Gmail/IMAP wizard.
 *
 * Records ONE continuous 1920x1080 video, INTERCUT with two pre-built Google
 * mockup pages, walking the real local Compras flow in BROWSER mode (Chromium,
 * NOT Electron) against the already-running Vite dev server:
 *
 *   1. Compras list (seeded with Email-source rows) — "en un solo lugar"
 *   2. Open the IMAP settings wizard (settings → card → Empezar)
 *   3. Paso 1: Abrir 2FA → file:// gmail-mock-2fa.html → back
 *   4. Paso 2: Abrir App Passwords → file:// gmail-mock-apppasswords.html → back
 *   5. Paso 3: fill email + 16-char app password → Probar → "Conexión exitosa"
 *      (via injected electronAPI stub) → Guardar
 *   6. Back to Compras list (Email-source rows)
 *
 * Alongside the video it writes a coordinate sidecar timeline JSON so the
 * editor can overlay Spanish captions on the exact on-screen target boxes.
 *
 * BROWSER-MODE STUB: in web mode `window.electronAPI` is undefined, so
 * `ImapImportService.testConnection` returns the desktop-only error and Probar
 * never succeeds. We inject (via addInitScript, before load) a stub
 * `window.electronAPI` whose `imapTestConnection` resolves `{ ok: true }` and
 * whose `secureSet`/`secureGet`/`secureDelete` resolve OK. The stub deliberately
 * does NOT expose `getPlatform: 'electron'` + `storage`, so `appStorage`
 * (ElectronStorage.isElectron) keeps using localStorage — that's where the
 * seeded `compras_db_1` rows live and where the Compras list reads from.
 *
 * We own the browser/context lifecycle so the WebM finalizes cleanly on
 * context.close() (the standard `page` fixture truncates the recording). The
 * VP8/WebM is transcoded to H.264 MP4 afterwards.
 *
 * Run:
 *   npx playwright test --config playwright.demo.config.ts demo-compras.spec.ts --workers=1
 */

import { test, chromium, type Page, type Locator } from '@playwright/test';
import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  statSync,
  mkdtempSync,
  readdirSync,
  existsSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import {
  TEST_USER,
  TEST_COMPANY,
  SAMPLE_CUSTOMERS,
  SAMPLE_PRODUCTS,
  SAMPLE_INVOICES,
} from '../../fixtures/seed-state';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR =
  '/Users/jorgeflores/github/FACTURAS SIMPLES/App.ReactNative/Marketing/social-meta-2026/onboarding-videos/source-footage/compras-desktop-hd';
const VIDEO_NAME = 'compras-fullflow.mp4';
const SIDECAR_NAME = 'compras-fullflow.timeline.json';
const BASE_URL = 'http://127.0.0.1:5173';

const MOCKUP_DIR =
  '/Users/jorgeflores/github/FACTURAS SIMPLES/App.ReactNative/Marketing/social-meta-2026/onboarding-videos/assets/gmail-mockups';
const MOCK_2FA_URL = `file://${MOCKUP_DIR}/gmail-mock-2fa.html`;
const MOCK_APPPW_URL = `file://${MOCKUP_DIR}/gmail-mock-apppasswords.html`;

const DEMO_EMAIL = 'empresa.demo@gmail.com';
const DEMO_APP_PASSWORD = 'kxmqrtwzbpfndvaj'; // 16 chars → triggers the green hint

// ---------------------------------------------------------------------------
// Seed builders — mirror redux-persist localStorage so we can inject it into a
// context we own (manual recordVideo lifecycle). Subscription = pro.
//
// The Compras list does NOT read the redux `compras` array — on mount it
// dispatches loadCompras() which reads ComprasDatabase (appStorage →
// localStorage key `compras_db_<companyId>`). So we seed BOTH the redux slice
// (first paint) AND `compras_db_1` (what loadCompras reloads), with several
// Email-source rows so the "Email" source badge shows.
// ---------------------------------------------------------------------------

const PERSIST = { version: -1, rehydrated: true };

function enc(state: Record<string, unknown>): string {
  const doubleEncoded: Record<string, string> = {};
  for (const [k, v] of Object.entries(state)) doubleEncoded[k] = JSON.stringify(v);
  return JSON.stringify(doubleEncoded);
}

const NEEDED_CATALOG_IDS = new Set([
  'CAT-002',
  'CAT-008',
  'CAT-012',
  'CAT-013',
  'CAT-023',
  'CAT-024',
]);

function loadCatalogs(): Array<Record<string, unknown>> {
  try {
    const path = resolve(__dir, '..', '..', '..', 'src', 'data', 'catalogs.json');
    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    const all: Array<Record<string, unknown>> = Array.isArray(raw) ? raw : raw.catalogs ?? [];
    return all.filter((c) => NEEDED_CATALOG_IDS.has(c.id as string));
  } catch {
    return [];
  }
}

// Several imported (Email-source) purchases so the list looks populated and
// every row shows the blue "Email" source badge.
const DEMO_COMPRAS = [
  {
    id: 'compra-email-001',
    companyId: TEST_COMPANY.id,
    emisorNit: '0614-200915-102-3',
    emisorNrc: '2210045',
    emisorNombre: 'Distribuidora La Constancia S.A. de C.V.',
    tipoDte: '03',
    codigoGeneracion: 'A1B2C3D4-0001-4111-8111-1000000000A1',
    numeroControl: 'DTE-03-M001P001-000000000000101',
    selloRecibido: 'SELLO-EMAIL-001',
    fecha: '2026-06-18',
    paymentCondition: 1,
    totalGravada: 442.48,
    totalIva: 57.52,
    totalPagar: 500.0,
    source: 'email',
    gmailMessageId: 'imap-msg-101',
    verified: true,
    verifiedEstado: 'PROCESADO',
    items: [],
    createdAt: '2026-06-18T10:00:00.000Z',
    updatedAt: '2026-06-18T10:00:00.000Z',
  },
  {
    id: 'compra-email-002',
    companyId: TEST_COMPANY.id,
    emisorNit: '0614-310708-118-9',
    emisorNrc: '1987612',
    emisorNombre: 'Suministros de Oficina del Pacífico',
    tipoDte: '01',
    codigoGeneracion: 'A1B2C3D4-0002-4111-8111-1000000000A2',
    numeroControl: 'DTE-01-M001P001-000000000000087',
    selloRecibido: 'SELLO-EMAIL-002',
    fecha: '2026-06-15',
    paymentCondition: 1,
    totalGravada: 110.62,
    totalIva: 14.38,
    totalPagar: 125.0,
    source: 'email',
    gmailMessageId: 'imap-msg-102',
    verified: true,
    verifiedEstado: 'PROCESADO',
    items: [],
    createdAt: '2026-06-15T10:00:00.000Z',
    updatedAt: '2026-06-15T10:00:00.000Z',
  },
  {
    id: 'compra-email-003',
    companyId: TEST_COMPANY.id,
    emisorNit: '0614-050617-101-4',
    emisorNrc: '3041288',
    emisorNombre: 'Importaciones Tecnológicas S.A.',
    tipoDte: '03',
    codigoGeneracion: 'A1B2C3D4-0003-4111-8111-1000000000A3',
    numeroControl: 'DTE-03-M001P001-000000000000142',
    selloRecibido: 'SELLO-EMAIL-003',
    fecha: '2026-06-11',
    paymentCondition: 2,
    paymentTermCode: '01',
    paymentTermPeriod: 30,
    totalGravada: 1283.19,
    totalIva: 166.81,
    totalPagar: 1450.0,
    source: 'email',
    gmailMessageId: 'imap-msg-103',
    verified: true,
    verifiedEstado: 'PROCESADO',
    items: [],
    createdAt: '2026-06-11T10:00:00.000Z',
    updatedAt: '2026-06-11T10:00:00.000Z',
  },
  {
    id: 'compra-email-004',
    companyId: TEST_COMPANY.id,
    emisorNit: '0614-120319-103-7',
    emisorNrc: '2765410',
    emisorNombre: 'Ferretería El Constructor',
    tipoDte: '01',
    codigoGeneracion: 'A1B2C3D4-0004-4111-8111-1000000000A4',
    numeroControl: 'DTE-01-M001P001-000000000000063',
    selloRecibido: 'SELLO-EMAIL-004',
    fecha: '2026-06-07',
    paymentCondition: 1,
    totalGravada: 70.8,
    totalIva: 9.2,
    totalPagar: 80.0,
    source: 'email',
    gmailMessageId: 'imap-msg-104',
    verified: true,
    verifiedEstado: 'PROCESADO',
    items: [],
    createdAt: '2026-06-07T10:00:00.000Z',
    updatedAt: '2026-06-07T10:00:00.000Z',
  },
  {
    id: 'compra-email-005',
    companyId: TEST_COMPANY.id,
    emisorNit: '0614-280214-109-2',
    emisorNrc: '1556034',
    emisorNombre: 'Servicios Logísticos Centroamérica',
    tipoDte: '03',
    codigoGeneracion: 'A1B2C3D4-0005-4111-8111-1000000000A5',
    numeroControl: 'DTE-03-M001P001-000000000000099',
    selloRecibido: 'SELLO-EMAIL-005',
    fecha: '2026-06-03',
    paymentCondition: 2,
    paymentTermCode: '01',
    paymentTermPeriod: 15,
    totalGravada: 619.47,
    totalIva: 80.53,
    totalPagar: 700.0,
    source: 'email',
    gmailMessageId: 'imap-msg-105',
    verified: true,
    verifiedEstado: 'PROCESADO',
    items: [],
    createdAt: '2026-06-03T10:00:00.000Z',
    updatedAt: '2026-06-03T10:00:00.000Z',
  },
];

function buildSeedEntries(): Record<string, string> {
  return {
    'persist:auth': enc({
      user: TEST_USER,
      isAuthenticated: false,
      isGuestMode: true,
      hasCompletedOnboarding: true,
      loading: false,
      error: null,
      token: null,
      refreshToken: null,
      selectedCompanyId: TEST_COMPANY.id,
      _persist: PERSIST,
    }),
    'persist:app': enc({
      isInitialized: true,
      isOnline: true,
      currentTheme: 'light',
      language: 'es',
      environment: 'development',
      syncStatus: 'idle',
      notifications: [],
      _persist: PERSIST,
    }),
    'persist:companies': enc({
      companies: [TEST_COMPANY],
      selectedCompanyId: TEST_COMPANY.id,
      currentCompany: TEST_COMPANY,
      loading: false,
      error: null,
      _persist: PERSIST,
    }),
    'persist:customers': enc({
      customers: SAMPLE_CUSTOMERS,
      selectedCustomerId: null,
      lastUpdatedAt: null,
      loading: false,
      error: null,
      searchTerm: '',
      filters: { isActive: true },
      _persist: PERSIST,
    }),
    'persist:products': enc({
      products: SAMPLE_PRODUCTS,
      stockMovements: [],
      categories: [],
      brands: [],
      suppliers: [],
      currentProduct: null,
      filters: {},
      loading: false,
      error: null,
      searchTerm: '',
      _persist: PERSIST,
    }),
    'persist:invoices': enc({
      invoices: SAMPLE_INVOICES,
      selectedInvoiceId: null,
      pendingSync: [],
      lastSyncDate: null,
      currentInvoice: null,
      filters: {},
      loading: false,
      error: null,
      searchTerm: '',
      _persist: PERSIST,
    }),
    'persist:catalogs': enc({
      catalogs: loadCatalogs(),
      syncInfo: {},
      lastFullSync: new Date().toISOString(),
      filters: {},
      loading: false,
      error: null,
      searchTerm: '',
      _persist: PERSIST,
    }),
    'persist:subscription': enc({
      tier: 'pro',
      isInitialized: true,
      loading: false,
      error: null,
      availableProducts: [],
      activeSubscription: null,
      purchaseInProgress: false,
      _persist: PERSIST,
    }),
    // First-paint redux state — loadCompras() will reload from compras_db_1.
    'persist:compras': enc({
      compras: DEMO_COMPRAS,
      ledgerCompras: DEMO_COMPRAS,
      monthlyTotal: null,
      dbInitialized: true,
      loading: false,
      error: null,
      searchTerm: '',
      dateFrom: null,
      dateTo: null,
      selectedCompraId: null,
      linkedGmailEmail: null,
      syncState: null,
      _persist: PERSIST,
    }),
    'persist:accounts': enc({
      entries: [],
      payments: [],
      activeDirection: 'receivable',
      searchTerm: '',
      statusFilter: 'all',
      error: null,
      lastUpdatedAt: null,
      _persist: PERSIST,
    }),
    // ComprasDatabase backing store (what loadCompras reads in web mode).
    [`compras_db_${TEST_COMPANY.id}`]: JSON.stringify(DEMO_COMPRAS),
  };
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

async function record(locator: Locator | null, label: string, caption: string): Promise<void> {
  let box: { x: number; y: number; width: number; height: number } | null = null;
  if (locator) {
    try {
      box = await locator.boundingBox({ timeout: 2000 });
    } catch {
      box = null;
    }
  }
  // Always push an event so the editor has a caption + timestamp per beat.
  // Fall back to a centered box when the live geometry is unavailable (e.g.
  // the mockup pages — different document, no app locators).
  const fb = { x: 560, y: 460, width: 800, height: 160 };
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
  const sidecar = { videoW: 1920, videoH: 1080, events };
  writeFileSync(resolve(OUTPUT_DIR, SIDECAR_NAME), JSON.stringify(sidecar, null, 2), 'utf-8');
  writeFileSync(
    resolve(__dir, 'last-run-compras-timeline.json'),
    JSON.stringify(sidecar, null, 2),
    'utf-8',
  );
}

// Type into a field at a human pace, recording the target box first.
async function typeInto(
  page: Page,
  locator: Locator,
  text: string,
  label: string,
  caption: string,
): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await record(locator, label, caption);
  await locator.click();
  await locator.fill('');
  await locator.pressSequentially(text, { delay: 70 });
  await page.waitForTimeout(400);
}

// Best-effort transcode of the Playwright VP8/WebM recording to H.264 MP4.
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
      { stdio: 'ignore', timeout: 240_000 },
    );
    if (res.status !== 0) return false;
    return statSync(mp4Path).size > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// electronAPI stub (web mode) — injected via addInitScript BEFORE any page
// script. Resolves IMAP test SUCCESS + secure storage OK. Crucially does NOT
// claim platform 'electron' nor expose `storage`, so appStorage keeps using
// localStorage (where compras_db_1 lives).
// ---------------------------------------------------------------------------

function installElectronStub(page: Page) {
  return page.addInitScript(() => {
    // Only install if not already present (idempotent across navigations).
    const w = window as unknown as { electronAPI?: Record<string, unknown> };
    w.electronAPI = {
      // Report web so ElectronStorage.isElectron() stays false → localStorage.
      getPlatform: () => 'web',
      // IMAP test resolves SUCCESS → wizard shows green "Conexión exitosa".
      imapTestConnection: async (config: { host?: string; port?: number }) =>
        ({ ok: true, host: config?.host || 'imap.gmail.com', port: config?.port || 993 }),
      // Secure storage shims — Guardar uses secureSet; mount uses secureGet.
      secureGet: async () => null,
      secureSet: async () => undefined,
      secureDelete: async () => true,
    } as unknown as Record<string, unknown>;
  });
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test('compras full flow — list + IMAP wizard + Google mockups — beats 1 to 6', async () => {
  test.setTimeout(240_000);
  // The Gmail 2FA / app-password mockups live in the App.ReactNative marketing
  // workspace (untracked). Without them beat 3 cannot be recorded.
  test.skip(
    !existsSync(`${MOCKUP_DIR}/gmail-mock-2fa.html`) || !existsSync(`${MOCKUP_DIR}/gmail-mock-apppasswords.html`),
    `Gmail mockups not found in ${MOCKUP_DIR}`,
  );

  const videoTmpDir = mkdtempSync(join(tmpdir(), 'compras-demo-'));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    recordVideo: { dir: videoTmpDir, size: { width: 1920, height: 1080 } },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);

  try {
    // Seed redux-persist localStorage + compras_db_1 + install the electronAPI
    // stub BEFORE load. Both addInitScripts re-run on every navigation, so the
    // seed + stub survive the file:// mockup round-trips.
    const entries = buildSeedEntries();
    await page.addInitScript((data) => {
      for (const [k, v] of Object.entries(data as Record<string, string>)) {
        window.localStorage.setItem(k, v);
      }
    }, entries);
    await installElectronStub(page);

    await page.goto(`${BASE_URL}/#/compras`);
    await page.waitForLoadState('domcontentloaded');
    await page.getByTestId('compras-list').waitFor({ state: 'visible', timeout: 20_000 });
    startMs = Date.now();
    await page.waitForTimeout(1200); // let the shell settle on camera

    // ── BEAT 1 — Compras list (seeded, Email-source rows) ────────────────────
    await page
      .getByText('Distribuidora La Constancia', { exact: false })
      .first()
      .waitFor({ state: 'visible', timeout: 12_000 });
    await record(
      page.getByRole('heading', { name: 'Compras' }).first(),
      'beat1-list',
      'Tus facturas de compra, en un solo lugar',
    );
    await page.waitForTimeout(2500);
    // Spotlight an "Email" source badge on the first row.
    const emailBadge = page
      .getByTestId('compras-list')
      .getByText('Email', { exact: true })
      .first();
    const emailBadgeVisible = await emailBadge.isVisible({ timeout: 3000 }).catch(() => false);
    await record(
      emailBadgeVisible ? emailBadge : page.getByTestId('compras-list'),
      'beat1-email-badge',
      'Tus facturas de compra, en un solo lugar',
    );
    await page.waitForTimeout(7000);

    // ── BEAT 2 — Open the IMAP settings/wizard ───────────────────────────────
    // Settings button (gear icon, aria-label) → settings page → IMAP card.
    const settingsBtn = page.getByRole('button', { name: /configuraci[oó]n de compras/i }).first();
    await record(settingsBtn, 'beat2-settings-btn', 'Conecta tu Gmail por IMAP, en tres pasos');
    await settingsBtn.click();
    const imapCard = page.getByTestId('compras-settings-imap-card');
    await imapCard.waitFor({ state: 'visible', timeout: 12_000 });
    await page.waitForTimeout(1200);
    await record(imapCard, 'beat2-imap-card', 'Conecta tu Gmail por IMAP, en tres pasos');
    await page.waitForTimeout(2500);
    const startBtn = page.getByTestId('compras-settings-imap-start');
    await startBtn.scrollIntoViewIfNeeded();
    await record(startBtn, 'beat2-imap-start', 'Conecta tu Gmail por IMAP, en tres pasos');
    await startBtn.click();
    // Step 1 button now visible — wizard is open.
    await page
      .getByTestId('compras-settings-imap-open-2fa')
      .waitFor({ state: 'visible', timeout: 8000 });
    await page.waitForTimeout(4500);

    // ── BEAT 3 — Paso 1: 2FA → mockup → back ─────────────────────────────────
    const open2fa = page.getByTestId('compras-settings-imap-open-2fa');
    await open2fa.scrollIntoViewIfNeeded();
    await record(open2fa, 'beat3-open-2fa', 'Paso 1: activa la verificación en dos pasos');
    await open2fa.click();
    await page.waitForTimeout(800);
    // Navigate the SAME page to the 2FA mockup so it's part of the recording.
    await page.goto(MOCK_2FA_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(900);
    await record(null, 'beat3-mock-2fa', 'Paso 1: activa la verificación en dos pasos');
    await page.waitForTimeout(8000);
    // Back to the app wizard (re-open — addInitScript re-seeds + re-stubs).
    await page.goto(`${BASE_URL}/#/compras/settings`);
    await page.waitForLoadState('domcontentloaded');
    await page.getByTestId('compras-settings-imap-start').waitFor({ state: 'visible', timeout: 12_000 });
    await page.getByTestId('compras-settings-imap-start').click();
    await page
      .getByTestId('compras-settings-imap-open-apppasswords')
      .waitFor({ state: 'visible', timeout: 8000 });
    await page.waitForTimeout(1200);

    // ── BEAT 4 — Paso 2: App Passwords → mockup → back ───────────────────────
    const openAppPw = page.getByTestId('compras-settings-imap-open-apppasswords');
    await openAppPw.scrollIntoViewIfNeeded();
    await record(
      openAppPw,
      'beat4-open-apppasswords',
      'Paso 2: crea una contraseña de aplicación de 16 caracteres',
    );
    await openAppPw.click();
    await page.waitForTimeout(800);
    await page.goto(MOCK_APPPW_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(900);
    await record(
      null,
      'beat4-mock-apppasswords',
      'Paso 2: crea una contraseña de aplicación de 16 caracteres',
    );
    await page.waitForTimeout(9000);
    // Back to the app wizard for Paso 3.
    await page.goto(`${BASE_URL}/#/compras/settings`);
    await page.waitForLoadState('domcontentloaded');
    await page.getByTestId('compras-settings-imap-start').waitFor({ state: 'visible', timeout: 12_000 });
    await page.getByTestId('compras-settings-imap-start').click();
    await page
      .getByTestId('compras-settings-imap-email-input')
      .waitFor({ state: 'visible', timeout: 8000 });
    await page.waitForTimeout(1000);

    // ── BEAT 5 — Paso 3: fill creds → Probar → success → Guardar ─────────────
    await typeInto(
      page,
      page.getByTestId('compras-settings-imap-email-input'),
      DEMO_EMAIL,
      'beat5-email',
      'Paso 3: pega tu correo y la contraseña, prueba y guarda',
    );
    await typeInto(
      page,
      page.getByTestId('compras-settings-imap-password-input'),
      DEMO_APP_PASSWORD,
      'beat5-password',
      'Paso 3: pega tu correo y la contraseña, prueba y guarda',
    );
    await page.waitForTimeout(800);

    const testBtn = page.getByTestId('compras-settings-imap-test');
    await testBtn.scrollIntoViewIfNeeded();
    await record(testBtn, 'beat5-probar', 'Paso 3: pega tu correo y la contraseña, prueba y guarda');
    await testBtn.click();
    // Stub resolves success → green "Conexión exitosa" panel appears.
    const successPanel = page.getByTestId('compras-settings-imap-result-success');
    await successPanel.waitFor({ state: 'visible', timeout: 8000 });
    await record(
      successPanel,
      'beat5-conexion-exitosa',
      'Paso 3: pega tu correo y la contraseña, prueba y guarda',
    );
    await page.waitForTimeout(3500);

    const saveBtn = page.getByTestId('compras-settings-imap-save');
    await saveBtn.scrollIntoViewIfNeeded();
    await record(saveBtn, 'beat5-guardar', 'Paso 3: pega tu correo y la contraseña, prueba y guarda');
    await saveBtn.click();
    // Toast "IMAP conectado: ..." confirms secureSet stub resolved.
    const savedToast = page.getByText('IMAP conectado', { exact: false }).first();
    const toastVisible = await savedToast.isVisible({ timeout: 6000 }).catch(() => false);
    await record(
      toastVisible ? savedToast : page.getByTestId('compras-settings-imap-card'),
      'beat5-guardado',
      'Paso 3: pega tu correo y la contraseña, prueba y guarda',
    );
    await page.waitForTimeout(4000);

    // ── BEAT 6 — Back to Compras list (Email-source rows) ────────────────────
    await page.goto(`${BASE_URL}/#/compras`);
    await page.waitForLoadState('domcontentloaded');
    await page.getByTestId('compras-list').waitFor({ state: 'visible', timeout: 12_000 });
    await page
      .getByText('Distribuidora La Constancia', { exact: false })
      .first()
      .waitFor({ state: 'visible', timeout: 12_000 });
    await page.waitForTimeout(1500);
    await record(
      page.getByRole('heading', { name: 'Compras' }).first(),
      'beat6-list',
      'Tus compras entran solas; la app solo lee tu correo',
    );
    await page.waitForTimeout(3000);
    const emailBadge6 = page
      .getByTestId('compras-list')
      .getByText('Email', { exact: true })
      .first();
    const emailBadge6Visible = await emailBadge6.isVisible({ timeout: 3000 }).catch(() => false);
    await record(
      emailBadge6Visible ? emailBadge6 : page.getByTestId('compras-list'),
      'beat6-email-badge',
      'Tus compras entran solas; la app solo lee tu correo',
    );
    await page.waitForTimeout(7500);

    writeSidecar();
  } finally {
    try {
      writeSidecar();
    } catch {
      /* ignore */
    }

    let rawPath: string | null = null;
    try {
      rawPath = (await page.video()?.path()) ?? null;
    } catch {
      rawPath = null;
    }
    try {
      await context.close();
    } catch {
      /* ignore */
    }
    try {
      await browser.close();
    } catch {
      /* ignore */
    }

    try {
      mkdirSync(OUTPUT_DIR, { recursive: true });
      if (!rawPath) {
        const found = readdirSync(videoTmpDir).find((f) => f.endsWith('.webm'));
        if (found) rawPath = join(videoTmpDir, found);
      }
      if (rawPath) {
        const mp4Path = resolve(OUTPUT_DIR, VIDEO_NAME);
        const webmPath = mp4Path.replace(/\.mp4$/, '.webm');
        try {
          writeFileSync(webmPath, readFileSync(rawPath));
        } catch {
          /* ignore */
        }
        const ok = transcodeToMp4(webmPath, mp4Path);
        if (!ok) {
          // eslint-disable-next-line no-console
          console.warn('[demo-compras] transcode failed; raw webm at', webmPath);
        }
      } else {
        // eslint-disable-next-line no-console
        console.warn('[demo-compras] no video file found in', videoTmpDir);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[demo-compras] could not save video:', err);
    }
  }
});
