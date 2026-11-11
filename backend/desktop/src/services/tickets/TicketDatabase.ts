// TicketDatabase — per-company POS ticket storage (appStorage JSON, the
// ComprasDatabase pattern). Tickets are high-volume, append-mostly retail
// documents: they live outside Redux so rehydration and the persisted
// whitelist stay lean. See openspec/changes/add-pos-tickets/design.md §2.

import { customAlphabet } from 'nanoid';
import { appStorage } from '../storage/ElectronStorage';
import {
  CashClosing,
  Ticket,
  TicketFilters,
  TicketReturn,
  TicketStatus,
} from '@/types/ticket';
import { isFullyReturned, validateReturnRequest } from './TicketReturns';
import {
  archiveKey,
  archiveKeyPrefix,
  archiveMonthOf,
  archiveMonthsForRange,
  hotWindowStart,
  isArchivable,
  partitionForArchive,
} from './ticketArchive';
import { ticketNumberSearchText } from './ticketNumber';

const nanoid8 = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);

function dbKey(companyId: string): string {
  return `tickets_db_${companyId}`;
}

/**
 * Where archived tickets live (POS Phase 2 design §9). Kept INSIDE the hot DB
 * key so a ticket's membership — hot list XOR archive index — changes in one
 * atomic write: an id is never in both and never in neither. Month blobs are
 * always written first; a blob entry whose id isn't indexed to that month is
 * ignored (left by an interrupted pass or a move back to hot) and dropped the
 * next time that month is rewritten.
 */
interface TicketArchiveIndex {
  /** ticket id → archive month ('YYYY-MM', El Salvador sale month). */
  ids: Record<string, string>;
  /** invoice id → archive months holding tickets consolidated into it. */
  invoices: Record<string, string[]>;
}

interface TicketDbShape {
  tickets: Ticket[];
  closings: CashClosing[];
  sequential: number;
  archive?: TicketArchiveIndex;
}

function normalizeArchiveIndex(raw: unknown): TicketArchiveIndex | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const ids: Record<string, string> = {};
  const invoices: Record<string, string[]> = {};
  if (record.ids && typeof record.ids === 'object') {
    for (const [id, month] of Object.entries(record.ids as Record<string, unknown>)) {
      if (typeof month === 'string' && /^\d{4}-\d{2}$/.test(month)) ids[id] = month;
    }
  }
  if (record.invoices && typeof record.invoices === 'object') {
    for (const [invoiceId, months] of Object.entries(record.invoices as Record<string, unknown>)) {
      if (Array.isArray(months)) invoices[invoiceId] = months.filter((m): m is string => typeof m === 'string');
    }
  }
  return { ids, invoices };
}

function archiveIndexOf(db: TicketDbShape): TicketArchiveIndex {
  if (!db.archive) db.archive = { ids: {}, invoices: {} };
  return db.archive;
}

// ── In-memory cache ────────────────────────────────────────────────────────

const cache = new Map<string, TicketDbShape>();
const loaded = new Set<string>();

// First-load de-duplication: concurrent first callers (a sale, the sync
// snapshot, the Libros banner, useTickets) share ONE storage read. Each used to
// read and cache its own copy, so a sale written into one copy was lost when
// another caller's copy (read before the sale) replaced it in the cache.
const inflight = new Map<string, Promise<TicketDbShape>>();

