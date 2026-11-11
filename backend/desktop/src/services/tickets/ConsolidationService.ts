// Consolidation — many tickets → one draft DTE invoice.
// Pure aggregation + grouping; invoice creation goes through the Redux
// `addInvoice` prepare path so totals use the canonical computeTotals.
// See design §6.
//
// Invariant (2026-10-31): the draft must equal what the register charged for
// the selected tickets, minus cash rounding (a coin adjustment, not a sale):
//   Σ invoice lines  ==  Σ ticket.totalAmount − Σ ticket.roundingAdjustment
// Lines are grouped per product AND unit price (never averaged — a rounded
// average × quantity drifted from the tickets, e.g. 100×$1.00 + 1×$1.50 drafted
// $101.00 for $101.50 of sales), ticket-level discounts are allocated in whole
// cents over each line's NET (after its own discount, so no line goes
// negative), and any residual cent is absorbed so the totals reconcile.
//
// Partial returns (POS Phase 2, design §8): a ticket with returns contributes
// only its KEPT units and value (line value − refunds), a fully returned
// ticket contributes nothing, and the invariant becomes
//   Σ invoice lines  ==  Σ (ticket.totalAmount − Σ refunds) − Σ roundingAdjustment

import { TaxCategory } from '@/types/product';
import { formatTicketNumber } from './ticketNumber';
import { Ticket, round2 } from '@/types/ticket';
import { InvoiceType, type InvoiceDetail } from '@/types/invoice';
import { computeTotals } from '@/utils/invoiceTotals';
import {
  allocateCents,
  hasReturns,
  isFullyReturned,
  keptLines,
  ticketKeptAmount,
  ticketRefundTotal,
  toCents,
} from './TicketReturns';

export { allocateCents };

export interface ConsolidationLine {
  key: string;
  productId?: string;
  productCode?: string;
  productName: string;
  quantity: number;
  /** Exact ticket unit price (IVA incl.) — one line per distinct price. */
  unitPrice: number;
  taxCategory: TaxCategory;
  /** Σ line discounts + allocated ticket-level discount (IVA incl.). */
  discount: number;
  lineTotal: number;
  ticketCount: number;
}

export interface ConsolidationPreview {
  lines: ConsolidationLine[];
  /** Σ lineTotal — what the draft invoice will charge. */
  totalAmount: number;
  taxIncluded: number;
  exemptTotal: number;
  ticketCount: number;
  dateFrom: string;
  dateTo: string;
  /** Selection mixes excludeFromLibrosIVA flags → must split into two drafts. */
  needsLibrosSplit: boolean;
  /** Σ (ticket.totalAmount − partial-return refunds) — what the register kept (incl. cash rounding). */
  ticketsTotal: number;
  /** Σ ticket.roundingAdjustment — cash rounding stays out of the invoice. */
  roundingTotal: number;
  /** ticketsTotal − roundingTotal: the amount the invoice must equal. */
  expectedInvoiceTotal: number;
  /** totalAmount − expectedInvoiceTotal (0 when the draft reconciles). */
  difference: number;
}

function lineKey(line: Ticket['items'][number]): string {
  const tax = line.taxCategory ?? TaxCategory.GRAVADO;
  const base = line.productId ? `p:${line.productId}` : `t:${line.productName.trim().toLowerCase()}`;
  return `${base}@${line.unitPrice}#${tax}`;
}

/** Total the invoice will store for these lines (Factura, IVA incl.). */
function invoiceTotalOf(lines: ConsolidationLine[]): number {
  const details = lines.map((l, i) => ({
    id: `c${i}`,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    discount: l.discount > 0 ? l.discount : undefined,
    taxCategory: l.taxCategory,
    productId: l.productId ?? '',
    productName: l.productName,
    obsItem: '',
    createdAt: '',
    updatedAt: '',
  })) as InvoiceDetail[];
  return computeTotals(details, InvoiceType.Factura).totalAmount;
}

