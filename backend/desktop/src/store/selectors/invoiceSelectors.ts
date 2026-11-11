// Invoice selectors aligned with Swift functionality

import { createSelector } from '@reduxjs/toolkit';
import { RootState } from '../index';
import { InvoiceStatus, InvoiceType } from '../../types/invoice';
import type { Invoice } from '../../types/invoice';

/**
 * Sale amount of a document for revenue figures: the document total BEFORE
 * the customer's 1% IVA retention / FSE renta. Stored `totalPagar` (and the
 * legacy `totalAmountIncludingTax` mirror) now net those withholdings, which
 * are still sales — revenue must not shrink because a customer withholds.
 */
export function saleAmountOf(inv: Pick<Invoice, 'totals' | 'totalAmountIncludingTax'>): number {
  return inv.totals?.totalAmount ?? inv.totalAmountIncludingTax ?? 0;
}

const invoiceTypeSearchLabel = (type: InvoiceType): string => {
  switch (type) {
    case InvoiceType.Factura: return 'Factura consumidor final 01';
    case InvoiceType.CCF: return 'Comprobante credito fiscal CCF 03';
    case InvoiceType.NotaCredito: return 'Nota credito 05';
    case InvoiceType.NotaDebito: return 'Nota debito 06';
    case InvoiceType.NotaRemision: return 'Nota remision 04';
    case InvoiceType.ComprobanteLiquidacion: return 'Comprobante liquidacion 08';
    case InvoiceType.FacturaExportacion: return 'Factura exportacion 11';
    case InvoiceType.ComprobanteRetencion: return 'Comprobante retencion 07';
    case InvoiceType.DocumentoContableLiquidacion: return 'Documento contable liquidacion 09';
    case InvoiceType.SujetoExcluido: return 'Sujeto excluido 14';
    case InvoiceType.ComprobanteDonacion: return 'Comprobante donacion 15';
    case InvoiceType.EventoOperacionesEspeciales: return 'Evento operaciones especiales 17';
    case InvoiceType.EventoRetorno: return 'Evento retorno 18';
    default: return 'DTE';
  }
};

export const selectInvoiceState = (state: RootState) => state.invoices;

export const selectAllInvoices = createSelector(
  [selectInvoiceState],
  (state) => state.invoices
);

export const selectInvoicesLoading = createSelector(
  [selectInvoiceState],
  (state) => state.loading
);

export const selectInvoicesError = createSelector(
  [selectInvoiceState],
  (state) => state.error
);

export const selectInvoicesSearchTerm = createSelector(
  [selectInvoiceState],
  (state) => state.searchTerm
);

export const selectInvoiceFilters = createSelector(
  [selectInvoiceState],
  (state) => state.filters
);

export const selectSelectedInvoiceId = createSelector(
  [selectInvoiceState],
  (state) => state.selectedInvoiceId
);

export const selectCurrentInvoice = createSelector(
  [selectInvoiceState],
  (state) => state.currentInvoice
);

export const selectInvoiceById = (invoiceId: string) =>
  createSelector([selectAllInvoices], (invoices) =>
    invoices.find((invoice) => invoice.id === invoiceId) || null
  );

// ✅ OPTIMIZED: Current company's invoices
// Returns all invoices when no company is selected (single-company users)
export const selectCurrentCompanyInvoices = createSelector(
  [selectAllInvoices, (state: RootState) => state.companies.selectedCompanyId],
  (invoices, selectedCompanyId) =>
    selectedCompanyId
      ? invoices.filter((invoice) => invoice.companyId === selectedCompanyId)
      : invoices
);

