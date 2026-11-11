// POS Phase 2 — partial returns (design §8): refund math with the
// consolidation's whole-cent discount allocation, guards, the Z (refunds by
// return date / per method / expected cash, void remainder) and consolidation
// of the kept units (invariant draft == Σ (total − refunds) − Σ rounding).

import {
  buildTicketReturn,
  computeReturnRefund,
  isFullyReturned,
  keptLines,
  lineValueCents,
  returnBlockedReason,
  returnedItemsByProduct,
  ticketKeptAmount,
  validateReturnRequest,
  voidRefundByMethod,
  RETURN_CREDIT_NOTE_HINT,
} from '@/services/tickets/TicketReturns';
import {
  aggregateTickets,
  checkConsolidatedInvoice,
  reconcileSelection,
  toInvoiceItems,
} from '@/services/tickets/ConsolidationService';
import { computeCashSummary, computeRangeTotals, computeZReport } from '@/services/tickets/ClosingService';
import { computeTotals } from '@/utils/invoiceTotals';
import { InvoiceType, type InvoiceDetail } from '@/types/invoice';
import {
  cashRoundingAdjustment,
  computeTicketAmounts,
  type PaymentMethod,
  type Ticket,
} from '@/types/ticket';

let seq = 0;
function sale(
  lines: Array<{ pid?: string; name?: string; q: number; p: number; d?: number }>,
  opts: { discountTotal?: number; rounding?: 'NONE' | 'NEAREST_0.05'; method?: PaymentMethod; at?: string; status?: Ticket['status'] } = {},
): Ticket {
  seq += 1;
  const items = lines.map((l, i) => ({
    id: `t${seq}l${i}`,
    productId: l.pid,
    productName: l.name ?? l.pid ?? 'x',
    quantity: l.q,
    unitPrice: l.p,
    discount: l.d,
    lineTotal: Math.round((l.q * l.p - (l.d ?? 0)) * 100) / 100,
  }));
  const pre = computeTicketAmounts({ lines: items, discountTotal: opts.discountTotal });
  const roundingAdjustment = cashRoundingAdjustment(pre.totalAmount, opts.rounding ?? 'NONE');
  const amounts = computeTicketAmounts({ lines: items, discountTotal: opts.discountTotal, roundingAdjustment });
  const at = opts.at ?? new Date(2026, 9, 31, 9, seq).toISOString();
  return {
    id: `t${seq}`,
    companyId: 'co',
    sequential: seq,
    status: opts.status ?? 'COMPLETED',
    items,
    payments: [{ id: `p${seq}`, method: opts.method ?? 'EFECTIVO', amount: amounts.totalAmount }],
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

/** Apply a return (validated) to a ticket copy. */
function withReturn(ticket: Ticket, lines: Array<[number, number]>, method: PaymentMethod = 'EFECTIVO', at?: string): Ticket {
  const ret = buildTicketReturn(ticket, {
    requested: lines.map(([i, q]) => ({ lineId: ticket.items[i].id, quantity: q })),
    method,
    reason: 'cliente devolvió',
    createdAt: at,
  });
  return { ...ticket, returns: [...(ticket.returns ?? []), ret] };
}

function draftTotal(tickets: Ticket[], type = InvoiceType.Factura): number {
  const items = toInvoiceItems(aggregateTickets(tickets)).map((item, i) => ({
    ...item, id: `d${i}`, createdAt: '', updatedAt: '',
  })) as InvoiceDetail[];
  return computeTotals(items, type).totalAmount;
}

const expectedOf = (tickets: Ticket[]) =>
  Math.round(tickets.reduce((s, t) => s + ticketKeptAmount(t) - (t.roundingAdjustment ?? 0), 0) * 100) / 100;

describe('refund math (spec scenarios)', () => {
  it('Return one unit: 3 × $2.00, one unit back → $2.00', () => {
    const t = sale([{ pid: 'A', q: 3, p: 2 }]);
    const { amount, lines } = computeReturnRefund(t, [{ lineId: t.items[0].id, quantity: 1 }]);
    expect(amount).toBe(2);
    expect(lines).toEqual([{ lineId: t.items[0].id, quantity: 1, amount: 2 }]);
  });

  it('Return with ticket discount: 2 × $5.00 with a $1.00 ticket discount, one unit back → $4.50', () => {
    const t = sale([{ pid: 'A', q: 2, p: 5 }], { discountTotal: 1 });
    expect(t.totalAmount).toBe(9);
    expect(computeReturnRefund(t, [{ lineId: t.items[0].id, quantity: 1 }]).amount).toBe(4.5);
  });

  it('line values use the consolidation allocation and add up to the charged total (minus rounding)', () => {
    const t = sale([{ pid: 'A', q: 1, p: 1 }, { pid: 'B', q: 1, p: 1 }, { pid: 'C', q: 1, p: 1 }], { discountTotal: 0.1, rounding: 'NEAREST_0.05' });
    const values = lineValueCents(t);
    expect(values.reduce((s, v) => s + v, 0)).toBe(Math.round((t.totalAmount - (t.roundingAdjustment ?? 0)) * 100));
    expect(values).toEqual([96, 97, 97]); // $0.10 → 4 + 3 + 3 cents off, largest remainder like allocateCents
  });

  it('cumulative refunds: returning unit by unit refunds exactly the line value in the end', () => {
    let t = sale([{ pid: 'A', q: 3, p: 1 }], { discountTotal: 0.1 }); // value 290 cents
    const refunds: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      t = withReturn(t, [[0, 1]]);
      refunds.push(t.returns![t.returns!.length - 1].refund.amount);
    }
    expect(refunds).toEqual([0.97, 0.96, 0.97]);
    expect(refunds.reduce((s, v) => s + v, 0)).toBeCloseTo(2.9, 10);
    expect(isFullyReturned(t)).toBe(true);
    expect(ticketKeptAmount(t)).toBe(0);
    expect(returnBlockedReason(t)).toMatch(/ya fueron devueltas/);
  });

  it('decimal (weighable) quantities return proportionally', () => {
    const t = sale([{ pid: 'K', q: 1.25, p: 4 }]); // $5.00
    expect(computeReturnRefund(t, [{ lineId: t.items[0].id, quantity: 0.5 }]).amount).toBe(2);
  });
});

describe('return guards', () => {
  it('refused on consolidated / pending tickets with the credit-note guidance', () => {
    const consolidated = { ...sale([{ pid: 'A', q: 1, p: 2 }]), status: 'CONSOLIDATED' as const, invoiceId: 'inv1', invoiceControlNumber: 'DTE-01-X' };
    expect(returnBlockedReason(consolidated)).toContain(RETURN_CREDIT_NOTE_HINT);
    expect(returnBlockedReason(consolidated)).toContain('Emite una nota de crédito sobre la factura');
    const pending = { ...sale([{ pid: 'A', q: 1, p: 2 }]), pendingInvoiceId: 'draft1' };
    expect(returnBlockedReason(pending)).toMatch(/borrador de factura/);
    expect(returnBlockedReason(pending)).toMatch(/nota de crédito/);
    expect(() => buildTicketReturn(pending, { requested: [{ lineId: pending.items[0].id, quantity: 1 }], method: 'EFECTIVO', reason: 'x' })).toThrow(/borrador/);
    expect(returnBlockedReason({ ...sale([{ pid: 'A', q: 1, p: 2 }]), status: 'VOID', voidedAt: 'x' })).toMatch(/anulado/);
    expect(returnBlockedReason({ ...sale([{ pid: 'A', q: 1, p: 2 }]), status: 'OPEN' })).toMatch(/cobrados/);
  });

  it('never returns more than what is left of a line; needs units and a reason', () => {
    const t = withReturn(sale([{ pid: 'A', q: 3, p: 2 }]), [[0, 2]]);
    expect(validateReturnRequest(t, [{ lineId: t.items[0].id, quantity: 2 }])).toMatch(/Solo quedan 1/);
    expect(validateReturnRequest(t, [{ lineId: t.items[0].id, quantity: 0 }])).toMatch(/al menos una unidad/);
    expect(validateReturnRequest(t, [{ lineId: 'nope', quantity: 1 }])).toMatch(/no pertenece/);
    expect(() => buildTicketReturn(t, { requested: [{ lineId: t.items[0].id, quantity: 1 }], method: 'EFECTIVO', reason: '  ' })).toThrow(/motivo/);
    expect(keptLines(t)[0]).toMatchObject({ soldQuantity: 3, returnedQuantity: 2, keptQuantity: 1, keptValueCents: 200 });
  });

  it('void after a partial return: restock and refund only the remainder', () => {
    const t = withReturn(sale([{ pid: 'A', q: 3, p: 2 }, { pid: 'B', q: 1, p: 4 }]), [[0, 1]]);
    expect(returnedItemsByProduct(t)).toEqual([{ productId: 'A', quantity: 1, productName: 'A' }]);
    expect(ticketKeptAmount(t)).toBe(8);
    expect(voidRefundByMethod(t)).toEqual({ EFECTIVO: 8 });
    // A card sale refunded in cash first: the void pays the rest by card.
    const card = withReturn(sale([{ pid: 'A', q: 2, p: 5 }], { method: 'TARJETA_POS' }), [[0, 1]], 'EFECTIVO');
    expect(voidRefundByMethod(card)).toEqual({ TARJETA_POS: 5 });
  });
});

describe('returns in the Z', () => {
  const day = (h: number, m = 0) => new Date(2026, 9, 31, h, m).toISOString();

  it('Return one unit: the next Z shows a $2.00 cash refund and expected cash drops by $2.00', () => {
    const t = sale([{ pid: 'A', q: 3, p: 2 }], { at: day(9) });
    const firstZ = computeZReport([t], null, day(12));
    expect(firstZ.grossTotal).toBe(6);
    const returned = withReturn(t, [[0, 1]], 'EFECTIVO', day(14));
    const secondZ = computeZReport([returned], day(12), day(18));
    expect(secondZ.ticketCount).toBe(0);
    expect(secondZ.refunds).toEqual({ count: 1, amount: 2, byMethod: { EFECTIVO: 2 } });
    expect(secondZ.byMethod.EFECTIVO.refundAmount).toBe(2);
    expect(secondZ.netTotal).toBe(-2);
    const cash = computeCashSummary({ totals: secondZ, openingFloat: 50 });
    expect(cash.cashRefunds).toBe(2);
    expect(cash.expected).toBe(48);
  });

  it('a return inside the sale\'s own range nets out; a ticket sold+returned+voided in the range refunds nothing twice', () => {
    const t = withReturn(sale([{ pid: 'A', q: 3, p: 2 }], { at: day(9) }), [[0, 1]], 'EFECTIVO', day(10));
    const z = computeRangeTotals([t], day(8), day(18));
    expect(z.grossTotal).toBe(6);
    expect(z.refunds?.amount).toBe(2);
    expect(z.netTotal).toBe(4);
    expect(computeCashSummary({ totals: z }).expected).toBe(4);

    const voided = { ...t, status: 'VOID' as const, voidedAt: day(11) };
    const zVoid = computeRangeTotals([voided], day(8), day(18));
    expect(zVoid.voidedCount).toBe(1);
    expect(zVoid.refunds?.count).toBe(0);
    expect(computeCashSummary({ totals: zVoid }).expected).toBe(0);
  });

  it('an earlier-Z sale returned and then voided in this Z refunds return + remainder = the whole sale', () => {
    const t = sale([{ pid: 'A', q: 3, p: 2 }], { at: day(9) });
    const returned = withReturn(t, [[0, 1]], 'EFECTIVO', day(14));
    const voided = { ...returned, status: 'VOID' as const, voidedAt: day(15) };
    const z = computeZReport([voided], day(12), day(18));
    expect(z.refunds?.amount).toBe(2);
    expect(z.priorVoidAmount).toBe(4);
    expect(z.byMethod.EFECTIVO.refundAmount).toBe(6);
    expect(z.netTotal).toBe(-6);
  });

  it('returns are counted on the register that paid them', () => {
    const peerSale = { ...sale([{ pid: 'A', q: 2, p: 5 }], { at: day(9) }), registerId: 'C2' };
    const ret = buildTicketReturn(peerSale, { requested: [{ lineId: peerSale.items[0].id, quantity: 1 }], method: 'EFECTIVO', reason: 'x', registerId: 'C1', createdAt: day(10) });
    const t = { ...peerSale, returns: [ret] };
    const c1 = computeRangeTotals([t], day(8), day(18), { registerId: 'C1' });
    expect(c1.ticketCount).toBe(0);
    expect(c1.refunds?.amount).toBe(5);
    const c2 = computeRangeTotals([t], day(8), day(18), { registerId: 'C2' });
    expect(c2.grossTotal).toBe(10);
    expect(c2.refunds?.count).toBe(0);
  });
});

describe('consolidation of kept units', () => {
  it('Consolidation invoices only what was kept: quantity 2, draft $4.00, reconciliation balances', () => {
    const t = withReturn(sale([{ pid: 'A', q: 3, p: 2 }]), [[0, 1]]);
    const preview = aggregateTickets([t]);
    expect(preview.lines).toHaveLength(1);
    expect(preview.lines[0]).toMatchObject({ quantity: 2, unitPrice: 2, lineTotal: 4 });
    expect(preview.ticketsTotal).toBe(4);
    expect(preview.expectedInvoiceTotal).toBe(4);
    expect(preview.difference).toBe(0);
    expect(draftTotal([t])).toBe(4);
    expect(draftTotal([t], InvoiceType.CCF)).toBe(4);
    const recon = reconcileSelection([t], new Set([t.id]));
    expect(recon.included).toEqual({ count: 1, amount: 4 });
    expect(recon.returned).toEqual({ count: 1, amount: 2 });
    expect(recon.period.amount).toBe(6);
    expect(recon.balanced).toBe(true);
  });

  it('the kept unit keeps its share of the ticket discount', () => {
    const t = withReturn(sale([{ pid: 'A', q: 2, p: 5 }], { discountTotal: 1 }), [[0, 1]]);
    const preview = aggregateTickets([t]);
    expect(preview.lines[0]).toMatchObject({ quantity: 1, discount: 0.5, lineTotal: 4.5 });
    expect(draftTotal([t])).toBe(4.5);
  });

  it('a fully returned ticket contributes nothing and lands in "returned"', () => {
    const full = withReturn(sale([{ pid: 'A', q: 1, p: 3 }]), [[0, 1]]);
    const kept = sale([{ pid: 'A', q: 1, p: 3 }]);
    expect(aggregateTickets([full, kept]).lines[0].quantity).toBe(1);
    const recon = reconcileSelection([full, kept], new Set([kept.id]));
    expect(recon.returned).toEqual({ count: 1, amount: 3 });
    expect(recon.removed.count).toBe(0);
    expect(recon.balanced).toBe(true);
  });

  it('checkConsolidatedInvoice compares against kept amounts', () => {
    const t = { ...withReturn(sale([{ pid: 'A', q: 3, p: 2 }]), [[0, 1]]), pendingInvoiceId: 'inv-1' };
    const ok = checkConsolidatedInvoice({ id: 'inv-1', sourceTicketIds: [t.id], totals: { totalAmount: 4 } }, [t]);
    expect(ok).toMatchObject({ ok: true, ticketsTotal: 4, refundTotal: 2, difference: 0 });
    const stale = checkConsolidatedInvoice({ id: 'inv-1', sourceTicketIds: [t.id], totals: { totalAmount: 6 } }, [t]);
    expect(stale.ok).toBe(false);
    expect(stale.difference).toBe(2);
  });

  it('randomized days with partial returns always reconcile (Factura and CCF)', () => {
    let s = 11;
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const prices = [0.35, 0.99, 1.13, 2.15, 4.99, 12.5, 0.333, 2.135];
    let returnsSeen = 0;
    for (let run = 0; run < 300; run += 1) {
      const tickets = Array.from({ length: 1 + Math.floor(rnd() * 8) }, () => {
        const lines = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => {
          const p = prices[Math.floor(rnd() * prices.length)];
          const q = 1 + Math.floor(rnd() * 4);
          const d = Math.round(q * p * [0, 0, 10, 33][Math.floor(rnd() * 4)]) / 100;
          return { pid: `P${Math.floor(rnd() * 5)}`, q, p, d: d || undefined };
        });
        let t = sale(lines, { discountTotal: [0, 0.1, 0.25][Math.floor(rnd() * 3)], rounding: rnd() > 0.5 ? 'NEAREST_0.05' : 'NONE' });
        // 0–2 partial returns of random units.
        for (let r = Math.floor(rnd() * 3); r > 0; r -= 1) {
          const options = keptLines(t).filter((l) => l.keptQuantity > 0);
          if (options.length === 0) break;
          const pick = options[Math.floor(rnd() * options.length)];
          t = withReturn(t, [[pick.index, 1 + Math.floor(rnd() * pick.keptQuantity)]]);
          returnsSeen += 1;
        }
        return t;
      });
      const offered = tickets.filter((t) => !isFullyReturned(t));
      if (offered.length === 0) continue;
      const preview = aggregateTickets(offered);
      expect(preview.expectedInvoiceTotal).toBeCloseTo(expectedOf(offered), 10);
      expect(preview.difference).toBe(0);
      for (const type of [InvoiceType.Factura, InvoiceType.CCF]) {
        expect(Math.round(draftTotal(offered, type) * 100)).toBe(Math.round(preview.expectedInvoiceTotal * 100));
      }
      for (const line of preview.lines) expect(line.lineTotal).toBeGreaterThanOrEqual(0);
      expect(reconcileSelection(tickets, new Set(offered.map((t) => t.id))).balanced).toBe(true);
    }
    expect(returnsSeen).toBeGreaterThan(100);
  });
});
