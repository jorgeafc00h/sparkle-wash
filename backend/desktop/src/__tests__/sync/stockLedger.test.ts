// Product stock across registers (2026-11-01). Before: products merged
// last-writer-wins on the absolute stock, so two registers selling from 10
// (2 and 3 units) both ended at 7. Now the stock is a convergent counter
// carried inside the product (stockLedger.ts) and merged by mergeProduct.

import {
  applyStockDelta,
  ledgerForMerge,
  mergeProductStock,
  ledgerOf,
  ledgerStock,
  mergeLedgers,
  type StockLedger,
} from '@/services/sync/stockLedger';
import { mergeChange, mergeLww, type RemoteChange, type SyncEntity } from '@/services/sync/mergeEngine';
import productReducer, { applyTicketStockDeduction, restoreTicketStock, updateProduct, addProduct } from '@/store/slices/productSlice';

const T0 = '2026-11-01T10:00:00.000Z';
const T1 = '2026-11-01T11:00:00.000Z';
const T2 = '2026-11-01T12:00:00.000Z';

function product(over: Record<string, unknown> = {}): SyncEntity {
  return {
    id: 'prod-1',
    companyId: 'co',
    productName: 'Café',
    unitPrice: 2,
    trackInventory: true,
    stock: 10,
    stockQuantity: 10,
    updatedAt: T0,
    ...over,
  };
}

/** A register that started from the synced copy and sold `qty` units. */
function soldOn(deviceId: string, qty: number, base = product()): SyncEntity {
  const ledger = applyStockDelta(ledgerOf(base as never), deviceId, -qty);
  const stock = ledgerStock(ledger);
  return { ...base, stockLedger: ledger, stock, stockQuantity: stock };
}

const remote = (entity: SyncEntity, u: string, d: string): RemoteChange => ({ op: 'upsert', u, d, entity });

/** Deliver b's copy to a, as the sync engine does; returns a's resulting product. */
function deliver(a: { entity: SyncEntity; u: string; d: string }, b: { entity: SyncEntity; u: string; d: string }) {
  const decision = mergeChange('product', a.entity, { u: a.u, d: a.d }, remote(b.entity, b.u, b.d), a.d);
  if (decision.kind === 'upsert') return { entity: decision.entity, u: decision.version.u, d: decision.version.d };
  return a;
}