export const selectFilteredInvoices = createSelector(
  [selectCurrentCompanyInvoices, selectInvoicesSearchTerm, selectInvoiceFilters],
  (invoices, searchTerm, filters) => {
    let results = [...invoices];

    if (filters.status && filters.status.length > 0) {
      results = results.filter((invoice) => filters.status!.includes(invoice.status));
    }

    if (filters.invoiceType && filters.invoiceType.length > 0) {
      results = results.filter((invoice) => filters.invoiceType!.includes(invoice.invoiceType));
    }

    if (filters.customerId) {
      results = results.filter((invoice) => invoice.customerId === filters.customerId);
    }

    if (filters.dateFrom) {
      const from = new Date(filters.dateFrom).getTime();
      results = results.filter((invoice) => new Date(invoice.date).getTime() >= from);
    }

    if (filters.dateTo) {
      const to = new Date(filters.dateTo).getTime();
      results = results.filter((invoice) => new Date(invoice.date).getTime() <= to);
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      results = results.filter((invoice) =>
        invoice.invoiceNumber.toLowerCase().includes(term) ||
        (invoice.controlNumber ?? '').toLowerCase().includes(term) ||
        (invoice.generationCode ?? '').toLowerCase().includes(term) ||
        (invoice.receptionSeal ?? '').toLowerCase().includes(term) ||
        (invoice.documentType ?? '').toLowerCase().includes(term) ||
        (invoice.relatedDocumentNumber ?? '').toLowerCase().includes(term) ||
        (invoice.relatedDocumentType ?? '').toLowerCase().includes(term) ||
        (invoice.relatedGenerationCode ?? '').toLowerCase().includes(term) ||
        (invoice.relatedReceptionSeal ?? '').toLowerCase().includes(term) ||
        (invoice.observaciones ?? '').toLowerCase().includes(term) ||
        invoiceTypeSearchLabel(invoice.invoiceType).toLowerCase().includes(term)
      );
    }

    return results.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }
);

export const selectInvoicesByStatus = (status: InvoiceStatus) =>
  createSelector([selectFilteredInvoices], (invoices) =>
    invoices.filter((invoice) => invoice.status === status)
  );

export const selectInvoicesByType = (invoiceType: InvoiceType) =>
  createSelector([selectFilteredInvoices], (invoices) =>
    invoices.filter((invoice) => invoice.invoiceType === invoiceType)
  );

export const selectRecentInvoices = createSelector([selectFilteredInvoices], (invoices) =>
  invoices.slice(0, 5)
);

export const selectInvoiceStats = createSelector([selectFilteredInvoices], (invoices) => {
  const total = invoices.length;
  const completed = invoices.filter((inv) => inv.status === InvoiceStatus.Completada).length;
  const pending = invoices.filter((inv) => inv.status === InvoiceStatus.Nueva).length;
  const cancelled = invoices.filter((inv) => inv.status === InvoiceStatus.Anulada).length;
  const month = new Date().getMonth();
  const year = new Date().getFullYear();

  const monthTotal = invoices
    .filter((inv) => {
      const date = new Date(inv.date);
      return date.getMonth() === month && date.getFullYear() === year;
    })
    .reduce((sum, inv) => sum + saleAmountOf(inv), 0);

  return {
    total,
    completed,
    pending,
    cancelled,
    monthTotal,
  };
});

export const selectInvoiceTypeFilter = (s: RootState): string =>
  s.invoices.filters?.invoiceType?.[0] != null ? String(s.invoices.filters.invoiceType[0]) : '';

export const selectInvoiceStatusFilter = (s: RootState): string =>
  s.invoices.filters?.status?.[0] != null ? String(s.invoices.filters.status[0]) : '';

export const selectPendingSyncInvoices = createSelector(
  [selectInvoiceState],
  (state) => state.pendingSync
);

export const selectInvoicesLastSyncDate = createSelector(
  [selectInvoiceState],
  (state) => state.lastSyncDate
);

// ✅ OPTIMIZED: Company-specific invoices selector
export const selectInvoicesByCompanyId = (companyId: string) =>
  createSelector([selectAllInvoices], (invoices) =>
    invoices.filter((invoice) => invoice.companyId === companyId)
  );

// ✅ PERFORMANCE: Company revenue stats
export const selectCompanyRevenueStats = createSelector(
  [selectCurrentCompanyInvoices],
  (invoices) => {
    const completedInvoices = invoices.filter(inv => inv.status === InvoiceStatus.Completada);
    const totalRevenue = completedInvoices.reduce((sum, inv) => sum + saleAmountOf(inv), 0);
    const monthlyRevenue = new Map<string, number>();
    
    completedInvoices.forEach(inv => {
      const month = inv.date.substring(0, 7); // YYYY-MM
      monthlyRevenue.set(month, (monthlyRevenue.get(month) || 0) + saleAmountOf(inv));
    });

    return {
      totalInvoices: invoices.length,
      completedInvoices: completedInvoices.length,
      totalRevenue,
      averageInvoiceAmount: completedInvoices.length > 0 ? totalRevenue / completedInvoices.length : 0,
      monthlyRevenue: Array.from(monthlyRevenue.entries()).map(([month, revenue]) => ({ month, revenue })),
    };
  }
);
