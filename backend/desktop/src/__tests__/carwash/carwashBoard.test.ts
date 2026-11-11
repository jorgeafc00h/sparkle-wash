// Pure board helpers: plate input, elapsed time, El Salvador "today", search, columns.
import { buildBoard, formatElapsed, isValidPlate, jobElapsedMs, matchesJobSearch, normalizePlate, packagePrice, svDay } from '@/components/carwash/carwashUi';
import type { CarwashJob } from '@/services/carwash/types';

const mk = (id: string, over: Partial<CarwashJob>): CarwashJob => ({
  id, arrivalId: id, plate: 'P111111', vehicleClass: 'sedan', packageId: 'p', packageName: 'Básico', services: [], priceUsd: 10, currency: 'USD',
  status: 'arrived', arrivalAt: '2026-10-31T16:00:00Z', startedAt: null, completedAt: null, cancelledAt: null, elapsedSeconds: 0, activeSeconds: null,
  transitions: [], assignments: [], ticketNumber: `OT-C1-${id}`, paidUsd: 0, paymentStatus: 'unpaid', ...over,
});

describe('carwash UI helpers', () => {
  it('plate: uppercase, strips spaces/symbols, validates length', () => {
    expect(normalizePlate(' p123 456!')).toBe('P123456');
    expect(isValidPlate('P123-456')).toBe(true);
    expect(isValidPlate('P1')).toBe(false);
    expect(isValidPlate('')).toBe(false);
  });
  it('package price per class', () => {
    expect(packagePrice({ prices: { suv: 15 } }, 'suv')).toBe(15);
    expect(packagePrice({ prices: { suv: 15 } }, 'sedan')).toBeNull();
  });
  it('elapsed formatting', () => {
    expect(formatElapsed(65_000)).toBe('01:05');
    expect(formatElapsed(3_725_000)).toBe('1:02:05');
    expect(formatElapsed(-5)).toBe('00:00');
  });
  it('elapsed of finished jobs stops at completion', () => {
    const done = mk('1', { status: 'completed', arrivalAt: '2026-10-31T16:00:00Z', completedAt: '2026-10-31T16:30:00Z' });
    expect(jobElapsedMs(done, Date.parse('2026-11-02T00:00:00Z'))).toBe(30 * 60_000);
  });
  it('svDay uses El Salvador time', () => {
    expect(svDay('2026-11-01T03:30:00Z')).toBe('2026-10-31');
  });
  it('search by plate or ticket, ignoring case and hyphens', () => {
    expect(matchesJobSearch({ plate: 'P123-456', ticketNumber: 'OT-C1-000045' }, 'p123456')).toBe(true);
    expect(matchesJobSearch({ plate: 'P123-456', ticketNumber: 'OT-C1-000045' }, 'ot-c1-45')).toBe(false);
    expect(matchesJobSearch({ plate: 'P123-456', ticketNumber: 'OT-C1-000045' }, 'c1-0000')).toBe(true);
  });
  it('board columns + summary: only today\'s completed, unpaid count excludes cancelled', () => {
    const now = Date.parse('2026-10-31T20:00:00Z');
    const jobs = [
      mk('a', { status: 'arrived' }),
      mk('q', { status: 'queued' }),
      mk('i', { status: 'in_progress' }),
      mk('d1', { status: 'completed', completedAt: '2026-10-31T18:00:00Z', paidUsd: 10, paymentStatus: 'paid' }),
      mk('d0', { status: 'completed', completedAt: '2026-10-30T18:00:00Z' }),
      mk('x', { status: 'cancelled' }),
    ];
    const { columns, summary } = buildBoard(jobs, now);
    expect(columns.arrived.map((j) => j.id)).toEqual(['a']);
    expect(columns.completed.map((j) => j.id)).toEqual(['d1']);
    expect(summary).toEqual({ onSite: 3, inProgress: 1, doneToday: 1, toCollect: 4 });
  });
});
