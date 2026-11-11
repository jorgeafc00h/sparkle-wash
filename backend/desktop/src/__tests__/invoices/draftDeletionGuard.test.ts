// Deleting an "Error de envío" draft: the failure may have happened after MH
// processed it, so MH is consulted by codigoGeneracion first.

const searchDTE = jest.fn();
jest.mock('@/services/api/MhClient', () => ({ getMhClient: jest.fn(() => ({ searchDTE })) }));
jest.mock('../../services/api/MhClient', () => ({ getMhClient: jest.fn(() => ({ searchDTE })) }));
const getCredentials = jest.fn();
jest.mock('@/services/security/SecureStorageService', () => ({ SecureStorageService: { getCredentials } }));
jest.mock('../../services/security/SecureStorageService', () => ({ SecureStorageService: { getCredentials } }));

import { guardDraftDeletion, lookupInvoiceOnMH } from '@/services/api/MhDocumentLookup';
import { InvoiceStatus } from '@/types/invoice';
import { CompanyEnvironment } from '@/types/company';

const company = { nit: '0614-140494-134-2', environment: CompanyEnvironment.Production };
const code = 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D';
const draft = (id: string, status: InvoiceStatus, generationCode?: string) =>
  ({ id, status, generationCode, documentType: '01' });

beforeEach(() => {
  searchDTE.mockReset();
  getCredentials.mockReset().mockResolvedValue({ user: '06141404941342', password: 'pwd' });
});

it('looks the codigoGeneracion up in the company environment', async () => {
  searchDTE.mockResolvedValue({ estado: 'PROCESADO', selloRecibido: 'S1', fhProcesamiento: 'x' });
  expect(await lookupInvoiceOnMH({ generationCode: code, documentType: '03' }, company)).toEqual({
    state: 'processed', selloRecibido: 'S1', fechaTransmision: 'x',
  });
  expect(getCredentials).toHaveBeenCalledWith(company.nit, true);
  expect(searchDTE).toHaveBeenCalledWith(
    { nitEmisor: '06141404941342', tdte: '03', codigoGeneracion: code },
    { userName: '06141404941342', password: 'pwd' },
  );
});

it('distinguishes "MH has no processed record" from "MH could not be asked"', async () => {
  searchDTE.mockResolvedValueOnce({ estado: 'RECHAZADO', selloRecibido: null });
  expect((await lookupInvoiceOnMH({ generationCode: code, documentType: '01' }, company)).state).toBe('not-processed');

  searchDTE.mockRejectedValueOnce(new Error('ETIMEDOUT'));
  expect((await lookupInvoiceOnMH({ generationCode: code, documentType: '01' }, company)).state).toBe('unknown');

  searchDTE.mockResolvedValueOnce({ estado: 'ERROR', observaciones: ['verifique sus credenciales'] });
  expect((await lookupInvoiceOnMH({ generationCode: code, documentType: '01' }, company)).state).toBe('unknown');

  getCredentials.mockResolvedValueOnce(null);
  expect((await lookupInvoiceOnMH({ generationCode: code, documentType: '01' }, company)).state).toBe('unknown');
});

it('only deletes drafts MH confirms it does not hold', async () => {
  searchDTE.mockImplementation(async ({ codigoGeneracion }: { codigoGeneracion: string }) => {
    if (codigoGeneracion === 'PROCESSED') return { estado: 'PROCESADO', selloRecibido: 'S' };
    if (codigoGeneracion === 'OFFLINE') throw new Error('ENOTFOUND');
    return { estado: 'RECHAZADO', selloRecibido: null };
  });
  const guard = await guardDraftDeletion(
    [
      draft('nueva', InvoiceStatus.Nueva, 'ANY'), // never sent → no lookup
      draft('err-no-code', InvoiceStatus.ErrorEnvio),
      draft('err-rejected', InvoiceStatus.ErrorEnvio, 'REJECTED'),
      draft('err-processed', InvoiceStatus.ErrorEnvio, 'PROCESSED'),
      draft('err-offline', InvoiceStatus.ErrorEnvio, 'OFFLINE'),
    ],
    company,
  );
  expect(guard.deletable.map((d) => d.id)).toEqual(['nueva', 'err-no-code', 'err-rejected']);
  expect(guard.processed.map((d) => d.id)).toEqual(['err-processed']);
  expect(guard.unverified.map((u) => u.invoice.id)).toEqual(['err-offline']);
  expect(searchDTE).toHaveBeenCalledTimes(3);
});
