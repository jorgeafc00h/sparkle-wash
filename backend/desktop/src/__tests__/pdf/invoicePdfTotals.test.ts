// PDF totals = DTE totals (2026-10-31 review): "Total en letras" spells the
// amount the document charges (Total a Pagar), NC/ND print IVA-exclusive like a
// CCF, exento / no sujeto lines land in their own columns, and the editor
// totals panel shows the same figures.
jest.mock('@/assets/facturasSimples.png', () => 'logo.png', { virtual: true });
jest.mock('qrcode', () => ({ __esModule: true, default: { toDataURL: jest.fn(async () => '') } }));

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { amountToWordsEs, InvoicePDFGenerator } from '@/services/pdf/InvoicePDFGenerator';
import { InvoiceTotals } from '@/components/invoices/InvoiceTotals';
import { Invoice, InvoiceDetail, InvoiceType } from '@/types/invoice';
import { TaxCategory } from '@/types/product';
import { computeTotals } from '@/utils/invoiceTotals';

const company: any = {
  nombreComercial: 'Facturas Simples', correo: 'a@b.c', telefono: '22222222', codActividad: '62020',
  descActividad: 'Consultoria', nit: '06141404941342', nombre: 'X', nrc: '3174', complemento: 'SS',
};

const item = (quantity: number, unitPrice: number, extra: Partial<InvoiceDetail> = {}): InvoiceDetail => ({
  id: `it-${quantity}-${unitPrice}`, productId: 'p', productName: 'Producto', quantity, unitPrice,
  obsItem: '', createdAt: '', updatedAt: '', ...extra,
});

function render(invoiceType: InvoiceType, items: InvoiceDetail[], retention = false) {
  const invoice = {
    id: 'i', invoiceNumber: 'n', date: '2026-10-31', invoiceType, documentType: '01', items, status: 2,
    customer: { firstName: 'A', lastName: 'B', hasContributorRetention: retention },
    totals: computeTotals(items, invoiceType, retention),
  } as unknown as Invoice;
  const html: string = (InvoicePDFGenerator as any).generateHTMLContent(invoice, company, '', '', { tier: 'pro' });
  const words = /class="total-words">([^<]*)</.exec(html)?.[1] ?? '';
  const rows = Object.fromEntries(
    [...html.matchAll(/<td>([^<]*)<\/td>\s*<td class="resumen-value">\$([0-9.\-]+)<\/td>/g)].map((m) => [m[1], Number(m[2])]),
  );
  const itemCells = [...html.matchAll(/<td class="col-money">\$([0-9.]+)<\/td>/g)].map((m) => Number(m[1]));
  return { html, words, rows, itemCells };
}

describe('amountToWordsEs (iOS NumberFormatter es_SV style)', () => {
  it.each([
    [0.5, 'CERO DÓLARES Y CINCUENTA CENTAVOS'],
    [42.5, 'CUARENTA Y DOS DÓLARES Y CINCUENTA CENTAVOS'],
    [113, 'CIENTO TRECE DÓLARES'],
    [100, 'CIEN DÓLARES'],
    [118.3, 'CIENTO DIECIOCHO DÓLARES Y TREINTA CENTAVOS'],
    [21000, 'VEINTIÚN MIL DÓLARES'],
    [1001, 'MIL UNO DÓLARES'],
    [1234.56, 'MIL DOSCIENTOS TREINTA Y CUATRO DÓLARES Y CINCUENTA Y SEIS CENTAVOS'],
    [1000000, 'UN MILLÓN DÓLARES'],
    [0, 'CERO DÓLARES'],
  ])('%s → %s', (amount, words) => {
    expect(amountToWordsEs(amount)).toBe(words);
  });
});

