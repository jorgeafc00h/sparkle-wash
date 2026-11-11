// POS Phase 2 register — pure modules: split-payment balance math, scale
// (EAN-13) labels, quantities / `N*` multiplier, ticket numbers, dashboard stats.

import {
  amountDue,
  capToRemaining,
  changeFor,
  exceedsRemaining,
  isSettled,
  isSingleCashSettlement,
  remainingBalance,
  sumPaymentAmounts,
  totalChange,
  validateSplitPayments,
  type SplitPaymentRow,
} from '@/services/tickets/splitPayments';
import {
  DEFAULT_SCALE_BARCODES,
  buildScaleBarcode,
  ean13CheckDigit,
  isValidEan13,
  normalizeScaleBarcodeSettings,
  parseScaleBarcode,
  productMatchesPlu,
  scaleLabelQuantity,
  validateScaleBarcodeSettings,
  type ScaleBarcodeSettings,
} from '@/services/tickets/scaleBarcode';
import {
  formatQuantity,
  isWeighableUnit,
  parseMultiplierPrefix,
  parseQuantityInput,
} from '@/services/tickets/posQuantity';
import {
  formatTicketNumber,
  normalizeRegisterCode,
  ticketNumberSearchText,
  ticketShortLabel,
} from '@/services/tickets/ticketNumber';
import { normalizePosSettings, registerSettingsOf, scaleSettingsOf } from '@/services/tickets/PosSettingsStore';
import { computePosDashboardStats } from '@/services/tickets/posDashboard';
import type { Ticket } from '@/types/ticket';

describe('split payments (design §2)', () => {
  it('card $15 + cash $10 tendered on a $20 sale: settled, change $5 only from cash', () => {
    const card: SplitPaymentRow = { method: 'TARJETA_POS', amount: 15 };
    const due = amountDue({ exactTotal: 20, cashTotal: 20, rows: [card], entryMethod: 'EFECTIVO' });
    expect(due).toBe(20);
    expect(remainingBalance(due, [card])).toBe(5);
    const cash: SplitPaymentRow = { method: 'EFECTIVO', amount: 5, tendered: 10 };
    expect(isSettled(due, [card, cash])).toBe(true);
    expect(changeFor(cash)).toBe(5);
    expect(changeFor(card)).toBe(0);
    expect(totalChange([card, cash])).toBe(5);
    expect(validateSplitPayments(20, [card, cash])).toBeNull();
  });

  it('a card amount above the balance is capped to it (never a negative balance)', () => {
    expect(capToRemaining(25, 20)).toBe(20);
    expect(exceedsRemaining(25, 20)).toBe(true);
    expect(exceedsRemaining(20, 20)).toBe(false);
    expect(capToRemaining(undefined, 7.5)).toBe(7.5); // empty = the whole balance
    expect(capToRemaining(Number.NaN, 7.5)).toBe(7.5);
    expect(validateSplitPayments(20, [{ method: 'TARJETA_POS', amount: 25 }])).toMatch(/exceden/);
  });

  it('rounding only for one cash payment of the whole sale', () => {
    // $8.47 → cash $8.45 when the shop rounds to $0.05.
    expect(amountDue({ exactTotal: 8.47, cashTotal: 8.45, rows: [], entryMethod: 'EFECTIVO' })).toBe(8.45);
    expect(amountDue({ exactTotal: 8.47, cashTotal: 8.45, rows: [], entryMethod: 'TARJETA_POS' })).toBe(8.47);
    // A partial cash amount means a split: exact total.
    expect(amountDue({ exactTotal: 8.47, cashTotal: 8.45, rows: [], entryMethod: 'EFECTIVO', entryAmount: 3 })).toBe(8.47);
    // Card $5 already recorded → the cash rest is $3.47, no rounding.
    const rows: SplitPaymentRow[] = [{ method: 'TARJETA_POS', amount: 5 }];
    const due = amountDue({ exactTotal: 8.47, cashTotal: 8.45, rows, entryMethod: 'EFECTIVO' });
    expect(due).toBe(8.47);
    expect(remainingBalance(due, rows)).toBe(3.47);
    expect(isSingleCashSettlement([{ method: 'EFECTIVO' }])).toBe(true);
    expect(isSingleCashSettlement([{ method: 'TARJETA_POS' }, { method: 'EFECTIVO' }])).toBe(false);
    expect(isSingleCashSettlement([{ method: 'EFECTIVO' }, { method: 'EFECTIVO' }])).toBe(false);
  });

  it('validates the final list: balance, positive amounts, cash covering its amount', () => {
    expect(validateSplitPayments(10, [])).toMatch(/al menos un pago/);
    expect(validateSplitPayments(10, [{ method: 'EFECTIVO', amount: 6 }])).toMatch(/Saldo pendiente: \$4.00/);
    expect(validateSplitPayments(10, [{ method: 'OTRO', amount: 0 }, { method: 'EFECTIVO', amount: 10 }])).toMatch(/mayor que/);
    expect(validateSplitPayments(10, [{ method: 'EFECTIVO', amount: 10, tendered: 5 }])).toMatch(/no cubre/);
    // Half a cent of float noise is still settled.
    expect(validateSplitPayments(0.3, [{ method: 'EFECTIVO', amount: 0.1 }, { method: 'TARJETA_POS', amount: 0.2 }])).toBeNull();
    expect(sumPaymentAmounts([{ amount: 0.1 }, { amount: 0.2 }])).toBe(0.3);
  });
});

