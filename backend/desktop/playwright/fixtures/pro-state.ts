/**
 * Pro tier seed fixtures for Playwright E2E tests.
 *
 * Extends seed-state.ts with Pro / AdFree / Google-authed variants.
 * Follows the same redux-persist double-encode pattern.
 *
 * GoogleAuthService reads from plain localStorage keys (not redux-persist format):
 *   google_access_token, google_id_token, google_user,
 *   google_token_expires_at, google_granted_scopes
 * These are seeded directly as raw strings (see googleSessionEntries).
 */

import { Page } from '@playwright/test';
import {
  TEST_COMPANY,
  SAMPLE_CUSTOMERS,
  SAMPLE_PRODUCTS,
  SAMPLE_INVOICES,
} from './seed-state';

const PERSIST_KEY_PREFIX = 'persist:';

/**
 * A fresh Google session: unexpired access token that already carries Drive
 * access (scopes are otherwise requested on first use, which would open the
 * Google consent flow mid-test).
 */
function googleSessionEntries(): Record<string, string> {
  return {
    google_id_token: GOOGLE_USER.idToken,
    google_access_token: GOOGLE_USER.accessToken,
    google_user: JSON.stringify(GOOGLE_USER),
    google_token_expires_at: String(Date.now() + 60 * 60 * 1000),
    google_granted_scopes: 'openid email profile https://www.googleapis.com/auth/drive.file',
  };
}

// ---------------------------------------------------------------------------
// Pro test data
// ---------------------------------------------------------------------------

export const GOOGLE_USER = {
  id: 'google_test_123',
  email: 'pro@gmail.com',
  name: 'Pro Usuario',
  picture: '',
  idToken: 'fake-id-token-for-testing',
  accessToken: 'fake-access-token-for-testing',
};

