// MH Normativa DTE 2.0 (Anexo IV) / Manual Funcional v2.0: a document issued in
// contingency carries Modelo 2 "Diferido" + Transmisión 2 "Contingencia" +
// tipoContingencia (motivoContin only for tipo 5) — on its FINAL transmission,
// matching the Evento de Contingencia that listed its codigoGeneracion.
//
// The Contingencia page runs on the LOCAL path (sign here with the company's
// own environment certificate → direct MH), never the backend: the backend
// signed with a blob certificate the Desktop never uploads, and on "YA EXISTE"
// minted a new codigoGeneracion — a second fiscal document the event never listed.

const signAsync = jest.fn();
const submitContingency = jest.fn();
const submitDTE = jest.fn();
const searchDTE = jest.fn();
const getMhClient = jest.fn((_isProduction?: boolean) => ({ submitContingency, submitDTE, searchDTE }));
jest.mock('@/services/signing/SignerService', () => ({ getSignerService: jest.fn(() => ({ signAsync })) }));
jest.mock('@/services/api/MhClient', () => ({ getMhClient: (isProduction?: boolean) => getMhClient(isProduction) }));
jest.mock('../../services/api/MhClient', () => ({ getMhClient: (isProduction?: boolean) => getMhClient(isProduction) }));
jest.mock('../../services/signing/SignerService', () => ({ getSignerService: jest.fn(() => ({ signAsync })) }));
const backendSync = jest.fn();
jest.mock('@/services/api/InvoiceService', () => ({ getInvoiceService: jest.fn(() => ({ sendContingencyRequest: backendSync, submitInvoice: backendSync })) }));
jest.mock('../../services/api/InvoiceService', () => ({ getInvoiceService: jest.fn(() => ({ sendContingencyRequest: backendSync, submitInvoice: backendSync })) }));
jest.mock('@/services/api/SyncLogger', () => ({
  SyncLogger: { log: jest.fn(), logError: jest.fn(), logSyncRequest: jest.fn(), logSyncResponse: jest.fn(), logSyncError: jest.fn() },
}));
jest.mock('@/services/telemetry/TelemetryService', () => ({ __esModule: true, default: { trackEvent: jest.fn(), trackException: jest.fn() } }));
const secureStorage = {
  getCredentials: jest.fn(async (_nit?: string, _isProduction?: boolean) => ({ user: '06141404941342', password: 'pwd' })),
  getCertificatePassword: jest.fn(async (_nit?: string, _isProduction?: boolean) => 'cert-pwd'),
};
jest.mock('@/services/security/SecureStorageService', () => ({ SecureStorageService: secureStorage }));
jest.mock('../../services/security/SecureStorageService', () => ({ SecureStorageService: secureStorage }));

import { DTEMappingService } from '@/services/dte/DTEMappingService';
import { ContingencyReportService, MAX_CONTINGENCY_DOCUMENTS } from '@/services/contingency/ContingencyReportService';
import { Company, CompanyEnvironment } from '@/types/company';
import { Invoice, InvoiceStatus, InvoiceType } from '@/types/invoice';

const company = {
  id: 'co-1', nit: '06141404941342', nrc: '3174', nombre: 'Jorge Flores', nombreComercial: 'FS',
  correo: 'a@b.c', telefono: '22222222', complemento: 'SS', direccion: 'SS', departamentoCode: '06',
  municipioCode: '23', distritoCode: '01', codActividad: '62020', descActividad: 'Consultoria',
  tipoEstablecimiento: '01', codEstableMH: 'M001', codPuntoVentaMH: 'P001',
  environment: CompanyEnvironment.Development, isTestAccount: true,
} as unknown as Company;

function invoice(type: InvoiceType, documentType: string, over: Partial<Invoice> = {}): Invoice {
  return {
    id: `inv-${documentType}`, invoiceNumber: 'X', date: '2026-10-10T15:00:00.000Z', status: InvoiceStatus.Nueva,
    customerId: 'c1', documentType, invoiceType: type, companyId: 'co-1', createdAt: '', updatedAt: '',
    items: [{ id: 'it1', invoiceId: `inv-${documentType}`, productId: 'p1', productName: 'Servicio', quantity: 1, unitPrice: 113, obsItem: '', createdAt: '', updatedAt: '' }],
    totals: { totalAmount: 113, tax: 13, subTotal: 100, reteRenta: 0, totalPagar: 113, ivaRete1: 0, totalWithoutTax: 100, isCCF: false, totalItems: 1, version: 2, totalDiscount: 0 },
    ...over,
  } as Invoice;
}

