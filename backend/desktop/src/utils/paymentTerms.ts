import { InvoiceType, type PaymentCondition } from '@/types/invoice';

export type PaymentTermsDraft = {
  paymentCondition: PaymentCondition;
  paymentTermCode: string;
  paymentTermPeriod: string;
  dueDate: string;
  openInAccounts: boolean;
};

export type PaymentTermsPayload = {
  dueDate?: string;
  paymentCondition: PaymentCondition;
  paymentTermCode: string | null;
  paymentTermPeriod: number | null;
  openInAccounts: boolean;
};

export const DEFAULT_PAYMENT_TERMS_DRAFT: PaymentTermsDraft = {
  paymentCondition: 1,
  paymentTermCode: '',
  paymentTermPeriod: '',
  dueDate: '',
  openInAccounts: false,
};

const FINANCE_INVOICE_TYPES = new Set<InvoiceType>([
  InvoiceType.Factura,
  InvoiceType.CCF,
  InvoiceType.FacturaExportacion,
]);

export function supportsInvoicePaymentTerms(invoiceType?: InvoiceType | null): boolean {
  return invoiceType != null && FINANCE_INVOICE_TYPES.has(invoiceType);
}

export function normalizePaymentCondition(value: unknown): PaymentCondition {
  const parsed = Number(value);
  return parsed === 2 || parsed === 3 ? parsed : 1;
}

function normalizeDateOnly(value?: string | null): string | undefined {
  if (!value) return undefined;
  const datePart = value.slice(0, 10);
  const parsed = new Date(`${datePart}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10);
}

export function addPaymentTermToDate(
  issueDate: string | undefined,
  paymentTermCode: string,
  paymentTermPeriod: number,
): string | undefined {
  const normalizedIssueDate = normalizeDateOnly(issueDate);
  if (!normalizedIssueDate || paymentTermPeriod <= 0) return undefined;

  const date = new Date(`${normalizedIssueDate}T00:00:00.000Z`);
  switch (paymentTermCode) {
    case '02':
      date.setUTCMonth(date.getUTCMonth() + paymentTermPeriod);
      break;
    case '03':
      date.setUTCFullYear(date.getUTCFullYear() + paymentTermPeriod);
      break;
    case '01':
    default:
      date.setUTCDate(date.getUTCDate() + paymentTermPeriod);
      break;
  }

  return date.toISOString().slice(0, 10);
}

export function paymentTermsFromSource(source?: {
  dueDate?: string | null;
  paymentCondition?: number | null;
  paymentTermCode?: string | null;
  paymentTermPeriod?: number | null;
  openInAccounts?: boolean | null;
}): PaymentTermsDraft {
  const paymentCondition = normalizePaymentCondition(source?.paymentCondition);
  return {
    paymentCondition,
    paymentTermCode: source?.paymentTermCode ?? (paymentCondition === 1 ? '' : '01'),
    paymentTermPeriod: source?.paymentTermPeriod != null
      ? String(source.paymentTermPeriod)
      : paymentCondition === 1 ? '' : '30',
    dueDate: source?.dueDate?.slice(0, 10) ?? '',
    openInAccounts: !!source?.openInAccounts,
  };
}

export function paymentTermsToPayload(
  draft: PaymentTermsDraft,
  options: { supportsPaymentTerms: boolean; issueDate?: string },
): PaymentTermsPayload {
  if (!options.supportsPaymentTerms) {
    return {
      dueDate: undefined,
      paymentCondition: 1,
      paymentTermCode: null,
      paymentTermPeriod: null,
      openInAccounts: false,
    };
  }

  const paymentCondition = normalizePaymentCondition(draft.paymentCondition);
  const dueDate = draft.dueDate || (
    paymentCondition === 1 && draft.openInAccounts && options.issueDate
      ? options.issueDate
      : undefined
  );

  if (paymentCondition === 1) {
    return {
      dueDate,
      paymentCondition,
      paymentTermCode: null,
      paymentTermPeriod: null,
      openInAccounts: draft.openInAccounts,
    };
  }

  const parsedPeriod = Number.parseInt(draft.paymentTermPeriod, 10);
  const paymentTermPeriod = Number.isFinite(parsedPeriod) && parsedPeriod > 0
    ? parsedPeriod
    : 30;
  const paymentTermCode = draft.paymentTermCode || '01';

  return {
    dueDate: addPaymentTermToDate(options.issueDate, paymentTermCode, paymentTermPeriod),
    paymentCondition,
    paymentTermCode,
    paymentTermPeriod,
    openInAccounts: false,
  };
}
