/**
 * POS Phase 2 — cash management, Z breakdowns and partial returns
 * (openspec/changes/add-pos-phase-2, tasks 2.1–2.8). One test per scenario of
 * the "Cash management and arqueo", "Z breakdowns" and "Partial returns"
 * requirements (+ the per-register Z the cierre now does).
 *
 * Tickets, closings and cash sessions are seeded straight into appStorage
 * (localStorage on the web build) so the cases don't depend on the payment
 * dialog; the printer bridge is stubbed to capture the printed payloads.
 */

import { test, expect, type Page } from '@playwright/test';
import { seedPopulatedAppState, waitForAppReady } from '../../fixtures/seed-state';
import { seedProUserWithGoogleAuth, PRO_USER } from '../../fixtures/pro-state';

const COMPANY_ID = '1'; // seedPopulatedAppState / seedProUserWithGoogleAuth → TEST_COMPANY
const DEVICE_ID = '11111111-1111-4111-8111-111111111111'; // this register (Device Sync device id)
const PEER_DEVICE = '22222222-2222-4222-8222-222222222222';

type SeedTicket = Record<string, unknown>;

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

let seq = 0;
function seedTicket(over: {
  lines: Array<{ id?: string; productId?: string; name: string; q: number; p: number }>;
  discountTotal?: number;
  method?: 'EFECTIVO' | 'TARJETA_POS';
  at?: string;
  [key: string]: unknown;
}): SeedTicket {
  seq += 1;
  const { lines, discountTotal, method, at, ...rest } = over;
  const items = lines.map((l, i) => ({
    id: l.id ?? `l${i + 1}`,
    productId: l.productId,
    productName: l.name,
    quantity: l.q,
    unitPrice: l.p,
    lineTotal: Math.round(l.q * l.p * 100) / 100,
  }));
  const total = Math.round((items.reduce((s, l) => s + l.lineTotal, 0) - (discountTotal ?? 0)) * 100) / 100;
  // Minutes, not hours: the ticket list / consolidation default to today / this month.
  const when = at ?? minutesAgo(2);
  return {
    id: `tkt_seed${seq}`,
    companyId: COMPANY_ID,
    sequential: Number(rest.sequential ?? seq),
    status: 'COMPLETED',
    items,
    payments: [{ id: `p${seq}`, method: method ?? 'EFECTIVO', amount: total }],
    discountTotal,
    totalAmount: total,
    taxIncluded: Math.round((total - total / 1.13) * 100) / 100,
    createdAt: when,
    completedAt: when,
    printedCount: 1,
    updatedAt: when,
    ...rest,
  };
}

/**
 * Register init scripts BEFORE the seed helper loads the document. Seeds are
 * written only when absent: a reload must not wipe what the test just did.
 */
async function seedPos(page: Page, opts: {
  tickets?: SeedTicket[];
  closings?: unknown[];
  cashSession?: { openingFloat: number; openedAt?: string };
  printer?: boolean;
} = {}) {
  await page.addInitScript(({ companyId, deviceId, tickets, closings, cashSession, printer }) => {
    const setOnce = (key: string, value: string) => { if (localStorage.getItem(key) === null) localStorage.setItem(key, value); };
    setOnce('sync_device_id', deviceId);
    if (tickets.length || closings.length) {
      setOnce(`tickets_db_${companyId}`, JSON.stringify({
        sequential: tickets.reduce((m, t) => Math.max(m, Number((t as { sequential: number }).sequential)), 0),
        closings,
        tickets,
      }));
    }
    if (cashSession) {
      setOnce(`pos_cash_${companyId}`, JSON.stringify({
        sessions: [{ id: 'cash_seed', companyId, registerId: deviceId, openedAt: cashSession.openedAt, openedBy: 'Pro Usuario', openingFloat: cashSession.openingFloat }],
        movements: [],
      }));
    }
    if (printer) {
      const payloads: unknown[] = [];
      (window as unknown as { __printed: unknown[] }).__printed = payloads;
      (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
        printerList: async () => [],
        printerStatus: async () => ({ ok: true }),
        printerPrint: async (_config: unknown, payload: unknown) => {
          payloads.push(payload);
          return { ok: true, transport: 'network' };
        },
      };
      setOnce(`pos_settings_${companyId}`, JSON.stringify({
        oversell: 'BLOCK',
        roundingMode: 'NONE',
        printer: {
          transport: 'network',
          network: { host: '10.0.0.5', port: 9100, timeoutMs: 4000 },
          spooler: { printerName: '' },
          paper: { widthMm: 80, copies: 1, cut: true },
          headerLines: [],
          footerLines: [],
          cashDrawerKick: false,
        },
      }));
    }
  }, {
    companyId: COMPANY_ID,
    deviceId: DEVICE_ID,
    tickets: opts.tickets ?? [],
    closings: opts.closings ?? [],
    cashSession: opts.cashSession ? { openingFloat: opts.cashSession.openingFloat, openedAt: opts.cashSession.openedAt ?? minutesAgo(120) } : null,
    printer: !!opts.printer,
  });
}

