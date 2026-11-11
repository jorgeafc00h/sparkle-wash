// Claim lifecycle races (Phase 1 review): concurrent claims for several companies
// must serialize their refreshed-JWT persistence — each claim response carries a
// token listing only the companies linked SO FAR, so the last writer must not drop a
// company the relay would then refuse. And a claim that resolves after sign-out must
// not write the JWT back into storage (for a logged-out user) nor re-seed the claim
// state the sign-out just cleared.

jest.mock('@/services/logging/LocalLogger', () => ({
  LocalLogger: { initialize: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), log: jest.fn() },
}));
jest.mock('@/services/telemetry/TelemetryService', () => ({
  TelemetryService: { initialize: jest.fn(), trackEvent: jest.fn(), trackException: jest.fn(), trackTrace: jest.fn() },
  default: { initialize: jest.fn(), trackEvent: jest.fn(), trackException: jest.fn(), trackTrace: jest.fn() },
}));
jest.mock('@/services/storage/ElectronStorage', () => {
  const map = new Map<string, string>();
  const storage = {
    getItem: jest.fn(async (key: string) => (map.has(key) ? map.get(key)! : null)),
    setItem: jest.fn(async (key: string, value: string) => {
      map.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      map.delete(key);
    }),
    clear: jest.fn(async () => {
      map.clear();
    }),
    getAllKeys: jest.fn(async () => Array.from(map.keys())),
  };
  return { appStorage: storage, electronPersistStorage: storage };
});
jest.mock('@/services/auth/AuthProviderService', () => ({
  default: {
    getToken: jest.fn(async () => 'stored-jwt'),
    updateToken: jest.fn(async () => undefined),
  },
}));
jest.mock('@/services/sync/companyClaimService', () => ({
  CLAIM_MESSAGES: { error: 'error' },
  claimCompany: jest.fn(),
}));

import { combineReducers, configureStore } from '@reduxjs/toolkit';
import authReducer, { logout, restoreSession } from '@/store/slices/authSlice';
import syncV2Reducer, { claimSyncCompany } from '@/store/slices/syncV2Slice';
import AuthProviderService from '@/services/auth/AuthProviderService';
import { claimCompany, type ClaimableCompany, type CompanyClaimResult } from '@/services/sync/companyClaimService';
import { CompanyEnvironment, type Company } from '@/types';

const NIT_A = '0614-180494-101-0';
const NIT_B = '0614-180494-101-1';
const CO_A = 'co06141804941010';
const CO_B = 'co06141804941011';

const company = (id: string, nit: string): Company => ({
  id,
  nit,
  environment: CompanyEnvironment.Production,
  isProduction: true,
} as unknown as Company);

const buildStore = () => {
  const store = configureStore({
    reducer: combineReducers({ auth: authReducer, syncV2: syncV2Reducer }),
  });
  store.dispatch(restoreSession({ user: { id: 'u1', email: 'u@test.com' } as never, token: 'session-jwt' }));
  return store;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('claimSyncCompany — concurrent claims', () => {
  test('serialize their JWT persists: the final token covers every company', async () => {
    // Emulates the backend: each claim response returns the companies linked SO FAR,
    // and the slow claim (A) resolves last when run unserialized.
    const linked = new Set<string>();
    jest.mocked(claimCompany).mockImplementation(async (target: ClaimableCompany) => {
      const co = `co${(target.nit ?? '').replace(/\D/g, '')}`;
      await new Promise(resolve => setTimeout(resolve, co === CO_A ? 25 : 5));
      linked.add(co);
      const companies = [...linked];
      return { kind: 'claimed', companyId: co, companies, token: `jwt:${companies.join('+')}` };
    });

    const store = buildStore();
    const actions = await Promise.all([
      store.dispatch(claimSyncCompany(company('c1', NIT_A))),
      store.dispatch(claimSyncCompany(company('c2', NIT_B))),
    ]);

    expect(actions.map(action => (action.payload as CompanyClaimResult | null)?.kind)).toEqual(['claimed', 'claimed']);
    const calls = jest.mocked(AuthProviderService.updateToken).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const lastToken = calls[calls.length - 1][0];
    // Without serialization the slow A would finish last and store `jwt:coA` — a
    // token the relay refuses for company B.
    expect(lastToken).toContain(CO_A);
    expect(lastToken).toContain(CO_B);
    expect(store.getState().syncV2.claims[CO_A]?.status).toBe('claimed');
    expect(store.getState().syncV2.claims[CO_B]?.status).toBe('claimed');
  });

  test('a second claim for the same company while one runs is a no-op (sign-in + button race)', async () => {
    let release: ((value: CompanyClaimResult) => void) | null = null;
    jest.mocked(claimCompany).mockImplementation(() => new Promise(resolve => { release = resolve; }));

    const store = buildStore();
    const target = company('c1', NIT_A);
    const first = store.dispatch(claimSyncCompany(target));
    const second = store.dispatch(claimSyncCompany(target));
    expect((await second).payload).toBeNull(); // deduped before hitting the endpoint again

    release!({ kind: 'claimed', companyId: CO_A, companies: [CO_A], token: null });
    expect(((await first).payload as CompanyClaimResult | null)?.kind).toBe('claimed');
    expect(jest.mocked(claimCompany)).toHaveBeenCalledTimes(1);
  });
});

describe('claimSyncCompany — sign-out while a claim is in flight', () => {
  test('does not write the JWT back into storage nor re-seed the cleared claim state', async () => {
    let release: ((value: CompanyClaimResult) => void) | null = null;
    jest.mocked(claimCompany).mockImplementation(() => new Promise(resolve => { release = resolve; }));

    const store = buildStore();
    const pending = store.dispatch(claimSyncCompany(company('c1', NIT_A)));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(release).not.toBeNull();

    store.dispatch(logout()); // session cleared, account sync state reset

    release!({ kind: 'claimed', companyId: CO_A, companies: [CO_A], token: 'refreshed-jwt' });
    const action = await pending;
    expect((action.payload as CompanyClaimResult | null)?.kind).toBe('claimed'); // the outcome is still reported…

    // …but nothing of it is applied to a signed-out app.
    expect(AuthProviderService.updateToken).not.toHaveBeenCalled();
    expect(store.getState().syncV2.claims[CO_A]).toBeUndefined();
    expect(store.getState().auth.token).toBeNull();
  });
});
