// Device Sync v2 merge engine (design D4). Pure functions, no I/O: callers dispatch the
// returned decision through the normal slice reducers. The behavior here is a
// CROSS-PLATFORM CONTRACT — App.Desktop and SwiftUI run the same conformance fixture
// (__tests__/fixtures/merge-conformance.json) and must produce identical decisions.
//
// Rules (strategy §7, refined for real MH behavior):
// 1. Last-writer-wins on (updatedAt, deviceId); an exact timestamp tie is broken by the
//    lexicographically greater deviceId so both devices pick the same winner.
// 2. DTE invariants:
//    - MH-acknowledged documents (receptionSeal present, or status Completada/Anulada)
//      beat unacknowledged ones regardless of timestamps — the acknowledged copy is what
//      Hacienda holds.
//    - Status lattice protects acknowledged states: Completada only yields to Anulada,
//      Anulada never yields. Pre-acknowledgement states (Nueva, Modificada, Sincronizando,
//      ErrorEnvio) follow LWW so a failed send that resets the origin device propagates
//      instead of leaving peers stuck in "Sincronizando".
//    - Write-once MH ids: generationCode, receptionSeal, fechaTransmision keep their first
//      non-empty value; a later DIFFERENT value is surfaced as a conflict, not applied.
//      controlNumber is write-once only once acknowledged (the "YA EXISTE" duplicate retry
//      legitimately re-mints it before MH accepts the document).
//    - Items/totals of acknowledged documents are immutable.
// 3. Tombstones beat older upserts; a strictly newer upsert resurrects.
// 4. Purchases are identified by id, then codigoGeneracion, then numeroControl (the
//    caller resolves the local match); the same DTE imported on two devices converges on
//    one record instead of duplicating.
// 5. Customers, products and company settings: plain LWW.

import type { SyncEntityType, SyncOp } from './protocol';
import { ledgerStock, mergeProductStock, type StockLedger, type StockLedgerCarrier } from './stockLedger';

export type SyncEntity = Record<string, unknown> & { id: string; updatedAt?: string };

export interface VersionStamp {
  /** ISO updatedAt of the version. */
  u: string;
  /** deviceId that produced the version. */
  d: string;
}

/** Local bookkeeping per entity: the version we hold, and whether it is a tombstone. */
export interface VersionMeta extends VersionStamp {
  del?: boolean;
  /** Purchase dedupe key (codigoGeneracion || numeroControl), kept for tombstones. */
  k?: string;
}

export interface RemoteChange<T extends SyncEntity = SyncEntity> extends VersionStamp {
  op: SyncOp;
  entity?: T;
}

export interface SyncConflict {
  t: SyncEntityType;
  id: string;
  field: string;
  local: unknown;
  remote: unknown;
  fromDeviceId: string;
}

export type SkipReason =
  | 'stale'
  | 'tombstoned'
  | 'unknown-delete'
  | 'acknowledged-local'
  | 'duplicate';

export type MergeDecision<T extends SyncEntity = SyncEntity> =
  | { kind: 'upsert'; entity: T; version: VersionStamp; conflicts: SyncConflict[] }
  | { kind: 'delete'; version: VersionStamp; conflicts: SyncConflict[] }
  | { kind: 'skip'; reason: SkipReason; conflicts: SyncConflict[] };

/** Invoice status codes — must match src/types/invoice.ts InvoiceStatus. */
export const INVOICE_STATUS = {
  Nueva: 0,
  Sincronizando: 1,
  Completada: 2,
  Anulada: 3,
  Modificada: 4,
  ErrorEnvio: 5,
} as const;

export const INVOICE_WRITE_ONCE_FIELDS = [
  'generationCode',
  'controlNumber',
  'receptionSeal',
  'fechaTransmision',
] as const;

/** Fields that are immutable once the document is acknowledged by MH. */
export const INVOICE_IMMUTABLE_WHEN_ACKNOWLEDGED = [
  'items',
  'totals',
  'totalAmount',
  'total',
  'totalAmountIncludingTax',
  'subtotal',
  'tax',
] as const;

const toMillis = (iso: string | undefined): number => {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
};

/** >0 when `a` is the newer version, <0 when older, 0 when identical (same time + device). */
export const compareVersions = (a: VersionStamp, b: VersionStamp): number => {
  const ta = toMillis(a.u);
  const tb = toMillis(b.u);
  if (ta !== tb) return ta > tb ? 1 : -1;
  if (a.d === b.d) return 0;
  return a.d > b.d ? 1 : -1;
};

