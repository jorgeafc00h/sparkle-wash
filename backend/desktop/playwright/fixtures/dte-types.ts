/**
 * Per-DTE-type invoice builder for the parametrized mh-lite-sync spec.
 * Creates a `Nueva` invoice for each of the 11 MH document types with a
 * sensible parent reference when the type requires one.
 */

// Enum values from src/types/invoice.ts — kept as plain numbers to avoid
// importing source TypeScript into the test fixture.
export const INVOICE_TYPE = {
  Factura: 0,
  CCF: 1,
  NotaCredito: 2,
  SujetoExcluido: 3,
  NotaDebito: 4,
  NotaRemision: 5,
  ComprobanteLiquidacion: 6,
  FacturaExportacion: 7,
  ComprobanteRetencion: 8,
  DocumentoContableLiquidacion: 9,
  ComprobanteDonacion: 10,
} as const;

export type InvoiceTypeName = keyof typeof INVOICE_TYPE;

export const DOCUMENT_TYPE_CODES: Record<number, string> = {
  [INVOICE_TYPE.Factura]: '01',
  [INVOICE_TYPE.CCF]: '03',
  [INVOICE_TYPE.NotaRemision]: '04',
  [INVOICE_TYPE.NotaCredito]: '05',
  [INVOICE_TYPE.NotaDebito]: '06',
  [INVOICE_TYPE.ComprobanteRetencion]: '07',
  [INVOICE_TYPE.ComprobanteLiquidacion]: '08',
  [INVOICE_TYPE.DocumentoContableLiquidacion]: '09',
  [INVOICE_TYPE.FacturaExportacion]: '11',
  [INVOICE_TYPE.SujetoExcluido]: '14',
  [INVOICE_TYPE.ComprobanteDonacion]: '15',
};

export const DOCUMENT_SCHEMA_VERSIONS: Record<string, number> = {
  '01': 2,
  '03': 4,
  '04': 4,
  '05': 4,
  '06': 4,
  '07': 2,
  '08': 2,
  '09': 2,
  '11': 3,
  '14': 2,
  '15': 2,
};

/** Types that can be synced standalone (no parent DTE required). */
export const STANDALONE_TYPES: InvoiceTypeName[] = [
  'Factura',
  'CCF',
  'SujetoExcluido',
  'FacturaExportacion',
  'ComprobanteDonacion',
];

/** Types that normally require a parent CCF/Factura in the form. */
export const LINKED_TYPES: InvoiceTypeName[] = [
  'NotaCredito',
  'NotaDebito',
  'NotaRemision',
  'ComprobanteLiquidacion',
  'ComprobanteRetencion',
  'DocumentoContableLiquidacion',
];

export const ALL_TYPES: InvoiceTypeName[] = [...STANDALONE_TYPES, ...LINKED_TYPES];

/**
 * Today's El Salvador calendar date (YYYY-MM-DD) — the same Intl formatting as
 * DTEMappingService.formatDateSV (America/El_Salvador, UTC−6, no DST). The
 * fixture used `new Date().toISOString().slice(0, 10)`, i.e. the UTC date: after
 * 18:00 in El Salvador that is TOMORROW, and MH answered codigoMsg 007
 * "[identificacion.fecEmi (Fuera de periodo tributario)]" on Oct 31 evening
 * (Nov 1 UTC is outside October's open period).
 */
export function svToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

const PARENT_CCF_ID = 'parent-ccf-001';
const PARENT_FACTURA_ID = 'parent-factura-001';

/**
 * Returns a pair: [parent invoices needed for the test, target invoice in Nueva].
 * Parents are always in Completada state, with a valid control number + sello.
 */
