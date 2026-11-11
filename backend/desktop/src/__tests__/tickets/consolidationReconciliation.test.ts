// Cierre de caja → Factura (2026-10-31): the consolidated draft must equal the
// tickets' sales minus cash rounding, computed with the same computeTotals the
// invoice stores. Each case here was a real mismatch before the fix.

import {
  aggregateTickets,
  allocateCents,
  checkConsolidatedInvoice,
  reconcileSelection,
  toInvoiceItems,
} from '@/services/tickets/ConsolidationService';
import { computeClosingTotals } from '@/services/tickets/ClosingService';
import { computeTotals } from '@/utils/invoiceTotals';
import { InvoiceType, type InvoiceDetail } from '@/types/invoice';
import { TaxCategory } from '@/types/product';
import { cashRoundingAdjustment, computeTicketAmounts, type Ticket } from '@/types/ticket';

let seq = 0;
function sale(
  lines: Array<{ pid?: string; name: string; q: number; p: number; d?: number }>,
  opts: { discountTotal?: number; rounding?: 'NONE' | 'NEAREST_0.05'; status?: Ticket['status'] } = {},
): Ticket {
  seq += 1;
  const items = lines.map((l, i) => ({
    id: `l${i}`,
    productId: l.pid,
    productName: l.name,
    quantity: l.q,
    unitPrice: l.p,
    discount: l.d,
    lineTotal: Math.round((l.q * l.p - (l.d ?? 0)) * 100) / 100,
  }));
  const pre = computeTicketAmounts({ lines: items, discountTotal: opts.discountTotal });
  const roundingAdjustment = cashRoundingAdjustment(pre.totalAmount, opts.rounding ?? 'NONE');
  const amounts = computeTicketAmounts({ lines: items, discountTotal: opts.discountTotal, roundingAdjustment });
  const at = new Date(2026, 9, 31, 9, seq).toISOString();
  return {
    id: `t${seq}`,
    companyId: 'co',
    sequential: seq,
    status: opts.status ?? 'COMPLETED',
    items,
    payments: [{ id: `p${seq}`, method: 'EFECTIVO', amount: amounts.totalAmount }],
    discountTotal: opts.discountTotal,
    roundingAdjustment,
    totalAmount: amounts.totalAmount,
    taxIncluded: amounts.taxIncluded,
    exemptTotal: amounts.exemptTotal,
    createdAt: at,
    completedAt: at,
    printedCount: 0,
    updatedAt: at,
  };
}

/** What the stored invoice will charge (the real computeTotals). */
function draftTotal(tickets: Ticket[], type = InvoiceType.Factura): number {
  const items = toInvoiceItems(aggregateTickets(tickets)).map((item, i) => ({
    ...item,
    id: `d${i}`,
    createdAt: '',
    updatedAt: '',
  })) as InvoiceDetail[];
  return computeTotals(items, type).totalAmount;
}

function expectReconciles(tickets: Ticket[]) {
  const z = computeClosingTotals(tickets);
  const preview = aggregateTickets(tickets);
  expect(preview.difference).toBe(0);
  for (const type of [InvoiceType.Factura, InvoiceType.CCF]) {
    expect(draftTotal(tickets, type)).toBeCloseTo(z.grossTotal - preview.roundingTotal, 2);
  }
  for (const line of preview.lines) {
    expect(line.lineTotal).toBeGreaterThanOrEqual(0);
    expect(line.discount).toBeLessThanOrEqual(line.unitPrice * line.quantity + 1e-9);
  }
}

