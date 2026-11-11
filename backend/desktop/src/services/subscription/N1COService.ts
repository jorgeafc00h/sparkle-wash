// N1CO Subscription Service for Desktop (Windows)
// Calls Azure API proxy endpoints for payment processing

import axios from 'axios';
import { getApiConfig, API_CONFIG } from '../../config/api';
import { getViteEnv, isViteProduction } from '@/config/viteEnv';
import { SubscriptionTier, SubscriptionProduct, ActiveSubscription } from './SubscriptionTypes';
import { ThreeDSChallenge, type ThreeDSResult } from './ThreeDSChallenge';

export class N1COAuthError extends Error {
  constructor() {
    super('Debes iniciar sesión antes de suscribirte');
    this.name = 'N1COAuthError';
  }
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface N1COCardData {
  cardNumber: string;
  cardholderName: string;
  expiryMonth: string;
  expiryYear: string;
  cvv: string;
}

export interface N1COCustomerData {
  email: string;
  name: string;
  phone?: string;
}

// Matches the shape returned by Invoices.Api SubscribeEndpoint:
//   { status, subscriptionId, authUrl, authId, tier, error? }
// where status ∈ 'SUCCEEDED' | 'AUTHENTICATION_REQUIRED' | 'FAILED'.
export interface N1COSubscriptionResult {
  subscriptionId?: string | number;
  customerId?: string;
  tier: SubscriptionTier;
  status: 'SUCCEEDED' | 'AUTHENTICATION_REQUIRED' | 'FAILED' | string;
  nextBillingDate?: string;
  authUrl?: string;
  authId?: string;
  error?: string;
}

export interface N1COPlan {
  name: string;
  amount: number;
  billingCycleType: string;
}

export interface N1COThreeDSConfirmationContext {
  tier: SubscriptionTier;
  paymentMethodId: string;
  customer: N1COCustomerData;
  previousSubscriptionId?: string;
}

export interface ActiveSubscriptionStatus {
  tier: SubscriptionTier;
  activeSubscription: ActiveSubscription | null;
}

const SUBSCRIPTION_STATUS_POLL_OPTIONS = {
  maxAttempts: 15,
  delayMs: 2000,
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────

function isProduction(): boolean {
  // viteEnv seam (not raw import.meta) so Jest can transform this module.
  return isViteProduction();
}

function getBaseUrl(): string {
  return getApiConfig(isProduction()).baseUrl;
}

function getN1COBaseUrl(): string {
  if (getViteEnv().DEV) {
    // Vite proxies /subscription/* to the dev backend in browser/Electron dev.
    // This keeps Playwright and localhost renderer sessions out of Azure CORS.
    return '';
  }
  return getBaseUrl().replace(/\/api\/?$/, '');
}

function getHeaders(idToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'apiKey': API_CONFIG.apiKey,
    'Authorization': `Bearer ${idToken}`,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Normalizes a tier string coming from the backend to the lowercase enum.
 * /subscription/activate-key returns Pascal-cased tiers ("Lite"/"AdFree"/"Pro")
 * while every other endpoint uses the lowercase enum values ("lite"/"adfree"/
 * "pro"). Storing the raw value silently broke every FeatureGate comparison,
 * so an activated paid key granted nothing. Unknown values fall back to Lite.
 */
function normalizeTier(raw: unknown): SubscriptionTier {
  const value = String(raw ?? '').toLowerCase();
  if (
    value === SubscriptionTier.AdFree ||
    value === SubscriptionTier.Pro ||
    // Canonical v2 tiers must survive this mapping — collapsing them to Lite
    // silently demoted a Pro+Sync/Enterprise subscriber on every checkStatus.
    value === SubscriptionTier.ProSync ||
    value === SubscriptionTier.Enterprise
  ) {
    return value;
  }
  return SubscriptionTier.Lite;
}

// ── Product catalogue ─────────────────────────────────────────────────────

const N1CO_PRODUCTS: SubscriptionProduct[] = [
  {
    // Maps to SubscriptionTier.AdFree enum (display label = "Pro")
    productId: 'n1co.facturassimples.pro.monthly',
    title: 'Pro Mensual',
    description: 'Facturas ilimitadas, hasta 2 empresas, envío por correo, exportación a Drive',
    price: '7.00',
    currency: 'USD',
    localizedPrice: '$7.00/mes',
  },
  {
    // Maps to SubscriptionTier.Pro enum (display label = "Business")
    productId: 'n1co.facturassimples.business.monthly',
    title: 'Business Mensual',
    description: 'Empresas ilimitadas, Libros IVA, sincronización en la nube, soporte prioritario',
    price: '14.00',
    currency: 'USD',
    localizedPrice: '$14.00/mes',
  },
];

// ── Service ───────────────────────────────────────────────────────────────

const N1COService = {
  /**
   * Tokenizes a card via N1CO through the Azure API proxy.
   * Returns a payment method ID (token).
   */
  async tokenizeCard(cardData: N1COCardData, customer: N1COCustomerData, idToken: string): Promise<string> {
    try {
      // Backend (CreatePaymentMethodEndpoint) returns one of:
      //   { paymentMethodId, customerId? }  on success
      //   { status: 'FAILED', error }       on failure
      const resp = await axios.post<{
        paymentMethodId?: string;
        id?: string;
        status?: string;
        error?: string;
      }>(
        `${getN1COBaseUrl()}/subscription/n1co/payment-method`,
        {
          card: {
            number: cardData.cardNumber,
            cardHolder: cardData.cardholderName,
            expirationMonth: cardData.expiryMonth,
            expirationYear: cardData.expiryYear,
            cvv: cardData.cvv,
            // Required by N1CO for subscriptions / saved cards.
            singleUse: false,
          },
          customer: {
            name: customer.name,
            email: customer.email,
            phoneNumber: customer.phone ?? '',
          },
        },
        { headers: getHeaders(idToken), timeout: API_CONFIG.timeout },
      );
      if (resp.data.status === 'FAILED') {
        throw new Error(resp.data.error || 'No se pudo registrar la tarjeta');
      }
      const id = resp.data.paymentMethodId ?? resp.data.id;
      if (!id) throw new Error('No se obtuvo identificador de método de pago de N1CO');
      return id;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.data?.message) {
        throw new Error(error.response.data.message);
      }
      throw error;
    }
  },

  async createSubscription(
    tier: SubscriptionTier,
    paymentMethodId: string,
    customer: N1COCustomerData,
    plan: N1COPlan,
    idToken: string,
  ): Promise<N1COSubscriptionResult> {
    try {
      // Idempotency-Key dedups retries on the backend. Tying the key to
      // (paymentMethodId, tier) means a network-retry of the same intent is
      // safe, but a fresh card (new paymentMethodId) is treated as a new
      // purchase. Backend must honor the header for this to take effect.
      const idempotencyKey = `${paymentMethodId}:${tier}`;
      const resp = await axios.post<N1COSubscriptionResult>(
        `${getN1COBaseUrl()}/subscription/n1co/subscribe`,
        {
          tier,
          paymentMethodId,
          customer,
          planName: plan.name,
          planAmount: plan.amount,
          billingCycleType: plan.billingCycleType,
        },
        {
          headers: { ...getHeaders(idToken), 'Idempotency-Key': idempotencyKey },
          timeout: API_CONFIG.timeout,
        },
      );
      return resp.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.data?.message) {
        throw new Error(error.response.data.message);
      }
      throw error;
    }
  },

  async confirm3DS(
    authenticationId: string,
    idToken: string,
    context?: N1COThreeDSConfirmationContext,
  ): Promise<N1COSubscriptionResult> {
    try {
      const resp = await axios.post<N1COSubscriptionResult>(
        `${getN1COBaseUrl()}/subscription/n1co/confirm-3ds`,
        { authenticationId, ...context },
        { headers: getHeaders(idToken), timeout: API_CONFIG.timeout },
      );
      return resp.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.data?.message) {
        throw new Error(error.response.data.message);
      }
      throw error;
    }
  },

