/**
 * Screen coverage sweep — every route in src/routes.tsx renders its screen.
 *
 * One test per route: seed the populated + finance state (company, customers,
 * products, invoices incl. a draft, compras), navigate in-app to the route and
 * assert
 *   - the URL stayed on the route (no silent redirect to /welcome or /home),
 *   - the screen's root test id, plus a found-state marker for detail/edit
 *     routes whose root id is shared with a "no encontrado" state,
 *   - no react-router error page ("Unexpected Application Error!") and no
 *     ErrorBoundary card ("Algo salió mal"),
 *   - no uncaught page error and no console.error.
 *
 * A second block drives the screens that no other spec asserts on: the
 * onboarding tour, a catalog detail, the carwash board/settings without an API
 * (the carwash/01 spec needs the .NET SDK), and the unknown-route fallback.
 *
 * Assertions use test ids and data, never logos, fonts or colours.
 */

import { test, expect, type Page } from '@playwright/test';
import {
  seedFinanceAppState,
  SAMPLE_COMPRAS,
  SAMPLE_CUSTOMERS,
  SAMPLE_INVOICES,
  SAMPLE_PRODUCTS,
  TEST_COMPANY,
} from '../../fixtures/seed-state';

test.describe.configure({ mode: 'parallel' });

interface Screen {
  route: string;
  /** Root test id of the screen. */
  testId: string;
  /** Test id that only exists in the screen's normal (found / unlocked) state. */
  marker?: string;
  /** Text that only exists when the seeded record was found. */
  text?: string;
  /** h1 (PageHeader) title when the screen has no root test id. */
  heading?: string;
}

const COMPLETED_INVOICE = SAMPLE_INVOICES.find((i) => i.status === 2)!;
const DRAFT_INVOICE = SAMPLE_INVOICES.find((i) => i.status === 0)!;
const CUSTOMER = SAMPLE_CUSTOMERS[0];
const PRODUCT = SAMPLE_PRODUCTS[0];
const COMPRA = SAMPLE_COMPRAS[0];
const CO = TEST_COMPANY.id;

const SCREENS: Screen[] = [
  // ── Public (no sidebar) ────────────────────────────────────────────────
  { route: '/welcome', testId: 'welcome', marker: 'guest-btn' },
  { route: '/onboarding', testId: 'onboarding', marker: 'onboarding-next-btn' },

  // ── Home + companies ───────────────────────────────────────────────────
  { route: '/home', testId: 'dashboard' },
  { route: '/companies', testId: 'company-list', marker: 'new-company-btn' },
  { route: '/companies/add', testId: 'create-company' },
  { route: `/companies/${CO}`, testId: 'company-detail', text: TEST_COMPANY.nit },
  { route: `/companies/${CO}/config`, testId: 'company-config' },
  { route: `/companies/${CO}/request-production`, testId: 'request-production', marker: 'production-requirements' },

  // ── Invoices ───────────────────────────────────────────────────────────
  { route: '/invoices', testId: 'invoice-list', text: COMPLETED_INVOICE.controlNumber },
  { route: '/invoices/add', testId: 'add-invoice' },
  { route: '/invoices/export', testId: 'invoice-export' },
  { route: '/invoices/libros-iva', testId: 'libros-iva' },
  { route: '/invoices/contingency', testId: 'contingency' },
  { route: `/invoices/${COMPLETED_INVOICE.id}`, testId: 'invoice-detail', text: COMPLETED_INVOICE.controlNumber },
  { route: `/invoices/${DRAFT_INVOICE.id}/edit`, testId: 'edit-invoice', marker: 'btn-update' },
  { route: `/invoices/${COMPLETED_INVOICE.id}/invalidate`, testId: 'invalidation', marker: 'invalidation-identifiers-summary' },

  // ── Customers ──────────────────────────────────────────────────────────
  { route: '/customers', testId: 'customer-list', marker: 'add-customer-btn' },
  { route: '/customers/add', testId: 'customer-form' },
  { route: `/customers/${CUSTOMER.id}`, testId: 'customer-detail', marker: 'edit-customer-btn' },
  { route: `/customers/${CUSTOMER.id}/edit`, testId: 'customer-form' },

  // ── Products ───────────────────────────────────────────────────────────
  { route: '/products', testId: 'product-list', marker: 'stock-adjustment-btn' },
  { route: '/products/add', testId: 'product-form' },
  { route: '/products/stock-adjustment', testId: 'stock-adjustment-page', marker: 'save-stock-btn' },
  { route: `/products/${PRODUCT.id}`, testId: 'product-detail', marker: 'edit-product-btn' },
  { route: `/products/${PRODUCT.id}/edit`, testId: 'product-form' },

  // ── Carwash + POS ──────────────────────────────────────────────────────
  { route: '/carwash', testId: 'carwash-board' },
  { route: '/pos', testId: 'pos-register', marker: 'pos-search-input' },
  { route: '/pos/tickets', testId: 'pos-ticket-list' },
  { route: '/pos/closing', testId: 'pos-closing' },
  { route: '/pos/consolidate', testId: 'pos-consolidate' },

  // ── Compras + cuentas ──────────────────────────────────────────────────
  { route: '/compras', testId: 'compras-list', text: COMPRA.emisorNombre },
  { route: '/compras/add', testId: 'add-compra' },
  { route: '/compras/settings', testId: 'compras-settings' },
  { route: '/compras/export', testId: 'compras-export' },
  { route: `/compras/${COMPRA.id}`, testId: 'compra-detail', text: COMPRA.numeroControl },
  { route: '/accounts', testId: 'cuentas.desktop' },

  // ── Settings ───────────────────────────────────────────────────────────
  { route: '/settings', testId: 'settings' },
  { route: '/settings/catalogs', testId: 'catalogs', text: 'CAT-012' },
  { route: '/settings/catalogs/CAT-012', testId: 'catalog-detail', marker: 'catalog-detail-sticky-toolbar' },
  { route: '/settings/sync-logs', testId: 'sync-logs' },
  { route: '/settings/sync', testId: 'sync-v2-screen' },
  { route: '/settings/profile', testId: 'profile' },
  { route: '/settings/account', testId: 'account-summary' },
  { route: '/settings/google-drive', testId: 'google-drive-export' },
  { route: '/settings/printer', testId: 'printer-settings' },
  { route: '/settings/carwash', testId: 'carwash-settings', marker: 'carwash-api-url' },
  { route: '/settings/categories', testId: 'product-categories' },
  { route: '/settings/users', testId: 'local-users-page' },
  { route: '/settings/audit', testId: 'audit-log-page' },
  { route: '/chat', testId: 'chat' },
  { route: '/settings/promo', testId: '', heading: 'Planes y Códigos Promocionales' },
  { route: '/settings/account/change-card', testId: 'change-payment-method' },
];

