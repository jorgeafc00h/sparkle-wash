/**
 * Free 1-month Device Sync trial — POST /api/auth/sync-trial client, the UI
 * gating resolver, and the subscription-slice transitions.
 *
 * The SERVER owns the grant (200 = started, 409 = already used, 401 = no
 * session); the client only surfaces it and refreshes the local entitlement.
 * The requestor seam is injected — no network in these tests, and tokens are
 * never asserted into snapshots/logs.
 */

import { configureStore } from '@reduxjs/toolkit';
import reducer, { startSyncTrial } from '../../store/slices/subscriptionSlice';
import authReducer from '../../store/slices/authSlice';
import { logoutUser } from '../../store/slices/authSlice';
import AuthProviderService from '../../services/auth/AuthProviderService';
import * as SyncTrialServiceModule from '../../services/subscription/SyncTrialService';
import {
  resolveSyncTrialView,
  startSyncTrial as startSyncTrialRequest,
  SYNC_TRIAL_DAYS,
  trialRemainingDays,
  type SyncTrialRequestor,
} from '../../services/subscription/SyncTrialService';
import { SubscriptionState, SubscriptionTier } from '../../services/subscription/SubscriptionTypes';

// ── helpers ─────────────────────────────────────────────────────────────────

function installLocalStorageMock() {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
      clear: () => void storage.clear(),
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      get length() {
        return storage.size;
      },
    },
    configurable: true,
  });
}

interface RecordedCall { url: string; init: { method: string; headers: Record<string, string>; body: string } }

const requestorReturning = (
  status: number,
  body: unknown,
): { requestor: SyncTrialRequestor; calls: RecordedCall[] } => {
  const calls: RecordedCall[] = [];
  return {
    calls,
    requestor: async (url, init) => {
      calls.push({ url, init });
      return {
        status,
        json: async () => body,
      };
    },
  };
};

const trialUntilIso = new Date(Date.now() + SYNC_TRIAL_DAYS * 86_400_000).toISOString();

/** The auth slice's initial state (RTK version here has no getInitialState). */
const initialAuthState = authReducer(undefined, { type: '@@INIT' });

const initialSubscriptionState: SubscriptionState = {
  tier: SubscriptionTier.Lite,
  isInitialized: false,
  loading: false,
  error: null,
  availableProducts: [],
  activeSubscription: null,
  purchaseInProgress: false,
  trialStarting: false,
  syncTrialUsed: false,
};

// ── service ─────────────────────────────────────────────────────────────────

