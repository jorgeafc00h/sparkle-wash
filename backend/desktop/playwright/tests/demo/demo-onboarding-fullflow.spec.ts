/**
 * Marketing capture spec — Desktop App onboarding spine (beats 1→8).
 *
 * Records ONE continuous 1920x1080 video walking the real first-run flow:
 *   1. Bienvenida (Welcome auth gate → "Continuar sin iniciar sesión")
 *   2. Múltiples Empresas (onboarding intro slide)
 *   3. Proceso de Pruebas (onboarding intro slides) → "Comenzar"
 *   4. Registro Fiscal — CreateCompany Paso 1 "Información Básica"
 *   5. Datos Generales — Paso 2 "Contacto y Ubicación"
 *   6. Info de Emisor — Paso 3 "Actividad Económica"
 *   7. Certificado — Paso 4 "Certificado Digital" → "Crear Empresa"
 *   8. Comenzar → company detail → (bonus) Solicitar Autorización a Producción
 *
 * Alongside the video it writes a coordinate sidecar timeline JSON so the
 * editor can overlay Spanish captions on the exact on-screen target boxes.
 *
 * Run: npx playwright test --config playwright.demo.config.ts
 */

import { test, type Page, type Locator } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// First-run seed (no company, onboarding NOT completed) — guest mode is set by
// the Welcome page click, so we leave auth empty and seed ONLY the catalogs the
// 4-step wizard actually reads, plus an empty app/companies state so the store
// rehydrates cleanly. The CreateCompany wizard needs CAT-019 (actividades),
// CAT-009 (tipo establecimiento), CAT-012 (departamentos), CAT-013 (municipios).
// ---------------------------------------------------------------------------

const __dir = dirname(fileURLToPath(import.meta.url));
const CATALOGS_PATH = resolve(__dir, '..', '..', '..', 'src', 'data', 'catalogs.json');
const OUTPUT_DIR =
  '/Users/jorgeflores/github/FACTURAS SIMPLES/App.ReactNative/Marketing/social-meta-2026/onboarding-videos/source-footage/desktop-app-hd';

const WIZARD_CATALOG_IDS = new Set(['CAT-009', 'CAT-012', 'CAT-013', 'CAT-019']);

function loadWizardCatalogs(): Array<Record<string, unknown>> {
  const raw = JSON.parse(readFileSync(CATALOGS_PATH, 'utf-8'));
  const all: Array<Record<string, unknown>> = Array.isArray(raw) ? raw : raw.catalogs ?? [];
  return all.filter((c) => WIZARD_CATALOG_IDS.has(c.id as string));
}

function toReduxPersistFormat(state: Record<string, unknown>): string {
  const doubleEncoded: Record<string, string> = {};
  for (const [k, v] of Object.entries(state)) doubleEncoded[k] = JSON.stringify(v);
  return JSON.stringify(doubleEncoded);
}