/** Sale time of a ticket — completion when known (parked carts), else creation. */
export function ticketSaleTime(ticket: Pick<Ticket, 'completedAt' | 'createdAt'>): string {
  return ticket.completedAt ?? ticket.createdAt;
}

/**
 * Aggregate ticket lines per product + unit price (free-text items per
 * name + price), summing quantities and discounts.
 */
export function aggregateTickets(tickets: Ticket[]): ConsolidationPreview {
  const groups = new Map<string, {
    productId?: string;
    productCode?: string;
    productName: string;
    unitPrice: number;
    quantity: number;
    grossSum: number;      // Σ qty·price
    discountSum: number;   // Σ line discounts + allocated ticket discount
    taxCategory: TaxCategory;
    ticketIds: Set<string>;
  }>();

  const groupFor = (line: Ticket['items'][number]) => {
    const key = lineKey(line);
    let g = groups.get(key);
    if (!g) {
      g = {
        productId: line.productId,
        productCode: line.productCode,
        productName: line.productName,
        unitPrice: line.unitPrice,
        quantity: 0,
        grossSum: 0,
        discountSum: 0,
        taxCategory: line.taxCategory ?? TaxCategory.GRAVADO,
        ticketIds: new Set(),
      };
      groups.set(key, g);
    }
    return g;
  };

  for (const ticket of tickets) {
    if (hasReturns(ticket)) {
      // Kept units only: gross of the kept quantity, and the discount that
      // brings it down to the kept value (line value − refunds, whole cents).
      for (const kept of keptLines(ticket)) {
        if (kept.keptQuantity <= 0) continue;
        const line = ticket.items[kept.index];
        const gross = kept.keptQuantity * line.unitPrice;
        const g = groupFor(line);
        g.quantity += kept.keptQuantity;
        g.grossSum += gross;
        g.discountSum += gross - kept.keptValueCents / 100;
        g.ticketIds.add(ticket.id);
      }
      continue;
    }
    const nets = ticket.items.map((line) => {
      const gross = Math.max(0, line.quantity) * line.unitPrice;
      const lineDiscount = Math.min(Math.max(0, line.discount ?? 0), gross);
      return { gross, lineDiscount, net: gross - lineDiscount };
    });
    // Same clamp as computeTicketAmounts: the ticket discount never exceeds
    // the lines total after line discounts.
    const linesNetCents = toCents(nets.reduce((s, n) => s + n.net, 0));
    const ticketDiscountCents = Math.min(toCents(Math.max(0, ticket.discountTotal ?? 0)), linesNetCents);
    const allocated = allocateCents(ticketDiscountCents, nets.map((n) => n.net));

    ticket.items.forEach((line, i) => {
      const g = groupFor(line);
      g.quantity += Math.max(0, line.quantity);
      g.grossSum += nets[i].gross;
      g.discountSum += nets[i].lineDiscount + allocated[i] / 100;
      g.ticketIds.add(ticket.id);
    });
  }

  const lines: ConsolidationLine[] = [];
  for (const [key, g] of groups) {
    if (g.quantity <= 0) continue;
    // Kept-unit lines can carry a sub-cent negative discount (price with more
    // than two decimals): never below 0 — the residual pass absorbs the cent.
    const discount = Math.max(0, Math.min(round2(g.discountSum), round2(g.grossSum)));
    lines.push({
      key,
      productId: g.productId,
      productCode: g.productCode,
      productName: g.productName,
      quantity: g.quantity,
      unitPrice: g.unitPrice,
      taxCategory: g.taxCategory,
      discount,
      lineTotal: round2(g.grossSum - discount),
      ticketCount: g.ticketIds.size,
    });
  }

  // What the register kept: the sale minus its partial-return refunds.
  const ticketsTotal = round2(tickets.reduce((s, t) => s + ticketKeptAmount(t), 0));
  const roundingTotal = round2(tickets.reduce((s, t) => s + (t.roundingAdjustment ?? 0), 0));
  const expectedInvoiceTotal = round2(ticketsTotal - roundingTotal);

  // Residual cents: tickets round per ticket, the invoice per line
  // (computeTotals' half-up money rounding) — with prices of more than two
  // decimals they can disagree by a cent per ticket. Measure against the real
  // invoice computation and absorb the residual into line discounts so the
  // draft equals the register; anything larger is reported, never hidden.
  const grossByKey = new Map(lines.map((l) => [l.key, groups.get(l.key)!.grossSum]));
  const expectedCents = toCents(expectedInvoiceTotal);
  let residual = toCents(invoiceTotalOf(lines)) - expectedCents;
  const maxAbsorb = Math.max(1, tickets.length) * 2;
  for (let guard = 0; residual !== 0 && Math.abs(residual) <= maxAbsorb && guard < 2 * lines.length + 4; guard += 1) {
    let moved = false;
    for (const line of [...lines].sort((a, b) => b.lineTotal - a.lineTotal)) {
      const gross = grossByKey.get(line.key) ?? 0;
      const discountCents = toCents(line.discount);
      // Positive residual → more discount (bounded by the line gross);
      // negative → less discount (bounded by the discount it has).
      const room = residual > 0 ? Math.floor(gross * 100 + 1e-6) - discountCents : discountCents;
      if (room <= 0) continue;
      const step = Math.sign(residual) * Math.min(Math.abs(residual), room);
      line.discount = round2((discountCents + step) / 100);
      line.lineTotal = round2(gross - line.discount);
      moved = true;
      break;
    }
    if (!moved) break;
    residual = toCents(invoiceTotalOf(lines)) - expectedCents;
  }

  // Stable, readable order: catalog products first, then by name, then price.
  lines.sort((a, b) => {
    if (!!a.productId !== !!b.productId) return a.productId ? -1 : 1;
    return a.productName.localeCompare(b.productName) || a.unitPrice - b.unitPrice;
  });

  // The draft's own total (Factura view; a CCF re-derives IVA from the base).
  const totalAmount = invoiceTotalOf(lines);
  let exemptTotal = 0;
  for (const line of lines) {
    if (line.taxCategory !== TaxCategory.GRAVADO) exemptTotal = round2(exemptTotal + line.lineTotal);
  }
  const gravado = round2(totalAmount - exemptTotal);
  const dates = tickets.map(ticketSaleTime).sort();

  return {
    lines,
    totalAmount,
    taxIncluded: round2(gravado - gravado / 1.13),
    exemptTotal,
    ticketCount: tickets.length,
    dateFrom: dates[0] ?? '',
    dateTo: dates[dates.length - 1] ?? '',
    needsLibrosSplit:
      tickets.some((t) => t.excludeFromLibrosIVA) &&
      tickets.some((t) => !t.excludeFromLibrosIVA),
    ticketsTotal,
    roundingTotal,
    expectedInvoiceTotal,
    difference: round2(totalAmount - expectedInvoiceTotal),
  };
}

