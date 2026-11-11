// DTE withholding options (openspec add-dte-withholding-options):
//  - FSE "Aplicar retención de renta (10%)" — per-document, ON by default;
//  - IVA percepción 1% — agente de percepción company, receptor not a gran
//    contribuyente, CCF from US$100.00 of gravado base, NC/ND of such a CCF.
// The decision is stored on the invoice (applyRentaRetention /
// applyIvaPerception + totals), so the stored totals, the DTE resumen, the PDF,
// the totals panel and the Excel export all report the same figures.
jest.mock('@/assets/facturasSimples.png', () => 'logo.png', { virtual: true });
jest.mock('qrcode', () => ({ __esModule: true, default: { toDataURL: jest.fn(async () => '') } }));

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as XLSX from 'xlsx';
import { DTEMappingService } from '../services/dte/DTEMappingService';
import { InvoicePDFGenerator } from '../services/pdf/InvoicePDFGenerator';
import { InvoiceExcelExportService } from '../services/export/InvoiceExcelExportService';
import { InvoiceTotals } from '../components/invoices/InvoiceTotals';
import invoiceReducer, { addInvoice, updateInvoice } from '../store/slices/invoiceSlice';
import { Company, CompanyEnvironment, CompanyStatus } from '../types/company';
import { Customer, CustomerDocumentType, CustomerType } from '../types/customer';
import { CreateInvoiceInput, Invoice, InvoiceDetail, InvoiceStatus, InvoiceType } from '../types/invoice';
import { TaxCategory } from '../types/product';
import {
  allocateCents,
  computeTotals,
  documentTotals,
  documentWithholdings,
  ivaPerceptionApplies,
  roundMoney,
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
  [InvoiceType.Factura]: '01', [InvoiceType.CCF]: '03', [InvoiceType.NotaCredito]: '05',
  [InvoiceType.NotaDebito]: '06', [InvoiceType.SujetoExcluido]: '14',
};

interface MakeOpts {
  retention?: boolean;
  perception?: boolean;
  renta?: boolean;
}

/** An invoice exactly as invoiceSlice stores it (decision flags + computed totals). */
function makeInvoice(invoiceType: InvoiceType, items: InvoiceDetail[], opts: MakeOpts = {}): Invoice {
  return {
    id: 'inv-1', invoiceNumber: 'DTE-X', date: '2026-10-31', status: InvoiceStatus.Nueva,
    customerId: 'customer-1', customer: customer({ hasContributorRetention: !!opts.retention }),
    invoiceType, documentType: DOC[invoiceType] ?? '01', companyId: 'company-1', createdAt: '', updatedAt: '',
    generationCode: '11111111-1111-4111-8111-111111111111', controlNumber: 'DTE-01-M001P001-000000000000001',
    relatedDocumentType: '03', relatedInvoiceType: InvoiceType.CCF, relatedDocumentDate: '2026-10-30',
    relatedGenerationCode: '22222222-2222-4222-8222-222222222222',
    applyRentaRetention: opts.renta,
    applyIvaPerception: opts.perception,
    items,
    totals: computeTotals(items, invoiceType, opts.retention, {
      applyRentaRetention: opts.renta,
      applyIvaPerception: opts.perception,
    }),
  } as Invoice;
}

const mapped = (invoice: Invoice): any => DTEMappingService.mapInvoice(invoice, company, '00');
const sum = (xs: number[]) => roundMoney(xs.reduce((a, b) => a + b, 0));

/** Stored totals ⇔ DTE resumen (the figures MH receives). */
function expectResumenParity(invoice: Invoice) {
  const dte = mapped(invoice);
  const r = dte.resumen;
  const t = invoice.totals!;
  expect(t.totalAmount).toBe(r.montoTotalOperacion);
  expect(t.totalPagar).toBe(r.totalPagar);
  expect(t.ivaPerci1 ?? 0).toBe(r.ivaPerci ?? 0);
  expect(t.ivaRete1).toBe(r.ivaRete ?? 0);
  expect(r.totalPagar).toBe(roundMoney(r.montoTotalOperacion + (r.ivaPerci ?? 0) - (r.ivaRete ?? 0)));
  if (r.pagos) expect(r.pagos[0].montoPago).toBe(r.totalPagar);
  return dte;
}

