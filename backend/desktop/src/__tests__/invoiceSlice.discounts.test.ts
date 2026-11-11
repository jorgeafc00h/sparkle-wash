// Line-discount math in invoiceSlice.computeTotals. Discounts share the
// IVA treatment of unitPrice (stored IVA-inclusive for Factura AND CCF)
// and are clamped to the line gross so a typo can't flip a line negative.

import invoiceReducer, { addInvoice, updateInvoice } from '../store/slices/invoiceSlice';
import { InvoiceType, CreateInvoiceInput } from '../types';

const makeState = (
  invoiceType: InvoiceType,
  items: CreateInvoiceInput['items'],
  extra: Partial<CreateInvoiceInput> = {},
) => {
  const state = invoiceReducer(undefined, { type: '@@INIT' });
  const input: CreateInvoiceInput = {
    invoiceNumber: 'DISC-TEST',
    date: '2026-09-28',
    companyId: 'company-001',
    invoiceType,
    items,
    ...extra,
  };
  return invoiceReducer(state, addInvoice(input));
};

describe('invoiceSlice.computeTotals — line discounts', () => {
  it('nets Factura line discounts out of totalAmount and reports totalDiscount', () => {
    const state = makeState(InvoiceType.Factura, [
      { productId: 'p1', quantity: 1, unitPrice: 50, discount: 7.5 },
      { productId: 'p2', quantity: 1, unitPrice: 30 },
    ]);
    const totals = state.invoices[0].totals!;
    expect(totals.totalAmount).toBe(72.5); // 80 − 7.5
    expect(totals.totalDiscount).toBe(7.5);
    // IVA extracted from the discounted (net) inclusive total.
    expect(totals.tax).toBe(Math.round((72.5 - 72.5 / 1.13) * 100) / 100);
    expect(totals.totalPagar).toBe(72.5);
  });

  it('computes the CCF base per item AFTER the discount (per-item /1.13)', () => {
    const state = makeState(InvoiceType.CCF, [
      { productId: 'p1', quantity: 1, unitPrice: 113, discount: 11.3 },
    ]);
    const totals = state.invoices[0].totals!;
    // Net inclusive 101.70 → base round(101.70/1.13) = 90
    expect(totals.totalAmount).toBe(101.7);
    expect(totals.totalWithoutTax).toBe(90);
    expect(totals.tax).toBe(11.7); // 90 × 0.13
    expect(totals.totalDiscount).toBe(11.3);
  });

  it('clamps a discount larger than the line gross to the line gross', () => {
    const state = makeState(InvoiceType.Factura, [
      { productId: 'p1', quantity: 1, unitPrice: 10, discount: 999 },
    ]);
    const totals = state.invoices[0].totals!;
    expect(totals.totalAmount).toBe(0);
    expect(totals.totalDiscount).toBe(10);
  });

  it('drops non-positive discounts during normalization', () => {
    const state = makeState(InvoiceType.Factura, [
      { productId: 'p1', quantity: 1, unitPrice: 10, discount: 0 },
      { productId: 'p2', quantity: 1, unitPrice: 10, discount: -5 },
    ]);
    const items = state.invoices[0].items;
    expect(items[0].discount).toBeUndefined();
    expect(items[1].discount).toBeUndefined();
    expect(state.invoices[0].totals!.totalAmount).toBe(20);
  });

  it('updateInvoice recomputes totals when a discount is edited', () => {
    let state = makeState(InvoiceType.Factura, [
      { productId: 'p1', quantity: 1, unitPrice: 100, discount: 10 },
    ]);
    const id = state.invoices[0].id;
    state = invoiceReducer(state, updateInvoice({
      id,
      items: [{ productId: 'p1', quantity: 1, unitPrice: 100, discount: 25 }],
    }));
    const updated = state.invoices[0];
    expect(updated.totals!.totalAmount).toBe(75);
    expect(updated.totals!.totalDiscount).toBe(25);
    expect(updated.items[0].discount).toBe(25);
  });
});
