import { AccountsLedgerService, todayLocalDate } from '../services/accounts/AccountsLedgerService';
import { AccountPayment } from '../types/accounts';
import { Compra, CompraSource } from '../types/compras';
import { Invoice, InvoiceStatus, InvoiceType } from '../types/invoice';

const baseInvoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: 'invoice-001',
  invoiceNumber: 'INV-001',
  date: '2026-06-15',
  paymentCondition: 2,
  status: InvoiceStatus.Completada,
  customerId: 'customer-001',
  invoiceType: InvoiceType.Factura,
  documentType: '01',
  companyId: 'company-001',
  items: [],
  createdAt: '2026-06-15T10:00:00.000Z',
  updatedAt: '2026-06-15T10:00:00.000Z',
  totalAmountIncludingTax: 100,
  ...overrides,
});

const baseCompra = (overrides: Partial<Compra> = {}): Compra => ({
  id: 'compra-001',
  companyId: 'company-001',
  emisorNit: '0614-010101-101-1',
  emisorNombre: 'Proveedor Demo',
  tipoDte: '03',
  codigoGeneracion: 'COMPRA-GEN-001',
  numeroControl: 'DTE-03-COMPRA',
  fecha: '2026-06-20',
  paymentCondition: 2,
  totalGravada: 100,
  totalIva: 13,
  totalPagar: 113,
  source: CompraSource.Manual,
  items: [],
  createdAt: '2026-06-20T10:00:00.000Z',
  updatedAt: '2026-06-20T10:00:00.000Z',
  ...overrides,
});

