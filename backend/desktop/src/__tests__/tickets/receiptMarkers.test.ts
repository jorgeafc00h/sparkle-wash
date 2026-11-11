// Receipt fixes from the 2026-10-31 POS review: reprint/void markers, drawer
// kick only on cash SALE receipts, line math that adds up on paper, El
// Salvador time that fits 58 mm, and the ESC/POS byte builder (WPC1252 only,
// partial cut, drawer pulse).
jest.mock('@/services/telemetry/TelemetryService', () => ({ TelemetryService: { trackEvent: jest.fn() } }));
jest.mock('@/services/logging/LocalLogger', () => ({ LocalLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), event: jest.fn() } }));

import { buildTicketReceipt } from '@/services/printing/PosPrinting';
import {
  RECEIPT_COPY_MARK,
  RECEIPT_VOID_MARK,
  receiptDateTime,
  renderReceiptText,
  unitMoney,
  withBlocks,
} from '@/services/printing/ReceiptDocument';
import { normalizePosSettings, normalizePrinterSettings, TM_T20II_PRESET } from '@/services/tickets/PosSettingsStore';
import type { Ticket } from '@/types/ticket';
import type { Company } from '@/types/company';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const escpos = require('../../../electron/thermalPrinterService.cjs');

const company = { id: 'co', nombreComercial: 'Tienda', nit: '0614-000000-000-0' } as unknown as Company;
const settings = (over: Record<string, unknown> = {}) => normalizePosSettings({
  printer: { ...TM_T20II_PRESET, network: { host: '10.0.0.9', port: 9100, timeoutMs: 4000 }, cashDrawerKick: true, ...over },
});

function ticket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: 't1', companyId: 'co', sequential: 7, status: 'COMPLETED',
    createdAt: '2026-10-31T21:45:00.000Z', completedAt: '2026-10-31T21:45:00.000Z',
    items: [{ id: 'l1', productName: 'Café', quantity: 1, unitPrice: 5, lineTotal: 5 }],
    payments: [{ id: 'p1', method: 'EFECTIVO', amount: 5, tendered: 5, change: 0 }],
    totalAmount: 5, taxIncluded: 0.58, printedCount: 0, updatedAt: '2026-10-31T21:45:00.000Z',
    ...over,
  };
}

describe('reprint / void markers', () => {
  it('the sale receipt has no copy marker; any reprint says REIMPRESIÓN / COPIA', () => {
    expect(renderReceiptText(buildTicketReceipt(ticket(), company, settings(), { purpose: 'sale' }))).not.toContain(RECEIPT_COPY_MARK);
    const copy = renderReceiptText(buildTicketReceipt(ticket(), company, settings(), { purpose: 'reprint' }));
    expect(copy).toContain(RECEIPT_COPY_MARK);
    expect(copy).not.toContain(RECEIPT_VOID_MARK);
  });

  it('a VOID ticket prints *** ANULADO *** (top and bottom) with the reason, always as a copy', () => {
    const voided = ticket({ status: 'VOID', voidedAt: '2026-10-31T22:00:00.000Z', voidReason: 'cobro duplicado' });
    const payload = buildTicketReceipt(voided, company, settings(), { purpose: 'sale' });
    const text = renderReceiptText(payload);
    expect(text.split(RECEIPT_VOID_MARK)).toHaveLength(3);
    expect(text).toContain(RECEIPT_COPY_MARK);
    expect(text).toContain('Motivo: cobro duplicado');
    expect(payload.cashDrawerKick).toBe(false);
    const mark = withBlocks(payload).blocks!.find((b) => b.text === RECEIPT_VOID_MARK);
    expect(mark).toMatchObject({ align: 'center', bold: true, doubleHeight: true });
  });
});

describe('cash drawer kick', () => {
  it('opens only for a cash SALE receipt with the setting on', () => {
    expect(buildTicketReceipt(ticket(), company, settings(), { purpose: 'sale' }).cashDrawerKick).toBe(true);
    expect(buildTicketReceipt(ticket(), company, settings(), { purpose: 'reprint' }).cashDrawerKick).toBe(false);
    expect(buildTicketReceipt(ticket(), company, settings({ cashDrawerKick: false }), { purpose: 'sale' }).cashDrawerKick).toBe(false);
    const card = ticket({ payments: [{ id: 'p1', method: 'TARJETA_POS', amount: 5 }] });
    expect(buildTicketReceipt(card, company, settings(), { purpose: 'sale' }).cashDrawerKick).toBe(false);
  });
});