  /**
   * Returns the user's subscription tier from the backend, or `null` when the
   * call fails. Callers MUST treat `null` as "unknown" — never as Lite —
   * otherwise a transient outage would silently downgrade a Pro user.
   */
  async checkStatus(idToken: string): Promise<ActiveSubscriptionStatus | null> {
    try {
      const resp = await axios.get<{
        tier: SubscriptionTier;
        status?: string;
        subscription: ActiveSubscription | null;
      }>(
        `${getN1COBaseUrl()}/subscription/n1co/status`,
        { headers: getHeaders(idToken), timeout: API_CONFIG.timeout },
      );
      const subscription = resp.data.subscription
        ? {
            ...resp.data.subscription,
            status: resp.data.subscription.status ?? resp.data.status,
          }
        : null;
      return {
        tier: normalizeTier(resp.data.tier),
        activeSubscription: subscription,
      };
    } catch {
      return null;
    }
  },

  async cancelSubscription(idToken: string): Promise<void> {
    const resp = await axios.post<{ status?: string; error?: string }>(
      `${getN1COBaseUrl()}/subscription/n1co/cancel`,
      {},
      { headers: getHeaders(idToken), timeout: API_CONFIG.timeout },
    );
    if (resp.data.status === 'FAILED') {
      throw new Error(resp.data.error || 'No se pudo cancelar la suscripción');
    }
  },

