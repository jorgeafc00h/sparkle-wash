import { DTEMappingService } from '../services/dte/DTEMappingService';
import { Company, CompanyEnvironment, CompanyStatus } from '../types/company';
import { Customer, CustomerDocumentType, CustomerType } from '../types/customer';
import { Invoice, InvoiceStatus, InvoiceType } from '../types/invoice';

const company: Company = {
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
  municipioCode: '14',
  municipio: 'San Salvador',
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
};

const businessCustomer: Customer = {
  id: 'customer-1',
  firstName: 'Empresa',
  lastName: 'Cliente',
  name: 'Empresa Cliente SA de CV',
  businessName: 'Empresa Cliente SA de CV',
  nationalId: '',
  nit: '06140202031011',
  documentType: CustomerDocumentType.NIT,
  email: 'cliente@example.com',
  phone: '22223333',
  address: 'San Salvador',
  departmentCode: '06',
  municipalityCode: '14',
  hasContributorRetention: false,
  customerType: CustomerType.Business,
  isActive: true,
  companyId: 'company-1',
  codActividad: '46900',
  descActividad: 'Venta al por mayor de otros productos',
  nrc: '1481520',
  createdAt: '2026-06-09T00:00:00.000Z',
  updatedAt: '2026-06-09T00:00:00.000Z',
};

function makeInvoice(invoiceType: InvoiceType, overrides: Partial<Invoice> = {}): Invoice {
  const date = overrides.date ?? '2026-06-10T02:30:00.000Z';
  return {
    id: `invoice-${invoiceType}`,
    invoiceNumber: `DTE-${invoiceType}`,
    date,
    status: InvoiceStatus.Nueva,
    customerId: businessCustomer.id,
    customer: businessCustomer,
    invoiceType,
    documentType: invoiceType === InvoiceType.CCF ? '03' : String(invoiceType),
    generationCode: '11111111-1111-4111-8111-111111111111',
    controlNumber: `DTE-03-M001P001-000000000000001`,
    companyId: company.id,
    items: [
      {
        id: 'item-1',
        invoiceId: `invoice-${invoiceType}`,
        productId: 'product-1',
        productName: 'Servicio',
        quantity: 1,
        unitPrice: 113,
        obsItem: '',
        createdAt: date,
        updatedAt: date,
      },
    ],
    totals: {
      totalAmount: 113,
      tax: 13,
      subTotal: 100,
      reteRenta: 0,
      totalPagar: 113,
      ivaRete1: 0,
      totalWithoutTax: 100,
      isCCF: invoiceType === InvoiceType.CCF,
      totalItems: 1,
      version: DTEMappingService.getSchemaVersionForInvoiceType(invoiceType),
    },
    totalAmount: 113,
    totalAmountIncludingTax: 113,
    createdAt: date,
    updatedAt: date,
    ...overrides,
  };
}

describe('DTEMappingService date normalization', () => {
  it('uses the El Salvador calendar date for ISO invoice timestamps', () => {
    const dte = DTEMappingService.mapInvoice(makeInvoice(InvoiceType.CCF), company, '00');

    expect(dte.identificacion.fecEmi).toBe('2026-06-09');
  });

  it('keeps date-only strings unchanged', () => {
    const dte = DTEMappingService.mapInvoice(
      makeInvoice(InvoiceType.CCF, { date: '2026-06-10' }),
      company,
      '00',
    );

    expect(dte.identificacion.fecEmi).toBe('2026-06-10');
  });

  it('keeps Sujeto Excluido date-only strings unchanged', () => {
    const dte = DTEMappingService.mapInvoice(
      makeInvoice(InvoiceType.SujetoExcluido, {
        documentType: '14',
        date: '2026-06-10',
      }),
      company,
      '00',
    );

    expect(dte.identificacion.fecEmi).toBe('2026-06-10');
  });

  it('normalizes related document ISO dates for linked DTEs', () => {
    const dte = DTEMappingService.mapInvoice(
      makeInvoice(InvoiceType.NotaCredito, {
        documentType: '05',
        relatedDocumentType: '03',
        relatedDocumentNumber: '22222222-2222-4222-8222-222222222222',
        relatedDocumentDate: '2026-06-10T02:30:00.000Z',
        relatedInvoiceType: InvoiceType.CCF,
      }),
      company,
      '00',
    );

    expect(dte.identificacion.fecEmi).toBe('2026-06-09');
    expect(dte.documentoRelacionado?.[0]?.fechaEmision).toBe('2026-06-09');
  });

  it('normalizes comprobante liquidacion related emission date', () => {
    const dte = DTEMappingService.mapInvoice(
      makeInvoice(InvoiceType.ComprobanteLiquidacion, {
        documentType: '08',
        relatedDocumentType: '03',
        relatedDocumentNumber: 'DTE-03-M001P001-000000000000001',
        relatedDocumentDate: '2026-06-10T02:30:00.000Z',
        relatedInvoiceType: InvoiceType.CCF,
      }),
      company,
      '00',
    );

    expect(dte.identificacion.fecEmi).toBe('2026-06-09');
    expect(dte.cuerpoDocumento?.[0]?.fechaEmision).toBe('2026-06-09');
  });

  it('maps credit payment terms from invoice metadata', () => {
    const dte = DTEMappingService.mapInvoice(
      makeInvoice(InvoiceType.Factura, {
        documentType: '01',
        paymentCondition: 2,
        paymentTermCode: '01',
        paymentTermPeriod: 45,
      }),
      company,
      '00',
    );

    expect(dte.resumen.condicionOperacion).toBe(2);
    expect(dte.resumen.pagos?.[0]).toMatchObject({
      codigo: '01',
      plazo: '01',
      periodo: 45,
    });
  });
});