describe('stock ledger math', () => {
  it('two registers selling 2 and 3 from 10 converge on 5 in any delivery order', () => {
    let A = { entity: soldOn('register-A', 2), u: T1, d: 'register-A' };
    let B = { entity: soldOn('register-B', 3), u: T2, d: 'register-B' };
    expect(A.entity.stockQuantity).toBe(8);
    expect(B.entity.stockQuantity).toBe(7);

    const A1 = deliver(A, B);
    const B1 = deliver(B, A);
    expect(A1.entity.stockQuantity).toBe(5);
    expect(B1.entity.stockQuantity).toBe(5);

    // Keep exchanging until nothing changes: same content on both sides.
    A = A1; B = B1;
    for (let i = 0; i < 3; i += 1) {
      const nextA = deliver(A, B);
      const nextB = deliver(B, A);
      A = nextA; B = nextB;
    }
    expect(A.entity.stockLedger).toEqual(B.entity.stockLedger);
    expect(A.entity.stockQuantity).toBe(5);
  });

  it('merge is commutative, associative and idempotent (randomized)', () => {
    let seed = 11;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const randomLedger = (): StockLedger => {
      let l = ledgerOf({ stock: 50, updatedAt: T0 });
      for (let i = 0; i < 6; i += 1) l = applyStockDelta(l, `dev-${Math.floor(rnd() * 3)}`, Math.round((rnd() - 0.6) * 10));
      if (rnd() > 0.7) l = { ...l, base: Math.round(rnd() * 40), baseAt: rnd() > 0.5 ? T1 : T2, baseBy: `dev-${Math.floor(rnd() * 3)}` };
      return l;
    };
    for (let run = 0; run < 300; run += 1) {
      const [x, y, z] = [randomLedger(), randomLedger(), randomLedger()];
      expect(mergeLedgers(x, y)).toEqual(mergeLedgers(y, x));
      expect(mergeLedgers(mergeLedgers(x, y), z)).toEqual(mergeLedgers(x, mergeLedgers(y, z)));
      expect(mergeLedgers(x, x)).toEqual(x);
    }
  });

  it('merging two whole copies — with or without ledgers, edited or not — gives the same stock in either order', () => {
    let seed = 29;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const times = [T0, T1, T2];
    const copy = () => {
      const kind = rnd();
      if (kind < 0.25) return { stock: Math.round(rnd() * 30), stockQuantity: undefined as number | undefined };
      let l = ledgerOf({ stock: 20, updatedAt: T0 });
      for (let i = 0; i < 4; i += 1) l = applyStockDelta(l, `dev-${Math.floor(rnd() * 3)}`, Math.round((rnd() - 0.6) * 6));
      const shown = ledgerStock(l);
      return { stockLedger: l, stock: kind < 0.4 ? shown + 3 : shown, stockQuantity: undefined as number | undefined };
    };
    for (let run = 0; run < 300; run += 1) {
      const a = copy(); const b = copy();
      const [at, bt] = [times[Math.floor(rnd() * 3)], times[Math.floor(rnd() * 3)]];
      const ab = mergeProductStock(a, at, 'dev-a', b, bt, 'dev-b');
      const ba = mergeProductStock(b, bt, 'dev-b', a, at, 'dev-a');
      expect(ledgerStock(ab)).toBe(ledgerStock(ba));
      expect(ab).toEqual(ba);
    }
  });

  it('a sale then its void on another register nets out after merge', () => {
    const sale = soldOn('register-A', 4);
    const voided: SyncEntity = { ...sale, stockLedger: applyStockDelta(sale.stockLedger as StockLedger, 'register-A', 4) };
    voided.stock = voided.stockQuantity = ledgerStock(voided.stockLedger as StockLedger);
    const other = soldOn('register-B', 1);
    const merged = deliver({ entity: other, u: T1, d: 'register-B' }, { entity: voided, u: T2, d: 'register-A' });
    expect(merged.entity.stockQuantity).toBe(9);
  });

  it('shows 0 (never negative) when concurrent sales oversell, and recovers on restock', () => {
    const a = soldOn('register-A', 7);
    const b = soldOn('register-B', 6);
    const merged = deliver({ entity: a, u: T1, d: 'register-A' }, { entity: b, u: T2, d: 'register-B' });
    expect(merged.entity.stockQuantity).toBe(0);
    const restocked = applyStockDelta(merged.entity.stockLedger as StockLedger, 'register-A', 10);
    expect(ledgerStock(restocked)).toBe(7); // 10 − 13 + 10
  });
});

