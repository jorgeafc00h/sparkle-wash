// Local audit capture — credits every local write to the user operating the app.
//
// Same seam shape as Device Sync's capture (services/sync/capture.ts): an
// allowlist of local-write action types; after the reducer runs, the affected
// collection is diffed by object reference to find what was created, changed or
// removed. Relay writes use `sync*` action types that are not listed, so changes
// arriving from other devices are never credited to whoever is at this register.
// Tickets and compras live outside Redux and are observed through their
// databases' change listeners (which also never fire for relay writes).
//
// Output goes to the `audit` slice only — local, never synced, never sent.

import type { AnyAction, Middleware } from '@reduxjs/toolkit';
import { InvoiceStatus, InvoiceType, type Invoice } from '@/types/invoice';
import type { Customer } from '@/types/customer';
import type { Product } from '@/types/product';
import type { Company } from '@/types/company';
import type { AuditActor, AuditEntityType, LocalUser, LocalUsersState } from '@/types/localUsers';
import { recordAuditEvents, type AuditEventInput } from '@/store/slices/auditSlice';
import { selectAuditActor } from '@/store/selectors/localUsersSelectors';
import type { RootState } from '@/store';
import { TicketDatabase, type TicketChangeEvent } from '../tickets/TicketDatabase';
import { ComprasDatabase, type CompraChangeEvent } from '../compras/ComprasDatabase';
import { ticketShortLabel } from '../tickets/ticketNumber';

type AuditedCollection = 'invoice' | 'customer' | 'product' | 'company';

export const AUDITED_ACTION_TYPES: Readonly<Record<string, AuditedCollection>> = {
  'invoices/addInvoice': 'invoice',
  'invoices/addInvoices': 'invoice',
  'invoices/updateInvoice': 'invoice',
  'invoices/setInvoiceStatus': 'invoice',
  'invoices/markAsContingency': 'invoice',
  'invoices/deleteInvoice': 'invoice',
  'customers/addCustomer': 'customer',
  'customers/updateCustomer': 'customer',
  'customers/deleteCustomer': 'customer',
  'customers/createCustomer/fulfilled': 'customer',
  'customers/updateCustomerAsync/fulfilled': 'customer',
  'customers/deleteCustomerAsync/fulfilled': 'customer',
  'products/addProduct': 'product',
  'products/updateProduct': 'product',
  'products/deleteProduct': 'product',
  'companies/createCompany/fulfilled': 'company',
  'companies/updateCompany/fulfilled': 'company',
  'companies/deleteCompany/fulfilled': 'company',
  'companies/promoteToProduction/fulfilled': 'company',
  // Deliberately NOT audited: stock side effects of a sale/invoice
  // (applyInvoiceStockDeduction / applyTicketStockDeduction / restoreTicketStock —
  // the sale itself is the audited event), bulk loads, delete*ByCompany, and every
  // sync* relay write.
};

const USER_ACTION_PREFIX = 'localUsers/';

// ─── labels ──────────────────────────────────────────────────────────────────

const INVOICE_TYPE_LABEL: Partial<Record<InvoiceType, string>> = {
  [InvoiceType.Factura]: 'Factura',
  [InvoiceType.CCF]: 'Crédito fiscal',
  [InvoiceType.NotaCredito]: 'Nota de crédito',
  [InvoiceType.SujetoExcluido]: 'Sujeto excluido',
  [InvoiceType.NotaDebito]: 'Nota de débito',
  [InvoiceType.NotaRemision]: 'Nota de remisión',
  [InvoiceType.ComprobanteLiquidacion]: 'Comprobante de liquidación',
  [InvoiceType.FacturaExportacion]: 'Factura de exportación',
  [InvoiceType.ComprobanteRetencion]: 'Comprobante de retención',
  [InvoiceType.DocumentoContableLiquidacion]: 'Documento contable de liquidación',
  [InvoiceType.ComprobanteDonacion]: 'Comprobante de donación',
  [InvoiceType.EventoOperacionesEspeciales]: 'Evento de operaciones especiales',
  [InvoiceType.EventoRetorno]: 'Evento de retorno',
};