type PrintedPayload = { kind: string; blocks: Array<{ text: string }> };
const printed = (page: Page) => page.evaluate(() => (window as unknown as { __printed?: PrintedPayload[] }).__printed ?? []);
const printedText = (payload: PrintedPayload) => payload.blocks.map((b) => b.text).join('\n');

/** Lock the app and unlock as another local user (settings/03 helper pattern). */
async function switchUserTo(page: Page, username: string, pin: string) {
  await page.getByTestId('sidebar-switch-user').click();
  await expect(page.getByTestId('local-lock-screen')).toBeVisible();
  const card = page.getByTestId(`lock-user-${username}`);
  if (!(await card.isVisible()) && (await page.getByTestId('lock-change-user').isVisible())) {
    await page.getByTestId('lock-change-user').click();
  }
  await page.getByTestId(`lock-user-${username}`).click();
  await page.getByTestId('lock-pin-input').fill(pin);
  await page.getByTestId('lock-submit').click();
  await expect(page.getByTestId('local-lock-screen')).toBeHidden();
}

async function goto(page: Page, hash: string) {
  await page.goto(`/${hash}`);
  await waitForAppReady(page);
}

// ── Cash management and arqueo ─────────────────────────────────────────────

test.describe('Cash management and arqueo', () => {
  test('Shortage at the Z: float $50, $30 cash sale, $10 out, $68 counted → expected $70, faltante -$2.00 saved and printed', async ({ page }) => {
    await seedPos(page, { printer: true, tickets: [seedTicket({ lines: [{ name: 'Venta mostrador', q: 1, p: 30 }], at: minutesAgo(5) })] });
    await seedPopulatedAppState(page);

    // Abrir caja on the register with a $50 float.
    await goto(page, '#/pos');
    await expect(page.getByTestId('cash-drawer-closed-banner')).toContainText('Caja sin abrir');
    await page.getByTestId('btn-open-cash-drawer').click();
    await page.getByTestId('cash-open-float-input').fill('50');
    await page.getByTestId('btn-confirm-open-cash').click();
    await expect(page.getByTestId('cash-drawer-open-info')).toContainText('Fondo $50.00');

    // $10 out for a supplier.
    await page.getByTestId('btn-cash-movement').click();
    await page.getByTestId('cash-movement-kind').selectOption('OUT');
    await page.getByTestId('cash-movement-amount').fill('10');
    await page.getByTestId('cash-movement-reason').fill('Pago a proveedor de pan');
    await page.getByTestId('btn-confirm-cash-movement').click();
    await expect(page.getByTestId('cash-drawer-out')).toContainText('$10.00');

    // Arqueo at the Z.
    await goto(page, '#/pos/closing');
    const cash = page.getByTestId('closing-cash');
    await expect(cash.getByTestId('closing-cash-float')).toContainText('$50.00');
    await expect(cash.getByTestId('closing-cash-sales')).toContainText('$30.00');
    await expect(cash.getByTestId('closing-cash-out')).toContainText('-$10.00');
    await expect(cash.getByTestId('closing-cash-expected')).toContainText('$70.00');
    await page.getByTestId('closing-cash-counted').fill('68');
    await expect(page.getByTestId('closing-cash-difference')).toHaveText('Faltante -$2.00');
    await expect(page.getByTestId('closing-cash-difference')).toHaveAttribute('data-kind', 'faltante');

    await page.getByTestId('btn-close-z').click();
    await expect(page.getByText('Cierre Z registrado e impreso')).toBeVisible({ timeout: 10_000 });

    // The saved closing shows both…
    const row = page.getByTestId('closing-history').locator('[data-testid^="closing-row-cash-"]').first();
    await expect(row).toContainText('Esperado $70.00');
    await expect(row).toContainText('Contado $68.00');
    await expect(row).toContainText('Faltante -$2.00');
    // …and so does the printed Z.
    const z = (await printed(page)).find((p) => p.kind === 'Z_REPORT');
    expect(z).toBeTruthy();
    const text = printedText(z!);
    expect(text).toContain('ARQUEO DE EFECTIVO');
    expect(text).toMatch(/Fondo inicial\s+\$50\.00/);
    expect(text).toMatch(/Salidas de efectivo\s+-\$10\.00/);
    expect(text).toMatch(/Efectivo esperado\s+\$70\.00/);
    expect(text).toMatch(/Efectivo contado\s+\$68\.00/);
    expect(text).toMatch(/FALTANTE\s+-\$2\.00/);

    // The Z closed the cash session: the next shift opens the register again.
    await expect(page.getByTestId('cash-drawer-closed-banner')).toBeVisible();
  });

  test('Cash out requires permission: a cashier without "Entradas/salidas de efectivo" sees the action disabled (also returns without "Devoluciones")', async ({ page }) => {
    test.setTimeout(60_000);
    await seedPos(page, { tickets: [seedTicket({ sequential: 1, lines: [{ productId: 'prod-003', name: 'Papel Bond A4', q: 3, p: 2 }] })] });
    await seedProUserWithGoogleAuth(page);

    // Enable user control (Gmail admin) and create a cashier with Nueva venta + Tickets only.
    await page.goto('/#/settings/users');
    await expect(page.getByTestId('local-users-intro')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('local-users-owner-email')).toHaveText(PRO_USER.email);
    await page.getByTestId('btn-enable-local-users').click();
    await page.getByTestId('pin-set-pin').fill('1234');
    await page.getByTestId('pin-set-confirm').fill('1234');
    await page.getByTestId('pin-set-save').click();
    await expect(page.getByTestId('local-users-owner')).toBeVisible();
    await page.getByTestId('btn-new-local-user').click();
    await page.getByTestId('user-form-name').fill('Carlos Caja');
    await page.getByTestId('user-form-pin').fill('7777');
    await page.getByTestId('user-form-pin-confirm').fill('7777');
    await page.getByTestId('user-form-preset-none').click();
    await page.getByTestId('user-form-perm-pos.sell').check();
    await page.getByTestId('user-form-perm-pos.tickets').check();
    // Both new action permissions are offered and left unticked.
    await expect(page.getByTestId('user-form-perm-pos.cash')).not.toBeChecked();
    await expect(page.getByTestId('user-form-perm-pos.return')).not.toBeChecked();
    await page.getByTestId('user-form-save').click();
    await expect(page.getByTestId('user-form')).toBeHidden();

    await switchUserTo(page, 'carlos', '7777');

    // The cashier opens the register (allowed) but cash in/out stays disabled.
    await goto(page, '#/pos');
    await page.getByTestId('btn-open-cash-drawer').click();
    await page.getByTestId('cash-open-float-input').fill('20');
    await page.getByTestId('btn-confirm-open-cash').click();
    const cashButton = page.getByTestId('btn-cash-movement');
    await expect(cashButton).toBeDisabled();
    await expect(cashButton).toHaveAttribute('data-locked', 'permission');
    await expect(page.getByTestId('cash-movement-hint')).toHaveAttribute('title', /Sin permiso/);

    // Returns are a separate action permission too.
    await goto(page, '#/pos/tickets');
    const returnButton = page.getByTestId('btn-return-ticket-1');
    await expect(returnButton).toBeDisabled();
    await expect(returnButton).toHaveAttribute('data-locked', 'permission');
    await expect(page.getByTestId('return-ticket-hint-1')).toHaveAttribute('title', 'Sin permiso para devoluciones');

    // The admin can move cash.
    await switchUserTo(page, 'pro', '1234');
    await goto(page, '#/pos');
    await expect(page.getByTestId('btn-cash-movement')).toBeEnabled();
  });
});

