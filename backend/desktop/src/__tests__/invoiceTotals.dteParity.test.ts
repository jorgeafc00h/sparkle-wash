// Stored totals ⇔ DTE parity (2026-10-31 review): computeTotals and the DTE
// mappers share utils/invoiceTotals.computeLine, so the stored/UI/annex figures
// are the figures Hacienda receives — including exento / no sujeto lines,
// fractional quantities, discounts on notes and the 1% / 10% retentions.

import { DTEMappingService } from '../services/dte/DTEMappingService';
import invoiceReducer, { addInvoice, updateInvoice } from '../store/slices/invoiceSlice';
import { Company, CompanyEnvironment, CompanyStatus } from '../types/company';
import { Customer, CustomerDocumentType, CustomerType } from '../types/customer';
import { CreateInvoiceInput, Invoice, InvoiceDetail, InvoiceStatus, InvoiceType } from '../types/invoice';
import { TaxCategory } from '../types/product';
import {
  blockedTaxCategoryLines,
  canInvoiceTaxCategory,
  computeLine,
  computeTotals,
  roundMoney,
  taxCategoryBlockedMessage,
} from '../utils/invoiceTotals';

const company = {
  id: 'company-1', nit: '06141404941342', nombre: 'Jorge Flores', nombreComercial: 'Facturas Simples',
  nrc: '3174', correo: 'test@example.com', telefono: '22222222', complemento: 'San Salvador',
  direccion: 'San Salvador', departamentoCode: '06', departamento: 'San Salvador', municipioCode: '23',
  municipio: 'San Salvador Centro', codActividad: '62020', descActividad: 'Consultoria',
  tipoEstablecimiento: '01', establecimiento: 'Casa matriz', codEstableMH: 'M001', codEstable: '',
  codPuntoVentaMH: 'P001', codPuntoVenta: '', environment: CompanyEnvironment.Development,
  isTestAccount: true, hasValidCertificate: true, ivaPercentage: 13, currentInvoiceNumber: 1,
  currentCCFNumber: 1, hasApiCredentials: true, status: CompanyStatus.Active, isDefault: true,
  userId: 'user-1', createdAt: '', updatedAt: '',
} as Company;

const customer = (over: Partial<Customer> = {}): Customer => ({
  id: 'customer-1', firstName: 'Empresa', lastName: 'Cliente', businessName: 'Empresa Cliente SA de CV',
  nationalId: '', nit: '06140202031011', documentType: CustomerDocumentType.NIT, email: 'c@example.com',
  phone: '22223333', address: 'San Salvador', departmentCode: '06', municipalityCode: '23',
  hasContributorRetention: false, customerType: CustomerType.Business, isActive: true,
  companyId: 'company-1', codActividad: '46900', descActividad: 'Venta al por mayor', nrc: '1481520',
  createdAt: '', updatedAt: '', ...over,
} as Customer);

let seq = 0;
const line = (quantity: number, unitPrice: number, extra: Partial<InvoiceDetail> = {}): InvoiceDetail => ({
  id: `it-${++seq}`, productId: `p-${seq}`, productName: `Producto ${seq}`, quantity, unitPrice,
  obsItem: '', createdAt: '', updatedAt: '', ...extra,
});

const DOC: Partial<Record<InvoiceType, string>> = {
  [InvoiceType.Factura]: '01', [InvoiceType.CCF]: '03', [InvoiceType.NotaRemision]: '04',
  [InvoiceType.NotaCredito]: '05', [InvoiceType.NotaDebito]: '06', [InvoiceType.FacturaExportacion]: '11',
  [InvoiceType.SujetoExcluido]: '14', [InvoiceType.ComprobanteRetencion]: '07',
};

function makeInvoice(invoiceType: InvoiceType, items: InvoiceDetail[], opts: { retention?: boolean; customer?: Customer } = {}): Invoice {
  return {
    id: 'inv-1', invoiceNumber: 'DTE-X', date: '2026-10-31', status: InvoiceStatus.Nueva,
    customerId: 'customer-1', customer: opts.customer ?? customer({ hasContributorRetention: !!opts.retention }),
    invoiceType, documentType: DOC[invoiceType] ?? '01', companyId: 'company-1', createdAt: '', updatedAt: '',
    generationCode: '11111111-1111-4111-8111-111111111111', controlNumber: 'DTE-01-M001P001-000000000000001',
    relatedDocumentType: '03', relatedInvoiceType: InvoiceType.CCF, relatedDocumentDate: '2026-10-30',
    relatedGenerationCode: '22222222-2222-4222-8222-222222222222',
    items, totals: computeTotals(items, invoiceType, opts.retention),
  } as Invoice;
}

