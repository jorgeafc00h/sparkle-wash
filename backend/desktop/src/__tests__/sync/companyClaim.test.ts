// Company claim service (Phase 1) — POST /api/auth/companies/claim with the internal
// JWT + the company's MH credentials. Covers the outcome mapping (success /
// already-claimed / wrong credentials / nit mismatch / Hacienda down / offline /
// missing credentials / not signed in), the wire format (MH_USER / MH_KEY headers,
// ambiente by company environment) and the claim-state slice reducers.

import { claimCompany, CLAIM_MESSAGES, ambienteForCompany } from '@/services/sync/companyClaimService';
import { CompanyEnvironment } from '@/types';
import reducer, {
  companyClaimFailed,
  companyClaimSucceeded,
  isCompanyClaimed,
  type SyncV2State,
} from '@/store/slices/syncV2Slice';

const NIT = '0614-180494-101-8';
const CO = 'co06141804941018';
const COMPANY_ID = 'company_1';

const productionCompany = { id: COMPANY_ID, nit: NIT, environment: CompanyEnvironment.Production };
const testCompany = { id: COMPANY_ID, nit: NIT, environment: CompanyEnvironment.Development };

const okResponse = (body: unknown, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response);

const fetchMock = (impl: () => Promise<Response>) => jest.fn(impl) as unknown as jest.MockedFunction<typeof fetch>;

const deps = (fetchImpl: jest.MockedFunction<typeof fetch>, overrides: Record<string, unknown> = {}) => ({
  fetchImpl,
  getToken: jest.fn(async () => 'internal-jwt'),
  getCredentials: jest.fn(async () => ({ user: '06141804941018', password: 'mh-secret' })),
  ...overrides,
});