/** Split a mixed selection into the two homogeneous groups (Libros IVA rule). */
export function splitByLibrosExclusion(tickets: Ticket[]): { included: Ticket[]; excluded: Ticket[] } {
  return {
    included: tickets.filter((t) => !t.excludeFromLibrosIVA),
    excluded: tickets.filter((t) => t.excludeFromLibrosIVA),
  };
}

/**
 * Map aggregated lines to CreateInvoiceInput items. Prices stay
 * IVA-INCLUSIVE — the same storage convention as manually created invoices —
 * so `computeTotals` and `DTEMappingService.formatFromProductDetail` apply
 * the single /1.13 decomposition for CCF. (A previous version divided here,
 * which made computeTotals divide a second time and understate the CCF
 * base.) Line discounts ride along in the same IVA-inclusive terms, and the
 * POS tax category travels with each line.
 */
export function toInvoiceItems(
  preview: ConsolidationPreview,
): Array<{
  quantity: number;
  productId: string;
  productName: string;
  unitPrice: number;
  discount?: number;
  taxCategory: TaxCategory;
  obsItem: string;
}> {
  return preview.lines.map((line) => ({
    quantity: line.quantity,
    productId: line.productId ?? '',
    productName: line.productName,
    unitPrice: line.unitPrice,
    discount: line.discount > 0 ? line.discount : undefined,
    taxCategory: line.taxCategory,
    obsItem: line.taxCategory !== TaxCategory.GRAVADO ? 'línea no gravada (ticket POS)' : '',
  }));
}