describe('FSE "Aplicar retención de renta (10%)"', () => {
  it('default keeps the 10%: $200 → reteRenta 20, total a pagar 180', () => {
    expect(computeTotals([line(1, 200)], InvoiceType.SujetoExcluido)).toMatchObject({ reteRenta: 20, totalPagar: 180, totalAmount: 200 });
    const fse = makeInvoice(InvoiceType.SujetoExcluido, [line(1, 200)]);
    expect(mapped(fse).resumen).toMatchObject({ totalCompra: 200, reteRenta: 20, totalPagar: 180 });
  });

  it('turned off (goods): reteRenta 0 and total a pagar = total in totals AND DTE', () => {
    expect(computeTotals([line(1, 200)], InvoiceType.SujetoExcluido, false, { applyRentaRetention: false }))
      .toMatchObject({ reteRenta: 0, totalPagar: 200, totalAmount: 200 });
    const fse = makeInvoice(InvoiceType.SujetoExcluido, [line(1, 200)], { renta: false });
    const r = mapped(fse).resumen;
    expect(r).toMatchObject({ totalCompra: 200, subTotal: 200, reteRenta: 0, totalPagar: 200 });
    expect(r.pagos[0].montoPago).toBe(200);
    expect(r.totalLetras).toBe('200.00 DOLARES AMERICANOS');
    expect(fse.totals).toMatchObject({ reteRenta: 0, totalPagar: 200 });
  });

  it('the option only exists on FSE (other types never withhold renta)', () => {
    expect(computeTotals([line(1, 226)], InvoiceType.CCF, false, { applyRentaRetention: true }).reteRenta).toBe(0);
  });

  it('an FSE stored before the option (no flag) keeps withholding in the DTE', () => {
    const legacy = { ...makeInvoice(InvoiceType.SujetoExcluido, [line(1, 200)]), applyRentaRetention: undefined };
    expect(documentTotals(legacy).reteRenta).toBe(20);
    expect(mapped(legacy).resumen.reteRenta).toBe(20);
    expect(mapped({ ...legacy, totals: undefined }).resumen.reteRenta).toBe(20);
  });

  it('invoiceSlice stores the option; status updates keep it; the editor can flip it', () => {
    let state = invoiceReducer(undefined, addInvoice({
      invoiceNumber: 'T', date: '2026-10-31', companyId: 'company-1', invoiceType: InvoiceType.SujetoExcluido,
      items: [{ productId: 'p1', quantity: 2, unitPrice: 100 }], applyRentaRetention: false,
    }));
    const id = state.invoices[0].id;
    expect(state.invoices[0].applyRentaRetention).toBe(false);
    expect(state.invoices[0].totals).toMatchObject({ reteRenta: 0, totalPagar: 200 });
    expect(state.invoices[0].totalAmountIncludingTax).toBe(200);

    state = invoiceReducer(state, updateInvoice({ id, status: InvoiceStatus.Completada }));
    expect(state.invoices[0].totals).toMatchObject({ reteRenta: 0, totalPagar: 200 });
    expect(mapped(state.invoices[0]).resumen).toMatchObject({ reteRenta: 0, totalPagar: 200 });

    state = invoiceReducer(state, updateInvoice({ id, applyRentaRetention: true }));
    expect(state.invoices[0].totals).toMatchObject({ reteRenta: 20, totalPagar: 180 });
  });
});

