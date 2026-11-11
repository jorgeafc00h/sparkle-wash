/**
 * Marketing capture spec — Desktop App "Productos" feature spine, focused on
 * STOCK + LOW-STOCK ALERTS (plus basic manage).
 *
 * Records ONE continuous 1920x1080 video walking the real local products flow:
 *   1. Nav to Productos → product list ("Silla de Oficina" shows "Stock bajo")
 *   2. Spotlight the Stock column badges (En stock / Stock bajo)
 *   3. Agregar Producto → form → fill Nombre, Precio, then the inventory section
 *      (Cantidad en Stock + Umbral Stock Bajo, paced) → Crear Producto
 *   4. Open a product detail → Inventario card "Stock bajo" badge
 *   5. Ajuste de Inventario → step "Laptop Dell Inspiron" down past zero →
 *      Guardar Cambios
 *   6. Back to the list → "Sin stock" badge on that product
 *
 * Alongside the video it writes a coordinate sidecar timeline JSON so the
 * editor can overlay Spanish captions on the exact on-screen target boxes.
 *
 * Captured as a real Chromium page (web mode, NOT Electron) against the running
 * Vite dev server. The standard `page` fixture records VP8/WebM; we transcode to
 * H.264 MP4 after the context closes.
 *
 * Run:
 *   npx playwright test --config playwright.demo.config.ts demo-productos.spec.ts --workers=1
 */

import { test, chromium, type Page, type Locator } from '@playwright/test';
import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  statSync,
  mkdtempSync,
  readdirSync,
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
  '/Users/jorgeflores/github/FACTURAS SIMPLES/App.ReactNative/Marketing/social-meta-2026/onboarding-videos/source-footage/productos-desktop-hd';
const VIDEO_NAME = 'productos-fullflow.mp4';
const BASE_URL = 'http://127.0.0.1:5173';

