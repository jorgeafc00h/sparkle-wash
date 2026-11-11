// POS ticket domain — counter sales (stock discharge + payment record).
// A ticket is NOT a DTE: it prints a non-fiscal receipt and is later
// consolidated into a regular invoice through the DTE pipeline.
// See openspec/changes/add-pos-tickets/design.md §2.

import { TaxCategory } from './product';

export type TicketStatus = 'OPEN' | 'COMPLETED' | 'VOID' | 'CONSOLIDATED';

export type PaymentMethod = 'EFECTIVO' | 'TARJETA_POS' | 'OTRO';

export interface TicketPayment {
  id: string;
  method: PaymentMethod;
  /** Amount applied to the ticket total (IVA incl.). */
  amount: number;
  /** Cash received (EFECTIVO). */
  tendered?: number;
  /** Change returned (EFECTIVO). */
  change?: number;
  /** External POS terminal evidence — typed by the cashier, never full PAN/CVV. */
  posAuthCode?: string;
  posLast4?: string;
  posCardType?: 'VISA' | 'MASTERCARD' | 'AMEX' | 'OTRO';
  posReference?: string;
  note?: string;
}

export interface TicketLine {
  id: string;
  /** Catalog link — undefined for free-text quick items. */
  productId?: string;
  productCode?: string;
  productName: string;
  quantity: number;
  /** IVA INCLUIDO — the retail price the customer pays. */
  unitPrice: number;
  /** quantity * unitPrice − discount, 2-dec rounded. */
  lineTotal: number;
  /** Line-level discount amount (IVA incl.), reason goes in obs. */
  discount?: number;
  /**
   * Percentage (0–100) the line discount was derived from. The UI applies
   * discounts as percentages; the derived amount is what flows into totals,
   * DTE mapping and persistence. When set, quantity changes re-apply it.
   */
  discountPct?: number;
  /** Snapshot from Product.taxCategory at sale time. */
  taxCategory?: TaxCategory;
  obs?: string;
  /** SparkleWash: the carwash job this quick line charges (payment is recorded on the API). */
  carwashJobId?: string;
  /** SparkleWash: work-ticket number of that job ("OT-C1-000045"). */
  carwashTicketNumber?: string;
}

export interface Ticket {
  id: string;
  companyId: string;
  /** Per-company increasing display counter. */
  sequential: number;
  status: TicketStatus;
  items: TicketLine[];
  payments: TicketPayment[];
  /** Ticket-level discount (IVA incl.) applied after lines. */
  discountTotal?: number;
  /** Explicit "Redondeo" line for cash rounding (±). */
  roundingAdjustment?: number;
  /** sum(lineTotal) − discountTotal + roundingAdjustment. */
  totalAmount: number;
  /** Derived from GRAVADO lines only: Σ gravado − Σ gravado/1.13. */
  taxIncluded: number;
  /**
   * Post-discount exempt bucket (from computeTicketAmounts). Persisted so
   * closings don't re-derive it inconsistently; undefined on legacy tickets.
   */
  exemptTotal?: number;
  /**
   * Sale the accountant wants excluded from Libros IVA once consolidated
   * (internal consumption, owner withdrawals, contador criteria). Propagates
   * to Invoice.excludeFromLibrosIVA. Default false.
   */
  excludeFromLibrosIVA?: boolean;
  customerName?: string;
  cashierName?: string;
  createdAt: string;
  completedAt?: string;
  voidedAt?: string;
  voidReason?: string;
  /** Draft invoice this ticket is pending on (set when the consolidation draft is built). */
  pendingInvoiceId?: string;
  /** Invoice that consumed this ticket (set when it reaches Completada). */
  invoiceId?: string;
  invoiceControlNumber?: string;
  consolidatedAt?: string;
  /**
   * Consolidation-release counter (Device Sync). Starts undefined (= 0) and is
   * incremented by TicketDatabase.releaseConsolidation on EVERY ticket it
   * touches (CONSOLIDATED → COMPLETED revert and pending-only reservation
   * clear), in the same write that clears the link. mergeTicket lets the copy
   * with the higher revision decide the consolidation fields (status
   * COMPLETED/CONSOLIDATED, invoiceId, invoiceControlNumber, consolidatedAt,
   * pendingInvoiceId); within one revision the lattice/write-once rules apply,
   * so a newer COMPLETED copy without a link no longer reverts a consolidation.
   */
  consolidationRevision?: number;
  printedCount: number;
  updatedAt: string;
  /**
   * Partial returns ("Devolución", POS Phase 2 design §8), oldest first.
   * Write-once entries merged as a union by id (mergeTicket). Absent on
   * tickets without returns — never stored as an empty array.
   */
  returns?: TicketReturn[];
  /**
   * Register (POS Phase 2 design §1) that rang the sale: the Device Sync
   * device id of the creating device. Absent on legacy tickets (they belong
   * to the register of the device that holds them locally).
   */
  registerId?: string;
  /** Short register code at sale time ("C1") — display number `C1-000123`. */
  registerCode?: string;
  /**
   * Ticket-level discount as typed (percentage, 0–100). `discountTotal` stays
   * the amount that flows into totals; this lets a suspended sale resume with
   * the same percentage.
   */
  discountPct?: number;
}

