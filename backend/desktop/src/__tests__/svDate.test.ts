// El Salvador calendar dates (UTC-6, no DST). Regressions:
//  - an invoice created Oct 31 at 19:30 SV defaulted to 2026-11-01 (UTC date)
//    and MH rejected it with 007 "Fuera de periodo tributario";
//  - `new Date('2026-10-01')` is Sept 30 in SV, so Libros IVA put documents
//    dated the 1st into the previous month.

import {
  firstOfMonthSV,
  formatSVDateDisplay,
  isInSVMonth,
  isWithinSVDateRange,
  svDateOf,
  svInstant,
  svYearMonthOf,
  todaySV,
} from '@/utils/svDate';

const OCT31_1930_SV = new Date('2026-11-01T01:30:00Z');

describe('svDate', () => {
  it('today is the SV calendar date, not the UTC one', () => {
    expect(todaySV(OCT31_1930_SV)).toBe('2026-10-31');
    expect(firstOfMonthSV(OCT31_1930_SV)).toBe('2026-10-01');
    expect(todaySV(new Date('2026-11-01T06:00:00Z'))).toBe('2026-11-01');
  });

  it('date-only strings are calendar dates, timestamps convert to SV', () => {
    expect(svDateOf('2026-10-01')).toBe('2026-10-01');
    expect(svDateOf('2026-11-01T01:30:00.000Z')).toBe('2026-10-31');
    expect(svDateOf('2026-10-01T05:59:59Z')).toBe('2026-09-30');
    expect(svDateOf('2026-10-01T08:00:00')).toBe('2026-10-01'); // zoneless = SV wall clock
    expect(svDateOf(OCT31_1930_SV)).toBe('2026-10-31');
    expect(svDateOf('')).toBe('');
    expect(svDateOf('not a date')).toBe('');
    expect(svDateOf(undefined)).toBe('');
  });

  it('months and ranges compare SV calendar dates', () => {
    expect(isInSVMonth('2026-10-01', 2026, 10)).toBe(true);
    expect(isInSVMonth('2026-10-01', 2026, 9)).toBe(false);
    expect(isInSVMonth('2026-11-01T01:30:00Z', 2026, 10)).toBe(true);
    expect(svYearMonthOf('2026-12-31T23:00:00-06:00')).toEqual({ year: 2026, month: 12 });
    expect(isWithinSVDateRange('2026-10-31', '2026-10-01', '2026-10-31')).toBe(true);
    expect(isWithinSVDateRange('2026-11-01T01:30:00Z', '2026-10-01', '2026-10-31')).toBe(true);
    expect(isWithinSVDateRange('2026-11-01T06:30:00Z', '2026-10-01', '2026-10-31')).toBe(false);
    expect(isWithinSVDateRange('2026-10-15', undefined, undefined)).toBe(true);
    expect(isWithinSVDateRange('garbage', '2026-10-01', '2026-10-31')).toBe(false);
  });

  it('svInstant is the UTC instant of an SV wall-clock time', () => {
    expect(svInstant('2026-10-01', '00:00').toISOString()).toBe('2026-10-01T06:00:00.000Z');
    expect(svInstant('2026-10-31', '23:59:59').toISOString()).toBe('2026-11-01T05:59:59.000Z');
  });

  it('formats DD/MM/YYYY without going through Date', () => {
    expect(formatSVDateDisplay('2026-10-01')).toBe('01/10/2026');
    expect(formatSVDateDisplay('2026-11-01T01:30:00Z')).toBe('31/10/2026');
  });
});
