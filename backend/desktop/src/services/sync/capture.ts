// Device Sync v2 capture seam (design D2): the ONE place local writes enter the outbox.
//
// Redux entities: an allowlist of local-write action types; after the reducer runs, the
// affected collection is diffed by object reference (Immer structural sharing ⇒ only
// touched entities get new references) — whatever the action changed is captured, with
// no per-action payload parsing that could drift. Relay writes use dedicated
// `sync*` action types that are NOT in the allowlist, so applied remote changes are
// never echoed back. Bulk loads (hydrate/reset/setProducts) are deliberately absent:
// they are not user edits, and the first session's snapshot covers pre-existing data.
//
// Compras live in ComprasDatabase (appStorage), so they are captured through its change
// listener.

import type { AnyAction, Middleware } from '@reduxjs/toolkit';
import type { Company } from '@/types';
import { recordLocalChanges, type LocalChange, type SyncV2State } from '../../store/slices/syncV2Slice';
import { canUseDeviceSync } from '../subscription/FeatureGate';
import { ComprasDatabase, type CompraChangeEvent } from '../compras/ComprasDatabase';
import { TicketDatabase, type TicketChangeEvent } from '../tickets/TicketDatabase';
import { companySyncKey, entityKey, type SyncEntityType } from './protocol';
import { purchaseDedupeKey } from './mergeEngine';

/** Stand-in deviceId for changes captured before startup resolved the real id. */
export const SELF_DEVICE_PLACEHOLDER = 'self';

// Tickets (like purchases) live outside Redux and are captured via the
// TicketDatabase change listener, never through the Redux allowlist.
type CapturedCollection = Exclude<SyncEntityType, 'purchase' | 'ticket'>;

export const CAPTURED_ACTION_TYPES: Readonly<Record<string, CapturedCollection>> = {
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
  'products/applyInvoiceStockDeduction': 'product',
  'products/restoreInvoiceStock': 'product',
  // POS ticket stock movements: without these, a POS sale synced the ticket
  // itself (TicketDatabase listener) but NOT the stock deduction/restore —
  // the phone's inventory silently diverged from the register's.
  'products/applyTicketStockDeduction': 'product',
  'products/restoreTicketStock': 'product',
  // Partial-return restock (POS Phase 2): same reason — the stock change must
  // reach the owner's other devices like a sale's deduction does.
  'products/restoreTicketReturnStock': 'product',
  'companies/updateCompany/fulfilled': 'company',
  // Deliberately NOT captured: deleteInvoicesByCompany / deleteCustomersByCompany /
  // deleteProductsByCompany (deleting a company on one device must never tombstone
  // that company's data on the owner's other devices), hydrate/set/reset bulk loads.
};

interface CapturableEntity {
  id: string;
  companyId?: string;
  updatedAt?: string;
}

/** Structural subset of RootState the capture seam reads. */
export interface CaptureState {
  subscription?: { tier?: string };
  syncV2?: Pick<SyncV2State, 'deviceId' | 'entitled' | 'companies'>;
  companies: { companies: Company[] };
  invoices: { invoices: CapturableEntity[] };
  customers: { customers: CapturableEntity[] };
  products: { products: CapturableEntity[] };
}

/** Free/plain-Pro capture nothing (no outbox growth, zero sync traffic). */
export const isCaptureEnabled = (state: CaptureState): boolean =>
  canUseDeviceSync(state.subscription?.tier) || state.syncV2?.entitled === true;

const toMillis = (iso: string | undefined): number => {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
};

export const diffCollection = <T extends CapturableEntity>(before: T[], after: T[]): { upserts: T[]; deletes: T[] } => {
  if (before === after) return { upserts: [], deletes: [] };
  const previous = new Map(before.map(entity => [entity.id, entity]));
  const upserts: T[] = [];
  for (const entity of after) {
    const old = previous.get(entity.id);
    if (old !== entity) upserts.push(entity);
    previous.delete(entity.id);
  }
  return { upserts, deletes: Array.from(previous.values()) };
};

const collectionOf = (state: CaptureState, type: Exclude<CapturedCollection, 'company'>): CapturableEntity[] => {
  switch (type) {
    case 'invoice':
      return state.invoices.invoices;
    case 'customer':
      return state.customers.customers;
    case 'product':
      return state.products.products;
  }
};

/**
 * The version stamp for a captured upsert: the entity's own updatedAt, unless a reducer
 * path left it stale (not newer than what we already hold) — then "now", so peers never
 * discard a real edit as old.
 */
const upsertStamp = (state: CaptureState, co: string, key: string, updatedAt: string | undefined, now: string): string => {
  const held = state.syncV2?.companies?.[co]?.versions?.[key]?.u;
  if (!updatedAt) return now;
  if (held && toMillis(updatedAt) <= toMillis(held)) return now;
  return updatedAt;
};

