// POS Phase 2 receipts: the non-fiscal return slip and the Z with arqueo,
// per-cashier and per-product blocks (same layout source for preview and
// ESC/POS bytes).
jest.mock('@/services/telemetry/TelemetryService', () => ({ TelemetryService: { trackEvent: jest.fn() } }));
jest.mock('@/services/logging/LocalLogger', () => ({ LocalLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), event: jest.fn() } }));

import { buildReturnReceipt, buildZReceipt } from '@/services/printing/PosPrinting';
import { RECEIPT_DISCLAIMER, RECEIPT_RETURN_TITLE, renderReceiptText, withBlocks } from '@/services/printing/ReceiptDocument';
import { buildTicketReturn } from '@/services/tickets/TicketReturns';
import { buildCashClosing, computeCashSummary, computeZReport } from '@/services/tickets/ClosingService';
import { normalizePosSettings, TM_T20II_PRESET } from '@/services/tickets/PosSettingsStore';
import type { Ticket } from '@/types/ticket';
import type { Company } from '@/types/company';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const escpos = require('../../../electron/thermalPrinterService.cjs');

const company = { id: 'co', nombreComercial: 'Tienda', nit: '0614-000000-000-0' } as unknown as Company;
const settings = normalizePosSettings({ printer: { ...TM_T20II_PRESET, network: { host: '10.0.0.9', port: 9100, timeoutMs: 4000 }, cashDrawerKick: true } });

const at = new Date(2026, 9, 31, 10).toISOString();
const ticket: Ticket = {
  id: 'tkt_1', companyId: 'co', sequential: 12, registerCode: 'C1', status: 'COMPLETED',
  items: [{ id: 'l1', productId: 'A', productName: 'Pan dulce', quantity: 3, unitPrice: 2, lineTotal: 6 }],
  payments: [{ id: 'p1', method: 'EFECTIVO', amount: 6 }],
  totalAmount: 6, taxIncluded: 0.69, cashierName: 'Ana', createdAt: at, completedAt: at, printedCount: 1, updatedAt: at,
};

describe('return slip', () => {
  it('prints COMPROBANTE DE DEVOLUCIÓN with the ticket number, units, refund, reason and the non-fiscal disclaimer; never kicks the drawer', () => {
    const ret = buildTicketReturn(ticket, { requested: [{ lineId: 'l1', quantity: 1 }], method: 'EFECTIVO', reason: 'producto dañado', createdBy: 'Beto', createdAt: at });
    const payload = withBlocks(buildReturnReceipt(ticket, ret, company, settings));
    const text = renderReceiptText(payload);
    expect(payload.kind).toBe('RETURN_SLIP');
    expect(text).toContain(RECEIPT_RETURN_TITLE);
    expect(text).toContain('Ticket C1-000012');
    expect(text).toContain('Pan dulce');
    expect(text).toContain('1 unidad(es)');
    expect(text).toMatch(/REEMBOLSO\s+\$2\.00/);
    expect(text).toContain('Motivo: producto dañado');
    expect(text).toContain('Cajero: Beto');
    expect(text).toContain(RECEIPT_DISCLAIMER);
    expect(payload.cashDrawerKick).toBeUndefined();
    const bytes: Buffer = escpos.buildBuffer(payload);
    expect(bytes.includes(Buffer.from([0x1b, 0x70]))).toBe(false); // no drawer pulse
    expect(bytes.toString('latin1')).toContain('COMPROBANTE DE DEVOLUCI');
  });
});

describe('Z receipt (POS Phase 2 blocks)', () => {
  it('prints the arqueo (expected / counted / FALTANTE), refunds, per cashier and per product', () => {
    const returned: Ticket = {
      ...ticket,
      returns: [buildTicketReturn(ticket, { requested: [{ lineId: 'l1', quantity: 1 }], method: 'EFECTIVO', reason: 'x', createdAt: new Date(2026, 9, 31, 11).toISOString() })],
    };
    const to = new Date(2026, 9, 31, 18).toISOString();
    const totals = computeZReport([returned], null, to);
    const cash = computeCashSummary({ totals, openingFloat: 50, movements: [{ kind: 'OUT', amount: 10 }], counted: 41 });
    const closing = buildCashClosing('co', [returned], '', to, totals, { registerId: 'dev', registerCode: 'C1', cash });
    const text = renderReceiptText(withBlocks(buildZReceipt(closing, company, settings)));
    expect(text).toMatch(/Caja\s+C1/);
    expect(text).toMatch(/Devoluciones \(1\)\s+-\$2\.00/);
    expect(text).toMatch(/NETO DEL CIERRE\s+\$4\.00/);
    expect(text).toContain('ARQUEO DE EFECTIVO');
    expect(text).toMatch(/Fondo inicial\s+\$50\.00/);
    expect(text).toMatch(/Salidas de efectivo\s+-\$10\.00/);
    expect(text).toMatch(/Efectivo esperado\s+\$44\.00/);
    expect(text).toMatch(/Efectivo contado\s+\$41\.00/);
    expect(text).toMatch(/FALTANTE\s+-\$3\.00/);
    expect(text).toContain('POR CAJERO');
    expect(text).toMatch(/Ana \(1\)\s+\$6\.00/);
    expect(text).toContain('POR PRODUCTO');
    expect(text).toContain('Pan dulce');
  });

  it('legacy closings (no arqueo / breakdowns) still print as before', () => {
    const to = new Date(2026, 9, 31, 18).toISOString();
    const totals = computeZReport([ticket], null, to);
    const legacy = { ...buildCashClosing('co', [ticket], '', to, totals), totals: { ...totals, byCashier: undefined, byProduct: undefined, refunds: undefined, discountTotal: undefined } };
    const text = renderReceiptText(withBlocks(buildZReceipt(legacy, company, settings)));
    expect(text).toContain('VENTA TOTAL');
    expect(text).not.toContain('ARQUEO');
    expect(text).not.toContain('POR CAJERO');
  });
});
