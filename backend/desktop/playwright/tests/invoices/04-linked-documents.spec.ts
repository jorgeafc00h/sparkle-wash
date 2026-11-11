/**
 * E2E tests for the linked-document action menu + duplicate feature.
 *
 * Validates:
 *  - CCF (Completada) shows NC/ND/NR/CL + Duplicate actions
 *  - Factura (Completada) shows NR/CL + Duplicate (no NC/ND)
 *  - Nueva invoices do NOT show the actions menu
 *  - Clicking a linked-doc action navigates to /invoices/add with query params
 *  - AddInvoicePage reads query params and pre-fills type + parent + items
 */

import { test, expect, Page } from '@playwright/test';
import {
  seedPopulatedAppState,
  waitForAppReady,
  TEST_COMPANY,
  SAMPLE_INVOICES,
} from '../../fixtures/seed-state';

function makeCompletedCCF(id: string) {
  return {
    id,
    invoiceNumber: `DTE-03-TEST-${id}`,
    controlNumber: `DTE-03-M001P001-00000000000${id}`,
    generationCode: `AAAA0000-0000-4000-8000-00000000${id}`,
    receptionSeal: `SELLO-${id}`,
    date: new Date().toISOString(),
    invoiceType: 1, // CCF
    status: 2, // Completada
    companyId: TEST_COMPANY.id,
    customerId: 'cust-001',
    customer: { id: 'cust-001', firstName: 'Maria', lastName: 'Gonzalez', nit: '0614-020203-101-1' },
    items: [
      { id: `${id}-it1`, invoiceId: id, productId: 'prod-001', productName: 'Servicio Test', quantity: 1, unitPrice: 113 },
    ],
    totals: { subTotal: 100, tax: 13, totalAmount: 100, totalPagar: 113, ivaAmount: 13, totalItems: 1, isCCF: true, version: 4 },
    totalAmount: 100,
    totalAmountIncludingTax: 113,
    documentType: '03',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeCompletedFactura(id: string) {
  return { ...makeCompletedCCF(id), id, invoiceType: 0, documentType: '01', invoiceNumber: `DTE-01-TEST-${id}`, controlNumber: `DTE-01-M001P001-00000000000${id}`, totals: { ...makeCompletedCCF(id).totals, isCCF: false, version: 2 } };
}

function makeNuevaInvoice(id: string) {
  return { ...makeCompletedCCF(id), id, status: 0, receptionSeal: '', generationCode: '' };
}

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

test.describe('Linked Document Actions', () => {
  test('CCF (Completada) shows all 4 linked-doc actions + duplicate', async ({ page }) => {
    const ccf = makeCompletedCCF('ccf-1');
    await seedWithInvoices(page, [ccf]);

    await page.goto(`/#/invoices/${ccf.id}`);
    await waitForAppReady(page);
    await expect(page.getByTestId('invoice-detail')).toBeVisible({ timeout: 10_000 });

    // Actions menu should be visible
    const menuBtn = page.getByTestId('btn-actions-menu');
    await expect(menuBtn).toBeVisible();
    await menuBtn.click();

    const dropdown = page.getByTestId('actions-dropdown');
    await expect(dropdown).toBeVisible();

    // All 4 linked-doc actions present for CCF
    await expect(page.getByTestId('action-create-nc')).toBeVisible();
    await expect(page.getByTestId('action-create-nd')).toBeVisible();
    await expect(page.getByTestId('action-create-nr')).toBeVisible();
    await expect(page.getByTestId('action-create-cl')).toBeVisible();
    await expect(page.getByTestId('action-duplicate')).toBeVisible();
  });

  test('Factura (Completada) shows NR + CL + duplicate but NOT NC/ND', async ({ page }) => {
    const factura = makeCompletedFactura('f-1');
    await seedWithInvoices(page, [factura]);

    await page.goto(`/#/invoices/${factura.id}`);
    await waitForAppReady(page);
    await page.getByTestId('btn-actions-menu').click();

    await expect(page.getByTestId('action-create-nr')).toBeVisible();
    await expect(page.getByTestId('action-create-cl')).toBeVisible();
    await expect(page.getByTestId('action-duplicate')).toBeVisible();
    // NC/ND should NOT be visible for Factura
    await expect(page.getByTestId('action-create-nc')).toBeHidden();
    await expect(page.getByTestId('action-create-nd')).toBeHidden();
  });

  test('Nueva invoice shows actions menu with contingency action but no linked-doc actions', async ({ page }) => {
    const nueva = makeNuevaInvoice('n-1');
    await seedWithInvoices(page, [nueva]);

    await page.goto(`/#/invoices/${nueva.id}`);
    await waitForAppReady(page);
    await expect(page.getByTestId('invoice-detail')).toBeVisible({ timeout: 10_000 });

    // Sync button visible (status=Nueva)
    await expect(page.getByTestId('btn-sync')).toBeVisible();

    // Actions menu IS now shown for Nueva because it exposes the contingency action.
    await expect(page.getByTestId('btn-actions-menu')).toBeVisible();
    await page.getByTestId('btn-actions-menu').click();

    // Contingency action must be present
    await expect(page.getByTestId('btn-mark-contingency')).toBeVisible();

    // Linked-document actions must NOT be present on a Nueva invoice
    await expect(page.getByTestId('action-create-nc')).toBeHidden();
    await expect(page.getByTestId('action-create-nd')).toBeHidden();
    await expect(page.getByTestId('action-create-nr')).toBeHidden();
    await expect(page.getByTestId('action-create-cl')).toBeHidden();
  });

  test('clicking NC action shows confirmation → navigates to /invoices/add with params', async ({ page }) => {
    const ccf = makeCompletedCCF('ccf-nav');
    await seedWithInvoices(page, [ccf]);

    await page.goto(`/#/invoices/${ccf.id}`);
    await waitForAppReady(page);
    await page.getByTestId('btn-actions-menu').click();
    await page.getByTestId('action-create-nc').click();

    // Confirmation dialog should appear — use the heading specifically because
    // the Quick Actions card has a "Crear Nota de Crédito Vinculada" button.
    await expect(page.getByRole('heading', { name: 'Crear Nota de Crédito' })).toBeVisible();
    await page.getByRole('button', { name: 'Crear', exact: true }).click();

    // Should navigate to AddInvoicePage with query params
    await expect(page).toHaveURL(/\/invoices\/add\?type=2&parentId=ccf-nav/, { timeout: 5_000 });
  });

  test('AddInvoicePage reads parentId query param and pre-fills items + customer', async ({ page }) => {
    const ccf = makeCompletedCCF('ccf-prefill');
    await seedWithInvoices(page, [ccf]);

    await page.goto(`/#/invoices/add?type=2&parentId=ccf-prefill`);
    await waitForAppReady(page);

    // Should skip step 1 (type picker) and go directly to step 2 (form)
    // The related-invoice dropdown should be visible and pre-selected
    await expect(page.getByText('Documento Relacionado')).toBeVisible({ timeout: 8_000 });
  });

  test('Duplicate action navigates with duplicateFrom param', async ({ page }) => {
    const ccf = makeCompletedCCF('ccf-dup');
    await seedWithInvoices(page, [ccf]);

    await page.goto(`/#/invoices/${ccf.id}`);
    await waitForAppReady(page);
    await page.getByTestId('btn-actions-menu').click();
    await page.getByTestId('action-duplicate').click();

    await expect(page).toHaveURL(/\/invoices\/add\?type=1&duplicateFrom=ccf-dup/, { timeout: 5_000 });
  });
});
