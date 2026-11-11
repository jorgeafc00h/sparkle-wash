// Split payments (POS Phase 2, design §2) — pure balance math shared by the
// payment dialog, the register's completion guard and Jest.
//
// Rules:
//  • Payments are added until the balance is 0 (± half a cent).
//  • A non-cash payment can never exceed the remaining balance.
//  • Change only comes from cash: Σ (tendered − amount) over cash rows.
//  • $0.05 cash rounding applies only when the WHOLE sale is settled with a
//    single cash payment; any split (or any non-cash row) charges the exact total.

import type { PaymentMethod } from '@/types/ticket';
import { round2 } from '@/types/ticket';

export const BALANCE_EPSILON = 0.005;

export interface SplitPaymentRow {
  method: PaymentMethod;
  /** Applied to the ticket total. */
  amount: number;
  /** Cash handed over (EFECTIVO only); undefined = exact. */
  tendered?: number;
}

export function sumPaymentAmounts(rows: Array<Pick<SplitPaymentRow, 'amount'>>): number {
  return round2(rows.reduce((sum, row) => sum + (Number.isFinite(row.amount) ? row.amount : 0), 0));
}

/**
 * What the customer owes: the cash-rounded total only while the sale can
 * still be settled by one cash payment for the whole amount (no rows yet, the
 * entry is cash and not a partial amount); otherwise the exact total.
 */
export function amountDue(input: {
  exactTotal: number;
  cashTotal?: number;
  rows: SplitPaymentRow[];
  entryMethod?: PaymentMethod;
  /** Amount typed in the entry form (undefined/NaN = "the whole balance"). */
  entryAmount?: number;
}): number {
  const cashTotal = input.cashTotal ?? input.exactTotal;
  if (input.rows.length > 0 || input.entryMethod !== 'EFECTIVO') return round2(input.exactTotal);
  const typed = input.entryAmount;
  const partial = typed !== undefined && Number.isFinite(typed) && typed > 0 && typed < cashTotal - BALANCE_EPSILON;
  return round2(partial ? input.exactTotal : cashTotal);
}

export function remainingBalance(due: number, rows: SplitPaymentRow[]): number {
  return round2(Math.max(0, due - sumPaymentAmounts(rows)));
}

export function isSettled(due: number, rows: SplitPaymentRow[]): boolean {
  return Math.abs(round2(due - sumPaymentAmounts(rows))) < BALANCE_EPSILON;
}

/** An entry amount clamped to (0, remaining]. Empty / invalid → the whole remaining balance. */
export function capToRemaining(amount: number | undefined, remaining: number): number {
  if (amount === undefined || !Number.isFinite(amount) || amount <= 0) return round2(remaining);
  return round2(Math.min(amount, remaining));
}

/** True when the typed amount was above the balance (the UI says it was capped). */
export function exceedsRemaining(amount: number | undefined, remaining: number): boolean {
  return amount !== undefined && Number.isFinite(amount) && amount > remaining + BALANCE_EPSILON;
}

/** Change of one row: only cash returns change. */
export function changeFor(row: SplitPaymentRow): number {
  if (row.method !== 'EFECTIVO') return 0;
  const tendered = row.tendered ?? row.amount;
  return round2(Math.max(0, tendered - row.amount));
}

export function totalChange(rows: SplitPaymentRow[]): number {
  return round2(rows.reduce((sum, row) => sum + changeFor(row), 0));
}

/** Rounding eligibility of a finished payment list. */
export function isSingleCashSettlement(payments: Array<Pick<SplitPaymentRow, 'method'>>): boolean {
  return payments.length === 1 && payments[0].method === 'EFECTIVO';
}

/**
 * Final guard before a sale is saved: amounts positive, cash tendered covers
 * its amount, and the rows add up exactly to the total. Returns the Spanish
 * reason or null.
 */
export function validateSplitPayments(total: number, payments: SplitPaymentRow[]): string | null {
  if (payments.length === 0) return 'Agrega al menos un pago.';
  for (const payment of payments) {
    if (!Number.isFinite(payment.amount) || payment.amount <= 0) return 'Cada pago debe ser mayor que $0.00.';
    if (payment.method === 'EFECTIVO' && payment.tendered !== undefined && payment.tendered + BALANCE_EPSILON < payment.amount) {
      return 'El efectivo recibido no cubre el monto del pago.';
    }
  }
  const diff = round2(total - sumPaymentAmounts(payments));
  if (diff > BALANCE_EPSILON) return `Saldo pendiente: $${diff.toFixed(2)}.`;
  if (diff < -BALANCE_EPSILON) return `Los pagos exceden el total por $${Math.abs(diff).toFixed(2)}.`;
  return null;
}