/** Uncaught exceptions and console.error calls raised while the screen renders. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Network failures (offline relay, blocked telemetry, 4xx from a stubbed-less
    // backend) are logged by the browser itself, not by the app's code.
    if (/^Failed to load resource/.test(text)) return;
    errors.push(`console.error: ${text}`);
  });
  return errors;
}

/** In-app hash navigation: page.goto would re-run the seed init script. */
async function navigate(page: Page, route: string): Promise<void> {
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, `#${route}`);
}

function routeUrl(route: string): RegExp {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`#${escaped}$`);
}

async function expectNoCrash(page: Page, errors: string[]): Promise<void> {
  await expect(page.getByText('Unexpected Application Error', { exact: false })).toHaveCount(0);
  await expect(page.getByText('Algo salió mal', { exact: true })).toHaveCount(0);
  // Let effects that run right after the first paint (data loads, sync status) settle.
  await page.waitForTimeout(400);
  expect(errors, `errors on ${page.url()}`).toEqual([]);
}

test.describe('Every route renders its screen', () => {
  for (const screen of SCREENS) {
    test(`${screen.route}`, async ({ page }) => {
      const errors = collectErrors(page);
      await seedFinanceAppState(page);
      await navigate(page, screen.route);

      await expect(page).toHaveURL(routeUrl(screen.route), { timeout: 10_000 });
      if (screen.testId) {
        await expect(page.getByTestId(screen.testId).first()).toBeVisible({ timeout: 15_000 });
      }
      if (screen.heading) {
        await expect(page.getByRole('heading', { level: 1, name: screen.heading })).toBeVisible({ timeout: 15_000 });
      }
      if (screen.marker) {
        await expect(page.getByTestId(screen.marker).first()).toBeVisible({ timeout: 10_000 });
      }
      if (screen.text) {
        await expect(page.getByText(screen.text, { exact: false }).first()).toBeVisible({ timeout: 10_000 });
      }
      await expectNoCrash(page, errors);
    });
  }

  test('every route in src/routes.tsx is listed in this sweep', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(here, '..', '..', '..', 'src', 'routes.tsx'), 'utf-8');
    const declared = [...source.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]).filter((p) => p !== '*');
    const toPattern = (p: string) => new RegExp(`^${p.replace(/:[a-zA-Z]+/g, '[^/]+')}$`);
    const missing = declared.filter((p) => !SCREENS.some((s) => toPattern(p).test(s.route)));
    expect(missing, 'routes without a screen-sweep entry').toEqual([]);
  });
});