const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  [InvoiceStatus.Nueva]: 'Nueva',
  [InvoiceStatus.Sincronizando]: 'Sincronizando',
  [InvoiceStatus.Completada]: 'Completada',
  [InvoiceStatus.Anulada]: 'Anulada',
  [InvoiceStatus.Modificada]: 'Modificada',
  [InvoiceStatus.ErrorEnvio]: 'Error de envío',
  [InvoiceStatus.Contingencia]: 'Contingencia',
};

export const invoiceLabel = (invoice: Pick<Invoice, 'invoiceType' | 'invoiceNumber'>) =>
  `${INVOICE_TYPE_LABEL[invoice.invoiceType] ?? 'Documento'} #${invoice.invoiceNumber}`;

const customerLabel = (customer: Customer) =>
  customer.businessName?.trim() || `${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim() || 'Cliente';

const productLabel = (product: Product) => product.productName || 'Producto';

const companyLabel = (company: Company) => company.nombreComercial || company.nombre || 'Empresa';

const money = (amount: number | undefined) => `$${(Number(amount) || 0).toFixed(2)}`;

// ─── diff helpers ────────────────────────────────────────────────────────────

interface Identified {
  id: string;
}

const diffById = <T extends Identified>(before: readonly T[], after: readonly T[]) => {
  const created: T[] = [];
  const updated: { before: T; after: T }[] = [];
  if (before === after) return { created, updated, deleted: [] as T[] };
  const previous = new Map(before.map((entity) => [entity.id, entity]));
  for (const entity of after) {
    const old = previous.get(entity.id);
    if (!old) created.push(entity);
    else if (old !== entity) updated.push({ before: old, after: entity });
    previous.delete(entity.id);
  }
  return { created, updated, deleted: Array.from(previous.values()) };
};

/** Top-level keys whose values differ (by JSON value, not reference). */
const changedKeys = (before: object, after: object): string[] => {
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return Array.from(keys).filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]));
};

// Fields the app maintains on its own while sending/recalculating a document —
// a write touching only these is bookkeeping, not somebody editing it.
const INVOICE_SYSTEM_FIELDS = new Set([
  'updatedAt',
  'controlNumber',
  'generationCode',
  'fechaGeneracion',
  'fechaTransmision',
  'receptionSeal',
  'shouldSyncToCloud',
  'totals',
  'total',
  'totalAmount',
  'totalAmountIncludingTax',
  'subtotal',
  'tax',
  'sourceTicketIds',
]);

const STOCK_FIELDS = new Set(['stock', 'stockQuantity', 'stockLedger', 'updatedAt']);

// Company fields that change without anyone editing the configuration:
// selection/default flips and "last tested / synced" timestamps.
const COMPANY_BOOKKEEPING_FIELDS = new Set(['updatedAt', 'isDefault', 'credentialsLastTestedAt', 'lastSyncDate']);

/** Credited with compras written by the background email import. */
export const IMPORT_ACTOR: AuditActor = { id: 'system:email-import', name: 'Importación automática (correo)', role: 'system' };

type Described = Pick<AuditEventInput, 'action' | 'summary'> | null;

function describeInvoiceUpdate(before: Invoice, after: Invoice): Described {
  if (before.status !== after.status) {
    switch (after.status) {
      case InvoiceStatus.Completada:
        return { action: 'status', summary: 'Transmitió a Hacienda (Completada)' };
      case InvoiceStatus.Anulada:
        return { action: 'void', summary: 'Anuló el documento' };
      case InvoiceStatus.ErrorEnvio:
        return { action: 'status', summary: 'Envío a Hacienda con error' };
      case InvoiceStatus.Contingencia:
        return { action: 'status', summary: 'Marcó el documento en contingencia' };
      case InvoiceStatus.Sincronizando:
        return null; // transient: the outcome (Completada / error) is what gets logged
      default:
        return { action: 'status', summary: `Cambió el estado a ${INVOICE_STATUS_LABEL[after.status] ?? after.status}` };
    }
  }
  const edited = changedKeys(before, after).filter((key) => !INVOICE_SYSTEM_FIELDS.has(key));
  return edited.length ? { action: 'update', summary: 'Editó el documento' } : null;
}

function describeProductUpdate(before: Product, after: Product): Described {
  const changed = changedKeys(before, after);
  if (changed.length === 0) return null;
  if (changed.every((key) => STOCK_FIELDS.has(key))) {
    const from = before.stockQuantity ?? before.stock ?? 0;
    const to = after.stockQuantity ?? after.stock ?? 0;
    if (from === to) return null;
    return { action: 'stock', summary: `Ajustó inventario: ${from} → ${to}` };
  }
  return { action: 'update', summary: 'Editó el producto' };
}

// ─── Redux collections ───────────────────────────────────────────────────────

/** Structural subset of RootState the audit capture reads. */
export interface AuditCaptureState {
  auth: RootState['auth'];
  localUsers: LocalUsersState;
  invoices: { invoices: Invoice[] };
  customers: { customers: Customer[] };
  products: { products: Product[] };
  companies: { companies: Company[] };
}

const actorOf = (state: AuditCaptureState): AuditActor => selectAuditActor(state as unknown as RootState);

export function computeCollectionAudit(
  before: AuditCaptureState,
  after: AuditCaptureState,
  collection: AuditedCollection,
  actor: AuditActor,
): AuditEventInput[] {
  const events: AuditEventInput[] = [];
  const push = (
    entityType: AuditEntityType,
    entityId: string,
    companyId: string | undefined,
    entityLabel: string,
    described: Described,
  ) => {
    if (described) events.push({ actor, entityType, entityId, companyId, entityLabel, ...described });
  };

  switch (collection) {
    case 'invoice': {
      const { created, updated, deleted } = diffById(before.invoices.invoices, after.invoices.invoices);
      for (const inv of created) {
        push('invoice', inv.id, inv.companyId, invoiceLabel(inv), { action: 'create', summary: `Creó ${invoiceLabel(inv)} por ${money(inv.totals?.totalPagar ?? inv.total)}` });
      }
      for (const { before: old, after: inv } of updated) {
        push('invoice', inv.id, inv.companyId, invoiceLabel(inv), describeInvoiceUpdate(old, inv));
      }
      for (const inv of deleted) {
        push('invoice', inv.id, inv.companyId, invoiceLabel(inv), { action: 'delete', summary: `Eliminó ${invoiceLabel(inv)}` });
      }
      break;
    }
    case 'customer': {
      const { created, updated, deleted } = diffById(before.customers.customers, after.customers.customers);
      for (const c of created) push('customer', c.id, c.companyId, customerLabel(c), { action: 'create', summary: `Creó el cliente ${customerLabel(c)}` });
      for (const { before: old, after: c } of updated) {
        if (changedKeys(old, c).some((key) => key !== 'updatedAt')) {
          push('customer', c.id, c.companyId, customerLabel(c), { action: 'update', summary: 'Editó el cliente' });
        }
      }
      for (const c of deleted) push('customer', c.id, c.companyId, customerLabel(c), { action: 'delete', summary: `Eliminó el cliente ${customerLabel(c)}` });
      break;
    }
    case 'product': {
      const { created, updated, deleted } = diffById(before.products.products, after.products.products);
      for (const p of created) push('product', p.id, p.companyId, productLabel(p), { action: 'create', summary: `Creó el producto ${productLabel(p)}` });
      for (const { before: old, after: p } of updated) push('product', p.id, p.companyId, productLabel(p), describeProductUpdate(old, p));
      for (const p of deleted) push('product', p.id, p.companyId, productLabel(p), { action: 'delete', summary: `Eliminó el producto ${productLabel(p)}` });
      break;
    }
    case 'company': {
      const { created, updated, deleted } = diffById(before.companies.companies, after.companies.companies);
      for (const co of created) push('company', co.id, co.id, companyLabel(co), { action: 'create', summary: `Registró la empresa ${companyLabel(co)}` });
      for (const { before: old, after: co } of updated) {
        if (changedKeys(old, co).some((key) => !COMPANY_BOOKKEEPING_FIELDS.has(key))) {
          push('company', co.id, co.id, companyLabel(co), { action: 'update', summary: 'Actualizó la configuración de la empresa' });
        }
      }
      for (const co of deleted) push('company', co.id, co.id, companyLabel(co), { action: 'delete', summary: `Eliminó la empresa ${companyLabel(co)}` });
      break;
    }
  }
  return events;
}

// ─── user management + sessions ──────────────────────────────────────────────

const asActor = (user: LocalUser): AuditActor => ({ id: user.id, name: user.displayName, role: user.role });

export function computeUserAudit(
  before: AuditCaptureState,
  after: AuditCaptureState,
  action: AnyAction,
): AuditEventInput[] {
  const userEvent = (
    actor: AuditActor,
    target: LocalUser,
    eventAction: AuditEventInput['action'],
    summary: string,
  ): AuditEventInput => ({ actor, action: eventAction, entityType: 'user', entityId: target.id, entityLabel: target.displayName, summary });

  const findUser = (state: AuditCaptureState, id: unknown) =>
    state.localUsers.users.find((user) => user.id === id);

  switch (action.type) {
    case 'localUsers/enableLocalUsers': {
      const admin = after.localUsers.users.find((user) => user.role === 'admin');
      return admin && after.localUsers.enabled
        ? [userEvent(asActor(admin), admin, 'update', 'Activó el control de usuarios')]
        : [];
    }
    case 'localUsers/disableLocalUsers': {
      const admin = before.localUsers.users.find((user) => user.role === 'admin');
      return admin && before.localUsers.enabled
        ? [userEvent(actorOf(before), admin, 'update', 'Desactivó el control de usuarios')]
        : [];
    }
    case 'localUsers/addLocalUser': {
      const known = new Set(before.localUsers.users.map((user) => user.id));
      return after.localUsers.users
        .filter((user) => !known.has(user.id))
        .map((user) => userEvent(actorOf(before), user, 'create', `Creó el usuario ${user.displayName} (@${user.username})`));
    }
    case 'localUsers/updateLocalUser': {
      const previous = findUser(before, action.payload?.id);
      const current = findUser(after, action.payload?.id);
      if (!previous || !current || previous === current) return [];
      const parts: string[] = [];
      if (previous.isActive !== current.isActive) parts.push(current.isActive ? 'reactivó el usuario' : 'desactivó el usuario');
      if (JSON.stringify(previous.permissions) !== JSON.stringify(current.permissions)) parts.push('cambió los permisos');
      if (previous.displayName !== current.displayName || previous.username !== current.username) parts.push('editó los datos');
      if (parts.length === 0) return [];
      const summary = parts.join(', ');
      return [userEvent(actorOf(before), current, 'update', summary.charAt(0).toUpperCase() + summary.slice(1))];
    }
    case 'localUsers/resetLocalUserPin': {
      const target = findUser(after, action.payload?.id);
      return target ? [userEvent(actorOf(before), target, 'update', 'Restableció el PIN')] : [];
    }
    case 'localUsers/deleteLocalUser': {
      const target = findUser(before, action.payload);
      return target && !findUser(after, action.payload)
        ? [userEvent(actorOf(before), target, 'delete', `Eliminó el usuario ${target.displayName}`)]
        : [];
    }
    case 'localUsers/localSessionStarted': {
      const target = findUser(after, action.payload?.userId);
      if (!target || after.localUsers.activeUserId !== target.id) return [];
      const how = action.payload?.method === 'google' ? ' con la cuenta de Google' : '';
      return [userEvent(asActor(target), target, 'login', `Inició sesión${how}`)];
    }
    case 'localUsers/localLoginFailed': {
      const target = findUser(after, action.payload?.userId);
      return target ? [userEvent(asActor(target), target, 'login_failed', 'Intento de acceso con PIN incorrecto')] : [];
    }
    case 'localUsers/lockLocalSession': {
      const target = findUser(before, before.localUsers.activeUserId);
      return target && before.localUsers.enabled
        ? [userEvent(asActor(target), target, 'logout', 'Cerró sesión')]
        : [];
    }
    default:
      return [];
  }
}

export const auditCaptureMiddleware: Middleware = (store) => (next) => (action) => {
  const type = (action as AnyAction).type;
  const collection = AUDITED_ACTION_TYPES[type];
  const isUserAction = typeof type === 'string' && type.startsWith(USER_ACTION_PREFIX);
  if (!collection && !isUserAction) return next(action);

  const before = store.getState() as AuditCaptureState;
  const result = next(action);
  const after = store.getState() as AuditCaptureState;

  try {
    const events = collection
      ? computeCollectionAudit(before, after, collection, actorOf(before))
      : computeUserAudit(before, after, action as AnyAction);
    if (events.length) store.dispatch(recordAuditEvents(events));
  } catch (error) {
    // Auditing must never break the user's write.
    console.warn('auditCapture: failed to record change', error);
  }
  return result;
};

// ─── tickets + compras (appStorage databases) ────────────────────────────────

/** `#123` (historical) or `C1-000123` when the ticket has a register code. */
function auditTicketNumber(event: Pick<TicketChangeEvent, 'sequential' | 'registerCode'>): string {
  if (event.sequential == null) return '#?';
  return ticketShortLabel({ sequential: event.sequential, registerCode: event.registerCode });
}

