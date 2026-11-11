/**
 * Regressions from the 2026-11-06 live N1CO sandbox review (Desktop side):
 *  - an ended free trial must not keep Pro+Sync: a canonical `free` entitlement never
 *    re-grants its stored planTier (older APIs still send planTier 'pro_sync');
 *  - the 3DS listener only resolves on N1CO's terminal messages and keeps waiting on
 *    intermediate ones (`authentication.verified`, `profile.completed`, PENDING).
 */
import axios from 'axios';
import { configureStore } from '@reduxjs/toolkit';
import reducer, { initializeSubscription } from '@/store/slices/subscriptionSlice';
import GoogleAuthService from '@/services/auth/GoogleAuthService';
import AuthProviderService from '@/services/auth/AuthProviderService';
import { SubscriptionTier, tierFromAccountEntitlement } from '@/services/subscription/SubscriptionTypes';
import { canUseDeviceSync, canUseLibrosIVA } from '@/services/subscription/FeatureGate';
import { parseN1COMessage, resultFromN1COMessage } from '@/services/subscription/ThreeDSChallenge';

jest.mock('axios');

describe('tierFromAccountEntitlement', () => {
  it('never re-grants a stored planTier when the server resolved the account to free', () => {
    expect(tierFromAccountEntitlement('free', 'pro_sync')).toBeNull();
    expect(tierFromAccountEntitlement('free', 'adfree')).toBeNull();
    expect(tierFromAccountEntitlement('FREE', 'pro')).toBeNull();
  });

  it('still prefers planTier for paid accounts (it separates the $7 and $14 plans)', () => {
    expect(tierFromAccountEntitlement('pro', 'adfree')).toBe(SubscriptionTier.AdFree);
    expect(tierFromAccountEntitlement('pro', 'pro')).toBe(SubscriptionTier.Pro);
    expect(tierFromAccountEntitlement('pro_sync', 'pro_sync')).toBe(SubscriptionTier.ProSync);
    expect(tierFromAccountEntitlement('pro_sync', null)).toBe(SubscriptionTier.ProSync);
    expect(tierFromAccountEntitlement('', 'enterprise')).toBe(SubscriptionTier.Enterprise);
  });
});

describe('initializeSubscription after a free trial ended', () => {
  const expiredUntil = new Date(Date.now() - 15 * 86_400_000).toISOString();

  beforeEach(() => {
    jest.spyOn(GoogleAuthService, 'getFreshIdToken').mockResolvedValue('google-id-token');
    jest.spyOn(AuthProviderService, 'getFreshToken').mockResolvedValue('internal-jwt');
  });
  afterEach(() => jest.restoreAllMocks());

  function storeOnProSync() {
    return configureStore({
      reducer: { subscription: reducer },
      preloadedState: {
        subscription: { ...reducer(undefined, { type: '@@INIT' }), tier: SubscriptionTier.ProSync },
      },
    });
  }

  it('drops to free with the fixed backend (status lite, no planTier)', async () => {
    (axios.get as jest.Mock).mockImplementation(async (url: string) => {
      if (url.includes('/v2/account/entitlements')) {
        return { data: { tier: 'free', status: 'expired', planTier: null, trial: true,
          trialUntil: expiredUntil, expiresAt: expiredUntil, features: { sync: false, adFree: false, email: true } } };
      }
      if (url.includes('/subscription/n1co/status')) {
        return { data: { tier: 'lite', subscription: null, status: 'expired' } };
      }
      throw new Error(`unexpected ${url}`);
    });

    const store = storeOnProSync();
    await store.dispatch(initializeSubscription());

    const s = store.getState().subscription;
    expect(s.tier).toBe(SubscriptionTier.Lite);
    expect(canUseDeviceSync(s.tier)).toBe(false);
    expect(canUseLibrosIVA(s.tier)).toBe(false);
    // The past trial end is kept so the sync page can say the trial was used.
    expect(s.accountEntitlement?.trialUntil).toBe(expiredUntil);
  });

  it('does not let a stale planTier from an older API keep Pro+Sync', async () => {
    (axios.get as jest.Mock).mockImplementation(async (url: string) => {
      if (url.includes('/v2/account/entitlements')) {
        return { data: { tier: 'free', status: 'active', planTier: 'pro_sync', trial: true,
          trialUntil: expiredUntil, expiresAt: expiredUntil, features: { sync: false, adFree: false, email: true } } };
      }
      if (url.includes('/subscription/n1co/status')) {
        return { data: { tier: 'lite', subscription: null } };
      }
      throw new Error(`unexpected ${url}`);
    });

    const store = storeOnProSync();
    await store.dispatch(initializeSubscription());

    expect(store.getState().subscription.tier).toBe(SubscriptionTier.Lite);
  });
});

describe('N1CO 3DS messages', () => {
  const msg = (raw: string) => resultFromN1COMessage(parseN1COMessage(raw));

  it('keeps waiting on intermediate messages', () => {
    expect(msg('{"MessageType":"profile.completed"}')).toBeNull();
    // Real sandbox sequence for an OTP card: verified (no Status) arrives before complete.
    expect(msg('{"MessageType":"authentication.verified","AuthenticationId":"a1"}')).toBeNull();
    expect(msg('{"MessageType":"authentication.complete","Status":"PENDING","AuthenticationId":"a1"}')).toBeNull();
    expect(msg('not json')).toBeNull();
  });

  it('resolves on the terminal messages', () => {
    expect(msg('{"MessageType":"authentication.complete","Status":"SUCCESS","AuthenticationId":"a1"}'))
      .toEqual({ status: 'SUCCESS', authenticationId: 'a1' });
    expect(msg('{"MessageType":"authentication.complete","Status":"EXPIRED","AuthenticationId":"a1"}'))
      .toEqual({ status: 'EXPIRED', authenticationId: 'a1' });
    expect(msg('{"MessageType":"authentication.failed","AuthenticationId":"a1"}'))
      .toEqual({ status: 'FAILED', authenticationId: 'a1' });
    expect(resultFromN1COMessage({ MessageType: 'authentication.complete', Status: 'FAILED' }))
      .toEqual({ status: 'FAILED', authenticationId: undefined });
  });
});
