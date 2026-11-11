/**
 * POS register — percentage discounts end-to-end on the web build.
 *
 * Discounts are entered as PERCENTAGES: a per-line % input (re-applied when
 * quantity changes) and a ticket-level % with default quick chips (5/10/15/20).
 * The derived amounts flow into totals, payment and ticket history.
 */

import { test, expect } from '@playwright/test';
import {
  seedPopulatedAppState,
  waitForAppReady,
} from '../../fixtures/seed-state';

test.describe('POS register — percentage discounts', () => {
  test.beforeEach(async ({ page }) => {
    await seedPopulatedAppState(page); // Pro tier, 5 products (prod-003 Papel Bond A4 $5.50)
  });

  test('line % + ticket % chip flow through totals and ticket history', async ({ page }) => {
    await page.goto('/#/pos');
    await waitForAppReady(page);

    await page.getByTestId('pos-product-prod-003').click(); // $5.50
    const line = page.getByTestId('pos-cart-lines').locator('[data-testid^="pos-cart-line-"]').first();

    // Line 10% → discount $0.55, line total $4.95.
    await line.locator('[data-testid^="pos-line-discount-"]').fill('10');
    await expect(line.locator('[data-testid^="pos-line-total-"]')).toContainText('$4.95');
    await expect(page.getByTestId('pos-totals-subtotal')).toContainText('$4.95');

    // Ticket-level 20% chip → $0.99 off → TOTAL $3.96. IVA derived from the
    // discounted gravado bucket: 3.96 − 3.96/1.13 = $0.46 (rounded).
    await page.getByTestId('pos-ticket-disc-chip-20').click();
    await expect(page.getByTestId('pos-totals-discount')).toContainText('(20%)');
    await expect(page.getByTestId('pos-totals-discount')).toContainText('$0.99');
    await expect(page.getByTestId('pos-totals-iva')).toContainText('$0.46');
    await expect(page.getByTestId('pos-total')).toContainText('$3.96');
    await expect(page.getByTestId('btn-charge')).toContainText('$3.96');

    // The chip is selected and the % input mirrors it; typing a custom value works too.
    await expect(page.getByTestId('pos-ticket-disc-chip-20')).toHaveClass(/accent-600/);
    await page.getByTestId('pos-ticket-discount').fill('10');
    await expect(page.getByTestId('pos-totals-discount')).toContainText('(10%)');
    await expect(page.getByTestId('pos-total')).toContainText('$4.45');

    // Back to 20% and complete the sale — payment charges the discounted total.
    await page.getByTestId('pos-ticket-disc-chip-20').click();
    await page.getByTestId('btn-charge').click();
    await expect(page.getByTestId('payment-modal')).toBeVisible();
    await page.getByTestId('pay-cash-tendered').fill('5');
    await expect(page.getByTestId('pay-cash-change')).toContainText('$1.04');
    await page.getByTestId('btn-confirm-payment').click();

    await expect(page.getByText(/Ticket #\d+ guardado/)).toBeVisible({ timeout: 10_000 });

    // History keeps the charged (discounted) total and the detail modal too.
    await page.goto('/#/pos/tickets');
    await waitForAppReady(page);
    await expect(page.getByTestId('ticket-row-1')).toContainText('$3.96');
    await page.getByTestId('ticket-row-1').click();
    await expect(page.getByTestId('ticket-detail-1')).toContainText('$3.96');
    await expect(page.getByTestId('ticket-detail-1')).toContainText('$0.99');
  });

  test('line % re-applies when quantity changes', async ({ page }) => {
    await page.goto('/#/pos');
    await waitForAppReady(page);

    await page.getByTestId('pos-product-prod-003').click(); // 1 × $5.50
    const line = page.getByTestId('pos-cart-lines').locator('[data-testid^="pos-cart-line-"]').first();
    await line.locator('[data-testid^="pos-line-discount-"]').fill('10');

    // +1 quantity → 2 × $5.50 with the SAME 10% → gross $11.00 − $1.10 = $9.90.
    await line.locator('[data-testid^="pos-qty-plus-"]').click();
    await expect(line.locator('[data-testid^="pos-line-total-"]')).toContainText('$9.90');
    await expect(page.getByTestId('pos-totals-subtotal')).toContainText('$9.90');
    await expect(page.getByTestId('pos-total')).toContainText('$9.90');

    // The % input still shows 10 — it scales, it doesn't go stale.
    await expect(line.locator('[data-testid^="pos-line-discount-"]')).toHaveValue('10');
  });

  test('percentages over 100 clamp to the full base, never negative totals', async ({ page }) => {
    await page.goto('/#/pos');
    await waitForAppReady(page);

    await page.getByTestId('pos-product-prod-003').click(); // $5.50
    const line = page.getByTestId('pos-cart-lines').locator('[data-testid^="pos-cart-line-"]').first();

    // 500% on a $5.50 line → clamped to 100% → line nets $0.00.
    await line.locator('[data-testid^="pos-line-discount-"]').fill('500');
    await expect(line.locator('[data-testid^="pos-line-total-"]')).toContainText('$0.00');
    await expect(page.getByTestId('pos-totals-subtotal')).toContainText('$0.00');

    // A ticket % on a $0.00 base stays $0.00 — no negative TOTAL, row hidden.
    await page.getByTestId('pos-ticket-disc-chip-15').click();
    await expect(page.getByTestId('pos-totals-discount')).toHaveCount(0);
    await expect(page.getByTestId('pos-total')).toContainText('$0.00');
  });
});