describe('IVA percepción 1% — decision (ivaPerceptionApplies)', () => {
  const agent = { isPerceptionAgent: true };
  const regular = { isLargeTaxpayer: false };
  const large = { isLargeTaxpayer: true };
  const ccfWith = { invoiceType: InvoiceType.CCF, totals: { ivaPerci1: 5 } };
  const ccfWithout = { invoiceType: InvoiceType.CCF, totals: { ivaPerci1: 0 } };

  it('agent company + regular receptor on a CCF', () => {
    expect(ivaPerceptionApplies({ invoiceType: InvoiceType.CCF, company: agent, customer: regular })).toBe(true);
    expect(ivaPerceptionApplies({ invoiceType: InvoiceType.CCF, company: agent, customer: null })).toBe(true);
  });

  it('never for a non-agent company or a gran contribuyente receptor', () => {
    expect(ivaPerceptionApplies({ invoiceType: InvoiceType.CCF, company: {}, customer: regular })).toBe(false);
    expect(ivaPerceptionApplies({ invoiceType: InvoiceType.CCF, company: { isPerceptionAgent: false }, customer: regular })).toBe(false);
    expect(ivaPerceptionApplies({ invoiceType: InvoiceType.CCF, company: agent, customer: large })).toBe(false);
  });

  it('only CCF / NC / ND (Factura, FSE, FEX carry no percepción)', () => {
    for (const type of [InvoiceType.Factura, InvoiceType.SujetoExcluido, InvoiceType.FacturaExportacion, InvoiceType.NotaRemision]) {
      expect(ivaPerceptionApplies({ invoiceType: type, company: agent, customer: regular })).toBe(false);
    }
  });

  it('NC / ND only when the referenced CCF carried percepción', () => {
    for (const type of [InvoiceType.NotaCredito, InvoiceType.NotaDebito]) {
      expect(ivaPerceptionApplies({ invoiceType: type, company: agent, customer: regular, parent: ccfWith })).toBe(true);
      expect(ivaPerceptionApplies({ invoiceType: type, company: agent, customer: regular, parent: ccfWithout })).toBe(false);
      expect(ivaPerceptionApplies({ invoiceType: type, company: agent, customer: regular, parent: null })).toBe(false);
      expect(ivaPerceptionApplies({ invoiceType: type, company: agent, customer: large, parent: ccfWith })).toBe(false);
      expect(ivaPerceptionApplies({ invoiceType: type, company: {}, customer: regular, parent: ccfWith })).toBe(false);
    }
  });
});

