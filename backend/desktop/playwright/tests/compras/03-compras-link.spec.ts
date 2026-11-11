/**
 * E2E tests for compra -> invoice/customer linking.
 *
 * Test A (interactive): seed the finance state, open the only seeded compra,
 * link it to inv-001 via the modal, verify the customer auto-fills, verify
 * the "Vinculada" list chip + the invoice/customer "materials" sections
 * render with the correct total, then unlink and verify everything clears.
 *
 * Test B (pre-linked + dangling): seed compras with link fields already set
 * directly (bypassing the UI) — one resolving correctly, two pointing at
 * ids that don't exist — and verify the detail page resolves at render time
 * (muted "no encontrada/o" text, unlink still available, stored ids kept).
 *
 * Follows the dual-write seeding discipline from `seedFinanceAppState`
 * (playwright/fixtures/seed-state.ts) and the local re-seed helper pattern
 * from `playwright/tests/invoices/04-linked-documents.spec.ts` — the
 * `compras` slice is rehydrated from BOTH the wrapped `persist:compras` key
 * (read immediately on boot by CompraDetailPage) AND the raw `compras_db_1`
 * key (re-read by the `loadCompras` thunk whenever ComprasListPage or the
 * invoice/customer detail load-effects run). Missing either one empties the
 * list after a mutation or shows an empty materials section.
 *
 * SAMPLE_COMPRAS / SAMPLE_INVOICES / SAMPLE_CUSTOMERS themselves are never
 * modified here — other specs (accounts) assert on their counts.
 */

import { test, expect, Page } from '@playwright/test';
import {
  seedFinanceAppState,
  waitForAppReady,
  SAMPLE_COMPRAS,
} from '../../fixtures/seed-state';
import { navigateToTab } from '../../utils/helpers';

// ---------------------------------------------------------------------------
// Test B fixtures — extra compras seeded directly with link fields already
// set, in addition to (never replacing) SAMPLE_COMPRAS.
// ---------------------------------------------------------------------------

const linkedToInvoiceCompra = {
  ...SAMPLE_COMPRAS[0],
  id: 'compra-linked-1',
  codigoGeneracion: 'LINKED-GEN-1',
  numeroControl: 'DTE-03-LINKED-1',
  linkedInvoiceId: 'inv-001',
  linkedCustomerId: 'cust-001',
  linkNote: 'Nota de prueba',
};

const danglingInvoiceCompra = {
  ...SAMPLE_COMPRAS[0],
  id: 'compra-dangling-1',
  codigoGeneracion: 'DANGLING-GEN-1',
  numeroControl: 'DTE-03-DANGLING-1',
  linkedInvoiceId: 'inv-nonexistent-000',
  linkedCustomerId: null,
  linkNote: null,
};

const danglingCustomerCompra = {
  ...SAMPLE_COMPRAS[0],
  id: 'compra-dangling-2',
  codigoGeneracion: 'DANGLING-GEN-2',
  numeroControl: 'DTE-03-DANGLING-2',
  linkedInvoiceId: null,
  linkedCustomerId: 'cust-nonexistent-000',
  linkNote: null,
};

/**
 * Re-seeds ONLY the compras slice (persist:compras, double-encoded, plus the
 * raw compras_db_1 key ComprasDatabase actually reads from) on top of a
 * finance baseline. Mirrors `seedWithInvoices` in
 * playwright/tests/invoices/04-linked-documents.spec.ts.
 */
async function seedWithCompras(page: Page, compras: unknown[]): Promise<void> {
  await seedFinanceAppState(page);
  await page.addInitScript((data: unknown[]) => {
    const wrapped: Record<string, string> = {};
    const body = {
      compras: data,
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
    };
    for (const [k, v] of Object.entries(body)) wrapped[k] = JSON.stringify(v);
    wrapped._persist = JSON.stringify({ version: -1, rehydrated: true });
    localStorage.setItem('persist:compras', JSON.stringify(wrapped));
    localStorage.setItem('compras_db_1', JSON.stringify(data));
  }, compras);
  await page.goto('/#/');
  await page.reload();
  await waitForAppReady(page);
}

