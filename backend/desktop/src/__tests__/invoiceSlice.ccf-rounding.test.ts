// Regression suite for the $0.02 IVA discrepancy in CCF invoices (invoice 00011, 2026-05-21).
//
// Root cause: round(Σprices / 1.13) ≠ Σround(price / 1.13)
// Dividing the already-rounded IVA-inclusive sum by 1.13 accumulates a $0.01 error in
// totalWithoutTax and a $0.01 error in IVA = $0.02 total drift.
// The fix sums individually-rounded per-item bases. CCF IVA is gross − base, i.e. the
// sum of per-item IVA the DTE sends in resumen.tributos (2026-10-10: it used to be
// base × 0.13, which disagreed with the DTE and the F07 annex by a few cents).

import invoiceReducer, { addInvoice, updateInvoice } from '../store/slices/invoiceSlice';
import { InvoiceType, CreateInvoiceInput } from '../types';

// IVA-inclusive stored prices from invoice 00011 (12 commission items).
// Sum = $279.67. Correct per-item base sum = $247.51; old divide-after-sum = $247.50.
const invoice00011Items = [
  { productId: 'p01', quantity: 1, unitPrice: 13.09  }, // base $11.58
  { productId: 'p02', quantity: 1, unitPrice: 116.41 }, // base $103.02
  { productId: 'p03', quantity: 1, unitPrice: 18.87  }, // base $16.70
  { productId: 'p04', quantity: 1, unitPrice: 7.41   }, // base $6.56
  { productId: 'p05', quantity: 1, unitPrice: 15.76  }, // base $13.95
  { productId: 'p06', quantity: 1, unitPrice: 10.53  }, // base $9.32
  { productId: 'p07', quantity: 1, unitPrice: 6.98   }, // base $6.18
  { productId: 'p08', quantity: 1, unitPrice: 6.45   }, // base $5.71
  { productId: 'p09', quantity: 1, unitPrice: 2.28   }, // base $2.02
  { productId: 'p10', quantity: 1, unitPrice: 41.80  }, // base $36.99
  { productId: 'p11', quantity: 1, unitPrice: 22.19  }, // base $19.64
  { productId: 'p12', quantity: 1, unitPrice: 17.90  }, // base $15.84
];

const makeCCFState = (
  items = invoice00011Items,
  extra: Partial<CreateInvoiceInput> = {}
) => {
  const state = invoiceReducer(undefined, { type: '@@INIT' });
  const input: CreateInvoiceInput = {
    invoiceNumber: 'CCF-ROUND-TEST',
    date: '2026-05-21',
    customerId: 'customer-001',
    companyId: 'company-001',
    invoiceType: InvoiceType.CCF,
    items,
    ...extra,
  };
  return invoiceReducer(state, addInvoice(input));
};

