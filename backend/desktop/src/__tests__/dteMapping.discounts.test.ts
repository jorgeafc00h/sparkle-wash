// MH discount fields on generated DTEs: cuerpoDocumento.montoDescu and the
// resumen chain. Discounts are PER ITEM only (the iOS / RN shape MH accepts):
// venta* are net of montoDescu, subTotalVentas = Σ venta* (net), the global
// descu* buckets and porcentajeDescuento stay 0, subTotal = subTotalVentas and
// totalDescu = Σ montoDescu (informative). Sending subTotalVentas gross with
// descuGravada repeating the item discounts counted them twice.
//
// Reference semantics (verified against MH JSON schemas + production DTEs):
//   - Factura (01): everything IVA-INCLUSIVE. ivaItem = round(ventaGravada − ventaGravada/1.13).
//   - CCF (03):     everything IVA-EXCLUSIVE. montoDescu and ventaGravada are
//                   derived from the stored inclusive figures via /1.13.
//   - Item formula: cantidad × precioUni − montoDescu ≈ venta* (exact when the
//                   arithmetic is clean).

import { DTEMappingService } from '../services/dte/DTEMappingService';
import { Company, CompanyEnvironment, CompanyStatus } from '../types/company';
import { Customer, CustomerDocumentType, CustomerType } from '../types/customer';
import { Invoice, InvoiceStatus, InvoiceType } from '../types/invoice';

function makeCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 'company-1',
    nit: '06141404941342',
    nombre: 'Jorge Flores',
    nombreComercial: 'Facturas Simples',
    nrc: '3174',
    correo: 'test@example.com',
    telefono: '22222222',
    complemento: 'San Salvador',
    direccion: 'San Salvador',
    departamentoCode: '06',
    departamento: 'San Salvador',
    municipioCode: '23',
    municipio: 'San Salvador Centro',
    codActividad: '62020',
    descActividad: 'Consultoria en informatica',
    tipoEstablecimiento: '01',
    establecimiento: 'Casa matriz',
    codEstableMH: 'M001',
    codEstable: '',
    codPuntoVentaMH: 'P001',
    codPuntoVenta: '',
    environment: CompanyEnvironment.Development,
    isTestAccount: true,
    hasValidCertificate: true,
    ivaPercentage: 13,
    currentInvoiceNumber: 1,
    currentCCFNumber: 1,
    hasApiCredentials: true,
    status: CompanyStatus.Active,
    isDefault: true,
    userId: 'user-1',
    createdAt: '2026-06-09T00:00:00.000Z',
    updatedAt: '2026-06-09T00:00:00.000Z',
    ...overrides,
  };
}

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'customer-1',
    firstName: 'Empresa',
    lastName: 'Cliente',
    businessName: 'Empresa Cliente SA de CV',
    nationalId: '',
    nit: '06140202031011',
    documentType: CustomerDocumentType.NIT,
    email: 'cliente@example.com',
    phone: '22223333',
    address: 'San Salvador',
    departmentCode: '06',
    municipalityCode: '23',
    hasContributorRetention: false,
    customerType: CustomerType.Business,
    isActive: true,
    companyId: 'company-1',
    codActividad: '46900',
    descActividad: 'Venta al por mayor de otros productos',
    nrc: '1481520',
    createdAt: '2026-06-09T00:00:00.000Z',
    updatedAt: '2026-06-09T00:00:00.000Z',
    ...overrides,
  };
}

function makeInvoice(over: Partial<Invoice> & Pick<Invoice, 'items' | 'invoiceType' | 'totals'>): Invoice {
  const date = '2026-09-28T15:00:00.000Z';
  return {
    id: 'invoice-disc',
    invoiceNumber: 'DTE-01',
    date,
    status: InvoiceStatus.Nueva,
    customerId: 'customer-1',
    customer: makeCustomer(),
    documentType: '01',
    generationCode: '11111111-1111-4111-8111-111111111111',
    controlNumber: 'DTE-01-M001P001-000000000000001',
    companyId: 'company-1',
    createdAt: date,
    updatedAt: date,
    ...over,
  } as Invoice;
}

