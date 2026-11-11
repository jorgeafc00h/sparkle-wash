/**
 * Cierre de caja (X/Z), consolidation wizard and the Libros IVA integration:
 *
 *  - Z closes the day's sales and persists a snapshot.
 *  - The wizard aggregates tickets into a draft Factura; tickets go pending.
 *  - When the invoice reaches Completada (driven through the dev-only store
 *    seam, simulating the MH acceptance callback) the middleware finalizes
 *    the link → tickets CONSOLIDATED.
 *  - Libros IVA: pending-sales banner before consolidation, exclusion counter
 *    for excludeFromLibrosIVA invoices.
 *  - Free tier sees the locked wizard (POS selling itself stays free).
 */

import { test, expect, type Page } from '@playwright/test';
import {
  seedPopulatedAppState,
  seedEmptyAppState,
  waitForAppReady,
} from '../../fixtures/seed-state';

/** Make one POS sale through the UI (default cash payment). */
async function makeSale(page: Page, productTestId: string, qty = 1) {
  await page.goto('/#/pos');
  await waitForAppReady(page);
  for (let i = 0; i < qty; i += 1) {
    await page.getByTestId(productTestId).click();
  }
  await page.getByTestId('btn-charge').click();
  await page.getByTestId('btn-confirm-payment').click();
  // Toasts stack across successive sales — assert the newest one.
  await expect(page.getByText(/Ticket #\d+ guardado/).last()).toBeVisible({ timeout: 10_000 });
}

test.describe('Cierre de caja', () => {
  test.beforeEach(async ({ page }) => {
    await seedPopulatedAppState(page);
  });

  test('Z closes the day, shows method totals and records history', async ({ page }) => {
    await makeSale(page, 'pos-product-prod-003'); // $5.50 cash
    await makeSale(page, 'pos-product-prod-005'); // $120 cash

    await page.goto('/#/pos/closing');
    await waitForAppReady(page);

    await expect(page.getByTestId('closing-summary')).toBeVisible();
    await expect(page.getByTestId('closing-total')).toContainText('125.50');
    await expect(page.getByTestId('closing-by-method')).toContainText('EFECTIVO');
    await expect(page.getByTestId('closing-by-method')).toContainText('2 pagos');

    await page.getByTestId('btn-close-z').click();
    await expect(page.getByText(/Cierre Z registrado/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('closing-history')).toBeVisible();
    await expect(page.getByTestId('closing-history').locator('div.py-2').first()).toContainText('125.50');
  });
});

test.describe('Cierre de caja → Factura (facturar este cierre)', () => {
  test.beforeEach(async ({ page }) => {
    await seedPopulatedAppState(page); // Pro tier → consolidation allowed
  });

  test('Z → invoice the closing, leave one ticket out, totals reconcile and the draft matches', async ({ page }) => {
    await makeSale(page, 'pos-product-prod-003'); // #1 $5.50
    await makeSale(page, 'pos-product-prod-005'); // #2 $120.00
    await makeSale(page, 'pos-product-prod-003'); // #3 $5.50

    await page.goto('/#/pos/closing');
    await waitForAppReady(page);
    await expect(page.getByTestId('closing-total')).toContainText('131.00');
    await page.getByTestId('btn-close-z').click();
    await expect(page.getByText(/Cierre Z registrado/)).toBeVisible({ timeout: 10_000 });

    // "Facturar este cierre" opens the wizard with every sale of the Z ticked.
    await page.locator('[data-testid^="btn-invoice-closing-"]').first().click();
    await waitForAppReady(page);
    await expect(page.getByTestId('consolidate-closing-banner')).toContainText('3 ventas');
    await expect(page.getByTestId('chk-ticket-1')).toBeChecked();
    await expect(page.getByTestId('chk-ticket-2')).toBeChecked();
    await expect(page.getByTestId('chk-ticket-3')).toBeChecked();

    // Leave ticket #3 out of the factura.
    await page.getByTestId('chk-ticket-3').uncheck();
    await page.getByTestId('btn-review-selection').click();

    const recon = page.getByTestId('consolidate-reconciliation');
    await expect(recon.getByTestId('recon-period')).toContainText('131.00');
    await expect(recon.getByTestId('recon-removed')).toContainText('#000003');
    await expect(recon.getByTestId('recon-removed')).toContainText('5.50');
    await expect(recon.getByTestId('recon-included')).toContainText('125.50');
    await expect(recon.getByTestId('recon-draft-total')).toContainText('125.50');
    await expect(recon.getByTestId('recon-difference')).toHaveAttribute('data-balanced', 'true');

    // Confirmation summarizes the draft and the ticket left out.
    await page.getByTestId('btn-generate-draft').click();
    await expect(page.getByTestId('consolidate-confirm')).toBeVisible();
    await expect(page.getByTestId('confirm-draft-total')).toContainText('125.50');
    await expect(page.getByTestId('confirm-removed')).toContainText('#000003');
    await page.getByTestId('btn-confirm-consolidation').click();
    await expect(page.getByTestId('consolidation-created')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('consolidation-created')).toContainText('2 tickets');

    // The removed ticket is still pending: the wizard offers only #3 now.
    await expect(page.getByTestId('chk-ticket-3')).toBeVisible();
    await expect(page.getByTestId('chk-ticket-1')).toHaveCount(0);

    // The draft compares itself with its tickets.
    await page.getByTestId('consolidation-created').locator('a[data-testid^="link-invoice-"]').click();
    await waitForAppReady(page);
    await expect(page.getByTestId('invoice-tickets-total')).toContainText('125.50');
    await expect(page.getByTestId('invoice-tickets-difference')).toHaveAttribute('data-balanced', 'true');
  });

  test('a sale after an intraday Z is in the next Z', async ({ page }) => {
    await makeSale(page, 'pos-product-prod-003'); // $5.50
    await page.goto('/#/pos/closing');
    await waitForAppReady(page);
    await page.getByTestId('btn-close-z').click();
    await expect(page.getByText(/Cierre Z registrado/)).toBeVisible({ timeout: 10_000 });

    await makeSale(page, 'pos-product-prod-005'); // $120 later the same day
    await page.goto('/#/pos/closing');
    await waitForAppReady(page);
    await expect(page.getByTestId('closing-z-range')).toContainText('hasta ahora');
    await expect(page.getByTestId('closing-total')).toContainText('120.00');
    await expect(page.getByTestId('btn-close-z')).toBeEnabled();
  });

  test('a consolidated draft edited afterwards cannot be sent', async ({ page }) => {
    await makeSale(page, 'pos-product-prod-003'); // $5.50
    await page.goto('/#/pos/consolidate');
    await waitForAppReady(page);
    await page.getByTestId('btn-select-all').click();
    await page.getByTestId('btn-review-selection').click();
    await page.getByTestId('btn-generate-draft').click();
    await page.getByTestId('btn-confirm-consolidation').click();
    await expect(page.getByTestId('consolidation-created')).toBeVisible({ timeout: 10_000 });

    // Change the draft's quantity behind the wizard's back (dev store seam).
    await page.evaluate(() => {
      const store = (window as unknown as { __fsStore: { getState: () => { invoices: { invoices: Array<{ id: string; items: Array<Record<string, unknown>> }> } }; dispatch: (a: unknown) => void } }).__fsStore;
      const inv = store.getState().invoices.invoices[0];
      store.dispatch({ type: 'invoices/updateInvoice', payload: { id: inv.id, items: inv.items.map((i) => ({ ...i, quantity: 2 })) } });
    });
    await page.getByTestId('consolidation-created').locator('a[data-testid^="link-invoice-"]').click();
    await waitForAppReady(page);
    await expect(page.getByTestId('invoice-tickets-difference')).toHaveAttribute('data-balanced', 'false');
    await expect(page.getByTestId('invoice-tickets-problems')).toContainText('no cuadra');
    await page.getByTestId('btn-sync').click();
    await expect(page.getByText(/no cuadra con la venta de sus tickets/).first()).toBeVisible();
  });
});

test.describe('Consolidation wizard + Libros IVA', () => {
  test.beforeEach(async ({ page }) => {
    await seedPopulatedAppState(page); // Pro tier → consolidation allowed
  });

  test('tickets → draft invoice → linked on Completada → libros banner clears', async ({ page }) => {
    await makeSale(page, 'pos-product-prod-003'); // Papel: $5.50
    await makeSale(page, 'pos-product-prod-005'); // Silla: $120.00

    // Libros banner warns about unconsolidated sales of the period.
    await page.goto('/#/invoices/libros-iva');
    await waitForAppReady(page);
    await expect(page.getByTestId('libros-pending-tickets-banner')).toBeVisible();
    await expect(page.getByTestId('libros-pending-tickets-banner')).toContainText('2 tickets');

    // Wizard: select all → review → generate draft (Factura, Consumidor Final).
    await page.getByTestId('btn-libros-goto-consolidate').click();
    await waitForAppReady(page);
    await expect(page.getByTestId('pos-consolidate')).toBeVisible();
    await expect(page.getByTestId('chk-ticket-1')).toBeVisible();
    await expect(page.getByTestId('chk-ticket-2')).toBeVisible();

    await page.getByTestId('btn-select-all').click();
    await page.getByTestId('btn-review-selection').click();

    await expect(page.getByTestId('consolidate-preview')).toBeVisible();
    // Aggregated: Papel 1×5.50 + Silla 1×120.00
    await expect(page.getByTestId('consolidate-preview-total')).toContainText('125.50');

    await page.getByTestId('btn-generate-draft').click();
    await page.getByTestId('btn-confirm-consolidation').click();
    await expect(page.getByTestId('consolidation-created')).toBeVisible({ timeout: 10_000 });

    // Draft invoice shows the tickets panel in "waiting" state.
    const invoiceLink = page.getByTestId('consolidation-created').locator('a[data-testid^="link-invoice-"]');
    await invoiceLink.click();
    await waitForAppReady(page);
    await expect(page.getByTestId('invoice-tickets-section')).toBeVisible();
    await expect(page.getByTestId('invoice-ticket-1')).toBeVisible();
    await expect(page.getByTestId('invoice-ticket-2')).toBeVisible();
    await expect(page.getByTestId('invoice-tickets-total')).toContainText('125.50');
    await expect(page.getByTestId('invoice-tickets-section').locator('span').filter({ hasText: 'en espera de envío' })).toBeVisible();

    // Banner still warns (draft ≠ consolidated DTE).
    await page.goto('/#/invoices/libros-iva');
    await waitForAppReady(page);
    await expect(page.getByTestId('libros-pending-tickets-banner')).toContainText('2 tickets');

    // Simulate MH acceptance through the dev store seam → middleware links.
    const invoiceId = await page.evaluate(() => {
      const store = (window as unknown as { __fsStore: { getState: () => { invoices: { invoices: Array<{ id: string; invoiceNumber: string }> } } } }).__fsStore;
      return store.getState().invoices.invoices[0].id;
    });
    await page.evaluate((id) => {
      const store = (window as unknown as { __fsStore: { dispatch: (a: unknown) => void } }).__fsStore;
      store.dispatch({ type: 'invoices/setInvoiceStatus', payload: { id, status: 2 } });
    }, invoiceId);
    await page.reload();
    await waitForAppReady(page);

    // Banner cleared.
    await expect(page.getByTestId('libros-pending-tickets-banner')).toHaveCount(0);

    // Ticket history shows them as facturados.
    await page.goto('/#/pos/tickets');
    await waitForAppReady(page);
    await expect(page.getByTestId('ticket-row-1')).toContainText('Facturado');
    await expect(page.getByTestId('ticket-row-2')).toContainText('Facturado');
  });

  test('mixed Libros exclusion selection splits into two drafts', async ({ page }) => {
    await makeSale(page, 'pos-product-prod-003'); // normal
    await makeSale(page, 'pos-product-prod-005'); // will be flagged

    // Flag the second ticket as excluded-from-libros from ticket detail.
    await page.goto('/#/pos/tickets');
    await waitForAppReady(page);
    await page.getByTestId('ticket-row-2').click();
    // (Detail modal is read-only in v1 — the flag is set at sale time. Use a
    // fresh flagged sale instead.)
    await page.keyboard.press('Escape');

    // Simpler and true to the UI path: new sale with the toggle checked.
    await page.goto('/#/pos');
    await waitForAppReady(page);
    await page.getByTestId('pos-product-prod-003').click();
    await page.getByTestId('pos-exclude-libros').check();
    await page.getByTestId('btn-charge').click();
    await page.getByTestId('btn-confirm-payment').click();
    await expect(page.getByText(/Ticket #\d+ guardado/).last()).toBeVisible({ timeout: 10_000 });

    await page.goto('/#/pos/consolidate');
    await waitForAppReady(page);
    await page.getByTestId('btn-select-all').click();
    await page.getByTestId('btn-review-selection').click();

    await expect(page.getByTestId('consolidation-split-warning')).toBeVisible();
    await page.getByTestId('btn-generate-draft').click();
    await page.getByTestId('btn-confirm-consolidation').click();
    await expect(page.getByTestId('consolidation-created')).toBeVisible({ timeout: 10_000 });
    // Two drafts created (one per flag group).
    await expect(page.getByTestId('consolidation-created').locator('a[data-testid^="link-invoice-"]')).toHaveCount(2);
  });

  test('excluded invoice stays out of the export — with a visible counter', async ({ page }) => {
    await makeSale(page, 'pos-product-prod-003');
    await page.goto('/#/pos');
    await waitForAppReady(page);
    await page.getByTestId('pos-product-prod-005').click();
    await page.getByTestId('pos-exclude-libros').check();
    await page.getByTestId('btn-charge').click();
    await page.getByTestId('btn-confirm-payment').click();
    await expect(page.getByText(/Ticket #\d+ guardado/).last()).toBeVisible({ timeout: 10_000 });

    await page.goto('/#/pos/consolidate');
    await waitForAppReady(page);
    await page.getByTestId('btn-select-all').click();
    await page.getByTestId('btn-review-selection').click();
    await page.getByTestId('btn-generate-draft').click();
    await page.getByTestId('btn-confirm-consolidation').click();
    await expect(page.getByTestId('consolidation-created')).toBeVisible({ timeout: 10_000 });

    // Complete BOTH drafts, then check the counter chip on Libros.
    await page.evaluate(() => {
      const store = (window as unknown as { __fsStore: { getState: () => { invoices: { invoices: Array<{ id: string }> } }; dispatch: (a: unknown) => void } }).__fsStore;
      const ids = store.getState().invoices.invoices.map((i) => i.id);
      for (const id of ids) {
        store.dispatch({ type: 'invoices/setInvoiceStatus', payload: { id, status: 2 } });
      }
    });
    await page.goto('/#/invoices/libros-iva');
    await waitForAppReady(page);
    await expect(page.getByTestId('libros-excluded-counter')).toBeVisible();
    await expect(page.getByTestId('libros-excluded-counter')).toContainText('1 factura excluida');
  });
});

test.describe('Consolidation tier gate', () => {
  test('Free tier can sell but the wizard is locked', async ({ page }) => {
    await seedPopulatedAppState(page);
    await makeSale(page, 'pos-product-prod-003');

    // Downgrade to Lite (same addInitScript trick as subscription-gates.spec).
    await page.addInitScript(() => {
      const raw = window.localStorage.getItem('persist:subscription');
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const inner: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(parsed)) inner[k] = typeof v === 'string' ? JSON.parse(v) : v;
      inner.tier = 'lite';
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(inner)) out[k] = JSON.stringify(v);
      window.localStorage.setItem('persist:subscription', JSON.stringify(out));
    });
    await page.goto('/#/pos/consolidate');
    await page.reload();
    await waitForAppReady(page);

    await expect(page.getByTestId('pos-consolidate-locked')).toBeVisible();
    await page.getByTestId('btn-consolidate-upgrade').click();
    await expect(page.getByText('Planes de suscripción').first()).toBeVisible();
  });

  test('sidebar shows the POS section for a fresh Lite user', async ({ page }) => {
    await seedEmptyAppState(page);
    await page.goto('/#/pos');
    await waitForAppReady(page);
    await expect(page.getByTestId('sidebar-section-pos')).toBeVisible();
    await expect(page.getByTestId('sidebar-pos-nueva-venta')).toBeVisible();
    await expect(page.getByTestId('sidebar-pos-consolidar')).toBeVisible();
  });
});