const sum = (xs: number[]) => roundMoney(xs.reduce((a, b) => a + b, 0));

/** Every MH tally between items, resumen and the stored totals. */
function expectParity(invoice: Invoice) {
  const dte: any = DTEMappingService.mapInvoice(invoice, company, '00');
  const items: any[] = dte.cuerpoDocumento;
  const r = dte.resumen;
  const t = invoice.totals!;
  for (const it of items) {
    // MH item rule: cantidad × precioUni − montoDescu = venta* (half-cent rounding only)
    const venta = it.ventaGravada + it.ventaExenta + it.ventaNoSuj;
    expect(Math.abs(it.cantidad * it.precioUni - it.montoDescu - venta)).toBeLessThanOrEqual(0.005 + 1e-9);
    // never two buckets on one line
    expect([it.ventaGravada, it.ventaExenta, it.ventaNoSuj].filter((v) => v > 0).length).toBeLessThanOrEqual(1);
  }
  expect(r.totalGravada).toBe(sum(items.map((i) => i.ventaGravada)));
  expect(r.totalExenta).toBe(sum(items.map((i) => i.ventaExenta)));
  expect(r.totalNoSuj).toBe(sum(items.map((i) => i.ventaNoSuj)));
  expect(r.subTotalVentas).toBe(roundMoney(r.totalGravada + r.totalExenta + r.totalNoSuj));
  expect(r.totalDescu).toBe(sum(items.map((i) => i.montoDescu)));
  const iva = r.tributos ? r.tributos[0].valor : r.totalIva ?? 0;
  expect(t.tax).toBe(iva);
  expect(t.totalExenta).toBe(r.totalExenta);
  expect(t.totalNoSuj).toBe(r.totalNoSuj);
  expect(t.totalGravada).toBe(r.totalGravada);
  expect(t.totalAmount).toBe(r.montoTotalOperacion);
  if (r.totalPagar !== undefined) expect(t.totalPagar).toBe(r.totalPagar);
  return { dte, items, r };
}

describe('Factura with mixed gravado / exento / no sujeto lines and a discount', () => {
  const items = [
    line(2, 50, { discount: 10 }),                                  // gravado 100 − 10
    line(1, 20, { taxCategory: TaxCategory.EXENTO }),               // exento (price has no IVA)
    line(1.5, 0.99, { taxCategory: TaxCategory.NO_GRAVADO }),       // no sujeto, fractional
  ];
  const invoice = makeInvoice(InvoiceType.Factura, items);

  it('splits the buckets per item; IVA only on the gravado line', () => {
    const { items: mapped, r } = expectParity(invoice);
    expect(mapped[0]).toMatchObject({ ventaGravada: 90, ventaExenta: 0, ventaNoSuj: 0, montoDescu: 10, ivaItem: 10.35, tributos: null });
    expect(mapped[1]).toMatchObject({ ventaGravada: 0, ventaExenta: 20, ventaNoSuj: 0, ivaItem: 0, precioUni: 20, tributos: null });
    expect(mapped[2]).toMatchObject({ ventaGravada: 0, ventaExenta: 0, ventaNoSuj: 1.49, ivaItem: 0, precioUni: 0.99 });
    expect(r).toMatchObject({
      totalGravada: 90, totalExenta: 20, totalNoSuj: 1.49, subTotalVentas: 111.49, subTotal: 111.49,
      descuGravada: 0, porcentajeDescuento: 0, totalDescu: 10, totalIva: 10.35,
      montoTotalOperacion: 111.49, totalPagar: 111.49, tributos: null,
    });
  });

  it('stored totals expose the buckets and keep IVA off the exempt lines', () => {
    expect(invoice.totals).toMatchObject({
      totalAmount: 111.49, tax: 10.35, subTotal: 79.65, totalWithoutTax: 79.65,
      totalGravada: 90, totalExenta: 20, totalNoSuj: 1.49, totalPagar: 111.49, reteRenta: 0, totalDiscount: 10,
    });
  });
});