// ── Z breakdowns (+ Z per register) ────────────────────────────────────────

test.describe('Z breakdowns', () => {
  test('Two cashiers: the Z lists Ana $10 (1) and Beto $15 (1), plus the per-product summary and the discount total', async ({ page }) => {
    await seedPos(page, {
      tickets: [
        seedTicket({ cashierName: 'Ana', lines: [{ productId: 'prod-003', name: 'Papel Bond A4', q: 2, p: 5 }] }),
        seedTicket({ cashierName: 'Beto', discountTotal: 1, lines: [{ productId: 'prod-005', name: 'Silla de Oficina', q: 1, p: 16 }] }),
      ],
    });
    await seedPopulatedAppState(page);
    await goto(page, '#/pos/closing');

    await expect(page.getByTestId('closing-total')).toContainText('$25.00');
    await expect(page.getByTestId('closing-cashier-ana')).toContainText('Ana (1)');
    await expect(page.getByTestId('closing-cashier-ana')).toContainText('$10.00');
    await expect(page.getByTestId('closing-cashier-beto')).toContainText('Beto (1)');
    await expect(page.getByTestId('closing-cashier-beto')).toContainText('$15.00');
    await expect(page.getByTestId('closing-by-product')).toContainText('Silla de Oficina');
    await expect(page.getByTestId('closing-product-p-prod-003')).toContainText('× 2');
    await expect(page.getByTestId('closing-product-p-prod-003')).toContainText('$10.00');
    await expect(page.getByTestId('closing-product-p-prod-005')).toContainText('$15.00');
    await expect(page.getByTestId('closing-discount-total')).toContainText('-$1.00');
  });

  test('Z per register: C1 closes its own $10; the X with "Todas las cajas" shows $30', async ({ page }) => {
    await seedPos(page, {
      tickets: [
        seedTicket({ registerId: DEVICE_ID, registerCode: 'C1', lines: [{ name: 'Venta C1', q: 1, p: 10 }] }),
        seedTicket({ registerId: PEER_DEVICE, registerCode: 'C2', lines: [{ name: 'Venta C2', q: 1, p: 20 }] }),
      ],
    });
    await seedPopulatedAppState(page);
    await goto(page, '#/pos/closing');

    await expect(page.getByTestId('closing-total')).toContainText('$10.00');
    await page.getByTestId('closing-mode-x').click();
    await expect(page.getByTestId('closing-total')).toContainText('$10.00');
    await page.getByTestId('closing-register-scope').selectOption('all');
    await expect(page.getByTestId('closing-total')).toContainText('$30.00');
  });
});

