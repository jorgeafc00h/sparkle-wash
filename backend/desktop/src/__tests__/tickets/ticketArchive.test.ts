// Ticket archive (POS Phase 2 design §9): final tickets older than the
// current + previous month move to per-month keys; every read path, invoice
// links and Device Sync keep seeing them; nothing is ever lost — including
// when a write fails half-way through a pass.

jest.mock('@/services/storage/ElectronStorage', () => {
  const map = new Map<string, string>();
  return {
    appStorage: {
      getItem: jest.fn(async (key: string) => (map.has(key) ? map.get(key)! : null)),
      setItem: jest.fn(async (key: string, value: string) => {
        map.set(key, value);
      }),
      removeItem: jest.fn(async (key: string) => {
        map.delete(key);
      }),
      getAllKeys: jest.fn(async () => Array.from(map.keys())),
    },
    __map: map,
  };
});

import { TicketDatabase } from '@/services/tickets/TicketDatabase';
import {
  archiveMonthsForRange,
  hotWindowStart,
  isArchivable,
  partitionForArchive,
  shiftMonthKey,
  svMonthKey,
} from '@/services/tickets/ticketArchive';
import { buildDigest } from '@/services/sync/digestService';
import type { Ticket } from '@/types/ticket';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const storage: any = require('@/services/storage/ElectronStorage');
const map: Map<string, string> = storage.__map;

const CO = 'co-arch';
const NOW = new Date('2026-11-15T18:00:00.000Z');
const HOT_START = '2026-10-01T06:00:00.000Z';

function ticket(id: string, over: Partial<Ticket>): Ticket {
  const at = over.createdAt ?? '2026-07-10T15:00:00.000Z';
  return {
    id,
    companyId: CO,
    sequential: Number(id.replace(/\D/g, '')) || 1,
    status: 'COMPLETED',
    items: [{ id: `${id}_l1`, productName: 'Café', quantity: 2, unitPrice: 3, lineTotal: 6 }],
    payments: [{ id: `${id}_p1`, method: 'EFECTIVO', amount: 6 }],
    totalAmount: 6,
    taxIncluded: 0.69,
    createdAt: at,
    completedAt: at,
    printedCount: 0,
    updatedAt: at,
    ...over,
  };
}

/** A legacy single-key DB as written by builds before the archive existed. */
function seedLegacy(tickets: Ticket[]) {
  map.set(`tickets_db_${CO}`, JSON.stringify({ tickets, closings: [], sequential: tickets.length }));
}

const hotOnDisk = (): { tickets: Ticket[]; archive?: { ids: Record<string, string>; invoices: Record<string, string[]> } } =>
  JSON.parse(map.get(`tickets_db_${CO}`)!);
const monthOnDisk = (month: string): Ticket[] => JSON.parse(map.get(`tickets_archive_${CO}_${month}`) ?? '{"tickets":[]}').tickets;
const digestOf = (tickets: Ticket[]) => buildDigest('ticket', tickets.map((t) => ({ key: t.id, u: t.updatedAt })));

const A = ticket('tkt_a1', {
  status: 'CONSOLIDATED', invoiceId: 'inv_old', invoiceControlNumber: 'DTE-01-OLD', consolidatedAt: '2026-07-11T10:00:00.000Z', updatedAt: '2026-07-11T10:00:00.000Z',
});
const B = ticket('tkt_b2', {
  status: 'VOID', createdAt: '2026-08-20T15:00:00.000Z', completedAt: '2026-08-20T15:00:00.000Z', voidedAt: '2026-08-20T16:00:00.000Z', voidReason: 'error', updatedAt: '2026-08-20T16:00:00.000Z',
});
const C = ticket('tkt_c3', { createdAt: '2026-07-01T15:00:00.000Z', completedAt: '2026-07-01T15:00:00.000Z', updatedAt: '2026-07-01T15:00:00.000Z' });
const D = ticket('tkt_d4', { status: 'CONSOLIDATED', invoiceId: 'inv_new', createdAt: '2026-10-05T15:00:00.000Z', completedAt: '2026-10-05T15:00:00.000Z', updatedAt: '2026-10-06T15:00:00.000Z' });
// Sold in July, voided last week: a refund of the current Z — must stay hot.
const E = ticket('tkt_e5', { status: 'VOID', voidedAt: '2026-11-05T15:00:00.000Z', updatedAt: '2026-11-05T15:00:00.000Z' });
const F = ticket('tkt_f6', { status: 'OPEN', completedAt: undefined, payments: [] });
const ALL = [A, B, C, D, E, F];

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined); // expected in the crash cases
  map.clear();
  TicketDatabase.resetMemoryForTests();
  TicketDatabase.setClockForTests(() => NOW);
  storage.appStorage.setItem.mockImplementation(async (key: string, value: string) => {
    map.set(key, value);
  });
});

