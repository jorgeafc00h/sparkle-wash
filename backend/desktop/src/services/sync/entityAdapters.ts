// Device Sync v2 entity adapters: what each entity looks like on the wire and how a
// merged remote entity lands locally. Company-relative on purpose — every device minted
// its own local company id for the same NIT, so the wire never carries `companyId`
// semantics: incoming entities are re-parented to the local company of `{co}`.

import { InvoiceType, type Company, type Customer, type Invoice, type Product } from '@/types';
import type { Compra } from '@/types/compras';
import type { Ticket } from '@/types/ticket';
import type { SyncEntityType } from './protocol';
import type { SyncEntity } from './mergeEngine';
import { purchaseDedupeKey } from './mergeEngine';
import { ComprasDatabase } from '../compras/ComprasDatabase';
import { TicketDatabase } from '../tickets/TicketDatabase';
import { syncUpsertInvoice, syncRemoveInvoice } from '../../store/slices/invoiceSlice';
import { syncUpsertCustomer, syncRemoveCustomer } from '../../store/slices/customerSlice';
import { syncUpsertProduct, syncRemoveProduct } from '../../store/slices/productSlice';
import { syncMergeCompany } from '../../store/slices/companySlice';

/**
 * Company fields that never leave the device: signing material + MH credentials live in
 * SecureStorage per device, the logo can exceed the 16 KB envelope cap, and default /
 * certificate flags describe THIS install's state.
 */
export const COMPANY_DEVICE_LOCAL_FIELDS = [
  'id',
  'isDefault',
  'userId',
  'certificatePath',
  'certificatePassword',
  'credentials',
  'invoiceLogo',
  'logoUrl',
  'logoWidth',
  'logoHeight',
  'hasValidCertificate',
  'certificateExpiryDate',
  'certificateSubject',
  'certificateIssuer',
  'hasApiCredentials',
  'credentialsLastTestedAt',
  'hasCertificateFile',
  'currentInvoiceNumber',
  'currentCCFNumber',
  // Desktop's sequential numeroControl counter: coordinated through the relay's
  // correlativo maxima instead — a peer's LWW company edit must never rewind it.
  'nextSequenceNumber',
] as const;

/** Compra fields that are device paths (attachments stay on the importing device). */
export const PURCHASE_DEVICE_LOCAL_FIELDS = ['pdfPath', 'ocrImageUri'] as const;

/** Minimal state shape the adapters read — a structural subset of RootState. */
export interface SyncReadableState {
  companies: { companies: Company[]; currentCompany?: Company | null; selectedCompanyId?: string | null };
  invoices: { invoices: Invoice[] };
  customers: { customers: Customer[] };
  products: { products: Product[] };
}

export type SyncDispatch = (action: { type: string; payload?: unknown }) => unknown;

export interface AdapterContext {
  co: string;
  /** Local id of the company that `co` maps to on THIS device. */
  companyId: string;
  getState: () => SyncReadableState;
  dispatch: SyncDispatch;
}

const omit = <T extends Record<string, unknown>>(source: T, fields: readonly string[]): Record<string, unknown> => {
  const copy: Record<string, unknown> = { ...source };
  for (const field of fields) delete copy[field];
  return copy;
};

/** Wire payload for an entity (device-local fields stripped, updatedAt = version). */
export const serializeForWire = (type: SyncEntityType, entity: SyncEntity, u: string): Record<string, unknown> => {
  switch (type) {
    case 'company':
      return { ...omit(entity, COMPANY_DEVICE_LOCAL_FIELDS), updatedAt: u };
    case 'purchase':
      return { ...omit(entity, PURCHASE_DEVICE_LOCAL_FIELDS), updatedAt: u };
    default:
      return { ...entity, updatedAt: u };
  }
};

/**
 * ★ Cross-platform rule: the numeric InvoiceType enum is PLATFORM-LOCAL (RN event types
 * are 11/12, Desktop's 17/18); the MH document-type code is the canonical identity on
 * the wire, so incoming invoices re-derive their local enum from `documentType`.
 */
export const DOCUMENT_TYPE_TO_INVOICE_TYPE: Readonly<Record<string, InvoiceType>> = {
  '01': InvoiceType.Factura,
  '03': InvoiceType.CCF,
  '04': InvoiceType.NotaRemision,
  '05': InvoiceType.NotaCredito,
  '06': InvoiceType.NotaDebito,
  '07': InvoiceType.ComprobanteRetencion,
  '08': InvoiceType.ComprobanteLiquidacion,
  '09': InvoiceType.DocumentoContableLiquidacion,
  '11': InvoiceType.FacturaExportacion,
  '14': InvoiceType.SujetoExcluido,
  '15': InvoiceType.ComprobanteDonacion,
  '17': InvoiceType.EventoOperacionesEspeciales,
  '18': InvoiceType.EventoRetorno,
};