// ---------------------------------------------------------------------------
// Seed builders — mirror seedPopulatedAppState's redux-persist localStorage so
// we can inject it into a context we own (manual recordVideo lifecycle).
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
    'persist:compras': enc({
      compras: [],
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

async function record(locator: Locator, label: string, caption: string): Promise<void> {
  let box: { x: number; y: number; width: number; height: number } | null = null;
  try {
    box = await locator.boundingBox({ timeout: 2000 });
  } catch {
    box = null;
  }
  // Always push an event so the editor has a caption + timestamp per beat.
  // Fall back to a centered box when the live geometry is unavailable.
  const fb = { x: 660, y: 480, width: 600, height: 120 };
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
  writeFileSync(
    resolve(OUTPUT_DIR, 'productos-fullflow.timeline.json'),
    JSON.stringify(sidecar, null, 2),
    'utf-8',
  );
  writeFileSync(
    resolve(__dir, 'last-run-productos-timeline.json'),
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
  await page.waitForTimeout(500);
}

// Best-effort transcode of the Playwright VP8/WebM recording to H.264 MP4 so
// the device-framing pipeline gets a standard container.
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
      { stdio: 'ignore', timeout: 180_000 },
    );
    if (res.status !== 0) return false;
    return statSync(mp4Path).size > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test('productos full flow — stock + low-stock alerts — beats 1 to 6', async () => {
  test.setTimeout(180_000);

  // We own the browser/context lifecycle so the WebM finalizes cleanly on
  // context.close() — the standard `page` fixture tears down too eagerly if the
  // body throws, truncating the recording (no duration metadata).
  const videoTmpDir = mkdtempSync(join(tmpdir(), 'productos-demo-'));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    recordVideo: { dir: videoTmpDir, size: { width: 1920, height: 1080 } },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);

  try {
    // Seed populated state (5 products incl. "Silla de Oficina" stock 5 / umbral 5
    // → "Stock bajo" badge, and "Laptop Dell Inspiron" stock 10) BEFORE load.
    // Inject redux-persist localStorage via addInitScript, then navigate.
    const entries = buildSeedEntries();
    await page.addInitScript((data) => {
      for (const [k, v] of Object.entries(data as Record<string, string>)) {
        window.localStorage.setItem(k, v);
      }
    }, entries);
    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState('domcontentloaded');
    await page
      .getByTestId('sidebar-productos')
      .waitFor({ state: 'visible', timeout: 20_000 });
    startMs = Date.now();
    await page.waitForTimeout(1200); // let the shell settle on camera

    // ── BEAT 1 — Navigate to Productos → product list ────────────────────────
    const navItem = page.getByTestId('sidebar-productos');
    await record(navItem, 'beat1-nav', 'Tu catálogo de productos y servicios');
    await navItem.click();
    await page.getByTestId('product-list').waitFor({ state: 'visible', timeout: 12_000 });
    await page.getByText('Silla de Oficina').waitFor({ state: 'visible', timeout: 12_000 });
    await page.waitForTimeout(1200);
    // Hold on the landed list with the heading framed.
    await record(
      page.getByRole('heading', { name: 'Productos' }).first(),
      'beat1-list',
      'Tu catálogo de productos y servicios',
    );
    await page.waitForTimeout(2000);
    // Spotlight the low-stock row.
    const sillaRow = page.locator('tr', { hasText: 'Silla de Oficina' });
    await record(sillaRow, 'beat1-low-stock-row', 'Tu catálogo de productos y servicios');
    await page.waitForTimeout(7500);

    // ── BEAT 2 — Stock column badges (En stock / Stock bajo) ─────────────────
    const stockBajoBadge = page
      .locator('tr', { hasText: 'Silla de Oficina' })
      .getByText('Stock bajo', { exact: true });
    await stockBajoBadge.scrollIntoViewIfNeeded();
    await record(stockBajoBadge, 'beat2-stock-bajo-badge', 'Alertas de stock bajo, visibles al instante');
    await page.waitForTimeout(3500);
    const enStockBadge = page
      .locator('tr', { hasText: 'Laptop Dell Inspiron' })
      .getByText('En stock', { exact: true });
    const enStockVisible = await enStockBadge.isVisible({ timeout: 2000 }).catch(() => false);
    await record(
      enStockVisible ? enStockBadge : stockBajoBadge,
      'beat2-en-stock-badge',
      'Alertas de stock bajo, visibles al instante',
    );
    await page.waitForTimeout(7000);

    // ── BEAT 3 — Agregar Producto → form → activate inventory control ────────
    const addBtn = page.getByTestId('add-product-btn');
    await record(addBtn, 'beat3-add-btn', 'Crea un producto y activa el control de inventario');
    await addBtn.click();
    await page.getByTestId('product-form').waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForTimeout(900);

    await typeInto(
      page,
      page.getByLabel('Nombre del Producto', { exact: false }).first(),
      'Monitor LED 24"',
      'beat3-nombre',
      'Crea un producto y activa el control de inventario',
    );
    await typeInto(
      page,
      page.getByLabel('Precio Unitario', { exact: false }).first(),
      '180.00',
      'beat3-precio',
      'Crea un producto y activa el control de inventario',
    );

    // Inventory section — the low-stock control is the focal point.
    await typeInto(
      page,
      page.getByLabel('Cantidad en Stock', { exact: false }).first(),
      '8',
      'beat3-cantidad-stock',
      'Crea un producto y activa el control de inventario',
    );
    await typeInto(
      page,
      page.getByLabel('Umbral Stock Bajo', { exact: false }).first(),
      '10',
      'beat3-umbral',
      'Crea un producto y activa el control de inventario',
    );
    await page.waitForTimeout(1200);

    const submitBtn = page.getByTestId('submit-product-btn');
    await submitBtn.scrollIntoViewIfNeeded();
    await record(submitBtn, 'beat3-submit', 'Crea un producto y activa el control de inventario');
    await submitBtn.click();
    await page.getByTestId('product-list').waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForTimeout(2200);

    // ── BEAT 4 — Open a product detail → Inventario card "Stock bajo" ────────
    const sillaLink = page.getByText('Silla de Oficina').first();
    await sillaLink.scrollIntoViewIfNeeded();
    await record(sillaLink, 'beat4-open-detail', 'Define un umbral mínimo por producto');
    await sillaLink.click();
    await page.getByTestId('product-detail').waitFor({ state: 'visible', timeout: 8000 });
    await page.getByRole('heading', { name: 'Inventario', exact: true }).waitFor({ timeout: 6000 });
    await page.waitForTimeout(1400);
    // Spotlight the umbral + low-stock badge in the Inventario card.
    const umbralRow = page.getByText('Umbral Stock Bajo', { exact: false }).first();
    const umbralVisible = await umbralRow.isVisible({ timeout: 2000 }).catch(() => false);
    await record(
      umbralVisible ? umbralRow : page.getByTestId('product-detail'),
      'beat4-umbral-row',
      'Define un umbral mínimo por producto',
    );
    await page.waitForTimeout(2200);
    const detailBadge = page.getByTestId('product-detail').getByText('Stock bajo', { exact: true });
    const detailBadgeVisible = await detailBadge.isVisible({ timeout: 2000 }).catch(() => false);
    await record(
      detailBadgeVisible ? detailBadge : page.getByTestId('product-detail'),
      'beat4-detail-badge',
      'Define un umbral mínimo por producto',
    );
    await page.waitForTimeout(8000);

    // ── BEAT 5 — Ajuste de Inventario → step Laptop down past zero → guardar ─
    await page.getByRole('button', { name: 'Volver' }).first().click();
    await page.getByTestId('product-list').waitFor({ state: 'visible', timeout: 8000 });
    await page.waitForTimeout(900);

    const stockBtn = page.getByTestId('stock-adjustment-btn');
    await record(stockBtn, 'beat5-stock-btn', 'Ajusta tu inventario con un motivo');
    await stockBtn.click();
    await page.getByTestId('stock-adjustment-page').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByText('Laptop Dell Inspiron').first().waitFor({ state: 'visible', timeout: 8000 });
    await page.waitForTimeout(1400);

    // Drop Laptop Dell Inspiron (stock 10) by -10 so the new stock hits zero.
    const adjustInput = page.getByLabel('Ajuste para Laptop Dell Inspiron');
    await adjustInput.scrollIntoViewIfNeeded();
    await record(adjustInput, 'beat5-adjust-input', 'Ajusta tu inventario con un motivo');
    await adjustInput.click();
    await adjustInput.fill('');
    // Type the negative adjustment at a visible pace.
    await adjustInput.pressSequentially('-10', { delay: 110 });
    await page.waitForTimeout(1200);

    // Spotlight the Razón (motivo) select for the same row.
    const reasonSelect = page.getByLabel('Razón para Laptop Dell Inspiron');
    const reasonVisible = await reasonSelect.isVisible({ timeout: 2000 }).catch(() => false);
    if (reasonVisible) {
      await record(reasonSelect, 'beat5-reason', 'Ajusta tu inventario con un motivo');
      await reasonSelect.selectOption('Merma/Pérdida');
      await page.waitForTimeout(1100);
    }
    await page.waitForTimeout(1600);

    const saveBtn = page.getByTestId('save-stock-btn');
    await saveBtn.scrollIntoViewIfNeeded();
    await record(saveBtn, 'beat5-save', 'Ajusta tu inventario con un motivo');
    await saveBtn.click();
    const savedToast = page.getByText('Se actualizaron 1 producto', { exact: false });
    const toastVisible = await savedToast.isVisible({ timeout: 6000 }).catch(() => false);
    await record(
      toastVisible ? savedToast : page.getByTestId('stock-adjustment-page'),
      'beat5-saved-toast',
      'Ajusta tu inventario con un motivo',
    );
    await page.waitForTimeout(3500);

    // ── BEAT 6 — Back to the list → "Sin stock" badge on that product ────────
    await page.getByRole('button', { name: 'Volver' }).first().click();
    await page.getByTestId('product-list').waitFor({ state: 'visible', timeout: 8000 });
    await page.waitForTimeout(1200);
    const laptopRow = page.locator('tr', { hasText: 'Laptop Dell Inspiron' });
    await laptopRow.scrollIntoViewIfNeeded();
    const sinStockBadge = laptopRow.getByText('Sin stock', { exact: true });
    const sinStockVisible = await sinStockBadge.isVisible({ timeout: 5000 }).catch(() => false);
    await record(
      sinStockVisible ? sinStockBadge : laptopRow,
      'beat6-sin-stock',
      'Sin stock, marcado automáticamente',
    );
    await page.waitForTimeout(9000);

    writeSidecar();
  } finally {
    try {
      writeSidecar();
    } catch {
      /* ignore */
    }

    // Grab the video handle BEFORE closing, then close context+browser to
    // finalize the WebM, then transcode to H.264 MP4.
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
      // Fall back to scanning the tmp dir if the handle path was unavailable.
      if (!rawPath) {
        const found = readdirSync(videoTmpDir).find((f) => f.endsWith('.webm'));
        if (found) rawPath = join(videoTmpDir, found);
      }
      if (rawPath) {
        const mp4Path = resolve(OUTPUT_DIR, VIDEO_NAME);
        const webmPath = mp4Path.replace(/\.mp4$/, '.webm');
        // Land the raw recording alongside the deliverable.
        try {
          writeFileSync(webmPath, readFileSync(rawPath));
        } catch {
          /* ignore */
        }
        const ok = transcodeToMp4(webmPath, mp4Path);
        if (!ok) {
          // eslint-disable-next-line no-console
          console.warn('[demo-productos] transcode failed; raw webm at', webmPath);
        }
      } else {
        // eslint-disable-next-line no-console
        console.warn('[demo-productos] no video file found in', videoTmpDir);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[demo-productos] could not save video:', err);
    }
  }
});
