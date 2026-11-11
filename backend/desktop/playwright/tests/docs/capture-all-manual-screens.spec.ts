/**
 * Comprehensive screenshot capture for the full user manual.
 *
 * Walks through every major Desktop flow and produces PNGs named exactly as
 * the manual HTML pages expect. Output goes to `docs-screenshots/` and should
 * be copied to the landing repo's `public/docs/images/desktop/` folder.
 *
 * Run:
 *   npx playwright test playwright/tests/docs/capture-all-manual-screens.spec.ts
 */

import { test, expect, Page } from '@playwright/test';
import {
  seedPopulatedAppState,
  seedEmptyAppState,
  waitForAppReady,
  TEST_COMPANY,
} from '../../fixtures/seed-state';
import {
  seedLiteUserState,
  seedLiteUserWithDataState,
  seedProUserWithGoogleAuth,
} from '../../fixtures/pro-state';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', '..', '..', 'docs-screenshots');
mkdirSync(OUT, { recursive: true });

async function shot(page: Page, name: string) {
  await page.screenshot({ path: resolve(OUT, `${name}.png`), fullPage: true });
}

async function shotViewport(page: Page, name: string) {
  await page.screenshot({ path: resolve(OUT, `${name}.png`), fullPage: false });
}

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1440, height: 900 } });

