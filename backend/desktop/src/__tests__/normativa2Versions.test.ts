import { InvoiceGenerationService, SignedDTE } from '../services/invoiceGeneration/InvoiceGenerationService';
import { DTEMappingService, NORMATIVA_2_SCHEMA_VERSIONS } from '../services/dte/DTEMappingService';
import { InvoiceService } from '../services/api/InvoiceService';
import { InvoiceInvalidationService } from '../services/invalidation/InvoiceInvalidationService';
import { InvalidationReason } from '../services/invalidation/InvoiceInvalidationService';
import { Company, CompanyEnvironment, CompanyStatus } from '../types/company';
import { Customer, CustomerDocumentType, CustomerType } from '../types/customer';
import { Invoice, InvoiceStatus, InvoiceType } from '../types/invoice';
import { getMhClient } from '../services/api/MhClient';
import { SecureStorageService } from '../services/security/SecureStorageService';

jest.mock('../services/security/SecureStorageService', () => ({
  SecureStorageService: {
    getCredentials: jest.fn(),
  },
}));

jest.mock('../services/api/MhClient', () => ({
  getMhClient: jest.fn(),
}));

jest.mock('../services/api/SyncLogger', () => ({
  SyncLogger: {
    logSyncRequest: jest.fn(),
    logSyncResponse: jest.fn(),
    logSyncError: jest.fn(),
  },
}));

jest.mock('@/services/signing/SignerService', () => ({
  getSignerService: jest.fn(),
}));

jest.mock('../services/signing/SignerService', () => ({
  getSignerService: jest.fn(() => ({
    signAsync: jest.fn().mockResolvedValue({ status: 'OK', body: 'signed-invalidation-jws' }),
  })),
}));

