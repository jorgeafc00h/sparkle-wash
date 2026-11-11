/**
 * Comprehensive screenshot-capture for the Facturas Simples Lite desktop app.
 *
 * Covers every major user flow for documentation purposes:
 *  - Auth / Welcome
 *  - Dashboard (empty Lite, populated Pro)
 *  - Company management
 *  - Invoice list (multiple statuses)
 *  - Create Factura CF (step by step)
 *  - Create CCF (step by step)
 *  - Create Nota de Crédito (from CCF, linked doc flow)
 *  - Create Nota de Débito (from CCF, linked doc flow)
 *  - Create Nota de Remisión (with delivery fields)
 *  - Create Sujeto Excluido
 *  - Create Exportación
 *  - Create Retención
 *  - Create Comprobante de Liquidación
 *  - Create Documento Contable
 *  - Create Donación
 *  - Invoice Detail — actions menu + confirmation dialog
 *  - Contingency page (empty + loaded invoices)
 *  - Invalidation page
 *  - Invoice export page
 *  - Compras list + add form
 *  - Customers list + detail
 *  - Products list + detail
 *  - Settings + Account Summary + Subscription modal
 *  - Libros IVA (empty + populated)
 *
 * Output: docs-screenshots/{name}.png  (1440×900 viewport)
 */

import { test, expect, Page } from '@playwright/test';
import {
  seedPopulatedAppState,
  seedNoCompanyState,
  waitForAppReady,
  TEST_COMPANY,
  SAMPLE_INVOICES,
  SAMPLE_CUSTOMERS,
  SAMPLE_PRODUCTS,
} from '../../fixtures/seed-state';
import {
  seedProUserWithGoogleAuth,
  seedLiteUserState,
  seedLiteUserWithDataState,
} from '../../fixtures/pro-state';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', '..', '..', 'docs-screenshots');
mkdirSync(OUT_DIR, { recursive: true });

async function shoot(page: Page, name: string) {
  const file = resolve(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`📸 ${name}.png`);
}