/** Tickets whose sale counts in a period: completed or already invoiced. */
export function isSaleTicket(ticket: Pick<Ticket, 'status'>): boolean {
  return ticket.status === 'COMPLETED' || ticket.status === 'CONSOLIDATED';
}

export interface ConsolidationReconciliation {
  /** Every sale of the period / cierre (any consolidation state). */
  period: { count: number; amount: number };
  /** Already inside another invoice or reserved by another draft. */
  alreadyInvoiced: { count: number; amount: number };
  /** Sales of a closed Z voided afterwards (refunded in a later Z). */
  voidedLater: { count: number; amount: number };
  /** Available but left out of this draft by the operator. */
  removed: { count: number; amount: number; tickets: Ticket[] };
  /** Going into this draft (kept amounts — partial returns already out). */
  included: { count: number; amount: number };
  /**
   * Partial returns of the period's standing sales: the refunds of partially
   * returned tickets plus the whole amount of fully returned ones (which are
   * never offered). `count` = tickets with returns.
   */
  returned: { count: number; amount: number };
  /** period === alreadyInvoiced + voidedLater + removed + included + returned. */
  balanced: boolean;
}

/**
 * Compare the period's sales with what this consolidation will invoice, so the
 * operator sees exactly which sales stay out (and why) before confirming.
 * `periodSales` are the tickets that were sales of the period — for a Z that
 * includes tickets voided after it closed (shown apart); OPEN tickets and
 * tickets voided inside a date range must not be passed.
 */
export function reconcileSelection(
  periodSales: Ticket[],
  selectedIds: Set<string>,
): ConsolidationReconciliation {
  const sales = periodSales.filter((t) => isSaleTicket(t) || t.status === 'VOID');
  const sumTotal = (list: Ticket[]) => round2(list.reduce((s, t) => s + t.totalAmount, 0));
  // Standing sales count what they KEPT; their refunds go to `returned`.
  const sumKept = (list: Ticket[]) => round2(list.reduce((s, t) => s + ticketKeptAmount(t), 0));
  const voidedLater = sales.filter((t) => t.status === 'VOID');
  const live = sales.filter((t) => t.status !== 'VOID');
  const fullyReturned = live.filter((t) => t.status === 'COMPLETED' && !t.invoiceId && !t.pendingInvoiceId && isFullyReturned(t));
  const rest = live.filter((t) => !fullyReturned.includes(t));
  const invoiced = rest.filter((t) => t.status === 'CONSOLIDATED' || !!t.invoiceId || (!!t.pendingInvoiceId && !selectedIds.has(t.id)));
  const available = rest.filter((t) => !invoiced.includes(t));
  const included = available.filter((t) => selectedIds.has(t.id));
  const removed = available.filter((t) => !selectedIds.has(t.id));
  const withReturns = live.filter(hasReturns);
  const returnedAmount = round2(
    sumTotal(fullyReturned) + rest.reduce((s, t) => s + ticketRefundTotal(t), 0),
  );
  const period = { count: sales.length, amount: sumTotal(sales) };
  const parts = round2(sumKept(invoiced) + sumTotal(voidedLater) + sumKept(removed) + sumKept(included) + returnedAmount);
  return {
    period,
    alreadyInvoiced: { count: invoiced.length, amount: sumKept(invoiced) },
    voidedLater: { count: voidedLater.length, amount: sumTotal(voidedLater) },
    removed: { count: removed.length, amount: sumKept(removed), tickets: removed },
    included: { count: included.length, amount: sumKept(included) },
    returned: { count: withReturns.length, amount: returnedAmount },
    balanced: parts === period.amount,
  };
}