describe('CCF with mixed lines, a discount and a fractional quantity', () => {
  const items = [
    line(1, 113, { discount: 11.3 }),                         // gravado → base 90, IVA 11.70
    line(1.5, 0.99),                                          // gravado fractional
    line(3, 10, { taxCategory: TaxCategory.EXENTO, discount: 3 }), // exento with discount (no /1.13)
  ];
  const invoice = makeInvoice(InvoiceType.CCF, items);

  it('exempt lines are not divided by 1.13 and carry tributos null', () => {
    const { items: mapped, r } = expectParity(invoice);
    expect(mapped[0]).toMatchObject({ precioUni: 100, montoDescu: 10, ventaGravada: 90, tributos: ['20'] });
    expect(mapped[1]).toMatchObject({ precioUni: 0.87610619, ventaGravada: 1.31, tributos: ['20'] });
    expect(mapped[2]).toMatchObject({ precioUni: 10, montoDescu: 3, ventaExenta: 27, ventaGravada: 0, tributos: null });
    expect(mapped[0].ivaItem).toBeUndefined();
    expect(r.tributos).toEqual([{ codigo: '20', descripcion: 'Impuesto al Valor Agregado 13%', valor: 11.88 }]);
    expect(r).toMatchObject({ totalGravada: 91.31, totalExenta: 27, subTotalVentas: 118.31, totalDescu: 13 });
    expect(r.montoTotalOperacion).toBe(roundMoney(r.subTotal + 11.88));
  });

  it('stored totals: base of gravado lines only, IVA = DTE tributo', () => {
    expect(invoice.totals).toMatchObject({ subTotal: 91.31, tax: 11.88, totalExenta: 27, totalAmount: 130.19, totalPagar: 130.19 });
  });

  it('an all-exempt CCF sends no IVA tributo and no retention', () => {
    const exempt = makeInvoice(InvoiceType.CCF, [line(10, 20, { taxCategory: TaxCategory.EXENTO })], { retention: true });
    const { r } = expectParity(exempt);
    expect(r.tributos).toBeNull();
    expect(r.ivaRete).toBe(0);
    expect(exempt.totals).toMatchObject({ tax: 0, ivaRete1: 0, totalPagar: 200, totalExenta: 200 });
  });
});

describe('Fractional quantities and > 2-decimal prices', () => {
  it('CCF 3 × (1.5 × $0.99): Σ ventaGravada = totalGravada = stored base', () => {
    const invoice = makeInvoice(InvoiceType.CCF, [line(1.5, 0.99), line(1.5, 0.99), line(1.5, 0.99)]);
    const { r } = expectParity(invoice);
    expect(r.totalGravada).toBe(3.93);
    expect(invoice.totals!.subTotal).toBe(3.93);
  });

  it('Factura 2 × (1.5 × $0.99) rounds 1.485 half-up like MH (1.49, not 1.48)', () => {
    const invoice = makeInvoice(InvoiceType.Factura, [line(1.5, 0.99), line(1.5, 0.99)]);
    const { items } = expectParity(invoice);
    expect(items.map((i) => i.ventaGravada)).toEqual([1.49, 1.49]);
    expect(invoice.totals!.totalAmount).toBe(2.98);
  });

  it('random invoices keep every tally (FE / CCF / NC / ND / NR)', () => {
    let s = 7;
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const cats = [TaxCategory.GRAVADO, TaxCategory.GRAVADO, TaxCategory.EXENTO, TaxCategory.NO_GRAVADO];
    for (const type of [InvoiceType.Factura, InvoiceType.CCF, InvoiceType.NotaCredito, InvoiceType.NotaDebito, InvoiceType.NotaRemision]) {
      for (let k = 0; k < 150; k++) {
        const items = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => {
          const q = rnd() < 0.5 ? 1 + Math.floor(rnd() * 20) : Math.round((0.1 + rnd() * 5) * 1000) / 1000;
          const p = Math.round(rnd() * 50000) / 1000;
          return line(q, p, {
            discount: rnd() < 0.4 ? roundMoney(q * p * 0.1) : undefined,
            taxCategory: cats[Math.floor(rnd() * cats.length)],
          });
        });
        expectParity(makeInvoice(type, items));
      }
    }
  });
});