// ────────────────────────────────────────────────────────────────────────────
// Rich invoice set that covers all statuses and types for the list screenshot
// ────────────────────────────────────────────────────────────────────────────
const RICH_INVOICES = [
  // 01 — Factura Completada
  {
    id: 'doc-001', invoiceNumber: 'INV-FCF-001',
    controlNumber: 'DTE-01-M001P001-000000000001',
    generationCode: 'AAAA0000-0000-4000-8000-000000000001',
    receptionSeal: 'SELLO-001',
    date: '2026-04-01T10:00:00.000Z', invoiceType: 0, status: 2,
    companyId: TEST_COMPANY.id, customerId: 'cust-001',
    customer: { id: 'cust-001', firstName: 'Maria', lastName: 'Gonzalez', nationalId: '01234567-8' },
    items: [{ id: 'it-001', invoiceId: 'doc-001', productId: 'prod-001', productName: 'Servicio de Consultoría', quantity: 2, unitPrice: 150 }],
    totals: { subTotal: 265.49, ivaAmount: 34.51, totalPagar: 300, totalAmount: 300, totalItems: 2, isCCF: false, version: 1 },
    totalAmount: 300, totalAmountIncludingTax: 300, documentType: '01',
    createdAt: '2026-04-01T10:00:00.000Z', updatedAt: '2026-04-01T10:00:00.000Z',
  },
  // 02 — CCF Completado
  {
    id: 'doc-002', invoiceNumber: 'INV-CCF-001',
    controlNumber: 'DTE-03-M001P001-000000000002',
    generationCode: 'BBBB0000-0000-4000-8000-000000000002',
    receptionSeal: 'SELLO-002',
    date: '2026-04-05T09:30:00.000Z', invoiceType: 1, status: 2,
    companyId: TEST_COMPANY.id, customerId: 'cust-002',
    customer: { id: 'cust-002', businessName: 'Empresa XYZ S.A. de C.V.', nit: '0614-020203-101-1' },
    items: [{ id: 'it-002', invoiceId: 'doc-002', productId: 'prod-002', productName: 'Laptop Dell Inspiron', quantity: 1, unitPrice: 850 }],
    totals: { subTotal: 752.21, ivaAmount: 97.79, totalPagar: 850, totalAmount: 850, totalItems: 1, isCCF: true, version: 3 },
    totalAmount: 850, totalAmountIncludingTax: 850, documentType: '03',
    createdAt: '2026-04-05T09:30:00.000Z', updatedAt: '2026-04-05T09:30:00.000Z',
  },
  // 03 — Nota de Crédito Completada (linked to CCF)
  {
    id: 'doc-003', invoiceNumber: 'INV-NC-001',
    controlNumber: 'DTE-05-M001P001-000000000003',
    generationCode: 'CCCC0000-0000-4000-8000-000000000003',
    receptionSeal: 'SELLO-003',
    date: '2026-04-08T11:00:00.000Z', invoiceType: 2, status: 2,
    companyId: TEST_COMPANY.id, customerId: 'cust-002',
    customer: { id: 'cust-002', businessName: 'Empresa XYZ S.A. de C.V.', nit: '0614-020203-101-1' },
    items: [{ id: 'it-003', invoiceId: 'doc-003', productId: 'prod-002', productName: 'Laptop Dell Inspiron (devolución parcial)', quantity: 1, unitPrice: 100 }],
    totals: { subTotal: 88.50, ivaAmount: 11.50, totalPagar: 100, totalAmount: 100, totalItems: 1, isCCF: true, version: 3 },
    totalAmount: 100, totalAmountIncludingTax: 100, documentType: '05',
    relatedId: 'doc-002', relatedDocumentNumber: 'DTE-03-M001P001-000000000002',
    createdAt: '2026-04-08T11:00:00.000Z', updatedAt: '2026-04-08T11:00:00.000Z',
  },
  // 04 — Factura Nueva (pending sync)
  {
    id: 'doc-004', invoiceNumber: 'INV-FCF-002',
    controlNumber: '', generationCode: '', receptionSeal: '',
    date: '2026-04-10T08:00:00.000Z', invoiceType: 0, status: 0,
    companyId: TEST_COMPANY.id, customerId: 'cust-003',
    customer: { id: 'cust-003', firstName: 'Ana', lastName: 'Lopez', nationalId: '11223344-5' },
    items: [{ id: 'it-004', invoiceId: 'doc-004', productId: 'prod-003', productName: 'Papel Bond A4', quantity: 5, unitPrice: 5.50 }],
    totals: { subTotal: 24.34, ivaAmount: 3.16, totalPagar: 27.50, totalAmount: 27.50, totalItems: 5, isCCF: false, version: 1 },
    totalAmount: 27.50, totalAmountIncludingTax: 27.50, documentType: '01',
    createdAt: '2026-04-10T08:00:00.000Z', updatedAt: '2026-04-10T08:00:00.000Z',
  },
  // 05 — CCF Error Envio
  {
    id: 'doc-005', invoiceNumber: 'INV-CCF-002',
    controlNumber: '', generationCode: '', receptionSeal: '',
    date: '2026-04-11T14:00:00.000Z', invoiceType: 1, status: 5,
    companyId: TEST_COMPANY.id, customerId: 'cust-002',
    customer: { id: 'cust-002', businessName: 'Empresa XYZ S.A. de C.V.', nit: '0614-020203-101-1' },
    items: [{ id: 'it-005', invoiceId: 'doc-005', productId: 'prod-004', productName: 'Mantenimiento TI', quantity: 1, unitPrice: 200 }],
    totals: { subTotal: 177, ivaAmount: 23, totalPagar: 200, totalAmount: 200, totalItems: 1, isCCF: true, version: 3 },
    totalAmount: 200, totalAmountIncludingTax: 200, documentType: '03',
    createdAt: '2026-04-11T14:00:00.000Z', updatedAt: '2026-04-11T14:00:00.000Z',
  },
  // 06 — Exportación Completada
  {
    id: 'doc-006', invoiceNumber: 'INV-EXP-001',
    controlNumber: 'DTE-11-M001P001-000000000006',
    generationCode: 'DDDD0000-0000-4000-8000-000000000006',
    receptionSeal: 'SELLO-006',
    date: '2026-04-12T10:00:00.000Z', invoiceType: 7, status: 2,
    companyId: TEST_COMPANY.id, customerId: 'cust-005',
    customer: { id: 'cust-005', businessName: 'Gobierno Central', nit: '0614-000000-000-0' },
    items: [{ id: 'it-006', invoiceId: 'doc-006', productId: 'prod-001', productName: 'Servicio de Consultoría', quantity: 3, unitPrice: 150 }],
    totals: { subTotal: 450, ivaAmount: 0, totalPagar: 450, totalAmount: 450, totalItems: 3, isCCF: false, version: 1 },
    totalAmount: 450, totalAmountIncludingTax: 450, documentType: '11',
    createdAt: '2026-04-12T10:00:00.000Z', updatedAt: '2026-04-12T10:00:00.000Z',
  },
];

