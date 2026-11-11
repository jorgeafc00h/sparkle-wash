// TicketDatabase — status lattice, consolidation link/release, closings.

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

import { TICKET_PENDING_VOID_MESSAGE, TicketDatabase, canTransition } from '@/services/tickets/TicketDatabase';
import type { Ticket } from '@/types/ticket';

const COMPANY = 'co-1';

function makeTicketInput(over: Partial<Parameters<typeof TicketDatabase.create>[0]> = {}) {
  return {
    companyId: COMPANY,
    items: [{ id: 'l1', productName: 'Café', quantity: 2, unitPrice: 3, lineTotal: 6 }],
    payments: [{ id: 'p1', method: 'EFECTIVO' as const, amount: 6, tendered: 10, change: 4 }],
    totalAmount: 6,
    taxIncluded: 0.69,
    ...over,
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  // Reset BOTH the mocked storage map and the database's module-level cache
  // (tickets from earlier suites would otherwise leak across tests).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storage: any = require('@/services/storage/ElectronStorage');
  storage.__map.clear();
  await TicketDatabase.deleteCompanyData(COMPANY);
});

describe('status lattice', () => {
  it('allows the documented transitions only', () => {
    expect(canTransition('OPEN', 'COMPLETED')).toBe(true);
    expect(canTransition('OPEN', 'VOID')).toBe(true);
    expect(canTransition('COMPLETED', 'VOID')).toBe(true);
    expect(canTransition('COMPLETED', 'CONSOLIDATED')).toBe(true);
    expect(canTransition('CONSOLIDATED', 'COMPLETED')).toBe(true); // revert path
    expect(canTransition('VOID', 'COMPLETED')).toBe(false);
    expect(canTransition('OPEN', 'CONSOLIDATED')).toBe(false);
  });
});

describe('create / sequential', () => {
  it('completes by default and increments the per-company counter', async () => {
    const t1 = await TicketDatabase.create(makeTicketInput());
    const t2 = await TicketDatabase.create(makeTicketInput());
    expect(t1.status).toBe('COMPLETED');
    expect(t1.completedAt).toBeTruthy();
    expect(t2.sequential).toBe(t1.sequential + 1);
  });

  it('completes a card sale with no datáfono details, or only a voucher reference', async () => {
    const bare = await TicketDatabase.create(
      makeTicketInput({ payments: [{ id: 'p1', method: 'TARJETA_POS' as const, amount: 6 }] }),
    );
    expect(bare.status).toBe('COMPLETED');
    expect(bare.payments[0].posLast4).toBeUndefined();
    const ref = await TicketDatabase.create(
      makeTicketInput({
        payments: [{ id: 'p1', method: 'TARJETA_POS' as const, amount: 6, posReference: 'V-889' }],
      }),
    );
    expect(ref.status).toBe('COMPLETED');
    expect(ref.payments[0].posReference).toBe('V-889');
  });

  it('can stay OPEN (parked cart)', async () => {
    const t = await TicketDatabase.create(makeTicketInput({ complete: false }));
    expect(t.status).toBe('OPEN');
    expect(t.completedAt).toBeUndefined();
  });
});