describe('consolidated draft equals the day\'s sales', () => {
  it('same product sold at two prices', () => {
    expectReconciles([
      sale([{ pid: 'A', name: 'Pan', q: 100, p: 1 }]),
      sale([{ pid: 'A', name: 'Pan', q: 1, p: 1.5 }]),
    ]);
    expectReconciles([
      sale([{ pid: 'B', name: 'Dulce', q: 2, p: 0.35 }]),
      sale([{ pid: 'B', name: 'Dulce', q: 1, p: 0.4 }]),
    ]);
  });

  it('cash rounding stays out of the invoice and is reported', () => {
    const tickets = Array.from({ length: 10 }, () => sale([{ pid: 'C', name: 'Soda', q: 1, p: 1.13 }], { rounding: 'NEAREST_0.05' }));
    const preview = aggregateTickets(tickets);
    expect(preview.ticketsTotal).toBe(11.5);       // what the register charged
    expect(preview.roundingTotal).toBe(0.2);       // 10 × +$0.02
    expect(preview.expectedInvoiceTotal).toBe(11.3);
    expect(draftTotal(tickets)).toBe(11.3);
    expectReconciles(tickets);
  });

  it('a ticket discount never pushes an already free line negative', () => {
    // Line 1 is 100% discounted; a $5 ticket discount used to apportion $2.50
    // onto it (line −$2.50) and computeTotals clamped it → draft $7.50 for $5.
    const t = sale([{ pid: 'D', name: 'Regalo', q: 1, p: 10, d: 10 }, { pid: 'E', name: 'Café', q: 1, p: 10 }], { discountTotal: 5 });
    expect(t.totalAmount).toBe(5);
    expect(draftTotal([t])).toBe(5);
    expectReconciles([t]);
  });

  it('ticket discounts are allocated in whole cents (no drift over many tickets)', () => {
    const tickets = Array.from({ length: 30 }, () =>
      sale([{ pid: 'F', name: 'X', q: 1, p: 1 }, { pid: 'G', name: 'Y', q: 1, p: 1 }, { pid: 'H', name: 'Z', q: 1, p: 1 }], { discountTotal: 0.1 }),
    );
    expectReconciles(tickets);
    expect(draftTotal(tickets)).toBe(87);
  });

  it('absorbs per-ticket rounding of prices with more than two decimals', () => {
    const tickets = Array.from({ length: 3 }, () => sale([{ pid: 'I', name: 'Tercio', q: 1, p: 0.333 }]));
    expect(tickets.reduce((s, t) => s + t.totalAmount, 0)).toBeCloseTo(0.99, 2);
    expectReconciles(tickets);
  });

  it('exempt POS lines keep their category and still reconcile (no IVA on them)', () => {
    const tickets = [
      sale([{ pid: 'J', name: 'Gaseosa', q: 2, p: 1.13 }, { pid: 'K', name: 'Libro', q: 1, p: 10 }], { discountTotal: 1 }),
      sale([{ pid: 'K', name: 'Libro', q: 1, p: 10 }]),
    ];
    tickets[0].items[1].taxCategory = TaxCategory.EXENTO;
    tickets[1].items[0].taxCategory = TaxCategory.EXENTO;
    const items = toInvoiceItems(aggregateTickets(tickets));
    expect(items.filter((i) => i.taxCategory === (TaxCategory.EXENTO))).toHaveLength(1);
    expectReconciles(tickets);
    const details = items.map((item, i) => ({ ...item, id: `x${i}`, createdAt: '', updatedAt: '' })) as InvoiceDetail[];
    const ccf = computeTotals(details, InvoiceType.CCF);
    // IVA only on the gravado part.
    expect(ccf.tax).toBeLessThan(0.3);
  });

  it('randomized days of sales always reconcile (2-decimal prices, line/ticket discounts, cash rounding)', () => {
    let s = 7;
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const prices = [0.35, 0.99, 1.13, 2.15, 4.99, 12.5, 0.333, 2.135];
    for (let run = 0; run < 300; run += 1) {
      const tickets = Array.from({ length: 1 + Math.floor(rnd() * 8) }, () => {
        const lines = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => {
          const p = prices[Math.floor(rnd() * prices.length)];
          const q = 1 + Math.floor(rnd() * 4);
          const d = Math.round(q * p * [0, 0, 10, 33][Math.floor(rnd() * 4)]) / 100;
          return { pid: `P${Math.floor(rnd() * 5)}`, name: 'x', q, p, d: d || undefined };
        });
        return sale(lines, { discountTotal: [0, 0.1, 0.25][Math.floor(rnd() * 3)], rounding: rnd() > 0.5 ? 'NEAREST_0.05' : 'NONE' });
      });
      const preview = aggregateTickets(tickets);
      expect(preview.difference).toBe(0);
      for (const type of [InvoiceType.Factura, InvoiceType.CCF]) {
        expect(Math.round(draftTotal(tickets, type) * 100)).toBe(Math.round(preview.expectedInvoiceTotal * 100));
      }
    }
  });

  it('allocateCents always sums exactly', () => {
    expect(allocateCents(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(allocateCents(0, [1, 2])).toEqual([0, 0]);
    expect(allocateCents(7, [0, 0])).toEqual([0, 0]);
    expect(allocateCents(101, [33, 33, 34]).reduce((s, v) => s + v, 0)).toBe(101);
  });
});

describe('reconcileSelection — what stays out of the factura', () => {
  it('lists removed tickets and balances against the period', () => {
    const a = sale([{ pid: 'A', name: 'Pan', q: 1, p: 2 }]);
    const b = sale([{ pid: 'A', name: 'Pan', q: 1, p: 3 }]);
    const c = { ...sale([{ pid: 'A', name: 'Pan', q: 1, p: 4 }]), status: 'CONSOLIDATED' as const, invoiceId: 'inv-old' };
    const voidedAfterZ = { ...sale([{ pid: 'A', name: 'Pan', q: 1, p: 5 }]), status: 'VOID' as const, voidedAt: '2026-11-01T10:00:00.000Z' };
    const r = reconcileSelection([a, b, c, voidedAfterZ], new Set([a.id]));
    expect(r.period).toEqual({ count: 4, amount: 14 });
    expect(r.included).toEqual({ count: 1, amount: 2 });
    expect(r.removed.count).toBe(1);
    expect(r.removed.tickets[0].id).toBe(b.id);
    expect(r.alreadyInvoiced).toEqual({ count: 1, amount: 4 });
    expect(r.voidedLater).toEqual({ count: 1, amount: 5 });
    expect(r.balanced).toBe(true);
  });
});

describe('checkConsolidatedInvoice — send-time guard', () => {
  const invoiceFor = (tickets: Ticket[], total: number, id = 'inv-1') => ({
    id,
    sourceTicketIds: tickets.map((t) => t.id),
    totals: { totalAmount: total },
  });

  it('passes when every ticket is reserved here and the totals match', () => {
    const t = { ...sale([{ pid: 'A', name: 'Pan', q: 2, p: 1.5 }]), pendingInvoiceId: 'inv-1' };
    expect(checkConsolidatedInvoice(invoiceFor([t], 3), [t]).ok).toBe(true);
  });

  it('blocks a draft edited after consolidation (or built with averaged prices)', () => {
    const t = { ...sale([{ pid: 'A', name: 'Pan', q: 2, p: 1.5 }]), pendingInvoiceId: 'inv-1' };
    const check = checkConsolidatedInvoice(invoiceFor([t], 2.5), [t]);
    expect(check.ok).toBe(false);
    expect(check.difference).toBe(-0.5);
    expect(check.problems[0]).toMatch(/no cuadra/);
  });

  it('blocks voided tickets, tickets of another draft and missing tickets', () => {
    const voided = { ...sale([{ name: 'A', q: 1, p: 1 }]), status: 'VOID' as const, voidedAt: 'x' };
    const other = { ...sale([{ name: 'B', q: 1, p: 1 }]), pendingInvoiceId: 'inv-2' };
    const check = checkConsolidatedInvoice(
      { id: 'inv-1', sourceTicketIds: [voided.id, other.id, 'gone'], totals: { totalAmount: 2 } },
      [voided, other],
    );
    expect(check.ok).toBe(false);
    expect(check.problems.join(' ')).toMatch(/anulado/);
    expect(check.problems.join(' ')).toMatch(/otro borrador/);
    expect(check.problems.join(' ')).toMatch(/Falta un ticket/);
  });

  it('subtracts cash rounding before comparing', () => {
    const t = { ...sale([{ pid: 'C', name: 'Soda', q: 1, p: 1.13 }], { rounding: 'NEAREST_0.05' }), pendingInvoiceId: 'inv-1' };
    expect(t.totalAmount).toBe(1.15);
    expect(checkConsolidatedInvoice(invoiceFor([t], 1.13), [t]).ok).toBe(true);
  });
});