describe('scale labels (EAN-13, design §4)', () => {
  const settings: ScaleBarcodeSettings = { ...DEFAULT_SCALE_BARCODES, enabled: true };

  it('computes and validates the EAN-13 check digit', () => {
    expect(ean13CheckDigit('750103131130')).toBe(9); // 7501031311309 (retail)
    expect(isValidEan13('7501031311309')).toBe(true);
    expect(isValidEan13('7501031311308')).toBe(false);
    expect(ean13CheckDigit('200012301250')).toBe(6);
    expect(() => ean13CheckDigit('123')).toThrow();
  });

  it('parses prefix 2 + PLU 00123 + 01250 g → 1.250 kg of the product coded 123', () => {
    const code = buildScaleBarcode(settings, '00123', 1250);
    expect(code).toBe('2000123012506');
    const parsed = parseScaleBarcode(code, settings);
    expect(parsed).toEqual({ plu: '00123', kind: 'weight', value: 1250 });
    expect(productMatchesPlu({ productCode: '123' }, parsed!.plu)).toBe(true);
    expect(productMatchesPlu({ barcode: '000123' }, parsed!.plu)).toBe(true);
    expect(productMatchesPlu({ barcode: '1234' }, parsed!.plu)).toBe(false);
    expect(scaleLabelQuantity(parsed!, { unitPrice: 2, unitOfMeasure: 'KG' })).toBe(1.25);
    expect(scaleLabelQuantity(parsed!, { unitPrice: 2, unitOfMeasure: 'GR' })).toBe(1250);
    expect(scaleLabelQuantity(parsed!, { unitPrice: 2, unitOfMeasure: 'LB' })).toBe(2.756);
  });

  it('ignores the flag digit between prefix and PLU ("21 00123 01250")', () => {
    const first12 = '210012301250';
    const code = `${first12}${ean13CheckDigit(first12)}`;
    expect(parseScaleBarcode(code, settings)).toEqual({ plu: '00123', kind: 'weight', value: 1250 });
  });

  it('price labels: quantity = price / unit price, 3 decimals', () => {
    const priceSettings: ScaleBarcodeSettings = { ...settings, valueKind: 'price' };
    const parsed = parseScaleBarcode(buildScaleBarcode(priceSettings, 77, 1599), priceSettings)!;
    expect(parsed).toEqual({ plu: '00077', kind: 'price', value: 1599 });
    expect(scaleLabelQuantity(parsed, { unitPrice: 3.2 })).toBe(4.997);
    expect(scaleLabelQuantity(parsed, { unitPrice: 0 })).toBeNull();
  });

  it('refuses wrong check digits, other prefixes, disabled settings and non-13-digit codes', () => {
    const good = buildScaleBarcode(settings, 123, 1250);
    const bad = `${good.slice(0, 12)}${(Number(good[12]) + 1) % 10}`;
    expect(parseScaleBarcode(bad, settings)).toBeNull();
    expect(parseScaleBarcode('7501031311309', settings)).toBeNull();
    expect(parseScaleBarcode(good, { ...settings, enabled: false })).toBeNull();
    expect(parseScaleBarcode('200012301250', settings)).toBeNull();
    expect(parseScaleBarcode(buildScaleBarcode(settings, 123, 0), settings)).toBeNull(); // 0 g
  });

  it('normalizes and validates stored settings', () => {
    expect(normalizeScaleBarcodeSettings({ enabled: true, prefix: 'x', pluLength: 9 })).toEqual({ ...DEFAULT_SCALE_BARCODES, enabled: true });
    expect(normalizeScaleBarcodeSettings({ prefix: '22', pluLength: 6, valueLength: 6 })).toMatchObject({ prefix: '22', pluLength: 5, valueLength: 5 });
    expect(validateScaleBarcodeSettings({ ...settings, prefix: '' })).toMatch(/prefijo/i);
    expect(validateScaleBarcodeSettings({ ...settings, prefix: '22', pluLength: 6, valueLength: 6 })).toMatch(/no caben/);
    expect(validateScaleBarcodeSettings(settings)).toBeNull();
  });
});

