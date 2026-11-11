// Which invoices move inventory — the ONE rule every completion path uses
// (InvoiceDetailPage after MH accepts, ContingencyPage per transmitted DTE).
//
//   - Goods leave the warehouse with a Factura (01), CCF (03), Factura de
//     Exportación (11) or Nota de Remisión (04).
//   - A Factura/CCF that bills a Nota de Remisión (related document 04) does
//     not discharge again: the remission already moved the goods.
//   - NC (05), ND (06), FSE (14), CR (07), CL (08), DCL (09), CD (15) and the
//     events (17/18) never move stock. An NC can be a pure price adjustment, so
//     returned goods are re-entered as a manual stock adjustment.
//   - POS consolidations (sourceTicketIds) never discharge: each ticket sale
//     already did.
// Invalidating a document restores exactly what it discharged (productSlice
// restoreInvoiceStock, from its own OUT movements), so the rule here only
// decides the deduction.

import { Invoice, InvoiceType } from '../../types/invoice';

export const STOCK_QUANTITY_DECIMALS = 4;

/** Stock quantities keep fractions (0.5 kg) — rounded to 4 decimals to avoid float drift. */
export function roundStockQuantity(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** STOCK_QUANTITY_DECIMALS;
  return Math.round(n * factor) / factor;
}

const STOCK_DISCHARGING_TYPES = new Set<InvoiceType>([
  InvoiceType.Factura,
  InvoiceType.CCF,
  InvoiceType.FacturaExportacion,
  InvoiceType.NotaRemision,
]);

type StockRuleInvoice = Pick<
  Invoice,
  'invoiceType' | 'sourceTicketIds' | 'relatedInvoiceType' | 'relatedDocumentType'
>;

function billsARemissionNote(invoice: StockRuleInvoice): boolean {
  return (
    invoice.relatedInvoiceType === InvoiceType.NotaRemision ||
    invoice.relatedDocumentType === '04'
  );
}

/** True when completing this invoice must discharge its items from stock. */
export function invoiceDischargesStock(invoice: StockRuleInvoice): boolean {
  if (invoice.sourceTicketIds?.length) return false;
  if (!STOCK_DISCHARGING_TYPES.has(invoice.invoiceType)) return false;
  if (
    (invoice.invoiceType === InvoiceType.Factura || invoice.invoiceType === InvoiceType.CCF) &&
    billsARemissionNote(invoice)
  ) {
    return false;
  }
  return true;
}

export interface InvoiceStockDeductionPayload {
  invoiceId: string;
  items: { productId: string; quantity: number; productName?: string }[];
  createdAt: string;
  createdBy: string;
}

/**
 * The `applyInvoiceStockDeduction` payload for a just-completed invoice, or
 * null when the rule says it moves no stock. Callers dispatch it; the reducer
 * is idempotent per invoice.
 */
export function invoiceStockDeductionPayload(
  invoice: StockRuleInvoice & Pick<Invoice, 'id' | 'items'>,
  createdBy: string,
  createdAt: string = new Date().toISOString(),
): InvoiceStockDeductionPayload | null {
  if (!invoiceDischargesStock(invoice)) return null;
  const items = (invoice.items ?? []).map((item) => ({
    productId: item.productId,
    quantity: item.quantity,
    productName: item.productName,
  }));
  if (items.length === 0) return null;
  return { invoiceId: invoice.id, items, createdAt, createdBy };
}