const laterIso = (a: string, b: string): string => (toMillis(a) >= toMillis(b) ? a : b);

const isEmpty = (value: unknown): boolean => value === undefined || value === null || value === '';

/** Structural equality for plain JSON data (entity payloads). */
export const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    return a.length === other.length && a.every((item, index) => deepEqual(item, other[index]));
  }
  const ka = Object.keys(a as object).filter(key => (a as Record<string, unknown>)[key] !== undefined);
  const kb = Object.keys(b as object).filter(key => (b as Record<string, unknown>)[key] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every(key => deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
};

/** The version a device holds for an entity it never recorded explicitly: its own write. */
export const effectiveLocalVersion = (
  local: SyncEntity | undefined,
  meta: VersionMeta | undefined,
  selfDeviceId: string,
): VersionMeta | undefined => {
  if (meta) return meta;
  if (!local) return undefined;
  return { u: local.updatedAt ?? '', d: selfDeviceId };
};

export const invoiceStatusRank = (status: unknown): number => {
  switch (status) {
    case INVOICE_STATUS.Anulada:
      return 3;
    case INVOICE_STATUS.Completada:
      return 2;
    default:
      // Nueva, Modificada, Sincronizando, ErrorEnvio: not yet acknowledged by MH.
      return 0;
  }
};

export const isAcknowledgedInvoice = (invoice: SyncEntity | undefined): boolean =>
  !!invoice && (!isEmpty(invoice.receptionSeal) || invoiceStatusRank(invoice.status) >= 2);

const decideUpsert = <T extends SyncEntity>(entity: T, version: VersionStamp, conflicts: SyncConflict[]): MergeDecision<T> => ({
  kind: 'upsert',
  entity: { ...entity, updatedAt: version.u },
  version,
  conflicts,
});

/**
 * Tombstone + missing-local handling shared by every entity type. Returns a decision when
 * the change is fully decided here, or null when the caller must merge two live copies.
 */
const resolveLifecycle = <T extends SyncEntity>(
  local: T | undefined,
  meta: VersionMeta | undefined,
  remote: RemoteChange<T>,
): MergeDecision<T> | null => {
  if (remote.op === 'delete') {
    if (!local && !meta) return { kind: 'skip', reason: 'unknown-delete', conflicts: [] };
    if (meta?.del && compareVersions(remote, meta) <= 0) return { kind: 'skip', reason: 'stale', conflicts: [] };
    if (meta && compareVersions(remote, meta) <= 0) return { kind: 'skip', reason: 'stale', conflicts: [] };
    return { kind: 'delete', version: { u: remote.u, d: remote.d }, conflicts: [] };
  }

  if (!remote.entity) return { kind: 'skip', reason: 'stale', conflicts: [] };

  if (meta?.del) {
    // Tombstoned locally: only a strictly newer upsert resurrects.
    return compareVersions(remote, meta) > 0
      ? decideUpsert(remote.entity, { u: remote.u, d: remote.d }, [])
      : { kind: 'skip', reason: 'tombstoned', conflicts: [] };
  }

  if (!local) return decideUpsert(remote.entity, { u: remote.u, d: remote.d }, []);
  return null;
};

/** Plain LWW — customers, products, company settings. */
export const mergeLww = <T extends SyncEntity>(
  local: T | undefined,
  localMeta: VersionMeta | undefined,
  remote: RemoteChange<T>,
  selfDeviceId: string,
): MergeDecision<T> => {
  const meta = effectiveLocalVersion(local, localMeta, selfDeviceId);
  const lifecycle = resolveLifecycle(local, meta, remote);
  if (lifecycle) return lifecycle;
  return compareVersions(remote, meta!) > 0
    ? decideUpsert(remote.entity!, { u: remote.u, d: remote.d }, [])
    : { kind: 'skip', reason: 'stale', conflicts: [] };
};

export const mergeInvoice = <T extends SyncEntity>(
  local: T | undefined,
  localMeta: VersionMeta | undefined,
  remote: RemoteChange<T>,
  selfDeviceId: string,
): MergeDecision<T> => {
  const meta = effectiveLocalVersion(local, localMeta, selfDeviceId);
  const lifecycle = resolveLifecycle(local, meta, remote);
  if (lifecycle) return lifecycle;

  const current = local!;
  const incoming = remote.entity!;
  const localVersion = meta!;
  const localAck = isAcknowledgedInvoice(current);
  const remoteAck = isAcknowledgedInvoice(incoming);
  const remoteNewer = compareVersions(remote, localVersion) > 0;
  const conflicts: SyncConflict[] = [];
  const conflict = (field: string, localValue: unknown, remoteValue: unknown) =>
    conflicts.push({ t: 'invoice', id: current.id, field, local: localValue, remote: remoteValue, fromDeviceId: remote.d });

  // Stale pre-acknowledgement edits never overwrite an acknowledged document.
  if (localAck && !remoteAck) {
    return { kind: 'skip', reason: 'acknowledged-local', conflicts: [] };
  }

  // Which copy supplies the ordinary (non-invariant) fields.
  const remoteWins = remoteAck && !localAck ? true : remoteNewer;
  const base: SyncEntity = remoteWins ? { ...incoming } : { ...current };
  const winnerVersion: VersionStamp = remoteWins ? { u: remote.u, d: remote.d } : { u: localVersion.u, d: localVersion.d };

  // Status lattice: acknowledged states only move up.
  const localRank = invoiceStatusRank(current.status);
  const remoteRank = invoiceStatusRank(incoming.status);
  if (localRank >= 2 || remoteRank >= 2) {
    if (remoteRank > localRank) base.status = incoming.status;
    else if (localRank > remoteRank) base.status = current.status;
    // equal rank: keep the winner's value (already in base)
  }

  // Write-once MH identifiers.
  for (const field of INVOICE_WRITE_ONCE_FIELDS) {
    const localValue = current[field];
    const remoteValue = incoming[field];
    if (isEmpty(localValue) && isEmpty(remoteValue)) continue;
    if (isEmpty(localValue)) { base[field] = remoteValue; continue; }
    if (isEmpty(remoteValue)) { base[field] = localValue; continue; }
    if (localValue === remoteValue) continue;

    if (field === 'controlNumber' && !(localAck && remoteAck)) {
      // Pre-acknowledgement re-mint: the acknowledged copy (or the LWW winner) is authoritative.
      base[field] = remoteAck && !localAck ? remoteValue : remoteWins ? remoteValue : localValue;
      continue;
    }

    conflict(field, localValue, remoteValue);
    // An acknowledged copy is what MH holds; otherwise the first value stays.
    base[field] = remoteAck && !localAck ? remoteValue : localValue;
  }

  // Acknowledged items/totals are immutable.
  if (localAck) {
    const itemsDiffer = !deepEqual(current.items, incoming.items);
    for (const field of INVOICE_IMMUTABLE_WHEN_ACKNOWLEDGED) {
      if (current[field] !== undefined) base[field] = current[field];
      else delete base[field];
    }
    if (remoteAck && itemsDiffer) conflict('items', current.items, incoming.items);
  }

  base.id = current.id;
  const version: VersionStamp = {
    u: laterIso(localVersion.u, remote.u),
    d: winnerVersion.d,
  };

  const unchanged = deepEqual({ ...base, updatedAt: undefined }, { ...current, updatedAt: undefined });
  if (unchanged && !remoteNewer) {
    return { kind: 'skip', reason: 'stale', conflicts };
  }
  return decideUpsert(base as T, version, conflicts);
};

/**
 * Purchases: `local` is the record the caller matched by id → codigoGeneracion →
 * numeroControl (company-scoped). A match with a DIFFERENT id is the same DTE imported
 * independently on another device: it merges onto the local record (keeping the local id),
 * or is dropped as a duplicate when it is not newer.
 */
export const mergePurchase = <T extends SyncEntity>(
  local: T | undefined,
  localMeta: VersionMeta | undefined,
  remote: RemoteChange<T>,
  selfDeviceId: string,
): MergeDecision<T> => {
  const meta = effectiveLocalVersion(local, localMeta, selfDeviceId);
  const lifecycle = resolveLifecycle(local, meta, remote);
  if (lifecycle) {
    if (lifecycle.kind === 'upsert' && local) {
      return { ...lifecycle, entity: { ...lifecycle.entity, id: local.id } };
    }
    return lifecycle;
  }

  const sameRecord = local!.id === remote.entity!.id;
  if (compareVersions(remote, meta!) <= 0) {
    return { kind: 'skip', reason: sameRecord ? 'stale' : 'duplicate', conflicts: [] };
  }
  return decideUpsert({ ...remote.entity!, id: local!.id }, { u: remote.u, d: remote.d }, []);
};

export const purchaseDedupeKey = (purchase: Partial<SyncEntity> | undefined): string | undefined => {
  if (!purchase) return undefined;
  const codigo = typeof purchase.codigoGeneracion === 'string' ? purchase.codigoGeneracion.trim() : '';
  if (codigo) return `cg:${codigo.toUpperCase()}`;
  const control = typeof purchase.numeroControl === 'string' ? purchase.numeroControl.trim() : '';
  return control ? `nc:${control.toUpperCase()}` : undefined;
};

/** Ticket statuses — must match src/types/ticket.ts TicketStatus. */
export const TICKET_STATUS = {
  OPEN: 'OPEN',
  COMPLETED: 'COMPLETED',
  VOID: 'VOID',
  CONSOLIDATED: 'CONSOLIDATED',
} as const;

/** The consolidation link is write-once within one consolidation revision. */
export const TICKET_WRITE_ONCE_FIELDS = ['invoiceId', 'invoiceControlNumber', 'consolidatedAt'] as const;

/** Fields the ticket lifecycle merge decides (everything else is plain LWW). */
const TICKET_LIFECYCLE_FIELDS = [
  'status',
  ...TICKET_WRITE_ONCE_FIELDS,
  'pendingInvoiceId',
  'voidedAt',
  'voidReason',
  'completedAt',
  'consolidationRevision',
  'returns',
] as const;

/** A partial return as it travels inside a ticket payload (src/types/ticket.ts TicketReturn). */
interface SyncTicketReturn {
  id: string;
  createdAt?: string;
  [key: string]: unknown;
}

const ticketReturnsOf = (ticket: SyncEntity): SyncTicketReturn[] =>
  Array.isArray(ticket.returns)
    ? (ticket.returns as unknown[]).filter((r): r is SyncTicketReturn => !!r && typeof r === 'object' && typeof (r as SyncTicketReturn).id === 'string')
    : [];

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter(key => record[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

/**
 * Partial returns (POS Phase 2): the union of both copies by return id.
 * Entries are write-once, so the same id carries the same content; should two
 * ever differ, both devices keep the same one (canonical order) so they still
 * converge. Sorted by (createdAt, id); undefined when neither copy has any.
 */
export const mergeTicketReturns = (current: SyncEntity, incoming: SyncEntity): SyncTicketReturn[] | undefined => {
  const byId = new Map<string, SyncTicketReturn>();
  for (const entry of [...ticketReturnsOf(current), ...ticketReturnsOf(incoming)]) {
    const held = byId.get(entry.id);
    if (!held || (!deepEqual(held, entry) && canonicalJson(entry) < canonicalJson(held))) byId.set(entry.id, entry);
  }
  if (byId.size === 0) return undefined;
  return [...byId.values()].sort((a, b) =>
    String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) || a.id.localeCompare(b.id));
};

export const ticketStatusRank = (status: unknown): number => {
  switch (status) {
    case TICKET_STATUS.VOID: return 3;
    case TICKET_STATUS.CONSOLIDATED: return 2;
    case TICKET_STATUS.COMPLETED: return 1;
    default: return 0; // OPEN
  }
};

/** Consolidation-release counter (Ticket.consolidationRevision); missing/invalid = 0. */
export const ticketConsolidationRevision = (ticket: SyncEntity): number => {
  const value = Number(ticket.consolidationRevision);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
};

interface TicketLifecycleResult {
  fields: Record<string, unknown>;
  conflicts: Array<{ field: string; local: unknown; remote: unknown }>;
  /** Fields where a write-once conflict kept the local value (not re-sent: the user resolves it). */
  keptLocal: Set<string>;
}

/**
 * Lifecycle join for two live copies of a ticket — deterministic, independent of
 * timestamps except as the tie-breaker between two equally-ranked copies:
 *
 * 1. Consolidation revision first: `releaseConsolidation` bumps
 *    `consolidationRevision`, so the copy at the newest revision decides the
 *    consolidation fields. A CONSOLIDATED status from an older revision counts
 *    as COMPLETED (it was released). This is the ONLY way a consolidation is
 *    undone — a newer COMPLETED copy without a link (a peer reprinting a stale
 *    copy) no longer reverts anything.
 * 2. Lattice within the newest revision: CONSOLIDATED > VOID > COMPLETED > OPEN.
 *    A consolidation is a fiscal fact (the invoice is at MH), so a concurrent
 *    void loses and is surfaced as a conflict (credit note needed) — a VOID
 *    ticket never carries an invoice link, and a CONSOLIDATED one no void data.
 * 3. Write-once: two different links (or two different pending drafts) in the
 *    same revision keep the local value and report a conflict.
 */
const resolveTicketLifecycle = (current: SyncEntity, incoming: SyncEntity, remoteNewer: boolean): TicketLifecycleResult => {
  const conflicts: TicketLifecycleResult['conflicts'] = [];
  const keptLocal = new Set<string>();
  const fields: Record<string, unknown> = {};
  const rc = ticketConsolidationRevision(current);
  const ri = ticketConsolidationRevision(incoming);
  const revision = Math.max(rc, ri);
  const effective = (ticket: SyncEntity, rev: number): unknown =>
    ticket.status === TICKET_STATUS.CONSOLIDATED && rev < revision ? TICKET_STATUS.COMPLETED : ticket.status;
  const sc = effective(current, rc);
  const si = effective(incoming, ri);
  const lww = remoteNewer ? incoming : current;
  const other = remoteNewer ? current : incoming;
  const firstOf = (field: string, a: SyncEntity, b: SyncEntity): unknown => (isEmpty(a[field]) ? b[field] : a[field]);

  if (sc === TICKET_STATUS.CONSOLIDATED || si === TICKET_STATUS.CONSOLIDATED) {
    fields.status = TICKET_STATUS.CONSOLIDATED;
    const both = sc === TICKET_STATUS.CONSOLIDATED && si === TICKET_STATUS.CONSOLIDATED;
    const side = both ? lww : sc === TICKET_STATUS.CONSOLIDATED ? current : incoming;
    const loser = side === current ? incoming : current;
    if (both && !isEmpty(current.invoiceId) && !isEmpty(incoming.invoiceId) && current.invoiceId !== incoming.invoiceId) {
      // Two invoices consumed the same ticket: keep ours, let the user resolve it.
      for (const field of TICKET_WRITE_ONCE_FIELDS) {
        fields[field] = current[field];
        if (!deepEqual(current[field], incoming[field])) {
          conflicts.push({ field, local: current[field], remote: incoming[field] });
          keptLocal.add(field);
        }
      }
    } else {
      for (const field of TICKET_WRITE_ONCE_FIELDS) fields[field] = both ? firstOf(field, side, loser) : side[field];
    }
    if (effective(loser, loser === current ? rc : ri) === TICKET_STATUS.VOID) {
      conflicts.push({ field: 'status', local: current.status, remote: incoming.status });
    }
    const loserPending = loser.pendingInvoiceId;
    if (!isEmpty(loserPending) && loserPending !== fields.invoiceId) {
      conflicts.push({ field: 'pendingInvoiceId', local: current.pendingInvoiceId, remote: incoming.pendingInvoiceId });
    }
    fields.pendingInvoiceId = undefined;
    fields.voidedAt = undefined;
    fields.voidReason = undefined;
    fields.completedAt = firstOf('completedAt', side, loser);
  } else if (sc === TICKET_STATUS.VOID || si === TICKET_STATUS.VOID) {
    fields.status = TICKET_STATUS.VOID;
    const side = sc === TICKET_STATUS.VOID && si === TICKET_STATUS.VOID ? lww : sc === TICKET_STATUS.VOID ? current : incoming;
    const loser = side === current ? incoming : current;
    fields.voidedAt = side.voidedAt;
    fields.voidReason = side.voidReason;
    for (const field of TICKET_WRITE_ONCE_FIELDS) fields[field] = undefined;
    // A voided sale cannot ride on a consolidation draft: drop the reservation
    // and surface it (the draft must be rebuilt without this ticket).
    if (!isEmpty(current.pendingInvoiceId) || !isEmpty(incoming.pendingInvoiceId)) {
      conflicts.push({ field: 'pendingInvoiceId', local: current.pendingInvoiceId, remote: incoming.pendingInvoiceId });
    }
    fields.pendingInvoiceId = undefined;
    fields.completedAt = firstOf('completedAt', side, loser);
  } else {
    // OPEN / COMPLETED.
    fields.status = ticketStatusRank(sc) >= ticketStatusRank(si) ? sc : si;
    for (const field of TICKET_WRITE_ONCE_FIELDS) fields[field] = undefined;
    fields.voidedAt = undefined;
    fields.voidReason = undefined;
    if (rc !== ri) {
      // The newer revision released (or re-reserved) the ticket: its reservation decides.
      fields.pendingInvoiceId = (ri > rc ? incoming : current).pendingInvoiceId;
    } else if (isEmpty(current.pendingInvoiceId) || isEmpty(incoming.pendingInvoiceId)) {
      // A reservation is only cleared by a release (revision bump), never by LWW.
      fields.pendingInvoiceId = firstOf('pendingInvoiceId', current, incoming);
    } else {
      fields.pendingInvoiceId = current.pendingInvoiceId;
      if (current.pendingInvoiceId !== incoming.pendingInvoiceId) {
        conflicts.push({ field: 'pendingInvoiceId', local: current.pendingInvoiceId, remote: incoming.pendingInvoiceId });
        keptLocal.add('pendingInvoiceId');
      }
    }
    fields.completedAt = fields.status === TICKET_STATUS.OPEN ? undefined : firstOf('completedAt', lww, other);
  }

  fields.consolidationRevision = revision > 0 ? revision : undefined;
  return { fields, conflicts, keptLocal };
};

const withFields = (entity: SyncEntity, fields: Record<string, unknown>): SyncEntity => {
  const result: SyncEntity = { ...entity };
  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined) delete result[field];
    else result[field] = value;
  }
  return result;
};

