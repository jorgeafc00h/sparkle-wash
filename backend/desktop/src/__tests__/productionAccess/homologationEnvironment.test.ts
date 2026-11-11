// Homologación (production access) is a Hacienda TEST-environment process.
// 1.3.1 (f68ab07) made the wizard follow the company's own environment: a
// production company sent the contingency events and the preflight auth to
// PRODUCTION MH, its DTE batches were built with ambiente 01 and signed with
// the production certificate, while invalidation stayed on test — fictitious
// homologation documents could reach api.dtes.mh.gob.sv. This drives the real
// hook through a full run for a PRODUCTION company and records the
// environment of every MH client, API config, secret read, signature and
// submission it makes.
//
// The hook is rendered with react-dom/server: state updates after the render
// are no-ops there, which is fine — the run reads refs and closures, not state.

import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { CompanyEnvironment, type Company } from '@/types/company';
import { InvoiceStatus, InvoiceType, type Invoice } from '@/types/invoice';

type Call = { what: string; isProduction?: unknown; environment?: unknown; ambiente?: unknown };
const calls: Call[] = [];
const dispatched: Array<{ type: string }> = [];

jest.mock('@/store', () => ({
  useAppDispatch: () => (action: { type: string }) => {
    dispatched.push(action);
    return { unwrap: async () => ({ kind: 'existing', company: {} }) };
  },
  useAppSelector: (selector: () => unknown) => selector(),
  selectAllInvoices: () => [],
  persistor: { pause: jest.fn(), persist: jest.fn(), flush: jest.fn(async () => undefined) },
}));
jest.mock('@/store/slices/invoiceSlice', () => ({
  addInvoices: (payload: unknown) => ({ type: 'invoices/addInvoices', payload }),
  updateInvoice: (payload: unknown) => ({ type: 'invoices/updateInvoice', payload }),
}));
jest.mock('@/store/slices/companySlice', () => ({
  promoteToProduction: (payload: unknown) => ({ type: 'companies/promoteToProduction', payload }),
}));
jest.mock('@/services/testData/TestDataGenerator', () => ({
  TestDataGenerator: { generateCustomers: () => [], generateProducts: () => [] },
}));
jest.mock('@/services/invoiceGeneration/InvoiceBatchGenerator', () => ({
  InvoiceBatchGenerator: {
    generateFacturas: async (count: number, _c: unknown, _p: unknown, company: Company, start: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `fe-${start}-${i}`,
        companyId: company.id,
        invoiceType: 0, // InvoiceType.Factura
        status: 0,
        invoiceNumber: String(start + i),
        controlNumber: '',
        generationCode: '',
        documentType: '01',
        date: new Date().toISOString(),
        items: [],
      })),
  },
}));
jest.mock('@/services/invoiceGeneration/InvoiceGenerationService', () => ({
  InvoiceGenerationService: {
    generateAndSubmitDTE: async (invoice: Invoice, company: Company, env: string) => {
      calls.push({ what: 'generateAndSubmitDTE', environment: company.environment, isProduction: company.isProduction, ambiente: env });
      return {
        success: true,
        invoice: { ...invoice, status: 2 /* Completada */, generationCode: `G-${invoice.id}`, controlNumber: `C-${invoice.id}` },
      };
    },
  },
}));
jest.mock('@/services/security/SecureStorageService', () => ({
  SecureStorageService: {
    getCredentials: async (_nit: string, isProduction?: boolean) => {
      calls.push({ what: 'getCredentials', isProduction });
      return { user: '06141404941342', password: 'test-password' };
    },
    getCertificatePassword: async (_nit: string, isProduction?: boolean) => {
      calls.push({ what: 'getCertificatePassword', isProduction });
      return 'sha512-hash';
    },
    getCertificateData: async (_nit: string, isProduction?: boolean) => {
      calls.push({ what: 'getCertificateData', isProduction });
      return '<xml/>';
    },
  },
}));
jest.mock('@/services/security/CertificateService', () => ({
  CertificateService: {
    validateCertificate: async (_nit: string, isProduction?: boolean) => {
      calls.push({ what: 'validateCertificate', isProduction });
      return { valid: true };
    },
    restoreCertificate: async (_nit: string, isProduction?: boolean) => {
      calls.push({ what: 'restoreCertificate', isProduction });
      return true;
    },
  },
}));
jest.mock('@/services/signing/SignerService', () => ({
  getSignerService: () => ({
    signAsync: async (request: { isProduction?: boolean }) => {
      calls.push({ what: 'signAsync', isProduction: request.isProduction });
      return { status: 'OK', body: 'header.payload.signature' };
    },
  }),
}));
jest.mock('@/services/api/MhClient', () => ({
  getMhClient: (isProduction?: boolean) => {
    calls.push({ what: 'getMhClient', isProduction });
    return {
      validateCredentials: async () => ({ valid: true, statusCode: 200 }),
      submitContingency: async (params: { ambiente: string }) => {
        calls.push({ what: 'submitContingency', ambiente: params.ambiente });
        return { estado: 'PROCESADO', selloRecibido: 'SELLO' };
      },
    };
  },
}));
jest.mock('@/config/api', () => ({
  getApiConfig: (isProduction: boolean) => {
    calls.push({ what: 'getApiConfig', isProduction });
    return { environmentCode: isProduction ? '01' : '00' };
  },
}));
jest.mock('@/services/dte/DTEMappingService', () => ({
  DTEMappingService: {
    mapContingenciaRequest: (_docs: unknown, company: Company, environmentCode: string) => {
      calls.push({ what: 'mapContingenciaRequest', environment: company.environment, ambiente: environmentCode });
      return { identificacion: { ambiente: environmentCode, version: 3 } };
    },
  },
}));
jest.mock('@/services/dte/CompanyEmisorSanitizer', () => ({
  sanitizeCompanyForEmisor: (company: Company) => ({ company, warnings: [] }),
}));
jest.mock('@/utils/dteMapper', () => ({ deepOmitUndefinedEnhanced: (value: unknown) => value }));
jest.mock('@/services/invalidation/InvoiceInvalidationService', () => ({
  InvalidationReason: { ProductReturn: 2 },
  InvoiceInvalidationService: class {
    constructor(isProduction?: boolean) {
      calls.push({ what: 'new InvoiceInvalidationService', isProduction });
    }

    async invalidateInvoice(_invoice: Invoice, company: Company) {
      calls.push({ what: 'invalidateInvoice', environment: company.environment, isProduction: company.isProduction });
      return { success: true };
    }
  },
}));