describe('void', () => {
  it('voids a COMPLETED ticket with a reason', async () => {
    const t = await TicketDatabase.create(makeTicketInput());
    const voided = await TicketDatabase.void(COMPANY, t.id, 'error de cobro');
    expect(voided?.status).toBe('VOID');
    expect(voided?.voidReason).toBe('error de cobro');
  });

  it('refuses to void a CONSOLIDATED ticket (NC territory)', async () => {
    const t = await TicketDatabase.create(makeTicketInput());
    await TicketDatabase.markPendingConsolidation(COMPANY, [t.id], 'inv_x');
    await TicketDatabase.markConsolidated(COMPANY, 'inv_x', 'DTE-01-1-1');
    await expect(TicketDatabase.void(COMPANY, t.id, 'x')).rejects.toThrow(/consolidado/);
  });

  it('refuses to void a ticket reserved by a consolidation draft (pendingInvoiceId)', async () => {
    const t = await TicketDatabase.create(makeTicketInput());
    await TicketDatabase.markPendingConsolidation(COMPANY, [t.id], 'draft_1');
    await expect(TicketDatabase.void(COMPANY, t.id, 'x')).rejects.toThrow(TICKET_PENDING_VOID_MESSAGE);
    expect((await TicketDatabase.getTicket(COMPANY, t.id))?.status).toBe('COMPLETED');
    // Once the draft is gone (released), voiding works again.
    await TicketDatabase.releaseConsolidation(COMPANY, 'draft_1');
    expect((await TicketDatabase.void(COMPANY, t.id, 'x'))?.status).toBe('VOID');
  });
});

describe('consolidation lifecycle', () => {
  it('pending → consolidated on Completada, with control number', async () => {
    const t = await TicketDatabase.create(makeTicketInput());
    await TicketDatabase.markPendingConsolidation(COMPANY, [t.id], 'inv_1');

    const linked = await TicketDatabase.markConsolidated(COMPANY, 'inv_1', 'DTE-01-50-1');
    expect(linked).toHaveLength(1);
    expect(linked[0].status).toBe('CONSOLIDATED');
    expect(linked[0].invoiceId).toBe('inv_1');
    expect(linked[0].invoiceControlNumber).toBe('DTE-01-50-1');
    expect(linked[0].pendingInvoiceId).toBeUndefined();
  });

  it('releases tickets when the invoice fails at MH', async () => {
    const t = await TicketDatabase.create(makeTicketInput());
    await TicketDatabase.markPendingConsolidation(COMPANY, [t.id], 'inv_2');

    const released = await TicketDatabase.releaseConsolidation(COMPANY, 'inv_2');
    expect(released).toHaveLength(1);
    expect(released[0].status).toBe('COMPLETED');
    expect(released[0].pendingInvoiceId).toBeUndefined();

    // And the ticket is selectable for consolidation again.
    const pending = await TicketDatabase.getUnconsolidated(COMPANY);
    expect(pending.some((x: Ticket) => x.id === t.id)).toBe(true);
  });

  it('releases CONSOLIDATED tickets back to COMPLETED (revert path)', async () => {
    const t = await TicketDatabase.create(makeTicketInput());
    await TicketDatabase.markPendingConsolidation(COMPANY, [t.id], 'inv_3');
    await TicketDatabase.markConsolidated(COMPANY, 'inv_3');

    const released = await TicketDatabase.releaseConsolidation(COMPANY, 'inv_3');
    expect(released[0].status).toBe('COMPLETED');
    expect(released[0].invoiceId).toBeUndefined();
  });

  it('excludes consolidated tickets from the unconsolidated pool', async () => {
    const a = await TicketDatabase.create(makeTicketInput());
    await TicketDatabase.create(makeTicketInput());
    await TicketDatabase.markPendingConsolidation(COMPANY, [a.id], 'inv_4');
    await TicketDatabase.markConsolidated(COMPANY, 'inv_4');

    const pool = await TicketDatabase.getUnconsolidated(COMPANY);
    expect(pool).toHaveLength(1);
    expect(pool[0].id).not.toBe(a.id);
  });
});

describe('change events', () => {
  it('emits upsert events on writes', async () => {
    const events: Array<{ op: string; id: string }> = [];
    const listener = (e: { op: string; id: string }) => events.push(e);
    TicketDatabase.setChangeListener(listener);
    const t = await TicketDatabase.create(makeTicketInput());
    await TicketDatabase.void(COMPANY, t.id, 'test');
    TicketDatabase.removeChangeListener(listener);

    expect(events.map((e) => e.op)).toEqual(['upsert', 'upsert']);
  });
});