describe('AccountsLedgerService', () => {
  it('formats today using the local calendar day instead of UTC slicing', () => {
    expect(todayLocalDate(new Date(2026, 5, 22, 23, 30))).toBe('2026-06-22');
  });

  it('creates overdue receivables from completed invoices without changing the invoice', () => {
    const invoice = baseInvoice();
    const entries = AccountsLedgerService.buildEntriesFromDocuments({
      companyId: 'company-001',
      invoices: [invoice],
      compras: [],
      today: '2026-07-20',
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      direction: 'receivable',
      sourceId: 'invoice-001',
      originalAmount: 100,
      paidAmount: 0,
      balance: 100,
      status: 'overdue',
      dueDate: '2026-07-15',
    });
    expect(invoice.status).toBe(InvoiceStatus.Completada);
  });

  it('applies payments and returns partial or paid status without over-allocation', () => {
    const entryId = AccountsLedgerService.entryId('receivable', 'invoice', 'invoice-001');
    const payments: AccountPayment[] = [
      {
        id: 'payment-001',
        companyId: 'company-001',
        entryId,
        direction: 'receivable',
        paymentDate: '2026-07-01',
        amount: 40,
        methodCode: '03',
        createdAt: '2026-07-01T10:00:00.000Z',
        updatedAt: '2026-07-01T10:00:00.000Z',
      },
    ];

    const [entry] = AccountsLedgerService.buildEntriesFromDocuments({
      companyId: 'company-001',
      invoices: [baseInvoice()],
      compras: [],
      payments,
      today: '2026-07-02',
    });

    expect(entry.paidAmount).toBe(40);
    expect(entry.balance).toBe(60);
    expect(entry.status).toBe('partial');
    expect(AccountsLedgerService.validatePayment(entry, 61)).toBe('El monto supera el saldo pendiente');
    expect(AccountsLedgerService.validatePayment(entry, 60)).toBeNull();
  });

  it('keeps partially paid past-due accounts in overdue status', () => {
    const entryId = AccountsLedgerService.entryId('receivable', 'invoice', 'invoice-001');
    const payments: AccountPayment[] = [
      {
        id: 'payment-001',
        companyId: 'company-001',
        entryId,
        direction: 'receivable',
        paymentDate: '2026-07-01',
        amount: 40,
        methodCode: '03',
        createdAt: '2026-07-01T10:00:00.000Z',
        updatedAt: '2026-07-01T10:00:00.000Z',
      },
    ];

    const [entry] = AccountsLedgerService.buildEntriesFromDocuments({
      companyId: 'company-001',
      invoices: [baseInvoice({ dueDate: '2026-06-20' })],
      compras: [],
      payments,
      today: '2026-07-20',
    });

    expect(entry.paidAmount).toBe(40);
    expect(entry.balance).toBe(60);
    expect(entry.status).toBe('overdue');
  });

  it('reduces receivable balance when a related credit note is completed', () => {
    const invoice = baseInvoice({ totalAmountIncludingTax: 100 });
    const creditNote = baseInvoice({
      id: 'credit-001',
      invoiceNumber: 'NC-001',
      invoiceType: InvoiceType.NotaCredito,
      documentType: '05',
      relatedId: invoice.id,
      totalAmountIncludingTax: 25,
    });

    const [entry] = AccountsLedgerService.buildEntriesFromDocuments({
      companyId: 'company-001',
      invoices: [invoice, creditNote],
      compras: [],
      today: '2026-07-01',
    });

    expect(entry.adjustmentAmount).toBe(-25);
    expect(entry.balance).toBe(75);
  });

  it('does not apply unrelated credit notes with empty relation fields', () => {
    const invoice = baseInvoice({ totalAmountIncludingTax: 100, controlNumber: undefined, generationCode: undefined });
    const creditNote = baseInvoice({
      id: 'credit-001',
      invoiceNumber: 'NC-001',
      invoiceType: InvoiceType.NotaCredito,
      documentType: '05',
      relatedId: undefined,
      relatedDocumentNumber: undefined,
      relatedControlNumber: undefined,
      relatedGenerationCode: undefined,
      totalAmountIncludingTax: 25,
    });

    const [entry] = AccountsLedgerService.buildEntriesFromDocuments({
      companyId: 'company-001',
      invoices: [invoice, creditNote],
      compras: [],
      today: '2026-07-01',
    });

    expect(entry.adjustmentAmount).toBe(0);
    expect(entry.balance).toBe(100);
  });

  it('ignores credit notes from other companies when adjusting a receivable', () => {
    const invoice = baseInvoice({ totalAmountIncludingTax: 100, controlNumber: 'DTE-01-001' });
    const otherCompanyCreditNote = baseInvoice({
      id: 'credit-other',
      companyId: 'other-company',
      invoiceNumber: 'NC-OTHER',
      invoiceType: InvoiceType.NotaCredito,
      documentType: '05',
      relatedControlNumber: 'DTE-01-001',
      totalAmountIncludingTax: 25,
    });

    const [entry] = AccountsLedgerService.buildEntriesFromDocuments({
      companyId: 'company-001',
      invoices: [invoice, otherCompanyCreditNote],
      compras: [],
      today: '2026-07-01',
    });

    expect(entry.adjustmentAmount).toBe(0);
    expect(entry.balance).toBe(100);
  });

  it('creates payables from compras scoped to the current company', () => {
    const entries = AccountsLedgerService.buildEntriesFromDocuments({
      companyId: 'company-001',
      invoices: [baseInvoice({ companyId: 'other-company' })],
      compras: [baseCompra(), baseCompra({ id: 'compra-other', companyId: 'other-company' })],
      today: '2026-07-01',
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      direction: 'payable',
      sourceId: 'compra-001',
      originalAmount: 113,
      balance: 113,
    });
  });

  it('does not create source entries for contado invoices or compras', () => {
    const entries = AccountsLedgerService.buildEntriesFromDocuments({
      companyId: 'company-001',
      invoices: [baseInvoice({ paymentCondition: 1, dueDate: undefined })],
      compras: [baseCompra({ paymentCondition: 1, dueDate: undefined })],
      today: '2026-07-01',
    });

    expect(entries).toHaveLength(0);
  });

  it('creates source entries for explicit unpaid contado documents', () => {
    const entries = AccountsLedgerService.buildEntriesFromDocuments({
      companyId: 'company-001',
      invoices: [baseInvoice({ paymentCondition: 1, openInAccounts: true })],
      compras: [baseCompra({ paymentCondition: 1, openInAccounts: true })],
      today: '2026-07-01',
    });

    expect(entries.map(entry => entry.sourceId).sort()).toEqual(['compra-001', 'invoice-001']);
  });

  it('does not create standalone payables from supplier credit notes', () => {
    const entries = AccountsLedgerService.buildEntriesFromDocuments({
      companyId: 'company-001',
      invoices: [],
      compras: [baseCompra({ tipoDte: '05' })],
      today: '2026-07-01',
    });

    expect(entries).toHaveLength(0);
  });

  it('adjusts payables with supplier credit and debit notes related to the purchase', () => {
    const entries = AccountsLedgerService.buildEntriesFromDocuments({
      companyId: 'company-001',
      invoices: [],
      compras: [
        baseCompra({
          id: 'compra-base',
          codigoGeneracion: 'GEN-BASE',
          numeroControl: 'DTE-03-BASE',
          totalPagar: 100,
        }),
        baseCompra({
          id: 'compra-credit',
          tipoDte: '05',
          codigoGeneracion: 'GEN-CREDIT',
          numeroControl: 'DTE-05-CREDIT',
          relatedDocumentNumber: 'DTE-03-BASE',
          totalPagar: 25,
        }),
        baseCompra({
          id: 'compra-debit',
          tipoDte: '06',
          codigoGeneracion: 'GEN-DEBIT',
          numeroControl: 'DTE-06-DEBIT',
          relatedGenerationCode: 'GEN-BASE',
          totalPagar: 10,
        }),
      ],
      today: '2026-07-01',
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].adjustmentAmount).toBe(-15);
    expect(entries[0].balance).toBe(85);
  });

  it('keeps invalidated purchases as void payables with existing payment audit trail', () => {
    const entryId = AccountsLedgerService.entryId('payable', 'compra', 'compra-001');
    const payments: AccountPayment[] = [
      {
        id: 'payment-001',
        companyId: 'company-001',
        entryId,
        direction: 'payable',
        paymentDate: '2026-07-01',
        amount: 25,
        methodCode: '03',
        createdAt: '2026-07-01T10:00:00.000Z',
        updatedAt: '2026-07-01T10:00:00.000Z',
      },
    ];

    const [entry] = AccountsLedgerService.buildEntriesFromDocuments({
      companyId: 'company-001',
      invoices: [],
      compras: [baseCompra({ invalidatedAt: '2026-07-02T10:00:00.000Z' })],
      payments,
      today: '2026-07-03',
    });

    expect(entry).toMatchObject({
      id: entryId,
      direction: 'payable',
      sourceId: 'compra-001',
      paidAmount: 25,
      balance: 0,
      status: 'void',
    });
  });
});
