import productReducer, { applyInvoiceStockDeduction } from '@/store/slices/productSlice';

const product = {
  id: 'p1', name: 'Laptop', price: 850, stock: 10, stockQuantity: 10, trackInventory: true, isService: false,
  createdAt: '', updatedAt: '',
};

it('discharges an invoice’s stock once, even if completion is dispatched twice', () => {
  let state = productReducer(undefined, { type: '@@INIT' });
  state = { ...state, products: [product as never] };
  const action = applyInvoiceStockDeduction({
    invoiceId: 'inv-1',
    items: [{ productId: 'p1', quantity: 2, productName: 'Laptop' }],
    createdAt: '2026-10-10T00:00:00.000Z',
    createdBy: 'sync-dte',
  });

  state = productReducer(state, action);
  state = productReducer(state, action);

  expect(state.products[0].stockQuantity).toBe(8);
  expect(state.stockMovements.filter((m) => m.referenceId === 'inv-1')).toHaveLength(1);
});
