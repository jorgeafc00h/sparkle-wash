// Device Sync v2 — ticket entity (openspec add-pos-tickets task 6.1/6.2).
//
// mergeTicket: LWW on (updatedAt, deviceId) with the ticket status lattice
// (OPEN < COMPLETED < CONSOLIDATED/VOID) and the write-once consolidation
// link; the only legal downward move is the authoritative consolidation
// revert. captureTicketChange: TicketDatabase change events land in the
// outbox like compras.

jest.mock('@/services/logging/LocalLogger', () => ({
  LocalLogger: { initialize: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), log: jest.fn() },
}));
jest.mock('@/services/telemetry/TelemetryService', () => ({
  TelemetryService: { initialize: jest.fn(), trackEvent: jest.fn(), trackException: jest.fn(), trackTrace: jest.fn() },
  default: { initialize: jest.fn(), trackEvent: jest.fn(), trackException: jest.fn(), trackTrace: jest.fn() },
}));
jest.mock('@/services/storage/ElectronStorage', () => {
  const map = new Map<string, string>();
  const storage = {
    getItem: jest.fn(async (key: string) => (map.has(key) ? map.get(key)! : null)),
    setItem: jest.fn(async (key: string, value: string) => {
      map.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      map.delete(key);
    }),
    clear: jest.fn(async () => {
      map.clear();
    }),
    getAllKeys: jest.fn(async () => Array.from(map.keys())),
  };
  return { appStorage: storage, electronPersistStorage: storage };
});

import { mergeTicket, type RemoteChange, type SyncEntity, type VersionMeta } from '@/services/sync/mergeEngine';
import { captureTicketChange } from '@/services/sync/capture';
import { TicketDatabase, type TicketChangeEvent } from '@/services/tickets/TicketDatabase';
import { SubscriptionTier } from '@/services/subscription/SubscriptionTypes';
import { makeCompany, setTier, createSyncTestStore, TEST_NIT } from './helpers/syncFakeRelay';
import { hydrateCompanies } from '@/store/slices/companySlice';
import type { Ticket } from '@/types/ticket';

const CO = `co${TEST_NIT}`;
const SELF = 'desktop-A';
const PEER = 'android-B';

const T0 = '2026-09-26T10:00:00.000Z';
const T1 = '2026-09-26T11:00:00.000Z';
const T2 = '2026-09-26T12:00:00.000Z';

function ticket(over: Record<string, unknown>): SyncEntity {
  return {
    id: 'tkt_1',
    companyId: 'company_1',
    sequential: 1,
    status: 'COMPLETED',
    items: [],
    payments: [{ id: 'p1', method: 'EFECTIVO', amount: 6 }],
    totalAmount: 6,
    taxIncluded: 0.69,
    createdAt: T0,
    printedCount: 0,
    updatedAt: T1,
    ...over,
  };
}

const remote = (entity: SyncEntity, u: string, op: 'upsert' | 'delete' = 'upsert'): RemoteChange => ({
  op, u, d: PEER, entity,
});

// ─── mergeTicket ───────────────────────────────────────────────────────────