// eslint-disable-next-line import/first
import {
  HOMOLOGATION_IS_PRODUCTION,
  homologationCompany,
  useRequestProductionAccess,
} from '@/hooks/useRequestProductionAccess';

const productionCompany = {
  id: 'company-prod',
  nit: '0614-140494-134-2',
  nombre: 'Empresa Producción',
  nombreComercial: 'Producción',
  environment: CompanyEnvironment.Production,
  isTestAccount: false,
  isProduction: true,
} as unknown as Company;

function renderHook(company: Company) {
  let api: ReturnType<typeof useRequestProductionAccess> | undefined;
  function Probe() {
    api = useRequestProductionAccess(company);
    return null;
  }
  renderToString(createElement(Probe));
  if (!api) throw new Error('hook did not render');
  return api;
}

describe('production access always targets the MH test environment', () => {
  beforeEach(() => {
    calls.length = 0;
    dispatched.length = 0;
  });

  it('homologationCompany forces Development even for a production company', () => {
    expect(HOMOLOGATION_IS_PRODUCTION).toBe(false);
    expect(homologationCompany(productionCompany)).toMatchObject({
      id: 'company-prod',
      environment: CompanyEnvironment.Development,
      isTestAccount: true,
      isProduction: false,
    });
  });

  it('a full run for a PRODUCTION company never touches production MH, secrets or ambiente 01', async () => {
    const api = renderHook(productionCompany);

    await api.processAllDocuments(['factura', 'contingencia', 'invalidacion']);

    // The run really went through every phase (otherwise "no production
    // call" would be vacuous): preflight, DTE batch, contingency, invalidation,
    // and the promotion at the end of a fully accepted run.
    const kinds = new Set(calls.map((c) => c.what));
    for (const expected of [
      'getCertificatePassword', 'validateCertificate', 'restoreCertificate', 'signAsync', 'getCredentials',
      'getMhClient', 'getApiConfig', 'generateAndSubmitDTE', 'mapContingenciaRequest', 'submitContingency',
      'new InvoiceInvalidationService', 'invalidateInvoice',
    ]) {
      expect(kinds).toContain(expected);
    }
    expect(dispatched.some((a) => a.type === 'companies/promoteToProduction')).toBe(true);

    // Every environment-bearing call: explicitly test.
    for (const c of calls.filter((x) => 'isProduction' in x && x.what !== 'generateAndSubmitDTE' && x.what !== 'invalidateInvoice')) {
      expect({ what: c.what, isProduction: c.isProduction }).toEqual({ what: c.what, isProduction: false });
    }
    // Every submission: the company copy is Development, ambiente 00.
    for (const c of calls.filter((x) => x.what === 'generateAndSubmitDTE' || x.what === 'invalidateInvoice')) {
      expect({ what: c.what, environment: c.environment, isProduction: c.isProduction })
        .toEqual({ what: c.what, environment: CompanyEnvironment.Development, isProduction: false });
    }
    expect(calls.filter((c) => c.what === 'generateAndSubmitDTE').every((c) => c.ambiente === 'development')).toBe(true);
    for (const c of calls.filter((x) => x.what === 'mapContingenciaRequest' || x.what === 'submitContingency')) {
      expect({ what: c.what, ambiente: c.ambiente }).toEqual({ what: c.what, ambiente: '00' });
    }
    expect(calls.filter((c) => c.what === 'mapContingenciaRequest').every((c) => c.environment === CompanyEnvironment.Development)).toBe(true);
  });

  it('the generated documents are the ones accepted', () => {
    // Sanity for the mocks above: the enum values they hard-code.
    expect(InvoiceType.Factura).toBe(0);
    expect(InvoiceStatus.Completada).toBe(2);
  });
});