// Invoices in "Nueva" status only — for contingency page
const CONTINGENCY_INVOICES = [
  {
    id: 'cont-001', invoiceNumber: 'INV-CONT-001',
    controlNumber: 'DTE-01-M001P001-CONT000001',
    generationCode: 'EEEE0000-0000-4000-8000-000000000001',
    receptionSeal: '', date: new Date().toISOString(),
    invoiceType: 0, status: 0,
    companyId: TEST_COMPANY.id, customerId: 'cust-001',
    customer: { id: 'cust-001', firstName: 'Maria', lastName: 'Gonzalez', nationalId: '01234567-8' },
    items: [{ id: 'ci-001', invoiceId: 'cont-001', productId: 'prod-001', productName: 'Servicio Consultoría', quantity: 1, unitPrice: 113 }],
    totals: { subTotal: 100, ivaAmount: 13, totalPagar: 113, totalAmount: 100, totalItems: 1, isCCF: false, version: 1 },
    totalAmount: 100, totalAmountIncludingTax: 113, documentType: '01',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  },
  {
    id: 'cont-002', invoiceNumber: 'INV-CONT-002',
    controlNumber: 'DTE-03-M001P001-CONT000002',
    generationCode: 'FFFF0000-0000-4000-8000-000000000002',
    receptionSeal: '', date: new Date().toISOString(),
    invoiceType: 1, status: 0,
    companyId: TEST_COMPANY.id, customerId: 'cust-002',
    customer: { id: 'cust-002', businessName: 'Empresa XYZ S.A. de C.V.', nit: '0614-020203-101-1' },
    items: [{ id: 'ci-002', invoiceId: 'cont-002', productId: 'prod-004', productName: 'Mantenimiento TI', quantity: 1, unitPrice: 226 }],
    totals: { subTotal: 200, ivaAmount: 26, totalPagar: 226, totalAmount: 200, totalItems: 1, isCCF: true, version: 3 },
    totalAmount: 200, totalAmountIncludingTax: 226, documentType: '03',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  },
  {
    id: 'cont-003', invoiceNumber: 'INV-CONT-003',
    controlNumber: 'DTE-01-M001P001-CONT000003',
    generationCode: 'GGGG0000-0000-4000-8000-000000000003',
    receptionSeal: '', date: new Date().toISOString(),
    invoiceType: 0, status: 5, // ErrorEnvio
    companyId: TEST_COMPANY.id, customerId: 'cust-003',
    customer: { id: 'cust-003', firstName: 'Ana', lastName: 'Lopez', nationalId: '11223344-5' },
    items: [{ id: 'ci-003', invoiceId: 'cont-003', productId: 'prod-002', productName: 'Laptop Dell Inspiron', quantity: 1, unitPrice: 959.50 }],
    totals: { subTotal: 849.12, ivaAmount: 110.38, totalPagar: 959.50, totalAmount: 959.50, totalItems: 1, isCCF: false, version: 1 },
    totalAmount: 959.50, totalAmountIncludingTax: 959.50, documentType: '01',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  },
];

// Seed helper: inject invoices over the populated state
async function seedWithInvoices(page: Page, invoices: any[]) {
  await seedPopulatedAppState(page);
  await page.addInitScript((invs: any[]) => {
    const wrapped: Record<string, string> = {};
    const body = { invoices: invs, loading: false, error: null, searchTerm: '', filters: {} };
    for (const [k, v] of Object.entries(body)) wrapped[k] = JSON.stringify(v);
    wrapped._persist = JSON.stringify({ version: -1, rehydrated: true });
    localStorage.setItem('persist:invoices', JSON.stringify(wrapped));
  }, invoices);
  await page.goto('/#/');
  await page.reload();
  await waitForAppReady(page);
}

// ─── Seed helper: inject customers + products + invoices
async function seedFullState(page: Page, invoices: any[] = RICH_INVOICES) {
  await page.addInitScript((data: any) => {
    for (const [key, value] of Object.entries(data as Record<string, string>)) {
      window.localStorage.setItem(key, value);
    }
  }, await buildFullStateEntries(invoices));
  await page.goto('/#/');
  await page.reload();
  await waitForAppReady(page);
}

