// Dashboard "Ventas POS hoy" numbers (POS Phase 2) — pure, El Salvador calendar.

import type { Ticket } from '@/types/ticket';
import { round2 } from '@/types/ticket';
import { firstOfMonthSV, todaySV } from '@/utils/svDate';
import { isFullyReturned, ticketKeptAmount } from './TicketReturns';
import { saleTimeOf } from './ticketArchive';

export interface PosDashboardStats {
  /** ISO instant of today's 00:00 in El Salvador. */
  todayStart: string;
  /** ISO instant of the 1st of this month, 00:00 in El Salvador. */
  monthStart: string;
  todayCount: number;
  /** What today's sales kept (total − partial refunds). */
  todayAmount: number;
  /** COMPLETED sales of the month not on any invoice or draft (consolidation pool). */
  unconsolidatedCount: number;
  unconsolidatedAmount: number;
}

const svMidnight = (date: string) => new Date(`${date}T00:00:00-06:00`).toISOString();

export function computePosDashboardStats(tickets: Ticket[], now: Date = new Date()): PosDashboardStats {
  const todayStart = svMidnight(todaySV(now));
  const monthStart = svMidnight(firstOfMonthSV(now));
  let todayCount = 0;
  let todayAmount = 0;
  let unconsolidatedCount = 0;
  let unconsolidatedAmount = 0;
  for (const ticket of tickets) {
    if (ticket.status !== 'COMPLETED' && ticket.status !== 'CONSOLIDATED') continue;
    const sale = saleTimeOf(ticket);
    if (!sale || sale < monthStart) continue;
    const kept = ticketKeptAmount(ticket);
    if (sale >= todayStart) {
      todayCount += 1;
      todayAmount = round2(todayAmount + kept);
    }
    if (ticket.status === 'COMPLETED' && !ticket.invoiceId && !ticket.pendingInvoiceId && !isFullyReturned(ticket)) {
      unconsolidatedCount += 1;
      unconsolidatedAmount = round2(unconsolidatedAmount + kept);
    }
  }
  return { todayStart, monthStart, todayCount, todayAmount, unconsolidatedCount, unconsolidatedAmount };
}