describe('Notes from a discounted CCF (IVA-exclusive, discount subtracted once)', () => {
  it.each([
    [InvoiceType.NotaCredito],
    [InvoiceType.NotaDebito],
    [InvoiceType.NotaRemision],
  ])('type %s: 2 × $50 with a $10 discount → precioUni 44.24778761, venta 79.65', (type) => {
    const invoice = makeInvoice(type, [line(2, 50, { discount: 10 })]);
    const { items, r } = expectParity(invoice);
    expect(items[0]).toMatchObject({ precioUni: 44.24778761, montoDescu: 8.84955752, ventaGravada: 79.65, tributos: ['20'] });
    expect(r.subTotalVentas).toBe(79.65);
    expect(r.totalDescu).toBe(8.85);
    expect(r.tributos[0].valor).toBe(10.35);
    expect(invoice.totals).toMatchObject({ tax: 10.35, subTotal: 79.65, totalAmount: 90 });
  });

  it('NC 10 × $1.00 stores the same IVA the DTE reports (1.20, not 1.15)', () => {
    const invoice = makeInvoice(InvoiceType.NotaCredito, Array.from({ length: 10 }, () => line(1, 1)));
    expectParity(invoice);
    expect(invoice.totals!.tax).toBe(1.2);
  });

  it('NC with an exempt line: tributos null on it, IVA only from the gravado line', () => {
    const invoice = makeInvoice(InvoiceType.NotaCredito, [line(1, 56.5, { discount: 5.65 }), line(2, 5, { taxCategory: TaxCategory.EXENTO })]);
    const { items, r } = expectParity(invoice);
    expect(items[1]).toMatchObject({ ventaExenta: 10, ventaGravada: 0, tributos: null });
    expect(r.totalExenta).toBe(10);
    expect(r.tributos[0].valor).toBe(5.85);
  });
});

describe('Retention, renta and no-IVA documents', () => {
  it('CCF $226 with 1% retention stores and sends totalPagar 224', () => {
    const invoice = makeInvoice(InvoiceType.CCF, [line(2, 113)], { retention: true });
    const { r } = expectParity(invoice);
    expect(invoice.totals).toMatchObject({ ivaRete1: 2, totalPagar: 224, reteRenta: 0, totalAmount: 226 });
    expect(r).toMatchObject({ ivaRete: 2, totalPagar: 224, montoTotalOperacion: 226 });
    expect(r.pagos[0].montoPago).toBe(224);
  });

  it('retention comes from the stored totals, not the customer flag at send time', () => {
    const stored = makeInvoice(InvoiceType.CCF, [line(2, 113)], { retention: true });
    const flagFlipped = { ...stored, customer: customer({ hasContributorRetention: false }) };
    expect((DTEMappingService.mapInvoice(flagFlipped, company, '00').resumen as any).ivaRete).toBe(2);
    const notRetained = makeInvoice(InvoiceType.CCF, [line(2, 113)], { retention: false });
    const flagAdded = { ...notRetained, customer: customer({ hasContributorRetention: true }) };
    expect((DTEMappingService.mapInvoice(flagAdded, company, '00').resumen as any).ivaRete).toBe(0);
  });

  it('retention is FE/CCF only and needs a US$100 base', () => {
    expect(computeTotals([line(1, 113)], InvoiceType.CCF, true).ivaRete1).toBe(1);
    expect(computeTotals([line(1, 100)], InvoiceType.CCF, true).ivaRete1).toBe(0); // base 88.50
    expect(computeTotals([line(2, 113)], InvoiceType.NotaCredito, true).ivaRete1).toBe(0);
    expect(computeTotals([line(2, 113)], InvoiceType.NotaCredito, true).totalPagar).toBe(226);
  });

  it('reteRenta only on Sujeto Excluido (no "Ret. Renta" on a CCF)', () => {
    expect(computeTotals([line(2, 113)], InvoiceType.CCF).reteRenta).toBe(0);
    const fse = makeInvoice(InvoiceType.SujetoExcluido, [line(3, 0.333)]);
    expect(fse.totals).toMatchObject({ totalAmount: 1, tax: 0, reteRenta: 0.1, totalPagar: 0.9 });
    const dte: any = DTEMappingService.mapInvoice(fse, company, '00');
    expect(dte.cuerpoDocumento[0]).toMatchObject({ precioUni: 0.333, compra: 1 }); // 8-decimal precioUni
    expect(dte.resumen).toMatchObject({ totalCompra: 1, reteRenta: 0.1, totalPagar: 0.9 });
  });

  it('FEX (0%) carries no IVA in the stored totals', () => {
    const fex = makeInvoice(InvoiceType.FacturaExportacion, [line(2, 113)]);
    expect(fex.totals).toMatchObject({ totalAmount: 226, tax: 0, subTotal: 226, totalPagar: 226 });
    const dte: any = DTEMappingService.mapInvoice(fex, company, '00');
    expect(dte.resumen).toMatchObject({ totalGravada: 226, montoTotalOperacion: 226, totalPagar: 226 });
  });

  it('non-discountable types ignore a leftover discount in totals AND in the DTE', () => {
    const fse = makeInvoice(InvoiceType.SujetoExcluido, [line(1, 100, { discount: 10 })]);
    expect(fse.totals!.totalAmount).toBe(100);
    expect((DTEMappingService.mapInvoice(fse, company, '00').resumen as any).totalCompra).toBe(100);
  });
});

