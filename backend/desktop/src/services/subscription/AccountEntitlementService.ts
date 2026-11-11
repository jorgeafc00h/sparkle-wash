// Account Entitlement Service — cross-platform subscription resolution (Desktop).
//
// Fetches the ONE entitlement read model from Invoices.Api
// (GET /api/v2/account/entitlements) with the internal JWT stored at sign-in.
// This is how a subscription purchased anywhere (N1CO card on web, Google Play on
// Android, TIER_OVERRIDES pilots) surfaces on this device: the backend resolves the
// tier from its UserSubscriptions rows exactly like the `tier` claim it mints.
//
// Failure semantics mirror N1COService.checkStatus: an unreachable/unauthenticated
// backend is NEVER a downgrade — callers only ever apply upgrades.

import axios from 'axios';
import { API_CONFIG, getApiConfig } from '../../config/api';
import { getViteEnv, isViteProduction } from '@/config/viteEnv';
import AuthProviderService from '../../services/auth/AuthProviderService';
import {
  AccountEntitlement,
  SubscriptionTier,
  tierFromAccountEntitlement,
} from './SubscriptionTypes';

interface EntitlementsResponseBody {
  tier?: string;
  planTier?: string | null;
  status?: string;
  planName?: string | null;
  expiresAt?: string | null;
  /** Free sync-trial end, when the account is running one. */
  trialUntil?: string | null;
  features?: { sync?: boolean; adFree?: boolean; email?: boolean };
}

export type AccountEntitlementFetch =
  | { kind: 'entitled'; entitlement: AccountEntitlement }
  /**
   * Free account. `trialUntil` rides along when the account has (or had) a
   * sync-trial row — the server keeps the row after expiry, and the client uses
   * the (possibly past) date to hide the trial offer without waiting for a 409.
   */
  | { kind: 'free'; trialUntil?: string | null }
  | { kind: 'unauthenticated' }
  | { kind: 'unavailable' };

function isProduction(): boolean {
  // viteEnv seam (not raw import.meta) so Jest can transform this module.
  return isViteProduction();
}

function entitlementsUrl(): string {
  if (getViteEnv().DEV) {
    // Vite proxies /api/v2/* to the dev backend in browser/Electron dev — same pattern
    // as the /subscription proxy, keeping Playwright and localhost out of Azure CORS.
    return '/api/v2/account/entitlements';
  }
  // getApiConfig().baseUrl ends in /api → the v2 account route is /api/v2/account/…
  return `${getApiConfig(isProduction()).baseUrl}/v2/account/entitlements`;
}

export async function fetchAccountEntitlement(): Promise<AccountEntitlementFetch> {
  let token: string | null = null;
  try {
    token = await AuthProviderService.getFreshToken();
  } catch {
    token = null;
  }
  if (!token) {
    return { kind: 'unauthenticated' };
  }

  try {
    const response = await axios.get<EntitlementsResponseBody>(entitlementsUrl(), {
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
        'apiKey': API_CONFIG.apiKey,
        'Authorization': `Bearer ${token}`,
      },
    });

    const body = response.data ?? {};
    const tier = tierFromAccountEntitlement(body.tier, body.planTier);
    if (!tier) {
      return { kind: 'free', trialUntil: body.trialUntil ?? null };
    }
    const entitlement: AccountEntitlement = {
      canonicalTier: String(body.tier ?? ''),
      planTier: body.planTier ?? null,
      tier,
      status: body.status ?? 'active',
      planName: body.planName ?? null,
      expiresAt: body.expiresAt ?? null,
      trialUntil: body.trialUntil ?? null,
      features: {
        sync: !!body.features?.sync,
        adFree: !!body.features?.adFree,
        email: body.features?.email !== false,
      },
      fetchedAt: new Date().toISOString(),
    };
    return { kind: 'entitled', entitlement };
  } catch {
    // 401 (expired JWT), 404 (endpoint not deployed yet), timeout, 5xx — the persisted
    // tier must survive all of them untouched.
    return { kind: 'unavailable' };
  }
}

/** Best-to-worst tier comparison for the upgrade-only merge. */
export function bestTier(a: SubscriptionTier, b: SubscriptionTier): SubscriptionTier {
  const order: SubscriptionTier[] = [
    SubscriptionTier.Lite,
    SubscriptionTier.AdFree,
    SubscriptionTier.Pro,
    SubscriptionTier.ProSync,
    SubscriptionTier.Enterprise,
  ];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}