/** Re-parents an incoming entity onto the local company of `co`. */
export const localizeIncoming = (type: SyncEntityType, entity: SyncEntity, companyId: string): SyncEntity => {
  if (type === 'company') {
    return { ...omit(entity, COMPANY_DEVICE_LOCAL_FIELDS), id: companyId } as SyncEntity;
  }
  const localized: SyncEntity = { ...entity, companyId };
  if (type === 'invoice') {
    const localType = DOCUMENT_TYPE_TO_INVOICE_TYPE[String(localized.documentType ?? '')];
    if (localType !== undefined) localized.invoiceType = localType;
    const relatedType = DOCUMENT_TYPE_TO_INVOICE_TYPE[String(localized.relatedDocumentType ?? '')];
    if (relatedType !== undefined) localized.relatedInvoiceType = relatedType;
    if (localized.customer && typeof localized.customer === 'object') {
      localized.customer = { ...(localized.customer as Record<string, unknown>), companyId };
    }
  }
  return localized;
};

const localCompany = (ctx: AdapterContext): Company | undefined =>
  ctx.getState().companies.companies.find(company => company.id === ctx.companyId);

/** All live local entities of a type for the company (purchases are read from ComprasDatabase). */
export const listLocalEntities = async (ctx: AdapterContext, type: SyncEntityType): Promise<SyncEntity[]> => {
  const state = ctx.getState();
  switch (type) {
    case 'company': {
      const company = localCompany(ctx);
      // The company travels under the stable `{co}` id, never the per-device local id.
      return company ? [{ ...(company as unknown as SyncEntity), id: ctx.co }] : [];
    }
    case 'invoice':
      return state.invoices.invoices.filter(inv => inv.companyId === ctx.companyId) as unknown as SyncEntity[];
    case 'customer':
      return state.customers.customers.filter(c => c.companyId === ctx.companyId) as unknown as SyncEntity[];
    case 'product':
      return state.products.products.filter(p => p.companyId === ctx.companyId) as unknown as SyncEntity[];
    case 'purchase':
      try {
        return (await ComprasDatabase.getCompras({ companyId: ctx.companyId })) as unknown as SyncEntity[];
      } catch {
        return []; // storage unavailable — purchases simply don't sync this round
      }
    case 'ticket':
      try {
        // Hot AND archived (monthly archive, POS Phase 2 §9): digests, counts and
        // snapshots must equal a peer's that never archived anything.
        return (await TicketDatabase.listAllForSync(ctx.companyId)) as unknown as SyncEntity[];
      } catch {
        return []; // storage unavailable — tickets simply don't sync this round
      }
  }
};

/** Full entity for pushing (purchases need their items, which list queries omit). */
export const loadLocalEntity = async (
  ctx: AdapterContext,
  type: SyncEntityType,
  id: string,
): Promise<SyncEntity | undefined> => {
  if (type === 'purchase') {
    try {
      const compra = await ComprasDatabase.getCompraById(id);
      return compra && compra.companyId === ctx.companyId ? (compra as unknown as SyncEntity) : undefined;
    } catch {
      return undefined;
    }
  }
  if (type === 'ticket') {
    try {
      const ticket = await TicketDatabase.getTicket(ctx.companyId, id);
      return ticket ? (ticket as unknown as SyncEntity) : undefined;
    } catch {
      return undefined;
    }
  }
  if (type === 'company') {
    return id === ctx.co ? (await listLocalEntities(ctx, 'company'))[0] : undefined;
  }
  return (await listLocalEntities(ctx, type)).find(entity => entity.id === id);
};

/**
 * The local record an incoming change targets. Purchases resolve id → codigoGeneracion →
 * numeroControl so an independently-imported copy of the same DTE is recognised.
 */
export const findLocalMatch = async (
  ctx: AdapterContext,
  type: SyncEntityType,
  id: string,
  remote?: SyncEntity,
  dedupeKey?: string,
): Promise<SyncEntity | undefined> => {
  if (type !== 'purchase') return loadLocalEntity(ctx, type, id);

  const byId = await loadLocalEntity(ctx, type, id);
  if (byId) return byId;
  const key = dedupeKey ?? purchaseDedupeKey(remote);
  if (!key) return undefined;
  const all = await listLocalEntities(ctx, 'purchase');
  const match = all.find(entity => purchaseDedupeKey(entity) === key);
  return match ? loadLocalEntity(ctx, 'purchase', match.id) : undefined;
};