export function describeTicketChange(event: TicketChangeEvent): Described {
  const label = `ticket ${auditTicketNumber(event)}`;
  switch (event.kind) {
    case 'create':
      return event.status === 'OPEN'
        ? { action: 'create', summary: `Abrió el ${label}` }
        : { action: 'create', summary: `Registró la venta ${label} por ${money(event.totalAmount)}` };
    case 'complete':
      return { action: 'complete', summary: `Cobró el ${label} por ${money(event.totalAmount)}` };
    case 'void':
      return { action: 'void', summary: `Anuló el ${label}` };
    default:
      // Reprints, parked-cart edits and consolidation bookkeeping are not logged.
      return null;
  }
}

export function describeCompraChange(event: CompraChangeEvent): Described {
  const who = event.emisorNombre ? ` de ${event.emisorNombre}` : '';
  if (event.origin === 'import') {
    // The import's own auto-verify re-save is bookkeeping, not an edit.
    return event.kind === 'create' ? { action: 'create', summary: `Importó del correo la compra${who}` } : null;
  }
  switch (event.kind) {
    case 'create':
      return { action: 'create', summary: `Registró la compra${who}` };
    case 'delete':
      return { action: 'delete', summary: `Eliminó la compra${who}` };
    case 'update':
      return { action: 'update', summary: `Actualizó la compra${who}` };
    default:
      return null;
  }
}

