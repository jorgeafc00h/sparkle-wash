// Receipt layout engine — the monospace render that both the on-screen
// preview and the ESC/POS builder consume.

import {
  RECEIPT_DISCLAIMER,
  buildReceiptBlocks,
  colsForWidth,
  renderReceiptText,
  withBlocks,
  type ReceiptPayload,
} from '@/services/printing/ReceiptDocument';

const base: ReceiptPayload = {
  kind: 'TICKET',
  companyId: 'co',
  companyName: 'Tienda La Prueba',
  companyNit: '0614-140494-134-2',
  headerLines: ['¡Gracias por su compra!'],
  footerLines: ['Factura disponible a solicitud.'],
  paper: { widthMm: 80 },
  cut: true,
  ticket: {
    sequential: 123,
    id: 'tkt_abc',
    completedAt: new Date('2026-09-26T14:32:00').toISOString(),
    lines: [
      { productName: 'Café grande', quantity: 2, unitPrice: 3.0, lineTotal: 6.0 },
      { productName: 'Pan con pollo', quantity: 1, unitPrice: 2.5, lineTotal: 2.5, obs: 'sin cebolla' },
    ],
    totalAmount: 8.5,
    taxIncluded: 0.98,
    payments: [
      { methodLabel: 'EFECTIVO', amount: 8.5, tendered: 10, change: 1.5 },
      { methodLabel: 'TARJETA', amount: 8.5, detail: 'VISA · ****4242 · Auth 123456' },
    ],
    excludedFromLibros: false,
  },
};

describe('renderReceiptText', () => {
  it('prints the company header, ticket number, items and totals', () => {
    const text = renderReceiptText(base);
    expect(text).toContain('TIENDA LA PRUEBA');
    expect(text).toContain('NIT 0614-140494-134-2');
    expect(text).toContain('Ticket #000123');
    expect(text).toContain('Café grande');
    expect(text).toContain('* sin cebolla');
    expect(text).toContain('TOTAL');
    expect(text).toContain('$8.50');
  });

  it('always prints the non-fiscal disclaimer', () => {
    const text = renderReceiptText(base);
    expect(text).toContain(RECEIPT_DISCLAIMER);
    expect(text).toContain('no es factura ni DTE');
  });

  it('prints payment evidence (auth code, last4) and change', () => {
    const text = renderReceiptText(base);
    expect(text).toContain('****4242');
    expect(text).toContain('Auth 123456');
    expect(text).toContain('Vuelto');
    expect(text).toContain('$1.50');
  });

  it('marks excluded-from-libros tickets', () => {
    const text = renderReceiptText({
      ...base,
      ticket: { ...base.ticket!, excludedFromLibros: true },
    });
    expect(text).toContain('Excluida de libros IVA');
  });

  it('fits 32 columns on 58mm paper', () => {
    const text = renderReceiptText({ ...base, paper: { widthMm: 58 } });
    expect(colsForWidth(58)).toBe(32);
    for (const line of text.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(32);
    }
    expect(text).toContain('Ticket #000123');
  });

  it('renders a Z report with method totals', () => {
    const text = renderReceiptText({
      kind: 'Z_REPORT',
      companyId: 'co',
      companyName: 'Tienda La Prueba',
      headerLines: [],
      footerLines: [],
      paper: { widthMm: 80 },
      cut: true,
      zReport: {
        label: 'CIERRE DE CAJA (Z)',
        from: new Date('2026-09-26T00:00:00').toISOString(),
        to: new Date('2026-09-26T20:00:00').toISOString(),
        ticketCount: 12,
        voidedCount: 1,
        grossTotal: 123.45,
        ivaIncluded: 14.19,
        byMethod: [
          { methodLabel: 'EFECTIVO', count: 8, amount: 80.45, cashTendered: 100, cashChange: 19.55 },
          { methodLabel: 'TARJETA', count: 4, amount: 43.0, cashTendered: 0, cashChange: 0 },
        ],
      },
    });
    expect(text).toContain('CIERRE DE CAJA (Z)');
    expect(text).toContain('VENTA TOTAL');
    expect(text).toContain('$123.45');
    expect(text).toContain('EFECTIVO');
    expect(text).toContain('TARJETA');
  });
});

describe('buildReceiptBlocks / withBlocks', () => {
  it('produces styled blocks with alignment and emphasis metadata', () => {
    const blocks = buildReceiptBlocks(base);
    const header = blocks.find((b) => b.text === 'TIENDA LA PRUEBA');
    expect(header?.align).toBe('center');
    expect(header?.doubleHeight).toBe(true);

    const total = blocks.find((b) => b.text.includes('TOTAL'));
    expect(total?.bold).toBe(true);
    expect(total?.doubleHeight).toBe(true);

    const disclaimer = blocks.find((b) => b.text.includes('no es factura'));
    expect(disclaimer?.align).toBe('center');
  });

  it('withBlocks embeds the blocks into the payload for IPC', () => {
    const payload = withBlocks(base);
    expect(payload.blocks).toBeDefined();
    expect(payload.blocks!.length).toBeGreaterThan(0);
    // Preview from embedded blocks matches a fresh render.
    expect(renderReceiptText(payload)).toBe(renderReceiptText(base));
  });

  it('renders the TEST page', () => {
    const text = renderReceiptText({
      kind: 'TEST',
      companyId: 'co',
      companyName: 'X',
      headerLines: [],
      footerLines: [],
      paper: { widthMm: 80 },
      cut: true,
    });
    expect(text).toContain('PAGINA DE PRUEBA');
    expect(text).toContain('configurada correctamente');
  });
});