describe('quantities and the N* multiplier (design §4)', () => {
  it('knows the weighable units (codes and enum names)', () => {
    for (const unit of ['KG', 'GR', 'LB', 'LT', 'MT', 'GAL', 'M2', 'M3', 'TON', 'KILOGRAMO', 'galón']) {
      expect(isWeighableUnit(unit)).toBe(true);
    }
    for (const unit of ['UND', 'UNIDAD', 'CAJA', 'CJ', 'HORA', '', undefined]) expect(isWeighableUnit(unit)).toBe(false);
  });

  it('decimals (3) for weighable units only; unit products refuse fractions', () => {
    expect(parseQuantityInput('1,2504', true)).toEqual({ ok: true, quantity: 1.25 });
    expect(parseQuantityInput('1.5', false)).toEqual({ ok: false, reason: 'fraction' });
    expect(parseQuantityInput('2.0', false)).toEqual({ ok: true, quantity: 2 });
    expect(parseQuantityInput('0', false)).toEqual({ ok: false, reason: 'non-positive' });
    expect(parseQuantityInput('abc', true)).toEqual({ ok: false, reason: 'invalid' });
    expect(parseQuantityInput('', true)).toEqual({ ok: false, reason: 'empty' });
    expect(parseQuantityInput('1000000', false)).toEqual({ ok: false, reason: 'too-large' });
  });

  it('parses the N* prefix of the search box', () => {
    expect(parseMultiplierPrefix('3*')).toEqual({ multiplier: 3, multiplierText: '3', term: '' });
    expect(parseMultiplierPrefix('3*7891234567890')).toEqual({ multiplier: 3, multiplierText: '3', term: '7891234567890' });
    expect(parseMultiplierPrefix('1,5 * queso')).toEqual({ multiplier: 1.5, multiplierText: '1,5', term: 'queso' });
    expect(parseMultiplierPrefix('café')).toEqual({ term: 'café' });
    expect(parseMultiplierPrefix('0*')).toEqual({ term: '0*' });
    expect(formatQuantity(1.25)).toBe('1.25');
    expect(formatQuantity(3)).toBe('3');
  });
});