describe('mergeTicket', () => {
  it('applies a ticket this device has never seen', () => {
    const decision = mergeTicket(undefined, undefined, remote(ticket({}), T1), SELF);
    expect(decision.kind).toBe('upsert');
    if (decision.kind === 'upsert') {
      expect(decision.entity.status).toBe('COMPLETED');
      expect(decision.version).toEqual({ u: T1, d: PEER });
    }
  });

  it('skips stale remotes (plain LWW)', () => {
    const local = ticket({ updatedAt: T2 });
    const meta: VersionMeta = { u: T2, d: SELF };
    const decision = mergeTicket(local, meta, remote(ticket({}), T1), SELF);
    expect(decision.kind).toBe('skip');
  });

  it('newer remote wins field changes (plain LWW)', () => {
    const local = ticket({ updatedAt: T0, customerName: 'old' });
    const meta: VersionMeta = { u: T0, d: SELF };
    const decision = mergeTicket(local, meta, remote(ticket({ customerName: 'Ana', updatedAt: T1 }), T1), SELF);
    expect(decision.kind).toBe('upsert');
    if (decision.kind === 'upsert') expect(decision.entity.customerName).toBe('Ana');
  });

  it('upward lattice move applies: COMPLETED → CONSOLIDATED', () => {
    const local = ticket({ updatedAt: T0 });
    const meta: VersionMeta = { u: T0, d: SELF };
    const decision = mergeTicket(
      local,
      meta,
      remote(ticket({ status: 'CONSOLIDATED', invoiceId: 'inv_9', invoiceControlNumber: 'DTE-01-1-1', consolidatedAt: T1, updatedAt: T1 }), T1),
      SELF,
    );
    expect(decision.kind).toBe('upsert');
    if (decision.kind === 'upsert') {
      expect(decision.entity.status).toBe('CONSOLIDATED');
      expect(decision.entity.invoiceId).toBe('inv_9');
    }
  });

  it('an older-rank copy must not regress a VOID ticket', () => {
    const local = ticket({ status: 'VOID', voidedAt: T1, voidReason: 'error', updatedAt: T1 });
    const meta: VersionMeta = { u: T1, d: SELF };
    // Peer's pre-void COMPLETED copy, NEWER than the void — rank must still hold.
    const decision = mergeTicket(local, meta, remote(ticket({ status: 'COMPLETED', updatedAt: T2 }), T2), SELF);
    expect(decision.kind).toBe('upsert');
    if (decision.kind === 'upsert') expect(decision.entity.status).toBe('VOID');
  });

  it('an older-rank copy must not un-consolidate a CONSOLIDATED ticket (link intact)', () => {
    const local = ticket({ status: 'CONSOLIDATED', invoiceId: 'inv_9', consolidatedAt: T1, updatedAt: T1 });
    const meta: VersionMeta = { u: T1, d: SELF };
    // COMPLETED WITH a different link is not a revert → status holds.
    const decision = mergeTicket(
      local,
      meta,
      remote(ticket({ status: 'CONSOLIDATED', invoiceId: 'inv_OTHER', updatedAt: T2 }), T2),
      SELF,
    );
    expect(decision.kind).toBe('upsert');
    if (decision.kind === 'upsert') {
      expect(decision.entity.status).toBe('CONSOLIDATED');
      expect(decision.entity.invoiceId).toBe('inv_9'); // write-once
      expect(decision.conflicts.some((c) => c.field === 'invoiceId')).toBe(true);
    }
  });

  it('the authoritative revert releases a CONSOLIDATED ticket back to COMPLETED', () => {
    const local = ticket({ status: 'CONSOLIDATED', invoiceId: 'inv_9', invoiceControlNumber: 'DTE-01-1-1', consolidatedAt: T1, updatedAt: T1 });
    const meta: VersionMeta = { u: T1, d: SELF };
    // releaseConsolidation: link cleared AND consolidationRevision bumped.
    const decision = mergeTicket(local, meta, remote(ticket({ status: 'COMPLETED', invoiceId: undefined, consolidationRevision: 1, updatedAt: T2 }), T2), SELF);
    expect(decision.kind).toBe('upsert');
    if (decision.kind === 'upsert') {
      expect(decision.entity.status).toBe('COMPLETED');
      expect(decision.entity.invoiceId).toBeUndefined();
    }
  });

  it('delete from a peer tombstones a live ticket', () => {
    const local = ticket({ updatedAt: T0 });
    const meta: VersionMeta = { u: T0, d: SELF };
    const decision = mergeTicket(local, meta, { op: 'delete', u: T1, d: PEER }, SELF);
    expect(decision.kind).toBe('delete');
  });
});

// ─── mergeTicket: explicit release, lattice before staleness, convergence ──

const T3 = '2026-09-26T13:00:00.000Z';

const plus1ms = (iso: string) => new Date(Date.parse(iso) + 1).toISOString();

/** A device as the sync service sees it: the live entity + its version meta. */
interface Device { id: string; entity: SyncEntity; meta: VersionMeta }

const wire = (entity: SyncEntity): SyncEntity => JSON.parse(JSON.stringify(entity));

/**
 * One envelope from → to, exactly as syncV2Service does it (materialize sends
 * d = sender, u = sender's meta.u; a decision attributed to the receiver is
 * queued back). Returns whether the receiver must push its result.
 */
