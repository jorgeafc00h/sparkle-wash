import invoiceReducer, { addInvoice } from '../store/slices/invoiceSlice';
import { CreateInvoiceInput, InvoiceType } from '../types';

const baseInput = (invoiceType: InvoiceType): CreateInvoiceInput => ({
  invoiceNumber: `DOC-TYPE-${invoiceType}`,
  date: '2026-06-15',
  companyId: 'company-001',
  customerId: 'customer-001',
  invoiceType,
  items: [{ productId: 'product-001', quantity: 1, unitPrice: 113 }],
});

describe('invoiceSlice documentType mapping', () => {
  it.each([
    [InvoiceType.Factura, '01'],
    [InvoiceType.CCF, '03'],
    [InvoiceType.NotaRemision, '04'],
    [InvoiceType.NotaCredito, '05'],
    [InvoiceType.NotaDebito, '06'],
    [InvoiceType.ComprobanteRetencion, '07'],
    [InvoiceType.ComprobanteLiquidacion, '08'],
    [InvoiceType.DocumentoContableLiquidacion, '09'],
    [InvoiceType.FacturaExportacion, '11'],
    [InvoiceType.SujetoExcluido, '14'],
    [InvoiceType.ComprobanteDonacion, '15'],
    [InvoiceType.EventoOperacionesEspeciales, '17'],
    [InvoiceType.EventoRetorno, '18'],
  ])('maps %s to DTE type %s', (invoiceType, documentType) => {
    const state = invoiceReducer(undefined, addInvoice(baseInput(invoiceType)));

    expect(state.invoices[0].documentType).toBe(documentType);
  });
});