describe('SyncTrialService.startSyncTrial', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    installLocalStorageMock();
  });

  it('200: started with the granted tier and trialUntil', async () => {
    await AuthProviderService.updateToken('jwt-test-token');
    const { requestor, calls } = requestorReturning(200, {
      tier: 'pro_sync',
      trialUntil: trialUntilIso,
      alreadyUsed: false,
    });

    const result = await startSyncTrialRequest(requestor);

    expect(result).toEqual({ kind: 'started', tier: SubscriptionTier.ProSync, trialUntil: trialUntilIso });
    // {API}/api/auth/sync-trial with the internal-JWT bearer + apiKey — and no
    // token ever leaves through any other channel.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/api/auth/sync-trial');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers.Authorization).toBe('Bearer jwt-test-token');
    expect(calls[0].init.headers.apiKey).toBeTruthy();
  });

  it('409: already-used', async () => {
    await AuthProviderService.updateToken('jwt-test-token');
    const { requestor } = requestorReturning(409, { alreadyUsed: true });
    expect(await startSyncTrialRequest(requestor)).toEqual({ kind: 'already-used' });
  });

  it('401: unauthenticated (no session)', async () => {
    await AuthProviderService.updateToken('jwt-expired');
    const { requestor } = requestorReturning(401, { error: 'unauthorized' });
    expect(await startSyncTrialRequest(requestor)).toEqual({ kind: 'unauthenticated' });
  });

  it('no stored token: unauthenticated without hitting the network', async () => {
    const { requestor, calls } = requestorReturning(200, {});
    expect(await startSyncTrialRequest(requestor)).toEqual({ kind: 'unauthenticated' });
    expect(calls).toHaveLength(0);
  });

  it('network failure: unavailable (server state untouched, retryable)', async () => {
    await AuthProviderService.updateToken('jwt-test-token');
    const requestor: SyncTrialRequestor = async () => {
      throw new Error('ECONNREFUSED');
    };
    expect(await startSyncTrialRequest(requestor)).toEqual({ kind: 'unavailable' });
  });

  it('is defensive about the contract: missing trialUntil falls back to now+30d, odd tier still grants sync', async () => {
    await AuthProviderService.updateToken('jwt-test-token');
    const before = Date.now();
    const { requestor } = requestorReturning(200, { tier: 'ProSync' });

    const result = await startSyncTrialRequest(requestor);

    expect(result.kind).toBe('started');
    if (result.kind === 'started') {
      expect(result.tier).toBe(SubscriptionTier.ProSync);
      const ms = Date.parse(result.trialUntil) - before;
      expect(ms).toBeGreaterThan((SYNC_TRIAL_DAYS - 1) * 86_400_000);
      expect(ms).toBeLessThanOrEqual((SYNC_TRIAL_DAYS + 1) * 86_400_000);
    }
  });

  it('200 with alreadyUsed:true in the body is treated as already-used', async () => {
    await AuthProviderService.updateToken('jwt-test-token');
    const { requestor } = requestorReturning(200, { alreadyUsed: true, tier: 'pro_sync' });
    expect(await startSyncTrialRequest(requestor)).toEqual({ kind: 'already-used' });
  });

  it('carries the re-minted internalJwt through on started (additive, e7616ce)', async () => {
    await AuthProviderService.updateToken('jwt-login-time');
    const { requestor } = requestorReturning(200, {
      tier: 'pro_sync',
      trialUntil: trialUntilIso,
      internalJwt: 'jwt-recented-pro-sync',
    });
    const result = await startSyncTrialRequest(requestor);
    expect(result).toEqual({
      kind: 'started',
      tier: SubscriptionTier.ProSync,
      trialUntil: trialUntilIso,
      internalJwt: 'jwt-recented-pro-sync',
    });
  });

  it('started without internalJwt still succeeds (backward compatible)', async () => {
    await AuthProviderService.updateToken('jwt-test-token');
    const { requestor } = requestorReturning(200, { tier: 'pro_sync', trialUntil: trialUntilIso });
    const result = await startSyncTrialRequest(requestor);
    expect(result.kind).toBe('started');
    if (result.kind === 'started') {
      expect(result.internalJwt).toBeUndefined();
    }
  });

  it('ignores a non-string/empty internalJwt defensively', async () => {
    await AuthProviderService.updateToken('jwt-test-token');
    const { requestor } = requestorReturning(200, { tier: 'pro_sync', trialUntil: trialUntilIso, internalJwt: '   ' });
    const result = await startSyncTrialRequest(requestor);
    expect(result.kind).toBe('started');
    if (result.kind === 'started') expect(result.internalJwt).toBeUndefined();
  });
});

// ── UI gating ───────────────────────────────────────────────────────────────