function deliver(from: Device, to: Device): boolean {
  const change: RemoteChange = { op: 'upsert', u: from.meta.u, d: from.id, entity: wire({ ...from.entity, updatedAt: from.meta.u }) };
  const decision = mergeTicket(to.entity, to.meta, change, to.id);
  if (decision.kind !== 'upsert') return false;
  to.entity = wire(decision.entity);
  to.meta = { ...decision.version };
  return decision.version.d !== from.id;
}

/** Both devices pushed their latest write; deliver (and re-send) until quiet. */
function converge(a: Device, b: Device): number {
  const queue: Array<[Device, Device]> = [[a, b], [b, a]];
  let deliveries = 0;
  while (queue.length) {
    const [from, to] = queue.shift()!;
    deliveries += 1;
    if (deliveries > 10) throw new Error('sync did not converge (ping-pong)');
    if (deliver(from, to)) queue.push([to, from]);
  }
  return deliveries;
}

const device = (id: string, entity: SyncEntity): Device => ({ id, entity: wire(entity), meta: { u: entity.updatedAt as string, d: id } });

const strip = (entity: SyncEntity) => ({ ...entity, updatedAt: undefined });

describe('mergeTicket — consolidation release is explicit (consolidationRevision)', () => {
  it('a peer reprinting a stale COMPLETED copy (newer, no link) does NOT revert a CONSOLIDATED ticket', () => {
    const local = ticket({ status: 'CONSOLIDATED', invoiceId: 'inv_9', invoiceControlNumber: 'DTE-01-1-1', consolidatedAt: T1, updatedAt: T1 });
    const reprint = ticket({ printedCount: 1, updatedAt: T2 }); // what the peer still had
    const decision = mergeTicket(local, { u: T1, d: SELF }, remote(wire(reprint), T2), SELF);
    expect(decision.kind).toBe('upsert');
    if (decision.kind === 'upsert') {
      expect(decision.entity).toMatchObject({ status: 'CONSOLIDATED', invoiceId: 'inv_9', invoiceControlNumber: 'DTE-01-1-1', printedCount: 1 });
      // Our lattice contribution must travel back: attributed to US, strictly newer.
      expect(decision.version).toEqual({ u: plus1ms(T2), d: SELF });
    }
  });

  it('the same stale reprint converges both devices on CONSOLIDATED + the new print count', () => {
    const base = ticket({ updatedAt: T0 });
    const b = device(PEER, { ...base, status: 'CONSOLIDATED', invoiceId: 'inv_9', invoiceControlNumber: 'DTE-01-1-1', consolidatedAt: T1, updatedAt: T1 });
    const a = device(SELF, { ...base, printedCount: 1, updatedAt: T2 });
    converge(a, b);
    expect(strip(a.entity)).toEqual(strip(b.entity));
    expect(a.meta).toEqual(b.meta);
    expect(a.entity).toMatchObject({ status: 'CONSOLIDATED', invoiceId: 'inv_9', printedCount: 1 });
  });

  it('a release (revision bump) beats a newer stale CONSOLIDATED copy; both converge on COMPLETED without link', () => {
    const cons = ticket({ status: 'CONSOLIDATED', invoiceId: 'inv_9', invoiceControlNumber: 'DTE-01-1-1', consolidatedAt: T0, updatedAt: T0 });
    const b = device(PEER, { ...cons, status: 'COMPLETED', invoiceId: undefined, invoiceControlNumber: undefined, consolidatedAt: undefined, consolidationRevision: 1, updatedAt: T1 });
    const a = device(SELF, { ...cons, printedCount: 2, updatedAt: T2 }); // reprint after the release, before pulling it
    converge(a, b);
    expect(strip(a.entity)).toEqual(strip(b.entity));
    expect(a.entity.status).toBe('COMPLETED');
    expect(a.entity.consolidationRevision).toBe(1);
    expect(a.entity.printedCount).toBe(2);
    for (const field of ['invoiceId', 'invoiceControlNumber', 'consolidatedAt', 'pendingInvoiceId']) {
      expect(a.entity[field]).toBeUndefined();
    }
  });

  it('a pending reservation survives a newer link-less copy, but a release clears it', () => {
    const reserved = ticket({ pendingInvoiceId: 'draft_1', updatedAt: T1 });
    const stale = mergeTicket(reserved, { u: T1, d: SELF }, remote(wire(ticket({ printedCount: 1, updatedAt: T2 })), T2), SELF);
    expect(stale.kind === 'upsert' && stale.entity.pendingInvoiceId).toBe('draft_1');

    const released = mergeTicket(reserved, { u: T1, d: SELF }, remote(wire(ticket({ consolidationRevision: 1, updatedAt: T2 })), T2), SELF);
    expect(released.kind).toBe('upsert');
    if (released.kind === 'upsert') {
      expect(released.entity.pendingInvoiceId).toBeUndefined();
      expect(released.version.d).toBe(PEER); // nothing of ours to send back
    }
  });

  it('a re-consolidation after a release (same revision) beats the released copy', () => {
    const released = ticket({ consolidationRevision: 1, updatedAt: T2 });
    const decision = mergeTicket(
      released,
      { u: T2, d: SELF },
      remote(wire(ticket({ status: 'CONSOLIDATED', invoiceId: 'inv_10', consolidatedAt: T1, consolidationRevision: 1, updatedAt: T1 })), T1),
      SELF,
    );
    expect(decision.kind === 'upsert' && decision.entity.status).toBe('CONSOLIDATED');
    expect(decision.kind === 'upsert' && decision.entity.invoiceId).toBe('inv_10');
  });
});