describe('older peers (no ledger) keep working', () => {
  it('a newer absolute write from an app without the ledger re-bases the counter', () => {
    const local = soldOn('register-A', 2);           // 8, with ledger
    const legacy = product({ stock: 20, stockQuantity: 20, updatedAt: T2 }); // phone set 20
    const merged = deliver({ entity: local, u: T1, d: 'register-A' }, { entity: legacy, u: T2, d: 'phone' });
    expect(merged.entity.stockQuantity).toBe(20);
    // …and a later local sale still counts from there.
    const next = applyStockDelta(merged.entity.stockLedger as StockLedger, 'register-A', -1);
    expect(ledgerStock(next)).toBe(19);
  });

  it('an older absolute write from such an app does not undo newer sales', () => {
    const local = soldOn('register-A', 2);
    const legacy = product({ stock: 20, stockQuantity: 20, updatedAt: T0 });
    const decision = mergeChange('product', local, { u: T2, d: 'register-A' }, remote(legacy, T0, 'phone'), 'register-A');
    expect(decision.kind).toBe('skip');
  });

  it('an app that carries the ledger but edits `stock` is read as an absolute write', () => {
    const carried = soldOn('register-A', 2);       // ledger says 8
    const edited = { ...carried, stock: 15, stockQuantity: 15, updatedAt: T2 };
    const l = ledgerForMerge(edited as never, T2, 'phone');
    expect(ledgerStock(l)).toBe(15);
    expect(l.baseAt).toBe(T2);
  });

  it('products without a ledger on either side merge exactly like before (LWW)', () => {
    const local = product({ productName: 'Viejo', updatedAt: T1 });
    const incoming = product({ productName: 'Nuevo', stock: 4, stockQuantity: 4, updatedAt: T2 });
    const viaProduct = mergeChange('product', local, { u: T1, d: 'A' }, remote(incoming, T2, 'B'), 'A');
    const viaLww = mergeLww(local, { u: T1, d: 'A' }, remote(incoming, T2, 'B'), 'A');
    expect(viaProduct).toEqual(viaLww);
  });

  it('a merge that adds our sales is re-sent (stamped by this device, newer than both)', () => {
    const local = soldOn('register-A', 2);
    const incoming = soldOn('register-B', 3);
    const decision = mergeChange('product', local, { u: T1, d: 'register-A' }, remote(incoming, T2, 'register-B'), 'register-A');
    expect(decision.kind).toBe('upsert');
    if (decision.kind !== 'upsert') return;
    expect(decision.version.d).toBe('register-A');
    expect(decision.version.u > T2).toBe(true);
    expect(decision.entity.stockQuantity).toBe(5);
  });
});

describe('product reducers write through the ledger', () => {
  const base = { ...product(), unitOfMeasure: 'UND', isService: false } as never;

  it('a ticket sale and its void move this device\'s counters, not the absolute level', () => {
    let state = productReducer(undefined, addProduct(base));
    state = productReducer(state, applyTicketStockDeduction({
      ticketId: 't1', ticketSequential: 1, items: [{ productId: 'prod-1', quantity: 3 }], createdAt: T1, createdBy: 'x',
    } as never));
    const sold = state.products[0];
    expect(sold.stockQuantity).toBe(7);
    const outs = Object.values(sold.stockLedger!.devices).map((d) => d.out);
    expect(outs).toEqual([3]);
    state = productReducer(state, restoreTicketStock({
      ticketId: 't1', ticketSequential: 1, items: [{ productId: 'prod-1', quantity: 3 }], createdAt: T2, createdBy: 'x',
    } as never));
    expect(state.products[0].stockQuantity).toBe(10);
  });

  it('an edited stock level is a delta on the STORED ledger (a stale copy in the payload is ignored)', () => {
    let state = productReducer(undefined, addProduct(base));
    const staleCopy = state.products[0];
    state = productReducer(state, applyTicketStockDeduction({
      ticketId: 't2', ticketSequential: 2, items: [{ productId: 'prod-1', quantity: 2 }], createdAt: T1, createdBy: 'x',
    } as never));
    // "Ajuste de inventario" +5 computed from the screen's current 8 → 13.
    state = productReducer(state, updateProduct({ ...staleCopy, stock: 13, stockQuantity: 13 } as never));
    expect(state.products[0].stockQuantity).toBe(13);
    const ledger = state.products[0].stockLedger!;
    const totals = Object.values(ledger.devices).reduce((s, d) => ({ in: s.in + d.in, out: s.out + d.out }), { in: 0, out: 0 });
    expect(totals).toEqual({ in: 5, out: 2 });
  });

  it('a non-stock edit keeps the stored ledger and level', () => {
    let state = productReducer(undefined, addProduct(base));
    state = productReducer(state, applyTicketStockDeduction({
      ticketId: 't3', ticketSequential: 3, items: [{ productId: 'prod-1', quantity: 1 }], createdAt: T1, createdBy: 'x',
    } as never));
    const ledger = state.products[0].stockLedger;
    state = productReducer(state, updateProduct({ ...state.products[0], productName: 'Café de altura' }));
    expect(state.products[0].stockLedger).toEqual(ledger);
    expect(state.products[0].stockQuantity).toBe(9);
  });
});
