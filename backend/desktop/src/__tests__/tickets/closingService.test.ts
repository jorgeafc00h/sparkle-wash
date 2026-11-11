// Cierre de caja math — X/Z ranges, per-method buckets, void exclusion.

import { computeClosingTotals, computeXReport, computeZReport, buildCashClosing } from '@/services/tickets/ClosingService';
import type { Ticket } from '@/types/ticket';

let seq = 0;
function ticket(over: Partial<Ticket>): Ticket {
  seq += 1;
  return {
    id: `t${seq}`,
    companyId: 'co',
    sequential: seq,
    status: 'COMPLETED',
    items: [],
    payments: [],
    totalAmount: 10,
    taxIncluded: 1.15,
    createdAt: over.createdAt ?? new Date(2026, 8, seq, 12).toISOString(),
    printedCount: 0,
    updatedAt: '',
    ...over,
  };
}

describe('computeClosingTotals', () => {
  it('buckets payments per method with cash tendered/change', () => {
    const totals = computeClosingTotals([
      ticket({
        totalAmount: 8.5,
        payments: [{ id: 'p1', method: 'EFECTIVO', amount: 8.5, tendered: 10, change: 1.5 }],
      }),
      ticket({
        totalAmount: 20,
        payments: [{ id: 'p2', method: 'TARJETA_POS', amount: 20, posAuthCode: 'A1', posLast4: '4242' }],
      }),
    ]);
    expect(totals.ticketCount).toBe(2);
    expect(totals.grossTotal).toBe(28.5);
    expect(totals.byMethod.EFECTIVO).toMatchObject({ count: 1, amount: 8.5, cashTendered: 10, cashChange: 1.5 });
    expect(totals.byMethod.TARJETA_POS.amount).toBe(20);
  });

  it('counts voided tickets but excludes them from totals', () => {
    const at = new Date(2026, 8, 20, 12).toISOString();
    const totals = computeClosingTotals([
      ticket({ totalAmount: 5 }),
      // A real voided sale: it was completed (completedAt) and paid.
      ticket({ status: 'VOID', voidedAt: 'x', totalAmount: 7, createdAt: at, completedAt: at, payments: [{ id: 'pv', method: 'EFECTIVO', amount: 7 }] }),
    ]);
    expect(totals.ticketCount).toBe(1);
    expect(totals.voidedCount).toBe(1);
    expect(totals.grossTotal).toBe(5);
  });

  it('a discarded suspended sale (never completed, never paid) is neither a sale nor a void', () => {
    const totals = computeClosingTotals([
      ticket({ totalAmount: 5 }),
      ticket({ status: 'VOID', voidedAt: 'x', voidReason: 'Venta en espera descartada', totalAmount: 9, payments: [] }),
    ]);
    expect(totals.ticketCount).toBe(1);
    expect(totals.voidedCount).toBe(0);
  });

  it('includes CONSOLIDATED tickets (they are still sales of the day)', () => {
    const totals = computeClosingTotals([
      ticket({ status: 'CONSOLIDATED', invoiceId: 'inv1', totalAmount: 5 }),
    ]);
    expect(totals.ticketCount).toBe(1);
    expect(totals.grossTotal).toBe(5);
  });
});

describe('computeXReport / computeZReport ranges', () => {
  const t1 = ticket({ createdAt: new Date(2026, 8, 25, 10).toISOString(), totalAmount: 4 });
  const t2 = ticket({ createdAt: new Date(2026, 8, 26, 10).toISOString(), totalAmount: 6 });
  const tickets = [t1, t2];

  it('X covers the explicit range', () => {
    const totals = computeXReport(tickets, new Date(2026, 8, 26, 0).toISOString(), new Date(2026, 8, 26, 23, 59).toISOString());
    expect(totals.ticketCount).toBe(1);
    expect(totals.grossTotal).toBe(6);
  });

  it('Z covers everything after the previous close', () => {
    const totals = computeZReport(tickets, new Date(2026, 8, 25, 20).toISOString(), new Date(2026, 8, 26, 23, 59).toISOString());
    expect(totals.ticketCount).toBe(1);
    expect(totals.grossTotal).toBe(6);
  });

  it('Z with no previous close covers from the epoch', () => {
    const totals = computeZReport(tickets, null, new Date(2026, 8, 30).toISOString());
    expect(totals.ticketCount).toBe(2);
  });
});

describe('buildCashClosing', () => {
  it('snapshots the ticket ids in range', () => {
    const t1 = ticket({ createdAt: new Date(2026, 8, 26, 9).toISOString() });
    const t2 = ticket({ createdAt: new Date(2026, 8, 26, 18).toISOString() });
    const closing = buildCashClosing(
      'co',
      [t1, t2],
      new Date(2026, 8, 26, 0).toISOString(),
      new Date(2026, 8, 26, 23).toISOString(),
      computeClosingTotals([t1, t2]),
    );
    expect(closing.ticketIds).toHaveLength(2);
    expect(closing.companyId).toBe('co');
  });
});