describe('mergeTicket — lattice runs before the staleness check', () => {
  it('an OLDER remote VOID still voids a newer local COMPLETED (reprinted) copy, and is re-sent', () => {
    const local = ticket({ printedCount: 1, updatedAt: T2 });
    const voided = ticket({ status: 'VOID', voidedAt: T1, voidReason: 'cobro duplicado', updatedAt: T1 });
    const decision = mergeTicket(local, { u: T2, d: SELF }, remote(wire(voided), T1), SELF);
    expect(decision.kind).toBe('upsert');
    if (decision.kind === 'upsert') {
      expect(decision.entity).toMatchObject({ status: 'VOID', voidReason: 'cobro duplicado', voidedAt: T1, printedCount: 1 });
      expect(decision.version.d).toBe(SELF); // the peer lacks our print count
    }
  });

  it('void on B vs reprint on A converge (review scenario S1): both VOID, same content and version', () => {
    const base = ticket({ updatedAt: T0 });
    const b = device(PEER, { ...base, status: 'VOID', voidedAt: T1, voidReason: 'cobro duplicado', updatedAt: T1 });
    const a = device(SELF, { ...base, printedCount: 1, updatedAt: T2 });
    converge(a, b);
    expect(strip(a.entity)).toEqual(strip(b.entity));
    expect(a.meta).toEqual(b.meta);
    expect(b.entity).toMatchObject({ status: 'VOID', voidReason: 'cobro duplicado', printedCount: 1 });
  });

  it('an older remote CONSOLIDATED beats a newer local pending reservation on another draft (review S2)', () => {
    const local = ticket({ pendingInvoiceId: 'inv_2', updatedAt: T2 });
    const cons = ticket({ status: 'CONSOLIDATED', invoiceId: 'inv_1', invoiceControlNumber: 'DTE-01-1-1', consolidatedAt: T1, updatedAt: T1 });
    const decision = mergeTicket(local, { u: T2, d: SELF }, remote(wire(cons), T1), SELF);
    expect(decision.kind).toBe('upsert');
    if (decision.kind === 'upsert') {
      expect(decision.entity).toMatchObject({ status: 'CONSOLIDATED', invoiceId: 'inv_1' });
      expect(decision.entity.pendingInvoiceId).toBeUndefined();
      expect(decision.conflicts.some((c) => c.field === 'pendingInvoiceId')).toBe(true);
    }
  });

  it('a held VOID does not adopt a newer peer reservation (review S5)', () => {
    const local = ticket({ status: 'VOID', voidedAt: T1, voidReason: 'x', updatedAt: T1 });
    const decision = mergeTicket(local, { u: T1, d: SELF }, remote(wire(ticket({ pendingInvoiceId: 'inv_9', updatedAt: T2 })), T2), SELF);
    expect(decision.kind).toBe('upsert');
    if (decision.kind === 'upsert') {
      expect(decision.entity.status).toBe('VOID');
      expect(decision.entity.pendingInvoiceId).toBeUndefined();
      expect(decision.conflicts.some((c) => c.field === 'pendingInvoiceId')).toBe(true);
    }
  });

  it('concurrent VOID vs CONSOLIDATED: the consolidation (fiscal fact) wins, a VOID never keeps an invoice link (review S6)', () => {
    const cons = ticket({ status: 'CONSOLIDATED', invoiceId: 'inv_1', invoiceControlNumber: 'DTE-01-1-1', consolidatedAt: T1, updatedAt: T1 });
    const voided = ticket({ status: 'VOID', voidedAt: T2, voidReason: 'x', updatedAt: T2 });
    const onConsolidator = mergeTicket(cons, { u: T1, d: SELF }, remote(wire(voided), T2), SELF);
    expect(onConsolidator.kind).toBe('upsert');
    if (onConsolidator.kind === 'upsert') {
      expect(onConsolidator.entity).toMatchObject({ status: 'CONSOLIDATED', invoiceId: 'inv_1' });
      expect(onConsolidator.entity.voidReason).toBeUndefined();
      expect(onConsolidator.conflicts.some((c) => c.field === 'status')).toBe(true);
    }
    const a = device(SELF, cons);
    const b = device(PEER, voided);
    converge(a, b);
    expect(strip(a.entity)).toEqual(strip(b.entity));
    expect(b.entity).toMatchObject({ status: 'CONSOLIDATED', invoiceId: 'inv_1' });
  });

  it('two different invoices on one ticket: each keeps its own link, conflict surfaced, no ping-pong', () => {
    const a = device(SELF, ticket({ status: 'CONSOLIDATED', invoiceId: 'inv_A', consolidatedAt: T1, updatedAt: T1 }));
    const b = device(PEER, ticket({ status: 'CONSOLIDATED', invoiceId: 'inv_B', consolidatedAt: T2, updatedAt: T2 }));
    expect(converge(a, b)).toBeLessThanOrEqual(4);
    expect(a.entity.invoiceId).toBe('inv_A');
    expect(b.entity.invoiceId).toBe('inv_B');
  });

  it('an identical re-delivery is a no-op (idempotent)', () => {
    const local = ticket({ status: 'VOID', voidedAt: T1, voidReason: 'x', updatedAt: T3 });
    const decision = mergeTicket(local, { u: T3, d: SELF }, remote(wire(local), T3), SELF);
    // Same content, PEER > SELF wins the tie: adopting it changes nothing.
    expect(decision.kind === 'skip' || (decision.kind === 'upsert' && decision.version.d === PEER)).toBe(true);
  });
});