function buildFirstRunEntries(): Record<string, string> {
  const persist = { version: -1, rehydrated: true };
  return {
    'persist:auth': toReduxPersistFormat({
      user: null,
      isAuthenticated: false,
      isGuestMode: false,
      hasCompletedOnboarding: false,
      loading: false,
      error: null,
      token: null,
      refreshToken: null,
      selectedCompanyId: null,
      _persist: persist,
    }),
    'persist:app': toReduxPersistFormat({
      isInitialized: true,
      isOnline: true,
      currentTheme: 'light',
      language: 'es',
      environment: 'development',
      syncStatus: 'idle',
      notifications: [],
      _persist: persist,
    }),
    'persist:companies': toReduxPersistFormat({
      companies: [],
      selectedCompanyId: null,
      currentCompany: null,
      loading: false,
      error: null,
      _persist: persist,
    }),
    'persist:catalogs': toReduxPersistFormat({
      catalogs: loadWizardCatalogs(),
      syncInfo: {},
      lastFullSync: new Date().toISOString(),
      filters: {},
      loading: false,
      error: null,
      searchTerm: '',
      _persist: persist,
    }),
    'persist:subscription': toReduxPersistFormat({
      tier: 'pro',
      isInitialized: true,
      loading: false,
      error: null,
      availableProducts: [],
      activeSubscription: null,
      purchaseInProgress: false,
      _persist: persist,
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

const DEMO = {
  nombreLegal: 'Empresa Demo DTE S.A. de C.V.',
  nombreComercial: 'Empresa Demo DTE',
  nit: '0614-010190-101-5',
  nrc: '123456-7',
  correo: 'demo@facturasimples.test',
  telefono: '2200-0000',
  direccion: 'Col. Escalón, San Salvador',
  certPassword: 'demo-pass',
};

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
  await locator.pressSequentially(text, { delay: 30 });
  await page.waitForTimeout(350);
}

async function clickButton(
  page: Page,
  locator: Locator,
  label: string,
  caption: string,
  pause = 800,
): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await record(locator, label, caption);
  await locator.click();
  await page.waitForTimeout(pause);
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

function writeSidecar(): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const sidecar = { videoW: 1920, videoH: 1080, events };
  writeFileSync(
    resolve(OUTPUT_DIR, 'desktop-app-onboarding-fullflow.timeline.json'),
    JSON.stringify(sidecar, null, 2),
    'utf-8',
  );
  writeFileSync(
    resolve(__dir, 'last-run-timeline.json'),
    JSON.stringify(sidecar, null, 2),
    'utf-8',
  );
}

test('desktop onboarding full flow — beats 1 to 8', async ({ page }) => {
  test.setTimeout(150_000);

 try {
  // Seed first-run state BEFORE any page script runs.
  const entries = buildFirstRunEntries();
  await page.addInitScript((data) => {
    for (const [k, v] of Object.entries(data as Record<string, string>)) {
      window.localStorage.setItem(k, v);
    }
  }, entries);

  // ── BEAT 1 — Bienvenida ──────────────────────────────────────────────────
  await page.goto('/#/welcome');
  await page.waitForLoadState('domcontentloaded');
  startMs = Date.now();
  await page.getByTestId('welcome').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(1200); // let the hero settle on camera

  const guestBtn = page.getByTestId('guest-btn');
  await record(guestBtn, 'beat1-welcome', 'Empieza gratis, sin crear cuenta');
  await clickButton(page, guestBtn, 'beat1-guest', 'Toca Continuar sin iniciar sesión', 1000);

  // ── BEATS 2 & 3 — Onboarding intro slides (5 total) → Comenzar ───────────
  await page.getByTestId('onboarding').waitFor({ state: 'visible', timeout: 10_000 });
  const onboardingCaptions = [
    'Facturación electrónica sin complicaciones',
    'Gestiona múltiples empresas en un solo lugar',
    'Importa tus compras (DTE) desde Gmail',
    'Libros de IVA y exportación en un clic',
    'Versión gratis disponible — empieza ya',
  ];
  const nextBtn = page.getByTestId('onboarding-next-btn');
  for (let i = 0; i < onboardingCaptions.length; i++) {
    await page.waitForTimeout(750); // hold the slide on screen
    const isLast = i === onboardingCaptions.length - 1;
    await record(nextBtn, `beat${i < 2 ? 2 : 3}-onboarding-slide-${i + 1}`, onboardingCaptions[i]);
    await nextBtn.click();
    await page.waitForTimeout(isLast ? 1000 : 450);
  }

  // ── BEAT 4 — Registro Fiscal (Paso 1: Información Básica) ─────────────────
  await page.getByTestId('create-company').waitFor({ state: 'visible', timeout: 12_000 });
  await page.waitForTimeout(900);

  await typeInto(
    page,
    page.getByLabel('Nombre Legal', { exact: false }),
    DEMO.nombreLegal,
    'beat4-nombre-legal',
    'Información básica de la empresa',
  );
  await typeInto(
    page,
    page.getByLabel('Nombre Comercial', { exact: false }),
    DEMO.nombreComercial,
    'beat4-nombre-comercial',
    'Nombre comercial del emisor',
  );
  await typeInto(
    page,
    page.getByLabel('NIT', { exact: false }),
    DEMO.nit,
    'beat4-nit',
    'NIT de Hacienda',
  );
  await typeInto(
    page,
    page.getByLabel('NRC', { exact: false }),
    DEMO.nrc,
    'beat4-nrc',
    'Número de registro (NRC)',
  );
  await clickButton(
    page,
    page.getByRole('button', { name: /Siguiente/i }),
    'beat4-siguiente',
    'Continúa al siguiente paso',
  );

  // ── BEAT 5 — Datos Generales (Paso 2: Contacto y Ubicación) ──────────────
  await page.getByRole('heading', { name: 'Contacto y Ubicación' }).waitFor({ timeout: 8000 });
  await page.waitForTimeout(700);

  await typeInto(
    page,
    page.getByLabel('Correo Electrónico', { exact: false }),
    DEMO.correo,
    'beat5-correo',
    'Datos de contacto',
  );
  await typeInto(
    page,
    page.getByLabel('Teléfono', { exact: false }),
    DEMO.telefono,
    'beat5-telefono',
    'Teléfono de la empresa',
  );
  await typeInto(
    page,
    page.getByLabel('Dirección', { exact: false }),
    DEMO.direccion,
    'beat5-direccion',
    'Dirección del emisor',
  );

  // Departamento + Municipio (native selects)
  const deptSelect = page.locator('#departamento');
  await deptSelect.scrollIntoViewIfNeeded();
  await record(deptSelect, 'beat5-departamento', 'Selecciona departamento');
  await deptSelect.selectOption('06'); // San Salvador
  await page.waitForTimeout(700);

  const muniSelect = page.locator('#municipio');
  await record(muniSelect, 'beat5-municipio', 'Selecciona municipio');
  // Pick the first real municipio option for the selected department.
  const muniValues = await muniSelect.locator('option').evaluateAll((opts) =>
    opts
      .map((o) => (o as HTMLOptionElement).value)
      .filter((v) => v && v.length > 0),
  );
  if (muniValues.length > 0) {
    await muniSelect.selectOption(muniValues[0]);
    await page.waitForTimeout(600);
  }

  await clickButton(
    page,
    page.getByRole('button', { name: /Siguiente/i }),
    'beat5-siguiente',
    'Continúa a actividad económica',
  );

  // ── BEAT 6 — Info de Emisor (Paso 3: Actividad Económica) ────────────────
  await page.getByRole('heading', { name: 'Actividad Económica' }).waitFor({ timeout: 8000 });
  await page.waitForTimeout(700);

  // Open the Actividad Económica catalog picker (button shows its placeholder).
  const actividadTrigger = page
    .getByRole('button', { name: 'Seleccione una actividad económica' })
    .first();
  await actividadTrigger.scrollIntoViewIfNeeded();
  await record(actividadTrigger, 'beat6-actividad-open', 'Actividad económica');
  await actividadTrigger.click();
  await page.waitForTimeout(700);

  // Search + pick first result in the modal.
  const search = page.getByPlaceholder('Buscar por código o descripción…');
  await search.waitFor({ state: 'visible', timeout: 5000 });
  await search.pressSequentially('comercio', { delay: 35 });
  await page.waitForTimeout(700);
  const firstOption = page.locator('ul.divide-y li button').first();
  await record(firstOption, 'beat6-actividad-pick', 'Elige tu actividad económica');
  await firstOption.click();
  await page.waitForTimeout(700);

  // Tipo de Establecimiento picker (leave MH codes M001/P001 prefilled in submit).
  const estabTrigger = page
    .getByRole('button', { name: 'Seleccione tipo de establecimiento' })
    .first();
  await estabTrigger.scrollIntoViewIfNeeded();
  await record(estabTrigger, 'beat6-establecimiento-open', 'Tipo de establecimiento');
  await estabTrigger.click();
  await page.waitForTimeout(600);
  const estabSearch = page.getByPlaceholder('Buscar por código o descripción…');
  await estabSearch.waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(400);
  const firstEstab = page.locator('ul.divide-y li button').first();
  await record(firstEstab, 'beat6-establecimiento-pick', 'Casa matriz o sucursal');
  await firstEstab.click();
  await page.waitForTimeout(700);

  // IMPORTANT: the step-3 "Siguiente" button morphs into the "Crear Empresa"
  // submit button the instant React advances to step 4. A real mouse click's
  // mouseup then lands on the submit button and creates the company, skipping
  // the certificate step entirely. dispatchEvent fires a single synthetic
  // click with no mousedown/mouseup race, so step 4 renders reliably.
  const beat6Siguiente = page.getByRole('button', { name: 'Siguiente' });
  await beat6Siguiente.scrollIntoViewIfNeeded();
  await record(beat6Siguiente, 'beat6-siguiente', 'Continúa al certificado');
  await beat6Siguiente.dispatchEvent('click');
  await page.waitForTimeout(900);

  // ── BEAT 7 — Certificado Digital (Paso 4) → Crear Empresa ────────────────
  // Wait for the actual step-4 form (password input) — not the heading text,
  // which also appears on the company-detail page.
  const certPassword = page.locator('input[type="password"]').first();
  await certPassword.waitFor({ state: 'visible', timeout: 8000 });
  await page.waitForTimeout(800);

  const certLabel = page.getByText('Archivo de Certificado', { exact: false });
  await record(certLabel, 'beat7-cert-file', 'Carga tu certificado de Hacienda');
  await page.waitForTimeout(900); // hold on the file field (skip real upload)

  await typeInto(
    page,
    certPassword,
    DEMO.certPassword,
    'beat7-cert-password',
    'Contraseña del certificado (privada)',
  );

  // Final submit — the "Crear Empresa" button is the only one now; a real click
  // is safe here because it does not morph into anything else.
  const crearBtn = page.getByRole('button', { name: 'Crear Empresa' });
  await crearBtn.scrollIntoViewIfNeeded();
  await record(crearBtn, 'beat7-crear', 'Crea tu empresa');
  await crearBtn.dispatchEvent('click');
  await page.waitForTimeout(1500);

  // ── BEAT 8 — Company detail → (bonus) Request Production Access ───────────
  await page.getByTestId('company-detail').waitFor({ state: 'visible', timeout: 12_000 }).catch(() => {});
  await page.waitForTimeout(1400);
  await record(page.locator('body'), 'beat8-company-detail', 'Tu empresa está lista');

  // Try to surface "Solicitar Autorización a Producción" if present on detail.
  const prodLink = page.getByTestId('request-production-btn').first();
  const prodLinkVisible = await prodLink.isVisible({ timeout: 2500 }).catch(() => false);
  if (prodLinkVisible) {
    await clickButton(page, prodLink, 'beat8-request-production-link', 'Solicita autorización a producción', 1200);
  } else {
    // Navigate directly via hash (route is always addressable).
    await page.evaluate(() => {
      const m = location.hash.match(/#\/companies\/([^/]+)/);
      const id = m ? m[1] : '1';
      location.hash = `#/companies/${id}/request-production`;
    });
    await page.waitForTimeout(1200);
  }

  const prodPage = page.getByTestId('request-production');
  const prodVisible = await prodPage.isVisible({ timeout: 6000 }).catch(() => false);
  if (prodVisible) {
    await record(prodPage, 'beat8-production-access', 'Solicita autorización a producción');
    await page.waitForTimeout(1600);
  }

  // ── Write the sidecar timeline JSON ──────────────────────────────────────
  writeSidecar();
 } finally {
    // Always persist whatever timeline we captured, even on a late-beat failure,
    // so the recorded video still has a usable coordinate sidecar.
    try {
      writeSidecar();
    } catch {
      /* ignore */
    }
  }
});