/** Units of one ticket line given back in a partial return. */
export interface TicketReturnLine {
  /** TicketLine.id */
  lineId: string;
  quantity: number;
  /** Refunded value of those units (IVA incl., after the line discount and its share of the ticket discount). */
  amount: number;
}

/** A partial return of a COMPLETED, un-invoiced ticket. Immutable once written. */
export interface TicketReturn {
  id: string;
  createdAt: string;
  /** Who registered it (active local user / audit actor name). */
  createdBy?: string;
  reason: string;
  lines: TicketReturnLine[];
  /** Σ lines.amount, paid back by `method`. */
  refund: { method: PaymentMethod; amount: number };
  /** Register (device) that paid the refund — the Z it belongs to. */
  registerId?: string;
}

/**
 * Cash drawer session ("Abrir caja") — device-local, not synced (stored by
 * CashDrawerStore under `pos_cash_{companyId}`). The Z closes it.
 */
export interface CashSession {
  id: string;
  companyId: string;
  registerId: string;
  openedAt: string;
  openedBy?: string;
  /** Fondo inicial (≥ 0). */
  openingFloat: number;
  closedAt?: string;
  closingId?: string;
}

/** Cash taken in / out of the drawer during an open session ("Entradas y salidas"). */
export interface CashMovement {
  id: string;
  companyId: string;
  registerId: string;
  sessionId: string;
  kind: 'IN' | 'OUT';
  amount: number;
  reason: string;
  createdAt: string;
  createdBy?: string;
}

/**
 * Arqueo at the Z: expected = openingFloat + cashSales − cashRefunds + cashIn − cashOut;
 * difference = counted − expected (negative = faltante, positive = sobrante).
 */
export interface CashClosingSummary {
  sessionId?: string;
  openingFloat: number;
  /** Σ cash applied to sales of the range (EFECTIVO payment amounts, change already out). */
  cashSales: number;
  /** Cash refunds of the range: partial returns + earlier-Z voids paid back in cash. */
  cashRefunds: number;
  cashIn: number;
  cashOut: number;
  expected: number;
  counted?: number;
  difference?: number;
}

/** End-of-day closing snapshot (Z-report). */
export interface CashClosing {
  id: string;
  companyId: string;
  /** The moment the Z was taken (=== `to`; never the end of the day). */
  closedAt: string;
  /** ISO lower bound (exclusive) — the previous Z's closedAt, or epoch. */
  from: string;
  /** ISO upper bound (inclusive). */
  to: string;
  /** Sales in range + tickets voided in range (audit snapshot). */
  ticketIds: string[];
  totals: ClosingTotals;
  /** Register (device id) the Z belongs to. Legacy closings: undefined (this device). */
  registerId?: string;
  /** Short register code printed on the Z ("C1"), when configured. */
  registerCode?: string;
  /** Arqueo de efectivo (POS Phase 2). Legacy closings: undefined. */
  cash?: CashClosingSummary;
}

/** One row of the Z per-product summary (sold quantity and value of the range). */
export interface ClosingProductTotals {
  key: string;
  name: string;
  quantity: number;
  /** Value charged (IVA incl., after line + apportioned ticket discounts). */
  amount: number;
}

export interface ClosingMethodTotals {
  count: number;
  amount: number;
  cashTendered: number;
  cashChange: number;
  /** Payments of tickets sold in an earlier closing and voided in this one. */
  refundCount?: number;
  refundAmount?: number;
}

