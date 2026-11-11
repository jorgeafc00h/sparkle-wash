// Invoice slice aligned with SwiftUI functionality

import { PayloadAction, createSlice, nanoid } from '@reduxjs/toolkit';
import {
  InvoiceState,
  Invoice,
  InvoiceDetail,
  InvoiceFilters,
  InvoiceStatus,
  InvoiceType,
  CreateInvoiceInput,
  UpdateInvoiceInput,
} from '../../types';
import { TaxCategory } from '../../types/product';
import { computeTotals, documentWithholdings } from '../../utils/invoiceTotals';

// Re-exported for existing importers; the implementation lives in utils/invoiceTotals.
export { computeTotals, IVA_RETENTION_THRESHOLD } from '../../utils/invoiceTotals';



const round = (value: number, decimals = 2) => {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
};

const normalizeInvoiceDetails = (
  invoiceId: string,
  items: InvoiceDetail[] | CreateInvoiceInput['items']
): InvoiceDetail[] => {
  return items.map((item, index) => {
    const detailId = 'id' in item ? item.id : `${invoiceId}_detail_${index + 1}`;
    const productName = 'productName' in item && item.productName ? item.productName : 'Producto';
    const unitPrice = 'unitPrice' in item && item.unitPrice !== undefined ? item.unitPrice : 0;
    const quantity = item.quantity ?? 0;
    const discount = 'discount' in item ? item.discount : undefined;
    // Tax category snapshot (POS consolidation and the line editor pass the
    // product's); legacy lines without one are gravado.
    const taxCategory = item.taxCategory ?? TaxCategory.GRAVADO;

    return {
      id: detailId,
      invoiceId,
      productId: item.productId,
      productName,
      quantity,
      unitPrice,
      discount: discount && discount > 0 ? round(discount) : undefined,
      taxCategory,
      obsItem: item.obsItem ?? '',
      exportaciones: item.exportaciones,
      createdAt: 'createdAt' in item && item.createdAt ? item.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });
};

const stamp = () => new Date().toISOString();

// Convert invoice type to document type (matches Swift Extensions.documentTypeFromInvoiceType + TipoDocumento enum)
const getDocumentTypeFromInvoiceType = (type: InvoiceType): string => {
  switch (type) {
    case InvoiceType.Factura: return '01';
    case InvoiceType.CCF: return '03';  
    case InvoiceType.NotaCredito: return '05';
    case InvoiceType.NotaDebito: return '06';
    case InvoiceType.NotaRemision: return '04';
    case InvoiceType.ComprobanteRetencion: return '07';
    case InvoiceType.ComprobanteLiquidacion: return '08';
    case InvoiceType.DocumentoContableLiquidacion: return '09';
    case InvoiceType.FacturaExportacion: return '11';
    case InvoiceType.SujetoExcluido: return '14';
    case InvoiceType.ComprobanteDonacion: return '15';
    case InvoiceType.EventoOperacionesEspeciales: return '17';
    case InvoiceType.EventoRetorno: return '18';
    default: return '01';
  }
};

const buildInvoice = (input: CreateInvoiceInput): Invoice => {
  const invoiceId = `inv_${nanoid(8)}`;
  const createdAt = stamp();
  const items = normalizeInvoiceDetails(invoiceId, input.items);
  // Withholding decisions are taken HERE, from the editor's inputs, and stored
  // on the invoice (applyRentaRetention / applyIvaPerception + totals) so the
  // DTE, PDF and exports never re-read the company / customer flags later.
  const totals = computeTotals(items, input.invoiceType, input.customerHasRetention, {
    applyRentaRetention: input.applyRentaRetention,
    applyIvaPerception: input.applyIvaPerception,
  });

  return {
    id: invoiceId,
    invoiceNumber: input.invoiceNumber,
    date: input.date,
    dueDate: input.dueDate,
    paymentCondition: input.paymentCondition ?? 1,
    paymentTermCode: input.paymentTermCode ?? null,
    paymentTermPeriod: input.paymentTermPeriod ?? null,
    openInAccounts: input.openInAccounts ?? false,
    status: InvoiceStatus.Nueva,
    customerId: input.customerId,
    customer: input.customer,
    invoiceType: input.invoiceType,
    documentType: input.documentType ?? getDocumentTypeFromInvoiceType(input.invoiceType),
    generationCode: undefined,
    controlNumber: undefined,
    receptionSeal: undefined,
    relatedDocumentNumber: input.relatedDocumentNumber,
    relatedDocumentType: input.relatedDocumentType,
    relatedInvoiceType: input.relatedInvoiceType,
    relatedControlNumber: input.relatedControlNumber,
    relatedGenerationCode: input.relatedGenerationCode,
    relatedReceptionSeal: input.relatedReceptionSeal,
    relatedId: input.relatedId,
    relatedDocumentDate: input.relatedDocumentDate,
    specialOperationDocFrom: input.specialOperationDocFrom,
    specialOperationDocTo: input.specialOperationDocTo,
    invalidatedViaApi: false,
    isHelperForCreditNote: false,
    nombEntrega: input.nombEntrega ?? '',
    docuEntrega: input.docuEntrega ?? '',
    observaciones: input.observaciones ?? '',
    receptor: input.receptor ?? '',
    receptorDocu: input.receptorDocu ?? '',
    excludeFromLibrosIVA: input.excludeFromLibrosIVA || undefined,
    sourceTicketIds: input.sourceTicketIds,
    applyRentaRetention: input.applyRentaRetention,
    applyIvaPerception: input.applyIvaPerception,
    shouldSyncToCloud: true,
    companyId: input.companyId,
    items,
    totals,
    totalAmountIncludingTax: totals.totalPagar, // Added missing property
    createdAt,
    updatedAt: createdAt,
  };
};

const initialState: InvoiceState = {
  invoices: [], // Start with empty invoices array
  currentInvoice: null,
  selectedInvoiceId: null,
  loading: false,
  error: null,
  searchTerm: '',
  filters: {
    companyId: '',
  },
  pendingSync: [],
  lastSyncDate: stamp(),
};

const invoiceSlice = createSlice({
  name: 'invoices',
  initialState,
  reducers: {
    clearError(state) {
      state.error = null;
    },
    setSearchTerm(state, action: PayloadAction<string>) {
      state.searchTerm = action.payload;
    },
    setInvoiceFilters(state, action: PayloadAction<InvoiceFilters>) {
      state.filters = {
        ...state.filters,
        ...action.payload,
      };
    },
    addInvoice: {
      reducer(state, action: PayloadAction<Invoice>) {
        state.invoices.unshift(action.payload);
        state.currentInvoice = action.payload;
        state.selectedInvoiceId = action.payload.id;
        state.lastSyncDate = stamp();
      },
      prepare(input: CreateInvoiceInput) {
        return { payload: buildInvoice(input) };
      },
    },
    /**
     * Bulk-insert pre-built invoices in a single dispatch. Used by
     * `useRequestProductionAccess` when the batch generator produces 5×11
     * test invoices — a per-invoice `addInvoice` dispatch loop forced
     * redux-persist to serialize the whole store to disk on every entry,
     * stalling the production-access UI flow at ~9-10 dispatches/sec.
     */
    addInvoices(state, action: PayloadAction<Invoice[]>) {
      if (action.payload.length === 0) return;
      state.invoices.unshift(...action.payload);
      const last = action.payload[action.payload.length - 1];
      state.currentInvoice = last;
      state.selectedInvoiceId = last.id;
      state.lastSyncDate = stamp();
    },
    updateInvoice(state, action: PayloadAction<UpdateInvoiceInput>) {
      const { id, ...updates } = action.payload;
      const index = state.invoices.findIndex(inv => inv.id === id);
      if (index === -1) {
        state.error = 'Factura no encontrada';
        return;
      }

      const current = state.invoices[index];
      const updatedItems = updates.items
        ? normalizeInvoiceDetails(id, updates.items)
        : current.items;
      // Status/bookkeeping updates (Completada, ErrorEnvio, contingency,
      // invalidation, homologation) never pass customerHasRetention — recomputing
      // with `undefined` zeroed ivaRete1, so the retried DTE and the stored total
      // lost the 1% retention. Keep the invoice's own retention unless the caller
      // or a new customer says otherwise.
      const hasRetention =
        updates.customerHasRetention ??
        (updates.customer !== undefined
          ? Boolean(updates.customer?.hasContributorRetention)
          : current.customer?.hasContributorRetention ?? (current.totals?.ivaRete1 ?? 0) > 0);
      // FSE renta and IVA percepción: the editor passes a fresh decision; any
      // other update keeps the invoice's stored one — its flag, else what its
      // stored totals show (a status update must not drop the percepción or
      // re-add a renta that was turned off, incl. on invoices synced without
      // the flags).
      const stored = documentWithholdings(current).options;
      const totals = computeTotals(
        updatedItems,
        updates.invoiceType ?? current.invoiceType,
        hasRetention,
        {
          applyRentaRetention:
            updates.applyRentaRetention ?? current.applyRentaRetention ?? stored.applyRentaRetention,
          applyIvaPerception:
            updates.applyIvaPerception ?? current.applyIvaPerception ?? stored.applyIvaPerception,
        },
      );

      const updated: Invoice = {
        ...current,
        ...updates,
        items: updatedItems,
        totals,
        totalAmountIncludingTax: totals.totalPagar,
        totalAmount: totals.totalAmount,
        total: totals.totalPagar,
        invoiceNumber: updates.invoiceNumber ?? current.invoiceNumber,
        status: updates.status ?? current.status,
        updatedAt: stamp(),
      };

      state.invoices[index] = updated;

      if (state.currentInvoice?.id === id) {
        state.currentInvoice = updated;
      }

      state.lastSyncDate = updated.updatedAt;
    },
    setInvoiceStatus(state, action: PayloadAction<{ id: string; status: InvoiceStatus }>) {
      const { id, status } = action.payload;
      const invoice = state.invoices.find(inv => inv.id === id);
      if (!invoice) {
        state.error = 'Factura no encontrada';
        return;
      }
      invoice.status = status;
      invoice.updatedAt = stamp();

      if (invoice.totals) {
        invoice.totals = {
          ...invoice.totals,
          totalAmount: invoice.totals.totalAmount,
        };
      }

      if (state.currentInvoice?.id === id) {
        state.currentInvoice = { ...invoice };
      }
    },
    deleteInvoice(state, action: PayloadAction<string>) {
      const id = action.payload;
      state.invoices = state.invoices.filter(inv => inv.id !== id);

      if (state.currentInvoice?.id === id) {
        state.currentInvoice = null;
      }

      if (state.selectedInvoiceId === id) {
        state.selectedInvoiceId = state.invoices.length ? state.invoices[0].id : null;
      }

      state.lastSyncDate = stamp();
    },
    deleteInvoicesByCompany(state, action: PayloadAction<string>) {
      const companyId = action.payload;
      state.invoices = state.invoices.filter(inv => inv.companyId !== companyId);

      if (state.currentInvoice?.companyId === companyId) {
        state.currentInvoice = null;
      }

      if (
        state.selectedInvoiceId &&
        !state.invoices.some(inv => inv.id === state.selectedInvoiceId)
      ) {
        state.selectedInvoiceId = state.invoices.length ? state.invoices[0].id : null;
      }

      state.pendingSync = state.pendingSync.filter(id =>
        state.invoices.some(inv => inv.id === id)
      );
      state.lastSyncDate = stamp();
    },
    setCurrentInvoice(state, action: PayloadAction<string | null>) {
      state.selectedInvoiceId = action.payload;
      state.currentInvoice = action.payload
        ? state.invoices.find(inv => inv.id === action.payload) || null
        : null;
    },
    enqueuePendingSync(state, action: PayloadAction<string>) {
      if (!state.pendingSync.includes(action.payload)) {
        state.pendingSync.push(action.payload);
      }
    },
    dequeuePendingSync(state, action: PayloadAction<string>) {
      state.pendingSync = state.pendingSync.filter(id => id !== action.payload);
    },
    /**
     * Locally marks an invoice as issued under contingency (InvoiceStatus.Contingencia = 6).
     * Does NOT call MH — ContingencyReportService remains the only MH-speaking path.
     * The invoice stays in the local store with `contingencyMarkedAt` set; the user
     * then completes the formal report via ContingencyPage.
     */
    markAsContingency(state, action: PayloadAction<string>) {
      const id = action.payload;
      const invoice = state.invoices.find(inv => inv.id === id);
      if (!invoice) {
        state.error = 'Factura no encontrada';
        return;
      }
      invoice.status = InvoiceStatus.Contingencia;
      invoice.contingencyMarkedAt = new Date().toISOString();
      invoice.updatedAt = new Date().toISOString();
      if (state.currentInvoice?.id === id) {
        state.currentInvoice = { ...invoice };
      }
    },
    // Device Sync v2 relay writes: the merge engine already decided the final entity, so
    // it lands verbatim — no re-stamping (the remote updatedAt IS the version), no v1
    // pendingSync enqueue, and these action types are never captured into the outbox.
    syncUpsertInvoice(state, action: PayloadAction<Invoice>) {
      const incoming = action.payload;
      const index = state.invoices.findIndex(inv => inv.id === incoming.id);
      if (index === -1) {
        state.invoices.unshift(incoming);
      } else {
        state.invoices[index] = incoming;
      }
      if (state.currentInvoice?.id === incoming.id) {
        state.currentInvoice = incoming;
      }
    },
    syncRemoveInvoice(state, action: PayloadAction<string>) {
      const id = action.payload;
      state.invoices = state.invoices.filter(inv => inv.id !== id);
      state.pendingSync = state.pendingSync.filter(pendingId => pendingId !== id);
      if (state.currentInvoice?.id === id) {
        state.currentInvoice = null;
      }
      if (state.selectedInvoiceId === id) {
        state.selectedInvoiceId = state.invoices.length ? state.invoices[0].id : null;
      }
    },
    hydrateInvoices(state, action: PayloadAction<Invoice[]>) {
      state.invoices = action.payload.map(inv => ({
        ...inv,
        totals: inv.totals ?? computeTotals(inv.items, inv.invoiceType, undefined, {
          applyRentaRetention: inv.applyRentaRetention,
          applyIvaPerception: inv.applyIvaPerception,
        }),
      }));
      state.currentInvoice = state.invoices.find(inv => inv.id === state.selectedInvoiceId) || null;
      state.loading = false;
      state.error = null;
      state.lastSyncDate = stamp();
    },
    resetInvoices() {
      return initialState;
    },
  },
});

export const {
  clearError,
  setSearchTerm,
  setInvoiceFilters,
  addInvoice,
  addInvoices,
  updateInvoice,
  setInvoiceStatus,
  deleteInvoice,
  deleteInvoicesByCompany,
  setCurrentInvoice,
  enqueuePendingSync,
  dequeuePendingSync,
  hydrateInvoices,
  syncUpsertInvoice,
  syncRemoveInvoice,
  resetInvoices,
  markAsContingency,
} = invoiceSlice.actions;

export default invoiceSlice.reducer;