// ─── captureTicketChange ──────────────────────────────────────────────────

describe('captureTicketChange', () => {
  const setup = (tier: SubscriptionTier = SubscriptionTier.ProSync) => {
    const store = createSyncTestStore();
    store.dispatch(hydrateCompanies([makeCompany('company_1')]));
    store.dispatch(setTier(tier));
    return store;
  };

  const outboxOf = (store: ReturnType<typeof setup>) =>
    store.getState().syncV2.companies[CO]?.outbox ?? {};

  beforeEach(async () => {
    jest.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storage: any = require('@/services/storage/ElectronStorage');
    storage.appStorage.getItem.mockImplementation(async () => null);
    await TicketDatabase.deleteCompanyData('company_1');
  });

  it('a local ticket write lands in the outbox as a ticket envelope', async () => {
    const store = setup();
    const created = await TicketDatabase.create({
      companyId: 'company_1',
      items: [{ id: 'l1', productName: 'Café', quantity: 1, unitPrice: 3, lineTotal: 3 }],
      payments: [{ id: 'p1', method: 'EFECTIVO', amount: 3 }],
      totalAmount: 3,
      taxIncluded: 0.35,
    });

    captureTicketChange(store.getState as never, store.dispatch, {
      op: 'upsert',
      id: created.id,
      companyId: 'company_1',
      status: 'COMPLETED',
      updatedAt: created.updatedAt,
    });

    const outbox = outboxOf(store);
    expect(Object.keys(outbox)).toEqual([`ticket:${created.id}`]);
    expect(outbox[`ticket:${created.id}`]).toMatchObject({ t: 'ticket', op: 'upsert', u: created.updatedAt });
  });

  it('free / plain-Pro tiers capture nothing', async () => {
    const store = setup(SubscriptionTier.Pro);
    const created = await TicketDatabase.create({
      companyId: 'company_1',
      items: [],
      payments: [],
      totalAmount: 0,
      taxIncluded: 0,
    });

    captureTicketChange(store.getState as never, store.dispatch, {
      op: 'upsert',
      id: created.id,
      companyId: 'company_1',
      status: 'COMPLETED',
      updatedAt: created.updatedAt,
    });

    expect(Object.keys(outboxOf(store))).toHaveLength(0);
  });
});