  /**
   * Replaces the card on the user's current subscription.
   * Backend cancels the old subscription and creates a new one with the new
   * card. May return AUTHENTICATION_REQUIRED if 3DS is needed on the new card.
   */
  async changePaymentMethod(
    cardData: N1COCardData,
    idToken: string,
  ): Promise<N1COSubscriptionResult> {
    const resp = await axios.post<N1COSubscriptionResult & { error?: string }>(
      `${getN1COBaseUrl()}/subscription/n1co/change-payment-method`,
      {
        card: {
          number: cardData.cardNumber,
          cardHolder: cardData.cardholderName,
          expirationMonth: cardData.expiryMonth,
          expirationYear: cardData.expiryYear,
          cvv: cardData.cvv,
        },
      },
      { headers: getHeaders(idToken), timeout: API_CONFIG.timeout },
    );
    if (resp.data.status === 'FAILED') {
      throw new Error(resp.data.error || 'No se pudo actualizar el método de pago');
    }
    return resp.data;
  },

  async activateKey(key: string, idToken: string): Promise<{ valid: boolean; tier: SubscriptionTier }> {
    const resp = await axios.post<{ valid: boolean; tier: SubscriptionTier }>(
      `${getN1COBaseUrl()}/subscription/activate-key`,
      { key },
      { headers: getHeaders(idToken), timeout: API_CONFIG.timeout },
    );
    // Backend returns Pascal-cased tiers here — normalizeTier maps them onto
    // the lowercase enum (see its doc comment).
    return { valid: resp.data.valid, tier: normalizeTier(resp.data.tier) };
  },

  /**
   * Polls `/subscription/n1co/status` until the backend reports the expected
   * tier or `maxAttempts` is exhausted. Use this as the authoritative check
   * after 3DS auth — popup URL detection is heuristic and can miss success.
   */
  async pollUntilTier(
    idToken: string,
    targetTier: SubscriptionTier,
    options: { maxAttempts?: number; delayMs?: number } = {},
  ): Promise<ActiveSubscriptionStatus | null> {
    const maxAttempts = options.maxAttempts ?? SUBSCRIPTION_STATUS_POLL_OPTIONS.maxAttempts;
    const delayMs = options.delayMs ?? SUBSCRIPTION_STATUS_POLL_OPTIONS.delayMs;
    for (let i = 0; i < maxAttempts; i++) {
      const status = await N1COService.checkStatus(idToken);
      if (status && status.tier === targetTier) return status;
      if (i < maxAttempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
    return null;
  },

  async pollUntilActiveTier(
    idToken: string,
    targetTier: SubscriptionTier,
    options: { maxAttempts?: number; delayMs?: number } = {},
  ): Promise<ActiveSubscriptionStatus | null> {
    const maxAttempts = options.maxAttempts ?? SUBSCRIPTION_STATUS_POLL_OPTIONS.maxAttempts;
    const delayMs = options.delayMs ?? SUBSCRIPTION_STATUS_POLL_OPTIONS.delayMs;
    for (let i = 0; i < maxAttempts; i++) {
      const status = await N1COService.checkStatus(idToken);
      const activeStatus = status?.activeSubscription?.status;
      const isActive = !activeStatus || activeStatus === 'active';
      if (status?.tier === targetTier && status.activeSubscription && isActive) {
        return status;
      }
      if (i < maxAttempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
    return null;
  },

  async pollUntilActiveSubscription(
    idToken: string,
    targetTier: SubscriptionTier,
    subscriptionId: string | number,
    options: { maxAttempts?: number; delayMs?: number } = {},
  ): Promise<ActiveSubscriptionStatus | null> {
    const maxAttempts = options.maxAttempts ?? SUBSCRIPTION_STATUS_POLL_OPTIONS.maxAttempts;
    const delayMs = options.delayMs ?? SUBSCRIPTION_STATUS_POLL_OPTIONS.delayMs;
    const expectedId = String(subscriptionId);
    for (let i = 0; i < maxAttempts; i++) {
      const status = await N1COService.checkStatus(idToken);
      const active = status?.activeSubscription;
      const activeStatus = active?.status;
      const isActive = !activeStatus || activeStatus === 'active';
      if (
        status?.tier === targetTier &&
        active &&
        isActive &&
        String(active.n1coSubscriptionId ?? active.transactionId) === expectedId
      ) {
        return status;
      }
      if (i < maxAttempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
    return null;
  },

  /**
   * Handles 3DS authentication.
   *
   * Implementation: opens the N1CO 3DS URL in an iframe (via the
   * ThreeDSChallengeModal mounted at the App root) and listens for
   * `authentication.complete` postMessage from `https://front-3ds.n1co.com`.
   * This matches N1CO's documented integration pattern.
   *
   * Returns the raw N1CO 3DS completion payload so callers can forward the
   * `authenticationId` back to the backend for the second subscription call.
   */
  async handle3DS(authUrl: string): Promise<ThreeDSResult> {
    return ThreeDSChallenge.open(authUrl);
  },

  /**
   * Returns the list of available N1CO subscription products.
   */
  getAvailableProducts(): SubscriptionProduct[] {
    return N1CO_PRODUCTS;
  },
};

export default N1COService;
