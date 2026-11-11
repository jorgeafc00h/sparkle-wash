// Cierre de caja ranges (2026-10-31): a Z closes up to the moment it is taken
// (not 23:59:59 of the day) and voids of earlier closings show up as refunds.

import {
  buildCashClosing,
  closingSaleIds,
  computeXReport,
  computeZReport,
  hasClosingActivity,
} from '@/services/tickets/ClosingService';
import type { Ticket } from '@/types/ticket';

let seq = 0;
function t(at: string, over: Partial<Ticket> = {}): Ticket {
  seq += 1;
  return {
    id: `t${seq}`,
    companyId: 'co',
    sequential: seq,
    status: 'COMPLETED',
    items: [],
    payments: [{ id: `p${seq}`, method: 'EFECTIVO', amount: over.totalAmount ?? 10 }],
    totalAmount: 10,
    taxIncluded: 1.15,
    createdAt: at,
    completedAt: at,
    printedCount: 0,
    updatedAt: at,
    ...over,
  };
}

const iso = (s: string) => new Date(s).toISOString();

describe('Z closes up to now', () => {
  it('a sale after an intraday Z lands in the next Z (it used to vanish)', () => {
    const morning = [t(iso('2026-10-31T09:00:00-06:00')), t(iso('2026-10-31T14:00:00-06:00'))];
    const zAt = iso('2026-10-31T15:00:00-06:00');
    const z1Totals = computeZReport(morning, null, zAt);
    const z1 = buildCashClosing('co', morning, '', zAt, z1Totals);
    expect(z1.closedAt).toBe(zAt);
    expect(z1Totals.grossTotal).toBe(20);

    const afternoon = t(iso('2026-10-31T16:30:00-06:00'), { totalAmount: 25 });
    const z2 = computeZReport([...morning, afternoon], z1.closedAt, iso('2026-10-31T21:00:00-06:00'));
    expect(z2.ticketCount).toBe(1);
    expect(z2.grossTotal).toBe(25);
  });
});

describe('voids across closings', () => {
  it('a ticket of an earlier Z voided now is a refund of this Z', () => {
    const z1At = iso('2026-10-31T20:00:00-06:00');
    const sold = t(iso('2026-10-31T10:00:00-06:00'), { totalAmount: 12, payments: [{ id: 'p', method: 'EFECTIVO', amount: 12 }] });
    const voided = { ...sold, status: 'VOID' as const, voidedAt: iso('2026-11-01T08:00:00-06:00') };
    const todaySale = t(iso('2026-11-01T09:00:00-06:00'), { totalAmount: 30, payments: [{ id: 'q', method: 'EFECTIVO', amount: 30 }] });
    const z2 = computeZReport([voided, todaySale], z1At, iso('2026-11-01T20:00:00-06:00'));
    expect(z2.ticketCount).toBe(1);
    expect(z2.grossTotal).toBe(30);
    expect(z2.priorVoidCount).toBe(1);
    expect(z2.priorVoidAmount).toBe(12);
    expect(z2.netTotal).toBe(18);
    expect(z2.byMethod.EFECTIVO.refundAmount).toBe(12);
    expect(hasClosingActivity(z2)).toBe(true);
  });

  it('a refund alone still allows closing', () => {
    const voided = t(iso('2026-10-31T10:00:00-06:00'), { status: 'VOID', voidedAt: iso('2026-11-01T08:00:00-06:00') });
    const z = computeZReport([voided], iso('2026-10-31T20:00:00-06:00'), iso('2026-11-01T20:00:00-06:00'));
    expect(z.ticketCount).toBe(0);
    expect(hasClosingActivity(z)).toBe(true);
  });

  it('sold and voided inside the same range is just a void (no sale, no refund)', () => {
    const v = t(iso('2026-11-01T09:00:00-06:00'), { status: 'VOID', voidedAt: iso('2026-11-01T09:05:00-06:00') });
    const z = computeZReport([v], iso('2026-10-31T20:00:00-06:00'), iso('2026-11-01T20:00:00-06:00'));
    expect(z.voidedCount).toBe(1);
    expect(z.grossTotal).toBe(0);
    expect(z.priorVoidCount).toBe(0);
  });

  it('an X of a past day counts a ticket voided later as a sale of that day (what its Z saw)', () => {
    const v = t(iso('2026-10-31T10:00:00-06:00'), { status: 'VOID', voidedAt: iso('2026-11-01T08:00:00-06:00') });
    const x = computeXReport([v], iso('2026-10-30T23:59:59.999-06:00'), iso('2026-10-31T23:59:59.999-06:00'));
    expect(x.ticketCount).toBe(1);
    expect(x.grossTotal).toBe(10);
  });

  it('closing snapshots include the voids of the range; sale ids feed "Facturar este cierre"', () => {
    const from = iso('2026-10-31T20:00:00-06:00');
    const to = iso('2026-11-01T20:00:00-06:00');
    const earlierVoided = t(iso('2026-10-31T10:00:00-06:00'), { status: 'VOID', voidedAt: iso('2026-11-01T08:00:00-06:00') });
    const sale = t(iso('2026-11-01T09:00:00-06:00'));
    const open = t(iso('2026-11-01T10:00:00-06:00'), { status: 'OPEN', completedAt: undefined });
    const closing = buildCashClosing('co', [earlierVoided, sale, open], from, to, computeZReport([earlierVoided, sale, open], from, to));
    expect(closing.ticketIds.sort()).toEqual([earlierVoided.id, sale.id].sort());
    expect(closingSaleIds([earlierVoided, sale, open], from, to)).toEqual([sale.id]);
  });

  it('uses the completion time of a parked ticket', () => {
    const parked = t(iso('2026-10-31T19:00:00-06:00'), { completedAt: iso('2026-11-01T09:00:00-06:00') });
    const z = computeZReport([parked], iso('2026-10-31T20:00:00-06:00'), iso('2026-11-01T20:00:00-06:00'));
    expect(z.ticketCount).toBe(1);
  });
});
