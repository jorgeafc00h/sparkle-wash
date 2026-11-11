// Card payments: the datáfono is external, so no card field is required and
// the optional voucher reference reaches the receipt when present.
jest.mock('@/services/telemetry/TelemetryService', () => ({ TelemetryService: { trackEvent: jest.fn() } }));
jest.mock('@/services/logging/LocalLogger', () => ({ LocalLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import { buildTicketReceipt } from '@/services/printing/PosPrinting';
import { renderReceiptText } from '@/services/printing/ReceiptDocument';

const company: any = { id: 'co', nombreComercial: 'Tienda', nit: '0614-000000-000-0' };
const settings: any = { printer: { paper: { widthMm: 80, cut: true }, headerLines: [], footerLines: [] } };

function ticket(payment: Record<string, unknown>): any {
  return {
    id: 't1', companyId: 'co', sequential: 1, status: 'COMPLETED', createdAt: new Date().toISOString(),
    items: [{ id: 'l1', productName: 'Café', quantity: 1, unitPrice: 5, lineTotal: 5 }],
    payments: [{ id: 'p1', method: 'TARJETA_POS', amount: 5, ...payment }],
    totalAmount: 5, taxIncluded: 0.58, discountTotal: 0, roundingAdjustment: 0,
  };
}

describe('card payment receipt', () => {
  it('builds with no card details', () => {
    const p = buildTicketReceipt(ticket({}), company, settings);
    expect(p.ticket!.payments[0].detail).toBe('');
    expect(() => renderReceiptText(p)).not.toThrow();
  });

  it('prints the voucher reference when present', () => {
    const p = buildTicketReceipt(ticket({ posReference: 'V-889' }), company, settings);
    expect(renderReceiptText(p)).toContain('Ref V-889');
  });
});