describe('resolveSyncTrialView — trial button visibility', () => {
  it('offers the trial to every tier without device sync', () => {
    for (const tier of [SubscriptionTier.Lite, SubscriptionTier.AdFree, SubscriptionTier.Pro] as const) {
      expect(resolveSyncTrialView({ tier, trialUntil: null, syncTrialUsed: false })).toEqual({
        showOffer: true,
        showUsed: false,
        remainingDays: null,
      });
    }
  });

  it('never offers the trial to a tier that already syncs (the panel is unlocked)', () => {
    const view = resolveSyncTrialView({ tier: SubscriptionTier.ProSync, trialUntil: null, syncTrialUsed: false });
    expect(view.showOffer).toBe(false);
    expect(view.showUsed).toBe(false);
    const enterprise = resolveSyncTrialView({ tier: SubscriptionTier.Enterprise, trialUntil: null, syncTrialUsed: false });
    expect(enterprise.showOffer).toBe(false);
  });

  it('hides the offer and shows "used" after the server answered 409', () => {
    const view = resolveSyncTrialView({ tier: SubscriptionTier.Lite, trialUntil: null, syncTrialUsed: true });
    expect(view.showOffer).toBe(false);
    expect(view.showUsed).toBe(true);
  });

  it('an active trial shows remaining days and no offer', () => {
    const trialUntil = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const view = resolveSyncTrialView({ tier: SubscriptionTier.ProSync, trialUntil, syncTrialUsed: false });
    expect(view.showOffer).toBe(false);
    expect(view.showUsed).toBe(false);
    expect(view.remainingDays).toBe(10);
  });

  it('an expired trial counts as consumed: used message, no offer, no countdown', () => {
    const expired = new Date(Date.now() - 86_400_000).toISOString();
    const view = resolveSyncTrialView({ tier: SubscriptionTier.Lite, trialUntil: expired, syncTrialUsed: false });
    expect(view.showOffer).toBe(false);
    expect(view.showUsed).toBe(true);
    expect(view.remainingDays).toBeNull();
  });
});

describe('trialRemainingDays', () => {
  it('ceil-wraps partial days and returns null for expired/absent/invalid values', () => {
    expect(trialRemainingDays(new Date(Date.now() + 30 * 86_400_000).toISOString())).toBe(30);
    expect(trialRemainingDays(new Date(Date.now() + 12 * 3_600_000).toISOString())).toBe(1);
    expect(trialRemainingDays(new Date(Date.now() - 1_000).toISOString())).toBeNull();
    expect(trialRemainingDays(null)).toBeNull();
    expect(trialRemainingDays(undefined)).toBeNull();
    expect(trialRemainingDays('not-a-date')).toBeNull();
  });
});

// ── subscription slice transitions ─────────────────────────────────────────

