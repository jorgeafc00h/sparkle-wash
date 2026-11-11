import { InvoiceBatchGenerator } from '../services/invoiceGeneration/InvoiceBatchGenerator';
import { DTEMappingService } from '../services/dte/DTEMappingService';
import { Company, CompanyEnvironment, CompanyStatus } from '../types/company';
import { Customer, CustomerDocumentType, CustomerType } from '../types/customer';
import { Product, ProductStatus, TaxCategory, UnitOfMeasure } from '../types/product';
import { InvoiceType } from '../types/invoice';

const company: Company = {
  id: 'company-1',
  nombre: 'Comercial ABC, S.A. de C.V.',
  nombreComercial: 'Comercial ABC',
  nit: '0614-140494-134-2',
  nrc: '123456',
  correo: 'facturacion@example.com',
  telefono: '2222-3333',
  complemento: 'San Salvador',
  direccion: 'San Salvador',
  departamentoCode: '06',
  departamento: 'San Salvador',
  municipioCode: '14',
  municipio: 'San Salvador',
  codActividad: '46900',
  descActividad: 'Venta al por mayor de otros productos',
  tipoEstablecimiento: '02',
  establecimiento: 'Casa Matriz',
  codEstableMH: 'M001',
  codEstable: '',
  codPuntoVentaMH: 'P001',
  codPuntoVenta: '',
  environment: CompanyEnvironment.Development,
  isTestAccount: true,
  hasValidCertificate: true,
  hasApiCredentials: true,
  ivaPercentage: 13,
  currentInvoiceNumber: 1,
  currentCCFNumber: 1,
  status: CompanyStatus.Active,
  isDefault: true,
  userId: 'user-1',
  createdAt: '2026-06-10T12:00:00.000Z',
  updatedAt: '2026-06-10T12:00:00.000Z',
};

const businessCustomer: Customer = {
  id: 'customer-1',
  firstName: 'Empresa',
  lastName: 'XYZ',
  name: 'Empresa XYZ S.A. de C.V.',
  businessName: 'Empresa XYZ S.A. de C.V.',
  nationalId: '',
  nit: '0614-020203-101-1',
  nrc: '1481520',
  documentType: CustomerDocumentType.NIT,
  email: 'admin@empresaxyz.com.sv',
  phone: '2521-7426',
  address: 'Santa Tecla',
  department: 'La Libertad',
  departmentCode: '05',
  municipality: 'Santa Tecla',
  municipalityCode: '01',
  codActividad: '46900',
  descActividad: 'Venta al por mayor de otros productos',
  hasContributorRetention: false,
  customerType: CustomerType.Business,
  isActive: true,
  companyId: company.id,
  createdAt: '2026-06-10T12:00:00.000Z',
  updatedAt: '2026-06-10T12:00:00.000Z',
};

const product: Product = {
  id: 'product-1',
  productName: 'Servicio de Consultoria',
  unitPrice: 113,
  unitOfMeasure: UnitOfMeasure.SERVICIO,
  taxCategory: TaxCategory.GRAVADO,
  status: ProductStatus.Active,
  companyId: company.id,
  isActive: true,
  createdAt: '2026-06-10T12:00:00.000Z',
  updatedAt: '2026-06-10T12:00:00.000Z',
};

describe('InvoiceBatchGenerator production-access dates', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout'] });
    jest.setSystemTime(new Date('2026-06-11T02:30:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stores generated emission dates as the current El Salvador DTE date', async () => {
    const invoices = await InvoiceBatchGenerator.generateCreditosFiscales(
      1,
      [businessCustomer],
      [product],
      company,
      1,
    );

    expect(invoices[0].date).toBe('2026-06-10T12:00:00.000Z');
    const dte = DTEMappingService.mapInvoice(invoices[0], company, '00');
    expect(dte.identificacion.fecEmi).toBe('2026-06-10');
  });

  it('keeps helper parent and related document dates on the same DTE date', async () => {
    const { helperCCF, creditNotes } = await InvoiceBatchGenerator.generateCreditNotes(
      1,
      [],
      [businessCustomer],
      [product],
      company,
      1,
    );

    expect(helperCCF[0].date).toBe('2026-06-10T12:00:00.000Z');
    expect(creditNotes[0].relatedDocumentDate).toBe('2026-06-10T12:00:00.000Z');

    const parentDte = DTEMappingService.mapInvoice(helperCCF[0], company, '00');
    const noteDte = DTEMappingService.mapInvoice(creditNotes[0], company, '00');
    expect(parentDte.identificacion.fecEmi).toBe('2026-06-10');
    expect(noteDte.documentoRelacionado?.[0].fechaEmision).toBe('2026-06-10');
  });

  it('uses the normalized related date for Comprobante Liquidacion fechaEmision', async () => {
    const { helperCCF, comprobantes } = await InvoiceBatchGenerator.generateComprobanteLiquidacion(
      1,
      [],
      [businessCustomer],
      [product],
      company,
      1,
    );

    const parentDte = DTEMappingService.mapInvoice(helperCCF[0], company, '00');
    const clDte = DTEMappingService.mapInvoice(comprobantes[0], company, '00');
    expect(parentDte.identificacion.fecEmi).toBe('2026-06-10');
    expect((clDte.cuerpoDocumento[0] as any).fechaEmision).toBe('2026-06-10');
  });
});
