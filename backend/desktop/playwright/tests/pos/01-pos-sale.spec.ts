/**
 * POS register — end-to-end sale flow on the web build.
 *
 * Covers: barcode scan entry, grid add, cart math, cash payment with change,
 * ticket persistence (appStorage/localStorage in web), stock discharge via the
 * product-slice reducers, ticket history + void with stock restore, and the
 * oversell BLOCK policy.
 */

import { test, expect, type Page } from '@playwright/test';
import {
  seedPopulatedAppState,
  waitForAppReady,
} from '../../fixtures/seed-state';

test.describe('POS register — sale flow', () => {
  test.beforeEach(async ({ page }) => {
    await seedPopulatedAppState(page); // Pro tier, 5 products (laptop w/ barcode, stock 10)
  });

  test('scan → cart → cash payment → ticket saved and stock deducted', async ({ page }) => {
    await page.goto('/#/pos');
    await waitForAppReady(page);

    await expect(page.getByTestId('pos-register')).toBeVisible();
    await expect(page.getByTestId('pos-product-grid')).toBeVisible();

    // Barcode scan: keyboard-wedge behavior (type + Enter) on the laptop code.
    await page.getByTestId('pos-search-input').fill('7891234567890');
    await page.getByTestId('pos-search-input').press('Enter');
    await expect(page.getByTestId('pos-cart-lines').locator('[data-testid^="pos-cart-line-"]')).toHaveCount(1);

    // Grid add: Papel Bond A4 ($5.50, stock 100).
    await page.getByTestId('pos-product-prod-003').click();
    await expect(page.getByTestId('pos-cart-lines').locator('[data-testid^="pos-cart-line-"]')).toHaveCount(2);

    // Quantity stepper on the scanned laptop line: +1 → 2 × $850.
    const laptopLine = page.getByTestId('pos-cart-lines').locator('[data-testid^="pos-cart-line-"]').first();
    await laptopLine.locator('[data-testid^="pos-qty-plus-"]').click();

    // Total = 2×850 + 5.50 = 1705.50
    await expect(page.getByTestId('pos-total')).toContainText('1705.50');

    // Charge (button; F2 is covered by the keyboard shortcut below).
    await page.getByTestId('btn-charge').click();
    await expect(page.getByTestId('payment-modal')).toBeVisible();

    // Cash: received 2000 → change 294.50
    await page.getByTestId('pay-cash-tendered').fill('2000');
    await expect(page.getByTestId('pay-cash-change')).toContainText('294.50');

    await page.getByTestId('btn-confirm-payment').click();

    // Web build has no thermal bridge → ticket saved with the "no printer" toast.
    await expect(page.getByText(/Ticket #1 guardado/)).toBeVisible({ timeout: 10_000 });
    // Cart resets.
    await expect(page.getByTestId('pos-cart-lines')).toHaveCount(0);

    // Ticket history shows the completed ticket.
    await page.goto('/#/pos/tickets');
    await waitForAppReady(page);
    await expect(page.getByTestId('ticket-row-1')).toBeVisible();
    await expect(page.getByTestId('ticket-row-1')).toContainText('Completado');
    await expect(page.getByTestId('ticket-row-1')).toContainText('$1705.50');

    // Stock discharged: laptop 10 → 8 shows on the POS grid badge.
    await page.goto('/#/pos');
    await waitForAppReady(page);
    await expect(page.getByTestId('pos-stock-prod-002')).toContainText('Stock 8');
  });

  test('card payment records datáfono evidence only', async ({ page }) => {
    await page.goto('/#/pos');
    await waitForAppReady(page);

    await page.getByTestId('pos-product-prod-003').click(); // $5.50
    await page.getByTestId('btn-charge').click();

    await page.getByTestId('pay-method-select').selectOption('TARJETA_POS');
    await page.getByTestId('pay-card-type').selectOption('VISA');
    await page.getByTestId('pay-card-last4').fill('4242');
    await page.getByTestId('pay-card-auth').fill('ABC123');
    await page.getByTestId('btn-confirm-payment').click();

    await expect(page.getByText(/Ticket #\d+ guardado/)).toBeVisible({ timeout: 10_000 });

    await page.goto('/#/pos/tickets');
    await waitForAppReady(page);
    await expect(page.getByTestId('ticket-row-1')).toContainText('TARJETA');
    await page.getByTestId('ticket-row-1').click();
    await expect(page.getByTestId('ticket-detail-1')).toContainText('Auth ABC123');
    await expect(page.getByTestId('ticket-detail-1')).toContainText('$5.50');
  });

  test('card payment with no fields completes', async ({ page }) => {
    await page.goto('/#/pos');
    await waitForAppReady(page);
    await page.getByTestId('pos-product-prod-003').click();
    await page.getByTestId('btn-charge').click();
    await page.getByTestId('pay-method-select').selectOption('TARJETA_POS');
    await expect(page.getByTestId('btn-confirm-payment')).toBeEnabled();
    await page.getByTestId('btn-confirm-payment').click();
    await expect(page.getByText(/Ticket #\d+ guardado/)).toBeVisible({ timeout: 10_000 });

    await page.goto('/#/pos/tickets');
    await waitForAppReady(page);
    await expect(page.getByTestId('ticket-row-1')).toContainText('TARJETA');
    await expect(page.getByTestId('ticket-row-1')).toContainText('Completado');
  });

  test('card payment with only a voucher reference shows it on the ticket', async ({ page }) => {
    await page.goto('/#/pos');
    await waitForAppReady(page);
    await page.getByTestId('pos-product-prod-003').click();
    await page.getByTestId('btn-charge').click();
    await page.getByTestId('pay-method-select').selectOption('TARJETA_POS');
    await page.getByTestId('pay-card-ref').fill('V-889123');
    await page.getByTestId('btn-confirm-payment').click();
    await expect(page.getByText(/Ticket #\d+ guardado/)).toBeVisible({ timeout: 10_000 });

    await page.goto('/#/pos/tickets');
    await waitForAppReady(page);
    await page.getByTestId('ticket-row-1').click();
    await expect(page.getByTestId('ticket-detail-1')).toContainText('Ref V-889123');
  });

  test('void restores stock and requires a reason', async ({ page }) => {
    await page.goto('/#/pos');
    await waitForAppReady(page);
    await page.getByTestId('pos-product-prod-003').click();
    await page.getByTestId('btn-charge').click();
    await page.getByTestId('btn-confirm-payment').click();
    await expect(page.getByText(/Ticket #\d+ guardado/)).toBeVisible({ timeout: 10_000 });

    await page.goto('/#/pos/tickets');
    await waitForAppReady(page);
    await page.getByTestId('btn-void-ticket-1').click();
    await page.getByTestId('void-reason-input').fill('error de cobro');
    await page.getByRole('button', { name: /anular ticket/i }).click();

    await expect(page.getByTestId('ticket-row-1')).toContainText('Anulado', { timeout: 10_000 });
    await expect(page.getByText(/stock restaurado/i)).toBeVisible({ timeout: 10_000 });

    // Stock back to 100 on the POS grid.
    await page.goto('/#/pos');
    await waitForAppReady(page);
    await expect(page.getByTestId('pos-stock-prod-003')).toContainText('Stock 100');
  });

  test('F2 opens the payment modal (keyboard-first)', async ({ page }) => {
    await page.goto('/#/pos');
    await waitForAppReady(page);
    await page.getByTestId('pos-product-prod-003').click();
    await page.keyboard.press('F2');
    await expect(page.getByTestId('payment-modal')).toBeVisible();
  });

  test('oversell BLOCK prevents charging beyond stock', async ({ page }) => {
    await page.goto('/#/pos');
    await waitForAppReady(page);

    // Silla de Oficina: stock 5 (prod-005). Push quantity to 6.
    for (let i = 0; i < 6; i += 1) {
      await page.getByTestId('pos-product-prod-005').click();
    }
    await expect(page.getByTestId('pos-oversell-warning')).toBeVisible();
    await expect(page.getByTestId('btn-charge')).toBeDisabled();
  });
});

// ── 2026-10-31 POS review fixes ────────────────────────────────────────────

const COMPANY_ID = '1'; // seedPopulatedAppState → TEST_COMPANY

/** Stub ONLY the printer bridge (storage stays on the web path) and capture payloads. */
async function stubPrinter(page: Page, opts: { delayMs?: number; cashDrawerKick?: boolean; roundingMode?: string } = {}) {
  await page.addInitScript(({ delayMs, cashDrawerKick, roundingMode, companyId }) => {
    const payloads: unknown[] = [];
    (window as unknown as { __printed: unknown[] }).__printed = payloads;
    (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
      printerList: async () => [],
      printerStatus: async () => ({ ok: true }),
      printerPrint: async (_config: unknown, payload: unknown) => {
        await new Promise((r) => setTimeout(r, delayMs));
        payloads.push(payload);
        return { ok: true, transport: 'network' };
      },
    };
    localStorage.setItem(`pos_settings_${companyId}`, JSON.stringify({
      oversell: 'BLOCK',
      roundingMode,
      printer: {
        transport: 'network',
        network: { host: '10.0.0.5', port: 9100, timeoutMs: 4000 },
        spooler: { printerName: '' },
        paper: { widthMm: 80, copies: 1, cut: true },
        headerLines: [],
        footerLines: [],
        cashDrawerKick,
      },
    }));
  }, { delayMs: opts.delayMs ?? 0, cashDrawerKick: opts.cashDrawerKick ?? false, roundingMode: opts.roundingMode ?? 'NONE', companyId: COMPANY_ID });
}

type PrintedPayload = { copy?: boolean; cashDrawerKick?: boolean; blocks: Array<{ text: string }> };
const printed = (page: Page) => page.evaluate(() => (window as unknown as { __printed: PrintedPayload[] }).__printed);
const cartLines = (page: Page) => page.getByTestId('pos-cart-lines').locator('[data-testid^="pos-cart-line-"]');

// Init scripts must be registered BEFORE seedPopulatedAppState: it loads the
// document, and later hash navigations don't reload it.
test.describe('POS register — scanner, rounding, printing (review fixes)', () => {

  test('a scan into a focused discount field adds the product and leaves the field untouched', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/pos');
    await waitForAppReady(page);
    await page.getByTestId('pos-product-prod-003').click(); // Papel $5.50
    const discount = cartLines(page).first().locator('[data-testid^="pos-line-discount-"]');
    await discount.focus();
    await page.keyboard.type('7891234567890\n'); // keyboard-wedge burst + Enter
    await expect(cartLines(page)).toHaveCount(2);
    await expect(discount).toHaveValue('');
    await expect(page.getByTestId('pos-total')).toContainText('855.50');
    await expect(page.getByTestId('pos-search-input')).toBeFocused();
  });

  test('Enter from a scan never re-clicks a focused product tile', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/pos');
    await waitForAppReady(page);
    await page.getByTestId('pos-product-prod-003').focus();
    await page.keyboard.type('7891234567890\n');
    await expect(cartLines(page)).toHaveCount(1); // only the laptop — Papel was not "clicked"
    await expect(page.getByTestId('pos-total')).toContainText('850.00');
  });

  test('an unknown code clears the search box and says so', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/pos');
    await waitForAppReady(page);
    await page.getByTestId('pos-search-input').focus();
    await page.keyboard.type('0000000000000\n');
    await expect(page.getByText('Código no encontrado: 0000000000000')).toBeVisible();
    await expect(page.getByTestId('pos-search-input')).toHaveValue('');
    // The next scan is not appended to the stale code.
    await page.keyboard.type('7891234567890\n');
    await expect(cartLines(page)).toHaveCount(1);
  });

  test('$0.05 rounding applies to cash only: a card sale keeps the exact amount', async ({ page }) => {
    await stubPrinter(page, { roundingMode: 'NEAREST_0.05' });
    await seedPopulatedAppState(page);
    await page.goto('/#/pos');
    await waitForAppReady(page);
    // Papel $5.50 − 3 % = $5.33 → cash $5.35.
    const sell = async (method: 'EFECTIVO' | 'TARJETA_POS') => {
      await page.getByTestId('pos-product-prod-003').click();
      await cartLines(page).first().locator('[data-testid^="pos-line-discount-"]').fill('3');
      await expect(page.getByTestId('pos-total')).toContainText('$5.33');
      await expect(page.getByTestId('pos-totals-rounding')).toContainText('$5.35');
      await page.getByTestId('btn-charge').click();
      await page.getByTestId('pay-method-select').selectOption(method);
      await expect(page.getByTestId('payment-modal')).toBeVisible();
      await page.getByTestId('btn-confirm-payment').click();
      await expect(cartLines(page)).toHaveCount(0);
    };
    await sell('TARJETA_POS');
    await sell('EFECTIVO');

    await page.goto('/#/pos/tickets');
    await waitForAppReady(page);
    await expect(page.getByTestId('ticket-row-1')).toContainText('$5.33');
    await expect(page.getByTestId('ticket-row-2')).toContainText('$5.35');
    await page.getByTestId('ticket-row-1').locator('button').first().click();
    await expect(page.getByTestId('ticket-detail-1')).not.toContainText('Redondeo');
  });

  test('a slow print never blocks the register; the cash sale receipt opens the drawer, reprints are marked COPIA / ANULADO', async ({ page }) => {
    await stubPrinter(page, { delayMs: 1500, cashDrawerKick: true });
    await seedPopulatedAppState(page);
    await page.goto('/#/pos');
    await waitForAppReady(page);
    await page.getByTestId('pos-product-prod-003').click();
    await page.getByTestId('btn-charge').click();
    await page.getByTestId('btn-confirm-payment').click();
    // The cart is free for the next customer before the receipt finishes.
    await expect(cartLines(page)).toHaveCount(0);
    await expect(page.getByText(/Ticket #1 guardado — imprimiendo/)).toBeVisible();
    await page.getByTestId('pos-product-prod-003').click();
    await expect(cartLines(page)).toHaveCount(1);
    await expect(page.getByText(/Ticket #1 impreso/)).toBeVisible({ timeout: 10_000 });
    await expect(cartLines(page)).toHaveCount(1); // the late print did not wipe the new sale

    let sent = await printed(page);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ cashDrawerKick: true, copy: false });

    await page.goto('/#/pos/tickets');
    await waitForAppReady(page);
    const before = (await printed(page)).length; // hash navigation may or may not reload the page
    await page.getByTestId('btn-reprint-1').click();
    await expect(page.getByText(/Ticket #1 reimpreso/)).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('btn-void-ticket-1').click();
    await page.getByTestId('void-reason-input').fill('cliente devolvió');
    await page.getByRole('button', { name: /anular ticket/i }).click();
    await expect(page.getByTestId('ticket-row-1')).toContainText('Anulado', { timeout: 10_000 });
    await page.getByTestId('btn-reprint-1').click();
    await expect(page.getByText(/Ticket #1 reimpreso/).last()).toBeVisible({ timeout: 10_000 });

    await expect.poll(async () => (await printed(page)).length, { timeout: 10_000 }).toBe(before + 2);
    sent = (await printed(page)).slice(before);
    expect(sent[0]).toMatchObject({ copy: true, cashDrawerKick: false });
    expect(sent[0].blocks.map((b) => b.text)).toContain('REIMPRESIÓN / COPIA');
    expect(sent[0].blocks.map((b) => b.text)).not.toContain('*** ANULADO ***');
    expect(sent[1].blocks.map((b) => b.text)).toContain('*** ANULADO ***');
    expect(sent[1].blocks.some((b) => b.text.includes('Motivo: cliente devolvió'))).toBe(true);
  });

  test('a ticket on a consolidation draft cannot be voided (button disabled with the reason)', async ({ page }) => {
    await page.addInitScript((companyId) => {
      const now = new Date().toISOString();
      localStorage.setItem(`tickets_db_${companyId}`, JSON.stringify({
        sequential: 1,
        closings: [],
        tickets: [{
          id: 'tkt_draft1', companyId, sequential: 1, status: 'COMPLETED', pendingInvoiceId: 'inv_draft_1',
          items: [{ id: 'l1', productId: 'prod-003', productName: 'Papel Bond A4', quantity: 1, unitPrice: 5.5, lineTotal: 5.5 }],
          payments: [{ id: 'p1', method: 'EFECTIVO', amount: 5.5 }],
          totalAmount: 5.5, taxIncluded: 0.63, createdAt: now, completedAt: now, printedCount: 0, updatedAt: now,
        }],
      }));
    }, COMPANY_ID);
    await seedPopulatedAppState(page);
    await page.goto('/#/pos/tickets');
    await waitForAppReady(page);
    const button = page.getByTestId('btn-void-ticket-1');
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('data-locked', 'pending-invoice');
    await expect(page.getByTestId('void-ticket-hint-1')).toHaveAttribute('title', /borrador de factura/);
  });
});