describe('DTEMappingService.transmissionMode', () => {
  it('normal documents keep Modelo 1 / Transmisión 1 with null contingency fields', () => {
    const dte = DTEMappingService.mapInvoice(invoice(InvoiceType.Factura, '01'), company, '00');
    expect(dte.identificacion).toMatchObject({ tipoModelo: 1, tipoOperacion: 1, tipoContingencia: null, motivoContin: null });
  });

  it('a reported Factura carries Modelo 2 / Transmisión 2 / tipoContingencia; motivo only for tipo 5', () => {
    const dte = DTEMappingService.mapInvoice(
      invoice(InvoiceType.Factura, '01', { contingency: { tipoContingencia: 2, motivoContin: 'ignored for tipo 2' } }),
      company, '00',
    );
    expect(dte.identificacion).toMatchObject({ tipoModelo: 2, tipoOperacion: 2, tipoContingencia: 2, motivoContin: null });

    const otro = DTEMappingService.mapInvoice(
      invoice(InvoiceType.Factura, '01', { contingency: { tipoContingencia: 5, motivoContin: 'Corte de energía' } }),
      company, '00',
    );
    expect(otro.identificacion).toMatchObject({ tipoContingencia: 5, motivoContin: 'Corte de energía' });
  });

  it('types MH never allows in contingency (CL) stay on the normal model', () => {
    const dte = DTEMappingService.mapInvoice(
      invoice(InvoiceType.ComprobanteLiquidacion, '08', { contingency: { tipoContingencia: 1 } }),
      company, '00',
    );
    expect(dte.identificacion.tipoModelo).toBe(1);
    expect(dte.identificacion.tipoOperacion).toBe(1);
  });
});