describe('receipt math and layout', () => {
  it('line amounts and the subtotal add up (gross per line, discount below, subtotal net of line discounts)', () => {
    const t = ticket({
      items: [
        { id: 'l1', productName: 'Café', quantity: 2, unitPrice: 5, lineTotal: 9, discount: 1, discountPct: 10 },
        { id: 'l2', productName: 'Pan', quantity: 1, unitPrice: 2, lineTotal: 2 },
      ],
      discountTotal: 1.1,
      totalAmount: 9.9,
    });
    const text = renderReceiptText(buildTicketReceipt(t, company, settings()));
    expect(text).toMatch(/2 x \$5\.00\s+\$10\.00/);
    expect(text).toMatch(/Descuento\s+-\$1\.00/);
    expect(text).toMatch(/Subtotal \(IVA incl\.\)\s+\$11\.00/);
    expect(text).toMatch(/TOTAL\s+\$9\.90/);
  });

  it('prices with more than 2 decimals print enough decimals for the line to add up', () => {
    expect(unitMoney(0.3333)).toBe('$0.3333');
    expect(unitMoney(1.5)).toBe('$1.50');
    expect(unitMoney(2.125)).toBe('$2.125');
    const t = ticket({ items: [{ id: 'l1', productName: 'Tornillo', quantity: 3, unitPrice: 0.3333, lineTotal: 1 }], totalAmount: 1 });
    expect(renderReceiptText(buildTicketReceipt(t, company, settings()))).toMatch(/3 x \$0\.3333\s+\$1\.00/);
  });

  it('stamps El Salvador time (UTC−6) in 24 h, so 58 mm never truncates "p. m."', () => {
    expect(receiptDateTime('2026-10-31T21:45:00.000Z')).toBe('31/10/2026 15:45');
    const text = renderReceiptText(buildTicketReceipt(ticket(), company, settings({ paper: { widthMm: 58, copies: 1, cut: true } })));
    expect(text).toMatch(/Ticket #000007 +31\/10\/2026 15:45/);
    for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(32);
  });
});

describe('ESC/POS bytes (electron/thermalPrinterService.cjs)', () => {
  const blocks = [{ text: 'Precio → $5 ≥ 3 Ω — Café 😀', align: 'left' }];
  const has = (buffer: Buffer, bytes: number[]) => buffer.includes(Buffer.from(bytes));

  it('keeps every character in WPC1252 (no code-page switch mid-receipt)', () => {
    const buffer: Buffer = escpos.buildBuffer({ kind: 'TICKET', paper: { widthMm: 80 }, cut: true, blocks });
    const escT = [...buffer.entries()].filter(([i, b]) => b === 0x1b && buffer[i + 1] === 0x74);
    expect(escT.every(([i]) => buffer[i + 2] === 16)).toBe(true); // only ESC t 16 (WPC1252)
    const text = buffer.toString('latin1');
    expect(text).toContain('Precio -> $5 >= 3 Ohm');
    expect(buffer.includes(Buffer.from([0x97]))).toBe(true); // — is 0x97 in WPC1252
    expect(buffer.includes(Buffer.from('Café', 'latin1'))).toBe(true);
    expect(text).toContain('?'); // the emoji
  });

  it('uses the partial cut (GS V 1), never the full cut', () => {
    const buffer: Buffer = escpos.buildBuffer({ kind: 'TICKET', paper: { widthMm: 80 }, cut: true, blocks });
    expect(has(buffer, [0x1d, 0x56, 0x01])).toBe(true);
    expect(has(buffer, [0x1d, 0x56, 0x00])).toBe(false);
  });

  it('pulses the drawer only for a flagged TICKET receipt', () => {
    const kick = [0x1b, 0x70, 0x00];
    expect(has(escpos.buildBuffer({ kind: 'TICKET', paper: { widthMm: 80 }, cut: true, cashDrawerKick: true, blocks }), kick)).toBe(true);
    expect(has(escpos.buildBuffer({ kind: 'TICKET', paper: { widthMm: 80 }, cut: true, blocks }), kick)).toBe(false);
    expect(has(escpos.buildBuffer({ kind: 'Z_REPORT', paper: { widthMm: 80 }, cut: true, cashDrawerKick: true, blocks }), kick)).toBe(false);
  });
});

describe('POS settings normalization', () => {
  it('fills missing printer fields with defaults instead of crashing after the sale', () => {
    const printer = normalizePrinterSettings({ transport: 'spooler', spooler: { printerName: 'EPSON TM-T20II' } })!;
    expect(printer).toEqual({
      ...TM_T20II_PRESET,
      transport: 'spooler',
      spooler: { printerName: 'EPSON TM-T20II' },
    });
    expect(normalizePrinterSettings(null)).toBeNull();
    expect(normalizePrinterSettings('x')).toBeNull();
  });

  it('rejects malformed values field by field', () => {
    const printer = normalizePrinterSettings({
      transport: 'usb', network: { host: 5, port: 99999, timeoutMs: 'x' }, paper: { widthMm: 57, copies: 9, cut: 'yes' },
      headerLines: ['ok', 3], footerLines: 'nope', cashDrawerKick: 'true',
    })!;
    expect(printer.transport).toBe('network');
    expect(printer.network).toEqual(TM_T20II_PRESET.network);
    expect(printer.paper).toEqual({ widthMm: 80, copies: 1, cut: true });
    expect(printer.headerLines).toEqual(['ok']);
    expect(printer.footerLines).toEqual(TM_T20II_PRESET.footerLines);
    expect(printer.cashDrawerKick).toBe(false);
    expect(normalizePosSettings({ oversell: 'ALLOW', roundingMode: 'NEAREST_0.05' })).toEqual({
      printer: null, oversell: 'ALLOW', roundingMode: 'NEAREST_0.05',
    });
  });
});
