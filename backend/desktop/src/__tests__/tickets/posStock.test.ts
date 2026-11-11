// POS stock discharge/restore reducers — mirror of the invoice deduction.

import reducer, {
  applyTicketStockDeduction,
  restoreTicketStock,
} from '@/store/slices/productSlice';
import type { ProductState } from '@/types';
import type { Product } from '@/types/product';

function product(over: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    productName: 'Café',
    productCode: 'CAFE01',
    unitPrice: 3,
    unitOfMeasure: 'UND' as never,
    taxCategory: 'GRAVADO' as never,
    status: 'ACTIVE' as never,
    companyId: 'co',
    isActive: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    trackInventory: true,
    stock: 10,
    stockQuantity: 10,
    ...over,
  };
}

const BASE: ProductState = {
  products: [product()],
  stockMovements: [],
  categories: [],
  brands: [],
  suppliers: [],
  currentProduct: null,
  loading: false,
  error: null,
  searchTerm: '',
  filters: {},
};

const deduction = {
  ticketId: 'tkt_1',
  ticketSequential: 42,
  items: [{ productId: 'p1', quantity: 2, productName: 'Café' }],
  createdAt: '2026-09-26T15:00:00Z',
  createdBy: 'POS',
};

describe('applyTicketStockDeduction', () => {
  it('deducts stock and records an OUT movement referencing the ticket', () => {
    const state = reducer(BASE, applyTicketStockDeduction(deduction));
    expect(state.products[0].stockQuantity).toBe(8);
    expect(state.products[0].stock).toBe(8);
    expect(state.stockMovements).toHaveLength(1);
    expect(state.stockMovements[0]).toMatchObject({
      type: 'OUT',
      quantity: 2,
      previousStock: 10,
      newStock: 8,
      referenceId: 'tkt_1',
      reason: expect.stringContaining('#42'),
    });
  });

  it('clamps at zero and logs only the units actually deducted (oversell ALLOW)', () => {
    const state = reducer(
      { ...BASE, products: [product({ stock: 1, stockQuantity: 1 })] },
      applyTicketStockDeduction(deduction),
    );
    expect(state.products[0].stockQuantity).toBe(0);
    expect(state.stockMovements[0]).toMatchObject({ type: 'OUT', quantity: 1, previousStock: 1, newStock: 0 });
    expect(state.stockMovements[0].reason).toContain('vendidas 2, 1 sin stock');
  });

  it('is idempotent per ticket (a double dispatch deducts once)', () => {
    let state = reducer(BASE, applyTicketStockDeduction(deduction));
    state = reducer(state, applyTicketStockDeduction(deduction));
    expect(state.products[0].stockQuantity).toBe(8);
    expect(state.stockMovements).toHaveLength(1);
  });

  it('skips services and non-tracked products', () => {
    const state = reducer(
      { ...BASE, products: [product({ isService: true })] },
      applyTicketStockDeduction(deduction),
    );
    expect(state.products[0].stockQuantity).toBe(10);
    expect(state.stockMovements).toHaveLength(0);
  });
});

describe('restoreTicketStock', () => {
  it('restores stock with an IN movement after a void', () => {
    let state = reducer(BASE, applyTicketStockDeduction(deduction));
    state = reducer(
      state,
      restoreTicketStock({
        ...deduction,
        createdAt: '2026-09-26T16:00:00Z',
      }),
    );
    expect(state.products[0].stockQuantity).toBe(10);
    expect(state.stockMovements).toHaveLength(2);
    expect(state.stockMovements[0]).toMatchObject({
      type: 'IN',
      quantity: 2,
      previousStock: 8,
      newStock: 10,
      referenceId: 'tkt_1',
      reason: expect.stringContaining('Anulación ticket POS #42'),
    });
  });
});

describe('restoreTicketStock — no phantom stock', () => {
  const restore = { ...deduction, createdAt: '2026-09-26T16:00:00Z' };

  it('stock 1, sell 3, void → back to 1 (restores the ticket\'s own OUT movements, not the sold quantity)', () => {
    const sale = { ...deduction, items: [{ productId: 'p1', quantity: 3, productName: 'Café' }] };
    let state = reducer({ ...BASE, products: [product({ stock: 1, stockQuantity: 1 })] }, applyTicketStockDeduction(sale));
    expect(state.products[0].stockQuantity).toBe(0);
    state = reducer(state, restoreTicketStock({ ...sale, createdAt: restore.createdAt }));
    expect(state.products[0].stockQuantity).toBe(1);
    expect(state.stockMovements[0]).toMatchObject({ type: 'IN', quantity: 1, previousStock: 0, newStock: 1 });
  });

  it('fully oversold (0 deducted) restores nothing', () => {
    let state = reducer({ ...BASE, products: [product({ stock: 0, stockQuantity: 0 })] }, applyTicketStockDeduction(deduction));
    state = reducer(state, restoreTicketStock(restore));
    expect(state.products[0].stockQuantity).toBe(0);
    expect(state.stockMovements.filter((m) => m.type === 'IN')).toHaveLength(0);
  });

  it('is idempotent per ticket (a second void dispatch restores nothing more)', () => {
    let state = reducer(BASE, applyTicketStockDeduction(deduction));
    state = reducer(state, restoreTicketStock(restore));
    state = reducer(state, restoreTicketStock(restore));
    expect(state.products[0].stockQuantity).toBe(10);
    expect(state.stockMovements.filter((m) => m.type === 'IN')).toHaveLength(1);
  });

  it('falls back to the ticket quantities when this device has no OUT movement (sale made on another register)', () => {
    const state = reducer({ ...BASE, products: [product({ stock: 4, stockQuantity: 4 })] }, restoreTicketStock(restore));
    expect(state.products[0].stockQuantity).toBe(6);
  });

  it('a movement of another ticket with a prefix-sharing id is not counted', () => {
    let state = reducer(BASE, applyTicketStockDeduction({ ...deduction, ticketId: 'tkt_10' }));
    state = reducer(state, applyTicketStockDeduction(deduction)); // tkt_1 must still deduct
    expect(state.products[0].stockQuantity).toBe(6);
  });
});