describe('ticket numbers and registers (design §1)', () => {
  it('formats C1-000123, legacy #000123 and the short toast label', () => {
    expect(formatTicketNumber({ sequential: 123, registerCode: 'C1' })).toBe('C1-000123');
    expect(formatTicketNumber({ sequential: 123 })).toBe('#000123');
    expect(formatTicketNumber({ sequential: 7, registerCode: '' })).toBe('#000007');
    expect(ticketShortLabel({ sequential: 7 })).toBe('#7');
    expect(ticketShortLabel({ sequential: 7, registerCode: 'c2' })).toBe('C2-000007');
    expect(ticketNumberSearchText({ sequential: 7, registerCode: 'C2' })).toContain('C2-000007');
  });

  it('normalizes register codes and settings defaults', () => {
    expect(normalizeRegisterCode(' caja-2 ')).toBe('CAJA');
    expect(normalizeRegisterCode('c1')).toBe('C1');
    expect(normalizeRegisterCode('Ñ1')).toBe('N1');
    expect(registerSettingsOf({})).toEqual({ name: 'Caja 1', code: '' });
    expect(registerSettingsOf({ registerName: ' Mostrador ', registerCode: 'm1' })).toEqual({ name: 'Mostrador', code: 'M1' });
    expect(scaleSettingsOf({})).toEqual(DEFAULT_SCALE_BARCODES);
    // Optional sections stay absent until configured (older settings load unchanged).
    expect(normalizePosSettings({ oversell: 'ALLOW' })).toEqual({ printer: null, oversell: 'ALLOW', roundingMode: 'NONE' });
    expect(normalizePosSettings({ registerCode: 'c2', registerName: 'Caja 2', scaleBarcodes: { enabled: true } })).toMatchObject({
      registerCode: 'C2',
      registerName: 'Caja 2',
      scaleBarcodes: { ...DEFAULT_SCALE_BARCODES, enabled: true },
    });
  });
});

describe('dashboard POS stats', () => {
  const now = new Date('2026-11-15T20:00:00.000Z'); // 14:00 in El Salvador
  const ticket = (over: Partial<Ticket>): Ticket => ({
    id: `t_${Math.random()}`,
    companyId: 'co',
    sequential: 1,
    status: 'COMPLETED',
    items: [{ id: 'l1', productName: 'Café', quantity: 1, unitPrice: 5, lineTotal: 5 }],
    payments: [],
    totalAmount: 5,
    taxIncluded: 0.58,
    createdAt: '2026-11-15T15:00:00.000Z',
    completedAt: '2026-11-15T15:00:00.000Z',
    printedCount: 0,
    updatedAt: '2026-11-15T15:00:00.000Z',
    ...over,
  });

  it("counts today's sales (SV day) and the month's unconsolidated pool", () => {
    const stats = computePosDashboardStats([
      ticket({ totalAmount: 5 }),
      ticket({ totalAmount: 7.5, status: 'CONSOLIDATED', invoiceId: 'inv1' }),
      // 23:30 SV yesterday = 05:30Z today → yesterday's sale.
      ticket({ totalAmount: 100, createdAt: '2026-11-15T05:30:00.000Z', completedAt: '2026-11-15T05:30:00.000Z' }),
      ticket({ totalAmount: 50, status: 'OPEN', completedAt: undefined }),
      ticket({ totalAmount: 9, status: 'VOID' }),
      ticket({ totalAmount: 3, pendingInvoiceId: 'draft' }),
      ticket({ totalAmount: 4, createdAt: '2026-10-31T12:00:00.000Z', completedAt: '2026-10-31T12:00:00.000Z' }),
    ], now);
    expect(stats.todayCount).toBe(3);
    expect(stats.todayAmount).toBe(15.5);
    expect(stats.unconsolidatedCount).toBe(2); // $5 today + $100 yesterday
    expect(stats.unconsolidatedAmount).toBe(105);
    expect(stats.todayStart).toBe('2026-11-15T06:00:00.000Z');
    expect(stats.monthStart).toBe('2026-11-01T06:00:00.000Z');
  });
});
