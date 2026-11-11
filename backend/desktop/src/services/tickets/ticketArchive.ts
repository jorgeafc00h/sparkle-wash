// Ticket archive partitioning (POS Phase 2, design §9) — pure helpers.
//
// The hot ticket DB (`tickets_db_{companyId}`, rewritten on every sale) keeps
// OPEN/COMPLETED tickets and everything touched in the current + previous
// month. FINAL tickets (CONSOLIDATED, VOID, or fully returned) whose sale AND
// last change are older than that move to one key per month
// (`tickets_archive_{companyId}_{YYYY-MM}`, by El Salvador sale month).
//
// Using the last change (updatedAt) too keeps anything a current report may
// still need hot: a three-month-old sale voided yesterday is a refund of the
// current Z and must not disappear into the archive before that Z is taken.

import type { Ticket } from '@/types/ticket';
import { svDateOf } from '@/utils/svDate';
import { isFullyReturned } from './TicketReturns';

/** El Salvador is UTC-6 all year (no DST). */
const SV_OFFSET = '-06:00';

export const saleTimeOf = (ticket: Pick<Ticket, 'completedAt' | 'createdAt'>): string =>
  ticket.completedAt ?? ticket.createdAt;

/** 'YYYY-MM' of an ISO instant in the El Salvador calendar ('' when unparseable). */
export function svMonthKey(iso: string | undefined | null): string {
  const date = svDateOf(iso ?? '');
  return date ? date.slice(0, 7) : '';
}

/** 'YYYY-MM' shifted by whole months. */
export function shiftMonthKey(month: string, delta: number): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  const index = Number(match[1]) * 12 + (Number(match[2]) - 1) + delta;
  const year = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

/** ISO instant where the hot window starts: the 1st of the PREVIOUS SV month, 00:00 SV. */
export function hotWindowStart(now: Date = new Date()): string {
  const current = svMonthKey(now.toISOString());
  const previous = shiftMonthKey(current, -1);
  return new Date(`${previous}-01T00:00:00${SV_OFFSET}`).toISOString();
}

/** Nothing can change this ticket any more except an explicit release / peer update. */
export function isFinalTicket(ticket: Ticket): boolean {
  if (ticket.pendingInvoiceId) return false;
  if (ticket.status === 'CONSOLIDATED' || ticket.status === 'VOID') return true;
  return ticket.status === 'COMPLETED' && !ticket.invoiceId && isFullyReturned(ticket);
}

export function isArchivable(ticket: Ticket, hotStart: string): boolean {
  if (!isFinalTicket(ticket)) return false;
  const sale = saleTimeOf(ticket);
  if (!sale || !svMonthKey(sale)) return false;
  // Last change: updatedAt, never earlier than the void / consolidation itself.
  const lastChange = [ticket.updatedAt, ticket.voidedAt, ticket.consolidatedAt]
    .filter((v): v is string => typeof v === 'string' && v !== '')
    .sort()
    .pop() ?? sale;
  return sale < hotStart && lastChange < hotStart;
}

export function archiveMonthOf(ticket: Ticket): string {
  return svMonthKey(saleTimeOf(ticket));
}

/** Splits tickets into those that stay hot and those to archive, grouped by month. */
export function partitionForArchive(
  tickets: Ticket[],
  hotStart: string,
): { hot: Ticket[]; byMonth: Map<string, Ticket[]> } {
  const hot: Ticket[] = [];
  const byMonth = new Map<string, Ticket[]>();
  for (const ticket of tickets) {
    if (!isArchivable(ticket, hotStart)) {
      hot.push(ticket);
      continue;
    }
    const month = archiveMonthOf(ticket);
    const list = byMonth.get(month);
    if (list) list.push(ticket);
    else byMonth.set(month, [ticket]);
  }
  return { hot, byMonth };
}

/**
 * Archived months a [from, to] read must open. Padded by one month on each
 * side: getTickets filters on createdAt while months are by sale time (a
 * sale parked at 23:59 on the 31st and charged on the 1st), and the SV/UTC
 * day edge. An open bound reaches every month on that side.
 */
export function archiveMonthsForRange(available: Iterable<string>, from?: string, to?: string): string[] {
  const low = from ? shiftMonthKey(svMonthKey(from) || '0000-01', -1) : '';
  const high = to ? shiftMonthKey(svMonthKey(to) || '9999-12', 1) : '';
  const months = new Set<string>();
  for (const month of available) {
    if (low && month < low) continue;
    if (high && month > high) continue;
    months.add(month);
  }
  return Array.from(months).sort();
}

export function archiveKey(companyId: string, month: string): string {
  return `tickets_archive_${companyId}_${month}`;
}

export function archiveKeyPrefix(companyId: string): string {
  return `tickets_archive_${companyId}_`;
}
