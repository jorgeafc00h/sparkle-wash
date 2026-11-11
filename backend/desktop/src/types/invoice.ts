// Invoice types matching Swift implementation

export enum InvoiceStatus {
  Nueva = 0,
  Sincronizando = 1,
  Completada = 2,
  Anulada = 3,
  Modificada = 4,
  ErrorEnvio = 5,
  Contingencia = 6,
}

export enum InvoiceType {
  Factura = 0,
  CCF = 1,
  NotaCredito = 2,
  SujetoExcluido = 3,
  NotaDebito = 4,
  NotaRemision = 5,
  ComprobanteLiquidacion = 6,
  FacturaExportacion = 7,
  ComprobanteRetencion = 8,
  DocumentoContableLiquidacion = 9,
  ComprobanteDonacion = 10,
  EventoOperacionesEspeciales = 17,
  EventoRetorno = 18
}

import { Customer } from './customer';
import type { TaxCategory } from './product';

export type PaymentCondition = 1 | 2 | 3;

export interface Invoice {
  id: string;
  invoiceNumber: string;
  date: string;
  dueDate?: string;
  paymentCondition?: PaymentCondition;
  paymentTermCode?: string | null;
  paymentTermPeriod?: number | null;
  openInAccounts?: boolean;
  status: InvoiceStatus;
  customerId?: string;
  invoiceType: InvoiceType;
  documentType: string;
  fechaGeneracion?: string;
  fechaTransmision?: string;
  generationCode?: string;
  controlNumber?: string;
  receptionSeal?: string;
  relatedDocumentNumber?: string;
  relatedDocumentType?: string;
  relatedInvoiceType?: InvoiceType;
  relatedControlNumber?: string;
  relatedGenerationCode?: string;
  relatedReceptionSeal?: string;
  relatedId?: string;
  relatedDocumentDate?: string;
  specialOperationDocFrom?: string;
  specialOperationDocTo?: string;
  invalidatedViaApi?: boolean;
  invalidatedAt?: string;
  invalidationReason?: string;
  isHelperForCreditNote?: boolean;
  /** POS consolidation: sale(s) the accountant wants out of Libros IVA (design §6.5). */
  excludeFromLibrosIVA?: boolean;
  /** POS consolidation: tickets aggregated into this invoice (audit link). */
  sourceTicketIds?: string[];
  /**
   * Sujeto Excluido only: withhold the 10% income tax (resumen.reteRenta).
   * Absent = true (every FSE withheld before the option existed); false for
   * purchases of goods. Decided at creation/edit — totals, DTE, PDF and
   * exports all read it.
   */
  applyRentaRetention?: boolean;
  /**
   * IVA percepción 1% decision taken at creation/edit: the company was an
   * agente de percepción, the receptor not a gran contribuyente and (NC/ND)
   * the referenced CCF carried percepción. computeTotals applies the document
   * rules (CCF ≥ US$100 gravado base). Absent → derived from totals.ivaPerci1.
   */
  applyIvaPerception?: boolean;
  // Delivery info for remission notes
  nombEntrega?: string;
  docuEntrega?: string;
  observaciones?: string;
  receptor?: string;
  receptorDocu?: string;
  shouldSyncToCloud?: boolean;
  /** ISO-8601 timestamp set when the user manually marks the invoice as contingency. */
  contingencyMarkedAt?: string;
  /**
   * Set when the invoice is reported in an Evento de Contingencia: its DTE is then
   * transmitted with Modelo 2 / Transmisión 2 / this tipoContingencia (CAT-005) —
   * see DTEMappingService.transmissionMode.
   */
  contingency?: InvoiceContingency;
  companyId: string;
  items: InvoiceDetail[];
  createdAt: string;
  updatedAt: string;
  totals?: InvoiceCalculations;
  // Calculated totals
  subtotal?: number;
  tax?: number;
  total?: number;
  totalAmount?: number;
  totalAmountIncludingTax?: number;
  customer?: Customer;
}

export interface InvoiceDetail {
  id: string;
  quantity: number;
  productId: string;
  productName: string;
  obsItem: string;
  exportaciones?: number;
  unitPrice: number;
  /** Line-level discount (same IVA treatment as unitPrice), 0 ≤ discount ≤ quantity × unitPrice. */
  discount?: number;
  /**
   * Product tax category snapshot (Product.taxCategory) — decides the DTE sale
   * bucket: GRAVADO (default / legacy lines) → ventaGravada, EXENTO →
   * ventaExenta, NO_GRAVADO → ventaNoSuj. Exento / no sujeto prices carry no IVA.
   */
  taxCategory?: TaxCategory;
  createdAt: string;
  updatedAt: string;
  invoiceId?: string;
}

