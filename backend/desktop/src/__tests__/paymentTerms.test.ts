import {
  paymentTermsFromSource,
  paymentTermsToPayload,
  supportsInvoicePaymentTerms,
} from '../utils/paymentTerms';
import { InvoiceType } from '../types/invoice';

describe('payment terms helpers', () => {
  it('defaults new documents to contado', () => {
    expect(paymentTermsFromSource()).toEqual({
      paymentCondition: 1,
      paymentTermCode: '',
      paymentTermPeriod: '',
      dueDate: '',
      openInAccounts: false,
    });
  });

  it('only exposes invoice payment terms for receivable invoice types', () => {
    expect(supportsInvoicePaymentTerms(InvoiceType.Factura)).toBe(true);
    expect(supportsInvoicePaymentTerms(InvoiceType.CCF)).toBe(true);
    expect(supportsInvoicePaymentTerms(InvoiceType.FacturaExportacion)).toBe(true);
    expect(supportsInvoicePaymentTerms(InvoiceType.NotaCredito)).toBe(false);
  });

  it('normalizes credit terms for create and edit payloads', () => {
    expect(paymentTermsToPayload({
      paymentCondition: 2,
      paymentTermCode: '02',
      paymentTermPeriod: '3',
      dueDate: '2026-08-01',
      openInAccounts: true,
    }, {
      supportsPaymentTerms: true,
      issueDate: '2026-06-20',
    })).toEqual({
      paymentCondition: 2,
      paymentTermCode: '02',
      paymentTermPeriod: 3,
      dueDate: '2026-09-20',
      openInAccounts: false,
    });
  });

  it('uses issue date as due date for explicit unpaid contado documents', () => {
    expect(paymentTermsToPayload({
      paymentCondition: 1,
      paymentTermCode: '',
      paymentTermPeriod: '',
      dueDate: '',
      openInAccounts: true,
    }, {
      supportsPaymentTerms: true,
      issueDate: '2026-06-20',
    })).toEqual({
      paymentCondition: 1,
      paymentTermCode: null,
      paymentTermPeriod: null,
      dueDate: '2026-06-20',
      openInAccounts: true,
    });
  });
});