describe('ContingencyReportService', () => {
  const form = (invoices: Invoice[], tipoContingencia = 1, co: Company = company) => ({
    company: co, invoices, tipoContingencia, motivoContingencia: 'Falla del servicio de internet',
    nombreResponsable: 'Jorge', duiResponsable: '012345678',
    fInicio: '2026-10-10', fFin: '2026-10-10', hInicio: '08:00', hFin: '09:00',
  });
  const payloadOf = (jws: string) =>
    JSON.parse(Buffer.from(jws.split('.')[1], 'base64url').toString('utf8'));

  beforeEach(() => {
    signAsync.mockReset().mockImplementation(async ({ dteJson }: { dteJson: string }) => ({
      status: 'OK',
      body: `h.${Buffer.from(dteJson, 'utf8').toString('base64url')}.s`,
    }));
    submitContingency.mockReset().mockResolvedValue({ estado: 'RECIBIDO', selloRecibido: 'EVT-SELLO' });
    submitDTE.mockReset().mockImplementation(async (params: { documento: string }) => ({
      estado: 'PROCESADO',
      selloRecibido: 'SELLO',
      codigoGeneracion: payloadOf(params.documento).identificacion.codigoGeneracion,
      fhProcesamiento: '10/10/2026 10:00:00',
      observaciones: [],
    }));
    searchDTE.mockReset();
    backendSync.mockReset();
    getMhClient.mockClear();
    secureStorage.getCredentials.mockClear();
    secureStorage.getCertificatePassword.mockClear();
  });

  it('signs the event locally, then transmits each DTE with the SAME codigoGeneracion + contingency', async () => {
    const result = await ContingencyReportService.submitReport(form([invoice(InvoiceType.Factura, '01')], 3));

    expect(result.reportSubmitted).toBe(true);
    expect(backendSync).not.toHaveBeenCalled();

    const event = payloadOf(submitContingency.mock.calls[0][0].documento);
    const listed = event.detalleDTE[0].codigoGeneracion;
    expect(listed).toMatch(/^[0-9A-F-]{36}$/);
    // Form hours are El Salvador wall-clock times.
    expect(event.motivo).toMatchObject({ fInicio: '2026-10-10', hInicio: '08:00:00', hFin: '09:00:00' });

    const sentDte = payloadOf(submitDTE.mock.calls[0][0].documento);
    expect(sentDte.identificacion).toMatchObject({ codigoGeneracion: listed, tipoModelo: 2, tipoOperacion: 2, tipoContingencia: 3 });

    expect(result.invoices[0]).toMatchObject({ success: true, selloRecibido: 'SELLO', codigoGeneracion: listed });
    // The page persists result.invoice so a retry re-sends the reported codigoGeneracion.
    expect(result.invoices[0].invoice?.generationCode).toBe(listed);
    expect(result.invoices[0].invoice?.contingency?.reportedAt).toBeTruthy();
  });

  it('a production company signs with its production certificate and talks to MH production', async () => {
    const prod = { ...company, environment: CompanyEnvironment.Production, isTestAccount: false } as Company;
    await ContingencyReportService.submitReport(form([invoice(InvoiceType.Factura, '01')], 1, prod));

    expect(secureStorage.getCertificatePassword).toHaveBeenCalledWith(prod.nit, true);
    expect(signAsync.mock.calls.every(([req]) => req.isProduction === true)).toBe(true);
    expect(getMhClient.mock.calls.every(([isProduction]) => isProduction === true)).toBe(true);
    expect(submitContingency.mock.calls[0][0].ambiente).toBe('01');
  });

  it('"YA EXISTE" consults MH and completes with MH\'s sello — never mints a new codigoGeneracion', async () => {
    submitDTE.mockResolvedValue({
      estado: 'RECHAZADO', codigoMsg: '004', descripcionMsg: '[identificacion.codigoGeneracion] YA EXISTE UN REGISTRO CON ESE VALOR',
      observaciones: [], selloRecibido: null,
    });
    searchDTE.mockResolvedValue({ estado: 'PROCESADO', selloRecibido: 'MH-SELLO', fhProcesamiento: '10/10/2026 09:59:00' });

    const result = await ContingencyReportService.submitReport(form([invoice(InvoiceType.Factura, '01')]));

    const listed = payloadOf(submitContingency.mock.calls[0][0].documento).detalleDTE[0].codigoGeneracion;
    expect(submitDTE).toHaveBeenCalledTimes(1);
    expect(searchDTE).toHaveBeenCalledWith(
      expect.objectContaining({ codigoGeneracion: listed, tdte: '01' }),
      expect.anything(),
    );
    expect(result.invoices[0]).toMatchObject({
      success: true, alreadyProcessed: true, selloRecibido: 'MH-SELLO', codigoGeneracion: listed,
    });
  });

  it('"YA EXISTE" that MH can\'t confirm fails with the SAME identifiers (no second document)', async () => {
    submitDTE.mockResolvedValue({
      estado: 'RECHAZADO', codigoMsg: '004', descripcionMsg: 'YA EXISTE UN REGISTRO CON ESE VALOR', observaciones: [], selloRecibido: null,
    });
    searchDTE.mockRejectedValue(new Error('ETIMEDOUT'));

    const result = await ContingencyReportService.submitReport(form([invoice(InvoiceType.Factura, '01')]));
    const listed = payloadOf(submitContingency.mock.calls[0][0].documento).detalleDTE[0].codigoGeneracion;

    expect(submitDTE).toHaveBeenCalledTimes(1);
    expect(result.invoices[0].success).toBe(false);
    expect(result.invoices[0].codigoGeneracion).toBe(listed);
    expect(result.invoices[0].invoice?.generationCode).toBe(listed);
    expect(result.invoices[0].error).toMatch(/ya existe/i);
  });

  it('a rejected event transmits nothing', async () => {
    submitContingency.mockResolvedValue({ estado: 'RECHAZADO', descripcionMsg: 'Firma inválida', observaciones: [] });
    const result = await ContingencyReportService.submitReport(form([invoice(InvoiceType.Factura, '01')]));
    expect(result.reportSubmitted).toBe(false);
    expect(result.reportError).toMatch(/Firma inválida/);
    expect(submitDTE).not.toHaveBeenCalled();
  });

  it('rejects types MH does not allow in contingency and more than 1,000 documents', () => {
    expect(ContingencyReportService.validate(form([invoice(InvoiceType.ComprobanteDonacion, '15')])).join(' '))
      .toMatch(/no permite emitir en contingencia/);
    const many = Array.from({ length: MAX_CONTINGENCY_DOCUMENTS + 1 }, (_, i) => invoice(InvoiceType.Factura, '01', { id: `i${i}` }));
    expect(ContingencyReportService.validate(form(many)).join(' ')).toMatch(/como máximo 1000/);
  });

  it('only offers allowed types as candidates', () => {
    const candidates = ContingencyReportService.filterCandidates(
      [invoice(InvoiceType.Factura, '01'), invoice(InvoiceType.ComprobanteLiquidacion, '08')],
      'co-1', '2026-10-01', '2026-10-31',
    );
    expect(candidates.map((c) => c.documentType)).toEqual(['01']);
  });

  it('filters candidates by El Salvador calendar date (the 1st and late-evening timestamps included)', () => {
    const candidates = ContingencyReportService.filterCandidates(
      [
        invoice(InvoiceType.Factura, '01', { id: 'first', date: '2026-10-01' }),
        // 2026-10-31 19:30 in SV = 2026-11-01T01:30Z
        invoice(InvoiceType.Factura, '01', { id: 'late', date: '2026-11-01T01:30:00.000Z' }),
        invoice(InvoiceType.Factura, '01', { id: 'prev', date: '2026-09-30' }),
      ],
      'co-1', '2026-10-01', '2026-10-31',
    );
    expect(candidates.map((c) => c.id)).toEqual(['first', 'late']);
  });
});