type AuditStore = { getState: () => unknown; dispatch: (action: AnyAction) => unknown };

/** Wires the ticket + compras database listeners to the audit log (call once at startup). */
export function installAuditCapture(store: AuditStore): void {
  const record = (event: AuditEventInput) => {
    try {
      store.dispatch(recordAuditEvents([event]));
    } catch (error) {
      console.warn('auditCapture: failed to record change', error);
    }
  };

  if (typeof TicketDatabase?.setChangeListener === 'function') {
    TicketDatabase.setChangeListener((event) => {
      const described = describeTicketChange(event);
      if (!described) return;
      record({
        actor: actorOf(store.getState() as AuditCaptureState),
        entityType: 'ticket',
        entityId: event.id,
        companyId: event.companyId,
        entityLabel: `Ticket ${auditTicketNumber(event)}`,
        ...described,
      });
    });
  }

  if (typeof ComprasDatabase?.addChangeListener === 'function') {
    ComprasDatabase.addChangeListener((event) => {
      const described = describeCompraChange(event);
      if (!described) return;
      record({
        actor: event.origin === 'import' ? IMPORT_ACTOR : actorOf(store.getState() as AuditCaptureState),
        entityType: 'compra',
        entityId: event.id,
        companyId: event.companyId,
        entityLabel: event.numeroControl || event.emisorNombre || 'Compra',
        ...described,
      });
    });
  }
}
