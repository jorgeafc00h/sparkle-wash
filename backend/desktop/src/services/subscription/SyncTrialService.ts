// Free 1-month Device Sync trial — client for POST /api/auth/sync-trial.
//
// The SERVER owns the trial: it grants `pro_sync` for 60 days (2 months) on 200, answers
// 409 when the account already used the trial or holds a subscription, and 401
// when the internal JWT is missing/expired. The relay keeps enforcing the REAL
// gate through the JWT tier claim — nothing here bypasses it; this client only
// surfaces the server's answer and refreshes the local entitlement on success.
//
// The request seam (`SyncTrialRequestor`) is injectable so tests mock the
// transport; the default is the global fetch, mirroring AuthProviderService.
// Tokens are NEVER logged.

import { API_CONFIG, getApiConfig } from '../../config/api';
import { isViteProduction } from '@/config/viteEnv';
import AuthProviderService from '../auth/AuthProviderService';
import { canUseDeviceSync } from './FeatureGate';
import { SubscriptionTier } from './SubscriptionTypes';

/** Length of the free trial, in days — only a display fallback when the server
 *  omits trialUntil (the contract always returns it today). */
export const SYNC_TRIAL_DAYS = 60;

/** What the 60-day trial unlocks — it grants Pro+Sync, so EVERY paid gate opens. */
export const TRIAL_INCLUDES = [
  'Libros de IVA (anexos F-07)',
  'Exportación JSON y PDF por lote',
  'Respaldo en Google Drive',
  'Envío de DTE por correo',
  'Consolidación de tickets POS',
  'Sincronización entre dispositivos',
];

export type SyncTrialStartResult =
  | {
      kind: 'started';
      tier: SubscriptionTier;
      trialUntil: string;
      /**
       * Re-minted internal JWT the server returns alongside the grant (additive,
       * e7616ce): its `tier` claim is already pro_sync, so replacing the login-time
       * token lets the relay authorize the trial immediately. Absent on older
       * servers — best-effort, never fails the trial.
       */
      internalJwt?: string;
    }
  | { kind: 'already-used' }
  | { kind: 'unauthenticated' }
  | { kind: 'unavailable' };

interface SyncTrialResponseBody {
  tier?: string;
  trialUntil?: string;
  alreadyUsed?: boolean;
  internalJwt?: string;
}

/** Minimal Response shape the service needs — injectable for tests. */
export interface SyncTrialRequestor {
  (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ): Promise<{ status: number; json(): Promise<unknown> }>;
}

const defaultRequestor: SyncTrialRequestor = (url, init) => fetch(url, init);

function syncTrialUrl(): string {
  // getApiConfig().baseUrl ends in /api → POST {API}/api/auth/sync-trial.
  return `${getApiConfig(isViteProduction()).baseUrl}/auth/sync-trial`;
}

/** Defensive tier mapping: canonical value is pro_sync; tolerate case/spelling. */
function normalizeTrialTier(raw: unknown): SubscriptionTier {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return value === 'enterprise' ? SubscriptionTier.Enterprise : SubscriptionTier.ProSync;
}

/** Defensive trialUntil: trust the server's ISO, fall back to now+30d. */
function normalizeTrialUntil(raw: unknown): string {
  if (typeof raw === 'string' && Number.isFinite(Date.parse(raw))) return raw;
  return new Date(Date.now() + SYNC_TRIAL_DAYS * 86_400_000).toISOString();
}

/** Defensive internalJwt: only a non-empty string counts (additive, e7616ce). */
function normalizeInternalJwt(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() ? raw : undefined;
}

/** Starts the free 1-month sync trial for the signed-in account. */
export async function startSyncTrial(
  requestor: SyncTrialRequestor = defaultRequestor,
): Promise<SyncTrialStartResult> {
  let token: string | null = null;
  try {
    token = await AuthProviderService.getFreshToken();
  } catch {
    token = null;
  }
  if (!token) return { kind: 'unauthenticated' };

  try {
    const response = await requestor(syncTrialUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apiKey': API_CONFIG.apiKey,
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });

    if (response.status === 401 || response.status === 403) return { kind: 'unauthenticated' };
    if (response.status === 409) return { kind: 'already-used' };
    if (response.status < 200 || response.status >= 300) return { kind: 'unavailable' };

    const body = (await response.json().catch(() => ({}))) as SyncTrialResponseBody;
    if (body.alreadyUsed === true) return { kind: 'already-used' };
    return {
      kind: 'started',
      tier: normalizeTrialTier(body.tier),
      trialUntil: normalizeTrialUntil(body.trialUntil),
      internalJwt: normalizeInternalJwt(body.internalJwt),
    };
  } catch {
    // Network failure / DNS / timeout — the trial state is server-owned; retry later.
    return { kind: 'unavailable' };
  }
}

// ── UI gating (pure — unit-tested) ─────────────────────────────────────────

/** Whole days left in the trial, or null when there is none / it expired. */
export function trialRemainingDays(
  trialUntil: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!trialUntil) return null;
  const end = Date.parse(trialUntil);
  if (!Number.isFinite(end)) return null;
  const msLeft = end - now.getTime();
  if (msLeft <= 0) return null;
  return Math.max(1, Math.ceil(msLeft / 86_400_000));
}

export interface SyncTrialViewInput {
  tier: SubscriptionTier;
  /** subscription.accountEntitlement?.trialUntil */
  trialUntil?: string | null;
  /** Set when the server answered 409 (trial consumed / subscription held). */
  syncTrialUsed: boolean;
  now?: Date;
}

export interface SyncTrialView {
  /** Locked panel: show "Iniciar prueba gratis de 2 meses". A signed-out user
   *  still sees it — the click routes to sign-in (like the upgrade path). */
  showOffer: boolean;
  /** Locked panel: show "Ya usaste tu prueba gratis" (offer hidden). */
  showUsed: boolean;
  /** Unlocked panel: "Prueba gratis: N días restantes" while the trial runs. */
  remainingDays: number | null;
}

/**
 * What the Sincronización page shows. The offer only appears for a tier that
 * cannot sync yet (the relay/server grants the rest); an active or expired
 * trial counts as consumed.
 */
export function resolveSyncTrialView(input: SyncTrialViewInput): SyncTrialView {
  const remaining = trialRemainingDays(input.trialUntil, input.now ?? new Date());
  const trialActive = remaining !== null;
  const trialConsumed = !!input.trialUntil && !trialActive;
  const alreadyUsed = input.syncTrialUsed || trialConsumed;
  const lockedForSync = !canUseDeviceSync(input.tier);

  return {
    showOffer: lockedForSync && !trialActive && !alreadyUsed,
    showUsed: lockedForSync && !trialActive && alreadyUsed,
    remainingDays: trialActive ? remaining : null,
  };
}
