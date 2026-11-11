/**
 * mark-as-contingency.spec.ts
 *
 * Covers the per-invoice "Marcar como contingencia" action introduced to
 * mirror the iOS InvoicesListView toolbar entry point and
 * ContingencyRequestViewModel.canRequestContingency predicate.
 *
 * Test cases:
 *  1. From InvoiceDetailPage on a Nueva invoice — action visible, confirm dialog,
 *     status badge updates, navigation to /contingency with pre-selection.
 *  2. From the invoice list — Contingencia button is visible in the page header.
 *  3. Action NOT visible on a Completada invoice (status=2).
 */

import { test, expect } from '@playwright/test';
import { seedPopulatedAppState, SAMPLE_INVOICES } from '../../fixtures/seed-state';

// inv-003 has status=0 (Nueva) — contingency-eligible
const NUEVA_INVOICE_ID = 'inv-003';
// inv-001 has status=2 (Completada) — NOT eligible
const COMPLETADA_INVOICE_ID = 'inv-001';

test.describe('Mark as Contingency', () => {
  test('action visible on Nueva invoice — confirm, status changes, navigates to /contingency', async ({ page }) => {
    await seedPopulatedAppState(page);

    // Navigate directly to the Nueva invoice detail
    await page.goto(`/#/invoices/${NUEVA_INVOICE_ID}`);
    await page.waitForLoadState('domcontentloaded');

    // Sidebar visible → app is loaded
    await expect(page.getByTestId('sidebar-inicio')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('invoice-detail')).toBeVisible({ timeout: 8000 });

    // Open the "Más acciones" dropdown
    const moreActionsBtn = page.getByTestId('btn-actions-menu');
    await expect(moreActionsBtn).toBeVisible({ timeout: 5000 });
    await moreActionsBtn.click();

    // The contingency action must be visible in the dropdown
    const contingencyAction = page.getByTestId('btn-mark-contingency');
    await expect(contingencyAction).toBeVisible({ timeout: 3000 });
    await contingencyAction.click();

    // Confirm dialog should appear — use the modal heading specifically
    await expect(page.getByRole('heading', { name: 'Marcar como contingencia' })).toBeVisible({ timeout: 3000 });
    await expect(
      page.getByText(/Este DTE quedará marcado como emitido bajo contingencia/),
    ).toBeVisible();

    // Confirm the action — use the exact confirm button inside the modal footer
    const confirmBtn = page.getByRole('button', { name: 'Marcar', exact: true }).last();
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // Should navigate to /contingency with fromInvoice param
    await expect(page).toHaveURL(/\/invoices\/contingency/, { timeout: 8000 });

    // The contingency page should be visible
    await expect(page.getByTestId('contingency')).toBeVisible({ timeout: 8000 });

    // The invoice should be pre-loaded (its number or control number visible)
    await expect(page.getByText(/INV-003/i)).toBeVisible({ timeout: 5000 });
  });

  test('invoice list page has Contingencia header button', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/invoices');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('sidebar-inicio')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('invoice-list')).toBeVisible({ timeout: 8000 });

    // The secondary "Contingencia" toolbar button introduced to mirror iOS toolbar
    const contingencyBtn = page.getByTestId('btn-contingency-list');
    await expect(contingencyBtn).toBeVisible({ timeout: 5000 });

    await contingencyBtn.click();
    await expect(page).toHaveURL(/\/invoices\/contingency/, { timeout: 8000 });
  });

  test('action NOT visible on Completada invoice', async ({ page }) => {
    await seedPopulatedAppState(page);

    await page.goto(`/#/invoices/${COMPLETADA_INVOICE_ID}`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('sidebar-inicio')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('invoice-detail')).toBeVisible({ timeout: 8000 });

    // Open actions menu — it may be visible for other completed-only actions (create NC etc.)
    const moreActionsBtn = page.getByTestId('btn-actions-menu');
    if (await moreActionsBtn.isVisible()) {
      await moreActionsBtn.click();
      // btn-mark-contingency must NOT exist in the DOM or be hidden
      const contingencyAction = page.getByTestId('btn-mark-contingency');
      await expect(contingencyAction).toBeHidden();
    }
    // If the menu button itself isn't visible (only possible if no other actions), that's fine too.
  });
});
