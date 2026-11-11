// POS ↔ carwash: quick line building, duplicate guard and the payments to
// record on the API once the sale is saved.
import {
  POS_PAYMENT_TO_JOB_METHOD,
  buildCarwashPayments,
  buildCarwashQuickLine,
  cartHasCarwashJob,
  dominantJobPaymentMethod,
  isChargeableJob,
  jobBalanceUsd,
} from '@/services/carwash/posCarwashLines';
import { TaxCategory } from '@/types/product';
import type { CarwashJob } from '@/services/carwash/types';

const job = (over: Partial<CarwashJob> = {}): CarwashJob => ({
  id: 'job-1', arrivalId: 'a', plate: 'P123-456', vehicleClass: 'suv', packageId: 'full', packageName: 'Completo',
  services: [], priceUsd: 12, currency: 'USD', status: 'in_progress', arrivalAt: '2026-10-31T21:00:00Z',
  startedAt: null, completedAt: null, cancelledAt: null, elapsedSeconds: 0, activeSeconds: null, transitions: [], assignments: [],
  ticketNumber: 'OT-C1-000045', paidUsd: 0, paymentStatus: 'unpaid', ...over,
});

describe('quick line', () => {
  it('prices at the pending balance, GRAVADO, no productId, with plate/ticket in obs and the job link', () => {
    const line = buildCarwashQuickLine(job({ paidUsd: 4.5, paymentStatus: 'partial' }), 'line-1');
    expect(line).toMatchObject({
      id: 'line-1', productName: 'Lavado Completo — P123-456', quantity: 1, unitPrice: 7.5, lineTotal: 7.5,
      taxCategory: TaxCategory.GRAVADO, carwashJobId: 'job-1', carwashTicketNumber: 'OT-C1-000045',
    });
    expect(line.productId).toBeUndefined();
    expect(line.obs).toContain('OT-C1-000045');
    expect(line.obs).toContain('P123-456');
  });

  it('camera jobs without a ticket number still carry the plate', () => {
    const line = buildCarwashQuickLine(job({ ticketNumber: null }), 'l');
    expect(line.obs).toContain('P123-456');
    expect(line.carwashTicketNumber).toBeUndefined();
  });

  it('balance and chargeability ignore paid and cancelled jobs', () => {
    expect(jobBalanceUsd(job({ paidUsd: 20 }))).toBe(0);
    expect(isChargeableJob(job())).toBe(true);
    expect(isChargeableJob(job({ paidUsd: 12 }))).toBe(false);
    expect(isChargeableJob(job({ status: 'cancelled' }))).toBe(false);
  });

  it('the same job cannot be added twice', () => {
    const cart = [buildCarwashQuickLine(job(), 'l1')];
    expect(cartHasCarwashJob(cart, 'job-1')).toBe(true);
    expect(cartHasCarwashJob(cart, 'job-2')).toBe(false);
  });
});

describe('payment method mapping', () => {
  it('EFECTIVO→cash, TARJETA_POS→card, OTRO→other', () => {
    expect(POS_PAYMENT_TO_JOB_METHOD).toEqual({ EFECTIVO: 'cash', TARJETA_POS: 'card', OTRO: 'other' });
    expect(dominantJobPaymentMethod([{ method: 'TARJETA_POS', amount: 10 }])).toBe('card');
  });

  it('split payments use the method covering most of the total', () => {
    expect(dominantJobPaymentMethod([{ method: 'EFECTIVO', amount: 5 }, { method: 'TARJETA_POS', amount: 15 }])).toBe('card');
    expect(dominantJobPaymentMethod([{ method: 'EFECTIVO', amount: 5 }, { method: 'OTRO', amount: 3 }, { method: 'OTRO', amount: 3 }])).toBe('other');
    expect(dominantJobPaymentMethod([{ method: 'EFECTIVO', amount: 10 }, { method: 'OTRO', amount: 10 }])).toBe('cash');
  });
});

describe('payments to record after the sale', () => {
  const lines = [
    { carwashJobId: 'job-1', lineTotal: 12 },
    { carwashJobId: undefined, lineTotal: 3 },
    { carwashJobId: 'job-2', lineTotal: 7.5 },
    { carwashJobId: 'job-1', lineTotal: 12 },
  ];

  it('one payment per carwash line with the sale number as reference', () => {
    const out = buildCarwashPayments(lines, [{ method: 'EFECTIVO', amount: 22.5 }], 'C1-000123');
    expect(out).toEqual([
      { jobId: 'job-1', payment: { method: 'cash', amountUsd: 12, ticketNumber: 'C1-000123' } },
      { jobId: 'job-2', payment: { method: 'cash', amountUsd: 7.5, ticketNumber: 'C1-000123' } },
    ]);
  });

  it('strips "#" from register-less numbers (API accepts [A-Za-z0-9-] only) and skips zero lines', () => {
    const out = buildCarwashPayments([{ carwashJobId: 'j', lineTotal: 5 }, { carwashJobId: 'z', lineTotal: 0 }], [{ method: 'TARJETA_POS', amount: 5 }], '#000123');
    expect(out).toEqual([{ jobId: 'j', payment: { method: 'card', amountUsd: 5, ticketNumber: '000123' } }]);
  });

  it('a sale without carwash lines records nothing', () => {
    expect(buildCarwashPayments([{ carwashJobId: undefined, lineTotal: 3 }], [{ method: 'EFECTIVO', amount: 3 }], 'C1-1')).toEqual([]);
  });
});
