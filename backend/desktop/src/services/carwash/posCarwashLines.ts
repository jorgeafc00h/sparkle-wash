// Pure helpers that connect carwash jobs with the POS register: building the
// quick cart line for a job, preventing duplicates and deriving the payments
// to record on the API once the sale is saved. No Redux / storage here.

import { TaxCategory } from '@/types/product';
import { round2, type PaymentMethod, type TicketLine } from '@/types/ticket';
import type { CarwashJob, JobPaymentInput, JobPaymentMethod } from './types';

export const POS_PAYMENT_TO_JOB_METHOD: Record<PaymentMethod, JobPaymentMethod> = {
  EFECTIVO: 'cash',
  TARJETA_POS: 'card',
  OTRO: 'other',
};

/** What is still owed on a job (never negative). */
export function jobBalanceUsd(job: Pick<CarwashJob, 'priceUsd' | 'paidUsd'>): number {
  return Math.max(0, round2(job.priceUsd - (job.paidUsd ?? 0)));
}

/** Jobs the register may charge: not cancelled and with a balance. */
export function isChargeableJob(job: CarwashJob): boolean {
  return job.status !== 'cancelled' && jobBalanceUsd(job) > 0;
}

export function carwashLineName(job: Pick<CarwashJob, 'packageName' | 'plate'>): string {
  return `Lavado ${job.packageName} — ${job.plate}`;
}

/** Quick line (no productId) charging the pending balance of `job`. */
export function buildCarwashQuickLine(job: CarwashJob, lineId: string): TicketLine {
  const balance = jobBalanceUsd(job);
  return {
    id: lineId,
    productName: carwashLineName(job),
    quantity: 1,
    unitPrice: balance,
    lineTotal: balance,
    taxCategory: TaxCategory.GRAVADO,
    obs: job.ticketNumber ? `Orden ${job.ticketNumber} · ${job.plate}` : `Placa ${job.plate}`,
    carwashJobId: job.id,
    carwashTicketNumber: job.ticketNumber ?? undefined,
  };
}

/** True when a cart already has a line for this job. */
export function cartHasCarwashJob(cart: ReadonlyArray<Pick<TicketLine, 'carwashJobId'>>, jobId: string): boolean {
  return cart.some((line) => line.carwashJobId === jobId);
}

/**
 * Method recorded on the job for a whole sale: the single payment's method, or
 * for split payments the method that covers most of the total (first wins ties).
 */
export function dominantJobPaymentMethod(payments: ReadonlyArray<{ method: PaymentMethod; amount: number }>): JobPaymentMethod {
  if (payments.length === 0) return 'cash';
  const byMethod = new Map<PaymentMethod, number>();
  for (const p of payments) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amount);
  let best: PaymentMethod = payments[0].method;
  let bestAmount = -Infinity;
  for (const [method, amount] of byMethod) {
    if (amount > bestAmount + 1e-9) {
      best = method;
      bestAmount = amount;
    }
  }
  return POS_PAYMENT_TO_JOB_METHOD[best] ?? 'other';
}

export interface CarwashPaymentDispatch {
  jobId: string;
  payment: JobPaymentInput;
}

/**
 * One payment per carwash line of the completed sale. `saleNumber` is the POS
 * display number ("C1-000123") used as the payment reference.
 */
export function buildCarwashPayments(
  lines: ReadonlyArray<Pick<TicketLine, 'carwashJobId' | 'lineTotal'>>,
  payments: ReadonlyArray<{ method: PaymentMethod; amount: number }>,
  saleNumber: string,
): CarwashPaymentDispatch[] {
  const method = dominantJobPaymentMethod(payments);
  // The API accepts [A-Za-z0-9-] only: "#000123" (no register code) → "000123".
  const reference = saleNumber.replace(/[^A-Za-z0-9-]/g, '').slice(0, 32);
  const seen = new Set<string>();
  const out: CarwashPaymentDispatch[] = [];
  for (const line of lines) {
    if (!line.carwashJobId || seen.has(line.carwashJobId)) continue;
    const amountUsd = round2(line.lineTotal);
    if (!(amountUsd > 0)) continue;
    seen.add(line.carwashJobId);
    out.push({ jobId: line.carwashJobId, payment: { method, amountUsd, ...(reference ? { ticketNumber: reference } : {}) } });
  }
  return out;
}