afterEach(() => jest.restoreAllMocks());
afterAll(() => TicketDatabase.setClockForTests(null));

describe('partitioning (pure)', () => {
  it('hot window = current + previous El Salvador month', () => {
    expect(hotWindowStart(NOW)).toBe(HOT_START);
    // Nov 1 at 01:00 SV is still November; Oct 31 23:30 SV (05:30Z Nov 1) is October.
    expect(hotWindowStart(new Date('2026-11-01T07:00:00.000Z'))).toBe('2026-10-01T06:00:00.000Z');
    expect(hotWindowStart(new Date('2026-11-01T05:30:00.000Z'))).toBe('2026-09-01T06:00:00.000Z');
    expect(hotWindowStart(new Date('2026-01-20T12:00:00.000Z'))).toBe('2025-12-01T06:00:00.000Z');
    expect(svMonthKey('2026-08-01T03:00:00.000Z')).toBe('2026-07'); // 21:00 SV Jul 31
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12');
    expect(shiftMonthKey('2026-12', 1)).toBe('2027-01');
  });

  it('archives only final tickets whose sale AND last change are older than the window', () => {
    expect(isArchivable(A, HOT_START)).toBe(true);
    expect(isArchivable(B, HOT_START)).toBe(true);
    expect(isArchivable(C, HOT_START)).toBe(false); // COMPLETED (still consolidable)
    expect(isArchivable(D, HOT_START)).toBe(false); // inside the window
    expect(isArchivable(E, HOT_START)).toBe(false); // changed recently
    expect(isArchivable(F, HOT_START)).toBe(false); // OPEN
    expect(isArchivable({ ...A, pendingInvoiceId: 'draft' }, HOT_START)).toBe(false);
    // Fully returned (design §8) is final too.
    const returned = ticket('tkt_r9', {
      returns: [{ id: 'ret1', createdAt: '2026-07-12T10:00:00.000Z', createdBy: 'Ana', reason: 'x', lines: [{ lineId: 'tkt_r9_l1', quantity: 2, amount: 6 }], refund: { method: 'EFECTIVO', amount: 6 } }],
      updatedAt: '2026-07-12T10:00:00.000Z',
    } as Partial<Ticket>);
    expect(isArchivable(returned, HOT_START)).toBe(true);
    const { hot, byMonth } = partitionForArchive(ALL, HOT_START);
    expect(hot.map((t) => t.id)).toEqual(['tkt_c3', 'tkt_d4', 'tkt_e5', 'tkt_f6']);
    expect(Array.from(byMonth.keys()).sort()).toEqual(['2026-07', '2026-08']);
  });

  it('a date range reads the archived months it reaches (±1 month padding)', () => {
    const months = ['2026-05', '2026-07', '2026-08'];
    expect(archiveMonthsForRange(months, '2026-07-01T06:00:00.000Z', '2026-08-01T05:59:59.999Z')).toEqual(['2026-07', '2026-08']);
    expect(archiveMonthsForRange(months, '2026-10-01T06:00:00.000Z', '2026-11-30T06:00:00.000Z')).toEqual([]);
    // Open lower bound: every month up to the padded upper one (June + 1).
    expect(archiveMonthsForRange(months, undefined, '2026-06-15T00:00:00.000Z')).toEqual(['2026-05', '2026-07']);
  });
});