async function readFromStorage(companyId: string): Promise<TicketDbShape> {
  let db: TicketDbShape = { tickets: [], closings: [], sequential: 0 };
  try {
    const raw = await appStorage.getItem(dbKey(companyId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TicketDbShape>;
      db = {
        // Fields this reader doesn't know (newer builds, other sections of
        // the DB) ride along unchanged instead of being dropped on the next write.
        ...(parsed && typeof parsed === 'object' ? parsed : {}),
        tickets: Array.isArray(parsed.tickets) ? parsed.tickets : [],
        closings: Array.isArray(parsed.closings) ? parsed.closings : [],
        sequential: Number(parsed.sequential) || 0,
        archive: normalizeArchiveIndex(parsed.archive),
      };
      if (!db.archive) delete db.archive;
    }
  } catch {
    // Corrupt JSON — start clean rather than crash the POS, but keep the raw
    // value aside first: the next persist would otherwise overwrite it for good.
    await preserveCorrupt(dbKey(companyId));
  }
  return db;
}

async function load(companyId: string): Promise<TicketDbShape> {
  if (loaded.has(companyId)) {
    return cache.get(companyId)!;
  }
  const pending = inflight.get(companyId);
  if (pending) return pending;
  const promise: Promise<TicketDbShape> = readFromStorage(companyId).then(async (db) => {
    // Lazy migration / monthly roll-over: final tickets that left the hot
    // window move to their month archive before anyone reads this copy.
    // Never throws — a failed pass leaves every ticket where it was.
    await runArchivePass(companyId, db, clock(), {
      stillCurrent: () => inflight.get(companyId) === promise,
      writeHot: () => appStorage.setItem(dbKey(companyId), JSON.stringify(db)),
    });
    if (inflight.get(companyId) !== promise) {
      // Invalidated while reading (company data deleted, failed persist):
      // start over so every caller ends up on the same, current cache entry.
      return load(companyId);
    }
    inflight.delete(companyId);
    cache.set(companyId, db);
    loaded.add(companyId);
    return db;
  });
  inflight.set(companyId, promise);
  return promise;
}

// ── Monthly archive (POS Phase 2 design §9) ────────────────────────────────

let clock: () => Date = () => new Date();

/** Raw month blobs as stored (may hold unindexed leftovers — filter with the index). */
const monthCache = new Map<string, Ticket[]>();
const monthInflight = new Map<string, Promise<Ticket[]>>();
const monthCacheKey = (companyId: string, month: string) => `${companyId}|${month}`;

async function readMonthBlob(companyId: string, month: string): Promise<Ticket[]> {
  const cacheKey = monthCacheKey(companyId, month);
  const cached = monthCache.get(cacheKey);
  if (cached) return cached;
  const pending = monthInflight.get(cacheKey);
  if (pending) return pending;
  const self: { promise?: Promise<Ticket[]> } = {};
  self.promise = (async () => {
    let tickets: Ticket[] = [];
    try {
      const raw = await appStorage.getItem(archiveKey(companyId, month));
      if (raw) {
        const parsed = JSON.parse(raw) as { tickets?: unknown };
        tickets = Array.isArray(parsed?.tickets) ? (parsed.tickets as Ticket[]) : [];
      }
    } catch {
      await preserveCorrupt(archiveKey(companyId, month));
    }
    // Only the read still registered fills the cache (a company delete may have intervened).
    if (monthInflight.get(cacheKey) === self.promise) {
      monthCache.set(cacheKey, tickets);
      monthInflight.delete(cacheKey);
    }
    return tickets;
  })();
  monthInflight.set(cacheKey, self.promise);
  return self.promise;
}

/** Write a month blob: the indexed entries of that month, minus `replacing`, plus `adding`. */
async function writeMonthBlob(
  companyId: string,
  index: TicketArchiveIndex,
  month: string,
  adding: Ticket[],
): Promise<void> {
  const existing = await readMonthBlob(companyId, month);
  const replacing = new Set(adding.map((t) => t.id));
  const next = [
    ...existing.filter((t) => index.ids[t.id] === month && !replacing.has(t.id)),
    ...adding,
  ];
  await appStorage.setItem(archiveKey(companyId, month), JSON.stringify({ month, tickets: next }));
  monthCache.set(monthCacheKey(companyId, month), next);
}

/** The archived tickets of a month (index membership decides). */
async function archivedTicketsOfMonth(companyId: string, db: TicketDbShape, month: string): Promise<Ticket[]> {
  const ids = db.archive?.ids;
  if (!ids) return [];
  const seen = new Set<string>();
  const result: Ticket[] = [];
  for (const ticket of await readMonthBlob(companyId, month)) {
    if (ids[ticket.id] !== month || seen.has(ticket.id)) continue;
    seen.add(ticket.id);
    result.push(ticket);
  }
  return result;
}

function archivedMonths(db: TicketDbShape): string[] {
  const ids = db.archive?.ids;
  return ids ? Array.from(new Set(Object.values(ids))).sort() : [];
}

function indexArchived(index: TicketArchiveIndex, ticket: Ticket, month: string): void {
  index.ids[ticket.id] = month;
  if (ticket.invoiceId) {
    const months = index.invoices[ticket.invoiceId] ?? [];
    if (!months.includes(month)) index.invoices[ticket.invoiceId] = [...months, month];
  }
}

async function archivedTicketsByIds(companyId: string, db: TicketDbShape, ids: Iterable<string>): Promise<Ticket[]> {
  const index = db.archive?.ids;
  if (!index) return [];
  const byMonth = new Map<string, Set<string>>();
  for (const id of ids) {
    const month = index[id];
    if (!month) continue;
    if (!byMonth.has(month)) byMonth.set(month, new Set());
    byMonth.get(month)!.add(id);
  }
  const result: Ticket[] = [];
  for (const [month, wanted] of byMonth) {
    for (const ticket of await archivedTicketsOfMonth(companyId, db, month)) {
      if (wanted.has(ticket.id)) result.push(ticket);
    }
  }
  return result;
}

/**
 * Move archived tickets back into the hot list (in memory). The caller's
 * persist() makes it durable in ONE write — the ticket joins `tickets` and
 * leaves the index together. Returns the promoted tickets.
 */
async function promoteArchived(companyId: string, db: TicketDbShape, ids: string[]): Promise<Ticket[]> {
  const found = await archivedTicketsByIds(companyId, db, ids);
  if (!found.length || !db.archive) return [];
  for (const ticket of found) {
    if (db.tickets.some((t) => t.id === ticket.id)) continue;
    delete db.archive.ids[ticket.id];
    db.tickets.unshift(ticket);
  }
  return found;
}

/** Promote every archived ticket consolidated into `invoiceId` (release / invalidation). */
async function promoteArchivedForInvoice(companyId: string, db: TicketDbShape, invoiceId: string): Promise<Ticket[]> {
  const months = db.archive?.invoices[invoiceId];
  if (!months?.length || !db.archive) return [];
  const ids: string[] = [];
  for (const month of months) {
    for (const ticket of await archivedTicketsOfMonth(companyId, db, month)) {
      if (ticket.invoiceId === invoiceId || ticket.pendingInvoiceId === invoiceId) ids.push(ticket.id);
    }
  }
  const promoted = await promoteArchived(companyId, db, ids);
  delete db.archive.invoices[invoiceId];
  return promoted;
}

interface ArchivePassHooks {
  /** False once the DB was invalidated (company deleted): stop writing. */
  stillCurrent: () => boolean;
  /** Durably write the (already mutated) hot DB. */
  writeHot: () => Promise<void>;
}

/**
 * One archive pass: month blobs first, then the hot DB (tickets removed and
 * indexed in the same write). Any failure leaves every ticket in the hot DB —
 * at worst a blob holds unindexed copies, which reads ignore. Returns the
 * number of tickets archived. Never throws.
 */
async function runArchivePass(companyId: string, db: TicketDbShape, nowDate: Date, hooks: ArchivePassHooks): Promise<number> {
  const hotStart = hotWindowStart(nowDate);
  const { byMonth } = partitionForArchive(db.tickets, hotStart);
  if (byMonth.size === 0) return 0;
  const index = archiveIndexOf(db);
  const written = new Map<string, { month: string; updatedAt: string }>();
  try {
    for (const [month, tickets] of byMonth) {
      if (!hooks.stillCurrent()) return 0;
      await writeMonthBlob(companyId, index, month, tickets);
      for (const ticket of tickets) written.set(ticket.id, { month, updatedAt: ticket.updatedAt });
    }
  } catch (error) {
    console.warn('TicketDatabase: archive pass failed writing a month — tickets stay in the hot DB', error);
    return 0;
  }
  if (!hooks.stillCurrent()) return 0;

  // Re-check after the awaits: a ticket written meanwhile (reprint, peer
  // update) is no longer the copy in the blob — it stays hot this time.
  const previousInvoices = { ...index.invoices };
  const moved: Ticket[] = [];
  const kept: Ticket[] = [];
  for (const ticket of db.tickets) {
    const entry = written.get(ticket.id);
    if (entry && entry.updatedAt === ticket.updatedAt && isArchivable(ticket, hotStart)) moved.push(ticket);
    else kept.push(ticket);
  }
  if (!moved.length) return 0;
  db.tickets = kept;
  for (const ticket of moved) indexArchived(index, ticket, written.get(ticket.id)!.month);
  try {
    await hooks.writeHot();
  } catch (error) {
    // Disk still holds the old hot DB: put memory back in step with it
    // (keeping anything written to the hot list while we were awaiting).
    const present = new Set(db.tickets.map((t) => t.id));
    db.tickets = [...moved.filter((t) => !present.has(t.id)), ...db.tickets];
    for (const ticket of moved) delete index.ids[ticket.id];
    index.invoices = previousInvoices;
    console.warn('TicketDatabase: archive pass failed writing the hot DB — nothing moved', error);
    return 0;
  }
  return moved.length;
}

async function preserveCorrupt(key: string): Promise<void> {
  try {
    const raw = await appStorage.getItem(key);
    if (raw) await appStorage.setItem(`${key}.corrupt-${Date.now()}`, raw);
  } catch {
    // best effort
  }
}

async function persist(companyId: string): Promise<void> {
  const db = cache.get(companyId);
  if (!db) return;
  try {
    await appStorage.setItem(dbKey(companyId), JSON.stringify(db));
  } catch (error) {
    // The caller already mutated the cache: drop it so the next read reloads
    // what actually reached disk — a failed sale must not linger as a phantom
    // ticket that closings still count.
    cache.delete(companyId);
    loaded.delete(companyId);
    inflight.delete(companyId);
    throw error;
  }
}

// ── Change events (UI refresh + future Device-Sync capture) ────────────────

/** What kind of local write produced an event (read by the local audit log). */
export type TicketChangeKind = 'create' | 'update' | 'complete' | 'void' | 'print' | 'pending' | 'consolidate' | 'release' | 'return';

export interface TicketChangeEvent {
  op: 'upsert' | 'delete';
  id: string;
  companyId: string;
  status: TicketStatus;
  updatedAt: string;
  kind?: TicketChangeKind;
  sequential?: number;
  /** Register code at sale time ("C1") — display numbers via formatTicketNumber. */
  registerCode?: string;
  totalAmount?: number;
}

export type TicketChangeListener = (event: TicketChangeEvent) => void;

const listeners = new Set<TicketChangeListener>();

function emit(op: 'upsert' | 'delete', ticket: Ticket, kind?: TicketChangeKind, updatedAt?: string): void {
  const event: TicketChangeEvent = {
    op,
    id: ticket.id,
    companyId: ticket.companyId,
    status: ticket.status,
    updatedAt: updatedAt ?? ticket.updatedAt ?? new Date().toISOString(),
    kind,
    sequential: ticket.sequential,
    registerCode: ticket.registerCode,
    totalAmount: ticket.totalAmount,
  };
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      console.warn('TicketDatabase: change listener failed', error);
    }
  }
  notifyUi();
}

