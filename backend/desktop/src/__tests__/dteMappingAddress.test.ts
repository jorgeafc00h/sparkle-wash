import { DTEMappingService } from '../services/dte/DTEMappingService';
import { Company, CompanyEnvironment, CompanyStatus } from '../types/company';
import { Customer, CustomerDocumentType, CustomerType } from '../types/customer';
import { Invoice, InvoiceStatus, InvoiceType } from '../types/invoice';

// These tests lock in the `direccion.distrito` behavior that fixes the MH
// `[receptor.direccion.distrito] VALOR NO ES PERMITIDO` rejection:
//   - an EXPLICIT distrito (captured by the new Distrito picker) flows through
//     verbatim, and the departamento/municipio the user selected are trusted
//     (the legacy municipio remap heuristic is bypassed).
//   - WITHOUT an explicit distrito, the legacy best-effort heuristic is left
//     exactly as it was (regression guard for un-migrated records).

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

function makeCcfInvoice(customer: Customer): Invoice {
  const date = '2026-06-10T02:30:00.000Z';
  return {
    id: 'invoice-ccf',
    invoiceNumber: 'DTE-03',
    date,
    status: InvoiceStatus.Nueva,
    customerId: customer.id,
    customer,
    invoiceType: InvoiceType.CCF,
    documentType: '03',
    generationCode: '11111111-1111-4111-8111-111111111111',
    controlNumber: 'DTE-03-M001P001-000000000000001',
    companyId: 'company-1',
    items: [
      {
        id: 'item-1',
        invoiceId: 'invoice-ccf',
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
      isCCF: true,
      totalItems: 1,
      version: DTEMappingService.getSchemaVersionForInvoiceType(InvoiceType.CCF),
    },
    totalAmount: 113,
    totalAmountIncludingTax: 113,
    createdAt: date,
    updatedAt: date,
  } as Invoice;
}

function receptorAddress(customer: Customer) {
  const dte = DTEMappingService.mapInvoice(makeCcfInvoice(customer), makeCompany(), '00');
  return (dte.receptor as any).direccion as { departamento: string; municipio: string; distrito: string };
}

function emisorAddress(company: Company) {
  const dte = DTEMappingService.mapInvoice(makeCcfInvoice(makeCustomer()), company, '00');
  return (dte.emisor as any).direccion as { departamento: string; municipio: string; distrito: string };
}

describe('DTEMappingService receptor.direccion.distrito (customer)', () => {
  it('uses an explicit customer districtCode verbatim', () => {
    // '19' (Ciudad Delgado) is a real CAT-008 district of municipio 23 (San
    // Salvador Centro) — the mapper now validates the pair against the scoped
    // catalog before trusting it verbatim.
    const dir = receptorAddress(
      makeCustomer({ departmentCode: '06', municipalityCode: '23', districtCode: '19' }),
    );
    expect(dir.distrito).toBe('19');
    expect(dir.departamento).toBe('06');
    // municipio is trusted verbatim (no legacy remap) when a distrito is set.
    expect(dir.municipio).toBe('23');
  });

  it('zero-pads a single-digit explicit districtCode', () => {
    const dir = receptorAddress(makeCustomer({ districtCode: '3' }));
    expect(dir.distrito).toBe('03');
  });

  it('does NOT run the legacy municipio remap when a distrito is explicit', () => {
    // '05' (El Paisnal) is a real CAT-008 district of municipio 20 (Guazapa
    // area). Dept 06 + OLD-style code 05 is also a key in the legacy
    // `migrated` table ('06:05' -> '23') — before this fix, an explicit-but-
    // unvalidated distrito of '05' risked the legacy heuristic path rewriting
    // the user's real municipio (20) to 23. With a genuinely valid explicit
    // distrito, the real municipio must be trusted verbatim instead.
    const dir = receptorAddress(
      makeCustomer({ departmentCode: '06', municipalityCode: '20', districtCode: '05' }),
    );
    expect(dir.distrito).toBe('05');
    expect(dir.municipio).toBe('20');
  });

  it('keeps the legacy heuristic unchanged when no districtCode is present', () => {
    const dir = receptorAddress(
      makeCustomer({
        departmentCode: '06',
        municipalityCode: '14',
        municipality: 'San Salvador',
        districtCode: undefined,
        district: undefined,
      }),
    );
    // Legacy behavior (regression guard): distrito falls back to the municipio
    // code, and normalizeMunicipioCode remaps 06:14 -> 23.
    expect(dir.distrito).toBe('14');
    expect(dir.municipio).toBe('23');
  });
});

describe('DTEMappingService emisor.direccion.distrito (company)', () => {
  it('uses an explicit company distritoCode verbatim', () => {
    const dir = emisorAddress(
      makeCompany({ departamentoCode: '05', municipioCode: '28', distritoCode: '11' }),
    );
    expect(dir.distrito).toBe('11');
    expect(dir.departamento).toBe('05');
    expect(dir.municipio).toBe('28');
  });

  it('keeps the legacy heuristic unchanged when no distritoCode is present', () => {
    const dir = emisorAddress(
      makeCompany({
        departamentoCode: '06',
        municipioCode: '14',
        municipio: 'San Salvador',
        distritoCode: undefined,
        distrito: undefined,
      }),
    );
    expect(dir.distrito).toBe('14');
    expect(dir.municipio).toBe('23');
  });
});
