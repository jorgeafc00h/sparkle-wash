// Pure helpers for the carwash UI (plate input, elapsed time, "today" in El
// Salvador time, package pricing). No React / Redux so Jest can load them.

import { RECEIPT_TIME_ZONE } from '@/services/printing/ReceiptDocument';
import type { CarwashJob, JobStatus, ServicePackage } from '@/services/carwash/types';

/** Uppercase, drop spaces/symbols (keeps A–Z, 0–9, "-"), max 10 chars. */
export function normalizePlate(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 10);
}

export function isValidPlate(plate: string): boolean {
  return /^[A-Z0-9][A-Z0-9-]{2,9}$/.test(plate);
}

/** Price of `pkg` for a vehicle class, or null when it has none. */
export function packagePrice(pkg: Pick<ServicePackage, 'prices'>, vehicleClassId: string): number | null {
  const value = pkg.prices?.[vehicleClassId];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** "07:05" under an hour, "1:02:09" beyond. Negative/invalid → "00:00". */
export function formatElapsed(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Calendar day (YYYY-MM-DD) of an instant in El Salvador time. */
export function svDay(value: string | number | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: RECEIPT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(date).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Time a job has been (or was) in the shop: running → now, finished → arrival..completion. */
export function jobElapsedMs(job: Pick<CarwashJob, 'arrivalAt' | 'completedAt' | 'cancelledAt' | 'status'>, now: number): number {
  const start = Date.parse(job.arrivalAt);
  if (Number.isNaN(start)) return 0;
  const endIso = job.status === 'completed' ? job.completedAt : job.status === 'cancelled' ? job.cancelledAt : null;
  const end = endIso ? Date.parse(endIso) : now;
  return Math.max(0, (Number.isNaN(end) ? now : end) - start);
}

export interface BoardColumns {
  arrived: CarwashJob[];
  queued: CarwashJob[];
  in_progress: CarwashJob[];
  /** Completed today (El Salvador time). */
  completed: CarwashJob[];
}

export interface BoardSummary {
  onSite: number;
  inProgress: number;
  doneToday: number;
  toCollect: number;
}

/** Search by plate or work-ticket number (case/hyphen-insensitive). */
export function matchesJobSearch(job: Pick<CarwashJob, 'plate' | 'ticketNumber'>, term: string): boolean {
  const norm = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const q = norm(term);
  if (!q) return true;
  return norm(job.plate).includes(q) || norm(job.ticketNumber ?? '').includes(q);
}

export function buildBoard(jobs: CarwashJob[], now: number, term = ''): { columns: BoardColumns; summary: BoardSummary } {
  const today = svDay(now);
  const visible = jobs.filter((j) => matchesJobSearch(j, term));
  const byArrival = (a: CarwashJob, b: CarwashJob) => Date.parse(a.arrivalAt) - Date.parse(b.arrivalAt);
  const pick = (status: JobStatus) => visible.filter((j) => j.status === status).sort(byArrival);
  const columns: BoardColumns = {
    arrived: pick('arrived'),
    queued: pick('queued'),
    in_progress: pick('in_progress'),
    completed: visible
      .filter((j) => j.status === 'completed' && svDay(j.completedAt ?? j.arrivalAt) === today)
      .sort((a, b) => Date.parse(b.completedAt ?? '') - Date.parse(a.completedAt ?? '')),
  };
  const all = jobs;
  const open = all.filter((j) => j.status === 'arrived' || j.status === 'queued' || j.status === 'in_progress');
  const summary: BoardSummary = {
    onSite: open.length,
    inProgress: open.filter((j) => j.status === 'in_progress').length,
    doneToday: all.filter((j) => j.status === 'completed' && svDay(j.completedAt ?? j.arrivalAt) === today).length,
    toCollect: all.filter((j) => j.status !== 'cancelled' && (j.paymentStatus ?? 'unpaid') !== 'paid' && (j.paidUsd ?? 0) < j.priceUsd).length,
  };
  return { columns, summary };
}