/** Local changes an action produced, grouped by company sync key. */
export const computeLocalChanges = (
  before: CaptureState,
  after: CaptureState,
  collection: CapturedCollection,
  now: string,
): Map<string, LocalChange[]> => {
  const byCo = new Map<string, LocalChange[]>();
  const push = (co: string | null, change: LocalChange) => {
    if (!co) return;
    const list = byCo.get(co) ?? [];
    list.push(change);
    byCo.set(co, list);
  };

  if (collection === 'company') {
    const { upserts } = diffCollection(before.companies.companies as CapturableEntity[], after.companies.companies as CapturableEntity[]);
    for (const company of upserts as unknown as Company[]) {
      const co = companySyncKey(company);
      if (!co) continue;
      push(co, { t: 'company', id: co, op: 'upsert', u: upsertStamp(after, co, entityKey('company', co), company.updatedAt, now) });
    }
    return byCo;
  }

  // Map each entity to ITS company's key (not "the selected company"): an edit is
  // captured under the group it belongs to even if the selection changed meanwhile.
  const coByCompanyId = new Map(after.companies.companies.map(company => [company.id, companySyncKey(company)]));
  const { upserts, deletes } = diffCollection(collectionOf(before, collection), collectionOf(after, collection));
  for (const entity of upserts) {
    const co = entity.companyId ? coByCompanyId.get(entity.companyId) ?? null : null;
    if (!co) continue;
    push(co, { t: collection, id: entity.id, op: 'upsert', u: upsertStamp(after, co, entityKey(collection, entity.id), entity.updatedAt, now) });
  }
  for (const entity of deletes) {
    const co = entity.companyId ? coByCompanyId.get(entity.companyId) ?? null : null;
    push(co, { t: collection, id: entity.id, op: 'delete', u: now });
  }
  return byCo;
};

// ─── outbox-change notifications (the live session debounces a flush on these) ───

type OutboxListener = () => void;
const outboxListeners = new Set<OutboxListener>();

export const onOutboxChanged = (listener: OutboxListener): (() => void) => {
  outboxListeners.add(listener);
  return () => outboxListeners.delete(listener);
};

const notifyOutboxChanged = () => {
  outboxListeners.forEach(listener => {
    try {
      listener();
    } catch (error) {
      console.warn('syncCapture: outbox listener failed', error);
    }
  });
};

export const syncCaptureMiddleware: Middleware = store => next => action => {
  const collection = CAPTURED_ACTION_TYPES[(action as AnyAction).type];
  if (!collection) return next(action);

  const before = store.getState() as CaptureState;
  const result = next(action);
  const after = store.getState() as CaptureState;
  if (!isCaptureEnabled(after)) return result;

  try {
    const changesByCo = computeLocalChanges(before, after, collection, new Date().toISOString());
    if (changesByCo.size === 0) return result;
    const deviceId = after.syncV2?.deviceId ?? SELF_DEVICE_PLACEHOLDER;
    changesByCo.forEach((changes, co) => {
      store.dispatch(recordLocalChanges({ co, deviceId, changes }));
    });
    notifyOutboxChanged();
  } catch (error) {
    // Capture must never break the user's write.
    console.warn('syncCapture: failed to capture change', error);
  }
  return result;
};

export const captureCompraChange = (
  getState: () => CaptureState,
  dispatch: (action: AnyAction) => unknown,
  event: CompraChangeEvent,
): void => {
  const state = getState();
  if (!isCaptureEnabled(state)) return;
  const company = state.companies.companies.find(item => item.id === event.companyId);
  const co = companySyncKey(company);
  if (!co) return;
  const k = purchaseDedupeKey({ id: event.id, codigoGeneracion: event.codigoGeneracion, numeroControl: event.numeroControl });
  dispatch(recordLocalChanges({
    co,
    deviceId: state.syncV2?.deviceId ?? SELF_DEVICE_PLACEHOLDER,
    changes: [{ t: 'purchase', id: event.id, op: event.op, u: event.updatedAt || new Date().toISOString(), ...(k ? { k } : {}) }],
  }));
  notifyOutboxChanged();
};

/** Wires the compras SQLite listener to the store (call once at startup). */
export const installComprasCapture = (store: { getState: () => unknown; dispatch: (action: AnyAction) => unknown }): void => {
  if (typeof ComprasDatabase?.setChangeListener !== 'function') return;
  ComprasDatabase.setChangeListener(event =>
    captureCompraChange(store.getState as () => CaptureState, store.dispatch, event),
  );
};

/**
 * POS tickets live in TicketDatabase (appStorage), captured through its change
 * listener exactly like compras. Only local writes emit events — relay writes go
 * through upsertFromSync/deleteFromSync and never echo. Voids are upserts (the
 * status change IS the tombstone semantics); `deleteCompanyData` is deliberately
 * not captured (same rule as the Redux delete*ByCompany actions).
 */
export const captureTicketChange = (
  getState: () => CaptureState,
  dispatch: (action: AnyAction) => unknown,
  event: TicketChangeEvent,
): void => {
  const state = getState();
  if (!isCaptureEnabled(state)) return;
  const company = state.companies.companies.find(item => item.id === event.companyId);
  const co = companySyncKey(company);
  if (!co) return;
  dispatch(recordLocalChanges({
    co,
    deviceId: state.syncV2?.deviceId ?? SELF_DEVICE_PLACEHOLDER,
    changes: [{ t: 'ticket', id: event.id, op: event.op, u: event.updatedAt || new Date().toISOString() }],
  }));
  notifyOutboxChanged();
};

/** Wires the TicketDatabase change listener to the store (call once at startup). */
export const installTicketCapture = (store: { getState: () => unknown; dispatch: (action: AnyAction) => unknown }): void => {
  if (typeof TicketDatabase?.setChangeListener !== 'function') return;
  TicketDatabase.setChangeListener(event =>
    captureTicketChange(store.getState as () => CaptureState, store.dispatch, event),
  );
};
