// Ticket↔invoice linking middleware.
//
// The consolidation wizard drafts a Factura and marks the selected tickets
// `pendingInvoiceId`. This middleware watches the invoice lifecycle and
// reconciles the ticket side automatically:
//   • invoice reaches Completada → tickets become CONSOLIDATED (linked), by
//     reservation or by the invoice's own sourceTicketIds
//   • draft deleted              → tickets released back to COMPLETED
//   • invoice Anulada            → released ONLY if no credit note references
//     it (after an NC the operator decides per ticket, Phase 2)
//   • ErrorEnvio                 → NOTHING: a failed send (often a timeout) is
//     retried on the same draft. Releasing here let a successful retry find no
//     tickets to link, so the same sales stayed "pending" and could be
//     consolidated — and declared — a second time.
//
// See openspec/changes/add-pos-tickets/design.md §6.

import type { Middleware } from '@reduxjs/toolkit';
import type { RootState } from '../index';
import { InvoiceStatus, InvoiceType, type Invoice } from '@/types/invoice';
import { TicketDatabase } from '../../services/tickets/TicketDatabase';

function hasCreditNoteFor(invoice: Invoice, allInvoices: Invoice[]): boolean {
  return allInvoices.some(
    (inv) =>
      inv.invoiceType === InvoiceType.NotaCredito &&
      (inv.relatedId === invoice.id ||
        (invoice.generationCode && inv.relatedGenerationCode === invoice.generationCode)),
  );
}

async function reconcile(invoice: Invoice | undefined, allInvoices: Invoice[]): Promise<void> {
  if (!invoice) return;

  if (invoice.status === InvoiceStatus.Completada) {
    const sources = invoice.sourceTicketIds ?? [];
    const linked = await TicketDatabase.getByInvoiceId(invoice.companyId, invoice.id);
    if (linked.length || sources.length) {
      await TicketDatabase.markConsolidated(invoice.companyId, invoice.id, invoice.controlNumber, sources);
    }
    return;
  }

  if (invoice.status === InvoiceStatus.Anulada && !hasCreditNoteFor(invoice, allInvoices)) {
    await TicketDatabase.releaseConsolidation(invoice.companyId, invoice.id);
  }
}

const WATCHED = new Set([
  'invoices/setInvoiceStatus',
  'invoices/updateInvoice',
]);

// Plain `Middleware` (no RootState generic): the store type flows back into
// this annotation otherwise, circularly (see syncMiddleware for the pattern).
export const ticketConsolidationMiddleware: Middleware =
  (store) => (next) => (action) => {
    const type = (action as { type?: string }).type;

    // Deletion needs the pre-state to know which company owned the invoice.
    if (type === 'invoices/deleteInvoice') {
      // deleteInvoice is PayloadAction<string> — the id is the payload, not the action.
      const invoiceId = (action as { payload?: unknown }).payload;
      const doomed = (store.getState() as RootState).invoices.invoices.find(
        (inv) => inv.id === invoiceId,
      );
      const result = next(action);
      if (doomed) {
        void TicketDatabase.releaseConsolidation(doomed.companyId, doomed.id).catch((error) => {
          console.warn('ticketConsolidation: release on delete failed', error);
        });
      }
      return result;
    }

    const result = next(action);

    if (type && WATCHED.has(type)) {
      const payload = (action as { payload?: { id?: string } }).payload;
      const id = payload?.id;
      if (id) {
        const state = store.getState() as RootState;
        const invoice = state.invoices.invoices.find((inv) => inv.id === id);
        void reconcile(invoice, state.invoices.invoices).catch((error) => {
          console.warn('ticketConsolidation: reconcile failed', error);
        });
      }
    }

    return result;
  };