// ─── Local-write change events (sync capture + UI refresh ride on these) ───

describe('TicketDatabase local-write change events', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storage: any = require('@/services/storage/ElectronStorage');
    storage.appStorage.getItem.mockImplementation(async () => null);
    await TicketDatabase.deleteCompanyData('company_1');
  });

  const makeTicket = async () => TicketDatabase.create({
    companyId: 'company_1',
    items: [{ id: 'l1', productName: 'Café', quantity: 1, unitPrice: 3, lineTotal: 3 }],
    payments: [{ id: 'p1', method: 'EFECTIVO', amount: 3 }],
    totalAmount: 3,
    taxIncluded: 0.35,
  });

  it('incrementPrinted emits an upsert change event', async () => {
    const created = await makeTicket();
    const events: TicketChangeEvent[] = [];
    const listener = (event: TicketChangeEvent) => events.push(event);
    TicketDatabase.setChangeListener(listener);
    try {
      await TicketDatabase.incrementPrinted('company_1', created.id);
    } finally {
      TicketDatabase.removeChangeListener(listener);
    }
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ op: 'upsert', id: created.id, companyId: 'company_1' });
    // >= : now() has ms precision and a fast test can land in the same tick.
    expect(events[0].updatedAt >= created.updatedAt).toBe(true);
  });

  it('markPendingConsolidation emits an upsert per reserved ticket', async () => {
    const first = await makeTicket();
    const second = await makeTicket();
    const events: TicketChangeEvent[] = [];
    const listener = (event: TicketChangeEvent) => events.push(event);
    TicketDatabase.setChangeListener(listener);
    try {
      const count = await TicketDatabase.markPendingConsolidation('company_1', [first.id, second.id], 'inv-draft-1');
      expect(count).toBe(2);
    } finally {
      TicketDatabase.removeChangeListener(listener);
    }
    expect(events.map((e) => e.id).sort()).toEqual([first.id, second.id].sort());
    expect(events.every((e) => e.op === 'upsert')).toBe(true);
  });
});

// ─── TicketDatabase relay writes ───────────────────────────────────────────

