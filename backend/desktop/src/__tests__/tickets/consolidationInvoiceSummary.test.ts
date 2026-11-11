// Invoice detail ↔ tickets summary: the reconciliation must explain every cent
// between Σ tickets and the invoice's "Total" (retention / percepción / rounding).
import { aggregateTickets, toInvoiceItems, checkConsolidatedInvoice } from '@/services/tickets/ConsolidationService';
import { computeTotals } from '@/utils/invoiceTotals';
import { InvoiceType } from '@/types/invoice';
import { cashRoundingAdjustment, computeTicketAmounts, type Ticket } from '@/types/ticket';

let seq = 0;
function sale(q: number, p: number, rounding: 'NONE' | 'NEAREST_0.05' = 'NONE'): Ticket {
  seq += 1;
  const items = [{ id: 'l', productId: 'p1', productName: 'X', quantity: q, unitPrice: p, lineTotal: q * p }];
  const r = cashRoundingAdjustment(computeTicketAmounts({ lines: items }).totalAmount, rounding);
  const a = computeTicketAmounts({ lines: items, roundingAdjustment: r });
  const at = new Date(2026, 10, 9, 9, seq).toISOString();
  return {
    id: `t${seq}`, companyId: 'c', sequential: seq, status: 'COMPLETED', items, payments: [],
    roundingAdjustment: r, totalAmount: a.totalAmount, taxIncluded: a.taxIncluded, exemptTotal: a.exemptTotal,
    createdAt: at, completedAt: at, printedCount: 0, updatedAt: at,
  } as Ticket;
}

function check(type: InvoiceType, ret: boolean, perc: boolean) {
  const ts = [sale(3, 12.37, 'NEAREST_0.05'), sale(7, 9.99, 'NEAREST_0.05'), sale(1, 45.5)];
  const items = toInvoiceItems(aggregateTickets(ts)).map((i, n) => ({ ...i, id: `d${n}`, createdAt: '', updatedAt: '' })) as never;
  const totals = computeTotals(items, type, ret, { applyIvaPerception: perc });
  return { ts, totals, chk: checkConsolidatedInvoice({ id: 'inv', sourceTicketIds: ts.map((t) => t.id), totals }, ts) };
}

describe('consolidated invoice summary', () => {
  it('walks tickets → facturable → payable with no unexplained cents', () => {
    for (const type of [InvoiceType.Factura, InvoiceType.CCF]) {
      for (const [ret, perc] of [[false, false], [true, false], [false, true]] as const) {
        const { totals, chk } = check(type, ret, perc);
        expect(chk.ok).toBe(true);
        // gross − refunds − rounding = facturable = invoice total
        expect(Math.round((chk.grossTotal - chk.refundTotal - chk.roundingTotal) * 100)).toBe(Math.round(chk.expectedTotal * 100));
        expect(chk.invoiceTotal).toBe(chk.expectedTotal);
        // facturable + percepción − retención = the invoice's "Total" (totalPagar)
        expect(Math.round((chk.invoiceTotal + chk.perception - chk.retention) * 100)).toBe(Math.round(chk.payableTotal * 100));
        expect(chk.payableTotal).toBe(totals.totalPagar);
      }
    }
  });

  it('reports percepción and retención separately from sales', () => {
    const perc = check(InvoiceType.CCF, false, true).chk;
    expect(perc.perception).toBeGreaterThan(0);
    expect(perc.payableTotal).toBeGreaterThan(perc.invoiceTotal);
    const ret = check(InvoiceType.CCF, true, false).chk;
    expect(ret.retention).toBeGreaterThan(0);
    expect(ret.payableTotal).toBeLessThan(ret.invoiceTotal);
  });
});
