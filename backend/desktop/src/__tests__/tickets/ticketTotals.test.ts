// Money math for POS tickets — discounts, cash rounding, gravado/exempt IVA
// derivation. See openspec/changes/add-pos-tickets/design.md §2 "Money rules".

import {
  cashRoundingAdjustment,
  computeTicketAmounts,
  ivaFromInclusive,
  round2,
} from '@/types/ticket';
import { TaxCategory } from '@/types/product';

describe('round2', () => {
  it('rounds half-up to cents', () => {
    expect(round2(2.675)).toBe(2.68);
    expect(round2(1.005)).toBe(1.01);
  });
});

describe('ivaFromInclusive', () => {
  it('extracts the IVA from an IVA-inclusive amount', () => {
    expect(ivaFromInclusive(1.13)).toBe(0.13);
    expect(ivaFromInclusive(8.5)).toBe(0.98);
  });
});

describe('cashRoundingAdjustment', () => {
  it('is zero in NONE mode', () => {
    expect(cashRoundingAdjustment(10.02, 'NONE')).toBe(0);
  });

  it('adjusts to the nearest 5 cents in NEAREST_0.05', () => {
    expect(cashRoundingAdjustment(10.02, 'NEAREST_0.05')).toBe(-0.02); // → 10.00
    expect(cashRoundingAdjustment(10.04, 'NEAREST_0.05')).toBe(0.01);  // → 10.05
    expect(cashRoundingAdjustment(10.07, 'NEAREST_0.05')).toBe(-0.02); // → 10.05
    expect(cashRoundingAdjustment(10.00, 'NEAREST_0.05')).toBe(0);     // exact
  });
});

describe('computeTicketAmounts', () => {
  it('sums lines and derives IVA for an all-gravado ticket', () => {
    const amounts = computeTicketAmounts({
      lines: [
        { quantity: 2, unitPrice: 3.0 },
        { quantity: 1, unitPrice: 2.5 },
      ],
    });
    expect(amounts.linesTotal).toBe(8.5);
    expect(amounts.totalAmount).toBe(8.5);
    expect(amounts.taxIncluded).toBe(ivaFromInclusive(8.5));
    expect(amounts.exemptTotal).toBe(0);
  });

  it('applies line discounts before totals', () => {
    const amounts = computeTicketAmounts({
      lines: [{ quantity: 1, unitPrice: 10.0, discount: 1.5 }],
    });
    expect(amounts.linesTotal).toBe(8.5);
    expect(amounts.totalAmount).toBe(8.5);
  });

  it('applies ticket discount and keeps the derived IVA consistent', () => {
    const amounts = computeTicketAmounts({
      lines: [{ quantity: 2, unitPrice: 5.0 }], // 10.00
      discountTotal: 2.0,
    });
    expect(amounts.totalAmount).toBe(8.0);
    // Gravado bucket scaled proportionally: 8.00 charged → IVA of 8.00.
    expect(amounts.taxIncluded).toBe(ivaFromInclusive(8.0));
  });

  it('splits gravado and exempt buckets', () => {
    const amounts = computeTicketAmounts({
      lines: [
        { quantity: 1, unitPrice: 8.7, taxCategory: TaxCategory.GRAVADO },
        { quantity: 1, unitPrice: 1.3, taxCategory: TaxCategory.EXENTO },
      ],
    });
    expect(amounts.totalAmount).toBe(10.0);
    // IVA only from the 8.70 gravado portion.
    expect(amounts.taxIncluded).toBe(ivaFromInclusive(8.7));
    expect(amounts.exemptTotal).toBe(1.3);
  });

  it('includes the explicit rounding adjustment in the total', () => {
    const amounts = computeTicketAmounts({
      lines: [{ quantity: 1, unitPrice: 10.02 }],
      roundingAdjustment: 0.03,
    });
    expect(amounts.totalAmount).toBe(10.05);
  });
});
