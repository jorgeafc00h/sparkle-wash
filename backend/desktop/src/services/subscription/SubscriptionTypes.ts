// Subscription types and enums

export enum SubscriptionTier {
  Lite = 'lite',
  AdFree = 'adfree',
  Pro = 'pro',
  // Canonical v2 tiers (Invoices.Api add-centralized-subscription): Pro+Sync adds Device
  // Sync v2 on top of every paid feature; Enterprise adds server backups.
  ProSync = 'pro_sync',
  Enterprise = 'enterprise',
}

export interface SubscriptionState {
  tier: SubscriptionTier;
  isInitialized: boolean;
  loading: boolean;
  error: string | null;
  // Store product info from IAP
  availableProducts: SubscriptionProduct[];
  // Active subscription details
  activeSubscription: ActiveSubscription | null;
  // Purchase in progress
  purchaseInProgress: boolean;
  // Free 1-month sync trial request in flight (POST /api/auth/sync-trial).
  trialStarting: boolean;
  // The server answered 409 — this account already used the trial (or holds a
  // subscription), so the offer stays hidden across restarts.
  syncTrialUsed: boolean;
  // Last account entitlement resolved from the backend (GET /api/v2/account/entitlements).
  // Cross-platform: a purchase made on any platform (N1CO card, Play, override) surfaces
  // here for the signed-in account. Diagnostic data — `tier` above stays the gating input,
  // merged upgrade-only so a server hiccup can never demote a paying customer.
  accountEntitlement?: AccountEntitlement | null;
}

/**
 * Entitlement resolved server-side for the signed-in account (canonical tier model,
 * Invoices.Api add-centralized-subscription D2: free | pro | pro_sync | enterprise).
 * `planTier` carries the raw stored UserSubscriptions.Tier (lite|adfree|pro|…) when the
 * account has an N1CO row — it disambiguates canonical `pro`, which collapses the
 * legacy $7 adfree ("Pro") and $14 business plans.
 */
export interface AccountEntitlement {
  canonicalTier: string;
  /** Raw UserSubscriptions.Tier when present ('adfree' | 'pro' | 'pro_sync' | …). */
  planTier: string | null;
  tier: SubscriptionTier;
  status: string;
  planName: string | null;
  expiresAt: string | null;
  /** Free 1-month sync trial end (POST /api/auth/sync-trial grant), when the
   *  account is running one — drives "Prueba gratis: N días restantes". */
  trialUntil?: string | null;
  features: { sync: boolean; adFree: boolean; email: boolean };
  fetchedAt: string;
}

/**
 * Map a backend entitlement to the client tier. `planTier` (raw N1CO row) wins when known
 * because it preserves the adfree/pro distinction; canonical strings are the fallback.
 * Canonical `pro` is ad-free-only on the server → maps to AdFree here (conservative —
 * never grants cloud/email Pro features to a $7 subscriber). Canonical `free` maps to
 * "no grant", not to a downgrade signal (the server cannot see other platforms'
 * store purchases… and Desktop itself may hold a newer local grant).
 */
export const tierFromAccountEntitlement = (
  canonicalTier: string | null | undefined,
  planTier?: string | null,
): SubscriptionTier | null => {
  const canonical = (canonicalTier ?? '').trim().toLowerCase();
  // The server resolved this account to free (an ended trial, a lapsed plan): the stored
  // planTier only describes that old row and must never re-grant it. Older APIs still sent
  // planTier 'pro_sync' for an expired trial, which kept Desktop on Pro+Sync forever.
  if (canonical === 'free') return null;

  const raw = (planTier ?? '').trim().toLowerCase();
  if (raw === 'adfree' || raw === 'ad_free') return SubscriptionTier.AdFree;
  if (raw === 'pro' || raw === 'business') return SubscriptionTier.Pro;
  if (raw === 'prosync' || raw === 'pro_sync' || raw === 'pro+sync') return SubscriptionTier.ProSync;
  if (raw === 'enterprise') return SubscriptionTier.Enterprise;

  if (canonical === 'pro_sync' || canonical === 'prosync') return SubscriptionTier.ProSync;
  if (canonical === 'enterprise') return SubscriptionTier.Enterprise;
  if (canonical === 'pro') return SubscriptionTier.AdFree;
  // '', unknown → no grant.
  return null;
};

export interface SubscriptionProduct {
  productId: string;
  title: string;
  description: string;
  price: string;
  currency: string;
  localizedPrice: string;
}

export interface ActiveSubscription {
  productId: string;
  tier: SubscriptionTier;
  purchaseDate: string;
  expiryDate: string;
  isAutoRenewing: boolean;
  transactionId: string;
  platform: 'android' | 'ios' | 'web';
  n1coSubscriptionId?: string;
  n1coCustomerId?: string;
  /**
   * Backend status (lowercase): 'active' | 'payment_failed' | 'pending' |
   * 'pending_3ds' | 'cancelled' | 'error' | 'inactive'. Used by the UI to
   * surface the past-due banner without re-polling.
   */
  status?: string;
}

export interface ReceiptValidationResponse {
  valid: boolean;
  tier: SubscriptionTier;
  expiryDate: string;
  isAutoRenewing: boolean;
}

// Map product IDs to tiers (all platforms)
export const PRODUCT_TIER_MAP: Record<string, SubscriptionTier> = {
  // Google Play (Android)
  'com.kandangalabs.facturassimples.adfree.monthly': SubscriptionTier.AdFree,
  'com.kandangalabs.facturassimples.pro.monthly': SubscriptionTier.Pro,
  // Apple App Store (iOS)
  'com.kandangalabs.App.plus_ad_free_monthly': SubscriptionTier.AdFree,
  'com.kandangalabs.App.enterprise_pro_unlimited_monthly': SubscriptionTier.Pro,
  'com.kandangalabs.App.enterprise_pro_unlimited_anual': SubscriptionTier.Pro,
  // N1CO (Windows)
  'n1co.facturassimples.pro.monthly': SubscriptionTier.AdFree,
  'n1co.facturassimples.business.monthly': SubscriptionTier.Pro,
};

export const getTierFromProductId = (productId: string): SubscriptionTier => {
  return PRODUCT_TIER_MAP[productId] ?? SubscriptionTier.Lite;
};