describe('claimCompany — outcome mapping', () => {
  test('success returns the linked company, the refreshed JWT and the session companies', async () => {
    const fetchImpl = fetchMock(async () => okResponse({
      companyId: CO,
      session: { internalJwt: 'refreshed-jwt', companies: [CO, `${CO}test`] },
    }));

    const result = await claimCompany(productionCompany, {}, deps(fetchImpl));

    expect(result).toEqual({
      kind: 'claimed',
      companyId: CO,
      companies: [CO, `${CO}test`],
      token: 'refreshed-jwt',
    });
  });

  test('already-claimed: the idempotent 200 is reported as such when the caller knew', async () => {
    const fetchImpl = fetchMock(async () => okResponse({
      companyId: CO,
      session: { internalJwt: 'refreshed-jwt', companies: [CO] },
    }));

    const result = await claimCompany(productionCompany, { alreadyClaimed: true }, deps(fetchImpl));

    expect(result).toMatchObject({ kind: 'already-claimed', companyId: CO });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // still called: it refreshes the JWT
  });

  test('wrong credentials (403 mh_credentials_invalid)', async () => {
    const fetchImpl = fetchMock(async () => okResponse({ error: 'mh_credentials_invalid' }, 403));

    const result = await claimCompany(productionCompany, {}, deps(fetchImpl));

    expect(result).toMatchObject({ kind: 'invalid-credentials' });
    expect(result.kind === 'invalid-credentials' && result.message).toBe(CLAIM_MESSAGES.invalidCredentials);
  });

  test('nit mismatch (403 nit_mismatch): the MH user must be the company NIT', async () => {
    const fetchImpl = fetchMock(async () => okResponse({ error: 'nit_mismatch' }, 403));

    const result = await claimCompany(productionCompany, {}, deps(fetchImpl));

    expect(result).toMatchObject({ kind: 'invalid-credentials' });
    expect(result.kind === 'invalid-credentials' && result.message).toBe(CLAIM_MESSAGES.nitMismatch);
  });

  test('Hacienda unavailable (503 mh_unavailable)', async () => {
    const fetchImpl = fetchMock(async () => okResponse({ error: 'mh_unavailable' }, 503));

    const result = await claimCompany(productionCompany, {}, deps(fetchImpl));

    expect(result).toMatchObject({ kind: 'unavailable', message: CLAIM_MESSAGES.unavailable });
  });

  test('network failure', async () => {
    const fetchImpl = fetchMock(async () => {
      throw new TypeError('fetch failed');
    });

    const result = await claimCompany(productionCompany, {}, deps(fetchImpl));

    expect(result).toMatchObject({ kind: 'error', message: CLAIM_MESSAGES.error });
  });

  test('not signed in: no request at all', async () => {
    const fetchImpl = jest.fn() as unknown as jest.MockedFunction<typeof fetch>;

    const result = await claimCompany(productionCompany, {}, deps(fetchImpl, { getToken: jest.fn(async () => null) }));

    expect(result).toMatchObject({ kind: 'unauthenticated' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('missing Hacienda credentials: no request at all', async () => {
    const fetchImpl = jest.fn() as unknown as jest.MockedFunction<typeof fetch>;

    const result = await claimCompany(productionCompany, {}, deps(fetchImpl, { getCredentials: jest.fn(async () => null) }));

    expect(result).toMatchObject({ kind: 'missing-credentials' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('a company without NIT never reaches the network', async () => {
    const fetchImpl = jest.fn() as unknown as jest.MockedFunction<typeof fetch>;

    const result = await claimCompany({ nit: '', environment: CompanyEnvironment.Production }, {}, deps(fetchImpl));

    expect(result).toMatchObject({ kind: 'error' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('claimCompany — wire format', () => {
  test('sends the internal JWT bearer plus MH_USER / MH_KEY headers and the ambiente', async () => {
    const fetchImpl = fetchMock(async () => okResponse({ companyId: CO, session: {} }));

    await claimCompany(productionCompany, {}, deps(fetchImpl));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/auth/companies/claim');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer internal-jwt');
    expect(headers.MH_USER).toBe('06141804941018');
    expect(headers.MH_KEY).toBe('mh-secret');
    expect(JSON.parse(String(init.body))).toEqual({ nit: '06141804941018', ambiente: '01' });
  });

  test('a Pruebas company claims against ambiente 00', async () => {
    const fetchImpl = fetchMock(async () => okResponse({ companyId: CO, session: {} }));

    await claimCompany(testCompany, {}, deps(fetchImpl));

    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body)).ambiente).toBe('00');
  });

  test('reads the credentials of the environment it claims against', async () => {
    const fetchImpl = fetchMock(async () => okResponse({ companyId: CO, session: {} }));
    const getCredentials = jest.fn(async () => ({ user: '06141804941018', password: 'mh-secret' }));

    await claimCompany(productionCompany, {}, deps(fetchImpl, { getCredentials }));
    await claimCompany(testCompany, {}, deps(fetchImpl, { getCredentials }));

    expect(getCredentials).toHaveBeenNthCalledWith(1, NIT, true);
    expect(getCredentials).toHaveBeenNthCalledWith(2, NIT, false);
  });

  test('ambienteForCompany maps environments to MH codes', () => {
    expect(ambienteForCompany(productionCompany)).toBe('01');
    expect(ambienteForCompany(testCompany)).toBe('00');
  });
});

describe('syncV2Slice — claim state', () => {
  const baseState = (): SyncV2State => reducer(undefined, { type: '@@INIT' });

  test('a successful claim marks the company and seeds the session companies', () => {
    const state = reducer(
      baseState(),
      companyClaimSucceeded({ co: CO, companyId: CO, at: '2026-09-28T00:00:00.000Z', companies: [CO, `${CO}test`] }),
    );

    expect(state.claims[CO]).toMatchObject({ status: 'claimed', companyId: CO });
    expect(state.claims[`${CO}test`]).toMatchObject({ status: 'claimed' });
    expect(isCompanyClaimed(state.claims, productionCompany)).toBe(true);
  });

  test('a Pruebas company counts as claimed through its production twin', () => {
    const state = reducer(
      baseState(),
      companyClaimSucceeded({ co: CO, companyId: CO, at: '2026-09-28T00:00:00.000Z' }),
    );

    expect(isCompanyClaimed(state.claims, testCompany)).toBe(true);
    expect(isCompanyClaimed(state.claims, { id: 'other', nit: '123456789-1', environment: CompanyEnvironment.Development })).toBe(false);
  });

  test('a failed claim records the user-facing error for the "Vincular empresa" action', () => {
    const state = reducer(
      baseState(),
      companyClaimFailed({ co: CO, error: CLAIM_MESSAGES.invalidCredentials, at: '2026-09-28T00:00:00.000Z' }),
    );

    expect(state.claims[CO]).toMatchObject({ status: 'failed', error: CLAIM_MESSAGES.invalidCredentials });
    expect(isCompanyClaimed(state.claims, productionCompany)).toBe(false);
  });

  test('a sign-in session listing the company overwrites a stale failed claim (backend is authoritative)', () => {
    let state = reducer(
      baseState(),
      companyClaimFailed({ co: CO, error: CLAIM_MESSAGES.invalidCredentials, at: '2026-09-28T00:00:00.000Z' }),
    );

    state = reducer(state, {
      type: 'auth/googleSignIn/fulfilled',
      payload: { authenticated: true, companies: [CO] },
    } as Parameters<typeof reducer>[1]);

    expect(state.claims[CO]?.status).toBe('claimed');
    expect(isCompanyClaimed(state.claims, productionCompany)).toBe(true);
  });
});