describe('IVA percepción 1% — amounts', () => {
  const perceived = (items: InvoiceDetail[], type = InvoiceType.CCF, retention = false) =>
    computeTotals(items, type, retention, { applyIvaPerception: true });

  it('agent sells a CCF with base $500.00: ivaPerci1 5.00, IVA 65.00, total a pagar 570.00', () => {
    expect(perceived([line(1, 565)])).toMatchObject({ subTotal: 500, tax: 65, totalAmount: 565, ivaPerci1: 5, totalPagar: 570 });
    const invoice = makeInvoice(InvoiceType.CCF, [line(1, 565)], { perception: true });
    const dte = expectResumenParity(invoice);
    expect(dte.resumen).toMatchObject({ totalGravada: 500, montoTotalOperacion: 565, ivaPerci: 5, ivaRete: 0, totalPagar: 570 });
    expect(dte.resumen.tributos[0].valor).toBe(65);
    expect(dte.resumen.totalLetras).toBe('570.00 DOLARES AMERICANOS');
  });

  it('threshold on the gravado base: $100.00 → 1.00; $99.99 → 0', () => {
    expect(perceived([line(1, 113)])).toMatchObject({ subTotal: 100, ivaPerci1: 1, totalPagar: 114 });
    const below = perceived([line(1, 112.99)]);
    expect(below.subTotal).toBe(99.99);
    expect(below).toMatchObject({ ivaPerci1: 0, totalPagar: 112.99 });
  });

  it('rounds half-up to cents (base 150.50 → 1.51)', () => {
    const t = perceived([line(1, 170.065)]);
    expect(t.subTotal).toBe(150.5);
    expect(t.ivaPerci1).toBe(1.51);
  });

  it('exento / no sujeto lines are not part of the base (or of the threshold)', () => {
    expect(perceived([line(1, 113), line(1, 50, { taxCategory: TaxCategory.EXENTO })]))
      .toMatchObject({ subTotal: 100, totalExenta: 50, totalAmount: 163, ivaPerci1: 1, totalPagar: 164 });
    expect(perceived([line(1, 101.7), line(2, 50, { taxCategory: TaxCategory.NO_GRAVADO })]))
      .toMatchObject({ subTotal: 90, ivaPerci1: 0 });
  });

  it('without the decision, or on a Factura, there is no percepción', () => {
    expect(computeTotals([line(1, 565)], InvoiceType.CCF).ivaPerci1).toBe(0);
    expect(computeTotals([line(1, 565)], InvoiceType.Factura, false, { applyIvaPerception: true }).ivaPerci1).toBe(0);
    const fe = makeInvoice(InvoiceType.Factura, [line(1, 565)], { perception: true });
    expect(mapped(fe).resumen.ivaPerci).toBeUndefined(); // FE-F-v2 forbids the key
    expect(mapped(fe).resumen.totalPagar).toBe(565);
  });

  it('percepción and 1% retention on the same CCF: total + 1% − 1%', () => {
    const invoice = makeInvoice(InvoiceType.CCF, [line(2, 113)], { perception: true, retention: true });
    expect(invoice.totals).toMatchObject({ ivaPerci1: 2, ivaRete1: 2, totalAmount: 226, totalPagar: 226 });
    expect(expectResumenParity(invoice).resumen).toMatchObject({ ivaPerci: 2, ivaRete: 2, totalPagar: 226 });
  });

  it('a CCF without percepción still sends ivaPerci 0 (required key)', () => {
    expect(expectResumenParity(makeInvoice(InvoiceType.CCF, [line(1, 565)])).resumen.ivaPerci).toBe(0);
  });
});

describe('IVA percepción on NC / ND of a CCF with percepción', () => {
  it.each([[InvoiceType.NotaCredito], [InvoiceType.NotaDebito]])(
    'type %s carries 1% of its own base, no US$100 threshold',
    (type) => {
      const invoice = makeInvoice(type, [line(1, 56.5)], { perception: true });
      expect(invoice.totals).toMatchObject({ subTotal: 50, tax: 6.5, totalAmount: 56.5, ivaPerci1: 0.5, totalPagar: 57 });
      const dte = expectResumenParity(invoice);
      expect(dte.resumen).toMatchObject({ ivaPerci: 0.5, totalPagar: 57, montoTotalOperacion: 56.5 });
      expect(dte.resumen.totalLetras).toBe('57.00 DOLARES AMERICANOS');
      expect(dte.cuerpoDocumento[0].ivaPerci).toBe(0.5);
    },
  );

  it('per-item ivaPerci adds up to resumen.ivaPerci (exento lines get none)', () => {
    const invoice = makeInvoice(InvoiceType.NotaCredito, [
      line(1, 37.66), line(1, 37.66), line(1, 37.66), line(3, 10, { taxCategory: TaxCategory.EXENTO }),
    ], { perception: true });
    const dte = expectResumenParity(invoice);
    const items: any[] = dte.cuerpoDocumento;
    expect(sum(items.map((i) => i.ivaPerci))).toBe(dte.resumen.ivaPerci);
    expect(items[3].ivaPerci).toBe(0);
    for (const it of items.slice(0, 3)) expect(Math.abs(it.ivaPerci - it.ventaGravada * 0.01)).toBeLessThanOrEqual(0.01);
  });

  it('a note without the decision sends ivaPerci 0 everywhere', () => {
    const dte = expectResumenParity(makeInvoice(InvoiceType.NotaDebito, [line(1, 565)]));
    expect(dte.resumen.ivaPerci).toBe(0);
    expect(dte.cuerpoDocumento[0].ivaPerci).toBe(0);
  });

  it('random CCF / NC / ND with percepción keep resumen = stored totals', () => {
    let s = 11;
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const cats = [TaxCategory.GRAVADO, TaxCategory.GRAVADO, TaxCategory.EXENTO, TaxCategory.NO_GRAVADO];
    for (const type of [InvoiceType.CCF, InvoiceType.NotaCredito, InvoiceType.NotaDebito]) {
      for (let k = 0; k < 150; k++) {
        const items = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => {
          const q = rnd() < 0.5 ? 1 + Math.floor(rnd() * 20) : Math.round((0.1 + rnd() * 5) * 1000) / 1000;
          const p = Math.round(rnd() * 80000) / 1000;
          return line(q, p, {
            discount: rnd() < 0.4 ? roundMoney(q * p * 0.1) : undefined,
            taxCategory: cats[Math.floor(rnd() * cats.length)],
          });
        });
        const invoice = makeInvoice(type, items, { perception: true, retention: rnd() < 0.3 });
        const dte = expectResumenParity(invoice);
        const base = invoice.totals!.subTotal;
        const expected = type === InvoiceType.CCF && base < 100 ? 0 : roundMoney(base * 0.01);
        expect(invoice.totals!.ivaPerci1).toBe(expected);
        if (type !== InvoiceType.CCF) {
          expect(sum(dte.cuerpoDocumento.map((i: any) => i.ivaPerci))).toBe(dte.resumen.ivaPerci);
        }
      }
    }
  });
});