describe('InvoicePDFGenerator totals', () => {
  it('CCF $113: words read the Total a Pagar (CIENTO TRECE, not CIEN)', () => {
    const { words, rows } = render(InvoiceType.CCF, [item(1, 113)]);
    expect(words).toBe('CIENTO TRECE DÓLARES');
    expect(rows['Sumatoria de Ventas']).toBe(100);
    expect(rows['20 - Impuesto al Valor Agregado 13%:']).toBe(13);
    expect(rows['Total a Pagar:']).toBe(113);
  });

  it('CCF $226 with retention: Total a Pagar and words net the 1%', () => {
    const { words, rows } = render(InvoiceType.CCF, [item(2, 113)], true);
    expect(rows['(-) IVA Retenido:']).toBe(2);
    expect(rows['Monto Total de la Operación:']).toBe(226);
    expect(rows['Total a Pagar:']).toBe(224);
    expect(words).toBe('DOSCIENTOS VEINTICUATRO DÓLARES');
  });

  it('FE $50 with a $7.50 discount: CUARENTA Y DOS 50/100, no global discount row', () => {
    const { words, rows, itemCells } = render(InvoiceType.Factura, [item(1, 50, { discount: 7.5 })]);
    expect(words).toBe('CUARENTA Y DOS DÓLARES Y CINCUENTA CENTAVOS');
    expect(rows['Sumatoria de Ventas']).toBe(42.5);
    expect(rows['Monto Global de Descuento, Rebajas y Otros a Ventas Gravadas:']).toBe(0);
    // precio, descuento, no sujetas, exentas, gravadas
    expect(itemCells).toEqual([50, 7.5, 0, 0, 42.5]);
  });

  it('NC / ND render IVA-exclusive like a CCF', () => {
    for (const type of [InvoiceType.NotaCredito, InvoiceType.NotaDebito]) {
      const { rows, itemCells, words } = render(type, [item(2, 50, { discount: 10 })]);
      expect(itemCells).toEqual([44.25, 8.85, 0, 0, 79.65]);
      expect(rows['20 - Impuesto al Valor Agregado 13%:']).toBe(10.35);
      expect(rows['Sub Total:']).toBe(79.65);
      expect(rows['Total a Pagar:']).toBe(90);
      expect(words).toBe('NOVENTA DÓLARES');
    }
  });

  it('exento / no sujeto lines print in their own columns without IVA', () => {
    const { rows, itemCells } = render(InvoiceType.CCF, [
      item(1, 113),
      item(2, 10, { taxCategory: TaxCategory.EXENTO }),
      item(1, 5, { taxCategory: TaxCategory.NO_GRAVADO }),
    ]);
    expect(itemCells).toEqual([100, 0, 0, 0, 100, 10, 0, 0, 20, 0, 5, 0, 5, 0, 0]);
    expect(rows['Sumatoria de Ventas']).toBe(125);
    expect(rows['20 - Impuesto al Valor Agregado 13%:']).toBe(13);
    expect(rows['Total a Pagar:']).toBe(138);
  });

  it('FSE: renta row and words on the net payable; no IVA row', () => {
    const { rows, words } = render(InvoiceType.SujetoExcluido, [item(1, 100)]);
    expect(rows['(-) Retención Renta:']).toBe(10);
    expect(rows['Total a Pagar:']).toBe(90);
    expect(rows['20 - Impuesto al Valor Agregado 13%:']).toBeUndefined();
    expect(words).toBe('NOVENTA DÓLARES');
  });
});

describe('InvoiceTotals panel', () => {
  const html = (items: InvoiceDetail[], type: InvoiceType, retention = false) =>
    renderToStaticMarkup(React.createElement(InvoiceTotals, { items, invoiceType: type, customerHasRetention: retention }));

  it('renders the discount as "-$11.30" (no doubled dollar sign)', () => {
    const out = html([item(1, 113, { discount: 11.3 })], InvoiceType.CCF);
    expect(out).toContain('-$11.30');
    expect(out).not.toContain('$$');
  });

  it('shows the exento / no sujeto buckets and the netted Total a Pagar', () => {
    const out = html([item(2, 113), item(1, 20, { taxCategory: TaxCategory.EXENTO }), item(1, 5, { taxCategory: TaxCategory.NO_GRAVADO })], InvoiceType.CCF, true);
    expect(out).toContain('Subtotal gravado (sin IVA)');
    expect(out).toMatch(/Ventas exentas<\/span><span>\$20\.00/);
    expect(out).toMatch(/Ventas no sujetas<\/span><span>\$5\.00/);
    expect(out).toMatch(/Retención IVA \(1%\)<\/span><span>-\$2\.00/);
    expect(out).toMatch(/Total a Pagar<\/span>(<!-- -->)?.*\$249\.00/); // 226 + 20 + 5 − 2
  });

  it('FEX / FSE show no IVA line', () => {
    expect(html([item(1, 100)], InvoiceType.FacturaExportacion)).not.toContain('IVA (13%)');
    expect(html([item(1, 100)], InvoiceType.SujetoExcluido)).not.toContain('IVA (13%)');
  });
});
