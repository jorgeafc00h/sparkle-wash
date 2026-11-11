// Cierre de caja — X-report (read) and Z-report (close since last Z) math.
// Pure functions over tickets; persistence of the Z snapshot goes through
// TicketDatabase.saveClosing. See design §5 (add-pos-tickets) and §6–8
// (add-pos-phase-2).
//
// Range rules (2026-10-31):
//  • A ticket is a sale of the range when its SALE time (completedAt, else
//    createdAt) falls in (from, to] and it was not voided by `to`.
//  • A ticket sold AND voided inside the range counts as voided (no sale).
//  • A ticket sold in an earlier range and voided inside this one is a
//    refund of this range ("anulaciones de cierres anteriores") — before, the
//    void showed up in no closing at all and the cash count never reconciled.
//  • A Z closes up to the moment it is taken. It used to close up to 23:59:59
//    of the chosen day, so any sale made after an intraday Z (shift change) or
//    after the evening Z fell before the next Z's lower bound and vanished
//    from every closing.
//
// POS Phase 2:
//  • Registers: with `registerId` only that register's sales/voids count, and
//    only the returns it paid (return.registerId, else the ticket's). Legacy
//    tickets without a register belong to the device that holds them.
//  • Partial returns are refunds of the range they were registered in (by
//    return date, per method). A ticket voided after partial returns refunds
//    only what it kept. Returns of a ticket sold and voided inside the same
//    range are part of that void (nothing was kept, nothing is refunded twice).
//  • Breakdowns: per cashier, per product (top 20 + "Otros"), discount total.
//  • Arqueo: computeCashSummary (expected = float + cash sales − cash refunds
//    + cash in − cash out; difference = counted − expected).

import {
  CashClosing,
  CashClosingSummary,
  CashMovement,
  ClosingMethodTotals,
  ClosingProductTotals,
  ClosingTotals,
  PaymentMethod,
  Ticket,
  round2,
} from '@/types/ticket';
import { TaxCategory } from '@/types/product';
import { lineValueCents, ticketKeptAmount, voidRefundByMethod, hasReturns } from './TicketReturns';

function emptyByMethod(): Record<PaymentMethod, ClosingMethodTotals> {
  const bucket = (): ClosingMethodTotals => ({ count: 0, amount: 0, cashTendered: 0, cashChange: 0, refundCount: 0, refundAmount: 0 });
  return { EFECTIVO: bucket(), TARJETA_POS: bucket(), OTRO: bucket() };
}

const saleTime = (t: Ticket): string => t.completedAt ?? t.createdAt;

/** Was this ticket a standing sale at instant `at`? (voided later still counts). */
function isSaleAt(t: Ticket, at: string): boolean {
  if (t.status === 'COMPLETED' || t.status === 'CONSOLIDATED') return true;
  return t.status === 'VOID' && !!t.voidedAt && t.voidedAt > at;
}

const inRange = (value: string | undefined, from: string, to: string): boolean =>
  !!value && value > from && value <= to;

function exemptOf(ticket: Ticket): number {
  // Post-discount exempt bucket. New tickets persist computeTicketAmounts'
  // prorated value; legacy tickets (pre-discount field) fall back to the
  // raw exempt line sum, which is exact when no ticket discount existed.
  return ticket.exemptTotal ??
    ticket.items
      .filter((l) => l.taxCategory && l.taxCategory !== TaxCategory.GRAVADO)
      .reduce((sum, l) => sum + l.lineTotal, 0);
}

/** Register a ticket was sold on (stamped by the register since POS Phase 2). */
export function ticketRegisterId(ticket: Pick<Ticket, 'registerId'>): string | undefined {
  return ticket.registerId || undefined;
}

/**
 * Does a ticket (or return) stamped with `stamped` belong to `registerId`?
 * Undefined `registerId` = every register; an unstamped (legacy) record
 * belongs to the device that holds it.
 */
export function belongsToRegister(stamped: string | undefined, registerId: string | undefined): boolean {
  if (!registerId) return true;
  return !stamped || stamped === registerId;
}