const withoutUpdatedAt = (entity: SyncEntity): SyncEntity => ({ ...entity, updatedAt: undefined });

/**
 * Tickets: plain LWW on (updatedAt, deviceId) for ordinary fields (printedCount,
 * customerName, items of an OPEN ticket…) plus the lifecycle join above, which
 * runs BEFORE any staleness check — an older copy whose lifecycle dominates
 * (a VOID, a consolidation, a release) is still merged in.
 *
 * Versioning: when the merged ticket equals the remote copy, the remote version
 * is adopted (nothing to send back). When the local side contributed anything
 * the remote lacks, the result is stamped with OUR device and a timestamp just
 * past both versions, so the sync service re-sends it and the peer — which then
 * receives a strictly newer copy it fully adopts — converges on the same content
 * and version. Write-once conflicts keep the local value without re-sending (both
 * sides keep their own; the conflict is surfaced to the user) — re-sending them
 * would ping-pong forever.
 */
export const mergeTicket = <T extends SyncEntity>(
  local: T | undefined,
  localMeta: VersionMeta | undefined,
  remote: RemoteChange<T>,
  selfDeviceId: string,
): MergeDecision<T> => {
  const meta = effectiveLocalVersion(local, localMeta, selfDeviceId);
  const lifecycle = resolveLifecycle(local, meta, remote);
  if (lifecycle) return lifecycle;

  const current = local!;
  const incoming: SyncEntity = { ...remote.entity!, id: current.id };
  const remoteNewer = compareVersions(remote, meta!) > 0;

  const resolved = resolveTicketLifecycle(current, incoming, remoteNewer);
  // Partial returns: union by id. A return the deciding copy of a VOID or a
  // consolidation never saw (registered concurrently on the other device) is
  // kept but surfaced — the void refunded / the invoice declared without it.
  const returns = mergeTicketReturns(current, incoming);
  resolved.fields.returns = returns;
  const finalStatus = resolved.fields.status;
  if (returns && (finalStatus === TICKET_STATUS.VOID || finalStatus === TICKET_STATUS.CONSOLIDATED)) {
    const currentDecides = current.status === finalStatus;
    const incomingDecides = incoming.status === finalStatus;
    if (currentDecides !== incomingDecides) {
      const decider = currentDecides ? current : incoming;
      const other = currentDecides ? incoming : current;
      const known = new Set(ticketReturnsOf(decider).map(r => r.id));
      if (ticketReturnsOf(other).some(r => !known.has(r.id))) {
        resolved.conflicts.push({ field: 'returns', local: current.returns, remote: incoming.returns });
      }
    }
  }
  const conflicts: SyncConflict[] = resolved.conflicts.map(c => ({
    t: 'ticket',
    id: current.id,
    field: c.field,
    local: c.local,
    remote: c.remote,
    fromDeviceId: remote.d,
  }));
  const merged = withFields(remoteNewer ? incoming : { ...current }, resolved.fields);
  merged.id = current.id;

  // Compare with the remote as if every kept-local conflict had gone its way.
  const comparable = withFields(
    merged,
    Object.fromEntries([...resolved.keptLocal].map(field => [field, incoming[field]])),
  );
  const sameAsRemote = deepEqual(withoutUpdatedAt(comparable), withoutUpdatedAt(incoming));
  const sameAsLocal = deepEqual(withoutUpdatedAt(merged), withoutUpdatedAt(current));

  if (sameAsRemote && remoteNewer) return decideUpsert(merged as T, { u: remote.u, d: remote.d }, conflicts);
  if (sameAsLocal && !remoteNewer) return { kind: 'skip', reason: 'stale', conflicts };

  const newest = Math.max(toMillis(meta!.u), toMillis(remote.u));
  const u = Number.isFinite(newest) ? new Date(newest + 1).toISOString() : remote.u;
  return decideUpsert(merged as T, { u, d: selfDeviceId }, conflicts);
};