/** Lands a merged entity through the relay reducers / relay DB path (never re-captured). */
export const applyUpsert = async (
  ctx: AdapterContext,
  type: SyncEntityType,
  entity: SyncEntity,
  existingLocalId?: string,
): Promise<void> => {
  const localized = localizeIncoming(type, entity, ctx.companyId);
  switch (type) {
    case 'invoice':
      ctx.dispatch(syncUpsertInvoice(localized as unknown as Invoice));
      return;
    case 'customer':
      ctx.dispatch(syncUpsertCustomer(localized as unknown as Customer));
      return;
    case 'product':
      ctx.dispatch(syncUpsertProduct(localized as unknown as Product));
      return;
    case 'company': {
      const { id: _ignored, ...changes } = localized;
      ctx.dispatch(syncMergeCompany({ id: ctx.companyId, changes: changes as Partial<Company> }));
      return;
    }
    case 'purchase':
      await ComprasDatabase.upsertFromSync(localized as unknown as Compra, existingLocalId);
      return;
    case 'ticket':
      await TicketDatabase.upsertFromSync(localized as unknown as Ticket, existingLocalId);
      return;
  }
};

export const applyDelete = async (ctx: AdapterContext, type: SyncEntityType, localId: string): Promise<void> => {
  switch (type) {
    case 'invoice':
      ctx.dispatch(syncRemoveInvoice(localId));
      return;
    case 'customer':
      ctx.dispatch(syncRemoveCustomer(localId));
      return;
    case 'product':
      ctx.dispatch(syncRemoveProduct(localId));
      return;
    case 'company':
      // Companies are never deleted by a peer: removing a company wipes its local
      // credentials/certificate and cannot be undone from another device.
      return;
    case 'purchase':
      await ComprasDatabase.deleteFromSync(localId);
      return;
    case 'ticket':
      await TicketDatabase.deleteFromSync(localId);
      return;
  }
};

/** Digest/diff key: purchases are identified by their DTE, everything else by id. */
export const digestKeyFor = (type: SyncEntityType, entity: SyncEntity): string =>
  type === 'purchase' ? purchaseDedupeKey(entity) ?? entity.id : entity.id;

/**
 * ★ Cross-platform rule: correlativo maxima only count SEQUENTIAL numbers. Desktop's
 * default numeroControl uses a time-derived 15-digit sequence (~1e14) that never
 * collides — letting it into the maxima would push every sequential device's next
 * number into the trillions. Anything ≥ 1e9 is time-derived and ignored.
 */
export const SEQUENTIAL_CORRELATIVO_LIMIT = 1_000_000_000;

/** Sequential correlativo of an invoice: its invoiceNumber, else numeroControl's 15-digit suffix. */
export const correlativoOf = (invoice: Pick<Invoice, 'invoiceNumber' | 'controlNumber'>): number | null => {
  const candidates = [
    /^\d+$/.test(invoice.invoiceNumber ?? '') ? Number(invoice.invoiceNumber) : NaN,
    Number(/-(\d{15})$/.exec(invoice.controlNumber ?? '')?.[1] ?? NaN),
    Number(/-(\d{15})$/.exec(invoice.invoiceNumber ?? '')?.[1] ?? NaN),
  ].filter(value => Number.isFinite(value) && value > 0 && value < SEQUENTIAL_CORRELATIVO_LIMIT);
  return candidates.length ? Math.max(...candidates) : null;
};

const INVOICE_TYPE_TO_DOCUMENT_TYPE: Readonly<Record<number, string>> = Object.fromEntries(
  Object.entries(DOCUMENT_TYPE_TO_INVOICE_TYPE).map(([code, type]) => [type, code]),
);

const getDocumentTypeCode = (invoiceType: InvoiceType): string =>
  INVOICE_TYPE_TO_DOCUMENT_TYPE[Number(invoiceType)] ?? '01';

/** Highest sequential correlativo per DTE type code for the company (manifest.maxCorrelativo). */
export const maxCorrelativoByDocType = (invoices: Invoice[], companyId: string): Record<string, number> => {
  const maxima: Record<string, number> = {};
  for (const invoice of invoices) {
    if (invoice.companyId !== companyId) continue;
    const docType = invoice.documentType || getDocumentTypeCode(invoice.invoiceType);
    const correlativo = correlativoOf(invoice);
    if (!docType || correlativo === null) continue;
    if ((maxima[docType] ?? 0) < correlativo) maxima[docType] = correlativo;
  }
  return maxima;
};