export interface ClosingTotals {
  ticketCount: number;
  /** Tickets sold AND voided inside the range (no sale, no refund). */
  voidedCount: number;
  /** Sales of the range (completed or already invoiced). */
  grossTotal: number;
  /** grossTotal − priorVoidAmount: what the period really kept. */
  netTotal: number;
  ivaIncluded: number;
  exemptTotal: number;
  byMethod: Record<PaymentMethod, ClosingMethodTotals>;
  /** Tickets sold in an EARLIER closing and voided inside this one. Optional: legacy closings. */
  priorVoidCount?: number;
  priorVoidAmount?: number;
  /** Σ cash rounding of the range's sales (not invoiced — see ConsolidationService). */
  roundingTotal?: number;
  /** Register the totals were computed for; undefined = every register (X "Todas las cajas"). */
  registerId?: string;
  /** Sales of the range per cashier name ("Sin cajero" when none was recorded). */
  byCashier?: Record<string, { count: number; amount: number }>;
  /** Top products by amount (+ "Otros"), sold in the range. */
  byProduct?: ClosingProductTotals[];
  /** Σ line + ticket discounts of the range's sales. */
  discountTotal?: number;
  /** Partial returns registered in the range (by return date). */
  refunds?: { count: number; amount: number; byMethod: Partial<Record<PaymentMethod, number>> };
}

export interface TicketFilters {
  companyId: string;
  status?: TicketStatus;
  from?: string;
  to?: string;
  method?: PaymentMethod;
  unconsolidatedOnly?: boolean;
  searchTerm?: string;
  /**
   * Also read the monthly archive (design §9) when no date range asks for it.
   * A range (`from`/`to`) reaching archived months reads them automatically;
   * without one only the hot window (current + previous month, plus every
   * OPEN/COMPLETED ticket) is returned.
   */
  includeArchived?: boolean;
}

// ── Pure money math ────────────────────────────────────────────────────────

export const TAX_FACTOR = 1.13;

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** IVA included in an IVA-inclusive amount (gravado bucket). */
export function ivaFromInclusive(amount: number): number {
  return round2(amount - amount / TAX_FACTOR);
}

/**
 * Cash rounding to the nearest 5 cents (US-coin scarcity in El Salvador).
 * Returns the adjustment to ADD to the total (usually ≤ 0.02 magnitude).
 */
export function cashRoundingAdjustment(total: number, mode: 'NONE' | 'NEAREST_0.05'): number {
  if (mode === 'NONE') return 0;
  return round2(Math.round(total * 20) / 20 - total);
}

/**
 * Compute a ticket's derived amounts from its lines/payments inputs.
 * Pure — used by the register UI, the database completion path and tests.
 */
export function computeTicketAmounts(input: {
  lines: Array<{ quantity: number; unitPrice: number; discount?: number; taxCategory?: TaxCategory }>;
  discountTotal?: number;
  roundingAdjustment?: number;
}): { linesTotal: number; totalAmount: number; taxIncluded: number; exemptTotal: number } {
  const linesTotal = round2(
    input.lines.reduce(
      (sum, l) => sum + Math.max(0, l.quantity) * l.unitPrice - (l.discount ?? 0),
      0,
    ),
  );
  const discount = Math.min(Math.max(0, input.discountTotal ?? 0), linesTotal);
  const totalAmount = round2(linesTotal - discount + (input.roundingAdjustment ?? 0));

  // Discounts reduce gravado and exempt buckets proportionally to their share
  // of the lines total, so the derived IVA stays consistent with the charged total.
  const gravadoRaw = input.lines
    .filter((l) => !l.taxCategory || l.taxCategory === TaxCategory.GRAVADO)
    .reduce((sum, l) => sum + Math.max(0, l.quantity) * l.unitPrice - (l.discount ?? 0), 0);
  const exemptRaw = Math.max(0, linesTotal - gravadoRaw);
  const ratio = linesTotal > 0 ? (linesTotal - discount) / linesTotal : 0;
  const gravado = round2(gravadoRaw * ratio);

  return {
    linesTotal,
    totalAmount,
    taxIncluded: ivaFromInclusive(gravado),
    exemptTotal: round2(exemptRaw * ratio),
  };
}
