// Which invoices move stock, fractional quantities, and invalidation restore.

import productReducer, {
  applyInvoiceStockDeduction,
  restoreInvoiceStock,
} from '@/store/slices/productSlice';
import {
  invoiceDischargesStock,
  invoiceStockDeductionPayload,
  roundStockQuantity,
} from '@/services/inventory/invoiceStockRules';
import { InvoiceType, type Invoice } from '@/types/invoice';
import type { Product } from '@/types/product';

const product = (id: string, stock: number) => ({
  id, name: id, price: 1, stock, stockQuantity: stock, trackInventory: true, isService: false,
  createdAt: '', updatedAt: '',
});

function stateWith(...products: ReturnType<typeof product>[]) {
  const state = productReducer(undefined, { type: '@@INIT' });
  return { ...state, products: products as unknown as Product[] };
}

const invoice = (invoiceType: InvoiceType, over: Partial<Invoice> = {}): Invoice => ({
  id: 'inv-1',
  invoiceNumber: 'X',
  date: '2026-10-31',
  status: 2,
  invoiceType,
  documentType: '01',
  companyId: 'co',
  items: [{ id: 'i1', productId: 'p1', productName: 'Arroz', quantity: 2, unitPrice: 1, obsItem: '', createdAt: '', updatedAt: '' }],
  createdAt: '',
  updatedAt: '',
  ...over,
} as Invoice);

describe('invoiceDischargesStock', () => {
  it.each([
    [InvoiceType.Factura, true],
    [InvoiceType.CCF, true],
    [InvoiceType.FacturaExportacion, true],
    [InvoiceType.NotaRemision, true],
    [InvoiceType.NotaCredito, false],
    [InvoiceType.NotaDebito, false],
    [InvoiceType.SujetoExcluido, false],
    [InvoiceType.ComprobanteRetencion, false],
    [InvoiceType.ComprobanteLiquidacion, false],
    [InvoiceType.DocumentoContableLiquidacion, false],
    [InvoiceType.ComprobanteDonacion, false],
    [InvoiceType.EventoOperacionesEspeciales, false],
    [InvoiceType.EventoRetorno, false],
  ])('type %s discharges: %s', (type, expected) => {
    expect(invoiceDischargesStock(invoice(type))).toBe(expected);
  });

  it('a Factura/CCF billing a Nota de Remisión does not discharge again', () => {
    expect(invoiceDischargesStock(invoice(InvoiceType.Factura, { relatedInvoiceType: InvoiceType.NotaRemision }))).toBe(false);
    expect(invoiceDischargesStock(invoice(InvoiceType.CCF, { relatedDocumentType: '04' }))).toBe(false);
    expect(invoiceDischargesStock(invoice(InvoiceType.CCF, { relatedDocumentType: '03' }))).toBe(true);
  });

  it('a POS consolidation never discharges (its tickets already did)', () => {
    expect(invoiceDischargesStock(invoice(InvoiceType.Factura, { sourceTicketIds: ['t1'] }))).toBe(false);
    expect(invoiceStockDeductionPayload(invoice(InvoiceType.Factura, { sourceTicketIds: ['t1'] }), 'x')).toBeNull();
  });
});

describe('applyInvoiceStockDeduction / restoreInvoiceStock', () => {
  const deduct = (inv: Invoice) =>
    applyInvoiceStockDeduction(invoiceStockDeductionPayload(inv, 'sync-dte', '2026-10-31T12:00:00Z')!);
  const restore = (invoiceId = 'inv-1') =>
    restoreInvoiceStock({ invoiceId, createdAt: '2026-11-02T12:00:00Z', createdBy: 'invalidation' });

  it('keeps fractional quantities (0.5 kg used to discharge nothing, 2.5 → 2)', () => {
    let state = stateWith(product('p1', 10), product('p2', 3));
    state = productReducer(state, deduct(invoice(InvoiceType.Factura, {
      items: [
        { id: 'a', productId: 'p1', productName: 'Queso', quantity: 0.5, unitPrice: 1, obsItem: '', createdAt: '', updatedAt: '' },
        { id: 'b', productId: 'p2', productName: 'Tela', quantity: 2.5, unitPrice: 1, obsItem: '', createdAt: '', updatedAt: '' },
      ],
    })));
    expect(state.products.find((p) => p.id === 'p1')!.stockQuantity).toBe(9.5);
    expect(state.products.find((p) => p.id === 'p2')!.stockQuantity).toBe(0.5);
    expect(roundStockQuantity(0.1 + 0.2)).toBe(0.3);
  });

  it('invalidation restores exactly what the invoice discharged, once', () => {
    let state = stateWith(product('p1', 10));
    state = productReducer(state, deduct(invoice(InvoiceType.CCF, {
      items: [{ id: 'a', productId: 'p1', productName: 'Arroz', quantity: 2.25, unitPrice: 1, obsItem: '', createdAt: '', updatedAt: '' }],
    })));
    expect(state.products[0].stockQuantity).toBe(7.75);

    state = productReducer(state, restore());
    state = productReducer(state, restore()); // idempotent
    expect(state.products[0].stockQuantity).toBe(10);
    const ins = state.stockMovements.filter((m) => m.type === 'IN' && m.referenceId === 'inv-1');
    expect(ins).toHaveLength(1);
    expect(ins[0]).toMatchObject({ quantity: 2.25, previousStock: 7.75, newStock: 10 });

    // An invalidated invoice never discharges again.
    state = productReducer(state, deduct(invoice(InvoiceType.CCF)));
    expect(state.products[0].stockQuantity).toBe(10);
  });

  it('an oversold line restores only the units that actually left', () => {
    let state = stateWith(product('p1', 1));
    state = productReducer(state, deduct(invoice(InvoiceType.Factura, {
      items: [{ id: 'a', productId: 'p1', productName: 'Arroz', quantity: 3, unitPrice: 1, obsItem: '', createdAt: '', updatedAt: '' }],
    })));
    expect(state.products[0].stockQuantity).toBe(0);
    state = productReducer(state, restore());
    expect(state.products[0].stockQuantity).toBe(1);
  });

  it('restoring a document that never discharged (NC) moves nothing', () => {
    let state = stateWith(product('p1', 10));
    expect(invoiceStockDeductionPayload(invoice(InvoiceType.NotaCredito), 'sync-dte')).toBeNull();
    state = productReducer(state, restore());
    expect(state.products[0].stockQuantity).toBe(10);
    expect(state.stockMovements).toHaveLength(0);
  });

  it('restores from movements recorded before this change (floored quantity)', () => {
    let state = stateWith(product('p1', 8));
    state = {
      ...state,
      stockMovements: [{
        id: 'inv-1_p1_0', productId: 'p1', type: 'OUT', quantity: 2, previousStock: 10, newStock: 8,
        reason: 'Salida por factura', referenceId: 'inv-1', createdAt: '', createdBy: 'sync-dte',
      }],
    };
    state = productReducer(state, restore());
    expect(state.products[0].stockQuantity).toBe(10);
  });
});
