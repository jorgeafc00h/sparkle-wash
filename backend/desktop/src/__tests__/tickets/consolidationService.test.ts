// Consolidation aggregation — grouping, weighted prices, Libros split,
// discounts surviving into invoice items.

import { aggregateTickets, splitByLibrosExclusion, toInvoiceItems } from '@/services/tickets/ConsolidationService';
import { TaxCategory } from '@/types/product';
import type { Ticket } from '@/types/ticket';

let seq = 0;
function ticket(over: Partial<Ticket> & Pick<Ticket, 'items'>): Ticket {
  seq += 1;
  const base: Ticket = {
    id: `t${seq}`,
    companyId: 'co',
    sequential: seq,
    status: 'COMPLETED',
    items: over.items,
    payments: [],
    totalAmount: over.items.reduce((s, l) => s + l.lineTotal, 0),
    taxIncluded: 0,
    createdAt: new Date(2026, 8, seq).toISOString(),
    completedAt: new Date(2026, 8, seq).toISOString(),
    printedCount: 0,
    updatedAt: new Date(2026, 8, seq).toISOString(),
  };
  const { items: _items, ...rest } = over;
  return { ...base, ...rest, items: over.items };
}

describe('aggregateTickets', () => {
  it('groups the same product across tickets summing quantities', () => {
    const preview = aggregateTickets([
      ticket({ items: [{ id: 'a', productId: 'p1', productName: 'Café', quantity: 2, unitPrice: 3, lineTotal: 6 }] }),
      ticket({ items: [{ id: 'b', productId: 'p1', productName: 'Café', quantity: 1, unitPrice: 3, lineTotal: 3 }] }),
    ]);
    expect(preview.lines).toHaveLength(1);
    expect(preview.lines[0].quantity).toBe(3);
    expect(preview.lines[0].unitPrice).toBe(3);
    expect(preview.lines[0].lineTotal).toBe(9);
    expect(preview.totalAmount).toBe(9);
    expect(preview.ticketCount).toBe(2);
  });

  it('keeps one line per distinct price — never a rounded average (invoice must equal the tickets)', () => {
    // 100×$1.00 + 1×$1.50: the old weighted average rounded to $1.00 and the
    // draft charged $101.00 for $101.50 of sales.
    const preview = aggregateTickets([
      ticket({ items: [{ id: 'a', productId: 'p1', productName: 'Pan', quantity: 100, unitPrice: 1, lineTotal: 100 }] }),
      ticket({ items: [{ id: 'b', productId: 'p1', productName: 'Pan', quantity: 1, unitPrice: 1.5, lineTotal: 1.5 }] }),
    ]);
    expect(preview.lines).toHaveLength(2);
    expect(preview.lines.map((l) => [l.quantity, l.unitPrice])).toEqual([[100, 1], [1, 1.5]]);
    expect(preview.totalAmount).toBe(101.5);
    expect(preview.difference).toBe(0);
  });

  it('keeps free-text lines separate per name+price', () => {
    const preview = aggregateTickets([
      ticket({ items: [{ id: 'a', productName: 'Servicio rápido', quantity: 1, unitPrice: 5, lineTotal: 5 }] }),
      ticket({ items: [{ id: 'b', productName: 'Servicio rápido', quantity: 1, unitPrice: 5, lineTotal: 5 }] }),
    ]);
    expect(preview.lines).toHaveLength(1);
    expect(preview.lines[0].quantity).toBe(2);
  });

  it('computes tax buckets from line tax categories', () => {
    const preview = aggregateTickets([
      ticket({
        items: [
          { id: 'a', productId: 'p1', productName: 'Gaseosa', quantity: 1, unitPrice: 8.7, lineTotal: 8.7, taxCategory: TaxCategory.GRAVADO },
          { id: 'b', productId: 'p2', productName: 'Pan', quantity: 1, unitPrice: 1.3, lineTotal: 1.3, taxCategory: TaxCategory.EXENTO },
        ],
      }),
    ]);
    expect(preview.totalAmount).toBe(10);
    expect(preview.exemptTotal).toBe(1.3);
    expect(preview.taxIncluded).toBeCloseTo(8.7 - 8.7 / 1.13, 2);
  });

  it('detects when a Libros split is required', () => {
    const mixed = aggregateTickets([
      ticket({ items: [{ id: 'a', productName: 'X', quantity: 1, unitPrice: 1, lineTotal: 1 }] }),
      ticket({ items: [{ id: 'b', productName: 'Y', quantity: 1, unitPrice: 1, lineTotal: 1 }], excludeFromLibrosIVA: true }),
    ]);
    expect(mixed.needsLibrosSplit).toBe(true);

    const homogeneous = aggregateTickets([
      ticket({ items: [{ id: 'a', productName: 'X', quantity: 1, unitPrice: 1, lineTotal: 1 }] }),
    ]);
    expect(homogeneous.needsLibrosSplit).toBe(false);
  });

  it('aggregates line discounts and nets them out of the preview totals', () => {
    const preview = aggregateTickets([
      ticket({
        items: [
          { id: 'a', productId: 'p1', productName: 'Café', quantity: 2, unitPrice: 3, lineTotal: 5, discount: 1, taxCategory: TaxCategory.GRAVADO },
          { id: 'b', productId: 'p2', productName: 'Pan', quantity: 1, unitPrice: 2, lineTotal: 1.5, discount: 0.5, taxCategory: TaxCategory.EXENTO },
        ],
      }),
    ]);
    expect(preview.lines).toHaveLength(2);
    expect(preview.lines[0].discount).toBe(1);
    expect(preview.lines[0].lineTotal).toBe(5);
    expect(preview.lines[1].discount).toBe(0.5);
    expect(preview.lines[1].lineTotal).toBe(1.5);
    // Gross 8 − discounts 1.5 = 6.5 net; IVA on the net gravado (5),
    // exempt bucket carries the net exempt (1.5).
    expect(preview.totalAmount).toBe(6.5);
    expect(preview.exemptTotal).toBe(1.5);
    expect(preview.taxIncluded).toBeCloseTo(5 - 5 / 1.13, 2);
  });

  it('apportions a ticket-level discount across its lines proportionally', () => {
    const preview = aggregateTickets([
      ticket({
        items: [
          // Gross shares 6 and 4 → a $1 ticket discount splits 0.60/0.40.
          { id: 'a', productId: 'p1', productName: 'A', quantity: 2, unitPrice: 3, lineTotal: 6 },
          { id: 'b', productId: 'p2', productName: 'B', quantity: 1, unitPrice: 4, lineTotal: 4 },
        ],
        discountTotal: 1,
        totalAmount: 9,
      }),
    ]);
    expect(preview.lines[0].discount).toBeCloseTo(0.6, 2);
    expect(preview.lines[1].discount).toBeCloseTo(0.4, 2);
    expect(preview.totalAmount).toBe(9);
  });

  it('sums discounts across tickets for the same product', () => {
    const preview = aggregateTickets([
      ticket({ items: [{ id: 'a', productId: 'p1', productName: 'Café', quantity: 1, unitPrice: 5, lineTotal: 4, discount: 1 }] }),
      ticket({ items: [{ id: 'b', productId: 'p1', productName: 'Café', quantity: 1, unitPrice: 5, lineTotal: 4.5, discount: 0.5 }] }),
    ]);
    expect(preview.lines).toHaveLength(1);
    expect(preview.lines[0].quantity).toBe(2);
    expect(preview.lines[0].discount).toBe(1.5);
    expect(preview.lines[0].lineTotal).toBe(8.5);
    expect(preview.totalAmount).toBe(8.5);
  });
});