describe('TicketDatabase archive', () => {
  it('migrates a legacy single-key DB lazily on first load: hot shrinks, months get the final tickets', async () => {
    seedLegacy(ALL);
    const hot = await TicketDatabase.getTickets({ companyId: CO });
    expect(hot.map((t) => t.id).sort()).toEqual(['tkt_c3', 'tkt_d4', 'tkt_e5', 'tkt_f6']);

    const disk = hotOnDisk();
    expect(disk.tickets.map((t) => t.id).sort()).toEqual(['tkt_c3', 'tkt_d4', 'tkt_e5', 'tkt_f6']);
    expect(disk.archive!.ids).toEqual({ tkt_a1: '2026-07', tkt_b2: '2026-08' });
    expect(disk.archive!.invoices).toEqual({ inv_old: ['2026-07'] });
    expect(monthOnDisk('2026-07').map((t) => t.id)).toEqual(['tkt_a1']);
    expect(monthOnDisk('2026-08').map((t) => t.id)).toEqual(['tkt_b2']);
    expect(await TicketDatabase.getArchiveSummary(CO)).toEqual({ '2026-07': 1, '2026-08': 1 });
  });

  it('archived tickets stay reachable: by id, by invoice, by date range, and in counts', async () => {
    seedLegacy(ALL);
    expect(await TicketDatabase.getTicket(CO, 'tkt_a1')).toMatchObject({ id: 'tkt_a1', status: 'CONSOLIDATED' });
    expect((await TicketDatabase.getTicketsByIds(CO, ['tkt_a1', 'tkt_c3', 'tkt_b2'])).map((t) => t.id).sort()).toEqual(['tkt_a1', 'tkt_b2', 'tkt_c3']);
    expect((await TicketDatabase.getByInvoiceId(CO, 'inv_old')).map((t) => t.id)).toEqual(['tkt_a1']);
    const july = await TicketDatabase.getTickets({ companyId: CO, from: '2026-07-01T06:00:00.000Z', to: '2026-08-01T05:59:59.999Z' });
    expect(july.map((t) => t.id).sort()).toEqual(['tkt_a1', 'tkt_c3', 'tkt_e5', 'tkt_f6']);
    expect(await TicketDatabase.getCount(CO)).toBe(6);
    // Search on the display number works for archived tickets too.
    const found = await TicketDatabase.getTickets({ companyId: CO, includeArchived: true, searchTerm: '#000002' });
    expect(found.map((t) => t.id)).toEqual(['tkt_b2']);
  });

  it('Device Sync lists hot + archived: the digest equals the never-archived peer', async () => {
    const peerDigest = digestOf(ALL);
    seedLegacy(ALL);
    await TicketDatabase.getTickets({ companyId: CO }); // runs the pass
    expect(Object.keys(hotOnDisk().archive!.ids)).toHaveLength(2);
    const listed = await TicketDatabase.listAllForSync(CO);
    expect(listed).toHaveLength(6);
    expect(digestOf(listed)).toEqual(peerDigest);
  });

  it('an archived ticket that changes moves back to the hot DB (reprint, release)', async () => {
    seedLegacy(ALL);
    await TicketDatabase.incrementPrinted(CO, 'tkt_b2');
    let disk = hotOnDisk();
    expect(disk.tickets.find((t) => t.id === 'tkt_b2')?.printedCount).toBe(1);
    expect(disk.archive!.ids.tkt_b2).toBeUndefined();

    // Invalidating the old invoice releases its archived ticket.
    const released = await TicketDatabase.releaseConsolidation(CO, 'inv_old');
    expect(released.map((t) => t.id)).toEqual(['tkt_a1']);
    disk = hotOnDisk();
    expect(disk.tickets.find((t) => t.id === 'tkt_a1')).toMatchObject({ status: 'COMPLETED', consolidationRevision: 1 });
    expect(disk.archive!.ids).toEqual({});
    expect(await TicketDatabase.getUnconsolidated(CO)).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'tkt_a1' })]));
    // Leftover blob copies are ignored: the ticket is listed exactly once.
    const listed = await TicketDatabase.listAllForSync(CO);
    expect(listed.filter((t) => t.id === 'tkt_a1')).toHaveLength(1);
    expect(listed).toHaveLength(6);
  });

  it('a fully returned ticket is archived, and a return call on it brings it back to the hot DB', async () => {
    const ret = { id: 'ret1', createdAt: '2026-07-12T10:00:00.000Z', createdBy: 'Ana', reason: 'dañado', lines: [{ lineId: 'tkt_r9_l1', quantity: 2, amount: 6 }], refund: { method: 'EFECTIVO' as const, amount: 6 } };
    const returned = ticket('tkt_r9', { returns: [ret], updatedAt: '2026-07-12T10:00:00.000Z' });
    seedLegacy([returned, C]);
    await TicketDatabase.getTickets({ companyId: CO });
    expect(hotOnDisk().archive!.ids).toEqual({ tkt_r9: '2026-07' });
    // Replaying the same (write-once) return is idempotent and moves it back to hot.
    const again = await TicketDatabase.addReturn(CO, 'tkt_r9', ret);
    expect(again.returns).toHaveLength(1);
    expect((await TicketDatabase.getTickets({ companyId: CO })).map((t) => t.id).sort()).toEqual(['tkt_c3', 'tkt_r9']);
    expect(await TicketDatabase.listAllForSync(CO)).toHaveLength(2);
  });

  it('upsertFromSync writes an old final ticket into its month, and a fresh change into the hot DB', async () => {
    seedLegacy([C]);
    const peerOld = ticket('tkt_p7', { status: 'VOID', voidedAt: '2026-06-02T10:00:00.000Z', createdAt: '2026-06-01T10:00:00.000Z', completedAt: '2026-06-01T10:00:00.000Z', updatedAt: '2026-06-02T10:00:00.000Z', sequential: 40 });
    await TicketDatabase.upsertFromSync(peerOld);
    expect(hotOnDisk().tickets.map((t) => t.id)).toEqual(['tkt_c3']);
    expect(hotOnDisk().archive!.ids).toEqual({ tkt_p7: '2026-06' });
    expect(monthOnDisk('2026-06').map((t) => t.id)).toEqual(['tkt_p7']);
    expect(await TicketDatabase.getTicket(CO, 'tkt_p7')).toMatchObject({ sequential: 40 });

    // The peer reprints it today → newer copy, back to hot, never in both.
    await TicketDatabase.upsertFromSync({ ...peerOld, printedCount: 1, updatedAt: '2026-11-14T10:00:00.000Z' }, 'tkt_p7');
    expect(hotOnDisk().tickets.map((t) => t.id).sort()).toEqual(['tkt_c3', 'tkt_p7']);
    expect(hotOnDisk().archive!.ids).toEqual({});
    const listed = await TicketDatabase.listAllForSync(CO);
    expect(listed.map((t) => t.id).sort()).toEqual(['tkt_c3', 'tkt_p7']);
    expect(listed.find((t) => t.id === 'tkt_p7')?.printedCount).toBe(1);
  });

  it('crash safety: a failed hot write after the month write loses nothing and duplicates nothing', async () => {
    seedLegacy(ALL);
    const legacy = map.get(`tickets_db_${CO}`);
    storage.appStorage.setItem.mockImplementation(async (key: string, value: string) => {
      if (key === `tickets_db_${CO}`) throw new Error('disk full');
      map.set(key, value);
    });

    // The pass wrote the month blobs first, then failed on the hot DB.
    const hot = await TicketDatabase.getTickets({ companyId: CO });
    expect(hot).toHaveLength(6); // everything still served from the hot DB
    expect(map.get(`tickets_db_${CO}`)).toBe(legacy); // hot key untouched
    expect(monthOnDisk('2026-07').map((t) => t.id)).toEqual(['tkt_a1']); // unindexed leftover
    expect(await TicketDatabase.listAllForSync(CO)).toHaveLength(6);

    // Restart with a healthy disk: the pass completes, still 6 tickets, once each.
    storage.appStorage.setItem.mockImplementation(async (key: string, value: string) => {
      map.set(key, value);
    });
    TicketDatabase.resetMemoryForTests();
    const listed = await TicketDatabase.listAllForSync(CO);
    expect(listed.map((t) => t.id).sort()).toEqual(ALL.map((t) => t.id).sort());
    expect(hotOnDisk().archive!.ids).toEqual({ tkt_a1: '2026-07', tkt_b2: '2026-08' });
    expect(monthOnDisk('2026-07').map((t) => t.id)).toEqual(['tkt_a1']); // rewritten, not doubled
  });

  it('crash safety: a failed month write leaves every ticket in the hot DB', async () => {
    seedLegacy(ALL);
    storage.appStorage.setItem.mockImplementation(async (key: string, value: string) => {
      if (key === `tickets_archive_${CO}_2026-08`) throw new Error('disk full');
      map.set(key, value);
    });
    const hot = await TicketDatabase.getTickets({ companyId: CO });
    expect(hot).toHaveLength(6);
    expect(map.get(`tickets_db_${CO}`)).toBe(JSON.stringify({ tickets: ALL, closings: [], sequential: 6 }));
    expect(await TicketDatabase.getArchiveSummary(CO)).toEqual({});
  });

  it('a sale keeps working on top of an archived DB and the next sequential continues', async () => {
    seedLegacy(ALL);
    const sale = await TicketDatabase.create({
      companyId: CO,
      items: [{ id: 'l1', productName: 'Pan', quantity: 1, unitPrice: 1, lineTotal: 1 }],
      payments: [{ id: 'p1', method: 'EFECTIVO', amount: 1 }],
      totalAmount: 1,
      taxIncluded: 0.12,
      registerId: 'device-1',
      registerCode: 'C1',
    });
    expect(sale.sequential).toBe(7);
    expect(sale).toMatchObject({ registerId: 'device-1', registerCode: 'C1' });
    expect(hotOnDisk().archive!.ids).toEqual({ tkt_a1: '2026-07', tkt_b2: '2026-08' });
    expect(await TicketDatabase.getCount(CO)).toBe(7);
  });

  it('archiveFinalTickets (after a Z / month roll-over) moves tickets that just left the window', async () => {
    seedLegacy([D]);
    expect(await TicketDatabase.archiveFinalTickets(CO)).toBe(0); // October is still hot in November
    expect(await TicketDatabase.archiveFinalTickets(CO, new Date('2026-12-02T12:00:00.000Z'))).toBe(1);
    expect(hotOnDisk().tickets).toEqual([]);
    expect(hotOnDisk().archive!.ids).toEqual({ tkt_d4: '2026-10' });
    expect((await TicketDatabase.getByInvoiceId(CO, 'inv_new')).map((t) => t.id)).toEqual(['tkt_d4']);
  });

  it('deleteCompanyData removes the archive months too', async () => {
    seedLegacy(ALL);
    await TicketDatabase.getTickets({ companyId: CO });
    map.set(`tickets_archive_${CO}_2026-03`, '{"tickets":[]}'); // leftover of an interrupted pass
    await TicketDatabase.deleteCompanyData(CO);
    expect(Array.from(map.keys()).filter((k) => k.includes(CO))).toEqual([]);
  });

  it('suspended sale: OPEN ticket completed in place keeps id/number; patch lands with the status change', async () => {
    const open = await TicketDatabase.create({
      companyId: CO,
      items: [{ id: 'l1', productName: 'Pan', quantity: 2, unitPrice: 1, lineTotal: 2 }],
      payments: [],
      totalAmount: 2,
      taxIncluded: 0.23,
      discountPct: 10,
      complete: false,
    });
    expect(open).toMatchObject({ status: 'OPEN', discountPct: 10 });
    expect(open.completedAt).toBeUndefined();
    const done = await TicketDatabase.complete(CO, open.id, {
      payments: [{ id: 'p1', method: 'TARJETA_POS', amount: 1 }, { id: 'p2', method: 'EFECTIVO', amount: 1, tendered: 5, change: 4 }],
      cashierName: 'Ana',
    });
    expect(done).toMatchObject({ id: open.id, sequential: open.sequential, status: 'COMPLETED', cashierName: 'Ana' });
    expect(done!.payments).toHaveLength(2);
    expect(done!.completedAt).toBeTruthy();
  });
});