// ── UI-refresh listeners ─────────────────────────────────────────────────
// Notified by EVERY write — including Device-Sync relay writes, which never
// reach the change listeners above (they must not echo into the outbox).
// Pages subscribe to this so a peer's sale appears without a remount.

type UiListener = () => void;
const uiListeners = new Set<UiListener>();

function notifyUi(): void {
  for (const listener of uiListeners) {
    try {
      listener();
    } catch (error) {
      console.warn('TicketDatabase: ui listener failed', error);
    }
  }
}

// ── Status lattice ─────────────────────────────────────────────────────────
// OPEN → COMPLETED → (VOID before consolidation | CONSOLIDATED via invoice)
// CONSOLIDATED only exits through the consolidation-revert path.

const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ['COMPLETED', 'VOID'],
  COMPLETED: ['VOID', 'CONSOLIDATED'],
  VOID: [],
  CONSOLIDATED: ['COMPLETED'], // revert only (invoice failed / invalidated)
};

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

function assertTransition(ticket: Ticket, to: TicketStatus): void {
  if (!canTransition(ticket.status, to)) {
    throw new Error(`Transición inválida de ticket: ${ticket.status} → ${to}`);
  }
}

// ── Database ───────────────────────────────────────────────────────────────

export interface NewTicketInput {
  companyId: string;
  items: Ticket['items'];
  payments: Ticket['payments'];
  discountTotal?: number;
  roundingAdjustment?: number;
  totalAmount: number;
  taxIncluded: number;
  /** Post-discount exempt bucket (computeTicketAmounts) — consumed by closings. */
  exemptTotal?: number;
  customerName?: string;
  cashierName?: string;
  excludeFromLibrosIVA?: boolean;
  /** Ticket discount as typed (%), so a suspended sale resumes with it. */
  discountPct?: number;
  /** Register that rings the sale (Device Sync device id) and its code ("C1"). */
  registerId?: string;
  registerCode?: string;
  /** Complete immediately (normal POS path) — otherwise stays OPEN (parked). */
  complete?: boolean;
}

