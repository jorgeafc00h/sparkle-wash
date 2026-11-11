import { InvoiceInvalidationService, InvalidationReason } from '../services/invalidation/InvoiceInvalidationService';
import { Invoice, InvoiceStatus, InvoiceType } from '../types/invoice';
import { Company } from '../types/company';

const invalidateDocumentLocal = jest.fn();

jest.mock('../services/api/InvoiceService', () => ({
  InvoiceService: jest.fn().mockImplementation(() => ({
    getEnvironmentCode: () => '00',
    invalidateDocumentLocal,
  })),
}));
jest.mock('../services/security/SecureStorageService', () => ({
  SecureStorageService: {
    getCredentials: jest.fn().mockResolvedValue({ user: '06141404941342', password: 'secret' }),
    getCertificatePassword: jest.fn().mockResolvedValue('hash'),
  },
}));

const REPLACEMENT = 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D';

const company = {
  id: 'c1',
  nit: '0614-140494-134-2',
  nombre: 'Jorge Flores',
  nombreComercial: 'K Labs',
  telefono: '77305680',
  correo: 'kl@example.com',
} as unknown as Company;

const accepted = (overrides: Partial<Invoice> = {}): Invoice =>
  ({
    id: 'i1',
    invoiceNumber: 'DTE-01-M001P001-000000000000001',
    controlNumber: 'DTE-01-M001P001-000000000000001',
    generationCode: '11111111-2222-4333-8444-555555555555',
    receptionSeal: '2026AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    documentType: '01',
    invoiceType: InvoiceType.Factura,
    status: InvoiceStatus.Completada,
    date: new Date().toISOString(),
    customer: { firstName: 'Ana', lastName: 'López', nationalId: '037216001' },
    ...overrides,
  }) as unknown as Invoice;

const request = (reason: InvalidationReason, replacementGenerationCode?: string) => ({
  reason,
  customReason: reason === InvalidationReason.Other ? 'Documento emitido por error' : undefined,
  replacementGenerationCode,
  responsibleName: 'Jorge Flores',
  responsibleDocument: '06141404-9',
});

const sentCodigoGeneracionR = () =>
  (invalidateDocumentLocal.mock.calls.at(-1)?.[0] as { documento: { codigoGeneracionR: unknown } }).documento
    .codigoGeneracionR;

describe('Invalidation (CAT-024) — parity with Swift DeactivateValidation', () => {
  const svc = new InvoiceInvalidationService(false);

  beforeEach(() => invalidateDocumentLocal.mockReset().mockResolvedValue(true));

  it('código 1 without a replacement generation code is refused before calling MH', async () => {
    const result = await svc.invalidateInvoice(accepted(), company, request(InvalidationReason.ErrorInformation));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/CAT-024 código 1/);
    expect(invalidateDocumentLocal).not.toHaveBeenCalled();
  });

  it('código 1 sends the replacement generation code, uppercased', async () => {
    const result = await svc.invalidateInvoice(
      accepted(),
      company,
      request(InvalidationReason.ErrorInformation, REPLACEMENT.toLowerCase()),
    );
    expect(result.success).toBe(true);
    expect(sentCodigoGeneracionR()).toBe(REPLACEMENT);
  });

  it.each([InvalidationReason.ProductReturn, InvalidationReason.Other])(
    'código %s always sends codigoGeneracionR = null, even if one was supplied',
    async (reason) => {
      const result = await svc.invalidateInvoice(accepted(), company, request(reason, REPLACEMENT));
      expect(result.success).toBe(true);
      expect(sentCodigoGeneracionR()).toBeNull();
    },
  );

  it('a document without selloRecibido cannot be invalidated', async () => {
    expect(svc.canInvalidateInvoice(accepted({ receptionSeal: undefined })).canInvalidate).toBe(false);
    const result = await svc.invalidateInvoice(
      accepted({ receptionSeal: undefined }),
      company,
      request(InvalidationReason.ProductReturn),
    );
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/sello de recepción/);
    expect(invalidateDocumentLocal).not.toHaveBeenCalled();
  });
});
