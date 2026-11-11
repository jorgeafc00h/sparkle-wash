// Partial returns ("Devolución") — pure money math shared by the return
// dialog, TicketDatabase.addReturn, closings and consolidation.
// See openspec/changes/add-pos-phase-2/design.md §8.
//
// Line values: what each line of a ticket really charged, in whole cents —
// the line's net (after its own discount) minus its share of the ticket
// discount, allocated exactly as ConsolidationService does (largest remainder
// over the line nets), so a return refunds precisely the value the invoice
// would have declared for those units. Σ line values === totalAmount −
// roundingAdjustment (the cash coin adjustment is never refunded per unit).
//
// Refunds are cumulative per line: after n of q units have come back the line
// has refunded round(value × n / q) cents in total, so returning the last unit
// refunds exactly what is left and a fully returned line refunds its value.

import { round2, type PaymentMethod, type Ticket, type TicketReturn, type TicketReturnLine } from '@/types/ticket';

export const toCents = (value: number): number =>
  Math.round((value + (value >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100);

/** Split `totalCents` over `weights` (largest remainder) — Σ result === totalCents. */
export function allocateCents(totalCents: number, weights: number[]): number[] {
  const sumWeights = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (totalCents <= 0 || sumWeights <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (totalCents * Math.max(0, w)) / sumWeights);
  const result = raw.map((r) => Math.floor(r));
  let rest = totalCents - result.reduce((s, v) => s + v, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rest > 0 && order.length > 0; k = (k + 1) % order.length) {
    result[order[k].i] += 1;
    rest -= 1;
  }
  return result;
}

/** Quantities keep 3 decimals (weighable units); everything else is integer. */
export const roundQty = (value: number): number => Math.round((value + Number.EPSILON) * 1000) / 1000;

export interface TicketLineNet {
  gross: number;
  lineDiscount: number;
  net: number;
}

/** Per-line gross / clamped line discount / net — the consolidation's view of a line. */
export function lineNets(ticket: Pick<Ticket, 'items'>): TicketLineNet[] {
  return ticket.items.map((line) => {
    const gross = Math.max(0, line.quantity) * line.unitPrice;
    const lineDiscount = Math.min(Math.max(0, line.discount ?? 0), gross);
    return { gross, lineDiscount, net: gross - lineDiscount };
  });
}

/** Whole-cent ticket discount allocated to each line (same as ConsolidationService). */
export function ticketDiscountAllocation(ticket: Pick<Ticket, 'items' | 'discountTotal'>, nets = lineNets(ticket)): number[] {
  const linesNetCents = toCents(nets.reduce((s, n) => s + n.net, 0));
  const ticketDiscountCents = Math.min(toCents(Math.max(0, ticket.discountTotal ?? 0)), linesNetCents);
  return allocateCents(ticketDiscountCents, nets.map((n) => n.net));
}

/**
 * Value each line charged, in cents. Σ === toCents(totalAmount − roundingAdjustment)
 * (any residual cent from prices with more than two decimals goes to the
 * largest lines, never below 0 nor above the line gross).
 */
export function lineValueCents(ticket: Pick<Ticket, 'items' | 'discountTotal' | 'totalAmount' | 'roundingAdjustment'>): number[] {
  const nets = lineNets(ticket);
  const allocated = ticketDiscountAllocation(ticket, nets);
  const values = nets.map((n, i) => Math.max(0, toCents(n.net) - allocated[i]));
  const target = Math.max(0, toCents((ticket.totalAmount ?? 0) - (ticket.roundingAdjustment ?? 0)));
  let residual = target - values.reduce((s, v) => s + v, 0);
  const order = values.map((v, i) => i).sort((a, b) => values[b] - values[a] || a - b);
  for (let guard = 0; residual !== 0 && guard < 4 * values.length + 4; guard += 1) {
    let moved = false;
    for (const i of order) {
      const cap = Math.floor(nets[i].gross * 100 + 1e-6);
      const room = residual > 0 ? cap - values[i] : values[i];
      if (room <= 0) continue;
      const step = Math.sign(residual) * Math.min(Math.abs(residual), room);
      values[i] += step;
      residual -= step;
      moved = true;
      break;
    }
    if (!moved) break;
  }
  return values;
}

/** Units already returned per line id. */
export function returnedQuantities(ticket: Pick<Ticket, 'returns'>): Map<string, number> {
  const map = new Map<string, number>();
  for (const ret of ticket.returns ?? []) {
    for (const line of ret.lines) map.set(line.lineId, roundQty((map.get(line.lineId) ?? 0) + Math.max(0, line.quantity)));
  }
  return map;
}

/** Cents already refunded per line id. */
export function refundedCentsByLine(ticket: Pick<Ticket, 'returns'>): Map<string, number> {
  const map = new Map<string, number>();
  for (const ret of ticket.returns ?? []) {
    for (const line of ret.lines) map.set(line.lineId, (map.get(line.lineId) ?? 0) + toCents(Math.max(0, line.amount)));
  }
  return map;
}

/** Σ refunds of the ticket's partial returns. */
export function ticketRefundTotal(ticket: Pick<Ticket, 'returns'>): number {
  return round2((ticket.returns ?? []).reduce((s, r) => s + (r.refund?.amount ?? 0), 0));
}

/** What the ticket kept after its partial returns (totalAmount − Σ refunds). */
export function ticketKeptAmount(ticket: Pick<Ticket, 'returns' | 'totalAmount'>): number {
  return round2((ticket.totalAmount ?? 0) - ticketRefundTotal(ticket));
}

export function hasReturns(ticket: Pick<Ticket, 'returns'>): boolean {
  return (ticket.returns?.length ?? 0) > 0;
}

export interface KeptLine {
  index: number;
  lineId: string;
  soldQuantity: number;
  returnedQuantity: number;
  keptQuantity: number;
  valueCents: number;
  refundedCents: number;
  keptValueCents: number;
}

/** Per line: sold, returned and kept units and values. */
export function keptLines(ticket: Ticket): KeptLine[] {
  const values = lineValueCents(ticket);
  const returned = returnedQuantities(ticket);
  const refunded = refundedCentsByLine(ticket);
  return ticket.items.map((line, index) => {
    const soldQuantity = Math.max(0, line.quantity);
    const returnedQuantity = Math.min(soldQuantity, returned.get(line.id) ?? 0);
    const refundedCents = Math.min(values[index], refunded.get(line.id) ?? 0);
    return {
      index,
      lineId: line.id,
      soldQuantity,
      returnedQuantity,
      keptQuantity: roundQty(soldQuantity - returnedQuantity),
      valueCents: values[index],
      refundedCents,
      keptValueCents: values[index] - refundedCents,
    };
  });
}

/** Every unit of every line came back (the ticket is final but stays COMPLETED). */
export function isFullyReturned(ticket: Ticket): boolean {
  if (!hasReturns(ticket) || ticket.items.length === 0) return false;
  return keptLines(ticket).every((l) => l.keptQuantity <= 0);
}

// ── Guards ─────────────────────────────────────────────────────────────────

export const RETURN_CREDIT_NOTE_HINT = 'Emite una nota de crédito sobre la factura.';

/** Why a ticket can't take a (new) partial return — null when it can. */
export function returnBlockedReason(ticket: Ticket): string | null {
  if (ticket.status === 'CONSOLIDATED' || ticket.invoiceId) {
    return `El ticket ya está facturado${ticket.invoiceControlNumber ? ` (${ticket.invoiceControlNumber})` : ''}. ${RETURN_CREDIT_NOTE_HINT}`;
  }
  if (ticket.pendingInvoiceId) {
    return `El ticket está en un borrador de factura: quítalo de la consolidación antes de devolver. Si la factura ya se envió, ${RETURN_CREDIT_NOTE_HINT.charAt(0).toLowerCase()}${RETURN_CREDIT_NOTE_HINT.slice(1)}`;
  }
  if (ticket.status === 'VOID') return 'El ticket está anulado.';
  if (ticket.status !== 'COMPLETED') return 'Solo se pueden devolver tickets cobrados.';
  if (isFullyReturned(ticket)) return 'Todas las unidades de este ticket ya fueron devueltas.';
  return null;
}

export interface ReturnRequestLine {
  lineId: string;
  quantity: number;
}

/** Validation of the requested units (null = OK). */
export function validateReturnRequest(ticket: Ticket, requested: ReturnRequestLine[]): string | null {
  const blocked = returnBlockedReason(ticket);
  if (blocked) return blocked;
  const wanted = requested.filter((r) => Number(r.quantity) > 0);
  if (wanted.length === 0) return 'Indica al menos una unidad a devolver.';
  const kept = new Map(keptLines(ticket).map((l) => [l.lineId, l]));
  const seen = new Set<string>();
  for (const r of wanted) {
    const line = kept.get(r.lineId);
    if (!line) return 'La línea a devolver no pertenece a este ticket.';
    if (seen.has(r.lineId)) return 'Línea repetida en la devolución.';
    seen.add(r.lineId);
    const qty = roundQty(Number(r.quantity));
    if (!Number.isFinite(qty) || qty <= 0) return 'Cantidad inválida.';
    if (qty > line.keptQuantity + 1e-9) {
      const name = ticket.items[line.index].productName;
      return `Solo quedan ${line.keptQuantity} unidad(es) de "${name}" por devolver.`;
    }
  }
  return null;
}

/** Refund lines for the requested units (cumulative per-line cents). Assumes a valid request. */
export function computeReturnRefund(ticket: Ticket, requested: ReturnRequestLine[]): { lines: TicketReturnLine[]; amount: number } {
  const kept = new Map(keptLines(ticket).map((l) => [l.lineId, l]));
  const lines: TicketReturnLine[] = [];
  let totalCents = 0;
  for (const r of requested) {
    const qty = roundQty(Number(r.quantity) || 0);
    const line = kept.get(r.lineId);
    if (!line || qty <= 0) continue;
    const take = Math.min(qty, line.keptQuantity);
    if (take <= 0) continue;
    const after = roundQty(line.returnedQuantity + take);
    const cumulative = after >= line.soldQuantity - 1e-9
      ? line.valueCents
      : Math.round((line.valueCents * after) / (line.soldQuantity || 1));
    const cents = Math.max(0, Math.min(line.keptValueCents, cumulative - line.refundedCents));
    totalCents += cents;
    lines.push({ lineId: r.lineId, quantity: take, amount: cents / 100 });
  }
  return { lines, amount: totalCents / 100 };
}

let returnCounter = 0;

/** Build a validated TicketReturn (throws with a Spanish message when refused). */
export function buildTicketReturn(
  ticket: Ticket,
  input: {
    requested: ReturnRequestLine[];
    method: PaymentMethod;
    reason: string;
    createdBy?: string;
    registerId?: string;
    id?: string;
    createdAt?: string;
  },
): TicketReturn {
  const problem = validateReturnRequest(ticket, input.requested);
  if (problem) throw new Error(problem);
  const reason = input.reason.trim();
  if (!reason) throw new Error('Indica el motivo de la devolución.');
  const { lines, amount } = computeReturnRefund(ticket, input.requested);
  returnCounter = (returnCounter + 1) % 1296;
  return {
    id: input.id ?? `ret_${Date.now().toString(36)}${returnCounter.toString(36).padStart(2, '0')}${Math.random().toString(36).slice(2, 6)}`,
    createdAt: input.createdAt ?? new Date().toISOString(),
    createdBy: input.createdBy,
    reason,
    lines,
    refund: { method: input.method, amount: round2(amount) },
    registerId: input.registerId,
  };
}

/**
 * Units still to put back when a ticket WITH returns is voided, per product
 * (the returns already restocked theirs). Lines without a catalog product are
 * skipped, like the void restock.
 */
export function returnedItemsByProduct(ticket: Ticket): Array<{ productId: string; quantity: number; productName?: string }> {
  const returned = returnedQuantities(ticket);
  const byProduct = new Map<string, { productId: string; quantity: number; productName?: string }>();
  for (const line of ticket.items) {
    if (!line.productId) continue;
    const qty = returned.get(line.id) ?? 0;
    if (qty <= 0) continue;
    const entry = byProduct.get(line.productId) ?? { productId: line.productId, quantity: 0, productName: line.productName };
    entry.quantity = roundQty(entry.quantity + qty);
    byProduct.set(line.productId, entry);
  }
  return [...byProduct.values()];
}

/**
 * Refund of a void, per payment method: what each method paid minus what the
 * partial returns already refunded through it; the total equals the ticket's
 * kept amount (any mismatch — a card sale refunded in cash — lands on the
 * largest bucket). Without returns this is exactly the ticket's payments.
 */
export function voidRefundByMethod(ticket: Ticket): Partial<Record<PaymentMethod, number>> {
  const paid = new Map<PaymentMethod, number>();
  for (const p of ticket.payments) paid.set(p.method, round2((paid.get(p.method) ?? 0) + p.amount));
  if (!hasReturns(ticket)) return Object.fromEntries(paid) as Partial<Record<PaymentMethod, number>>;
  for (const r of ticket.returns ?? []) {
    paid.set(r.refund.method, round2((paid.get(r.refund.method) ?? 0) - r.refund.amount));
  }
  const remaining = new Map<PaymentMethod, number>();
  for (const [m, v] of paid) remaining.set(m, Math.max(0, v));
  const target = Math.max(0, ticketKeptAmount(ticket));
  const sum = round2([...remaining.values()].reduce((s, v) => s + v, 0));
  let diff = round2(target - sum);
  if (diff !== 0) {
    const ordered = [...remaining.entries()].sort((a, b) => b[1] - a[1]);
    for (const [m, v] of ordered) {
      if (diff === 0) break;
      const next = Math.max(0, round2(v + diff));
      diff = round2(diff - (next - v));
      remaining.set(m, next);
    }
  }
  const result: Partial<Record<PaymentMethod, number>> = {};
  for (const [m, v] of remaining) if (v > 0) result[m] = v;
  return result;
}