/** Fields of an OPEN (suspended) ticket the register may rewrite before charging it. */
export type OpenTicketPatch = Partial<Pick<Ticket,
  | 'items'
  | 'payments'
  | 'customerName'
  | 'cashierName'
  | 'totalAmount'
  | 'taxIncluded'
  | 'exemptTotal'
  | 'discountTotal'
  | 'discountPct'
  | 'roundingAdjustment'
  | 'excludeFromLibrosIVA'
>>;

/** Why a ticket reserved by a consolidation draft can't be voided (UI hint + error). */
export const TICKET_PENDING_VOID_MESSAGE =
  'El ticket está en un borrador de factura — elimina el borrador o quítalo de la consolidación antes de anularlo.';

function now(): string {
  return new Date().toISOString();
}

export class TicketDatabase {
  static setChangeListener(listener: TicketChangeListener | null): void {
    if (listener) listeners.add(listener);
  }

  static removeChangeListener(listener: TicketChangeListener): void {
    listeners.delete(listener);
  }

  /** Subscribe to every write (local + relay) for UI refresh. Returns unsubscribe. */
  static setUiListener(listener: UiListener): () => void {
    uiListeners.add(listener);
    return () => uiListeners.delete(listener);
  }

  static async getTickets(filters: TicketFilters): Promise<Ticket[]> {
    const db = await load(filters.companyId);
    const term = filters.searchTerm?.toLowerCase();
    // Archived months are read only when asked for: a date range reaching
    // them, or includeArchived (Device Sync, full exports). The hot list has
    // every OPEN/COMPLETED ticket plus the current and previous month.
    let pool = db.tickets;
    const all = archivedMonths(db);
    if (all.length) {
      const months = filters.includeArchived
        ? all
        : filters.from || filters.to
          ? archiveMonthsForRange(all, filters.from, filters.to)
          : [];
      if (months.length) {
        pool = [...db.tickets];
        for (const month of months) pool.push(...(await archivedTicketsOfMonth(filters.companyId, db, month)));
      }
    }
    const result = pool.filter((t) => {
      if (filters.status && t.status !== filters.status) return false;
      if (filters.from && t.createdAt < filters.from) return false;
      if (filters.to && t.createdAt > filters.to) return false;
      if (filters.unconsolidatedOnly && (t.invoiceId || t.pendingInvoiceId)) return false;
      if (term) {
        const hay = `${ticketNumberSearchText(t)} ${t.customerName ?? ''} ${t.cashierName ?? ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
    // Sequential desc within createdAt order (newest first).
    result.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || b.sequential - a.sequential);
    return result;
  }

  static async getTicket(companyId: string, id: string): Promise<Ticket | null> {
    const db = await load(companyId);
    const hot = db.tickets.find((t) => t.id === id);
    if (hot) return hot;
    return (await archivedTicketsByIds(companyId, db, [id]))[0] ?? null;
  }

  static async getTicketsByIds(companyId: string, ids: string[]): Promise<Ticket[]> {
    const db = await load(companyId);
    const wanted = new Set(ids);
    const hot = db.tickets.filter((t) => wanted.has(t.id));
    const missing = ids.filter((id) => !hot.some((t) => t.id === id));
    return missing.length ? [...hot, ...(await archivedTicketsByIds(companyId, db, missing))] : hot;
  }

  /**
   * Every ticket of the company — hot AND archived (Device Sync lists,
   * digests and snapshots must match peers that never archived anything).
   */
  static async listAllForSync(companyId: string): Promise<Ticket[]> {
    return TicketDatabase.getTickets({ companyId, includeArchived: true });
  }

  /**
   * Move final tickets that left the hot window into their month archive.
   * Runs on every first load; callers may run it after a Z as well. Returns
   * how many tickets moved (0 on any failure — nothing is ever lost).
   */
  static async archiveFinalTickets(companyId: string, at: Date = clock()): Promise<number> {
    const db = await load(companyId);
    const moved = await runArchivePass(companyId, db, at, {
      stillCurrent: () => cache.get(companyId) === db,
      writeHot: () => persist(companyId),
    });
    if (moved) notifyUi();
    return moved;
  }

  /** Archive months and how many tickets each holds (settings / diagnostics / tests). */
  static async getArchiveSummary(companyId: string): Promise<Record<string, number>> {
    const db = await load(companyId);
    const summary: Record<string, number> = {};
    for (const month of Object.values(db.archive?.ids ?? {})) summary[month] = (summary[month] ?? 0) + 1;
    return summary;
  }

  /** Test hooks: a fixed clock for the archive window, and a cold restart of the in-memory caches. */
  static setClockForTests(next: (() => Date) | null): void {
    clock = next ?? (() => new Date());
  }

  static resetMemoryForTests(): void {
    cache.clear();
    loaded.clear();
    inflight.clear();
    monthCache.clear();
    monthInflight.clear();
  }

  /** COMPLETED tickets in [from, to] with no invoiceId and no pending draft (consolidation pool). */
  static async getUnconsolidated(companyId: string, from?: string, to?: string): Promise<Ticket[]> {
    return TicketDatabase.getTickets({ companyId, status: 'COMPLETED', from, to, unconsolidatedOnly: true });
  }

  /**
   * Sales not yet inside a COMPLETED DTE — includes tickets pending on a draft
   * invoice. Used by the Libros IVA completeness banner, which must warn about
   * sales outside the books even while a consolidation draft is being prepared.
   */
  static async getNotConsolidated(companyId: string, from?: string, to?: string): Promise<Ticket[]> {
    const db = await load(companyId);
    return db.tickets.filter(
      // Same inclusive-from / inclusive-to window as getTickets/getUnconsolidated
      // (both boundary seconds belong to the period being checked).
      (t) =>
        t.status === 'COMPLETED' &&
        !t.invoiceId &&
        // A fully returned ticket kept no sale: nothing is missing from the books.
        !isFullyReturned(t) &&
        (!from || t.createdAt >= from) &&
        (!to || t.createdAt <= to),
    );
  }

  static async create(input: NewTicketInput): Promise<Ticket> {
    const db = await load(input.companyId);
    const timestamp = now();
    const ticket: Ticket = {
      id: `tkt_${nanoid8()}`,
      companyId: input.companyId,
      sequential: db.sequential + 1,
      status: input.complete === false ? 'OPEN' : 'COMPLETED',
      items: input.items,
      payments: input.payments,
      discountTotal: input.discountTotal,
      roundingAdjustment: input.roundingAdjustment,
      totalAmount: input.totalAmount,
      taxIncluded: input.taxIncluded,
      exemptTotal: input.exemptTotal,
      excludeFromLibrosIVA: input.excludeFromLibrosIVA || undefined,
      customerName: input.customerName,
      cashierName: input.cashierName,
      ...(input.discountPct ? { discountPct: input.discountPct } : {}),
      ...(input.registerId ? { registerId: input.registerId } : {}),
      ...(input.registerCode ? { registerCode: input.registerCode } : {}),
      createdAt: timestamp,
      completedAt: input.complete === false ? undefined : timestamp,
      printedCount: 0,
      updatedAt: timestamp,
    };
    db.sequential = ticket.sequential;
    db.tickets.unshift(ticket);
    await persist(input.companyId);
    emit('upsert', ticket, 'create');
    return ticket;
  }

  /** Update mutable fields of an OPEN ticket (suspended sale re-suspended with changes). */
  static async updateOpen(companyId: string, id: string, patch: OpenTicketPatch): Promise<Ticket | null> {
    const db = await load(companyId);
    const idx = db.tickets.findIndex((t) => t.id === id);
    if (idx === -1 || db.tickets[idx].status !== 'OPEN') return null;
    db.tickets[idx] = { ...db.tickets[idx], ...patch, updatedAt: now() };
    await persist(companyId);
    emit('upsert', db.tickets[idx], 'update');
    return db.tickets[idx];
  }

  /**
   * OPEN → COMPLETED. A resumed suspended sale is charged IN PLACE (same id
   * and number): `patch` carries the cart as charged — lines, payments,
   * totals — and lands in the same write as the status change.
   */
  static async complete(companyId: string, id: string, patch?: OpenTicketPatch): Promise<Ticket | null> {
    const db = await load(companyId);
    const idx = db.tickets.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    assertTransition(db.tickets[idx], 'COMPLETED');
    const timestamp = now();
    db.tickets[idx] = { ...db.tickets[idx], ...(patch ?? {}), status: 'COMPLETED', completedAt: timestamp, updatedAt: timestamp };
    await persist(companyId);
    emit('upsert', db.tickets[idx], 'complete');
    return db.tickets[idx];
  }

  static async void(companyId: string, id: string, reason: string): Promise<Ticket | null> {
    const db = await load(companyId);
    const idx = db.tickets.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    const ticket = db.tickets[idx];
    if (ticket.status === 'CONSOLIDATED') {
      throw new Error('No se puede anular un ticket ya consolidado en una factura — emite una nota de crédito sobre la factura.');
    }
    if (ticket.pendingInvoiceId) {
      throw new Error(TICKET_PENDING_VOID_MESSAGE);
    }
    assertTransition(ticket, 'VOID');
    const timestamp = now();
    db.tickets[idx] = { ...ticket, status: 'VOID', voidedAt: timestamp, voidReason: reason, updatedAt: timestamp };
    await persist(companyId);
    emit('upsert', db.tickets[idx], 'void');
    return db.tickets[idx];
  }

  static async incrementPrinted(companyId: string, id: string): Promise<void> {
    const db = await load(companyId);
    // A reprint changes the ticket: an archived one comes back to the hot DB.
    if (!db.tickets.some((t) => t.id === id)) await promoteArchived(companyId, db, [id]);
    const idx = db.tickets.findIndex((t) => t.id === id);
    if (idx === -1) return;
    db.tickets[idx] = { ...db.tickets[idx], printedCount: db.tickets[idx].printedCount + 1, updatedAt: now() };
    await persist(companyId);
    // Same emit as every other local mutation: without it the print count
    // never reached the sync outbox (other devices kept stale counts) and
    // open ticket lists didn't refresh.
    emit('upsert', db.tickets[idx], 'print');
  }

  /**
   * Partial return (POS Phase 2 design §8): append a write-once TicketReturn
   * to a COMPLETED, un-invoiced ticket. Re-validated here against the stored
   * copy (a peer may have consolidated or returned meanwhile). Idempotent per
   * return id — a double submit stores it once. Emits kind 'return' (synced
   * like any upsert; the page writes the audit entry and the restock).
   */
  static async addReturn(companyId: string, id: string, ret: TicketReturn): Promise<Ticket> {
    const db = await load(companyId);
    // Archive (design §9): a ticket that changes again comes back to the hot DB.
    if (!db.tickets.some((t) => t.id === id)) await promoteArchived(companyId, db, [id]);
    const idx = db.tickets.findIndex((t) => t.id === id);
    if (idx === -1) throw new Error('Ticket no encontrado.');
    const ticket = db.tickets[idx];
    if (ticket.returns?.some((r) => r.id === ret.id)) return ticket;
    const problem = validateReturnRequest(ticket, ret.lines.map((l) => ({ lineId: l.lineId, quantity: l.quantity })));
    if (problem) throw new Error(problem);
    const timestamp = now();
    db.tickets[idx] = { ...ticket, returns: [...(ticket.returns ?? []), ret], updatedAt: timestamp };
    await persist(companyId);
    emit('upsert', db.tickets[idx], 'return');
    return db.tickets[idx];
  }

  /** Consolidation: mark tickets as pending on a freshly drafted invoice. */
  static async markPendingConsolidation(companyId: string, ticketIds: string[], invoiceId: string): Promise<number> {
    const db = await load(companyId);
    let count = 0;
    const updated: Ticket[] = [];
    for (const t of db.tickets) {
      if (!ticketIds.includes(t.id) || t.status !== 'COMPLETED' || t.invoiceId) continue;
      // Never steal a ticket another draft already reserved (double-click,
      // a stale wizard tab, or a peer device): the caller compares the count
      // with the batch and rolls its draft back on a shortfall.
      if (t.pendingInvoiceId && t.pendingInvoiceId !== invoiceId) continue;
      t.pendingInvoiceId = invoiceId;
      t.updatedAt = now();
      count += 1;
      updated.push(t);
    }
    if (count) {
      await persist(companyId);
      // markConsolidated/releaseConsolidation emit; this reservation write
      // must too — it's a local mutation the owner's other devices and the
      // ticket list UI need to see.
      for (const t of updated) emit('upsert', t, 'pending');
    }
    return count;
  }

  /**
   * Invoice reached Completada — finalize the link. Returns updated tickets.
   * `sourceTicketIds` (the invoice's own list) relinks tickets whose
   * reservation was lost — e.g. a send that failed once (ErrorEnvio used to
   * release them) and succeeded on retry — as long as no other draft or
   * invoice holds them.
   */
  static async markConsolidated(
    companyId: string,
    invoiceId: string,
    controlNumber?: string,
    sourceTicketIds: string[] = [],
  ): Promise<Ticket[]> {
    const db = await load(companyId);
    const updated: Ticket[] = [];
    const sources = new Set(sourceTicketIds);
    for (const t of db.tickets) {
      const reservedHere = t.pendingInvoiceId === invoiceId || t.invoiceId === invoiceId;
      const orphanedSource = sources.has(t.id) && !t.pendingInvoiceId && !t.invoiceId;
      if (!reservedHere && !orphanedSource) continue;
      if (t.status !== 'COMPLETED') continue;
      const timestamp = now();
      t.invoiceId = invoiceId;
      t.invoiceControlNumber = controlNumber;
      t.consolidatedAt = timestamp;
      t.pendingInvoiceId = undefined;
      t.status = 'CONSOLIDATED';
      t.updatedAt = timestamp;
      updated.push(t);
    }
    if (updated.length) await persist(companyId);
    for (const t of updated) emit('upsert', t, 'consolidate');
    return updated;
  }

  /**
   * Draft deleted / invoice invalidated — release tickets back to COMPLETED.
   * (A failed send no longer releases: the draft keeps its tickets so a retry
   * links them — see ticketConsolidationMiddleware.)
   */
  static async releaseConsolidation(companyId: string, invoiceId: string): Promise<Ticket[]> {
    const db = await load(companyId);
    // Archive (design §9): an old invoice's tickets come back to the hot DB to be released.
    await promoteArchivedForInvoice(companyId, db, invoiceId);
    const updated: Ticket[] = [];
    for (const t of db.tickets) {
      if (t.pendingInvoiceId !== invoiceId && t.invoiceId !== invoiceId) continue;
      if (t.status !== 'CONSOLIDATED') {
        // Pending-only: just clear the reservation.
        if (t.pendingInvoiceId === invoiceId) {
          t.pendingInvoiceId = undefined;
          // Explicit release marker: mergeTicket lets the higher revision
          // decide the consolidation fields, so the release reaches peers
          // and a stale copy can never undo a link or drop a reservation.
          t.consolidationRevision = (t.consolidationRevision ?? 0) + 1;
          t.updatedAt = now();
          updated.push(t);
        }
        continue;
      }
      assertTransition(t, 'COMPLETED');
      t.status = 'COMPLETED';
      t.invoiceId = undefined;
      t.invoiceControlNumber = undefined;
      t.consolidatedAt = undefined;
      t.pendingInvoiceId = undefined;
      t.consolidationRevision = (t.consolidationRevision ?? 0) + 1;
      t.updatedAt = now();
      updated.push(t);
    }
    if (updated.length) await persist(companyId);
    for (const t of updated) emit('upsert', t, 'release');
    return updated;
  }

  static async getByInvoiceId(companyId: string, invoiceId: string): Promise<Ticket[]> {
    const db = await load(companyId);
    const matches = (t: Ticket) => t.invoiceId === invoiceId || t.pendingInvoiceId === invoiceId;
    const result = db.tickets.filter(matches);
    for (const month of db.archive?.invoices[invoiceId] ?? []) {
      result.push(...(await archivedTicketsOfMonth(companyId, db, month)).filter(matches));
    }
    return result;
  }

  // ── Device Sync v2: relay writes (verbatim, never captured) ────────────
  // Mirrors ComprasDatabase.upsertFromSync/deleteFromSync: the merge engine
  // already decided the final entity, so it lands as-is — no transition
  // guards, no change events (an applied remote change must never echo back
  // into the outbox).

  static async upsertFromSync(ticket: Ticket, existingId?: string): Promise<void> {
    const companyId = ticket.companyId;
    const db = await load(companyId);
    const targetId = existingId ?? ticket.id;
    const idx = db.tickets.findIndex((t) => t.id === targetId);
    // Wholesale replacement: the merge engine already produced the complete
    // entity. Spreading it over the old copy kept fields the peer CLEARED
    // (JSON drops undefined), so a released invoiceId/pendingInvoiceId never
    // left this device. Tickets carry no device-local fields.
    const next: Ticket = { ...ticket, id: targetId };
    const index = db.archive;
    if (isArchivable(next, hotWindowStart(clock()))) {
      // An old final ticket (a new device's first snapshot, a peer's late
      // copy) lands straight in its month: blob first, then the hot write
      // that indexes it (and drops any hot copy) — never in both places.
      const month = archiveMonthOf(next);
      const archive = archiveIndexOf(db);
      await writeMonthBlob(companyId, archive, month, [next]);
      const hotIdx = db.tickets.findIndex((t) => t.id === targetId); // re-read after the await
      if (hotIdx >= 0) db.tickets.splice(hotIdx, 1);
      indexArchived(archive, next, month);
    } else {
      if (idx >= 0) db.tickets[idx] = next;
      else db.tickets.unshift(next);
      // A change to an archived ticket moves it back to the hot DB.
      if (index?.ids[targetId]) delete index.ids[targetId];
    }
    db.sequential = Math.max(db.sequential, Number(ticket.sequential) || 0);
    await persist(companyId);
    notifyUi(); // UI refresh only — never the capture listeners (no outbox echo).
  }

  static async deleteFromSync(id: string): Promise<void> {
    for (const [companyId, db] of cache.entries()) {
      const idx = db.tickets.findIndex((t) => t.id === id);
      if (idx !== -1) {
        db.tickets.splice(idx, 1);
        await persist(companyId);
        notifyUi();
        return;
      }
      if (db.archive?.ids[id]) {
        delete db.archive.ids[id]; // the month blob's copy is now an ignored leftover
        await persist(companyId);
        notifyUi();
        return;
      }
    }
  }

  static async deleteCompanyData(companyId: string): Promise<void> {
    const months = new Set(archivedMonths(cache.get(companyId) ?? { tickets: [], closings: [], sequential: 0 }));
    cache.delete(companyId);
    loaded.delete(companyId);
    inflight.delete(companyId);
    for (const key of Array.from(monthCache.keys())) {
      if (key.startsWith(`${companyId}|`)) monthCache.delete(key);
    }
    for (const key of Array.from(monthInflight.keys())) {
      if (key.startsWith(`${companyId}|`)) monthInflight.delete(key);
    }
    await appStorage.removeItem(dbKey(companyId));
    // Archive months: the indexed ones plus any leftover key of an interrupted pass.
    try {
      const keys = typeof appStorage.getAllKeys === 'function' ? await appStorage.getAllKeys() : [];
      const pattern = new RegExp(`^${archiveKeyPrefix(companyId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\d{4}-\\d{2}$`);
      for (const key of keys ?? []) if (pattern.test(key)) months.add(key.slice(archiveKeyPrefix(companyId).length));
    } catch {
      // Listing keys is best effort — the indexed months are still removed.
    }
    for (const month of months) await appStorage.removeItem(archiveKey(companyId, month));
  }

  // ── Closings (Z-reports) ──────────────────────────────────────────────

  static async getClosings(companyId: string): Promise<CashClosing[]> {
    const db = await load(companyId);
    return [...db.closings].sort((a, b) => b.closedAt.localeCompare(a.closedAt));
  }

  static async getLastClosing(companyId: string): Promise<CashClosing | null> {
    const closings = await TicketDatabase.getClosings(companyId);
    return closings[0] ?? null;
  }

  static async saveClosing(closing: CashClosing): Promise<void> {
    const db = await load(closing.companyId);
    db.closings.push(closing);
    await persist(closing.companyId);
  }

  /** Every ticket of the company, hot and archived. */
  static async getCount(companyId: string): Promise<number> {
    const db = await load(companyId);
    return db.tickets.length + Object.keys(db.archive?.ids ?? {}).length;
  }
}

/** Convenience for tests and the consolidation middleware. */
export function findCompanyIdForTicket(ticketId: string): string | null {
  for (const [companyId, db] of cache.entries()) {
    if (db.tickets.some((t) => t.id === ticketId) || db.archive?.ids[ticketId]) return companyId;
  }
  return null;
}