describe('allocateCents', () => {
  it('splits in whole cents and adds up exactly', () => {
    expect(allocateCents(1, [1, 1, 1])).toEqual([0.34, 0.33, 0.33]);
    expect(allocateCents(0.5, [50, 0])).toEqual([0.5, 0]);
    expect(allocateCents(0, [1, 2])).toEqual([0, 0]);
    expect(allocateCents(1.13, [0, 0])).toEqual([0, 0]);
    const shares = allocateCents(7.77, [3.33, 12.5, 0.01, 99]);
    expect(sum(shares)).toBe(7.77);
  });
});

describe('Stored decision is the single source (slice + DTE)', () => {
  const create = (extra: Partial<CreateInvoiceInput>) =>
    invoiceReducer(undefined, addInvoice({
      invoiceNumber: 'T', date: '2026-10-31', companyId: 'company-1', invoiceType: InvoiceType.CCF,
      items: [{ productId: 'p1', quantity: 1, unitPrice: 565 }], customer: customer(), ...extra,
    }));

  it('addInvoice stores the decision and the percepción in totals / totalPagar', () => {
    const state = create({ applyIvaPerception: true });
    const inv = state.invoices[0];
    expect(inv.applyIvaPerception).toBe(true);
    expect(inv.totals).toMatchObject({ ivaPerci1: 5, totalPagar: 570 });
    expect(inv.totalAmountIncludingTax).toBe(570);
    expect(mapped(inv).resumen).toMatchObject({ ivaPerci: 5, totalPagar: 570 });
  });

  it('status / bookkeeping updates keep the percepción; an edit can drop it', () => {
    let state = create({ applyIvaPerception: true });
    const id = state.invoices[0].id;
    state = invoiceReducer(state, updateInvoice({ id, status: InvoiceStatus.ErrorEnvio }));
    state = invoiceReducer(state, updateInvoice({ id, status: InvoiceStatus.Completada, receptionSeal: 'X' }));
    expect(state.invoices[0].totals).toMatchObject({ ivaPerci1: 5, totalPagar: 570 });
    state = invoiceReducer(state, updateInvoice({ id, applyIvaPerception: false }));
    expect(state.invoices[0].totals).toMatchObject({ ivaPerci1: 0, totalPagar: 565 });
    expect(mapped(state.invoices[0]).resumen.ivaPerci).toBe(0);
  });

  it('an invoice stored before the feature (no flag, no ivaPerci1) never gains percepción', () => {
    let state = create({});
    const id = state.invoices[0].id;
    const { ivaPerci1: _drop, ...legacyTotals } = state.invoices[0].totals!;
    state = { ...state, invoices: [{ ...state.invoices[0], totals: legacyTotals as any, applyIvaPerception: undefined }] };
    state = invoiceReducer(state, updateInvoice({ id, status: InvoiceStatus.Completada }));
    expect(state.invoices[0].totals!.ivaPerci1).toBe(0);
    expect(mapped(state.invoices[0]).resumen.ivaPerci).toBe(0);
  });

  it('invoices synced without the flags keep what their stored totals show on a status update', () => {
    // FSE without renta and CCF with percepción, as another device stores them (totals, no flags).
    const fse: Invoice = { ...makeInvoice(InvoiceType.SujetoExcluido, [line(1, 200)], { renta: false }), id: 'f', applyRentaRetention: undefined };
    const ccf: Invoice = { ...makeInvoice(InvoiceType.CCF, [line(1, 565)], { perception: true }), id: 'c', applyIvaPerception: undefined };
    let state = { ...invoiceReducer(undefined, { type: '@@INIT' }), invoices: [fse, ccf] as Invoice[] };
    state = invoiceReducer(state, updateInvoice({ id: 'f', status: InvoiceStatus.Completada }));
    state = invoiceReducer(state, updateInvoice({ id: 'c', status: InvoiceStatus.Completada }));
    expect(state.invoices[0].totals).toMatchObject({ reteRenta: 0, totalPagar: 200 });
    expect(state.invoices[1].totals).toMatchObject({ ivaPerci1: 5, totalPagar: 570 });
  });

  it('documentWithholdings: the stored totals decide; the stored flags only without figures', () => {
    const ccf = makeInvoice(InvoiceType.CCF, [line(1, 565)], { perception: true });
    expect(documentWithholdings(ccf).options.applyIvaPerception).toBe(true);
    // Synced from a device that stores totals but not the Desktop flag.
    expect(documentWithholdings({ ...ccf, applyIvaPerception: undefined }).options.applyIvaPerception).toBe(true);
    const { ivaPerci1: _p, ...noPerciTotals } = ccf.totals!;
    expect(documentWithholdings({ ...ccf, totals: noPerciTotals }).options.applyIvaPerception).toBe(true);
    expect(documentWithholdings({ ...ccf, totals: noPerciTotals, applyIvaPerception: undefined }).options.applyIvaPerception).toBe(false);

    const fseOff = makeInvoice(InvoiceType.SujetoExcluido, [line(1, 200)], { renta: false });
    expect(documentWithholdings(fseOff).options.applyRentaRetention).toBe(false);
    expect(documentWithholdings({ ...fseOff, applyRentaRetention: undefined }).options.applyRentaRetention).toBe(false);
    const { reteRenta: _r, ...noRentaTotals } = fseOff.totals!;
    expect(documentWithholdings({ ...fseOff, totals: noRentaTotals as any }).options.applyRentaRetention).toBe(false);
    expect(documentWithholdings({ ...fseOff, totals: null, applyRentaRetention: undefined }).options.applyRentaRetention).toBe(true);
    expect(mapped({ ...fseOff, applyRentaRetention: undefined }).resumen.reteRenta).toBe(0);
  });
});