// ── Partial returns ────────────────────────────────────────────────────────

test.describe('Partial returns', () => {
  test('Return one unit: stock +1, refund $2.00, slip printed, next Z shows a $2.00 cash refund and expected cash drops by $2.00', async ({ page }) => {
    const sale = seedTicket({ sequential: 1, at: minutesAgo(3), lines: [{ productId: 'prod-003', name: 'Papel Bond A4', q: 3, p: 2 }] });
    // An earlier Z of this register already closed the sale.
    const earlierZ = {
      id: 'close_seed', companyId: COMPANY_ID, registerId: DEVICE_ID, closedAt: minutesAgo(2), from: '', to: minutesAgo(2),
      ticketIds: [sale.id],
      totals: { ticketCount: 1, voidedCount: 0, grossTotal: 6, netTotal: 6, ivaIncluded: 0.69, exemptTotal: 0, byMethod: { EFECTIVO: { count: 1, amount: 6, cashTendered: 6, cashChange: 0 }, TARJETA_POS: { count: 0, amount: 0, cashTendered: 0, cashChange: 0 }, OTRO: { count: 0, amount: 0, cashTendered: 0, cashChange: 0 } } },
    };
    await seedPos(page, { printer: true, tickets: [sale], closings: [earlierZ], cashSession: { openingFloat: 50, openedAt: minutesAgo(1) } });
    await seedPopulatedAppState(page); // Papel Bond A4 starts with stock 100

    await goto(page, '#/pos/tickets');
    await page.getByTestId('btn-return-ticket-1').click();
    await expect(page.getByTestId('return-dialog')).toBeVisible();
    await page.getByTestId('return-qty-0').fill('1');
    await expect(page.getByTestId('return-line-refund-0')).toHaveText('$2.00');
    await expect(page.getByTestId('return-refund-total')).toContainText('$2.00');
    await expect(page.getByTestId('return-method')).toHaveValue('EFECTIVO');
    await page.getByTestId('return-reason').fill('Producto dañado');
    await page.getByTestId('btn-confirm-return').click();
    await expect(page.getByText(/Devolución registrada — reembolso \$2\.00/)).toBeVisible({ timeout: 10_000 });

    const detail = page.getByTestId('ticket-detail-1');
    await expect(detail.getByTestId('ticket-returns')).toContainText('Motivo: Producto dañado');
    await expect(detail.getByTestId('ticket-detail-refunds')).toContainText('-$2.00');
    await expect(detail.getByTestId('ticket-detail-kept')).toContainText('$4.00');
    await expect(detail).toContainText('(devueltas 1)');

    // Non-fiscal return slip.
    await expect.poll(async () => (await printed(page)).filter((p) => p.kind === 'RETURN_SLIP').length).toBe(1);
    const slip = printedText((await printed(page)).find((p) => p.kind === 'RETURN_SLIP')!);
    expect(slip).toContain('COMPROBANTE DE DEVOLUCIÓN');
    expect(slip).toMatch(/REEMBOLSO\s+\$2\.00/);
    expect(slip).toContain('Documento no fiscal');

    // Restocked once.
    await goto(page, '#/pos');
    await expect(page.getByTestId('pos-stock-prod-003')).toContainText('Stock 101');

    // The next Z: a $2.00 cash refund that lowers the expected cash (50 − 2).
    await goto(page, '#/pos/closing');
    await expect(page.getByTestId('closing-refunds')).toContainText('-$2.00');
    await expect(page.getByTestId('closing-refund-EFECTIVO')).toContainText('-$2.00');
    await expect(page.getByTestId('closing-net')).toContainText('-$2.00');
    await expect(page.getByTestId('closing-cash-refunds')).toContainText('-$2.00');
    await expect(page.getByTestId('closing-cash-expected')).toContainText('$48.00');
  });

  test('Consolidation invoices only what was kept: quantity 2, draft $4.00, reconciliation balances', async ({ page }) => {
    const sale = seedTicket({
      sequential: 1,
      lines: [{ productId: 'prod-003', name: 'Papel Bond A4', q: 3, p: 2 }],
      returns: [{ id: 'ret_seed', createdAt: minutesAgo(1), createdBy: 'Ana', reason: 'dañado', lines: [{ lineId: 'l1', quantity: 1, amount: 2 }], refund: { method: 'EFECTIVO', amount: 2 } }],
    });
    await seedPos(page, { tickets: [sale] });
    await seedPopulatedAppState(page); // Pro → consolidation allowed

    await goto(page, '#/pos/consolidate');
    await expect(page.getByTestId('consolidate-ticket-returned-1')).toContainText('-$2.00');
    await page.getByTestId('chk-ticket-1').check();
    await page.getByTestId('btn-review-selection').click();

    const preview = page.getByTestId('consolidate-preview');
    await expect(preview.locator('tbody tr')).toHaveCount(1);
    await expect(preview.locator('tbody tr').first().locator('td').nth(1)).toHaveText('2');
    await expect(page.getByTestId('consolidate-preview-total')).toContainText('$4.00');
    const recon = page.getByTestId('consolidate-reconciliation');
    await expect(recon.getByTestId('recon-period')).toContainText('$6.00');
    await expect(recon.getByTestId('recon-returned')).toContainText('-$2.00');
    await expect(recon.getByTestId('recon-included')).toContainText('$4.00');
    await expect(recon.getByTestId('recon-draft-total')).toContainText('$4.00');
    await expect(recon.getByTestId('recon-difference')).toHaveAttribute('data-balanced', 'true');

    await page.getByTestId('btn-generate-draft').click();
    await expect(page.getByTestId('confirm-draft-total')).toContainText('$4.00');
    await page.getByTestId('btn-confirm-consolidation').click();
    await expect(page.getByTestId('consolidation-created')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('consolidation-created').locator('a[data-testid^="link-invoice-"]').click();
    await waitForAppReady(page);
    await expect(page.getByTestId('invoice-tickets-expected')).toContainText('4.00');
    await expect(page.getByTestId('invoice-tickets-refunds')).toContainText('-$2.00');
    await expect(page.getByTestId('invoice-tickets-difference')).toHaveAttribute('data-balanced', 'true');
  });

  test('Return refused after invoicing: "Emite una nota de crédito sobre la factura"', async ({ page }) => {
    await seedPos(page, {
      tickets: [
        seedTicket({ sequential: 1, status: 'CONSOLIDATED', invoiceId: 'inv_1', invoiceControlNumber: 'DTE-01-M001P001-000000000000001', consolidatedAt: minutesAgo(5), lines: [{ productId: 'prod-003', name: 'Papel Bond A4', q: 2, p: 2 }] }),
        seedTicket({ sequential: 2, pendingInvoiceId: 'inv_draft', lines: [{ productId: 'prod-003', name: 'Papel Bond A4', q: 1, p: 2 }] }),
      ],
    });
    await seedPopulatedAppState(page);
    await goto(page, '#/pos/tickets');

    const invoiced = page.getByTestId('btn-return-ticket-1');
    await expect(invoiced).toBeDisabled();
    await expect(invoiced).toHaveAttribute('data-locked', 'invoiced');
    await expect(page.getByTestId('return-ticket-hint-1')).toHaveAttribute('title', /Emite una nota de crédito sobre la factura/);
    await page.getByTestId('ticket-row-1').locator('button').first().click();
    await expect(page.getByTestId('ticket-return-blocked')).toContainText('Emite una nota de crédito sobre la factura');
    await expect(page.getByTestId('btn-return-from-detail')).toBeDisabled();
    await page.mouse.click(5, 5); // close the detail overlay

    // A ticket waiting on a draft is refused too.
    await expect(page.getByTestId('btn-return-ticket-2')).toHaveAttribute('data-locked', 'pending-invoice');
    await expect(page.getByTestId('return-ticket-hint-2')).toHaveAttribute('title', /borrador de factura/);
  });

  test('Return with ticket discount: 2 × $5.00 with a $1.00 discount, one unit back refunds $4.50; a later void refunds only the rest', async ({ page }) => {
    await seedPos(page, { tickets: [seedTicket({ sequential: 1, discountTotal: 1, lines: [{ productId: 'prod-003', name: 'Papel Bond A4', q: 2, p: 5 }] })] });
    await seedPopulatedAppState(page);
    await goto(page, '#/pos/tickets');
    await expect(page.getByTestId('ticket-row-1')).toContainText('$9.00');

    await page.getByTestId('btn-return-ticket-1').click();
    await page.getByTestId('return-qty-0').fill('1');
    await expect(page.getByTestId('return-refund-total')).toContainText('$4.50');
    await page.getByTestId('return-reason').fill('No le quedó');
    await page.getByTestId('btn-confirm-return').click();
    await expect(page.getByText(/Devolución registrada — reembolso \$4\.50/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('ticket-detail-kept')).toContainText('$4.50');
    await expect(page.getByTestId('ticket-returned-badge-1')).toContainText('-$4.50');

    // Close the detail and void what is left: refund $4.50, not $9.00.
    await page.mouse.click(5, 5);
    await page.getByTestId('btn-void-ticket-1').click();
    await page.getByTestId('void-reason-input').fill('cliente devolvió el resto');
    await page.getByRole('button', { name: /anular ticket/i }).click();
    await expect(page.getByText(/reembolso de \$4\.50 \(lo que quedaba\)/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('ticket-row-1')).toContainText('Anulado');
  });
});