export interface RangeOptions {
  /** Only this register (Z, X "Esta caja"). Undefined = every register (X "Todas las cajas"). */
  registerId?: string;
}

/** Products kept by name in the Z summary; the rest are folded into "Otros". */
export const CLOSING_TOP_PRODUCTS = 20;

/** Σ line discounts + ticket discount (same clamps as computeTicketAmounts). */
function discountOf(ticket: Ticket): number {
  const lineDiscounts = ticket.items.reduce((s, l) => s + Math.max(0, l.discount ?? 0), 0);
  const linesTotal = round2(ticket.items.reduce((s, l) => s + Math.max(0, l.quantity) * l.unitPrice - (l.discount ?? 0), 0));
  const ticketDiscount = Math.min(Math.max(0, ticket.discountTotal ?? 0), Math.max(0, linesTotal));
  return round2(lineDiscounts + ticketDiscount);
}

/**
 * Totals of an already-filtered list of tickets, each treated by its current
 * status: COMPLETED/CONSOLIDATED are sales, VOID are counted as voided.
 */
export function computeClosingTotals(tickets: Ticket[]): ClosingTotals {
  return computeRangeTotals(tickets, '', '￿');
}

/** Sales, same-range voids, prior-range refunds and partial returns for (from, to]. */
export function computeRangeTotals(tickets: Ticket[], from: string, to: string, options: RangeOptions = {}): ClosingTotals {
  const { registerId } = options;
  const byMethod = emptyByMethod();
  const byCashier: Record<string, { count: number; amount: number }> = {};
  const products = new Map<string, ClosingProductTotals>();
  const refunds = { count: 0, amount: 0, byMethod: {} as Partial<Record<PaymentMethod, number>> };
  let grossTotal = 0;
  let ivaIncluded = 0;
  let exemptTotal = 0;
  let roundingTotal = 0;
  let discountTotal = 0;
  let voidedCount = 0;
  let ticketCount = 0;
  let priorVoidCount = 0;
  let priorVoidAmount = 0;

  const addRefund = (method: PaymentMethod, amount: number) => {
    const bucket = byMethod[method] ?? byMethod.OTRO;
    bucket.refundCount = (bucket.refundCount ?? 0) + 1;
    bucket.refundAmount = round2((bucket.refundAmount ?? 0) + amount);
  };

  for (const ticket of tickets) {
    if (ticket.status === 'OPEN') continue;
    // A suspended sale that was discarded (VOID, never completed) was never a
    // sale: it is neither a void nor a refund of any closing.
    // (Every completed sale has completedAt — stamped since 1.2.0 on Desktop
    // and RN — and at least one payment; a discarded hold has neither.)
    if (ticket.status === 'VOID' && !ticket.completedAt && (ticket.payments?.length ?? 0) === 0) continue;
    const ticketRegister = ticketRegisterId(ticket);
    const ticketHere = belongsToRegister(ticketRegister, registerId);
    const soldInRange = inRange(saleTime(ticket), from, to);
    const voidedWithinSaleRange = soldInRange && ticket.status === 'VOID' && !isSaleAt(ticket, to);

    // Partial returns registered in this range (paid by this register).
    if (!voidedWithinSaleRange) {
      for (const ret of ticket.returns ?? []) {
        if (!inRange(ret.createdAt, from, to)) continue;
        if (!belongsToRegister(ret.registerId ?? ticketRegister, registerId)) continue;
        const amount = round2(ret.refund?.amount ?? 0);
        const method = (ret.refund?.method ?? 'OTRO') as PaymentMethod;
        refunds.count += 1;
        refunds.amount = round2(refunds.amount + amount);
        refunds.byMethod[method] = round2((refunds.byMethod[method] ?? 0) + amount);
        addRefund(method, amount);
      }
    }

    if (!ticketHere) continue;

    if (soldInRange && isSaleAt(ticket, to)) {
      ticketCount += 1;
      grossTotal = round2(grossTotal + ticket.totalAmount);
      ivaIncluded = round2(ivaIncluded + ticket.taxIncluded);
      exemptTotal = round2(exemptTotal + exemptOf(ticket));
      roundingTotal = round2(roundingTotal + (ticket.roundingAdjustment ?? 0));
      discountTotal = round2(discountTotal + discountOf(ticket));
      for (const payment of ticket.payments) {
        const bucket = byMethod[payment.method as PaymentMethod] ?? byMethod.OTRO;
        bucket.count += 1;
        bucket.amount = round2(bucket.amount + payment.amount);
        if (payment.method === 'EFECTIVO') {
          bucket.cashTendered = round2(bucket.cashTendered + (payment.tendered ?? payment.amount));
          bucket.cashChange = round2(bucket.cashChange + (payment.change ?? 0));
        }
      }
      const cashier = ticket.cashierName?.trim() || 'Sin cajero';
      const entry = byCashier[cashier] ?? { count: 0, amount: 0 };
      entry.count += 1;
      entry.amount = round2(entry.amount + ticket.totalAmount);
      byCashier[cashier] = entry;
      const values = lineValueCents(ticket);
      ticket.items.forEach((line, i) => {
        const key = line.productId ? `p:${line.productId}` : `t:${line.productName.trim().toLowerCase()}`;
        const row = products.get(key) ?? { key, name: line.productName, quantity: 0, amount: 0 };
        row.quantity = Math.round((row.quantity + Math.max(0, line.quantity)) * 1000) / 1000;
        row.amount = round2(row.amount + values[i] / 100);
        products.set(key, row);
      });
      continue;
    }

    if (ticket.status !== 'VOID') continue;
    if (soldInRange) {
      // Sold and voided inside the range: nothing was kept.
      voidedCount += 1;
      continue;
    }
    if (inRange(ticket.voidedAt, from, to) && saleTime(ticket) <= from) {
      // Sold in an earlier closing, voided now: a refund of this range — only
      // what the ticket still kept after its partial returns.
      priorVoidCount += 1;
      priorVoidAmount = round2(priorVoidAmount + ticketKeptAmount(ticket));
      if (!hasReturns(ticket)) {
        for (const payment of ticket.payments) addRefund(payment.method as PaymentMethod, payment.amount);
      } else {
        for (const [method, amount] of Object.entries(voidRefundByMethod(ticket))) {
          if (amount) addRefund(method as PaymentMethod, amount);
        }
      }
    }
  }

  const byProduct = [...products.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
  if (byProduct.length > CLOSING_TOP_PRODUCTS) {
    const rest = byProduct.splice(CLOSING_TOP_PRODUCTS);
    byProduct.push({
      key: 'otros',
      name: `Otros (${rest.length})`,
      quantity: Math.round(rest.reduce((s, r) => s + r.quantity, 0) * 1000) / 1000,
      amount: round2(rest.reduce((s, r) => s + r.amount, 0)),
    });
  }

  return {
    ticketCount,
    voidedCount,
    grossTotal,
    netTotal: round2(grossTotal - priorVoidAmount - refunds.amount),
    ivaIncluded,
    exemptTotal,
    byMethod,
    priorVoidCount,
    priorVoidAmount,
    roundingTotal,
    registerId,
    byCashier,
    byProduct,
    discountTotal,
    refunds,
  };
}

/** X-report: any read-only range (from exclusive, to inclusive). */
export function computeXReport(tickets: Ticket[], from: string, to: string, options: RangeOptions = {}): ClosingTotals {
  return computeRangeTotals(tickets, from, to, options);
}

/** Z-report: everything since the last Z's closedAt (exclusive) up to `to` (normally now). */
export function computeZReport(tickets: Ticket[], lastZClosedAt: string | null, to: string, options: RangeOptions = {}): ClosingTotals {
  return computeRangeTotals(tickets, lastZClosedAt ?? '', to, options);
}

/** True when the range has anything to close (sales, voids, refunds or returns). */
export function hasClosingActivity(totals: ClosingTotals): boolean {
  return totals.ticketCount > 0 ||
    totals.voidedCount > 0 ||
    (totals.priorVoidCount ?? 0) > 0 ||
    (totals.refunds?.count ?? 0) > 0;
}

const hasReturnInRange = (t: Ticket, from: string, to: string, registerId?: string): boolean =>
  (t.returns ?? []).some((r) => inRange(r.createdAt, from, to) && belongsToRegister(r.registerId ?? ticketRegisterId(t), registerId));

/** Ids of the tickets a closing covers: sales, voids and partial returns in range. */
export function closingTicketIds(tickets: Ticket[], from: string, to: string, registerId?: string): string[] {
  return tickets
    .filter((t) => {
      if (t.status === 'OPEN') return false;
      if (hasReturnInRange(t, from, to, registerId)) return true;
      if (!belongsToRegister(ticketRegisterId(t), registerId)) return false;
      if (inRange(saleTime(t), from, to)) return true;
      return t.status === 'VOID' && inRange(t.voidedAt, from, to);
    })
    .map((t) => t.id);
}

/** The tickets of a closing that are standing sales (consolidation candidates). */
export function closingSaleIds(tickets: Ticket[], from: string, to: string, registerId?: string): string[] {
  return tickets
    .filter((t) => belongsToRegister(ticketRegisterId(t), registerId) && inRange(saleTime(t), from, to) && isSaleAt(t, to))
    .map((t) => t.id);
}

/**
 * Arqueo de efectivo: expected cash in the drawer at the Z and, when the
 * operator counted it, the difference (negative = faltante, positive = sobrante).
 */
export function computeCashSummary(input: {
  totals: Pick<ClosingTotals, 'byMethod'>;
  openingFloat?: number;
  movements?: Array<Pick<CashMovement, 'kind' | 'amount'>>;
  counted?: number | null;
  sessionId?: string;
}): CashClosingSummary {
  const cash = input.totals.byMethod.EFECTIVO;
  const openingFloat = round2(Math.max(0, input.openingFloat ?? 0));
  const cashSales = round2(cash?.amount ?? 0);
  const cashRefunds = round2(cash?.refundAmount ?? 0);
  const cashIn = round2((input.movements ?? []).filter((m) => m.kind === 'IN').reduce((s, m) => s + m.amount, 0));
  const cashOut = round2((input.movements ?? []).filter((m) => m.kind === 'OUT').reduce((s, m) => s + m.amount, 0));
  const expected = round2(openingFloat + cashSales - cashRefunds + cashIn - cashOut);
  const summary: CashClosingSummary = {
    sessionId: input.sessionId,
    openingFloat,
    cashSales,
    cashRefunds,
    cashIn,
    cashOut,
    expected,
  };
  if (input.counted !== undefined && input.counted !== null && Number.isFinite(input.counted)) {
    summary.counted = round2(input.counted);
    summary.difference = round2(summary.counted - expected);
  }
  return summary;
}

/** "Faltante" / "Sobrante" / "Cuadra" for an arqueo difference. */
export function cashDifferenceLabel(difference: number | undefined): string {
  if (difference === undefined) return 'Sin conteo';
  if (difference < 0) return 'Faltante';
  if (difference > 0) return 'Sobrante';
  return 'Cuadra';
}

export function buildCashClosing(
  companyId: string,
  tickets: Ticket[],
  from: string,
  to: string,
  totals: ClosingTotals,
  extra: { registerId?: string; registerCode?: string; cash?: CashClosingSummary } = {},
): CashClosing {
  const closing: CashClosing = {
    id: `close_${companyId}_${Date.now()}`,
    companyId,
    closedAt: to,
    from,
    to,
    ticketIds: closingTicketIds(tickets, from, to, extra.registerId),
    totals,
  };
  if (extra.registerId) closing.registerId = extra.registerId;
  if (extra.registerCode) closing.registerCode = extra.registerCode;
  if (extra.cash) closing.cash = extra.cash;
  return closing;
}

/** Closings of this register (legacy closings without a register count as this device's). */
export function closingsForRegister(closings: CashClosing[], registerId: string | undefined): CashClosing[] {
  return closings.filter((c) => belongsToRegister(c.registerId, registerId));
}