describe('PDF, totals panel and Excel follow the stored totals', () => {
  const company2: any = {
    nombreComercial: 'Facturas Simples', correo: 'a@b.c', telefono: '22222222', codActividad: '62020',
    descActividad: 'Consultoria', nit: '06141404941342', nombre: 'X', nrc: '3174', complemento: 'SS',
  };
  const renderPdf = (invoice: Invoice) => {
    const html: string = (InvoicePDFGenerator as any).generateHTMLContent({ ...invoice, status: 2 }, company2, '', '', { tier: 'pro' });
    const rows = Object.fromEntries(
      [...html.matchAll(/<td>([^<]*)<\/td>\s*<td class="resumen-value">\$([0-9.\-]+)<\/td>/g)].map((m) => [m[1], Number(m[2])]),
    );
    const words = /class="total-words">([^<]*)</.exec(html)?.[1] ?? '';
    return { rows, words };
  };

  it('PDF: CCF with percepción prints "(+) Percepción IVA 1%" and the 570.00 total', () => {
    const { rows, words } = renderPdf(makeInvoice(InvoiceType.CCF, [line(1, 565)], { perception: true }));
    expect(rows['(+) Percepción IVA 1%:']).toBe(5);
    expect(rows['20 - Impuesto al Valor Agregado 13%:']).toBe(65);
    expect(rows['Monto Total de la Operación:']).toBe(565);
    expect(rows['Total a Pagar:']).toBe(570);
    expect(words).toBe('QUINIENTOS SETENTA DÓLARES');
  });

  it('PDF: no percepción row without the decision', () => {
    const { rows } = renderPdf(makeInvoice(InvoiceType.CCF, [line(1, 565)]));
    expect(rows['(+) Percepción IVA 1%:']).toBeUndefined();
    expect(rows['Total a Pagar:']).toBe(565);
  });

  it('PDF: FSE without renta prints no withholding row and the full total', () => {
    const off = renderPdf(makeInvoice(InvoiceType.SujetoExcluido, [line(1, 200)], { renta: false }));
    expect(off.rows['(-) Retención Renta:']).toBeUndefined();
    expect(off.rows['Total a Pagar:']).toBe(200);
    expect(off.words).toBe('DOSCIENTOS DÓLARES');
    const on = renderPdf(makeInvoice(InvoiceType.SujetoExcluido, [line(1, 200)]));
    expect(on.rows['(-) Retención Renta:']).toBe(20);
    expect(on.rows['Total a Pagar:']).toBe(180);
  });

  it('totals panel: percepción row and FSE renta row follow the options', () => {
    const panel = (props: any) => renderToStaticMarkup(React.createElement(InvoiceTotals, props));
    const ccf = panel({ items: [line(1, 565)], invoiceType: InvoiceType.CCF, applyIvaPerception: true });
    expect(ccf).toMatch(/Percepción IVA \(1%\)<\/span><span>\+\$5\.00/);
    expect(ccf).toMatch(/Total a Pagar<\/span>(<!-- -->)?.*\$570\.00/);
    expect(panel({ items: [line(1, 565)], invoiceType: InvoiceType.CCF })).not.toContain('Percepción');
    const fseOff = panel({ items: [line(1, 200)], invoiceType: InvoiceType.SujetoExcluido, applyRentaRetention: false });
    expect(fseOff).not.toContain('Retención Renta');
    expect(fseOff).toMatch(/Total a Pagar<\/span>(<!-- -->)?.*\$200\.00/);
    const fseOn = panel({ items: [line(1, 200)], invoiceType: InvoiceType.SujetoExcluido });
    expect(fseOn).toMatch(/Retención Renta \(10%\)<\/span><span>-\$20\.00/);
    expect(fseOn).toMatch(/\$180\.00/);
  });

  it('Excel: "Percepción IVA" and "Ret. Renta" columns come from the stored totals', async () => {
    const ccf = { ...makeInvoice(InvoiceType.CCF, [line(1, 565)], { perception: true }), id: 'a', controlNumber: 'C1' };
    const fse = { ...makeInvoice(InvoiceType.SujetoExcluido, [line(1, 200)], { renta: false }), id: 'b', controlNumber: 'F1' };
    const { blob } = InvoiceExcelExportService.buildMonthlyInvoicesBlob([ccf, fse], [], '0614', 2026, 10);
    const wb = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<Record<string, number | string>>(wb.Sheets[wb.SheetNames[0]]);
    expect(rows[0]).toMatchObject({ 'Percepción IVA': 5, 'Ret. IVA': 0, 'Total a Pagar': 570 });
    expect(rows[1]).toMatchObject({ 'Percepción IVA': 0, 'Ret. Renta': 0, 'Total a Pagar': 200 });
  });
});