jest.mock('../utils/logger', () => ({
  logger: {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../services/api/HttpClient', () => ({
  HttpClient: jest.fn(),
  ApiError: class ApiError extends Error {},
  getHttpClient: jest.fn(() => ({
    post: jest.fn(),
  })),
}));

jest.mock('../services/telemetry/TelemetryService', () => ({
  TelemetryService: {
    trackDependency: jest.fn(),
    trackEvent: jest.fn(),
    trackException: jest.fn(),
  },
}));

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
  nationalId: '012345678',
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

const EXPECTED_NORMATIVA_2_SCHEMA_VERSIONS: Record<string, number> = {
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
  '17': 1,
  '18': 1,
  invalidacion: 3,
  contingencia: 4,
};

function makeInvoice(invoiceType: InvoiceType, documentType: string, overrides: Partial<Invoice> = {}): Invoice {
  const date = '2026-06-10T02:30:00.000Z';
  return {
    id: `invoice-${documentType}`,
    invoiceNumber: `DTE-${documentType}-M001P001-000000000000001`,
    date,
    status: InvoiceStatus.Nueva,
    customerId: businessCustomer.id,
    customer: businessCustomer,
    invoiceType,
    documentType,
    generationCode: '11111111-1111-4111-8111-111111111111',
    controlNumber: `DTE-${documentType}-M001P001-000000000000001`,
    companyId: company.id,
    relatedDocumentType: '03',
    relatedDocumentNumber: '22222222-2222-4222-8222-222222222222',
    relatedDocumentDate: date,
    relatedInvoiceType: InvoiceType.CCF,
    receptor: 'Empresa Cliente SA de CV',
    receptorDocu: '01234567-8',
    nombEntrega: 'Jorge Flores',
    docuEntrega: '06141404941342',
    items: [
      {
        id: 'item-1',
        invoiceId: `invoice-${documentType}`,
        productId: 'product-1',
        productName: 'Servicio',
        quantity: 1,
        unitPrice: 113,
        obsItem: 'Servicio',
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
      version: NORMATIVA_2_SCHEMA_VERSIONS[documentType],
    },
    totalAmount: 113,
    totalAmountIncludingTax: 113,
    createdAt: date,
    updatedAt: date,
    ...overrides,
  };
}

describe('Normativa 2 DTE versions', () => {
  it('pins the latest Normativa 2 direct-schema version map', () => {
    expect(NORMATIVA_2_SCHEMA_VERSIONS).toMatchObject(EXPECTED_NORMATIVA_2_SCHEMA_VERSIONS);
  });

  it('emits identificacion.version from the Normativa 2 map for all invoice DTE types', () => {
    const cases: Array<[InvoiceType, string]> = [
      [InvoiceType.Factura, '01'],
      [InvoiceType.CCF, '03'],
      [InvoiceType.NotaRemision, '04'],
      [InvoiceType.NotaCredito, '05'],
      [InvoiceType.NotaDebito, '06'],
      [InvoiceType.ComprobanteRetencion, '07'],
      [InvoiceType.ComprobanteLiquidacion, '08'],
      [InvoiceType.DocumentoContableLiquidacion, '09'],
      [InvoiceType.FacturaExportacion, '11'],
      [InvoiceType.SujetoExcluido, '14'],
      [InvoiceType.ComprobanteDonacion, '15'],
    ];

    for (const [invoiceType, documentType] of cases) {
      const dte = DTEMappingService.mapInvoice(
        makeInvoice(invoiceType, documentType),
        company,
        '00',
      );

      expect(dte.identificacion.tipoDte).toBe(documentType);
      expect(dte.identificacion.version).toBe(NORMATIVA_2_SCHEMA_VERSIONS[documentType]);
    }
  });

  it('maps CCF-linked credit and debit notes with accepted Normativa 2 adjustment tax fields', () => {
    for (const [invoiceType, documentType] of [
      [InvoiceType.NotaCredito, '05'],
      [InvoiceType.NotaDebito, '06'],
    ] as Array<[InvoiceType, string]>) {
      const dte = DTEMappingService.mapInvoice(
        makeInvoice(invoiceType, documentType),
        company,
        '00',
      );
      const item = dte.cuerpoDocumento[0] as any;
      const resumen = dte.resumen as any;

      expect(item.ventaGravada).toBe(100);
      expect(item.precioUni).toBe(100);
      expect(item.tributos).toEqual(['20']);
      expect(item.noGravado).toBe(0);
      expect(item.ivaPerci).toBe(0);
      expect(item.totalIva).toBe(0);
      expect(item.ivaRete).toBe(0);
      expect(resumen.totalGravada).toBe(100);
      expect(resumen.montoTotalOperacion).toBe(113);
      expect(resumen.totalPagar).toBe(113);
      expect(resumen.ivaPerci).toBe(0);
      expect(resumen.totalIva).toBe(0);
      expect(resumen.ivaRete).toBe(0);
      expect(resumen.tributos[0].valor).toBe(13);
      expect('ivaPerci1' in resumen).toBe(false);
      expect('ivaRete1' in resumen).toBe(false);
    }
  });

  it('uses the same version map for direct MH submission of normal DTE types', async () => {
    const submitDTE = jest.fn().mockResolvedValue({ estado: 'PROCESADO' });
    const submitEvent = jest.fn();
    (getMhClient as jest.Mock).mockReturnValue({ submitDTE, submitEvent });
    (SecureStorageService.getCredentials as jest.Mock).mockResolvedValue({
      user: '06141404941342',
      password: 'mh-password',
    });

    const signedDte: SignedDTE = {
      payload: {} as SignedDTE['payload'],
      signature: 'signed-jws',
      signedJson: 'signed-jws',
    };

    for (const tipoDte of ['01', '03', '04', '05', '06', '07', '08', '09', '11', '14', '15']) {
      submitDTE.mockClear();
      submitEvent.mockClear();
      await InvoiceGenerationService.submitToMH(
        signedDte,
        makeInvoice(InvoiceType.Factura, tipoDte, { documentType: tipoDte }),
        'development',
        company,
      );

      expect(submitDTE).toHaveBeenCalledWith(
        expect.objectContaining({
          tipoDte,
          version: NORMATIVA_2_SCHEMA_VERSIONS[tipoDte],
        }),
        expect.any(Object),
      );
      expect(submitEvent).not.toHaveBeenCalled();
    }
  });

  it('submits direct MH event types with tipoEvento and the event endpoint', async () => {
    const submitDTE = jest.fn();
    const submitEvent = jest.fn().mockResolvedValue({ estado: 'PROCESADO' });
    (getMhClient as jest.Mock).mockReturnValue({ submitDTE, submitEvent });
    (SecureStorageService.getCredentials as jest.Mock).mockResolvedValue({
      user: '06141404941342',
      password: 'mh-password',
    });

    for (const tipoEvento of ['17', '18']) {
      submitDTE.mockClear();
      submitEvent.mockClear();

      const signedDte: SignedDTE = {
        payload: {
          identificacion: {
            tipoEvento,
            codigoGeneracion: `${tipoEvento}${tipoEvento}${tipoEvento}${tipoEvento}${tipoEvento}${tipoEvento}${tipoEvento}${tipoEvento}-1111-4111-8111-111111111111`,
          },
        } as unknown as SignedDTE['payload'],
        signature: 'signed-event-jws',
        signedJson: 'signed-event-jws',
      };

      await InvoiceGenerationService.submitToMH(
        signedDte,
        makeInvoice(InvoiceType.Factura, tipoEvento, { documentType: tipoEvento }),
        'development',
        company,
      );

      expect(submitEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          tipoEvento,
          version: NORMATIVA_2_SCHEMA_VERSIONS[tipoEvento],
          documento: 'signed-event-jws',
        }),
        expect.any(Object),
      );
      expect(submitDTE).not.toHaveBeenCalled();
    }
  });

  it('uses the original DTE type and configured invalidacion schema version in the direct local invalidation envelope', async () => {
    const invalidateDTE = jest.fn().mockResolvedValue({ estado: 'PROCESADO' });
    (getMhClient as jest.Mock).mockReturnValue({ invalidateDTE });

    const service = new InvoiceService(false);
    await service.invalidateDocumentLocal(
      { identificacion: { version: NORMATIVA_2_SCHEMA_VERSIONS.invalidacion }, emisor: {}, documento: { tipoDte: '01' }, motivo: {} } as any,
      {
        user: '06141404941342',
        credential: 'mh-password',
        key: 'cert-password',
        invoiceNumber: 'INV-000001',
      },
    );

    expect(invalidateDTE).toHaveBeenCalledWith(
      expect.objectContaining({
        tipoDte: '01',
        version: NORMATIVA_2_SCHEMA_VERSIONS.invalidacion,
      }),
      expect.any(Object),
    );
  });

  it('sets invalidation service environment from production flag', () => {
    const service = new InvoiceInvalidationService(true);
    expect((service as any).invoiceService.getEnvironmentCode()).toBe('01');

    service.setEnvironment(false);
    expect((service as any).invoiceService.getEnvironmentCode()).toBe('00');
  });

  it('keeps invalidacion reason codes aligned with CAT-024', () => {
    const service = new InvoiceInvalidationService(false);

    expect(service.getAvailableReasons()).toEqual([
      { code: InvalidationReason.ErrorInformation, description: 'Error en la Información del Documento Tributario Electrónico a invalidar.' },
      { code: InvalidationReason.ProductReturn, description: 'Rescindir de la operación realizada.' },
      { code: InvalidationReason.Other, description: 'Otro' },
    ]);
    expect(InvalidationReason.Other).toBe('3');
  });

  it('maps invalidacion payloads to latest schema field names', () => {
    const payload = DTEMappingService.mapInvalidationModel(
      makeInvoice(InvoiceType.Factura, '01', {
        status: InvoiceStatus.Completada,
        receptionSeal: 'A'.repeat(40),
        tax: 13,
      }),
      company,
      {
        tipoAnulacion: 2,
        motivoAnulacion: 'Prueba de anulacion',
        nombreResponsable: 'Jorge Flores',
        tipDocResponsable: '13',
        numDocResponsable: '00000000-0',
        nombreSolicita: 'Jorge Flores',
        tipDocSolicita: '13',
        numDocSolicita: '00000000-0',
      },
      company.nombreComercial,
      '00',
    );

    expect(payload.identificacion).toEqual(
      expect.objectContaining({
        version: NORMATIVA_2_SCHEMA_VERSIONS.invalidacion,
        ambiente: '00',
        fecEmi: expect.any(String),
        horEmi: expect.any(String),
        fusion: null,
      }),
    );
    expect(payload.identificacion).not.toHaveProperty('fecAnula');
    expect(payload.identificacion).not.toHaveProperty('horAnula');

    expect(payload.emisor).toEqual(
      expect.objectContaining({
        codEstableMH: 'M001',
        codEstable: null,
        codPuntoVentaMH: 'P001',
        codPuntoVenta: null,
      }),
    );
    expect(payload.emisor).not.toHaveProperty('tipoEstablecimiento');
    expect(payload.emisor).not.toHaveProperty('nomEstablecimiento');
    expect(payload.documento).toEqual(
      expect.objectContaining({
        tipoDte: '01',
        codigoGeneracionR: null,
        tipoDocumento: '13',
      }),
    );
    expect(payload.documento).not.toHaveProperty('montoIva');
  });

  it('uses Normativa invalidation deadlines: three months for 01/11/14 and the 10th business day of the next month for the rest', () => {
    const service = new InvoiceInvalidationService(false);

    const facturaDeadline = service.getDeadline(
      makeInvoice(InvoiceType.Factura, '01', {
        fechaTransmision: '2026-06-19T12:00:00.000-06:00',
      }),
    );
    expect(facturaDeadline.getFullYear()).toBe(2026);
    expect(facturaDeadline.getMonth()).toBe(8);
    expect(facturaDeadline.getDate()).toBe(19);

    const ccfDeadline = service.getDeadline(
      makeInvoice(InvoiceType.CCF, '03', {
        fechaTransmision: '2026-06-19T12:00:00.000-06:00',
      }),
    );
    // Manual Funcional v2.0: 10th business day of the month after the sello.
    // July 2026: 1,2,3,6,7,8,9,10,13,14 → Tuesday 14-07-2026 23:59:59.
    expect(ccfDeadline.getFullYear()).toBe(2026);
    expect(ccfDeadline.getMonth()).toBe(6);
    expect(ccfDeadline.getDate()).toBe(14);
    expect(ccfDeadline.getHours()).toBe(23);
    expect(ccfDeadline.getMinutes()).toBe(59);
  });

  it.each([
    // The Manual Funcional v2.0's own examples (Holy Week + 1 May are not business days).
    ['2026-03-19T07:30:00.000-06:00', 3, 20],
    ['2026-04-25T00:30:00.000-06:00', 4, 15],
    ['2026-03-09T10:00:00.000-06:00', 3, 20],
    ['2026-04-15T10:00:00.000-06:00', 4, 15],
  ])('CCF sellado %s can be invalidated until month %i day %i', (fechaTransmision, month, day) => {
    const deadline = new InvoiceInvalidationService(false).getDeadline(
      makeInvoice(InvoiceType.CCF, '03', { fechaTransmision }),
    );
    expect([deadline.getMonth(), deadline.getDate()]).toEqual([month, day]);
  });

  it('invalidation "Fecha del Evento" equals the generation date for CCF but may be today for FE', () => {
    const motivo = {
      tipoAnulacion: 2, motivoAnulacion: 'Rescindir', nombreResponsable: 'Jorge', tipDocResponsable: '13',
      numDocResponsable: '012345678', nombreSolicita: 'Jorge', tipDocSolicita: '13', numDocSolicita: '012345678',
    };
    const generated = '2026-03-29T15:00:00.000-06:00';
    const ccf = DTEMappingService.mapInvalidationModel(
      makeInvoice(InvoiceType.CCF, '03', { date: generated, fechaTransmision: '2026-04-04T10:00:00.000-06:00' }),
      company, motivo, 'Casa matriz', '00', null,
    );
    expect(ccf.identificacion.fecEmi).toBe('2026-03-29');
    expect(ccf.documento.fecEmi).toBe('2026-03-29');

    const fe = DTEMappingService.mapInvalidationModel(
      makeInvoice(InvoiceType.Factura, '01', { date: generated }),
      company, motivo, 'Casa matriz', '00', null,
    );
    expect(fe.identificacion.fecEmi).not.toBe('2026-03-29');
    expect(fe.documento.fecEmi).toBe('2026-03-29');
  });

  it('maps contingency payloads to the latest contingencia schema version', () => {
    const payload = DTEMappingService.mapContingenciaRequest(
      [
        makeInvoice(InvoiceType.Factura, '01', {
          generationCode: '33333333-3333-4333-8333-333333333333',
        }),
      ],
      company,
      '00',
      new Date('2026-06-10T15:00:00.000Z'),
      new Date('2026-06-10T16:00:00.000Z'),
      1,
      'Prueba de contingencia',
      'Jorge Flores',
      '00000000-0',
    );

    expect(payload.identificacion).toEqual(
      expect.objectContaining({
        version: NORMATIVA_2_SCHEMA_VERSIONS.contingencia,
        ambiente: '00',
        fTransmision: expect.any(String),
        hTransmision: expect.any(String),
      }),
    );
    expect(payload.detalleDTE).toEqual([
      expect.objectContaining({
        noItem: 1,
        codigoGeneracion: '33333333-3333-4333-8333-333333333333',
        tipoDoc: '01',
      }),
    ]);
    expect(payload.emisor.numeroDocResponsable).toBe('000000000');
  });

  it('maps Normativa 2 municipio and distrito separately for current and legacy address records', () => {
    const currentMunicipioCompany = {
      ...company,
      departamentoCode: '06',
      municipioCode: '23',
      municipio: 'SAN SALVADOR CENTRO',
      distritoCode: undefined,
    };
    const currentPayload = DTEMappingService.mapInvoice(
      makeInvoice(InvoiceType.Factura, '01'),
      currentMunicipioCompany,
      '00',
    );
    expect(currentPayload.emisor.direccion).toEqual(
      expect.objectContaining({
        departamento: '06',
        municipio: '23',
        distrito: '14',
      }),
    );

    const legacyPayload = DTEMappingService.mapInvoice(
      makeInvoice(InvoiceType.Factura, '01'),
      { ...company, departamentoCode: '06', municipioCode: '14', municipio: 'San Salvador' },
      '00',
    );
    expect(legacyPayload.emisor.direccion).toEqual(
      expect.objectContaining({
        departamento: '06',
        municipio: '23',
        distrito: '14',
      }),
    );
  });

  it('builds event 17 and event 18 payloads with CAT-002 event identifiers', () => {
    const eop = DTEMappingService.mapOperacionesEspecialesEvent(company, '00', {
      codigoGeneracion: 'AAAAAAAA-1111-4111-8111-AAAAAAAAAAAA',
      date: '2026-06-10',
      items: [
        {
          codigoGeneracionRef: null,
          tipoDocumento: '02',
          numDocumento: 'OP-001',
          fechaEmision: '2026-06-10',
          cantidad: 1,
          descripcion: 'Operacion especial',
          docDel: null,
          docAl: null,
          precioUni: 100,
          ventaNoSuj: 0,
          ventaExenta: 0,
          ventaGravada: 100,
          tributos: null,
        },
      ],
    });
    expect(eop.identificacion).toEqual({
      version: NORMATIVA_2_SCHEMA_VERSIONS['17'],
      ambiente: '00',
      tipoModelo: 1,
      tipoOperacion: 1,
      tipoEvento: '17',
      codigoGeneracion: 'AAAAAAAA-1111-4111-8111-AAAAAAAAAAAA',
      fecEmi: '2026-06-10',
      horEmi: expect.any(String),
      tipoMoneda: 'USD',
    });
    expect(eop.emisor).toEqual({ nit: '06141404941342', nombre: company.nombre });
    expect(eop.cuerpoDocumento[0]).toEqual(expect.objectContaining({ numItem: 1, tipoDocumento: '02' }));
    expect(eop.resumen.total).toBe(100);

    const decimalQuantityEvent = DTEMappingService.mapInvoice(
      makeInvoice(InvoiceType.EventoOperacionesEspeciales, '17', {
        relatedDocumentType: '02',
        relatedDocumentNumber: 'OP-001',
        relatedDocumentDate: '2026-06-10',
        items: [
          {
            id: 'item-decimal',
            invoiceId: 'invoice-17',
            productId: 'product-1',
            productName: 'Operacion especial decimal',
            quantity: 1.5,
            unitPrice: 100,
            obsItem: 'Operacion especial decimal',
            createdAt: '2026-06-10T02:30:00.000Z',
            updatedAt: '2026-06-10T02:30:00.000Z',
          },
        ],
      }),
      company,
      '00',
    ) as any;
    expect(decimalQuantityEvent.cuerpoDocumento[0].cantidad).toBe(1);
    expect(decimalQuantityEvent.cuerpoDocumento[0].ventaGravada).toBe(100);

    const retorno = DTEMappingService.mapRetornoEvent(company, '00', {
      codigoGeneracion: 'BBBBBBBB-1111-4111-8111-BBBBBBBBBBBB',
      date: '2026-06-10',
      documentoRelacionado: [
        {
          tipoDocumento: '11',
          codigoGeneracion: 'CCCCCCCC-1111-4111-8111-CCCCCCCCCCCC',
          fechaEmision: '2026-06-10',
        },
      ],
      documento: null,
      items: [
        {
          tipoItem: 2,
          codigoGeneracion: 'DDDDDDDD-1111-4111-8111-DDDDDDDDDDDD',
          cantidad: 1,
          precioUni: 100,
          descripcion: 'Retorno',
          codigo: null,
          uniMedida: 99,
          montoDescu: 0,
          codTributo: null,
          ventaNoSuj: 0,
          ventaExenta: 0,
          ventaGravada: 100,
          compra: 0,
          tributos: null,
          psv: 0,
          ivaItem: 13,
          noGravado: 0,
          seguro: 0,
          flete: 0,
          ivaRete: 0,
          reteRenta: 0,
        },
      ],
    });
    expect(retorno.identificacion).toEqual({
      version: NORMATIVA_2_SCHEMA_VERSIONS['18'],
      ambiente: '00',
      tipoModelo: 1,
      tipoOperacion: 1,
      tipoEvento: '18',
      tipoContingencia: null,
      motivoContin: null,
      codigoGeneracion: 'BBBBBBBB-1111-4111-8111-BBBBBBBBBBBB',
      fecEmi: '2026-06-10',
      horEmi: expect.any(String),
      fusion: null,
      tipoMoneda: 'USD',
    });
    expect(retorno.emisor).toEqual(
      expect.objectContaining({
        nit: '06141404941342',
        codEstableMH: 'M001',
        codPuntoVentaMH: 'P001',
        tipoItemExpor: 2,
      }),
    );
    expect(retorno.cuerpoDocumento[0]).toEqual(expect.objectContaining({ numItem: 1, codigoGeneracion: 'DDDDDDDD-1111-4111-8111-DDDDDDDDDDDD' }));
    expect(retorno.resumen).toEqual(expect.objectContaining({ totalGravada: 100, totalPagar: 100, totalIva: 13 }));
  });

  it('preserves Evento de Operaciones Especiales CAT-023 fields from UI-created invoice records', () => {
    const payload = DTEMappingService.mapInvoice(
      makeInvoice(InvoiceType.EventoOperacionesEspeciales, '17', {
        relatedDocumentType: '97',
        relatedDocumentNumber: 'CCI-000123',
        relatedGenerationCode: 'AAAAAAAA-1111-4111-8111-AAAAAAAAAAAA',
        relatedDocumentDate: '2026-06-18',
        specialOperationDocFrom: 'CCI-000100',
        specialOperationDocTo: 'CCI-000123',
      }),
      company,
      '00',
    ) as any;

    expect(payload.identificacion.tipoEvento).toBe('17');
    expect(payload.cuerpoDocumento[0]).toEqual(expect.objectContaining({
      codigoGeneracionRef: 'AAAAAAAA-1111-4111-8111-AAAAAAAAAAAA',
      tipoDocumento: '97',
      numDocumento: 'CCI-000123',
      fechaEmision: '2026-06-18',
      docDel: 'CCI-000100',
      docAl: 'CCI-000123',
    }));
  });

  it('maps UI-created Evento de Retorno from the source DTE linkage only', () => {
    const sourceGenerationCode = 'BBBBBBBB-1111-4111-8111-BBBBBBBBBBBB';
    const payload = DTEMappingService.mapInvoice(
      makeInvoice(InvoiceType.EventoRetorno, '18', {
        relatedDocumentType: '01',
        relatedGenerationCode: sourceGenerationCode,
        relatedDocumentDate: '2026-06-18',
      }),
      company,
      '00',
    ) as any;

    expect(payload.identificacion.tipoEvento).toBe('18');
    expect(payload.documentoRelacionado[0]).toEqual(expect.objectContaining({
      tipoDocumento: '01',
      codigoGeneracion: sourceGenerationCode,
      fechaEmision: '2026-06-18',
    }));
    expect(payload.cuerpoDocumento[0].codigoGeneracion).toBe(sourceGenerationCode);
  });
});