describe('TicketDatabase relay writes', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storage: any = require('@/services/storage/ElectronStorage');
    storage.appStorage.getItem.mockImplementation(async () => null);
    await TicketDatabase.deleteCompanyData('company_1');
  });

  it('upsertFromSync lands verbatim and never emits a change event', async () => {
    const events: string[] = [];
    const listener = (e: { op: string }) => events.push(e.op);
    TicketDatabase.setChangeListener(listener);
    const incoming = ticket({ id: 'tkt_peer', sequential: 7, updatedAt: T1 }) as unknown as Ticket;
    await TicketDatabase.upsertFromSync(incoming);
    TicketDatabase.removeChangeListener(listener);

    const stored = await TicketDatabase.getTicket('company_1', 'tkt_peer');
    expect(stored).toMatchObject({ id: 'tkt_peer', sequential: 7, status: 'COMPLETED' });
    expect(events).toHaveLength(0); // applied remote changes must never echo
  });

  it('upsertFromSync can re-target a matched local record, keeping the local id', async () => {
    const local = await TicketDatabase.create({
      companyId: 'company_1',
      items: [],
      payments: [],
      totalAmount: 0,
      taxIncluded: 0,
    });
    const incoming = ticket({ sequential: 99, customerName: 'Ana', updatedAt: T1 }) as unknown as Ticket;
    await TicketDatabase.upsertFromSync(incoming, local.id);

    const stored = await TicketDatabase.getTicket('company_1', local.id);
    expect(stored?.id).toBe(local.id);
    expect(stored?.customerName).toBe('Ana');
  });

  it('upsertFromSync replaces wholesale: a peer release (cleared link/reservation) reaches this device', async () => {
    await TicketDatabase.upsertFromSync(ticket({
      id: 'tkt_rel', sequential: 5, status: 'CONSOLIDATED', invoiceId: 'inv_1', invoiceControlNumber: 'DTE-01-1-1', consolidatedAt: T1, updatedAt: T1,
    }) as unknown as Ticket);
    await TicketDatabase.upsertFromSync(ticket({ id: 'tkt_res', sequential: 6, pendingInvoiceId: 'draft_1', updatedAt: T1 }) as unknown as Ticket);

    // JSON on the wire drops the cleared (undefined) keys.
    await TicketDatabase.upsertFromSync(wire(ticket({ id: 'tkt_rel', sequential: 5, consolidationRevision: 1, invoiceId: undefined, updatedAt: T2 })) as unknown as Ticket, 'tkt_rel');
    await TicketDatabase.upsertFromSync(wire(ticket({ id: 'tkt_res', sequential: 6, consolidationRevision: 1, updatedAt: T2 })) as unknown as Ticket, 'tkt_res');

    const released = await TicketDatabase.getTicket('company_1', 'tkt_rel');
    expect(released).toMatchObject({ status: 'COMPLETED', consolidationRevision: 1 });
    expect(released?.invoiceId).toBeUndefined();
    expect(released?.invoiceControlNumber).toBeUndefined();
    expect(released?.consolidatedAt).toBeUndefined();
    expect((await TicketDatabase.getTicket('company_1', 'tkt_res'))?.pendingInvoiceId).toBeUndefined();
    const pool = (await TicketDatabase.getUnconsolidated('company_1')).map((t) => t.id).sort();
    expect(pool).toEqual(['tkt_rel', 'tkt_res']);
  });

  it('deleteFromSync removes across cached companies', async () => {
    const created = await TicketDatabase.create({
      companyId: 'company_1',
      items: [],
      payments: [],
      totalAmount: 0,
      taxIncluded: 0,
    });
    await TicketDatabase.deleteFromSync(created.id);
    expect(await TicketDatabase.getTicket('company_1', created.id)).toBeNull();
  });
});

// ─── POS Phase 2: partial returns travel as a union by id ─────────────────

describe('mergeTicket — partial returns (union by id, write-once entries)', () => {
  const item = { id: 'l1', productId: 'A', productName: 'Pan', quantity: 3, unitPrice: 2, lineTotal: 6 };
  const ret = (id: string, at: string, qty = 1) => ({
    id,
    createdAt: at,
    createdBy: 'Ana',
    reason: 'dañado',
    lines: [{ lineId: 'l1', quantity: qty, amount: 2 * qty }],
    refund: { method: 'EFECTIVO', amount: 2 * qty },
  });
  const base = ticket({ items: [item], updatedAt: T0 });

  it('two devices each register a return concurrently → both converge on both returns, same content and version', () => {
    const a = device(SELF, { ...base, returns: [ret('ret_a', T1)], updatedAt: T1 });
    const b = device(PEER, { ...base, returns: [ret('ret_b', T2)], updatedAt: T2 });
    converge(a, b);
    expect(strip(a.entity)).toEqual(strip(b.entity));
    expect(a.meta).toEqual(b.meta);
    expect((a.entity.returns as Array<{ id: string }>).map((r) => r.id)).toEqual(['ret_a', 'ret_b']);
  });

  it('a stale copy without the return never drops it (newer reprint from the peer)', () => {
    const local = ticket({ items: [item], returns: [ret('ret_a', T1)], updatedAt: T1 });
    const decision = mergeTicket(local, { u: T1, d: SELF }, remote(wire(ticket({ items: [item], printedCount: 1, updatedAt: T2 })), T2), SELF);
    expect(decision.kind).toBe('upsert');
    if (decision.kind === 'upsert') {
      expect((decision.entity.returns as unknown[]).length).toBe(1);
      expect(decision.entity.printedCount).toBe(1);
      expect(decision.version.d).toBe(SELF); // the peer lacks our return: re-send
    }
  });

  it('the same return delivered twice stays one entry (idempotent), tickets without returns stay without the field', () => {
    const local = ticket({ items: [item], returns: [ret('ret_a', T1)], updatedAt: T1 });
    const decision = mergeTicket(local, { u: T1, d: SELF }, remote(wire(local), T1), SELF);
    expect(decision.kind === 'skip' || (decision.kind === 'upsert' && (decision.entity.returns as unknown[]).length === 1)).toBe(true);
    const plain = mergeTicket(ticket({ updatedAt: T1 }), { u: T1, d: SELF }, remote(wire(ticket({ printedCount: 2, updatedAt: T2 })), T2), SELF);
    expect(plain.kind === 'upsert' && 'returns' in plain.entity).toBe(false);
  });

  it('a return the voiding device never saw is kept and surfaced as a conflict; both converge', () => {
    const a = device(SELF, { ...base, status: 'VOID', voidedAt: T2, voidReason: 'error', updatedAt: T2 });
    const b = device(PEER, { ...base, returns: [ret('ret_b', T1)], updatedAt: T1 });
    const decision = mergeTicket(a.entity, a.meta, { op: 'upsert', u: b.meta.u, d: b.id, entity: wire(b.entity) }, SELF);
    expect(decision.kind).toBe('upsert');
    if (decision.kind === 'upsert') {
      expect(decision.entity.status).toBe('VOID');
      expect((decision.entity.returns as unknown[]).length).toBe(1);
      expect(decision.conflicts.some((c) => c.field === 'returns')).toBe(true);
    }
    converge(a, b);
    expect(strip(a.entity)).toEqual(strip(b.entity));
  });

  it('a return synced before the void is not a conflict', () => {
    const withReturn = { ...base, returns: [ret('ret_a', T1)], updatedAt: T1 };
    const voided = { ...withReturn, status: 'VOID', voidedAt: T2, voidReason: 'x', updatedAt: T2 };
    const decision = mergeTicket(withReturn, { u: T1, d: SELF }, remote(wire(voided), T2), SELF);
    expect(decision.kind === 'upsert' && decision.conflicts.some((c) => c.field === 'returns')).toBe(false);
  });
});