/**
 * Products: LWW for every field except stock, which merges as a counter
 * (`stockLedger`, see stockLedger.ts) so concurrent sales on two registers
 * both count. Copies without a ledger on either side (older apps, the shared
 * conformance fixture) keep plain LWW.
 */
export const mergeProduct = <T extends SyncEntity>(
  local: T | undefined,
  localMeta: VersionMeta | undefined,
  remote: RemoteChange<T>,
  selfDeviceId: string,
): MergeDecision<T> => {
  const meta = effectiveLocalVersion(local, localMeta, selfDeviceId);
  const lifecycle = resolveLifecycle(local, meta, remote);
  if (lifecycle) return lifecycle;

  const current = local!;
  const incoming = remote.entity!;
  if (!current.stockLedger && !incoming.stockLedger) return mergeLww(local, localMeta, remote, selfDeviceId);

  const remoteNewer = compareVersions(remote, meta!) > 0;
  const ledger: StockLedger = mergeProductStock(
    current as StockLedgerCarrier, meta!.u, meta!.d,
    incoming as StockLedgerCarrier, remote.u, remote.d,
  );
  const stock = ledgerStock(ledger);
  const merged: SyncEntity = {
    ...(remoteNewer ? incoming : current),
    id: current.id,
    stockLedger: ledger,
    stock,
    stockQuantity: stock,
  };

  const sameAsRemote = deepEqual(withoutUpdatedAt(merged), withoutUpdatedAt(incoming));
  const sameAsLocal = deepEqual(withoutUpdatedAt(merged), withoutUpdatedAt(current));
  if (sameAsRemote && remoteNewer) return decideUpsert(merged as T, { u: remote.u, d: remote.d }, []);
  if (sameAsLocal && !remoteNewer) return { kind: 'skip', reason: 'stale', conflicts: [] };

  // The merge holds something the remote lacks (our sales): stamp it as ours,
  // just past both versions, so it travels back to the peer.
  const newest = Math.max(toMillis(meta!.u), toMillis(remote.u));
  const u = Number.isFinite(newest) && newest > 0 ? new Date(newest + 1).toISOString() : remote.u;
  return decideUpsert(merged as T, { u, d: selfDeviceId }, []);
};

export const mergeChange = <T extends SyncEntity>(
  type: SyncEntityType,
  local: T | undefined,
  localMeta: VersionMeta | undefined,
  remote: RemoteChange<T>,
  selfDeviceId: string,
): MergeDecision<T> => {
  switch (type) {
    case 'invoice':
      return mergeInvoice(local, localMeta, remote, selfDeviceId);
    case 'purchase':
      return mergePurchase(local, localMeta, remote, selfDeviceId);
    case 'ticket':
      return mergeTicket(local, localMeta, remote, selfDeviceId);
    case 'product':
      return mergeProduct(local, localMeta, remote, selfDeviceId);
    default:
      return mergeLww(local, localMeta, remote, selfDeviceId);
  }
};
