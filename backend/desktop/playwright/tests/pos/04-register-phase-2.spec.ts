/**
 * POS Phase 2 — the register (openspec/changes/add-pos-phase-2, tasks 1.1–1.9).
 * One test per scenario of the "Split payments", "Suspended sales and register
 * shortcuts", "Quantities, weighable products and scale barcodes",
 * "Quick-create product on a barcode miss", "Registers", "Ticket archive" and
 * "Dashboard POS card" requirements.
 *
 * Web build (localStorage = appStorage), no printer configured. Extra catalog
 * products are merged into the seeded `persist:products` by an init script
 * registered BEFORE seedPopulatedAppState (which loads the document; later
 * hash navigations don't reload it).
 */

import { test, expect, type Page } from '@playwright/test';
import { seedPopulatedAppState, waitForAppReady } from '../../fixtures/seed-state';

const COMPANY_ID = '1'; // seedPopulatedAppState → TEST_COMPANY
const DEVICE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // this register (Device Sync device id)
const PEER_DEVICE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const product = (over: Record<string, unknown>) => ({
  description: '',
  taxCategory: 'GRAVADO',
  isService: false,
  trackInventory: false,
  hasInventory: false,
  status: 'ACTIVE',
  isActive: true,
  companyId: COMPANY_ID,
  createdAt: '2026-01-10T00:00:00.000Z',
  updatedAt: '2026-01-10T00:00:00.000Z',
  ...over,
});

const EXTRA_PRODUCTS = [
  product({ id: 'prod-p20', productName: 'Canasta básica', productCode: 'CAN-20', barcode: '1000000000201', unitPrice: 20, unitOfMeasure: 'UNIDAD' }),
  product({ id: 'prod-p847', productName: 'Jabón líquido', productCode: 'JAB-847', unitPrice: 8.47, unitOfMeasure: 'UNIDAD' }),
  product({ id: 'prod-p10', productName: 'Bolsa de café', productCode: 'CAF-10', unitPrice: 10, unitOfMeasure: 'UNIDAD' }),
  product({ id: 'prod-kg', productName: 'Queso fresco', productCode: '123', unitPrice: 2, unitOfMeasure: 'KG' }),
];

interface PosSeed {
  products?: unknown[];
  settings?: Record<string, unknown>;
  tickets?: Record<string, unknown>[];
}

/** Init scripts (before the seed helper): extra products, POS settings, device id, tickets. */
async function seedPos(page: Page, opts: PosSeed = {}) {
  await page.addInitScript(({ companyId, deviceId, products, settings, tickets }) => {
    const setOnce = (key: string, value: string) => { if (localStorage.getItem(key) === null) localStorage.setItem(key, value); };
    setOnce('sync_device_id', deviceId);
    if (settings) setOnce(`pos_settings_${companyId}`, JSON.stringify({ oversell: 'BLOCK', roundingMode: 'NONE', printer: null, ...settings }));
    if (tickets.length) {
      setOnce(`tickets_db_${companyId}`, JSON.stringify({
        sequential: tickets.reduce((m, t) => Math.max(m, Number((t as { sequential: number }).sequential)), 0),
        closings: [],
        tickets,
      }));
    }
    if (!products.length) return;
    // Merge the extra products into every write of persist:products (the seed
    // helper's and redux-persist's); ids already present are left alone.
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(this: Storage, key: string, value: string) {
      if (key === 'persist:products' && typeof value === 'string') {
        try {
          const outer = JSON.parse(value);
          const list = JSON.parse(outer.products) as Array<{ id: string }>;
          const ids = new Set(list.map((p) => p.id));
          for (const p of products as Array<{ id: string }>) if (!ids.has(p.id)) list.push(p);
          outer.products = JSON.stringify(list);
          value = JSON.stringify(outer);
        } catch {
          // leave the value as written
        }
      }
      return original.call(this, key, value);
    };
  }, {
    companyId: COMPANY_ID,
    deviceId: DEVICE_ID,
    products: opts.products ?? EXTRA_PRODUCTS,
    settings: opts.settings ?? null,
    tickets: opts.tickets ?? [],
  });
}