describe('TicketDatabase.addReturn', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storage: any = require('@/services/storage/ElectronStorage');
    storage.appStorage.getItem.mockImplementation(async () => null);
    await TicketDatabase.deleteCompanyData('company_1');
  });

  it('appends the return, emits kind "return" (captured like any upsert), is idempotent and refuses invoiced tickets', async () => {
    const created = await TicketDatabase.create({
      companyId: 'company_1',
      items: [{ id: 'l1', productId: 'A', productName: 'Pan', quantity: 3, unitPrice: 2, lineTotal: 6 }],
      payments: [{ id: 'p1', method: 'EFECTIVO', amount: 6 }],
      totalAmount: 6,
      taxIncluded: 0.69,
    });
    const events: TicketChangeEvent[] = [];
    const listener = (event: TicketChangeEvent) => events.push(event);
    TicketDatabase.setChangeListener(listener);
    const entry = {
      id: 'ret_1',
      createdAt: new Date().toISOString(),
      reason: 'dañado',
      lines: [{ lineId: 'l1', quantity: 1, amount: 2 }],
      refund: { method: 'EFECTIVO' as const, amount: 2 },
    };
    try {
      const updated = await TicketDatabase.addReturn('company_1', created.id, entry);
      expect(updated.returns).toHaveLength(1);
      await TicketDatabase.addReturn('company_1', created.id, entry);
      expect((await TicketDatabase.getTicket('company_1', created.id))!.returns).toHaveLength(1);
      await expect(TicketDatabase.addReturn('company_1', created.id, { ...entry, id: 'ret_2', lines: [{ lineId: 'l1', quantity: 3, amount: 6 }] }))
        .rejects.toThrow(/Solo quedan 2/);
      await TicketDatabase.markPendingConsolidation('company_1', [created.id], 'inv_1');
      await TicketDatabase.markConsolidated('company_1', 'inv_1', 'DTE-01-1');
      await expect(TicketDatabase.addReturn('company_1', created.id, { ...entry, id: 'ret_3' }))
        .rejects.toThrow(/nota de crédito sobre la factura/);
    } finally {
      TicketDatabase.removeChangeListener(listener);
    }
    expect(events.filter((e) => e.kind === 'return')).toHaveLength(1);
    expect(events.find((e) => e.kind === 'return')).toMatchObject({ op: 'upsert', id: created.id, companyId: 'company_1' });
  });
});