describe('CCF tax rounding — invoiceSlice (App.Desktop)', () => {
  it('totalWithoutTax uses per-item base sum, not divide-after-sum', () => {
    const totals = makeCCFState().invoices[0].totals!;
    // Correct: Σ round(price/1.13) = $247.51
    // Wrong (old regression): round(279.67/1.13) = $247.50
    expect(totals.totalWithoutTax).toBe(247.51);
  });

  it('IVA equals the per-item IVA the DTE reports (gross − per-item base sum)', () => {
    const totals = makeCCFState().invoices[0].totals!;
    // DTE resumen.tributos = Σ round(p − p/1.13) = 279.67 − 247.51 = $32.16
    // (base × 0.13 = $32.18 disagreed with the document sent to MH)
    expect(totals.tax).toBe(32.16);
    expect(totals.totalWithoutTax + totals.tax).toBeCloseTo(totals.totalAmount, 2);
  });

  it('ivaRete1 = round(totalWithoutTax × 0.01) for CCF with contributor retention', () => {
    const totals = makeCCFState(invoice00011Items, { customerHasRetention: true }).invoices[0].totals!;
    // round(247.51 × 0.01) = $2.48
    expect(totals.ivaRete1).toBe(2.48);
  });

  it('exact multiples of 1.13 produce zero rounding drift', () => {
    // $113 = $100 base × 1.13, $226 = $200 base × 1.13
    const totals = makeCCFState([
      { productId: 'p1', quantity: 1, unitPrice: 113 },
      { productId: 'p2', quantity: 1, unitPrice: 226 },
    ]).invoices[0].totals!;
    expect(totals.totalWithoutTax).toBe(300);
    expect(totals.tax).toBe(39);
  });

  it('Factura (Type 01) tax calculation is unchanged', () => {
    const state = invoiceReducer(undefined, { type: '@@INIT' });
    const totals = invoiceReducer(state, addInvoice({
      invoiceNumber: 'FC-UNCHANGED',
      date: '2026-05-21',
      customerId: 'c1',
      companyId: 'co1',
      invoiceType: InvoiceType.Factura,
      items: [{ productId: 'p1', quantity: 1, unitPrice: 113 }],
    })).invoices[0].totals!;
    expect(totals.totalAmount).toBe(113);
    expect(totals.tax).toBe(13);
    expect(totals.totalWithoutTax).toBe(100);
  });

  it('applies the same fix when items are updated via updateInvoice', () => {
    const initial = invoiceReducer(undefined, { type: '@@INIT' });
    const created = invoiceReducer(initial, addInvoice({
      invoiceNumber: 'CCF-UPD',
      date: '2026-05-21',
      customerId: 'c1',
      companyId: 'co1',
      invoiceType: InvoiceType.CCF,
      items: [{ productId: 'p1', quantity: 1, unitPrice: 113 }],
    }));
    const invoiceId = created.invoices[0].id;
    const updated = invoiceReducer(created, updateInvoice({
      id: invoiceId,
      invoiceType: InvoiceType.CCF,
      items: invoice00011Items,
    }));
    const totals = updated.invoices[0].totals!;
    expect(totals.totalWithoutTax).toBe(247.51);
    expect(totals.tax).toBe(32.16);
  });

  it('keeps the 1% retention when a status-only update recomputes totals', () => {
    const created = makeCCFState(invoice00011Items, {
      customerHasRetention: true,
      customer: { id: 'gc-1', hasContributorRetention: true } as never,
    });
    const id = created.invoices[0].id;
    expect(created.invoices[0].totals!.ivaRete1).toBe(2.48);

    // InvoiceDetailPage / Contingency / Invalidation only send status fields
    const updated = invoiceReducer(created, updateInvoice({ id, status: 3 as never }));
    expect(updated.invoices[0].totals!.ivaRete1).toBe(2.48);
  });

  it('does not withhold the 1% below US$100 (Art. 162)', () => {
    const totals = makeCCFState([{ productId: 'p1', quantity: 1, unitPrice: 112 }], {
      customerHasRetention: true,
    }).invoices[0].totals!;
    expect(totals.totalWithoutTax).toBe(99.12);
    expect(totals.ivaRete1).toBe(0);
  });

  it('persists fechaTransmision when a synced invoice is updated', () => {
    const initial = invoiceReducer(undefined, { type: '@@INIT' });
    const created = invoiceReducer(initial, addInvoice({
      invoiceNumber: 'FC-SYNC',
      date: '2026-06-18',
      customerId: 'c1',
      companyId: 'co1',
      invoiceType: InvoiceType.Factura,
      items: [{ productId: 'p1', quantity: 1, unitPrice: 113 }],
    }));

    const invoiceId = created.invoices[0].id;
    const updated = invoiceReducer(created, updateInvoice({
      id: invoiceId,
      fechaTransmision: '2026-06-18T17:30:00.000Z',
    }));

    expect(updated.invoices[0].fechaTransmision).toBe('2026-06-18T17:30:00.000Z');
  });
});
