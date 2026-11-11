import { AccountAgingBucket, AccountDirection, AccountEntry, AccountPayment, AccountStatus } from '@/types/accounts';
import { Compra } from '@/types/compras';
import { Customer } from '@/types/customer';
import { Invoice, InvoiceStatus, InvoiceType } from '@/types/invoice';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const RECEIVABLE_TYPES = new Set<InvoiceType>([
  InvoiceType.Factura,
  InvoiceType.CCF,
  InvoiceType.FacturaExportacion,
]);

const CREDIT_NOTE_TYPES = new Set<InvoiceType>([InvoiceType.NotaCredito]);
const DEBIT_NOTE_TYPES = new Set<InvoiceType>([InvoiceType.NotaDebito]);
const PAYABLE_COMPRA_TYPES = new Set(['01', '03', '11', '14']);
const SUPPLIER_CREDIT_NOTE_TYPES = new Set(['05']);
const SUPPLIER_DEBIT_NOTE_TYPES = new Set(['06']);
const DEFAULT_PAYMENT_TERM_DAYS = 30;

type AccountablePaymentSource = {
  dueDate?: string | null;
  paymentCondition?: number | null;
  paymentTermCode?: string | null;
  paymentTermPeriod?: number | null;
  openInAccounts?: boolean;
};

function toDateOnly(value?: string): string {
  if (!value) return todayLocalDate();
  return value.slice(0, 10);
}

export function todayLocalDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateOnlyLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: string, days: number): string {
  const base = new Date(`${toDateOnly(date)}T00:00:00`);
  base.setDate(base.getDate() + days);
  return formatDateOnlyLocal(base);
}

function addPaymentTerm(issueDate: string, source: AccountablePaymentSource): string {
  const period = Number(source.paymentTermPeriod);
  if (!Number.isFinite(period) || period <= 0) {
    return addDays(issueDate, DEFAULT_PAYMENT_TERM_DAYS);
  }

  const base = new Date(`${toDateOnly(issueDate)}T00:00:00`);
  switch (source.paymentTermCode) {
    case '01':
      base.setDate(base.getDate() + period);
      break;
    case '02':
      base.setMonth(base.getMonth() + period);
      break;
    case '03':
      base.setFullYear(base.getFullYear() + period);
      break;
    default:
      base.setDate(base.getDate() + DEFAULT_PAYMENT_TERM_DAYS);
      break;
  }
  return formatDateOnlyLocal(base);
}

function paymentDueDate(issueDate: string, source: AccountablePaymentSource): string {
  return toDateOnly(source.dueDate ?? addPaymentTerm(issueDate, source));
}

function opensAccountBalance(source: AccountablePaymentSource): boolean {
  if (source.openInAccounts === true) return true;
  const condition = Number(source.paymentCondition ?? 1);
  if (condition === 2) return true;
  if (condition === 3) return !!(source.dueDate || source.paymentTermCode || source.paymentTermPeriod);
  return false;
}

function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function amountForInvoice(invoice: Invoice): number {
  return roundMoney(
    invoice.totalAmountIncludingTax ??
      invoice.totalAmount ??
      invoice.total ??
      invoice.totals?.totalPagar ??
      invoice.totals?.totalAmount ??
      0,
  );
}

function amountForCompra(compra: Compra): number {
  return roundMoney(compra.totalPagar ?? 0);
}

function daysBetween(date: string, today: string): number {
  const lhs = new Date(`${toDateOnly(date)}T00:00:00`).getTime();
  const rhs = new Date(`${toDateOnly(today)}T00:00:00`).getTime();
  return Math.floor((rhs - lhs) / MS_PER_DAY);
}

function agingBucket(dueDate: string, today: string): AccountAgingBucket {
  const daysPastDue = daysBetween(dueDate, today);
  if (daysPastDue < 0) return 'current';
  if (daysPastDue === 0) return 'dueToday';
  if (daysPastDue <= 30) return 'days1To30';
  if (daysPastDue <= 60) return 'days31To60';
  if (daysPastDue <= 90) return 'days61To90';
  return 'days90Plus';
}