describe('Tax-category gating per DTE type', () => {
  it('only bucket-splitting or no-IVA types accept exento / no sujeto lines', () => {
    for (const type of [InvoiceType.Factura, InvoiceType.CCF, InvoiceType.NotaCredito, InvoiceType.NotaDebito,
      InvoiceType.NotaRemision, InvoiceType.FacturaExportacion, InvoiceType.SujetoExcluido, InvoiceType.ComprobanteDonacion]) {
      expect(canInvoiceTaxCategory(type, TaxCategory.EXENTO)).toBe(true);
    }
    for (const type of [InvoiceType.ComprobanteRetencion, InvoiceType.ComprobanteLiquidacion,
      InvoiceType.DocumentoContableLiquidacion, InvoiceType.EventoOperacionesEspeciales, InvoiceType.EventoRetorno]) {
      expect(canInvoiceTaxCategory(type, TaxCategory.EXENTO)).toBe(false);
      expect(canInvoiceTaxCategory(type, TaxCategory.NO_GRAVADO)).toBe(false);
      expect(canInvoiceTaxCategory(type, TaxCategory.GRAVADO)).toBe(true);
      expect(canInvoiceTaxCategory(type, undefined)).toBe(true);
      expect(taxCategoryBlockedMessage(type, TaxCategory.EXENTO)).toMatch(/exento de IVA/);
    }
    expect(blockedTaxCategoryLines([{ taxCategory: TaxCategory.GRAVADO }, { taxCategory: TaxCategory.EXENTO }], InvoiceType.ComprobanteRetencion)).toEqual([1]);
  });

  it('the mapper refuses an exempt line on a type that would report it as gravada', () => {
    const cr = makeInvoice(InvoiceType.ComprobanteRetencion, [line(1, 113, { taxCategory: TaxCategory.EXENTO, productName: 'Libro' })]);
    expect(() => DTEMappingService.mapInvoice(cr, company, '00')).toThrow(/"Libro" es exento o no sujeto/);
  });

  it('EXPORTACION products sold locally are gravado; FEX treats every line at 0%', () => {
    expect(computeLine(line(1, 113, { taxCategory: TaxCategory.EXPORTACION }), InvoiceType.CCF)).toMatchObject({ bucket: 'gravada', venta: 100, iva: 13 });
    expect(computeLine(line(1, 113, { taxCategory: TaxCategory.EXENTO }), InvoiceType.FacturaExportacion)).toMatchObject({ bucket: 'gravada', venta: 113, iva: 0 });
  });
});

describe('invoiceSlice carries the tax category', () => {
  const create = (items: CreateInvoiceInput['items'], invoiceType = InvoiceType.Factura, extra: Partial<CreateInvoiceInput> = {}) =>
    invoiceReducer(invoiceReducer(undefined, { type: '@@INIT' }), addInvoice({
      invoiceNumber: 'T', date: '2026-10-31', companyId: 'company-1', invoiceType, items, ...extra,
    }));

  it('defaults to GRAVADO and keeps an explicit category (POS consolidation passes taxCategory)', () => {
    const state = create([
      { productId: 'p1', quantity: 1, unitPrice: 113 },
      { productId: 'p2', quantity: 2, unitPrice: 10, taxCategory: TaxCategory.EXENTO },
    ]);
    const inv = state.invoices[0];
    expect(inv.items.map((i) => i.taxCategory)).toEqual([TaxCategory.GRAVADO, TaxCategory.EXENTO]);
    expect(inv.totals).toMatchObject({ totalAmount: 133, tax: 13, totalExenta: 20, subTotal: 100 });
  });

  it('stored totalPagar nets the retention; totalAmountIncludingTax follows it', () => {
    const state = create([{ productId: 'p1', quantity: 2, unitPrice: 113 }], InvoiceType.CCF, { customerHasRetention: true });
    const inv = state.invoices[0];
    expect(inv.totals).toMatchObject({ totalAmount: 226, ivaRete1: 2, totalPagar: 224 });
    expect(inv.totalAmountIncludingTax).toBe(224);
  });

  it('updateInvoice keeps the category and the retention on a status update', () => {
    let state = create([{ productId: 'p1', quantity: 2, unitPrice: 113, taxCategory: TaxCategory.NO_GRAVADO }], InvoiceType.CCF);
    const id = state.invoices[0].id;
    state = invoiceReducer(state, updateInvoice({ id, status: InvoiceStatus.Completada }));
    expect(state.invoices[0].items[0].taxCategory).toBe(TaxCategory.NO_GRAVADO);
    expect(state.invoices[0].totals).toMatchObject({ totalNoSuj: 226, tax: 0, totalPagar: 226 });
  });
});