describe('closings', () => {
  it('stores and orders Z snapshots', async () => {
    await TicketDatabase.create(makeTicketInput());
    await TicketDatabase.saveClosing({
      id: 'c1',
      companyId: COMPANY,
      closedAt: new Date('2026-09-26T20:00:00Z').toISOString(),
      from: new Date('2026-09-26T00:00:00Z').toISOString(),
      to: new Date('2026-09-26T20:00:00Z').toISOString(),
      ticketIds: ['x'],
      totals: {
        ticketCount: 1, voidedCount: 0, grossTotal: 6, netTotal: 6,
        ivaIncluded: 0.69, exemptTotal: 0,
        byMethod: {
          EFECTIVO: { count: 1, amount: 6, cashTendered: 10, cashChange: 4 },
          TARJETA_POS: { count: 0, amount: 0, cashTendered: 0, cashChange: 0 },
          OTRO: { count: 0, amount: 0, cashTendered: 0, cashChange: 0 },
        },
      },
    });
    const closings = await TicketDatabase.getClosings(COMPANY);
    expect(closings).toHaveLength(1);
    expect((await TicketDatabase.getLastClosing(COMPANY))!.id).toBe('c1');
  });
});

describe('storage failures (2026-10-10 code review)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storage: any = require('@/services/storage/ElectronStorage');

  it('a sale whose write fails throws and leaves no phantom ticket in memory', async () => {
    const kept = await TicketDatabase.create(makeTicketInput());
    storage.appStorage.setItem.mockImplementationOnce(async () => {
      throw new Error('storage value exceeds 5242880 bytes');
    });

    await expect(TicketDatabase.create(makeTicketInput())).rejects.toThrow(/exceeds/);

    const tickets = await TicketDatabase.getTickets({ companyId: COMPANY });
    expect(tickets.map((t) => t.id)).toEqual([kept.id]);
    // The sequence was not consumed either — the next sale reuses #2.
    const next = await TicketDatabase.create(makeTicketInput());
    expect(next.sequential).toBe(2);
  });

  it('concurrent first loads share one read: a sale racing a reader is never lost', async () => {
    const company = 'co-race';
    await TicketDatabase.deleteCompanyData(company);
    // Slow, snapshot-at-request-time reads like the Electron IPC storage.
    storage.appStorage.getItem.mockImplementation(async (key: string) => {
      const value = storage.__map.has(key) ? storage.__map.get(key) : null;
      await new Promise((r) => setTimeout(r, 5));
      return value;
    });
    try {
      const sale = TicketDatabase.create(makeTicketInput({ companyId: company }));
      const reader = TicketDatabase.getTickets({ companyId: company });
      const first = await sale;
      await reader;
      const second = await TicketDatabase.create(makeTicketInput({ companyId: company }));
      expect([first.sequential, second.sequential]).toEqual([1, 2]);
      const onDisk = JSON.parse(storage.__map.get(`tickets_db_${company}`));
      expect(onDisk.tickets.map((t: Ticket) => t.id).sort()).toEqual([first.id, second.id].sort());
      expect(onDisk.sequential).toBe(2);
      expect(storage.appStorage.getItem).toHaveBeenCalledTimes(1);
    } finally {
      storage.appStorage.getItem.mockImplementation(async (key: string) => (storage.__map.has(key) ? storage.__map.get(key) : null));
    }
  });

  it('keeps a corrupt stored value aside instead of overwriting it', async () => {
    await TicketDatabase.deleteCompanyData('co-corrupt');
    storage.__map.set('tickets_db_co-corrupt', '{not json');

    await TicketDatabase.create(makeTicketInput({ companyId: 'co-corrupt' }));

    const asideKeys = Array.from(storage.__map.keys() as Iterable<string>).filter((k) => k.startsWith('tickets_db_co-corrupt.corrupt-'));
    expect(asideKeys).toHaveLength(1);
    expect(storage.__map.get(asideKeys[0])).toBe('{not json');
  });
});