function statusFor(balance: number, paidAmount: number, dueDate: string, today: string, voided: boolean): AccountStatus {
  if (voided) return 'void';
  if (balance <= 0.005) return 'paid';
  if (daysBetween(dueDate, today) > 0) return 'overdue';
  if (paidAmount > 0) return 'partial';
  return 'open';
}

function isLedgerInvoice(invoice: Invoice): boolean {
  if (!RECEIVABLE_TYPES.has(invoice.invoiceType)) return false;
  if (!opensAccountBalance(invoice)) return false;
  return invoice.status === InvoiceStatus.Completada || invoice.status === InvoiceStatus.Modificada;
}

function isVoidedInvoice(invoice: Invoice): boolean {
  return invoice.status === InvoiceStatus.Anulada || !!invoice.invalidatedViaApi;
}

function customerName(customer?: Customer | null): string {
  if (!customer) return 'Cliente sin nombre';
  return (
    customer.businessName ||
    customer.name ||
    [customer.firstName, customer.lastName].filter(Boolean).join(' ') ||
    'Cliente sin nombre'
  );
}

function customerTaxId(customer?: Customer | null): string | undefined {
  return customer?.nit || customer?.nationalId || customer?.nrc || customer?.documentNumber;
}

function invoiceDocument(invoice: Invoice): string {
  return invoice.controlNumber || invoice.invoiceNumber || invoice.generationCode || invoice.id;
}

function compraDocument(compra: Compra): string {
  return compra.numeroControl || compra.codigoGeneracion || compra.id;
}

function sameDocumentNumber(lhs?: string, rhs?: string): boolean {
  return !!lhs && !!rhs && lhs.trim().toUpperCase() === rhs.trim().toUpperCase();
}

function isRelatedAdjustmentForInvoice(candidate: Invoice, invoice: Invoice): boolean {
  if (candidate.id === invoice.id) return false;
  if (candidate.companyId !== invoice.companyId) return false;
  if (!CREDIT_NOTE_TYPES.has(candidate.invoiceType) && !DEBIT_NOTE_TYPES.has(candidate.invoiceType)) return false;
  if (candidate.status !== InvoiceStatus.Completada && candidate.status !== InvoiceStatus.Modificada) return false;
  if (isVoidedInvoice(candidate)) return false;

  return (
    sameDocumentNumber(candidate.relatedId, invoice.id) ||
    sameDocumentNumber(candidate.relatedControlNumber, invoice.controlNumber) ||
    sameDocumentNumber(candidate.relatedGenerationCode, invoice.generationCode) ||
    sameDocumentNumber(candidate.relatedDocumentNumber, invoice.controlNumber) ||
    sameDocumentNumber(candidate.relatedDocumentNumber, invoice.generationCode) ||
    sameDocumentNumber(candidate.relatedDocumentNumber, invoice.invoiceNumber)
  );
}

function adjustmentsForInvoice(invoice: Invoice, allInvoices: Invoice[]): number {
  return roundMoney(
    allInvoices.reduce((sum, candidate) => {
      if (!isRelatedAdjustmentForInvoice(candidate, invoice)) {
        return sum;
      }
      const amount = amountForInvoice(candidate);
      if (CREDIT_NOTE_TYPES.has(candidate.invoiceType)) return sum - amount;
      if (DEBIT_NOTE_TYPES.has(candidate.invoiceType)) return sum + amount;
      return sum;
    }, 0),
  );
}