// Totals fixtures mirror invoiceSlice.computeTotals output for the items.
function facturaTotals(totalAmount: number, totalDiscount: number) {
  const tax = Math.round((totalAmount - totalAmount / 1.13) * 100) / 100;
  return {
    totalAmount,
    tax,
    subTotal: Math.round((totalAmount - tax) * 100) / 100,
    reteRenta: 0,
    totalPagar: totalAmount,
    ivaRete1: 0,
    totalWithoutTax: Math.round((totalAmount / 1.13) * 100) / 100,
    isCCF: false,
    totalItems: 1,
    version: 2,
    totalDiscount,
  };
}

describe('DTEMappingService — discounts on Factura (tipo 01, IVA-inclusive)', () => {
  const invoice = makeInvoice({
    invoiceType: InvoiceType.Factura,
    items: [{
      id: 'item-1', invoiceId: 'invoice-disc', productId: 'p1', productName: 'Camisa',
      quantity: 1, unitPrice: 50, discount: 7.5, obsItem: '', createdAt: '', updatedAt: '',
    }],
    totals: facturaTotals(42.5, 7.5),
  });

  it('item carries montoDescu and nets ventaGravada (cantidad × precioUni − montoDescu)', () => {
    const dte = DTEMappingService.mapInvoice(invoice, makeCompany(), '00');
    const item = dte.cuerpoDocumento[0];
    expect(item.montoDescu).toBe(7.5);
    expect(item.precioUni).toBe(50);
    expect(item.ventaGravada).toBe(42.5);
    expect(item.cantidad * item.precioUni - item.montoDescu).toBe(item.ventaGravada);
    // MH recomputes ivaItem from the POST-discount ventaGravada.
    expect(item.ivaItem).toBe(4.89);
  });

  it('resumen: net subTotalVentas, no global discount, totalDescu = Σ montoDescu', () => {
    const dte = DTEMappingService.mapInvoice(invoice, makeCompany(), '00');
    const r = dte.resumen as any;
    expect(r.subTotalVentas).toBe(42.5);      // Σ ventaGravada (net)
    expect(r.descuGravada).toBe(0);
    expect(r.descuNoSuj).toBe(0);
    expect(r.descuExenta).toBe(0);
    expect(r.porcentajeDescuento).toBe(0);
    expect(r.totalDescu).toBe(7.5);           // Σ montoDescu
    expect(r.totalGravada).toBe(42.5);
    expect(r.subTotal).toBe(r.subTotalVentas); // no global discount
    expect(r.totalPagar).toBe(42.5);
    expect(r.totalIva).toBe(4.89);
    expect(r.pagos[0].montoPago).toBe(42.5);
  });
});

describe('DTEMappingService — discounts on CCF (tipo 03, IVA-exclusive)', () => {
  const invoice = makeInvoice({
    invoiceType: InvoiceType.CCF,
    documentType: '03',
    invoiceNumber: 'DTE-03',
    items: [{
      id: 'item-1', invoiceId: 'invoice-disc', productId: 'p1', productName: 'Servicio',
      quantity: 1, unitPrice: 113, discount: 11.3, obsItem: '', createdAt: '', updatedAt: '',
    }],
    totals: {
      totalAmount: 101.7,
      tax: 11.7,
      subTotal: 90,
      reteRenta: 0,
      totalPagar: 101.7,
      ivaRete1: 0,
      totalWithoutTax: 90,
      isCCF: true,
      totalItems: 1,
      version: 4,
      totalDiscount: 11.3,
    },
  });

  it('converts the stored inclusive discount to the exclusive montoDescu', () => {
    const dte = DTEMappingService.mapInvoice(invoice, makeCompany(), '00');
    const item = dte.cuerpoDocumento[0];
    expect(item.montoDescu).toBe(10);         // 11.30 / 1.13
    expect(item.precioUni).toBe(100);         // 113 / 1.13
    expect(item.ventaGravada).toBe(90);
    expect(item.cantidad * item.precioUni - item.montoDescu).toBe(item.ventaGravada);
    expect(item.ivaItem).toBeUndefined();     // CCF: no ivaItem
  });

  it('resumen discount fields are exclusive and per item only', () => {
    const dte = DTEMappingService.mapInvoice(invoice, makeCompany(), '00');
    const r = dte.resumen as any;
    expect(r.subTotalVentas).toBe(90);        // Σ ventaGravada (net, exclusive)
    expect(r.totalDescu).toBe(10);            // Σ montoDescu (exclusive)
    expect(r.descuGravada).toBe(0);
    expect(r.porcentajeDescuento).toBe(0);
    expect(r.totalGravada).toBe(90);
    expect(r.subTotal).toBe(90);
    expect(r.tributos[0].valor).toBe(11.7);   // IVA 13% over the net base 90
    expect(r.totalIva).toBeUndefined();
    expect(r.totalPagar).toBe(101.7);
  });
});