test.describe('Screens with no other coverage', () => {
  test('onboarding tour: next through every slide, finishing lands on /home', async ({ page }) => {
    const errors = collectErrors(page);
    await seedFinanceAppState(page);
    await navigate(page, '/onboarding');
    await expect(page.getByTestId('onboarding')).toBeVisible();

    const next = page.getByTestId('onboarding-next-btn');
    // The tour has a handful of slides; the last "next" finishes it and unmounts
    // the page, so stop as soon as the button is gone instead of waiting on it.
    let clicks = 0;
    while (clicks < 10 && (await next.isVisible())) {
      await next.click({ timeout: 5_000 }).catch(() => undefined);
      clicks++;
      await page.waitForTimeout(150);
    }
    expect(clicks, 'the tour has more than one slide').toBeGreaterThan(1);
    await expect(page).toHaveURL(/#\/home$/);
    await expect(page.getByTestId('dashboard')).toBeVisible();
    await expectNoCrash(page, errors);
  });

  test('onboarding skip goes to /home when a company exists', async ({ page }) => {
    const errors = collectErrors(page);
    await seedFinanceAppState(page);
    await navigate(page, '/onboarding');
    await page.getByTestId('onboarding-skip-btn').click();
    await expect(page).toHaveURL(/#\/home$/);
    await expect(page.getByTestId('dashboard')).toBeVisible();
    await expectNoCrash(page, errors);
  });

  test('catalog list → Departamento detail → filter → back', async ({ page }) => {
    const errors = collectErrors(page);
    await seedFinanceAppState(page);
    await navigate(page, '/settings/catalogs');
    await expect(page.getByTestId('catalogs')).toBeVisible();

    await page.getByRole('button', { name: /CAT-012/ }).click();
    await expect(page).toHaveURL(/#\/settings\/catalogs\/CAT-012$/);
    const detail = page.getByTestId('catalog-detail');
    await expect(detail.getByRole('heading', { level: 1, name: 'Departamento' })).toBeVisible();
    await expect(detail.getByText('Catálogo no encontrado')).toHaveCount(0);
    await expect(detail.getByText('Ahuachapán')).toBeVisible();

    await page.getByTestId('catalog-detail-sticky-toolbar').locator('input').fill('Santa Ana');
    await expect(detail.getByText('Santa Ana')).toBeVisible();
    await expect(detail.getByText('Ahuachapán')).toHaveCount(0);

    await page.getByRole('button', { name: 'Volver' }).click();
    await expect(page).toHaveURL(/#\/settings\/catalogs$/);
    await expectNoCrash(page, errors);
  });

  test('unknown catalog id shows "Catálogo no encontrado"', async ({ page }) => {
    await seedFinanceAppState(page);
    await navigate(page, '/settings/catalogs/CAT-DOES-NOT-EXIST');
    await expect(page.getByTestId('catalog-detail')).toContainText('Catálogo no encontrado');
  });

  test('carwash board without an API: sidebar entry, not-connected state, link to settings', async ({ page }) => {
    const errors = collectErrors(page);
    await seedFinanceAppState(page);
    await page.getByTestId('sidebar-carwash').click();
    await expect(page).toHaveURL(/#\/carwash$/);
    const board = page.getByTestId('carwash-board');
    await expect(board).toBeVisible();
    await expect(board.getByRole('heading', { level: 1, name: 'Lavado' })).toBeVisible();
    await expect(board.getByText('Car Spa no está conectado')).toBeVisible();

    await page.getByTestId('carwash-go-settings').click();
    await expect(page).toHaveURL(/#\/settings\/carwash$/);
    await expect(page.getByTestId('carwash-settings')).toBeVisible();
    await expectNoCrash(page, errors);
  });

  test('carwash settings: API URL and register code are saved and survive navigation', async ({ page }) => {
    const errors = collectErrors(page);
    await seedFinanceAppState(page);
    await navigate(page, '/settings/carwash');
    await expect(page.getByTestId('carwash-settings')).toBeVisible();
    await expect(page.getByTestId('carwash-session')).toHaveCount(0); // not signed in

    await page.getByTestId('carwash-api-url').fill('http://127.0.0.1:59999');
    await page.getByTestId('carwash-register-code').fill('C7');
    await page.getByTestId('carwash-save').click();
    await expect(page.getByText('Configuración de Car Spa guardada')).toBeVisible();

    await navigate(page, '/home');
    await expect(page.getByTestId('dashboard')).toBeVisible();
    await navigate(page, '/settings/carwash');
    await expect(page.getByTestId('carwash-api-url')).toHaveValue('http://127.0.0.1:59999');
    await expect(page.getByTestId('carwash-register-code')).toHaveValue('C7');
    await expectNoCrash(page, errors);
  });

  test('unknown route falls back to /home', async ({ page }) => {
    const errors = collectErrors(page);
    await seedFinanceAppState(page);
    await navigate(page, '/this-route-does-not-exist');
    await expect(page).toHaveURL(/#\/home$/);
    await expect(page.getByTestId('dashboard')).toBeVisible();
    await expectNoCrash(page, errors);
  });
});