function isRelatedAdjustmentForCompra(candidate: Compra, compra: Compra): boolean {
  if (candidate.id === compra.id) return false;
  if (candidate.companyId !== compra.companyId) return false;
  const candidateType = String(candidate.tipoDte).padStart(2, '0');
  if (!SUPPLIER_CREDIT_NOTE_TYPES.has(candidateType) && !SUPPLIER_DEBIT_NOTE_TYPES.has(candidateType)) return false;
  if (candidate.invalidatedAt) return false;

  return (
    sameDocumentNumber(candidate.relatedDocumentNumber, compra.numeroControl) ||
    sameDocumentNumber(candidate.relatedDocumentNumber, compra.codigoGeneracion) ||
    sameDocumentNumber(candidate.relatedControlNumber, compra.numeroControl) ||
    sameDocumentNumber(candidate.relatedControlNumber, compra.codigoGeneracion) ||
    sameDocumentNumber(candidate.relatedGenerationCode, compra.codigoGeneracion) ||
    sameDocumentNumber(candidate.relatedGenerationCode, compra.numeroControl)
  );
}

function adjustmentsForCompra(compra: Compra, allCompras: Compra[]): number {
  return roundMoney(
    allCompras.reduce((sum, candidate) => {
      if (!isRelatedAdjustmentForCompra(candidate, compra)) {
        return sum;
      }
      const amount = amountForCompra(candidate);
      const candidateType = String(candidate.tipoDte).padStart(2, '0');
      if (SUPPLIER_CREDIT_NOTE_TYPES.has(candidateType)) return sum - amount;
      if (SUPPLIER_DEBIT_NOTE_TYPES.has(candidateType)) return sum + amount;
      return sum;
    }, 0),
  );
}

function paymentsFor(entryId: string, payments: AccountPayment[]): number {
  return roundMoney(
    payments
      .filter((payment) => payment.entryId === entryId)
      .reduce((sum, payment) => sum + payment.amount, 0),
  );
}

function finalizeEntry(
  draft: Omit<AccountEntry, 'paidAmount' | 'balance' | 'status' | 'agingBucket' | 'updatedAt'>,
  payments: AccountPayment[],
  today: string,
  previous?: AccountEntry,
  voided = false,
): AccountEntry {
  const paidAmount = paymentsFor(draft.id, payments);
  const balance = voided ? 0 : Math.max(0, roundMoney(draft.originalAmount + draft.adjustmentAmount - paidAmount));
  const status = statusFor(balance, paidAmount, draft.dueDate, today, voided);
  return {
    ...draft,
    createdAt: previous?.createdAt ?? draft.createdAt,
    paidAmount,
    balance,
    status,
    agingBucket: agingBucket(draft.dueDate, today),
    updatedAt: new Date().toISOString(),
  };
}

export class AccountsLedgerService {
  static today(): string {
    return todayLocalDate();
  }