describe('subscriptionSlice — startSyncTrial', () => {
  it('pending then granted: tier rises upgrade-only and the entitlement carries trialUntil', () => {
    let state = reducer(initialSubscriptionState, startSyncTrial.pending('', undefined));
    expect(state.trialStarting).toBe(true);

    state = reducer(
      state,
      startSyncTrial.fulfilled(
        { kind: 'started', tier: SubscriptionTier.ProSync, trialUntil: trialUntilIso },
        '',
        undefined,
      ),
    );
    expect(state.trialStarting).toBe(false);
    expect(state.tier).toBe(SubscriptionTier.ProSync);
    expect(state.accountEntitlement?.trialUntil).toBe(trialUntilIso);
    // canonicalTier mirrors the granted tier string (the entitlements endpoint
    // returns body.tier the same way) — never a hardcoded 'pro_sync'.
    expect(state.accountEntitlement?.canonicalTier).toBe('pro_sync');
    expect(state.accountEntitlement?.features.sync).toBe(true);
  });

  it('never demotes an Enterprise account that starts a redundant trial', () => {
    const state = reducer(
      { ...initialSubscriptionState, tier: SubscriptionTier.Enterprise },
      startSyncTrial.fulfilled(
        { kind: 'started', tier: SubscriptionTier.ProSync, trialUntil: trialUntilIso },
        '',
        undefined,
      ),
    );
    expect(state.tier).toBe(SubscriptionTier.Enterprise);
    expect(state.accountEntitlement?.trialUntil).toBe(trialUntilIso);
  });

  it('records the granted canonical tier (an enterprise grant is not reported as pro_sync)', () => {
    const state = reducer(
      initialSubscriptionState,
      startSyncTrial.fulfilled(
        { kind: 'started', tier: SubscriptionTier.Enterprise, trialUntil: trialUntilIso },
        '',
        undefined,
      ),
    );
    expect(state.tier).toBe(SubscriptionTier.Enterprise);
    expect(state.accountEntitlement?.canonicalTier).toBe('enterprise');
  });

  it('409 settles syncTrialUsed so the offer stays hidden', () => {
    const state = reducer(
      initialSubscriptionState,
      startSyncTrial.fulfilled({ kind: 'already-used' }, '', undefined),
    );
    expect(state.syncTrialUsed).toBe(true);
    expect(state.tier).toBe(SubscriptionTier.Lite);
    expect(state.accountEntitlement).toBeUndefined();
  });

  it('rejection surfaces the Spanish error and clears the in-flight flag', () => {
    let state = reducer(initialSubscriptionState, startSyncTrial.pending('', undefined));
    state = reducer(state, startSyncTrial.rejected(new Error('x'), '', undefined, 'Debes iniciar sesión para iniciar la prueba gratis'));
    expect(state.trialStarting).toBe(false);
    expect(state.error).toBe('Debes iniciar sesión para iniciar la prueba gratis');
  });

  it('sign-out resets the trial flags with the tier (the trial belongs to the account)', () => {
    const state = reducer(
      { ...initialSubscriptionState, syncTrialUsed: true, trialStarting: true },
      { type: logoutUser.fulfilled.type },
    );
    expect(state.syncTrialUsed).toBe(false);
    expect(state.trialStarting).toBe(false);
  });

  it('a started grant with internalJwt replaces the stored session token (relay-ready tier claim)', async () => {
    await AuthProviderService.updateToken('jwt-login-time-free-tier');
    const store = configureStore({
      reducer: { subscription: reducer, auth: authReducer },
      preloadedState: {
        // Signed in with the stale login-time token — the claim-flow precondition.
        auth: { ...initialAuthState, isAuthenticated: true, token: 'jwt-login-time-free-tier' },
      },
    });
    const spy = jest
      .spyOn(SyncTrialServiceModule, 'startSyncTrial')
      .mockResolvedValue({
        kind: 'started',
        tier: SubscriptionTier.ProSync,
        trialUntil: trialUntilIso,
        internalJwt: 'jwt-recented-pro-sync',
      });

    await store.dispatch(startSyncTrial());

    expect(spy).toHaveBeenCalledTimes(1);
    // Persisted exactly like the company-claim refresh: appStorage + in-memory session.
    expect(await AuthProviderService.getToken()).toBe('jwt-recented-pro-sync');
    expect(store.getState().auth.token).toBe('jwt-recented-pro-sync');
    expect(store.getState().subscription.tier).toBe(SubscriptionTier.ProSync);
    spy.mockRestore();
  });

  it('a started grant WITHOUT internalJwt leaves the stored token untouched', async () => {
    await AuthProviderService.updateToken('jwt-login-time');
    const store = configureStore({
      reducer: { subscription: reducer, auth: authReducer },
      preloadedState: {
        auth: { ...initialAuthState, isAuthenticated: true, token: 'jwt-login-time' },
      },
    });
    const spy = jest
      .spyOn(SyncTrialServiceModule, 'startSyncTrial')
      .mockResolvedValue({
        kind: 'started',
        tier: SubscriptionTier.ProSync,
        trialUntil: trialUntilIso,
      });

    await store.dispatch(startSyncTrial());

    expect(await AuthProviderService.getToken()).toBe('jwt-login-time');
    expect(store.getState().auth.token).toBe('jwt-login-time');
    expect(store.getState().subscription.tier).toBe(SubscriptionTier.ProSync);
    spy.mockRestore();
  });

  it('never writes the refreshed token back for a signed-out user (claim-flow race guard)', async () => {
    await AuthProviderService.updateToken('jwt-cleared-on-logout');
    const store = configureStore({
      reducer: { subscription: reducer, auth: authReducer },
      // isAuthenticated defaults to false — the thunk resolved after sign-out.
    });
    const spy = jest
      .spyOn(SyncTrialServiceModule, 'startSyncTrial')
      .mockResolvedValue({
        kind: 'started',
        tier: SubscriptionTier.ProSync,
        trialUntil: trialUntilIso,
        internalJwt: 'jwt-recented-pro-sync',
      });

    await store.dispatch(startSyncTrial());

    expect(await AuthProviderService.getToken()).toBe('jwt-cleared-on-logout');
    expect(store.getState().auth.token).toBeNull();
    spy.mockRestore();
  });
});