/** El Salvador calendar date (YYYYMMDD) for internal POS invoice numbers. */
export function svDateStamp(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}${get('month')}${get('day')}`;
}

export interface ConsolidatedInvoiceCheck {
  ok: boolean;
  /** Spanish, operator-facing reasons the draft must not be sent. */
  problems: string[];
  /** Σ kept amounts (totalAmount − partial-return refunds) of the present tickets. */
  ticketsTotal: number;
  /** Σ partial-return refunds of the present tickets (not invoiced). */
  refundTotal: number;
  roundingTotal: number;
  expectedTotal: number;
  invoiceTotal: number;
  difference: number;
  /** Σ ticket.totalAmount of the present tickets (before refunds and rounding). */
  grossTotal: number;
  /** IVA percepción (+) / IVA retención (−) / renta (−) stored on the invoice — NOT sales. */
  perception: number;
  retention: number;
  /** What the customer pays: invoiceTotal + perception − retention (= "Total" of the invoice). */
  payableTotal: number;
}

/**
 * Before a consolidated draft goes to Hacienda: every source ticket must still
 * exist, be a standing sale reserved for THIS invoice (not voided, not taken
 * by another draft or invoice), and the draft must equal their sales minus
 * cash rounding. Catches drafts edited after consolidation, tickets voided or
 * re-reserved meanwhile, and legacy drafts built with averaged prices.
 */
export function checkConsolidatedInvoice(
  invoice: {
    id: string;
    sourceTicketIds?: string[];
    totals?: { totalAmount?: number; totalPagar?: number; ivaPerci1?: number; ivaRete1?: number; reteRenta?: number } | null;
  },
  tickets: Ticket[],
): ConsolidatedInvoiceCheck {
  const ids = invoice.sourceTicketIds ?? [];
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const problems: string[] = [];
  const present: Ticket[] = [];
  for (const id of ids) {
    const t = byId.get(id);
    if (!t) {
      problems.push('Falta un ticket de esta factura en este equipo (¿aún sincronizando?).');
      continue;
    }
    const label = formatTicketNumber(t);
    if (t.status === 'VOID') problems.push(`El ticket ${label} fue anulado después de crear el borrador.`);
    else if (t.invoiceId && t.invoiceId !== invoice.id) problems.push(`El ticket ${label} ya está en otra factura.`);
    else if (t.pendingInvoiceId && t.pendingInvoiceId !== invoice.id) problems.push(`El ticket ${label} está reservado por otro borrador.`);
    else present.push(t);
  }
  // Kept amounts: a ticket's partial returns never reach the invoice.
  const ticketsTotal = round2(present.reduce((s, t) => s + ticketKeptAmount(t), 0));
  const grossTotal = round2(present.reduce((s, t) => s + t.totalAmount, 0));
  const refundTotal = round2(present.reduce((s, t) => s + ticketRefundTotal(t), 0));
  const roundingTotal = round2(present.reduce((s, t) => s + (t.roundingAdjustment ?? 0), 0));
  const expectedTotal = round2(ticketsTotal - roundingTotal);
  const invoiceTotal = round2(invoice.totals?.totalAmount ?? 0);
  const difference = round2(invoiceTotal - expectedTotal);
  const perception = round2(invoice.totals?.ivaPerci1 ?? 0);
  const retention = round2((invoice.totals?.ivaRete1 ?? 0) + (invoice.totals?.reteRenta ?? 0));
  const payableTotal = round2(invoice.totals?.totalPagar ?? invoiceTotal + perception - retention);
  if (problems.length === 0 && difference !== 0) {
    problems.push(
      `La factura ($${invoiceTotal.toFixed(2)}) no cuadra con la venta de sus tickets ($${expectedTotal.toFixed(2)}). Elimina el borrador y vuelve a consolidar.`,
    );
  }
  return {
    ok: problems.length === 0, problems, ticketsTotal, refundTotal, roundingTotal, expectedTotal, invoiceTotal, difference,
    grossTotal, perception, retention, payableTotal,
  };
}