export function buildInvoicesFor(typeName: InvoiceTypeName) {
  const targetId = `target-${typeName.toLowerCase()}`;
  const type = INVOICE_TYPE[typeName];
  const docType = DOCUMENT_TYPE_CODES[type];

  // Rich customer fixtures — mirror RN TestDataGenerator.generateCustomers
  // output so MH's schema validation passes. All address / contact fields
  // populated.
  const baseCustomer = {
    id: 'cust-001',
    firstName: 'Maria',
    lastName: 'Gonzalez',
    name: 'Maria Gonzalez',
    nationalId: '03721600-1',
    email: 'maria1@yopmail.com',
    phone: '7700-1201',
    departmentCode: '06',
    municipalityCode: '14',
    districtCode: '14',
    department: 'San Salvador',
    municipality: 'San Salvador',
    district: 'San Salvador',
    address: 'Col. Escalón, Calle El Mirador #123',
    nit: '0614170994-001-5',
    nrc: '3174',
    codActividad: '73100',
    descActividad: 'Publicidad',
    documentType: 'DUI',
    hasContributorRetention: false,
    customerType: 0,
    isActive: true,
    companyId: '1',
  };

  const exportCustomer = {
    id: 'cust-export',
    firstName: 'Export',
    lastName: 'Receiver',
    name: 'Export Receiver LLC',
    businessName: 'Export Receiver LLC',
    nationalId: '',
    email: 'ops@exportreceiver.com',
    phone: '+1 305-555-0100',
    departmentCode: '06',
    municipalityCode: '14',
    districtCode: '14',
    department: 'San Salvador',
    municipality: 'San Salvador',
    district: 'San Salvador',
    address: '123 Brickell Ave, Miami FL 33131',
    codPais: 'US',
    nombrePais: 'Estados Unidos',
    tipoPersona: '1',
    hasContributorRetention: false,
    customerType: 1,
    isActive: true,
    companyId: '1',
  };

  const donationCustomer = {
    id: 'cust-donor',
    firstName: 'Donante',
    lastName: 'Anonimo',
    name: 'Donante Anonimo',
    nationalId: '99887766-5',
    email: 'donante@yopmail.com',
    phone: '7700-9988',
    departmentCode: '06',
    municipalityCode: '14',
    districtCode: '14',
    department: 'San Salvador',
    municipality: 'San Salvador',
    district: 'San Salvador',
    address: 'Residencial El Pedregal #15',
    documentType: 'DUI',
    hasContributorRetention: false,
    customerType: 0,
    isActive: true,
    companyId: '1',
  };

  const ccfCustomer = {
    id: 'cust-002',
    firstName: 'Empresa',
    lastName: 'XYZ',
    name: 'Empresa XYZ S.A. de C.V.',
    businessName: 'Empresa XYZ S.A. de C.V.',
    nationalId: '',
    // NIT format: NNNN-NNNNNN-NNN-N. NRC is plain digits.
    nit: '0614-020203-101-1',
    nrc: '1481520',
    email: 'admin@empresaxyz.com.sv',
    phone: '2521-7426',
    departmentCode: '05',
    municipalityCode: '01',
    districtCode: '11',
    department: 'La Libertad',
    municipality: 'Santa Tecla',
    district: 'Santa Tecla',
    address: 'Blvd. Constitución #500',
    codActividad: '46900',
    descActividad: 'Venta al por mayor de otros productos',
    documentType: 'NIT',
    hasContributorRetention: true,
    customerType: 1,
    isActive: true,
    companyId: '1',
  };

  // Use a SMALLER unit price for NotaCredito so its totalGravada stays well
  // below the parent CCF's totalGravada (MH rejects NC ≥ parent).
  const isNC = type === INVOICE_TYPE.NotaCredito;
  const basicItem = {
    id: `${targetId}_detail_1`,
    invoiceId: targetId,
    productId: 'prod-001',
    productName: 'Servicio de Consultoría',
    quantity: 1,
    unitPrice: isNC ? 56.50 : 113.00,
    obsItem: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const baseUnit = isNC ? 56.5 : 113.0;
  const baseIva = Math.round((baseUnit - baseUnit / 1.13) * 100) / 100;
  const basePre = Math.round((baseUnit - baseIva) * 100) / 100;
  const baseTotals = {
    subTotal: basePre,
    ivaAmount: baseIva,
    totalPagar: baseUnit,
    totalAmount: baseUnit,
    totalItems: 1,
    tax: baseIva,
    totalWithoutTax: basePre,
    ivaRete1: 0,
    reteRenta: 0,
    isCCF: type === INVOICE_TYPE.CCF,
    version: DOCUMENT_SCHEMA_VERSIONS[docType] ?? 1,
  };

  const now = new Date().toISOString();

  const target: any = {
    id: targetId,
    invoiceNumber: `TEST-${type}`,
    controlNumber: '',
    date: svToday(),
    invoiceType: type,
    status: 0, // Nueva
    companyId: '1',
    customerId: baseCustomer.id,
    customer: baseCustomer,
    items: [basicItem],
    totals: baseTotals,
    totalAmount: 100.0,
    totalAmountIncludingTax: 100.0,
    documentType: docType,
    createdAt: now,
    updatedAt: now,
  };

  // Per-type customisations ----------------------------------------------------
  switch (type) {
    case INVOICE_TYPE.FacturaExportacion:
      target.customer = exportCustomer;
      target.customerId = exportCustomer.id;
      break;
    case INVOICE_TYPE.ComprobanteDonacion:
      target.customer = donationCustomer;
      target.customerId = donationCustomer.id;
      break;
    case INVOICE_TYPE.SujetoExcluido:
      // SE — natural person with DUI. MH validates codActividad against
      // the real catalog; use a valid one (45209 — Reparaciones de vehículos).
      target.customer = {
        ...donationCustomer,
        nit: '',
        codActividad: '45209',
        descActividad: 'Reparaciones de vehículos n.c.p.',
      };
      target.customerId = donationCustomer.id;
      break;
    case INVOICE_TYPE.CCF:
    case INVOICE_TYPE.NotaCredito:
    case INVOICE_TYPE.NotaDebito:
    case INVOICE_TYPE.ComprobanteLiquidacion:
    case INVOICE_TYPE.ComprobanteRetencion:
    case INVOICE_TYPE.DocumentoContableLiquidacion:
      // Linked DTEs (and NotaRemision-on-CCF) use a business receptor with
      // a real NIT — DUI receptors fail MH's tipoDocumento validation here.
      target.customer = ccfCustomer;
      target.customerId = ccfCustomer.id;
      break;
  }

  // Parent references for linked types ----------------------------------------
  const parentInvoices: any[] = [];

  const parentFactura = {
    id: PARENT_FACTURA_ID,
    invoiceNumber: 'PARENT-F-001',
    controlNumber: 'DTE-01-M001P001-000000000000001',
    generationCode: '11111111-1111-4111-8111-111111111111',
    receptionSeal: 'PARENT-SELLO-F',
    date: '2026-03-01',
    invoiceType: INVOICE_TYPE.Factura,
    status: 2, // Completada
    companyId: '1',
    customerId: baseCustomer.id,
    customer: baseCustomer,
    items: [{ ...basicItem, invoiceId: PARENT_FACTURA_ID, id: `${PARENT_FACTURA_ID}_d1` }],
    totals: baseTotals,
    totalAmount: 100,
    totalAmountIncludingTax: 100,
    documentType: '01',
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
  };

  const parentCCF = {
    id: PARENT_CCF_ID,
    invoiceNumber: 'PARENT-CCF-001',
    controlNumber: 'DTE-03-M001P001-000000000000001',
    generationCode: '22222222-2222-4222-8222-222222222222',
    receptionSeal: 'PARENT-SELLO-CCF',
    date: '2026-03-05',
    invoiceType: INVOICE_TYPE.CCF,
    status: 2, // Completada
    companyId: '1',
    customerId: ccfCustomer.id,
    customer: ccfCustomer,
    items: [{ ...basicItem, invoiceId: PARENT_CCF_ID, id: `${PARENT_CCF_ID}_d1` }],
    totals: baseTotals,
    totalAmount: 100,
    totalAmountIncludingTax: 100,
    documentType: '03',
    createdAt: '2026-03-05T00:00:00Z',
    updatedAt: '2026-03-05T00:00:00Z',
  };

  if (
    type === INVOICE_TYPE.NotaCredito ||
    type === INVOICE_TYPE.NotaDebito ||
    type === INVOICE_TYPE.DocumentoContableLiquidacion
  ) {
    parentInvoices.push(parentCCF);
    target.relatedDocumentType = '03';
    // NC/ND mappers use tipoGeneracion=2 (electronic) — MH expects parent's
    // codigoGeneracion UUID, not numeroControl. DCL doesn't read this field
    // (cuerpoDocumento is a periodLiquidacion summary), but we keep it
    // consistent with the electronic-parent convention.
    target.relatedDocumentNumber = parentCCF.generationCode;
    target.relatedDocumentDate = parentCCF.date;
    target.relatedInvoiceType = INVOICE_TYPE.CCF;
  }

  if (
    type === INVOICE_TYPE.ComprobanteLiquidacion ||
    type === INVOICE_TYPE.ComprobanteRetencion
  ) {
    parentInvoices.push(parentCCF);
    target.relatedDocumentType = '03';
    // CL items use tipoGeneracion=1 (físico) and CR auto-detects: both want
    // numeroControl when the parent is a self-signed test CCF that MH's DTE
    // registry can't resolve.
    target.relatedDocumentNumber = parentCCF.controlNumber;
    target.relatedDocumentDate = parentCCF.date;
    target.relatedInvoiceType = INVOICE_TYPE.CCF;
  }

  if (type === INVOICE_TYPE.NotaRemision) {
    parentInvoices.push(parentFactura);
    target.relatedDocumentType = '01';
    // NR mapper uses tipoGeneracion=2; pass parent's UUID, not controlNumber.
    target.relatedDocumentNumber = parentFactura.generationCode;
    target.relatedDocumentDate = parentFactura.date;
    target.relatedInvoiceType = INVOICE_TYPE.Factura;
    target.nombEntrega = 'Entrega de prueba';
    target.docuEntrega = 'DOC-TEST-1';
    target.receptor = 'Receptor de prueba';
    target.receptorDocu = baseCustomer.nationalId;
    target.observaciones = 'Nota de remisión de prueba';
  }

  return { parentInvoices, target };
}