describe('DTEMappingService — discount guards and no-discount regression', () => {
  it('clamps a discount larger than the line gross (venta* can never go negative)', () => {
    const invoice = makeInvoice({
      invoiceType: InvoiceType.Factura,
      items: [{
        id: 'item-1', invoiceId: 'invoice-disc', productId: 'p1', productName: 'X',
        quantity: 1, unitPrice: 10, discount: 99, obsItem: '', createdAt: '', updatedAt: '',
      }],
      totals: facturaTotals(0, 10),
    });
    const dte = DTEMappingService.mapInvoice(invoice, makeCompany(), '00');
    const item = dte.cuerpoDocumento[0];
    expect(item.montoDescu).toBe(10);
    expect(item.ventaGravada).toBe(0);
    expect(item.ivaItem).toBe(0);
  });

  it('emits the historical zero-discount shape when no discounts exist', () => {
    const invoice = makeInvoice({
      invoiceType: InvoiceType.Factura,
      items: [{
        id: 'item-1', invoiceId: 'invoice-disc', productId: 'p1', productName: 'X',
        quantity: 1, unitPrice: 113, obsItem: '', createdAt: '', updatedAt: '',
      }],
      totals: facturaTotals(113, 0),
    });
    const dte = DTEMappingService.mapInvoice(invoice, makeCompany(), '00');
    const item = dte.cuerpoDocumento[0];
    const r = dte.resumen as any;
    expect(item.montoDescu).toBe(0);
    expect(r.subTotalVentas).toBe(r.totalGravada); // 113 === 113
    expect(r.totalDescu).toBe(0);
    expect(r.descuGravada).toBe(0);
    expect(r.porcentajeDescuento).toBe(0);
  });
});

describe('DTEMappingService — discounts on Nota de Crédito (CCF parent shape)', () => {
  it('carries montoDescu on items and totalDescu on the resumen', () => {
    const date = '2026-09-28T15:00:00.000Z';
    const invoice = makeInvoice({
      invoiceType: InvoiceType.NotaCredito,
      documentType: '05',
      invoiceNumber: 'DTE-05',
      relatedInvoiceType: InvoiceType.CCF,
      relatedDocumentType: '03',
      relatedDocumentNumber: 'DTE-03-M001P001-000000000000001',
      relatedDocumentDate: date,
      relatedGenerationCode: '11111111-1111-4111-8111-111111111111',
      items: [{
        id: 'item-1', invoiceId: 'invoice-disc', productId: 'p1', productName: 'Servicio',
        quantity: 1, unitPrice: 113, discount: 11.3, obsItem: '', createdAt: '', updatedAt: '',
      }],
      totals: {
        totalAmount: 101.7,
        tax: 11.7,
        subTotal: 90,
        reteRenta: 0,
        totalPagar: 101.7,
        ivaRete1: 0,
        totalWithoutTax: 90,
        isCCF: false,
        totalItems: 1,
        version: 4,
        totalDiscount: 11.3,
      },
    });
    const dte = DTEMappingService.mapInvoice(invoice, makeCompany(), '00');
    const item = dte.cuerpoDocumento[0];
    expect(item.montoDescu).toBe(10);
    expect(item.ventaGravada).toBe(90);
    expect(item.precioUni).toBe(100);         // 113 / 1.13 — NOT derived from the net amount
    expect(item.cantidad * item.precioUni - item.montoDescu).toBe(item.ventaGravada);
    const r = dte.resumen as any;
    expect(r.totalDescu).toBe(10);
    expect(r.subTotalVentas).toBe(90);        // net
    expect(r.subTotalVentas).toBe(r.totalGravada);
    expect(r.totalPagar).toBe(101.7); // 90 + 11.7 IVA
  });
});
