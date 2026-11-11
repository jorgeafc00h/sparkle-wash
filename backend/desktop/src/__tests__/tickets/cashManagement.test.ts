// POS Phase 2 — cash management (design §6), Z breakdowns (§7) and the
// partial-return restock reducer (§8).

jest.mock('@/services/storage/ElectronStorage', () => {
  const map = new Map<string, string>();
  const storage = {
    getItem: jest.fn(async (key: string) => (map.has(key) ? map.get(key)! : null)),
    setItem: jest.fn(async (key: string, value: string) => { map.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { map.delete(key); }),
    clear: jest.fn(async () => { map.clear(); }),
    getAllKeys: jest.fn(async () => Array.from(map.keys())),
  };
  return { appStorage: storage, electronPersistStorage: storage };
});

import {
  buildCashClosing,
  cashDifferenceLabel,
  closingSaleIds,
  closingsForRegister,
  computeCashSummary,
  computeRangeTotals,
  computeXReport,
  computeZReport,
  CLOSING_TOP_PRODUCTS,
} from '@/services/tickets/ClosingService';
import { CashDrawerStore, CASH_SESSION_REQUIRED_MESSAGE } from '@/services/tickets/CashDrawerStore';
import reducer, { applyTicketStockDeduction, restoreTicketReturnStock, restoreTicketStock } from '@/store/slices/productSlice';
import type { ProductState } from '@/types';
import type { Product } from '@/types/product';
import type { CashClosing, PaymentMethod, Ticket } from '@/types/ticket';

const day = (h: number, m = 0) => new Date(2026, 9, 31, h, m).toISOString();

let seq = 0;
function ticket(over: Partial<Ticket> & { amount?: number; method?: PaymentMethod } = {}): Ticket {
  seq += 1;
  const amount = over.amount ?? 10;
  const at = over.createdAt ?? day(9, seq % 60);
  const { amount: _a, method, ...rest } = over;
  return {
    id: `t${seq}`,
    companyId: 'co',
    sequential: seq,
    status: 'COMPLETED',
    items: [{ id: `l${seq}`, productId: 'A', productName: 'Café', quantity: 1, unitPrice: amount, lineTotal: amount }],
    payments: [{ id: `p${seq}`, method: method ?? 'EFECTIVO', amount }],
    totalAmount: amount,
    taxIncluded: 0,
    createdAt: at,
    completedAt: at,
    printedCount: 0,
    updatedAt: at,
    ...rest,
  };
}

describe('arqueo de efectivo', () => {
  it('Shortage at the Z: float $50 + $30 cash sales − $10 out = $70 expected; counted $68 → faltante −$2.00', () => {
    const totals = computeZReport([ticket({ amount: 30 })], null, day(18));
    const cash = computeCashSummary({ totals, openingFloat: 50, movements: [{ kind: 'OUT', amount: 10 }], counted: 68 });
    expect(cash).toMatchObject({ openingFloat: 50, cashSales: 30, cashRefunds: 0, cashIn: 0, cashOut: 10, expected: 70, counted: 68, difference: -2 });
    expect(cashDifferenceLabel(cash.difference)).toBe('Faltante');
    expect(cashDifferenceLabel(1)).toBe('Sobrante');
    expect(cashDifferenceLabel(0)).toBe('Cuadra');
    expect(cashDifferenceLabel(undefined)).toBe('Sin conteo');
  });

  it('card sales never enter the drawer; cash in adds; no count → no difference', () => {
    const totals = computeZReport([ticket({ amount: 30 }), ticket({ amount: 20, method: 'TARJETA_POS' })], null, day(18));
    const cash = computeCashSummary({ totals, openingFloat: 25, movements: [{ kind: 'IN', amount: 5 }] });
    expect(cash.expected).toBe(60);
    expect(cash.counted).toBeUndefined();
    expect(cash.difference).toBeUndefined();
  });

  it('earlier-Z voids paid in cash reduce the expected cash', () => {
    const voided = ticket({ amount: 8, createdAt: day(8), status: 'VOID', voidedAt: day(14) });
    const totals = computeZReport([voided, ticket({ amount: 30, createdAt: day(13) })], day(12), day(18));
    expect(computeCashSummary({ totals, openingFloat: 0 }).expected).toBe(22);
  });

  it('the closing stores the arqueo and the register', () => {
    const tickets = [ticket({ amount: 30 })];
    const totals = computeZReport(tickets, null, day(18), { registerId: 'dev-1' });
    const cash = computeCashSummary({ totals, openingFloat: 50, counted: 80 });
    const closing = buildCashClosing('co', tickets, '', day(18), totals, { registerId: 'dev-1', registerCode: 'C1', cash });
    expect(closing).toMatchObject({ registerId: 'dev-1', registerCode: 'C1', cash: { expected: 80, difference: 0 } });
    expect(closing.totals.registerId).toBe('dev-1');
  });
});

describe('Z breakdowns', () => {
  it('Two cashiers: Ana $10 (1) and Beto $15 (1)', () => {
    const totals = computeZReport([ticket({ amount: 10, cashierName: 'Ana' }), ticket({ amount: 15, cashierName: 'Beto' })], null, day(18));
    expect(totals.byCashier).toEqual({ Ana: { count: 1, amount: 10 }, Beto: { count: 1, amount: 15 } });
  });

  it('a voided sale counts for no cashier; unnamed sales go to "Sin cajero"', () => {
    const totals = computeZReport([
      ticket({ amount: 10, cashierName: 'Ana', status: 'VOID', voidedAt: day(10) }),
      ticket({ amount: 7 }),
    ], null, day(18));
    expect(totals.byCashier).toEqual({ 'Sin cajero': { count: 1, amount: 7 } });
  });

  it('per-product summary with discounts allocated, top products + "Otros"; discount total', () => {
    const t = ticket({
      items: [
        { id: 'a', productId: 'A', productName: 'Café', quantity: 2, unitPrice: 5, lineTotal: 9, discount: 1 },
        { id: 'b', productId: 'B', productName: 'Pan', quantity: 1, unitPrice: 1, lineTotal: 1 },
      ],
      discountTotal: 1,
      totalAmount: 9,
      payments: [{ id: 'p', method: 'EFECTIVO', amount: 9 }],
    });
    const totals = computeZReport([t], null, day(18));
    expect(totals.discountTotal).toBe(2);
    expect(totals.byProduct).toEqual([
      { key: 'p:A', name: 'Café', quantity: 2, amount: 8.1 },
      { key: 'p:B', name: 'Pan', quantity: 1, amount: 0.9 },
    ]);

    const many = Array.from({ length: CLOSING_TOP_PRODUCTS + 3 }, (_, i) =>
      ticket({ amount: i + 1, items: [{ id: `x${i}`, productId: `P${i}`, productName: `Prod ${i}`, quantity: 1, unitPrice: i + 1, lineTotal: i + 1 }] }));
    const big = computeZReport(many, null, day(18));
    expect(big.byProduct).toHaveLength(CLOSING_TOP_PRODUCTS + 1);
    expect(big.byProduct![CLOSING_TOP_PRODUCTS]).toMatchObject({ key: 'otros', name: 'Otros (3)', quantity: 3, amount: 6 });
  });
});

describe('registers', () => {
  const c1 = ticket({ amount: 10, registerId: 'C1' });
  const c2 = ticket({ amount: 20, registerId: 'C2' });
  const legacy = ticket({ amount: 5 });

  it('Two registers, separate Zs: C1 Z $10 (+ its legacy tickets), X "todas las cajas" $30 (+ legacy)', () => {
    expect(computeZReport([c1, c2], null, day(18), { registerId: 'C1' }).grossTotal).toBe(10);
    expect(computeXReport([c1, c2], '', day(18)).grossTotal).toBe(30);
    expect(computeZReport([c1, c2, legacy], null, day(18), { registerId: 'C1' }).grossTotal).toBe(15);
    expect(closingSaleIds([c1, c2, legacy], '', day(18), 'C2')).toEqual([c2.id, legacy.id]);
  });

  it('a register only sees its own closings (and legacy ones)', () => {
    const closing = (id: string, registerId?: string) => ({ id, registerId } as CashClosing);
    expect(closingsForRegister([closing('a', 'C1'), closing('b', 'C2'), closing('c')], 'C1').map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('per-cashier and per-method stay inside the register', () => {
    const totals = computeRangeTotals([ticket({ amount: 4, registerId: 'C2', cashierName: 'Beto' })], '', day(18), { registerId: 'C1' });
    expect(totals.ticketCount).toBe(0);
    expect(totals.byCashier).toEqual({});
    expect(totals.byMethod.EFECTIVO.amount).toBe(0);
  });
});

describe('CashDrawerStore', () => {
  beforeEach(() => CashDrawerStore.resetCacheForTests());

  it('open with a float, cash in/out with a reason, the Z closes the session (persisted)', async () => {
    await expect(CashDrawerStore.addMovement({ companyId: 'co1', registerId: 'r1', kind: 'OUT', amount: 5, reason: 'x' }))
      .rejects.toThrow(CASH_SESSION_REQUIRED_MESSAGE);
    const session = await CashDrawerStore.openSession({ companyId: 'co1', registerId: 'r1', openingFloat: 50, openedBy: 'Ana' });
    await expect(CashDrawerStore.openSession({ companyId: 'co1', registerId: 'r1', openingFloat: 10 })).rejects.toThrow(/ya está abierta/);
    await expect(CashDrawerStore.addMovement({ companyId: 'co1', registerId: 'r1', kind: 'OUT', amount: 0, reason: 'x' })).rejects.toThrow(/mayor que cero/);
    await expect(CashDrawerStore.addMovement({ companyId: 'co1', registerId: 'r1', kind: 'OUT', amount: 3, reason: ' ' })).rejects.toThrow(/motivo/);
    await CashDrawerStore.addMovement({ companyId: 'co1', registerId: 'r1', kind: 'OUT', amount: 10, reason: 'Pago a proveedor' });
    await CashDrawerStore.addMovement({ companyId: 'co1', registerId: 'r1', kind: 'IN', amount: 2.5, reason: 'Cambio' });
    // Another register on the same company is independent.
    await CashDrawerStore.openSession({ companyId: 'co1', registerId: 'r2', openingFloat: 0 });

    CashDrawerStore.resetCacheForTests(); // restart: read back from storage
    const open = await CashDrawerStore.getOpenSession('co1', 'r1');
    expect(open).toMatchObject({ id: session.id, openingFloat: 50, openedBy: 'Ana' });
    const movements = await CashDrawerStore.getMovements('co1', session.id);
    expect(movements.map((m) => [m.kind, m.amount])).toEqual([['OUT', 10], ['IN', 2.5]]);
    const totals = computeZReport([ticket({ amount: 30 })], null, day(18));
    expect(computeCashSummary({ totals, openingFloat: open!.openingFloat, movements }).expected).toBe(72.5);

    await CashDrawerStore.closeSession('co1', session.id, 'close_1', day(18));
    expect(await CashDrawerStore.getOpenSession('co1', 'r1')).toBeNull();
    expect(await CashDrawerStore.getOpenSession('co1', 'r2')).not.toBeNull();
    expect((await CashDrawerStore.getSession('co1', session.id))).toMatchObject({ closingId: 'close_1', closedAt: day(18) });
  });
});

// ── restoreTicketReturnStock ────────────────────────────────────────────────

function product(over: Partial<Product> = {}): Product {
  return {
    id: 'p1', productName: 'Café', productCode: 'CAFE01', unitPrice: 2,
    unitOfMeasure: 'UND' as never, taxCategory: 'GRAVADO' as never, status: 'ACTIVE' as never,
    companyId: 'co', isActive: true, createdAt: '2026-01-01', updatedAt: '2026-01-01',
    trackInventory: true, stock: 10, stockQuantity: 10, ...over,
  };
}

const BASE: ProductState = {
  products: [product()], stockMovements: [], categories: [], brands: [], suppliers: [],
  currentProduct: null, loading: false, error: null, searchTerm: '', filters: {},
};

const sold = (state: ProductState, qty = 3) => reducer(state, applyTicketStockDeduction({
  ticketId: 'tkt_1', ticketSequential: 7, items: [{ productId: 'p1', quantity: qty, productName: 'Café' }], createdAt: day(9), createdBy: 'POS',
}));
const returned = (state: ProductState, returnId: string, qty: number) => reducer(state, restoreTicketReturnStock({
  ticketId: 'tkt_1', returnId, ticketSequential: 7, items: [{ productId: 'p1', quantity: qty, productName: 'Café' }], createdAt: day(10), createdBy: 'Ana',
}));

describe('restoreTicketReturnStock', () => {
  it('Return one unit: stock +1, one IN movement referencing the return, idempotent per return id', () => {
    let state = sold(BASE);
    expect(state.products[0].stockQuantity).toBe(7);
    state = returned(state, 'ret_a', 1);
    expect(state.products[0].stockQuantity).toBe(8);
    expect(state.stockMovements[0]).toMatchObject({ type: 'IN', quantity: 1, referenceId: 'ret_a', reason: 'Devolución ticket POS #7 "Café"' });
    const again = returned(state, 'ret_a', 1);
    expect(again).toBe(state);
  });

  it('never restocks more than the sale deducted on this device', () => {
    let state = sold({ ...BASE, products: [product({ stock: 1, stockQuantity: 1 })] }); // oversold: 3 sold, 1 deducted
    state = returned(state, 'ret_a', 2);
    expect(state.products[0].stockQuantity).toBe(1);
    state = returned(state, 'ret_b', 1);
    expect(state.products[0].stockQuantity).toBe(1); // nothing left to put back
  });

  it('a sale rung on another register (no local OUT) restocks the returned quantity', () => {
    const state = returned(BASE, 'ret_a', 2);
    expect(state.products[0].stockQuantity).toBe(12);
  });

  it('void after a partial return restores only the remainder', () => {
    let state = returned(sold(BASE), 'ret_a', 1); // 10 → 7 → 8
    state = reducer(state, restoreTicketStock({
      ticketId: 'tkt_1', ticketSequential: 7, items: [{ productId: 'p1', quantity: 3 }],
      returnedItems: [{ productId: 'p1', quantity: 1 }], createdAt: day(11), createdBy: 'Ana',
    }));
    expect(state.products[0].stockQuantity).toBe(10);
    // Without local OUT movements the caller's items minus the returned units are used.
    const peer = reducer(BASE, restoreTicketStock({
      ticketId: 'tkt_9', ticketSequential: 9, items: [{ productId: 'p1', quantity: 3 }],
      returnedItems: [{ productId: 'p1', quantity: 2 }], createdAt: day(11), createdBy: 'Ana',
    }));
    expect(peer.products[0].stockQuantity).toBe(11);
  });
});