// We need a pure function that returns the localStorage entries without importing
// the seed-state helpers (they run in Node context, not browser).
async function buildFullStateEntries(invoices: any[]) {
  // Re-use the same format as seed-state.ts
  function toRPF(state: Record<string, unknown>): string {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(state)) out[k] = JSON.stringify(v);
    return JSON.stringify(out);
  }
  const company = TEST_COMPANY;
  return {
    'persist:auth': toRPF({
      user: { id: 'guest-user-001', email: 'test@facturassimples.com', firstName: 'Test', lastName: 'User', isEmailVerified: true },
      isAuthenticated: false, isGuestMode: true, hasCompletedOnboarding: true,
      loading: false, error: null, token: null, refreshToken: null,
      selectedCompanyId: company.id,
      _persist: { version: -1, rehydrated: true },
    }),
    'persist:app': toRPF({ isInitialized: true, isOnline: true, currentTheme: 'light', language: 'es', environment: 'development', syncStatus: 'idle', notifications: [], _persist: { version: -1, rehydrated: true } }),
    'persist:companies': toRPF({ companies: [company], selectedCompanyId: company.id, currentCompany: company, loading: false, error: null, _persist: { version: -1, rehydrated: true } }),
    'persist:customers': toRPF({ customers: SAMPLE_CUSTOMERS, selectedCustomerId: null, lastUpdatedAt: null, loading: false, error: null, searchTerm: '', filters: { isActive: true }, _persist: { version: -1, rehydrated: true } }),
    'persist:products': toRPF({ products: SAMPLE_PRODUCTS, categories: [], brands: [], suppliers: [], currentProduct: null, filters: {}, loading: false, error: null, searchTerm: '', _persist: { version: -1, rehydrated: true } }),
    'persist:invoices': toRPF({ invoices, selectedInvoiceId: null, pendingSync: [], lastSyncDate: null, currentInvoice: null, filters: {}, loading: false, error: null, searchTerm: '', _persist: { version: -1, rehydrated: true } }),
    'persist:catalogs': toRPF({ catalogs: [], syncInfo: {}, lastFullSync: null, filters: {}, loading: false, error: null, searchTerm: '', _persist: { version: -1, rehydrated: true } }),
    'persist:subscription': toRPF({ tier: 'pro', isInitialized: true, loading: false, error: null, availableProducts: [], activeSubscription: null, purchaseInProgress: false, _persist: { version: -1, rehydrated: true } }),
    'persist:compras': toRPF({ compras: [], monthlyTotal: null, dbInitialized: true, loading: false, error: null, searchTerm: '', dateFrom: null, dateTo: null, selectedCompraId: null, linkedGmailEmail: null, syncState: null, _persist: { version: -1, rehydrated: true } }),
  };
}

// ============================================================================
test.describe.configure({ mode: 'serial' });