test.describe('Compras — Link to invoice/customer', () => {
  test('links a compra to an invoice, auto-fills the customer, shows in materials sections, then unlinks', async ({ page }) => {
    await seedFinanceAppState(page);

    await navigateToTab(page, 'compras');
    await expect(page.getByTestId('compras-list')).toBeVisible({ timeout: 10000 });

    // Open the only compra seeded by seedFinanceAppState (compra-001).
    await page.getByText('Proveedor Demo S.A. de C.V.').click();
    await expect(page.getByTestId('compra-detail')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('compra-link-section')).toBeVisible();
    await expect(page.getByText('Sin vinculación')).toBeVisible();

    // Open the link modal (Facturas tab by default) and link to inv-001.
    await page.getByTestId('compra-link-invoice-btn').click();
    await expect(page.getByTestId('link-compra-modal')).toBeVisible();
    await expect(page.getByTestId('link-compra-tab-invoices')).toBeVisible();
    await page.getByTestId('link-compra-option-inv-001').click();
    await page.getByTestId('link-compra-note').fill('Materiales para el proyecto X');
    await page.getByTestId('link-compra-save').click();
    await expect(page.getByTestId('link-compra-modal')).toBeHidden({ timeout: 10000 });

    // Linked invoice + auto-filled customer (inv-001 -> cust-001) + note.
    await expect(page.getByTestId('compra-linked-invoice')).toContainText('DTE-01-M001-000000001');
    await expect(page.getByTestId('compra-linked-customer')).toContainText('Maria Gonzalez');
    await expect(page.getByTestId('compra-link-note')).toContainText('Materiales para el proyecto X');

    // Compras list shows the "Vinculada" chip for this row.
    await page.goto('/#/compras');
    await waitForAppReady(page);
    await expect(page.getByTestId('compra-linked-chip-compra-001')).toBeVisible({ timeout: 10000 });

    // Invoice detail shows the materials section with the compra + total.
    await page.goto('/#/invoices/inv-001');
    await waitForAppReady(page);
    await expect(page.getByTestId('invoice-materials-section')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('invoice-materials-item-compra-001')).toBeVisible();
    await expect(page.getByTestId('invoice-materials-total')).toContainText('113.00');

    // Customer detail shows the materials section too (auto-filled link).
    await page.goto('/#/customers/cust-001');
    await waitForAppReady(page);
    await expect(page.getByTestId('customer-materials-section')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('customer-materials-item-compra-001')).toBeVisible();
    await expect(page.getByTestId('customer-materials-total')).toContainText('113.00');

    // Back to the compra detail — Desvincular clears all three fields.
    await page.goto('/#/compras/compra-001');
    await waitForAppReady(page);
    await expect(page.getByTestId('compra-unlink-btn')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('compra-unlink-btn').click();
    await expect(page.getByText('Sin vinculación')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('compra-linked-invoice')).toBeHidden();
    await expect(page.getByTestId('compra-linked-customer')).toBeHidden();

    // Regression: the invoice materials section disappears once unlinked
    // (render-only-when-count>=1, zero visual regression on unlinked docs).
    await page.goto('/#/invoices/inv-001');
    await waitForAppReady(page);
    await expect(page.getByTestId('invoice-materials-section')).toBeHidden();
  });

  test('resolves a pre-linked invoice/customer and flags dangling references without dropping the stored ids', async ({ page }) => {
    await seedWithCompras(page, [
      ...SAMPLE_COMPRAS,
      linkedToInvoiceCompra,
      danglingInvoiceCompra,
      danglingCustomerCompra,
    ]);

    // Resolved link — shows the invoice, the auto-filled customer, and the note.
    await page.goto('/#/compras/compra-linked-1');
    await waitForAppReady(page);
    await expect(page.getByTestId('compra-link-section')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('compra-linked-invoice')).toContainText('DTE-01-M001-000000001');
    await expect(page.getByTestId('compra-linked-customer')).toContainText('Maria Gonzalez');
    await expect(page.getByTestId('compra-link-note')).toContainText('Nota de prueba');
    await expect(page.getByTestId('compra-unlink-btn')).toBeVisible();

    // Dangling invoice reference — muted message, unlink still available.
    await page.goto('/#/compras/compra-dangling-1');
    await waitForAppReady(page);
    await expect(page.getByTestId('compra-linked-invoice')).toContainText('Factura no encontrada');
    await expect(page.getByTestId('compra-unlink-btn')).toBeVisible();

    // Dangling customer reference — same guarantee for the customer side.
    await page.goto('/#/compras/compra-dangling-2');
    await waitForAppReady(page);
    await expect(page.getByTestId('compra-linked-customer')).toContainText('Cliente no encontrado');
    await expect(page.getByTestId('compra-unlink-btn')).toBeVisible();
  });
});
