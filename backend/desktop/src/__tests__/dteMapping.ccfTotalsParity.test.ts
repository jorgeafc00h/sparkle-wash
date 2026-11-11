// CCF totals parity (2026-10-10 code review): the stored/UI/annex IVA must equal the
// IVA the DTE reports, and cantidad × precioUni must reproduce each line amount even
// for the large aggregated quantities a POS consolidation produces.
import { DTEMappingService } from '../services/dte/DTEMappingService';
import { Company, CompanyEnvironment, CompanyStatus } from '../types/company';
import { Customer, CustomerDocumentType, CustomerType } from '../types/customer';
import { Invoice, InvoiceDetail, InvoiceStatus, InvoiceType } from '../types/invoice';
import { computeTotals } from '../utils/invoiceTotals';

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


function ccf(items: Array<[number, number]>, hasRetention = false): Invoice {
  const details: InvoiceDetail[] = items.map(([quantity, unitPrice], i) => ({
    id: `item-${i}`, invoiceId: 'invoice-ccf', productId: `p${i}`, productName: `P${i}`,
    quantity, unitPrice, obsItem: '', createdAt: '', updatedAt: '',
  }));
  return makeInvoice({
    invoiceType: InvoiceType.CCF,
    documentType: '03',
    controlNumber: 'DTE-03-M001P001-000000000000001',
    customer: makeCustomer({ hasContributorRetention: hasRetention }),
    items: details,
    totals: computeTotals(details, InvoiceType.CCF, hasRetention),
  });
}

describe('DTEMappingService — CCF totals parity with the stored invoice', () => {
  it.each([
    [[[1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1]]],
    [[[1, 850], [1, 120]]],
    [[[100, 10], [250, 3.99], [1000, 1.25]]],
  ] as Array<[Array<[number, number]>]>)('stored IVA equals resumen.tributos IVA (%j)', (lines) => {
    const invoice = ccf(lines);
    const dte = DTEMappingService.mapInvoice(invoice, makeCompany(), '00');
    expect(dte.resumen.tributos?.[0]?.valor).toBe(invoice.totals!.tax);
    expect(dte.resumen.totalGravada).toBe(invoice.totals!.totalWithoutTax);
  });

  it('cantidad × precioUni − montoDescu reproduces ventaGravada on large quantities', () => {
    const dte = DTEMappingService.mapInvoice(ccf([[100, 10], [250, 3.99], [1000, 1.25]]), makeCompany(), '00');
    for (const item of dte.cuerpoDocumento) {
      expect(Math.abs(item.cantidad * item.precioUni - item.montoDescu - item.ventaGravada)).toBeLessThan(0.01);
    }
  });

  it('withholds 1% only from US$100 and nets it from totalPagar', () => {
    const big = DTEMappingService.mapInvoice(ccf([[1, 1130]], true), makeCompany(), '00');
    expect(big.resumen.ivaRete).toBe(10);
    expect(big.resumen.totalPagar).toBe(1120);

    const small = DTEMappingService.mapInvoice(ccf([[1, 112]], true), makeCompany(), '00');
    expect(small.resumen.ivaRete).toBe(0);
    expect(small.resumen.totalPagar).toBe(112);
  });
});

describe('DTEMappingService — related electronic DTE is referenced by codigoGeneracion', () => {
  it('a draft NC saved with the CCF número de control still sends the CCF codigoGeneracion', () => {
    const nc = makeInvoice({
      invoiceType: InvoiceType.NotaCredito,
      documentType: '05',
      controlNumber: 'DTE-05-M001P001-000000000000001',
      customer: makeCustomer(),
      items: [{
        id: 'it-1', invoiceId: 'invoice-nc', productId: 'p1', productName: 'Devolución',
        quantity: 1, unitPrice: 113, obsItem: '', createdAt: '', updatedAt: '',
      }],
      totals: computeTotals([{
        id: 'it-1', invoiceId: 'invoice-nc', productId: 'p1', productName: 'Devolución',
        quantity: 1, unitPrice: 113, obsItem: '', createdAt: '', updatedAt: '',
      }], InvoiceType.NotaCredito),
      relatedDocumentType: '03',
      relatedDocumentNumber: 'DTE-03-M001P001-000000000000042', // stored by ≤ 1.3.0 (2026-10-09)
      relatedGenerationCode: 'aaaa1111-2222-4333-8444-555566667777',
      relatedDocumentDate: '2026-10-01',
    });

    const dte = DTEMappingService.mapInvoice(nc, makeCompany(), '00');

    expect(dte.documentoRelacionado?.[0]).toMatchObject({
      tipoDocumento: '03',
      tipoGeneracion: 2,
      numeroDocumento: 'AAAA1111-2222-4333-8444-555566667777',
    });
    expect(dte.cuerpoDocumento[0].numeroDocumento).toBe('AAAA1111-2222-4333-8444-555566667777');
  });
});