async function openRegister(page: Page) {
  await page.goto('/#/pos');
  await waitForAppReady(page);
  await expect(page.getByTestId('pos-register')).toBeVisible();
}

const cartLines = (page: Page) => page.getByTestId('pos-cart-lines').locator('[data-testid^="pos-cart-line-"]');
const qtyInputs = (page: Page) => page.getByTestId('pos-cart-lines').locator('[data-testid^="pos-qty-input-"]');

type StoredTicket = {
  id: string;
  sequential: number;
  status: string;
  totalAmount: number;
  roundingAdjustment?: number;
  registerId?: string;
  registerCode?: string;
  voidReason?: string;
  items: Array<{ productName: string; quantity: number; lineTotal: number }>;
  payments: Array<{ method: string; amount: number; tendered?: number; change?: number }>;
};

async function storedTickets(page: Page): Promise<StoredTicket[]> {
  return page.evaluate((companyId) => {
    const raw = localStorage.getItem(`tickets_db_${companyId}`);
    return raw ? (JSON.parse(raw).tickets as StoredTicket[]) : [];
  }, COMPANY_ID);
}

async function closingTotals(page: Page) {
  await page.goto('/#/pos/closing');
  await waitForAppReady(page);
  await expect(page.getByTestId('closing-summary')).toBeVisible();
}

// ── Split payments ─────────────────────────────────────────────────────────