test.describe('Facturas Simples — Documentation Screenshots', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  // ── 01. AUTH / ONBOARDING ─────────────────────────────────────────────────

  test('01-auth — Página de bienvenida (Welcome)', async ({ page }) => {
    await page.goto('/#/welcome');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('welcome')).toBeVisible({ timeout: 10_000 });
    await shoot(page, '01-auth_01_welcome-page');
  });

  // ── 02. DASHBOARD ─────────────────────────────────────────────────────────

  test('02-dashboard — Dashboard vacío (Lite, sin datos)', async ({ page }) => {
    await seedLiteUserState(page);
    await page.goto('/#/home');
    await waitForAppReady(page);
    await shoot(page, '02-dashboard_01_empty-lite');
  });

  test('02-dashboard — Dashboard con datos (Pro)', async ({ page }) => {
    await seedLiteUserWithDataState(page);
    await page.goto('/#/home');
    await waitForAppReady(page);
    await shoot(page, '02-dashboard_02_populated-pro');
  });

  // ── 03. EMPRESAS ──────────────────────────────────────────────────────────

  test('03-company — Lista de empresas', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/companies');
    await waitForAppReady(page);
    await expect(page.getByTestId('company-list')).toBeVisible({ timeout: 10_000 });
    await shoot(page, '03-company_01_company-list');
  });

  test('03-company — Detalle de empresa', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto(`/#/companies/${TEST_COMPANY.id}`);
    await waitForAppReady(page);
    await expect(page.getByTestId('company-detail')).toBeVisible({ timeout: 10_000 });
    await shoot(page, '03-company_02_company-detail');
  });

  test('03-company — Edición información general', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto(`/#/companies/${TEST_COMPANY.id}/config?section=basicInfo`);
    await waitForAppReady(page);
    await expect(page.getByTestId('basic-info-form')).toBeVisible({ timeout: 10_000 });
    await shoot(page, '03-company_03_basic-info-edit');
  });

  // ── 04. LISTA DE DOCUMENTOS ───────────────────────────────────────────────

  test('04-invoice-list — Lista con todos los tipos y estados', async ({ page }) => {
    await seedFullState(page, RICH_INVOICES);
    await page.goto('/#/invoices');
    await waitForAppReady(page);
    await shoot(page, '04-invoice-list_01_all-types-and-statuses');
  });

  test('04-invoice-list — Lista vacía (Free tier)', async ({ page }) => {
    await seedLiteUserState(page);
    await page.goto('/#/invoices');
    await waitForAppReady(page);
    await shoot(page, '04-invoice-list_02_empty-free-tier');
  });

  test('04-invoice-list — Contador mensual (Free tier, 10/mo limit)', async ({ page }) => {
    await seedLiteUserWithDataState(page);
    await page.goto('/#/invoices');
    await waitForAppReady(page);
    await shoot(page, '04-invoice-list_03_free-tier-monthly-counter');
  });

  // ── 05. CREAR FACTURA CF (Paso a paso) ────────────────────────────────────

  test('05-create-factura — Paso 1: Selector de tipo DTE', async ({ page }) => {
    await seedFullState(page);
    await page.goto('/#/invoices/add');
    await waitForAppReady(page);
    await shoot(page, '05-create-factura_01_dte-type-picker');
  });

  test('05-create-factura — Paso 2: Formulario Factura CF (con datos)', async ({ page }) => {
    await seedFullState(page);
    // type=0 → Factura CF, skips type picker
    await page.goto('/#/invoices/add?type=0');
    await waitForAppReady(page);
    // Select customer
    const custSearch = page.getByPlaceholder(/buscar cliente/i).first();
    if (await custSearch.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await custSearch.fill('Maria');
      await page.waitForTimeout(400);
      const option = page.getByText('Maria Gonzalez').first();
      if (await option.isVisible({ timeout: 2_000 }).catch(() => false)) await option.click();
    }
    await page.waitForTimeout(300);
    await shoot(page, '05-create-factura_02_form-filled-step2');
  });

  test('05-create-factura — Sin empresa (guardia)', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.evaluate(async () => {
      const storeMod = await import('/src/store/index.ts');
      const sliceMod = await import('/src/store/slices/companySlice.ts');
      const store = (storeMod as any).store ?? (storeMod as any).default;
      store.dispatch((sliceMod as any).setSelectedCompany(null));
    });
    await page.goto('/#/invoices/add');
    await waitForAppReady(page);
    await expect(page.getByTestId('invoice-add-no-company')).toBeVisible({ timeout: 8_000 });
    await shoot(page, '05-create-factura_03_no-company-guard');
  });

  // ── 06. CREAR CCF (Comprobante de Crédito Fiscal) ─────────────────────────

  test('06-create-ccf — Formulario CCF (con datos)', async ({ page }) => {
    await seedFullState(page);
    await page.goto('/#/invoices/add?type=1');
    await waitForAppReady(page);
    // Select business customer
    const custSearch = page.getByPlaceholder(/buscar cliente/i).first();
    if (await custSearch.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await custSearch.fill('Empresa');
      await page.waitForTimeout(400);
      const option = page.getByText('Empresa XYZ').first();
      if (await option.isVisible({ timeout: 2_000 }).catch(() => false)) await option.click();
    }
    await page.waitForTimeout(300);
    await shoot(page, '06-create-ccf_01_form-filled');
  });

  // ── 07. DETALLE DE DOCUMENTO ──────────────────────────────────────────────

  test('07-invoice-detail — Detalle Factura CF (Completada)', async ({ page }) => {
    await seedFullState(page, RICH_INVOICES);
    await page.goto('/#/invoices/doc-001');
    await waitForAppReady(page);
    await expect(page.getByTestId('invoice-detail')).toBeVisible({ timeout: 10_000 });
    await shoot(page, '07-invoice-detail_01_factura-completada');
  });

  test('07-invoice-detail — Detalle CCF (Completado, con botones PDF/Email)', async ({ page }) => {
    await seedFullState(page, RICH_INVOICES);
    await page.goto('/#/invoices/doc-002');
    await waitForAppReady(page);
    await expect(page.getByTestId('invoice-detail')).toBeVisible({ timeout: 10_000 });
    await shoot(page, '07-invoice-detail_02_ccf-completado-actions');
  });

  test('07-invoice-detail — Detalle Factura Nueva (con botón Sincronizar)', async ({ page }) => {
    await seedFullState(page, RICH_INVOICES);
    await page.goto('/#/invoices/doc-004');
    await waitForAppReady(page);
    await expect(page.getByTestId('invoice-detail')).toBeVisible({ timeout: 10_000 });
    await shoot(page, '07-invoice-detail_03_factura-nueva-sync');
  });

  test('07-invoice-detail — Detalle CCF con menú de acciones desplegado', async ({ page }) => {
    await seedFullState(page, RICH_INVOICES);
    await page.goto('/#/invoices/doc-002');
    await waitForAppReady(page);
    await expect(page.getByTestId('invoice-detail')).toBeVisible({ timeout: 10_000 });
    // Open actions menu
    const menuBtn = page.getByTestId('btn-actions-menu');
    await expect(menuBtn).toBeVisible({ timeout: 8_000 });
    await menuBtn.click();
    await expect(page.getByTestId('actions-dropdown')).toBeVisible({ timeout: 3_000 });
    await shoot(page, '07-invoice-detail_04_ccf-actions-menu-open');
  });

  test('07-invoice-detail — Nota de Crédito (diálogo confirmación)', async ({ page }) => {
    await seedFullState(page, RICH_INVOICES);
    await page.goto('/#/invoices/doc-002');
    await waitForAppReady(page);
    await expect(page.getByTestId('invoice-detail')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('btn-actions-menu').click();
    await page.getByTestId('action-create-nc').click();
    await expect(page.getByRole('heading', { name: 'Crear Nota de Crédito' })).toBeVisible({ timeout: 5_000 });
    await shoot(page, '07-invoice-detail_05_nc-confirm-dialog');
  });

  test('07-invoice-detail — Duplicar DTE (navegación directa)', async ({ page }) => {
    await seedFullState(page, RICH_INVOICES);
    await page.goto('/#/invoices/doc-001');
    await waitForAppReady(page);
    await expect(page.getByTestId('invoice-detail')).toBeVisible({ timeout: 10_000 });
    // Factura only shows duplicate (no NC/ND)
    const menuBtn = page.getByTestId('btn-actions-menu');
    if (await menuBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await menuBtn.click();
      await page.waitForTimeout(200);
      await shoot(page, '07-invoice-detail_06_factura-actions-menu');
    } else {
      await shoot(page, '07-invoice-detail_06_factura-detail-no-menu');
    }
  });

  // ── 08. CREAR NOTA DE CRÉDITO ─────────────────────────────────────────────

  test('08-create-nc — Formulario Nota de Crédito (pre-llenado desde CCF)', async ({ page }) => {
    await seedFullState(page, RICH_INVOICES);
    await page.goto('/#/invoices/add?type=2&parentId=doc-002');
    await waitForAppReady(page);
    await shoot(page, '08-create-nc_01_form-linked-to-ccf');
  });

  // ── 09. CREAR NOTA DE DÉBITO ──────────────────────────────────────────────

  test('09-create-nd — Formulario Nota de Débito (pre-llenado desde CCF)', async ({ page }) => {
    await seedFullState(page, RICH_INVOICES);
    await page.goto('/#/invoices/add?type=4&parentId=doc-002');
    await waitForAppReady(page);
    await shoot(page, '09-create-nd_01_form-linked-to-ccf');
  });

  // ── 10. CREAR NOTA DE REMISIÓN ────────────────────────────────────────────

  test('10-create-nr — Formulario Nota de Remisión (con campos entrega)', async ({ page }) => {
    await seedFullState(page, RICH_INVOICES);
    await page.goto('/#/invoices/add?type=5&parentId=doc-002');
    await waitForAppReady(page);
    // Fill in delivery fields if visible
    const nombEntrega = page.getByLabel(/nombre.*entrega|receptor/i).first();
    if (await nombEntrega.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await nombEntrega.fill('Juan Pérez Distribuciones');
    }
    const docuEntrega = page.getByLabel(/documento.*entrega|DUI|NIT/i).first();
    if (await docuEntrega.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await docuEntrega.fill('012345678');
    }
    await page.waitForTimeout(300);
    await shoot(page, '10-create-nr_01_form-with-delivery-fields');
  });

  // ── 11. CREAR SUJETO EXCLUIDO ─────────────────────────────────────────────

  test('11-create-sujeto — Formulario Sujeto Excluido', async ({ page }) => {
    await seedFullState(page);
    await page.goto('/#/invoices/add?type=3');
    await waitForAppReady(page);
    await shoot(page, '11-create-sujeto_01_form');
  });

  // ── 12. CREAR EXPORTACIÓN ─────────────────────────────────────────────────

  test('12-create-export — Formulario Exportación', async ({ page }) => {
    await seedFullState(page);
    await page.goto('/#/invoices/add?type=7');
    await waitForAppReady(page);
    await shoot(page, '12-create-export_01_form');
  });

  // ── 13. CREAR RETENCIÓN ───────────────────────────────────────────────────

  test('13-create-retencion — Formulario Retención (pre-llenado desde CCF)', async ({ page }) => {
    await seedFullState(page, RICH_INVOICES);
    await page.goto('/#/invoices/add?type=8&parentId=doc-002');
    await waitForAppReady(page);
    await shoot(page, '13-create-retencion_01_form');
  });

  // ── 14. CREAR COMPROBANTE DE LIQUIDACIÓN ──────────────────────────────────

  test('14-create-liquidacion — Formulario Comprobante de Liquidación', async ({ page }) => {
    await seedFullState(page, RICH_INVOICES);
    await page.goto('/#/invoices/add?type=6&parentId=doc-002');
    await waitForAppReady(page);
    await shoot(page, '14-create-liquidacion_01_form');
  });

  // ── 15. CREAR DOCUMENTO CONTABLE DE LIQUIDACIÓN ───────────────────────────

  test('15-create-doc-contable — Formulario Documento Contable Liquidación', async ({ page }) => {
    await seedFullState(page, RICH_INVOICES);
    await page.goto('/#/invoices/add?type=9&parentId=doc-002');
    await waitForAppReady(page);
    await shoot(page, '15-create-doc-contable_01_form');
  });

  // ── 16. CREAR DONACIÓN ────────────────────────────────────────────────────

  test('16-create-donacion — Formulario Donación', async ({ page }) => {
    await seedFullState(page);
    await page.goto('/#/invoices/add?type=10');
    await waitForAppReady(page);
    await shoot(page, '16-create-donacion_01_form');
  });

  // ── 17. DETALLE NOTA DE CRÉDITO ───────────────────────────────────────────

  test('17-nc-detail — Detalle Nota de Crédito (Completada, con doc relacionado)', async ({ page }) => {
    await seedFullState(page, RICH_INVOICES);
    await page.goto('/#/invoices/doc-003');
    await waitForAppReady(page);
    await expect(page.getByTestId('invoice-detail')).toBeVisible({ timeout: 10_000 });
    await shoot(page, '17-nc-detail_01_nota-credito-completada');
  });

  // ── 18. ANULACIÓN DE DTE ──────────────────────────────────────────────────

  test('18-invalidation — Página de anulación de DTE', async ({ page }) => {
    await seedFullState(page, RICH_INVOICES);
    await page.goto(`/#/invoices/doc-002/invalidate`);
    await waitForAppReady(page);
    await page.waitForTimeout(800);
    await shoot(page, '18-invalidation_01_invalidation-form');
  });

  // ── 19. CONTINGENCIA ──────────────────────────────────────────────────────

  test('19-contingency — Página de contingencia (formulario vacío)', async ({ page }) => {
    await seedFullState(page);
    await page.goto('/#/invoices/contingency');
    await waitForAppReady(page);
    await expect(page.getByTestId('contingency')).toBeVisible({ timeout: 10_000 });
    await shoot(page, '19-contingency_01_empty-form');
  });

  test('19-contingency — Formulario con datos completados', async ({ page }) => {
    await seedFullState(page, CONTINGENCY_INVOICES);
    await page.goto('/#/invoices/contingency');
    await waitForAppReady(page);
    await expect(page.getByTestId('contingency')).toBeVisible({ timeout: 10_000 });

    // Fill in dates (today's date is already pre-filled)
    // Fill tipo contingencia — already defaults to 5 (Falla en sistema informático)
    // Fill nombre responsable
    const nombreResp = page.getByLabel(/nombre del responsable/i).first();
    if (await nombreResp.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await nombreResp.fill('Carlos Ernesto Rodríguez');
    }
    // Fill DUI
    const duiResp = page.getByLabel(/DUI del responsable/i).first();
    if (await duiResp.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await duiResp.fill('012345678');
    }
    // Fill motivo
    const motivo = page.getByPlaceholder(/motivo|contingencia/i).first();
    if (await motivo.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await motivo.fill('Falla en la conectividad a internet durante el proceso de facturación del día de hoy entre las 10:00 AM y las 12:00 PM.');
    }

    await shoot(page, '19-contingency_02_form-filled');

    // Load invoices and capture the list
    const loadBtn = page.getByTestId('contingency-load-invoices');
    if (await loadBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await loadBtn.click();
      await page.waitForTimeout(600);
      await shoot(page, '19-contingency_03_invoices-loaded');
    }
  });

  // ── 20. EXPORTAR DOCUMENTOS ───────────────────────────────────────────────

  test('20-export — Página de exportación de facturas', async ({ page }) => {
    await seedFullState(page, RICH_INVOICES);
    await page.goto('/#/invoices/export');
    await waitForAppReady(page);
    await shoot(page, '20-export_01_invoice-export-page');
  });

  // ── 21. LIBROS IVA ────────────────────────────────────────────────────────

  test('21-libros-iva — Libros IVA vacío (sin período seleccionado)', async ({ page }) => {
    await seedFullState(page);
    await page.goto('/#/invoices/libros-iva');
    await waitForAppReady(page);
    await expect(page.getByTestId('libros-iva')).toBeVisible({ timeout: 10_000 });
    await shoot(page, '21-libros-iva_01_empty-period');
  });

  test('21-libros-iva — Libros IVA con datos (Anexos 1/2/3 generados)', async ({ page }) => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const iso = (d: number) => new Date(Date.UTC(y, m, d, 10)).toISOString();
    const librosInvoices = Array.from({ length: 12 }, (_, i) => ({
      id: `libro-${i}`,
      invoiceNumber: `DTE-0${i < 3 ? '3' : '1'}-M001P001-${String(i).padStart(15, '0')}`,
      controlNumber: `DTE-0${i < 3 ? '3' : '1'}-M001P001-${String(i).padStart(15, '0')}`,
      generationCode: `AAAA000${i}-0000-4000-8000-000000000000`,
      receptionSeal: `SELLO-${i}`,
      date: iso(i + 1),
      invoiceType: i < 3 ? 1 : 0, // 3 CCF + 9 Factura
      status: i === 11 ? 3 : 2, // last is Anulada
      companyId: TEST_COMPANY.id,
      customerId: 'cust-001',
      customer: { id: 'cust-001', firstName: 'Maria', lastName: 'Gonzalez', nit: '0614-020203-101-1' },
      items: [{ id: `li-${i}`, invoiceId: `libro-${i}`, quantity: 2, unitPrice: 113, productName: 'Servicio Consultoría' }],
      totals: { subTotal: 200, tax: 26, totalAmount: 200, totalPagar: 226, ivaAmount: 26, totalItems: 2, isCCF: i < 3, version: i < 3 ? 3 : 1 },
      documentType: i < 3 ? '03' : '01',
      createdAt: iso(i + 1), updatedAt: iso(i + 1),
    }));
    await seedFullState(page, librosInvoices);
    await page.goto('/#/invoices/libros-iva');
    await waitForAppReady(page);
    await shoot(page, '21-libros-iva_02_populated-summary');
  });

  // ── 22. COMPRAS ───────────────────────────────────────────────────────────

  test('22-compras — Lista de compras (vacía)', async ({ page }) => {
    await seedFullState(page);
    await page.goto('/#/compras');
    await waitForAppReady(page);
    await shoot(page, '22-compras_01_empty-list');
  });

  test('22-compras — Formulario agregar compra', async ({ page }) => {
    await seedFullState(page);
    await page.goto('/#/compras/add');
    await waitForAppReady(page);
    await page.waitForTimeout(500);
    await shoot(page, '22-compras_02_add-compra-form');
  });

  test('22-compras — Exportación de compras', async ({ page }) => {
    await seedFullState(page);
    await page.goto('/#/compras/export');
    await waitForAppReady(page);
    await shoot(page, '22-compras_03_export-page');
  });

  // ── 23. CLIENTES ──────────────────────────────────────────────────────────

  test('23-customers — Lista de clientes', async ({ page }) => {
    await seedFullState(page);
    await page.goto('/#/customers');
    await waitForAppReady(page);
    await shoot(page, '23-customers_01_customer-list');
  });

  test('23-customers — Detalle de cliente (con historial)', async ({ page }) => {
    await seedFullState(page, RICH_INVOICES);
    await page.goto('/#/customers/cust-002');
    await waitForAppReady(page);
    await page.waitForTimeout(500);
    await shoot(page, '23-customers_02_customer-detail-business');
  });

  test('23-customers — Formulario crear cliente', async ({ page }) => {
    await seedFullState(page);
    await page.goto('/#/customers/add');
    await waitForAppReady(page);
    await page.waitForTimeout(300);
    await shoot(page, '23-customers_03_create-customer-form');
  });

  // ── 24. PRODUCTOS ─────────────────────────────────────────────────────────

  test('24-products — Lista de productos e inventario', async ({ page }) => {
    await seedFullState(page);
    await page.goto('/#/products');
    await waitForAppReady(page);
    await shoot(page, '24-products_01_product-list-inventory');
  });

  test('24-products — Detalle de producto', async ({ page }) => {
    await seedFullState(page);
    await page.goto('/#/products/prod-002');
    await waitForAppReady(page);
    await page.waitForTimeout(300);
    await shoot(page, '24-products_02_product-detail-laptop');
  });

  test('24-products — Formulario crear producto', async ({ page }) => {
    await seedFullState(page);
    await page.goto('/#/products/add');
    await waitForAppReady(page);
    await page.waitForTimeout(300);
    await shoot(page, '24-products_03_create-product-form');
  });

  // ── 25. CONFIGURACIÓN ─────────────────────────────────────────────────────

  test('25-settings — Página de configuración', async ({ page }) => {
    await seedFullState(page);
    await page.goto('/#/settings');
    await waitForAppReady(page);
    await shoot(page, '25-settings_01_settings-home');
  });

  test('25-settings — Perfil de usuario', async ({ page }) => {
    await seedFullState(page);
    await page.goto('/#/settings/profile');
    await waitForAppReady(page);
    await page.waitForTimeout(300);
    await shoot(page, '25-settings_02_user-profile');
  });

  test('25-settings — Resumen de cuenta (plan Pro)', async ({ page }) => {
    await seedProUserWithGoogleAuth(page);
    await page.goto('/#/settings/account');
    await waitForAppReady(page);
    await expect(page.getByTestId('account-summary')).toBeVisible({ timeout: 10_000 });
    await shoot(page, '25-settings_03_account-summary-pro');
  });

  test('25-settings — Modal de suscripción (Free / Pro $7 / Business $14)', async ({ page }) => {
    await seedLiteUserState(page);
    await page.goto('/#/settings/account');
    await waitForAppReady(page);
    const btn = page.getByRole('button', { name: 'Cambiar Plan' });
    if (await btn.isVisible({ timeout: 5_000 }).catch(() => false)) await btn.click();
    await page.waitForTimeout(400);
    await shoot(page, '25-settings_04_subscription-modal-tiers');
  });

  test('25-settings — Catálogos DTE', async ({ page }) => {
    await seedFullState(page);
    await page.goto('/#/settings/catalogs');
    await waitForAppReady(page);
    await page.waitForTimeout(300);
    await shoot(page, '25-settings_05_catalogs-page');
  });
});
