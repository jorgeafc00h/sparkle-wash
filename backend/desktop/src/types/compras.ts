// Compras (purchases received) types

export enum CompraSource {
  Email = 'email',
  OCR = 'ocr',
  Manual = 'manual',
}

export type CompraPaymentCondition = 1 | 2 | 3;

export interface CompraItem {
  id: string;
  compraId: string;
  numItem: number;
  descripcion: string;
  cantidad: number;
  precioUni: number;
  ventaGravada: number;
  ivaItem?: number;
}

export interface Compra {
  id: string;
  companyId: string;
  // Emisor info (the seller who issued this invoice to us)
  emisorNit: string;
  emisorNrc?: string;
  emisorNombre: string;
  emisorNombreComercial?: string;
  // DTE info
  tipoDte: string;
  codigoGeneracion: string;
  numeroControl: string;
  selloRecibido?: string;
  relatedDocumentType?: string;
  relatedDocumentNumber?: string;
  relatedControlNumber?: string;
  relatedGenerationCode?: string;
  fecha: string; // YYYY-MM-DD
  dueDate?: string;
  paymentCondition?: CompraPaymentCondition;
  paymentTermCode?: string | null;
  paymentTermPeriod?: number | null;
  openInAccounts?: boolean;
  // Totals
  totalGravada: number;
  totalIva: number;
  totalPagar: number;
  // Additional DTE tax-breakdown fields (resumen) — MH Libro de Compras (F-07
  // anexo) columns. Optional/nullable: old records synced before this field
  // set was added won't have them until re-synced or backfilled.
  totalNoSuj?: number;         // resumen.totalNoSuj — non-subject amount
  totalExenta?: number;        // resumen.totalExenta — exempt amount
  subTotal?: number;           // resumen.subTotal — subtotal before retentions
  ivaRete1?: number;           // resumen.ivaRete1 — IVA retention (1%) withheld
  reteRenta?: number;          // resumen.reteRenta — income-tax retention withheld
  montoTotalOperacion?: number; // resumen.montoTotalOperacion ?? resumen.totalPagar
  tipoMoneda?: string;         // resumen.tipoMoneda, defaults "USD"
  horaEmision?: string;        // identificacion.horEmi — time of issue
  receptorNit?: string;        // receptor.nit ?? receptor.numDocumento
  receptorNombre?: string;     // receptor.nombre
  receptorNrc?: string;        // receptor.nrc
  // Metadata
  source: CompraSource;
  gmailMessageId?: string;
  originalJson?: string;
  ocrImageUri?: string;
  pdfPath?: string;
  // Items
  items: CompraItem[];
  // Government verification — `verified` reflects ONLY whether MH confirmed
  // the document (estadoDoc "Transmitido Satisfactoriamente" / "Procesado").
  // Amount diffs are captured separately and shown in the detail screen.
  verified?: boolean;                 // null = not checked, true = MH confirmed, false = rejected/not found/invalidated/error
  verifiedAt?: string;                // ISO timestamp of last verification
  verifiedEstado?: string;            // Raw estadoDoc from MH
  verifiedDescripcion?: string;       // Long text explaining estadoDoc (shown in detail card)
  verifiedSello?: string;             // Government selloRecibido
  mhTotalPagar?: number;              // `resumen.totalPagar` from MH response (for diff display)
  mhMontoTotalOperacion?: number;     // `resumen.montoTotalOperacion` from MH response (for diff display)
  invalidatedAt?: string;             // When the DTE was invalidated by emisor (if applicable)
  invalidationReason?: string;        // Why the emisor invalidated
  // Linking — compra → sales invoice / customer (local-only, never synced).
  // Link to invoice auto-fills linkedCustomerId from the invoice's customer.
  // Link to customer clears linkedInvoiceId (single-link rule).
  linkedInvoiceId?: string | null;
  linkedCustomerId?: string | null;
  linkNote?: string | null;
  // Uso interno — purchase that is NOT a valid national DTE (bought abroad,
  // commercial ticket/receipt…) recorded only for internal control. Never
  // exported to MH annexes/CSV, never verified against Consulta Pública.
  // Optional: legacy records and peers without the field read as false. The
  // sync merge treats the compra payload generically, so the flags travel as-is.
  internalUse?: boolean;
  internalReason?: string;       // free text: why it is internal (e.g. "Compra en el extranjero")
  documentReference?: string;    // free text: ticket / receipt / invoice reference
  // Timestamps
  createdAt: string;
  updatedAt: string;
}

/** True for "uso interno" purchases (excluded from MH exports and verification). */
export function isInternalUseCompra(compra: Pick<Compra, 'internalUse'>): boolean {
  return compra.internalUse === true;
}

/** Drop internal-use purchases — apply before anything that goes to Hacienda. */
export function excludeInternalUse<T extends Pick<Compra, 'internalUse'>>(compras: T[]): T[] {
  return compras.filter((c) => !isInternalUseCompra(c));
}

export interface CompanyGmailAccount {
  companyId: string;
  email: string;
  accessToken?: string;
  refreshToken?: string;
  /** Google account id (`sub`) — keys the refresh token kept by the main process. */
  googleAccountId?: string;
  /** Epoch ms when `accessToken` expires (absent on links made before refresh support). */
  tokenExpiresAt?: number;
  lastHistoryId?: string;
  linkedAt: string;
}

export interface GmailSyncState {
  companyId: string;
  email: string;
  lastSyncAt?: string;
  lastHistoryId?: string;
  syncFrequencyHours: number; // 0 (manual only), 1, 6, or 12 — production companies only
  status: 'idle' | 'syncing' | 'error';
  errorMessage?: string;
  totalImported: number;
}

// Filters for querying compras
export interface ComprasFilters {
  companyId: string;
  searchTerm?: string;
  dateFrom?: string;
  dateTo?: string;
  tipoDte?: string;
  source?: CompraSource;
}

// Monthly summary for dashboard
export interface ComprasMonthlyTotal {
  year: number;
  month: number;
  totalGravada: number;
  totalIva: number;
  totalPagar: number;
  count: number;
}

// Summary by emisor
export interface ComprasByEmisor {
  emisorNit: string;
  emisorNombre: string;
  totalPagar: number;
  count: number;
}