export interface InvoiceDetailInput {
  quantity: number;
  productId: string;
  productName?: string;
  unitPrice?: number;
  obsItem?: string;
  exportaciones?: number;
  discount?: number;
  /** Product tax category (defaults to GRAVADO) — see InvoiceDetail.taxCategory. */
  taxCategory?: TaxCategory;
}

export interface CreateInvoiceInput {
  invoiceNumber: string;
  date: string;
  dueDate?: string;
  paymentCondition?: PaymentCondition;
  paymentTermCode?: string | null;
  paymentTermPeriod?: number | null;
  openInAccounts?: boolean;
  customerId?: string;
  invoiceType: InvoiceType;
  companyId: string;
  items: InvoiceDetailInput[];
  documentType?: string;
  // Related document info (for credit notes, debit notes, etc.)
  relatedDocumentNumber?: string;
  relatedDocumentType?: string;
  relatedInvoiceType?: InvoiceType;
  relatedControlNumber?: string;
  relatedGenerationCode?: string;
  relatedReceptionSeal?: string;
  relatedId?: string;
  relatedDocumentDate?: string;
  specialOperationDocFrom?: string;
  specialOperationDocTo?: string;
  // Delivery info for remission notes
  nombEntrega?: string;
  docuEntrega?: string;
  observaciones?: string;
  receptor?: string;
  receptorDocu?: string;
  customerHasRetention?: boolean;
  customer?: Customer;
  /** POS consolidation: keep this DTE out of the Libros IVA export (design §6.5). */
  excludeFromLibrosIVA?: boolean;
  /** POS consolidation: tickets aggregated into this invoice (audit link). */
  sourceTicketIds?: string[];
  /** FSE: withhold 10% renta (default true) — see Invoice.applyRentaRetention. */
  applyRentaRetention?: boolean;
  /** IVA percepción 1% decision (company agent, receptor not large) — see Invoice.applyIvaPerception. */
  applyIvaPerception?: boolean;
}

export interface UpdateInvoiceInput extends Partial<CreateInvoiceInput> {
  id: string;
  status?: InvoiceStatus;
  generationCode?: string;
  controlNumber?: string;
  receptionSeal?: string;
  fechaGeneracion?: string;
  fechaTransmision?: string;
  totals?: InvoiceCalculations;
  invalidatedViaApi?: boolean;
  invalidatedAt?: string;
  invalidationReason?: string;
  /** Populated when a user manually marks the invoice as issued under contingency. */
  contingencyMarkedAt?: string;
  contingency?: InvoiceContingency;
}

// Computed properties helpers
export interface InvoiceCalculations {
  totalAmount: number;
  tax: number;
  subTotal: number;
  reteRenta: number;
  totalPagar: number;
  ivaRete1: number;
  totalWithoutTax: number;
  isCCF: boolean;
  totalItems: number;
  version: number;
  /** Σ of line discounts (gross, same IVA treatment as unitPrice). */
  totalDiscount?: number;
  /** Σ ventaGravada as the DTE reports it (IVA-incl. on Factura, IVA-excl. on CCF/NC/ND/NR). */
  totalGravada?: number;
  /** Σ ventaExenta (no IVA). */
  totalExenta?: number;
  /** Σ ventaNoSuj (no IVA). */
  totalNoSuj?: number;
  /**
   * IVA percepción 1% (resumen.ivaPerci on CCF / NC / ND), added to totalPagar.
   * Optional: invoices stored before the option have none (= 0).
   */
  ivaPerci1?: number;
}

// Invoice summary for lists
export interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  date: string;
  status: InvoiceStatus;
  invoiceType: InvoiceType;
  totalAmount: number;
  customerName?: string;
  companyId: string;
}

// Invoice search and filter types
export interface InvoiceFilters {
  status?: InvoiceStatus[];
  invoiceType?: InvoiceType[];
  dateFrom?: string;
  dateTo?: string;
  customerId?: string;
  companyId?: string;
}

export interface InvoiceSearchParams extends InvoiceFilters {
  searchTerm?: string;
  page?: number;
  limit?: number;
  sortBy?: 'date' | 'invoiceNumber' | 'totalAmount';
  sortOrder?: 'asc' | 'desc';
}

// Invoice state for Redux
export interface InvoiceState {
  invoices: Invoice[];
  currentInvoice: Invoice | null;
  selectedInvoiceId: string | null;
  loading: boolean;
  error: string | null;
  searchTerm: string;
  filters: InvoiceFilters;
  pendingSync: string[]; // Invoice IDs pending cloud sync
  lastSyncDate?: string;
}

/** Contingency data a DTE carries in identificacion (CAT-005 Tipo de Contingencia). */
export interface InvoiceContingency {
  tipoContingencia: number;
  /** Required by MH only when tipoContingencia is 5 ("Otro"). */
  motivoContin?: string | null;
  /** When the Evento de Contingencia listing this document was accepted. */
  reportedAt?: string;
}