describe('splitByLibrosExclusion', () => {
  it('separates included and excluded tickets', () => {
    const a = ticket({ items: [{ id: 'a', productName: 'X', quantity: 1, unitPrice: 1, lineTotal: 1 }] });
    const b = ticket({ items: [{ id: 'b', productName: 'Y', quantity: 1, unitPrice: 1, lineTotal: 1 }], excludeFromLibrosIVA: true });
    const { included, excluded } = splitByLibrosExclusion([a, b]);
    expect(included).toEqual([a]);
    expect(excluded).toEqual([b]);
  });
});

describe('toInvoiceItems', () => {
  it('keeps IVA-inclusive prices (single /1.13 decomposition happens downstream)', () => {
    const preview = aggregateTickets([
      ticket({ items: [{ id: 'a', productId: 'p1', productName: 'Café', quantity: 2, unitPrice: 3, lineTotal: 6 }] }),
    ]);
    const items = toInvoiceItems(preview);
    expect(items[0].unitPrice).toBe(3);
  });

  it('keeps gravado CCF prices IVA-inclusive for computeTotals (regression: double /1.13)', () => {
    // A previous version divided here AND again in computeTotals /
    // formatFromProductDetail, understating the CCF base and its IVA.
    const preview = aggregateTickets([
      ticket({ items: [{ id: 'a', productId: 'p1', productName: 'Café', quantity: 1, unitPrice: 1.13, lineTotal: 1.13, taxCategory: TaxCategory.GRAVADO }] }),
    ]);
    const items = toInvoiceItems(preview);
    expect(items[0].unitPrice).toBe(1.13);
  });

  it('carries line discounts into the invoice items', () => {
    const preview = aggregateTickets([
      ticket({
        items: [
          { id: 'a', productId: 'p1', productName: 'Café', quantity: 2, unitPrice: 3, lineTotal: 5, discount: 1 },
          { id: 'b', productId: 'p2', productName: 'Pan', quantity: 1, unitPrice: 2, lineTotal: 2 },
        ],
      }),
    ]);
    const items = toInvoiceItems(preview);
    expect(items[0].discount).toBe(1);
    expect(items[1].discount).toBeUndefined();
  });

  it('marks exempt lines in obsItem', () => {
    const preview = aggregateTickets([
      ticket({ items: [{ id: 'a', productId: 'p2', productName: 'Pan', quantity: 1, unitPrice: 1.3, lineTotal: 1.3, taxCategory: TaxCategory.EXENTO }] }),
    ]);
    const items = toInvoiceItems(preview);
    expect(items[0].unitPrice).toBe(1.3);
    expect(items[0].obsItem).toContain('no gravada');
  });
});