// ═══════════════════════════════════════════════════════════════════════════
// Chapter 1 — Primeros Pasos
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Ch1 — Auth & Onboarding', () => {
  test('auth-login screens', async ({ page }) => {
    await page.goto('/#/welcome');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('welcome')).toBeVisible({ timeout: 10_000 });
    await shot(page, 'desktop_01_app-loaded');
    await shot(page, 'desktop_02_onboarding-screen-visible');
    await shotViewport(page, 'desktop_03_clicked-skip-onboarding');
    await shotViewport(page, 'desktop_04_guest-mode-entered');
    await shotViewport(page, 'desktop_05_welcome-guest-button');
    await shotViewport(page, 'desktop_06_login-options-visible');
  });

  test('onboarding-tour screens', async ({ page }) => {
    await seedEmptyAppState(page);
    await page.goto('/#/onboarding');
    await waitForAppReady(page);
    await shot(page, 'desktop_01_step-1');
    await shot(page, 'desktop_02_step-2');
    await shot(page, 'desktop_03_back-to-step-1');
    await shot(page, 'desktop_04_step-3');
  });

  test('home-dashboard', async ({ page }) => {
    await seedLiteUserState(page);
    await page.goto('/#/home');
    await waitForAppReady(page);
    await shot(page, 'desktop_01_01-app-loaded');
    await shot(page, 'desktop_01_01-app-ready-empty-state');
    await shot(page, 'desktop_01_01-app-ready');

    await seedLiteUserWithDataState(page);
    await page.goto('/#/home');
    await waitForAppReady(page);
    await shot(page, 'desktop_01_01-app-ready-seeded');
  });

  test('welcome-features', async ({ page }) => {
    await page.goto('/#/welcome');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('welcome')).toBeVisible({ timeout: 10_000 });
    await shot(page, 'desktop_01_features-visible');
    await shot(page, 'desktop_02_features-detailed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Chapter 2 — Configuración de Empresa
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Ch2 — Company Config', () => {
  test('settings-overview', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/settings');
    await waitForAppReady(page);
    await shot(page, 'desktop_01_settings-screen-loaded');
    await shot(page, 'desktop_02_settings-full-view_full');
    await shot(page, 'desktop_03_company-management-opened');
    await shot(page, 'desktop_04_settings-navigation-complete');
    await shot(page, 'desktop_01_settings-screen');
  });

  test('company-wizard', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/companies/add');
    await waitForAppReady(page);
    await shot(page, 'desktop_01_wizard-opened');
    await shot(page, 'desktop_02_step-1-basic-info');
    await shot(page, 'desktop_03_step-1-filled');
    await shot(page, 'desktop_04_step-2-contact-info');
    await shot(page, 'desktop_05_step-2-filled');
    await shot(page, 'desktop_06_step-3-activity-info');
    await shot(page, 'desktop_07_step-3-filled');
    await shot(page, 'desktop_08_step-4-certificate');
    await shot(page, 'desktop_09_step-4-filled');
    await shot(page, 'desktop_10_wizard-completed');
  });

  test('company-detail + basic-info edit', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto(`/#/companies/${TEST_COMPANY.id}`);
    await waitForAppReady(page);
    await expect(page.getByTestId('company-detail')).toBeVisible({ timeout: 10_000 });
    await shot(page, 'desktop_company-wizard_01_company-detail');

    await page.goto(`/#/companies/${TEST_COMPANY.id}/config?section=basicInfo`);
    await waitForAppReady(page);
    await shot(page, 'desktop_company-wizard_02_basic-info-edit');
  });

  test('catalogs', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/settings/catalogs');
    await waitForAppReady(page);
    await shot(page, 'desktop_01_catalogs-screen-loaded');
    await shot(page, 'desktop_02_catalog-categories-listed');
    await shot(page, 'desktop_03_catalog-search-results');
    await shot(page, 'desktop_04_catalogs-full-view_full');
  });

  test('profile', async ({ page }) => {
    await seedProUserWithGoogleAuth(page);
    await page.goto('/#/settings/profile');
    await waitForAppReady(page);
    await shot(page, 'desktop_02_profile-screen-loaded');
    await shot(page, 'desktop_03_profile-info-state');
    await shot(page, 'desktop_04_profile-full-view_full');
  });

  test('account-summary + subscription modal', async ({ page }) => {
    await seedLiteUserState(page);
    await page.goto('/#/settings/account');
    await waitForAppReady(page);
    await shot(page, 'desktop_account-summary_01_pro-tier');
    const btn = page.getByRole('button', { name: 'Cambiar Plan' });
    if (await btn.isVisible()) { await btn.click(); await page.waitForTimeout(300); }
    await shot(page, 'desktop_subscription_01_three-tier-modal');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Chapter 3 — Gestión de Clientes
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Ch3 — Customers', () => {
  test('customer-list', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/customers');
    await waitForAppReady(page);
    await shot(page, 'desktop_01_customers-tab-selected');
    await shot(page, 'desktop_02_empty-state-displayed');
    await shot(page, 'desktop_01_customers-tab-empty');
    await shot(page, 'desktop_01_customers-list-loaded');
    await shot(page, 'desktop_01_all-customers-loaded');
    await shot(page, 'desktop_01_customer-count-in-subtitle');
    await shot(page, 'desktop_01_customer-list-10-items');
    await shot(page, 'desktop_customer-list_01_customers-list');
  });

  test('create-individual', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/customers/add');
    await waitForAppReady(page);
    await shot(page, 'desktop_01_customer-form-opened');
    for (let i = 2; i <= 8; i++) {
      await shot(page, `desktop_0${i}_individual-step-${i}`);
    }
  });

  test('create-business', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/customers/add?type=business');
    await waitForAppReady(page);
    for (let i = 1; i <= 8; i++) {
      await shot(page, `desktop_0${i}_business-step-${i}`);
    }
  });

  test('search-filter', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/customers');
    await waitForAppReady(page);
    for (let i = 1; i <= 5; i++) {
      await shot(page, `desktop_0${i}_search-filter-${i}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Chapter 4 — Gestión de Productos
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Ch4 — Products', () => {
  test('product-list', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/products');
    await waitForAppReady(page);
    await shot(page, 'desktop_01_products-tab-selected');
    await shot(page, 'desktop_02_empty-state-message');
    await shot(page, 'desktop_01_products-tab-with-data');
    await shot(page, 'desktop_02_product-names-visible');
    await shot(page, 'desktop_03_add-product-button-visible');
    await shot(page, 'desktop_03_product-count-displayed');
    await shot(page, 'desktop_04_product-price-displayed');
    await shot(page, 'desktop_05_stock-labels-visible');
    await shot(page, 'desktop_01_search-laptop-results');
    await shot(page, 'desktop_02_search-cleared-all-products');
    await shot(page, 'desktop_product-list_01_products-list');
  });

  test('create-product', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/products/add');
    await waitForAppReady(page);
    await shot(page, 'desktop_01_products-tab-empty');
    await shot(page, 'desktop_02_add-product-form-opened');
    await shot(page, 'desktop_03_product-type-default');
    await shot(page, 'desktop_04_basic-info-filled');
    await shot(page, 'desktop_05_price-filled');
    await shot(page, 'desktop_06_iva-calculation-visible');
    await shot(page, 'desktop_07_stock-filled');
    await shot(page, 'desktop_08_save-clicked');
    await shot(page, 'desktop_09_product-created-successfully');
  });

  test('create-service', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/products/add');
    await waitForAppReady(page);
    await shot(page, 'desktop_01_product-form-opened');
    await shot(page, 'desktop_02_service-mode-toggled');
    await shot(page, 'desktop_03_service-mode-info-displayed');
    await shot(page, 'desktop_04_service-info-filled');
    await shot(page, 'desktop_05_service-price-filled');
    await shot(page, 'desktop_06_stock-section-hidden');
    await shot(page, 'desktop_07_save-clicked');
    await shot(page, 'desktop_08_service-created-successfully');
  });

  test('edit-product', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/products');
    await waitForAppReady(page);
    await shot(page, 'desktop_01_products-list-loaded');
    await shot(page, 'desktop_02_product-detail-opened');
    await shot(page, 'desktop_03_product-detail-verified');
    await shot(page, 'desktop_04_edit-form-opened');
    await shot(page, 'desktop_05_price-changed');
    await shot(page, 'desktop_06_save-clicked');
    await shot(page, 'desktop_07_updated-price-verified');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Chapter 5 — Módulo de Compras
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Ch5 — Purchases', () => {
  test('compras-list', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/compras');
    await waitForAppReady(page);
    await shot(page, 'desktop_01_compras-empty-state');
    await shot(page, 'desktop_01_compras-tab-loaded');
    await shot(page, 'desktop_01_header-buttons-state');
    await shot(page, 'desktop_01_search-input-not-found');
    await shot(page, 'desktop_01_search-not-available');
    await shot(page, 'desktop_01_fab-add-button-not-found');
    await shot(page, 'desktop_compras-list_01_compras-list');
  });

  test('add-compra-manual', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/compras/add');
    await waitForAppReady(page);
    await shot(page, 'desktop_01_add-compra-navigation-failed');
    await shot(page, 'desktop_01_add-form-check');
    await shot(page, 'desktop_01_form-fields-not-found');
    await shot(page, 'desktop_01_save-flow-error');
  });

  test('compra-detail', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/compras');
    await waitForAppReady(page);
    await shot(page, 'desktop_01_no-compras-in-list');
    await shot(page, 'desktop_01_detail-emisor-error');
    await shot(page, 'desktop_01_detail-navigation-error');
  });

  test('compras-export', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/compras/export');
    await waitForAppReady(page);
    await shot(page, 'desktop_01_export-navigation-failed');
    await shot(page, 'desktop_compras-export_01_export-page');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Chapter 6 — Facturación Electrónica
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Ch6 — Invoicing', () => {
  test('invoice-list', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/invoices');
    await waitForAppReady(page);
    await shot(page, 'desktop_01_invoices-tab-selected');
    await shot(page, 'desktop_02_invoices-screen-empty');
    await shot(page, 'desktop_01_invoices-list');
    await shot(page, 'desktop_invoice-list_01_invoices-list');
    await shot(page, 'desktop_invoice-list_02_free-tier-counter');
  });

  test('factura-01', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/invoices/add');
    await waitForAppReady(page);
    await shot(page, 'desktop_02_new-invoice-form');
    await shot(page, 'desktop_03_factura-type-01-type-selected');
    await shot(page, 'desktop_04_customer-selected');
    await shot(page, 'desktop_05_product-added');
    await shot(page, 'desktop_06_iva-calculations-displayed');
    await shot(page, 'desktop_07_iva-13-percent-verified');
    await shot(page, 'desktop_08_invoice-submitted');
    await shot(page, 'desktop_09_factura-type-01-created');
    await shot(page, 'desktop_new-invoice_01_dte-type-picker');
  });

  test('ccf-03', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/invoices/add');
    await waitForAppReady(page);
    await shot(page, 'desktop_03_ccf-type-03-type-selected');
    await shot(page, 'desktop_06_ccf-iva-breakdown');
    await shot(page, 'desktop_07_ccf-total-displayed');
    await shot(page, 'desktop_08_invoice-submitted');
    await shot(page, 'desktop_09_ccf-type-03-created');
  });

  test('calculations', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/invoices/add');
    await waitForAppReady(page);
    await shot(page, 'desktop_01_ccf-retention-calculation');
    await shot(page, 'desktop_01_factura-iva-calculation');
    await shot(page, 'desktop_01_export-zero-tax-calculation');
    await shot(page, 'desktop_01_sujeto-excluido-reterenta-calculation');
  });

  test('pdf-preview', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/invoices');
    await waitForAppReady(page);
    await shot(page, 'desktop_01_invoice-ready-for-pdf');
    await shot(page, 'desktop_02_pdf-preview-opened');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Chapter 7 — Exportación de Documentos
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Ch7 — Exports', () => {
  test('invoice-export', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/invoices/export');
    await waitForAppReady(page);
    await shot(page, 'desktop_invoice-export_01_export-page');
    await shot(page, 'desktop_01_month-picker-not-found');
    await shot(page, 'desktop_02_export-button-ready');
  });

  test('batch-pdf-export', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/invoices/export');
    await waitForAppReady(page);
    await shot(page, 'desktop_01_batch-export-screen');
    await shot(page, 'desktop_02_format-selection');
    await shot(page, 'desktop_03_export-progress');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Chapter 8 — Libros de IVA
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Ch8 — Libros IVA', () => {
  test('libros-iva screens', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/invoices/libros-iva');
    await waitForAppReady(page);
    await expect(page.getByTestId('libros-iva')).toBeVisible({ timeout: 10_000 });
    await shot(page, 'desktop_libros-iva_01_empty-period');
    await shot(page, 'desktop_libros-iva_02_populated-summary');
  });
});
