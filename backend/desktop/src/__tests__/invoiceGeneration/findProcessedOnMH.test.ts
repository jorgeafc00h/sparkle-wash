// Retry after a transport failure must not issue a second DTE: before re-sending,
// the modal asks MH whether the codigoGeneracion it already sent was processed.

const searchDTE = jest.fn();
jest.mock('@/services/api/MhClient', () => ({ getMhClient: jest.fn(() => ({ searchDTE })) }));
jest.mock('@/services/signing/SignerService', () => ({ getSignerService: jest.fn() }));
jest.mock('@/services/api/SyncLogger', () => ({ SyncLogger: { log: jest.fn(), logError: jest.fn() } }));
jest.mock('@/services/telemetry/TelemetryService', () => ({ __esModule: true, default: { trackEvent: jest.fn(), trackException: jest.fn() } }));
jest.mock('@/services/security/SecureStorageService', () => ({
  SecureStorageService: { getCredentials: jest.fn(async () => ({ user: '06141404941342', password: 'pwd' })) },
}));

import { InvoiceGenerationService } from '@/services/invoiceGeneration/InvoiceGenerationService';
import { getMhClient } from '@/services/api/MhClient';
import type { Invoice } from '@/types/invoice';
import type { Company } from '@/types/company';

const company = { id: 'co-1', nit: '0614-140494-134-2' } as Company;
const invoice = {
  id: 'inv-1',
  documentType: '03',
  generationCode: 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D',
  controlNumber: 'DTE-03-M001P001-000000000000042',
} as Invoice;

beforeEach(() => searchDTE.mockReset());

it('returns MH’s sello when the codigoGeneracion was already processed', async () => {
  searchDTE.mockResolvedValue({ estado: 'PROCESADO', selloRecibido: '2026ABC', fhProcesamiento: '10/10/2026 10:00:00' });

  const found = await InvoiceGenerationService.findProcessedOnMH(invoice, 'production', company);

  expect(found).toEqual({ selloRecibido: '2026ABC', fechaTransmision: '10/10/2026 10:00:00' });
  expect(getMhClient).toHaveBeenCalledWith(true);
  expect(searchDTE).toHaveBeenCalledWith(
    { nitEmisor: '06141404941342', tdte: '03', codigoGeneracion: invoice.generationCode },
    { userName: '06141404941342', password: 'pwd' },
  );
});

it.each([
  ['not found / rejected', async () => ({ estado: 'RECHAZADO', selloRecibido: null })],
  ['MH unreachable', async () => { throw new Error('ETIMEDOUT'); }],
])('returns null when %s, so the retry re-sends the SAME identifiers', async (_label, impl) => {
  searchDTE.mockImplementation(impl);
  expect(await InvoiceGenerationService.findProcessedOnMH(invoice, 'development', company)).toBeNull();
});

it('does not query MH for an invoice that never got identifiers', async () => {
  expect(await InvoiceGenerationService.findProcessedOnMH({ ...invoice, generationCode: undefined }, 'production', company)).toBeNull();
  expect(searchDTE).not.toHaveBeenCalled();
});
