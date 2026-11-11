// El Salvador calendar-date helpers (America/El_Salvador = UTC-6, no DST).
//
// Fiscal dates (fecEmi, Libros IVA periods, MH "Fuera de periodo tributario")
// are El Salvador CALENDAR dates. Two bugs kept recurring when code reached for
// the Date API directly:
//   - `new Date().toISOString().slice(0, 10)` is the UTC date: from 18:00 SV on
//     it is already "tomorrow" (Oct 31 19:30 → 2026-11-01, MH rejects with 007).
//   - `new Date('2026-10-01')` parses a date-only string as UTC midnight, i.e.
//     Sept 30 18:00 in SV, so documents dated the 1st landed in the prior month.
// Rule: a `YYYY-MM-DD` string IS the calendar date (never goes through Date);
// timestamps are converted to the SV calendar date via Intl.

export const SV_TIME_ZONE = 'America/El_Salvador';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
// A wall-clock timestamp without zone designator ("2026-10-01T08:00:00") is
// already local SV time — its first 10 chars are the calendar date.
const ZONELESS_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

const svDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SV_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function formatInstantSV(date: Date): string {
  const parts = svDateFormatter.formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}

/**
 * The El Salvador calendar date (YYYY-MM-DD) of a stored date: date-only
 * strings are returned as-is, timestamps are converted to SV time. Returns ''
 * for missing/unparseable input (callers treat that as "no date").
 */
export function svDateOf(value: Date | string | null | undefined): string {
  if (value == null || value === '') return '';
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : formatInstantSV(value);
  }
  const trimmed = value.trim();
  if (DATE_ONLY.test(trimmed)) return trimmed;
  const zoneless = ZONELESS_TIMESTAMP.exec(trimmed);
  if (zoneless) return zoneless[1];
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? '' : formatInstantSV(parsed);
}

/** Today's El Salvador calendar date (YYYY-MM-DD). */
export function todaySV(now: Date = new Date()): string {
  return formatInstantSV(now);
}

/** First day of the El Salvador month containing `now` (YYYY-MM-01). */
export function firstOfMonthSV(now: Date = new Date()): string {
  return `${todaySV(now).slice(0, 8)}01`;
}

/** { year, month (1-12) } of a stored date in the SV calendar, or null. */
export function svYearMonthOf(value: Date | string | null | undefined): { year: number; month: number } | null {
  const date = svDateOf(value);
  const match = DATE_ONLY.exec(date);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

/** Current SV { year, month (1-12) }. */
export function currentSVYearMonth(now: Date = new Date()): { year: number; month: number } {
  return svYearMonthOf(now)!;
}

/** True when the stored date falls in the given SV year/month (month 1-12). */
export function isInSVMonth(value: Date | string | null | undefined, year: number, month: number): boolean {
  const ym = svYearMonthOf(value);
  return !!ym && ym.year === year && ym.month === month;
}

/**
 * True when the stored date's SV calendar date lies within [from, to]
 * (inclusive, YYYY-MM-DD; an empty bound is open). Date-only comparison, so
 * an ISO timestamp from 22:00 SV on the last day still counts.
 */
export function isWithinSVDateRange(
  value: Date | string | null | undefined,
  from?: string,
  to?: string,
): boolean {
  const date = svDateOf(value);
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

/**
 * The UTC instant of an SV wall-clock time on a calendar date
 * (`svInstant('2026-10-01', '00:00')` = 2026-10-01T06:00:00Z).
 */
export function svInstant(dateOnly: string, time: string = '00:00'): Date {
  const hhmm = /^\d{2}:\d{2}(:\d{2})?$/.test(time) ? time : '00:00';
  const withSeconds = hhmm.length === 5 ? `${hhmm}:00` : hhmm;
  return new Date(`${dateOnly}T${withSeconds}-06:00`);
}

/** `YYYY-MM-DD` → `DD/MM/YYYY` without going through Date (display / MH annexes). */
export function formatSVDateDisplay(value: Date | string | null | undefined): string {
  const date = svDateOf(value);
  const match = DATE_ONLY.exec(date);
  if (!match) return typeof value === 'string' ? value : '';
  return `${match[3]}/${match[2]}/${match[1]}`;
}