test.describe('Split payments', () => {
  test('Card plus cash: $20 = card $15 + cash $5 (tendered $10, change $5); the Z counts it once in both buckets', async ({ page }) => {
    await seedPos(page);
    await seedPopulatedAppState(page);
    await openRegister(page);

    await page.getByTestId('pos-product-prod-p20').click();
    await page.getByTestId('btn-charge').click();
    await expect(page.getByTestId('payment-modal')).toBeVisible();
    await page.getByTestId('pay-method-select').selectOption('TARJETA_POS');
    await page.getByTestId('pay-card-last4').fill('4242');
    await page.getByTestId('pay-amount').fill('15');
    await page.getByTestId('btn-add-payment').click();
    await expect(page.getByTestId('pay-row-0')).toContainText('$15.00');
    await expect(page.getByTestId('pay-balance')).toContainText('Saldo pendiente $5.00');
    // The rest defaults to cash; $10 received → $5 change.
    await expect(page.getByTestId('pay-method-select')).toHaveValue('EFECTIVO');
    await page.getByTestId('pay-cash-tendered').fill('10');
    await expect(page.getByTestId('pay-cash-change')).toContainText('$5.00');
    await page.getByTestId('btn-confirm-payment').click();
    await expect(page.getByText(/Ticket #1 guardado/)).toBeVisible({ timeout: 10_000 });

    const [ticket] = await storedTickets(page);
    expect(ticket.totalAmount).toBe(20);
    expect(ticket.payments).toEqual([
      expect.objectContaining({ method: 'TARJETA_POS', amount: 15 }),
      expect.objectContaining({ method: 'EFECTIVO', amount: 5, tendered: 10, change: 5 }),
    ]);

    await closingTotals(page);
    await expect(page.getByTestId('closing-summary')).toContainText(/Tickets\s*1/);
    await expect(page.getByTestId('closing-total')).toContainText('$20.00');
    const byMethod = page.getByTestId('closing-by-method');
    await expect(byMethod).toContainText('TARJETA');
    await expect(byMethod).toContainText('$15.00');
    await expect(byMethod).toContainText('EFECTIVO');
    await expect(byMethod).toContainText('$5.00');
  });

  test("Card can't overpay: $25 typed on a $20 balance is capped to $20 and the balance never goes negative", async ({ page }) => {
    await seedPos(page);
    await seedPopulatedAppState(page);
    await openRegister(page);

    await page.getByTestId('pos-product-prod-p20').click();
    await page.getByTestId('btn-charge').click();
    await page.getByTestId('pay-method-select').selectOption('TARJETA_POS');
    await page.getByTestId('pay-amount').fill('25');
    await expect(page.getByTestId('pay-amount-capped')).toContainText('$20.00');
    // A capped card payment settles the balance: nothing left to add.
    await expect(page.getByTestId('btn-add-payment')).toBeDisabled();
    await page.getByTestId('btn-confirm-payment').click();
    await expect(page.getByText(/Ticket #1 guardado/)).toBeVisible({ timeout: 10_000 });

    const [ticket] = await storedTickets(page);
    expect(ticket.totalAmount).toBe(20);
    expect(ticket.payments).toHaveLength(1);
    expect(ticket.payments[0]).toMatchObject({ method: 'TARJETA_POS', amount: 20 });
  });

  test('No rounding on a split sale: $8.47 paid $5.00 card + $3.47 cash keeps $8.47', async ({ page }) => {
    await seedPos(page, { settings: { roundingMode: 'NEAREST_0.05' } });
    await seedPopulatedAppState(page);
    await openRegister(page);

    await page.getByTestId('pos-product-prod-p847').click();
    await expect(page.getByTestId('pos-total')).toContainText('$8.47');
    await expect(page.getByTestId('pos-totals-rounding')).toContainText('$8.45'); // a single cash payment would round
    await page.getByTestId('btn-charge').click();
    await expect(page.getByRole('heading', { name: 'Cobrar $8.45' })).toBeVisible();

    await page.getByTestId('pay-method-select').selectOption('TARJETA_POS');
    await page.getByTestId('pay-amount').fill('5');
    await page.getByTestId('btn-add-payment').click();
    await expect(page.getByTestId('pay-balance')).toContainText('Saldo pendiente $3.47');
    await expect(page.getByRole('heading', { name: 'Cobrar $8.47' })).toBeVisible();
    await expect(page.getByTestId('pay-cash-rounding')).toHaveCount(0);
    await page.getByTestId('btn-confirm-payment').click(); // cash, nothing typed = exact $3.47
    await expect(page.getByText(/Ticket #1 guardado/)).toBeVisible({ timeout: 10_000 });

    const [ticket] = await storedTickets(page);
    expect(ticket.totalAmount).toBe(8.47);
    expect(ticket.roundingAdjustment).toBeUndefined();
    expect(ticket.payments).toEqual([
      expect.objectContaining({ method: 'TARJETA_POS', amount: 5 }),
      expect.objectContaining({ method: 'EFECTIVO', amount: 3.47 }),
    ]);
  });
});

// ── Suspended sales and shortcuts ──────────────────────────────────────────

test.describe('Suspended sales and register shortcuts', () => {
  test('Suspend and resume: F8 parks the sale (no stock), another customer is served, the resumed sale keeps its number and both reach the Z', async ({ page }) => {
    await seedPos(page);
    await seedPopulatedAppState(page);
    await openRegister(page);

    await page.getByTestId('pos-product-prod-003').click(); // Papel $5.50 (stock 100)
    await page.getByTestId('pos-product-prod-005').click(); // Silla $120 (stock 5)
    await expect(cartLines(page)).toHaveCount(2);
    await page.keyboard.press('F8');
    await expect(page.getByText('Venta en espera: #1')).toBeVisible();
    await expect(page.getByTestId('pos-cart-lines')).toHaveCount(0);
    await expect(page.getByTestId('btn-pos-suspended')).toContainText('(1)');
    await expect(page.getByTestId('pos-stock-prod-003')).toContainText('Stock 100'); // nothing deducted
    await expect(page.getByTestId('pos-stock-prod-005')).toContainText('Stock 5');

    // Next customer.
    await page.getByTestId('pos-product-prod-003').click();
    await page.getByTestId('btn-charge').click();
    await page.getByTestId('btn-confirm-payment').click();
    await expect(page.getByText(/Ticket #2 guardado/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('pos-stock-prod-003')).toContainText('Stock 99');

    // Resume the parked sale and charge it.
    await page.getByTestId('btn-pos-suspended').click();
    await expect(page.getByTestId('suspended-sale-1')).toContainText('$125.50');
    await page.getByTestId('btn-resume-1').click();
    await expect(page.getByTestId('pos-resumed-badge')).toBeVisible();
    await expect(cartLines(page)).toHaveCount(2);
    await expect(page.getByTestId('pos-total')).toContainText('$125.50');
    await page.keyboard.press('F2');
    await page.getByTestId('btn-confirm-payment').click();
    await expect(page.getByText(/Ticket #1 guardado/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('btn-pos-suspended')).toContainText('(0)');
    await expect(page.getByTestId('pos-stock-prod-003')).toContainText('Stock 98');
    await expect(page.getByTestId('pos-stock-prod-005')).toContainText('Stock 4');

    const tickets = await storedTickets(page);
    expect(tickets).toHaveLength(2); // the resumed sale was completed in place
    expect(tickets.find((t) => t.sequential === 1)).toMatchObject({ status: 'COMPLETED', totalAmount: 125.5 });

    await closingTotals(page);
    await expect(page.getByTestId('closing-summary')).toContainText(/Tickets\s*2/);
    await expect(page.getByTestId('closing-total')).toContainText('$131.00');
  });

  test('Discard a suspended sale: it leaves "Ventas en espera", no stock moves and it never counts as a sale', async ({ page }) => {
    await seedPos(page);
    await seedPopulatedAppState(page);
    await openRegister(page);

    await page.getByTestId('pos-product-prod-003').click();
    await page.getByTestId('btn-suspend').click();
    await expect(page.getByText('Venta en espera: #1')).toBeVisible();
    await page.getByTestId('btn-pos-suspended').click();
    await page.getByTestId('btn-discard-1').click();
    await page.getByRole('button', { name: 'Descartar', exact: true }).click();
    await expect(page.getByText('Venta en espera #1 descartada')).toBeVisible();
    await expect(page.getByTestId('btn-pos-suspended')).toContainText('(0)');
    await expect(page.getByTestId('pos-stock-prod-003')).toContainText('Stock 100');

    const [ticket] = await storedTickets(page);
    expect(ticket).toMatchObject({ status: 'VOID', voidReason: 'Venta en espera descartada' });

    await closingTotals(page);
    await expect(page.getByTestId('closing-summary')).toContainText(/Tickets\s*0/);
    await expect(page.getByTestId('closing-total')).toContainText('$0.00');
  });

  test('F4 removes the selected line and the totals update', async ({ page }) => {
    await seedPos(page);
    await seedPopulatedAppState(page);
    await openRegister(page);

    await page.getByTestId('pos-product-prod-003').click(); // Papel $5.50
    await page.getByTestId('pos-product-prod-005').click(); // Silla $120
    await expect(page.getByTestId('pos-total')).toContainText('$125.50');
    await cartLines(page).first().getByText('Papel Bond A4').click();
    await expect(cartLines(page).first()).toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('F4');
    await expect(cartLines(page)).toHaveCount(1);
    await expect(cartLines(page).first()).toContainText('Silla de Oficina');
    await expect(page.getByTestId('pos-total')).toContainText('$120.00');
  });
});

// ── Quantities, weighable products and scale barcodes ──────────────────────

test.describe('Quantities, weighable products and scale barcodes', () => {
  test('Weight from a scale label: PLU 00123 with 01250 g adds 1.250 of the product coded 123', async ({ page }) => {
    await seedPos(page, { settings: { scaleBarcodes: { enabled: true, prefix: '2', pluLength: 5, valueKind: 'weight', valueLength: 5 } } });
    await seedPopulatedAppState(page);
    await openRegister(page);

    await page.getByTestId('pos-search-input').focus();
    await page.keyboard.type('2000123012506\n'); // 2 0 00123 01250 + EAN-13 check digit
    await expect(cartLines(page)).toHaveCount(1);
    await expect(cartLines(page).first()).toContainText('Queso fresco');
    await expect(qtyInputs(page).first()).toHaveValue('1.25');
    await expect(page.getByTestId('pos-cart-lines').locator('[data-testid^="pos-line-total-"]').first()).toContainText('$2.50');
    await expect(page.getByTestId('pos-total')).toContainText('$2.50');

    // A label with a wrong check digit is never read as a weight.
    await page.keyboard.type('2000123012507\n');
    await expect(cartLines(page)).toHaveCount(1);
  });

  test('Multiplier before a scan: "3*" then the scanner adds 3 units', async ({ page }) => {
    await seedPos(page);
    await seedPopulatedAppState(page);
    await openRegister(page);

    await page.getByTestId('pos-search-input').fill('3*');
    await expect(page.getByTestId('pos-multiplier')).toContainText('3');
    await page.keyboard.type('7891234567890\n'); // laptop $850
    await expect(cartLines(page)).toHaveCount(1);
    await expect(qtyInputs(page).first()).toHaveValue('3');
    await expect(page.getByTestId('pos-total')).toContainText('$2550.00');
    await expect(page.getByTestId('pos-search-input')).toHaveValue('');

    // Same with a tile: "2*" + click.
    await page.getByTestId('pos-search-input').fill('2*');
    await page.getByTestId('pos-product-prod-003').click();
    await expect(qtyInputs(page).nth(1)).toHaveValue('2');
  });

  test('Decimal quantity only for weighable units: 1.5 on a unit product stays an integer', async ({ page }) => {
    await seedPos(page);
    await seedPopulatedAppState(page);
    await openRegister(page);

    await page.getByTestId('pos-product-prod-003').click(); // Papel, sold by the box
    const qty = qtyInputs(page).first();
    await qty.fill('1.5');
    await qty.press('Enter');
    await expect(page.getByText('Este producto se vende por unidad: la cantidad debe ser un número entero.')).toBeVisible();
    await expect(qty).toHaveValue('1');
    await expect(page.getByTestId('pos-total')).toContainText('$5.50');

    // A weighable product (KG) accepts it.
    await page.getByTestId('pos-product-prod-kg').click();
    const kg = qtyInputs(page).nth(1);
    await kg.fill('1.5');
    await kg.press('Enter');
    await expect(kg).toHaveValue('1.5');
    await expect(page.getByTestId('pos-total')).toContainText('$8.50');
  });
});

// ── Quick-create on a barcode miss ─────────────────────────────────────────

test.describe('Quick-create product on a barcode miss', () => {
  test('Create from the register: unknown barcode → "Crear producto" → product saved with that barcode and one unit in the cart', async ({ page }) => {
    await seedPos(page);
    await seedPopulatedAppState(page);
    await openRegister(page);

    await page.getByTestId('pos-search-input').focus();
    await page.keyboard.type('7400000000017\n');
    await expect(page.getByText('Código no encontrado: 7400000000017')).toBeVisible();
    await page.getByTestId('btn-quick-create').click();
    await expect(page.getByTestId('quick-create-barcode')).toHaveValue('7400000000017');
    await page.getByTestId('quick-create-name').fill('Galletas María');
    await page.getByTestId('quick-create-price').fill('1.25');
    await page.getByTestId('btn-quick-create-save').click();

    await expect(cartLines(page)).toHaveCount(1);
    await expect(cartLines(page).first()).toContainText('Galletas María');
    await expect(qtyInputs(page).first()).toHaveValue('1');
    await expect(page.getByTestId('pos-total')).toContainText('$1.25');
    await expect(page.getByTestId('pos-miss-banner')).toHaveCount(0);

    // The next scan of that code finds the new product.
    await page.getByTestId('pos-search-input').focus();
    await page.keyboard.type('7400000000017\n');
    await expect(qtyInputs(page).first()).toHaveValue('2');

    await page.goto('/#/products');
    await waitForAppReady(page);
    const list = page.getByTestId('product-list');
    await expect(list.getByText('Galletas María', { exact: true })).toBeVisible();
    await expect(list.getByText('▎7400000000017')).toBeVisible();
  });
});

// ── Registers ──────────────────────────────────────────────────────────────

test.describe('Registers', () => {
  test('Two registers, separate Zs: C1 sells $10, synced peer C2 sold $20 → C1 Z $10, X "todas las cajas" $30; numbers read C1-000002', async ({ page }) => {
    const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
    const peerAt = minutesAgo(3);
    await seedPos(page, {
      tickets: [{
        id: 'tkt_peer1', companyId: COMPANY_ID, sequential: 1, status: 'COMPLETED',
        registerId: PEER_DEVICE, registerCode: 'C2',
        items: [{ id: 'l1', productName: 'Venta C2', quantity: 1, unitPrice: 20, lineTotal: 20 }],
        payments: [{ id: 'p1', method: 'EFECTIVO', amount: 20 }],
        totalAmount: 20, taxIncluded: 2.3, createdAt: peerAt, completedAt: peerAt, printedCount: 1, updatedAt: peerAt,
      }],
    });
    await seedPopulatedAppState(page);
    await openRegister(page);

    // Name this register and give it a code.
    await page.getByTestId('btn-pos-register-settings').click();
    await page.getByTestId('register-name').fill('Caja principal');
    await page.getByTestId('register-code').fill('c1');
    await expect(page.getByTestId('register-number-preview')).toContainText('C1-000123');
    await page.getByTestId('btn-register-settings-save').click();
    await expect(page.getByText('Caja principal (C1)')).toBeVisible();

    await page.getByTestId('pos-product-prod-p10').click();
    await page.getByTestId('btn-charge').click();
    await page.getByTestId('btn-confirm-payment').click();
    await expect(page.getByText('Ticket C1-000002 guardado (sin impresora configurada)')).toBeVisible({ timeout: 10_000 });

    const mine = (await storedTickets(page)).find((t) => t.id !== 'tkt_peer1')!;
    expect(mine).toMatchObject({ registerId: DEVICE_ID, registerCode: 'C1', sequential: 2, totalAmount: 10 });

    await closingTotals(page);
    await expect(page.getByTestId('closing-total')).toContainText('$10.00'); // Z: this register only
    await page.getByTestId('closing-mode-x').click();
    await page.getByTestId('closing-register-scope').selectOption('all');
    await expect(page.getByTestId('closing-total')).toContainText('$30.00');
    await page.getByTestId('closing-register-scope').selectOption('register');
    await expect(page.getByTestId('closing-total')).toContainText('$10.00');
  });
});

// ── Ticket archive ─────────────────────────────────────────────────────────

test.describe('Ticket archive', () => {
  test('Archived ticket still reachable: out of the hot store, listed on its invoice and by a date filter, Device Sync digest unchanged', async ({ page }) => {
    // Sold and consolidated ~100 days ago (three months back): archivable.
    const sold = new Date(Date.now() - 100 * 86_400_000);
    sold.setUTCHours(18, 0, 0, 0); // 12:00 in El Salvador
    const soldISO = sold.toISOString();
    const svDay = (d: Date) => new Date(d.getTime() - 6 * 3_600_000).toISOString().slice(0, 10);
    const month = svDay(sold).slice(0, 7);
    const recentISO = new Date(Date.now() - 5 * 60_000).toISOString();
    const archived = {
      id: 'tkt_old7', companyId: COMPANY_ID, sequential: 7, status: 'CONSOLIDATED',
      invoiceId: 'inv-001', invoiceControlNumber: 'DTE-01-M001-000000001', consolidatedAt: soldISO,
      items: [{ id: 'l1', productId: 'prod-003', productName: 'Papel Bond A4', quantity: 2, unitPrice: 5.5, lineTotal: 11 }],
      payments: [{ id: 'p1', method: 'EFECTIVO', amount: 11 }],
      totalAmount: 11, taxIncluded: 1.27, createdAt: soldISO, completedAt: soldISO, printedCount: 1, updatedAt: soldISO,
    };
    const recent = {
      id: 'tkt_new8', companyId: COMPANY_ID, sequential: 8, status: 'COMPLETED',
      items: [{ id: 'l1', productId: 'prod-003', productName: 'Papel Bond A4', quantity: 1, unitPrice: 5.5, lineTotal: 5.5 }],
      payments: [{ id: 'p1', method: 'EFECTIVO', amount: 5.5 }],
      totalAmount: 5.5, taxIncluded: 0.63, createdAt: recentISO, completedAt: recentISO, printedCount: 0, updatedAt: recentISO,
    };
    await seedPos(page, { tickets: [archived, recent] }); // a legacy single-key DB
    await seedPopulatedAppState(page);

    // Loading the ticket store runs the archive pass.
    await page.goto('/#/pos/tickets');
    await waitForAppReady(page);
    await expect(page.getByTestId('ticket-row-8')).toBeVisible();
    await expect.poll(() => page.evaluate((companyId) => {
      const hot = JSON.parse(localStorage.getItem(`tickets_db_${companyId}`) ?? '{}');
      return { hot: (hot.tickets ?? []).map((t: { id: string }) => t.id), index: hot.archive?.ids ?? {} };
    }, COMPANY_ID)).toEqual({ hot: ['tkt_new8'], index: { tkt_old7: month } });
    const archivedIds = await page.evaluate(({ companyId, m }) =>
      (JSON.parse(localStorage.getItem(`tickets_archive_${companyId}_${m}`) ?? '{"tickets":[]}').tickets as Array<{ id: string }>).map((t) => t.id),
    { companyId: COMPANY_ID, m: month });
    expect(archivedIds).toEqual(['tkt_old7']);

    // The ticket list's date filter on that month shows it.
    const dayBefore = svDay(new Date(sold.getTime() - 86_400_000));
    const dayAfter = svDay(new Date(sold.getTime() + 86_400_000));
    await page.getByTestId('ticket-filter-from').fill(dayBefore);
    await page.getByTestId('ticket-filter-to').fill(dayAfter);
    await expect(page.getByTestId('ticket-row-7')).toBeVisible();
    await expect(page.getByTestId('ticket-row-7')).toContainText('$11.00');

    // The invoice it was consolidated into still lists it.
    await page.goto('/#/invoices/inv-001');
    await waitForAppReady(page);
    await expect(page.getByTestId('invoice-ticket-7')).toBeVisible();

    // Device Sync lists hot + archived: the digest equals a peer that never archived.
    const digests = await page.evaluate(async ({ companyId, seeded }) => {
      const adapters = await import('/src/services/sync/entityAdapters.ts');
      const digestService = await import('/src/services/sync/digestService.ts');
      const ctx = { co: 'co-test', companyId, getState: () => ({}), dispatch: () => undefined };
      const listed = await adapters.listLocalEntities(ctx as never, 'ticket');
      const items = (list: Array<{ id: string; updatedAt?: unknown }>) => list.map((t) => ({ key: t.id, u: String(t.updatedAt) }));
      return {
        local: digestService.buildDigest('ticket', items(listed as never)),
        peer: digestService.buildDigest('ticket', items(seeded)),
      };
    }, { companyId: COMPANY_ID, seeded: [archived, recent] });
    expect(digests.local).toEqual(digests.peer);
    expect(digests.local.count).toBe(2);
  });
});

// ── Dashboard POS card ─────────────────────────────────────────────────────

test.describe('Dashboard POS card', () => {
  test("Card reflects today: two tickets sold today show 2 tickets and their total, plus the month's unconsolidated reminder", async ({ page }) => {
    await seedPos(page);
    await seedPopulatedAppState(page);

    await page.goto('/#/home');
    await waitForAppReady(page);
    await expect(page.getByTestId('dashboard')).toBeVisible();
    await expect(page.getByTestId('dashboard-pos-card')).toHaveCount(0); // POS never used

    await openRegister(page);
    for (const id of ['pos-product-prod-003', 'pos-product-prod-p10']) {
      await page.getByTestId(id).click();
      await page.getByTestId('btn-charge').click();
      await page.getByTestId('btn-confirm-payment').click();
      await expect(page.getByTestId('pos-cart-lines')).toHaveCount(0);
    }

    await page.goto('/#/home');
    await waitForAppReady(page);
    await expect(page.getByTestId('dashboard-pos-card')).toBeVisible();
    await expect(page.getByTestId('dashboard-pos-today-count')).toContainText('2 tickets');
    await expect(page.getByTestId('dashboard-pos-today-amount')).toContainText('$15.50');
    await expect(page.getByTestId('dashboard-pos-unconsolidated')).toContainText('2 tickets · $15.50');
    await page.getByTestId('dashboard-pos-consolidate').click();
    await expect(page).toHaveURL(/#\/pos\/consolidate/);
  });
});