export const PRO_USER = {
  id: GOOGLE_USER.id,
  email: GOOGLE_USER.email,
  firstName: 'Pro',
  lastName: 'Usuario',
  phone: '',
  avatar: '',
  isEmailVerified: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

export const PRO_ACTIVE_SUBSCRIPTION = {
  productId: 'n1co.facturassimples.business.monthly',
  tier: 'pro',
  purchaseDate: '2026-01-01T00:00:00.000Z',
  expiryDate: '2026-12-31T23:59:59.000Z',
  isAutoRenewing: true,
  transactionId: 'txn-test-pro-001',
  platform: 'web',
  n1coSubscriptionId: 'sub-test-001',
  n1coCustomerId: 'cust-test-001',
};

export const ADFREE_ACTIVE_SUBSCRIPTION = {
  productId: 'n1co.facturassimples.pro.monthly',
  tier: 'adfree',
  purchaseDate: '2026-01-01T00:00:00.000Z',
  expiryDate: '2026-12-31T23:59:59.000Z',
  isAutoRenewing: true,
  transactionId: 'txn-test-adfree-001',
  platform: 'web',
  n1coSubscriptionId: 'sub-test-002',
  n1coCustomerId: 'cust-test-002',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toReduxPersistFormat(state: Record<string, unknown>): string {
  const doubleEncoded: Record<string, string> = {};
  for (const [key, value] of Object.entries(state)) {
    doubleEncoded[key] = JSON.stringify(value);
  }
  return JSON.stringify(doubleEncoded);
}

function buildProAuthState() {
  return toReduxPersistFormat({
    user: PRO_USER,
    isAuthenticated: true,
    isGuestMode: false,
    hasCompletedOnboarding: true,
    loading: false,
    error: null,
    token: GOOGLE_USER.idToken,
    refreshToken: null,
    selectedCompanyId: TEST_COMPANY.id,
    _persist: { version: -1, rehydrated: true },
  });
}

function buildLiteAuthState() {
  return toReduxPersistFormat({
    user: {
      id: 'guest-user-001',
      email: 'test@facturassimples.com',
      firstName: 'Test',
      lastName: 'User',
      phone: '7700-0000',
      avatar: '',
      isEmailVerified: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    isAuthenticated: false,
    isGuestMode: true,
    hasCompletedOnboarding: true,
    loading: false,
    error: null,
    token: null,
    refreshToken: null,
    selectedCompanyId: TEST_COMPANY.id,
    _persist: { version: -1, rehydrated: true },
  });
}

function buildAppState() {
  return toReduxPersistFormat({
    isInitialized: true,
    isOnline: true,
    currentTheme: 'light',
    language: 'es',
    environment: 'development',
    syncStatus: 'idle',
    notifications: [],
    _persist: { version: -1, rehydrated: true },
  });
}

function buildCompaniesState(companies = [TEST_COMPANY]) {
  return toReduxPersistFormat({
    companies,
    selectedCompanyId: companies[0]?.id ?? null,
    currentCompany: companies[0] ?? null,
    loading: false,
    error: null,
    _persist: { version: -1, rehydrated: true },
  });
}

function buildSubscriptionState(
  tier: 'lite' | 'adfree' | 'pro' | 'pro_sync' | 'enterprise',
  activeSubscription: unknown = null,
  extra: Record<string, unknown> = {},
) {
  return toReduxPersistFormat({
    tier,
    isInitialized: true,
    loading: false,
    error: null,
    availableProducts: [],
    activeSubscription,
    purchaseInProgress: false,
    ...extra,
    _persist: { version: -1, rehydrated: true },
  });
}

function buildCustomersState(customers: unknown[] = SAMPLE_CUSTOMERS) {
  return toReduxPersistFormat({
    customers,
    selectedCustomerId: null,
    lastUpdatedAt: null,
    loading: false,
    error: null,
    searchTerm: '',
    filters: { isActive: true },
    _persist: { version: -1, rehydrated: true },
  });
}

function buildProductsState(products: unknown[] = SAMPLE_PRODUCTS) {
  return toReduxPersistFormat({
    products,
    stockMovements: [],
    categories: [],
    brands: [],
    suppliers: [],
    currentProduct: null,
    filters: {},
    loading: false,
    error: null,
    searchTerm: '',
    _persist: { version: -1, rehydrated: true },
  });
}

function buildInvoicesState(invoices: unknown[] = SAMPLE_INVOICES) {
  return toReduxPersistFormat({
    invoices,
    selectedInvoiceId: null,
    pendingSync: [],
    lastSyncDate: null,
    currentInvoice: null,
    filters: {},
    loading: false,
    error: null,
    searchTerm: '',
    _persist: { version: -1, rehydrated: true },
  });
}

function buildCatalogsState() {
  return toReduxPersistFormat({
    catalogs: [],
    syncInfo: {},
    lastFullSync: null,
    filters: {},
    loading: false,
    error: null,
    searchTerm: '',
    _persist: { version: -1, rehydrated: true },
  });
}

function buildComprasState() {
  return toReduxPersistFormat({
    compras: [],
    monthlyTotal: null,
    dbInitialized: true,
    loading: false,
    error: null,
    searchTerm: '',
    dateFrom: null,
    dateTo: null,
    selectedCompraId: null,
    linkedGmailEmail: null,
    syncState: null,
    _persist: { version: -1, rehydrated: true },
  });
}

async function injectAndGoto(
  page: Page,
  entries: Record<string, string>,
  path = '/',
): Promise<void> {
  await page.addInitScript((data) => {
    for (const [key, value] of Object.entries(data as Record<string, string>)) {
      window.localStorage.setItem(key, value);
    }
  }, entries);

  await page.goto(path);
  // Wait for sidebar (authenticated app) or welcome page
  await page.waitForSelector(
    '[data-testid="sidebar-inicio"], [data-testid="welcome"], [data-testid="onboarding"]',
    { timeout: 20000, state: 'visible' },
  );
}

// ---------------------------------------------------------------------------
// Public seed functions
// ---------------------------------------------------------------------------

/**
 * Seed a Pro tier user with Google OAuth tokens already in localStorage.
 * The GoogleAuthService reads google_id_token / google_user directly from
 * localStorage — so seeding these makes isSignedIn() return true without
 * going through the OAuth popup.
 */
export async function seedProUserWithGoogleAuth(page: Page): Promise<void> {
  const entries: Record<string, string> = {
    // Redux-persist slices
    [`${PERSIST_KEY_PREFIX}auth`]: buildProAuthState(),
    [`${PERSIST_KEY_PREFIX}app`]: buildAppState(),
    [`${PERSIST_KEY_PREFIX}companies`]: buildCompaniesState([TEST_COMPANY]),
    [`${PERSIST_KEY_PREFIX}customers`]: buildCustomersState(SAMPLE_CUSTOMERS),
    [`${PERSIST_KEY_PREFIX}products`]: buildProductsState(SAMPLE_PRODUCTS),
    [`${PERSIST_KEY_PREFIX}invoices`]: buildInvoicesState(SAMPLE_INVOICES),
    [`${PERSIST_KEY_PREFIX}catalogs`]: buildCatalogsState(),
    [`${PERSIST_KEY_PREFIX}subscription`]: buildSubscriptionState(
      'pro',
      PRO_ACTIVE_SUBSCRIPTION,
    ),
    [`${PERSIST_KEY_PREFIX}compras`]: buildComprasState(),
    // GoogleAuthService raw storage keys
    ...googleSessionEntries(),
  };

  await injectAndGoto(page, entries);
}

/**
 * Seed a Pro tier user WITHOUT Google auth (signed in via N1CO only,
 * no Google Drive access).
 */
export async function seedProUserWithoutGoogleAuth(page: Page): Promise<void> {
  const entries: Record<string, string> = {
    [`${PERSIST_KEY_PREFIX}auth`]: buildProAuthState(),
    [`${PERSIST_KEY_PREFIX}app`]: buildAppState(),
    [`${PERSIST_KEY_PREFIX}companies`]: buildCompaniesState([TEST_COMPANY]),
    [`${PERSIST_KEY_PREFIX}customers`]: buildCustomersState(SAMPLE_CUSTOMERS),
    [`${PERSIST_KEY_PREFIX}products`]: buildProductsState(SAMPLE_PRODUCTS),
    [`${PERSIST_KEY_PREFIX}invoices`]: buildInvoicesState(SAMPLE_INVOICES),
    [`${PERSIST_KEY_PREFIX}catalogs`]: buildCatalogsState(),
    [`${PERSIST_KEY_PREFIX}subscription`]: buildSubscriptionState(
      'pro',
      PRO_ACTIVE_SUBSCRIPTION,
    ),
    [`${PERSIST_KEY_PREFIX}compras`]: buildComprasState(),
    // No google_id_token / google_user — GoogleAuthService.isSignedIn() returns false
  };

  await injectAndGoto(page, entries);
}

/**
 * Seed a Lite tier user (guest mode, no subscription, no Google auth).
 */
export async function seedLiteUserState(page: Page): Promise<void> {
  const entries: Record<string, string> = {
    [`${PERSIST_KEY_PREFIX}auth`]: buildLiteAuthState(),
    [`${PERSIST_KEY_PREFIX}app`]: buildAppState(),
    [`${PERSIST_KEY_PREFIX}companies`]: buildCompaniesState([TEST_COMPANY]),
    [`${PERSIST_KEY_PREFIX}customers`]: buildCustomersState([]),
    [`${PERSIST_KEY_PREFIX}products`]: buildProductsState([]),
    [`${PERSIST_KEY_PREFIX}invoices`]: buildInvoicesState([]),
    [`${PERSIST_KEY_PREFIX}catalogs`]: buildCatalogsState(),
    [`${PERSIST_KEY_PREFIX}subscription`]: buildSubscriptionState('lite', null),
    [`${PERSIST_KEY_PREFIX}compras`]: buildComprasState(),
  };

  await injectAndGoto(page, entries);
}

/**
 * Seed a Lite tier user with populated data (invoices, customers, products).
 */
export async function seedLiteUserWithDataState(page: Page): Promise<void> {
  const entries: Record<string, string> = {
    [`${PERSIST_KEY_PREFIX}auth`]: buildLiteAuthState(),
    [`${PERSIST_KEY_PREFIX}app`]: buildAppState(),
    [`${PERSIST_KEY_PREFIX}companies`]: buildCompaniesState([TEST_COMPANY]),
    [`${PERSIST_KEY_PREFIX}customers`]: buildCustomersState(SAMPLE_CUSTOMERS),
    [`${PERSIST_KEY_PREFIX}products`]: buildProductsState(SAMPLE_PRODUCTS),
    [`${PERSIST_KEY_PREFIX}invoices`]: buildInvoicesState(SAMPLE_INVOICES),
    [`${PERSIST_KEY_PREFIX}catalogs`]: buildCatalogsState(),
    [`${PERSIST_KEY_PREFIX}subscription`]: buildSubscriptionState('lite', null),
    [`${PERSIST_KEY_PREFIX}compras`]: buildComprasState(),
  };

  await injectAndGoto(page, entries);
}

/**
 * Seed a Lite tier user who IS authenticated with Google.
 * Used for purchase-flow tests where auth is required to pay.
 */
export async function seedLiteUserWithGoogleAuth(page: Page): Promise<void> {
  const entries: Record<string, string> = {
    [`${PERSIST_KEY_PREFIX}auth`]: buildProAuthState(), // authenticated, not guest
    [`${PERSIST_KEY_PREFIX}app`]: buildAppState(),
    [`${PERSIST_KEY_PREFIX}companies`]: buildCompaniesState([TEST_COMPANY]),
    [`${PERSIST_KEY_PREFIX}customers`]: buildCustomersState([]),
    [`${PERSIST_KEY_PREFIX}products`]: buildProductsState([]),
    [`${PERSIST_KEY_PREFIX}invoices`]: buildInvoicesState([]),
    [`${PERSIST_KEY_PREFIX}catalogs`]: buildCatalogsState(),
    [`${PERSIST_KEY_PREFIX}subscription`]: buildSubscriptionState('lite', null),
    [`${PERSIST_KEY_PREFIX}compras`]: buildComprasState(),
    // Google auth tokens — makes isAuthenticated true and idToken available
    // GoogleAuthService raw storage keys
    ...googleSessionEntries(),
  };

  await injectAndGoto(page, entries);
}

/**
 * Pro tier user whose subscription is past-due (N1CO Blocked status).
 * Tier stays paid (grace period) but the subscription carries
 * status='payment_failed' — the renderer shows the update-card banner.
 */
export async function seedProUserPastDue(page: Page): Promise<void> {
  const pastDueSubscription = {
    ...PRO_ACTIVE_SUBSCRIPTION,
    status: 'payment_failed',
  };
  const entries: Record<string, string> = {
    [`${PERSIST_KEY_PREFIX}auth`]: buildProAuthState(),
    [`${PERSIST_KEY_PREFIX}app`]: buildAppState(),
    [`${PERSIST_KEY_PREFIX}companies`]: buildCompaniesState([TEST_COMPANY]),
    [`${PERSIST_KEY_PREFIX}customers`]: buildCustomersState(SAMPLE_CUSTOMERS),
    [`${PERSIST_KEY_PREFIX}products`]: buildProductsState(SAMPLE_PRODUCTS),
    [`${PERSIST_KEY_PREFIX}invoices`]: buildInvoicesState(SAMPLE_INVOICES),
    [`${PERSIST_KEY_PREFIX}catalogs`]: buildCatalogsState(),
    [`${PERSIST_KEY_PREFIX}subscription`]: buildSubscriptionState('pro', pastDueSubscription),
    [`${PERSIST_KEY_PREFIX}compras`]: buildComprasState(),
    // GoogleAuthService raw storage keys
    ...googleSessionEntries(),
  };
  await injectAndGoto(page, entries);
}

/**
 * Seed an AdFree tier user WITH Google auth tokens. Use this when verifying
 * paid-tier features that ALSO require Google sign-in (Drive export, etc.).
 */
export async function seedAdFreeUserWithGoogleAuth(page: Page): Promise<void> {
  const entries: Record<string, string> = {
    [`${PERSIST_KEY_PREFIX}auth`]: buildProAuthState(),
    [`${PERSIST_KEY_PREFIX}app`]: buildAppState(),
    [`${PERSIST_KEY_PREFIX}companies`]: buildCompaniesState([TEST_COMPANY]),
    [`${PERSIST_KEY_PREFIX}customers`]: buildCustomersState(SAMPLE_CUSTOMERS),
    [`${PERSIST_KEY_PREFIX}products`]: buildProductsState(SAMPLE_PRODUCTS),
    [`${PERSIST_KEY_PREFIX}invoices`]: buildInvoicesState(SAMPLE_INVOICES),
    [`${PERSIST_KEY_PREFIX}catalogs`]: buildCatalogsState(),
    [`${PERSIST_KEY_PREFIX}subscription`]: buildSubscriptionState(
      'adfree',
      ADFREE_ACTIVE_SUBSCRIPTION,
    ),
    [`${PERSIST_KEY_PREFIX}compras`]: buildComprasState(),
    // GoogleAuthService raw storage keys
    ...googleSessionEntries(),
  };

  await injectAndGoto(page, entries);
}

/**
 * Seed a Pro ($7) tier user without Google Drive auth.
 * The app session remains authenticated so initializeSubscription does not
 * downgrade the persisted paid tier back to Lite on first paint.
 */
export async function seedAdFreeUserState(page: Page): Promise<void> {
  const entries: Record<string, string> = {
    [`${PERSIST_KEY_PREFIX}auth`]: buildProAuthState(),
    [`${PERSIST_KEY_PREFIX}app`]: buildAppState(),
    [`${PERSIST_KEY_PREFIX}companies`]: buildCompaniesState([TEST_COMPANY]),
    [`${PERSIST_KEY_PREFIX}customers`]: buildCustomersState(SAMPLE_CUSTOMERS),
    [`${PERSIST_KEY_PREFIX}products`]: buildProductsState(SAMPLE_PRODUCTS),
    [`${PERSIST_KEY_PREFIX}invoices`]: buildInvoicesState(SAMPLE_INVOICES),
    [`${PERSIST_KEY_PREFIX}catalogs`]: buildCatalogsState(),
    [`${PERSIST_KEY_PREFIX}subscription`]: buildSubscriptionState(
      'adfree',
      ADFREE_ACTIVE_SUBSCRIPTION,
    ),
    [`${PERSIST_KEY_PREFIX}compras`]: buildComprasState(),
  };

  await injectAndGoto(page, entries);
}

// ---------------------------------------------------------------------------
// Device Sync v2 (Pro+Sync)
// ---------------------------------------------------------------------------

export interface SyncV2TestOverrides {
  baseUrl: string;
  token: string;
  staggerMaxMs?: number;
  flushDebounceMs?: number;
}

/**
 * Seed an authenticated user on the given LOCAL tier plus an internal JWT
 * (`app_auth_token`, from POST /api/auth/login) so the startup account-entitlement
 * fetch (GET /api/v2/account/entitlements) actually runs. The legacy N1CO status
 * channel is routed to 503 — specs then fulfill the entitlement endpoint to prove a
 * purchase made on ANY platform unlocks this device through the account alone.
 */
export async function seedAccountEntitlementUser(
  page: Page,
  tier: 'lite' | 'adfree' | 'pro',
): Promise<void> {
  const entries: Record<string, string> = {
    [`${PERSIST_KEY_PREFIX}auth`]: buildProAuthState(),
    [`${PERSIST_KEY_PREFIX}app`]: buildAppState(),
    [`${PERSIST_KEY_PREFIX}companies`]: buildCompaniesState([TEST_COMPANY]),
    [`${PERSIST_KEY_PREFIX}customers`]: buildCustomersState(SAMPLE_CUSTOMERS),
    [`${PERSIST_KEY_PREFIX}products`]: buildProductsState(SAMPLE_PRODUCTS),
    [`${PERSIST_KEY_PREFIX}invoices`]: buildInvoicesState(SAMPLE_INVOICES),
    [`${PERSIST_KEY_PREFIX}catalogs`]: buildCatalogsState(),
    [`${PERSIST_KEY_PREFIX}subscription`]: buildSubscriptionState(tier, null),
    [`${PERSIST_KEY_PREFIX}compras`]: buildComprasState(),
    // GoogleAuthService raw storage keys
    ...googleSessionEntries(),
    'app_auth_token': 'playwright-internal-jwt',
  };
  await page.route('**/subscription/n1co/status**', (route) => route.fulfill({ status: 503, body: '' }));
  await injectAndGoto(page, entries);
}

/**
 * Seed an authenticated user on the given tier with Device Sync v2 pointed at a local
 * relay (`fs_sync_v2_test`, read by syncV2Environment). Pass `sync: null` to seed the
 * tier without any relay override (gating checks).
 */
export async function seedDeviceSyncUser(
  page: Page,
  tier: 'lite' | 'adfree' | 'pro' | 'pro_sync' | 'enterprise',
  sync: SyncV2TestOverrides | null,
): Promise<void> {
  const entries: Record<string, string> = {
    [`${PERSIST_KEY_PREFIX}auth`]: buildProAuthState(),
    [`${PERSIST_KEY_PREFIX}app`]: buildAppState(),
    [`${PERSIST_KEY_PREFIX}companies`]: buildCompaniesState([TEST_COMPANY]),
    [`${PERSIST_KEY_PREFIX}customers`]: buildCustomersState(SAMPLE_CUSTOMERS),
    [`${PERSIST_KEY_PREFIX}products`]: buildProductsState(SAMPLE_PRODUCTS),
    [`${PERSIST_KEY_PREFIX}invoices`]: buildInvoicesState(SAMPLE_INVOICES),
    [`${PERSIST_KEY_PREFIX}catalogs`]: buildCatalogsState(),
    [`${PERSIST_KEY_PREFIX}subscription`]: buildSubscriptionState(tier, null),
    [`${PERSIST_KEY_PREFIX}compras`]: buildComprasState(),
    // GoogleAuthService raw storage keys
    ...googleSessionEntries(),
  };
  if (sync) {
    entries.fs_sync_v2_test = JSON.stringify({ staggerMaxMs: 0, flushDebounceMs: 300, ...sync });
  }
  // Keep the seeded tier: the startup N1CO status check keeps the cached tier when the
  // backend is unreachable (initializeSubscription rejects without touching it).
  await page.route('**/subscription/n1co/status**', (route) => route.fulfill({ status: 503, body: '' }));
  await injectAndGoto(page, entries);
}

export interface PlanSeed {
  tier: 'lite' | 'adfree' | 'pro' | 'pro_sync' | 'enterprise';
  activeSubscription?: unknown;
  /** ISO end of a running free Pro+Sync trial (accountEntitlement.trialUntil). */
  trialUntil?: string;
}

/**
 * Seed a signed-in user on an exact plan state — tier, the N1CO subscription (or none) and an
 * optional free-trial end — and keep it: the startup N1CO status check answers 503 so the
 * persisted plan is what the screens render (no dependency on any backend's view of the
 * shared Playwright token).
 */
export async function seedPlanUser(page: Page, plan: PlanSeed): Promise<void> {
  const extra = plan.trialUntil
    ? {
        accountEntitlement: {
          canonicalTier: 'pro_sync',
          planTier: 'pro_sync',
          tier: 'pro_sync',
          status: 'trialing',
          planName: 'Prueba Pro+Sync',
          expiresAt: plan.trialUntil,
          trialUntil: plan.trialUntil,
          features: { sync: true, adFree: true, email: true },
          fetchedAt: new Date().toISOString(),
        },
      }
    : {};
  const entries: Record<string, string> = {
    [`${PERSIST_KEY_PREFIX}auth`]: buildProAuthState(),
    [`${PERSIST_KEY_PREFIX}app`]: buildAppState(),
    [`${PERSIST_KEY_PREFIX}companies`]: buildCompaniesState([TEST_COMPANY]),
    [`${PERSIST_KEY_PREFIX}customers`]: buildCustomersState(SAMPLE_CUSTOMERS),
    [`${PERSIST_KEY_PREFIX}products`]: buildProductsState(SAMPLE_PRODUCTS),
    [`${PERSIST_KEY_PREFIX}invoices`]: buildInvoicesState(SAMPLE_INVOICES),
    [`${PERSIST_KEY_PREFIX}catalogs`]: buildCatalogsState(),
    [`${PERSIST_KEY_PREFIX}subscription`]: buildSubscriptionState(plan.tier, plan.activeSubscription ?? null, extra),
    [`${PERSIST_KEY_PREFIX}compras`]: buildComprasState(),
    ...googleSessionEntries(),
  };
  await page.route('**/subscription/n1co/status**', (route) => route.fulfill({ status: 503, body: '' }));
  await injectAndGoto(page, entries);
}
