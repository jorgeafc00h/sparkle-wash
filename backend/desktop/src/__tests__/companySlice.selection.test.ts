/**
 * Selected vs default company — the 2026-09 badge/predeterminar fix.
 *
 * Before: `setDefaultCompany` only moved the `isDefault` star (selection — and
 * with it the sidebar badge and every new DTE/ticket — stayed elsewhere), and
 * `promoteToProduction` selected the PROD clone while TEST kept the star.
 * Both reducers now keep selection and default together.
 */

import companyReducer, { setDefaultCompany, promoteToProduction } from '../store/slices/companySlice';
import { Company, CompanyEnvironment } from '../types/company';

// companySlice pulls MhClient → TelemetryService (non-transformable syntax).
jest.mock('../services/api/MhClient', () => ({ getMhClient: jest.fn() }));

const company = (id: string, overrides: Partial<Company> = {}): Company => ({
  id,
  nombreComercial: `Empresa ${id}`,
  razonSocial: `Empresa ${id} S.A.`,
  nit: '0614-140494-134-2',
  nombreRegistrado: 'TEST',
  tipoEstablecimiento: 'LOCAL',
  departamento: 'San Salvador',
  municipio: 'San Salvador',
  direccion: 'Test',
  telefono: '00000000',
  email: 'test@test.com',
  actividadEconomica: 'Ventas',
  environment: CompanyEnvironment.Development,
  isTestAccount: true,
  hasValidCertificate: false,
  hasApiCredentials: false,
  isDefault: false,
  createdAt: '2026-09-28T00:00:00.000Z',
  updatedAt: '2026-09-28T00:00:00.000Z',
  ...overrides,
} as Company);

const stateWith = (...companies: Company[]) =>
  ({
    companies: [...companies],
    currentCompany: companies.find((c) => c.id === 'selected') ?? companies[0] ?? null,
    selectedCompanyId: companies.find((c) => c.id === 'selected')?.id ?? companies[0]?.id ?? null,
    loading: false,
    error: null,
    searchResults: [],
  }) as unknown as ReturnType<typeof companyReducer>;

describe('setDefaultCompany also selects', () => {
  it('moves the star AND switches selection to the new default', () => {
    const initial = stateWith(
      company('test-co', { isDefault: true }),
      company('prod-co', { environment: CompanyEnvironment.Production, isTestAccount: false }),
    );
    // Badges/DTE creation read the selection — start on the TEST company.
    expect(initial.selectedCompanyId).toBe('test-co');

    const next = companyReducer(initial, setDefaultCompany.fulfilled('prod-co', 'req', undefined as never));

    expect(next.companies.find((c) => c.id === 'prod-co')?.isDefault).toBe(true);
    expect(next.companies.find((c) => c.id === 'test-co')?.isDefault).toBe(false);
    expect(next.selectedCompanyId).toBe('prod-co');
    expect(next.currentCompany?.id).toBe('prod-co');
  });
});

describe('promoteToProduction moves the default with the selection', () => {
  it('created: the promoted clone becomes default + selected', () => {
    const initial = stateWith(company('test-co', { isDefault: true }));
    const clone = company('prod-clone', { environment: CompanyEnvironment.Production, isTestAccount: false });

    const next = companyReducer(
      initial,
      promoteToProduction.fulfilled({ kind: 'created', company: clone } as never, 'req', {} as never),
    );

    expect(next.selectedCompanyId).toBe('prod-clone');
    expect(next.companies.find((c) => c.id === 'prod-clone')?.isDefault).toBe(true);
    expect(next.companies.find((c) => c.id === 'test-co')?.isDefault).toBe(false);
  });

  it('reused: the existing prod company becomes default + selected', () => {
    const initial = stateWith(
      company('test-co', { isDefault: true }),
      company('prod-co', { environment: CompanyEnvironment.Production, isTestAccount: false }),
    );

    const next = companyReducer(
      initial,
      promoteToProduction.fulfilled({ kind: 'reused', companyId: 'prod-co' } as never, 'req', {} as never),
    );

    expect(next.selectedCompanyId).toBe('prod-co');
    expect(next.companies.find((c) => c.id === 'prod-co')?.isDefault).toBe(true);
  });
});