  static buildEntriesFromDocuments(params: {
    companyId: string;
    invoices: Invoice[];
    compras: Compra[];
    customers?: Customer[];
    existingEntries?: AccountEntry[];
    payments?: AccountPayment[];
    today?: string;
  }): AccountEntry[] {
    const {
      companyId,
      invoices,
      compras,
      customers = [],
      existingEntries = [],
      payments = [],
      today = AccountsLedgerService.today(),
    } = params;
    const customerById = new Map(customers.map((customer) => [customer.id, customer]));
    const previousById = new Map(existingEntries.map((entry) => [entry.id, entry]));
    const entries: AccountEntry[] = [];
    const now = new Date().toISOString();

    for (const invoice of invoices.filter((item) => item.companyId === companyId)) {
      if (!isLedgerInvoice(invoice) && !isVoidedInvoice(invoice)) continue;
      if (!RECEIVABLE_TYPES.has(invoice.invoiceType)) continue;
      if (!opensAccountBalance(invoice)) continue;

      const id = AccountsLedgerService.entryId('receivable', 'invoice', invoice.id);
      const customer = invoice.customer ?? (invoice.customerId ? customerById.get(invoice.customerId) : undefined);
      const issueDate = toDateOnly(invoice.fechaGeneracion ?? invoice.date);
      const dueDate = paymentDueDate(issueDate, invoice);
      const previous = previousById.get(id);

      entries.push(finalizeEntry(
        {
          id,
          companyId,
          direction: 'receivable',
          sourceType: 'invoice',
          sourceId: invoice.id,
          party: {
            id: invoice.customerId,
            name: customerName(customer),
            taxId: customerTaxId(customer),
            email: customer?.email,
            phone: customer?.phone,
          },
          documentType: invoice.documentType || String(invoice.invoiceType),
          documentNumber: invoiceDocument(invoice),
          controlNumber: invoice.controlNumber,
          generationCode: invoice.generationCode,
          issueDate,
          dueDate,
          currency: 'USD',
          originalAmount: amountForInvoice(invoice),
          adjustmentAmount: adjustmentsForInvoice(invoice, invoices),
          notes: invoice.observaciones,
          createdAt: previous?.createdAt ?? now,
        },
        payments,
        today,
        previous,
        isVoidedInvoice(invoice),
      ));
    }

    for (const compra of compras.filter((item) => item.companyId === companyId)) {
      if (!PAYABLE_COMPRA_TYPES.has(String(compra.tipoDte).padStart(2, '0'))) continue;
      const id = AccountsLedgerService.entryId('payable', 'compra', compra.id);
      const previous = previousById.get(id);
      const isVoided = !!compra.invalidatedAt;
      if (!opensAccountBalance(compra) && !(isVoided && previous)) continue;
      const issueDate = toDateOnly(compra.fecha);
      const dueDate = paymentDueDate(issueDate, compra);

      entries.push(finalizeEntry(
        {
          id,
          companyId,
          direction: 'payable',
          sourceType: 'compra',
          sourceId: compra.id,
          party: {
            id: compra.emisorNit || compra.emisorNombre,
            name: compra.emisorNombre || 'Proveedor sin nombre',
            taxId: compra.emisorNit,
          },
          documentType: compra.tipoDte,
          documentNumber: compraDocument(compra),
          controlNumber: compra.numeroControl,
          generationCode: compra.codigoGeneracion,
          issueDate,
          dueDate,
          currency: 'USD',
          originalAmount: amountForCompra(compra),
          adjustmentAmount: adjustmentsForCompra(compra, compras),
          createdAt: previous?.createdAt ?? now,
        },
        payments,
        today,
        previous,
        isVoided,
      ));
    }

    return entries.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  }

  static entryId(direction: AccountDirection, sourceType: string, sourceId: string): string {
    return `acct_${direction}_${sourceType}_${sourceId}`;
  }

  static validatePayment(entry: AccountEntry, amount: number): string | null {
    if (!Number.isFinite(amount) || amount <= 0) return 'Ingrese un monto mayor a cero';
    if (entry.status === 'void') return 'No se puede registrar pago en una cuenta anulada';
    if (amount - entry.balance > 0.005) return 'El monto supera el saldo pendiente';
    return null;
  }

  static paymentLabel(direction: AccountDirection): string {
    return direction === 'receivable' ? 'Cobro' : 'Pago';
  }

  static statusLabel(status: AccountStatus): string {
    switch (status) {
      case 'open':
        return 'Al día';
      case 'partial':
        return 'Parcial';
      case 'paid':
        return 'Pagada';
      case 'overdue':
        return 'Vencida';
      case 'void':
        return 'Anulada';
      default:
        return status;
    }
  }

  static agingLabel(bucket: AccountAgingBucket): string {
    switch (bucket) {
      case 'current':
        return 'Al día';
      case 'dueToday':
        return 'Vence hoy';
      case 'days1To30':
        return '1-30 vencidos';
      case 'days31To60':
        return '31-60';
      case 'days61To90':
        return '61-90';
      case 'days90Plus':
        return '90+';
      default:
        return bucket;
    }
  }
}
