// Feature gate — checks feature availability per tier + environment
// Desktop adaptation: Platform.OS is always 'web'; AD_CONFIG imported from config

import { SubscriptionTier } from './SubscriptionTypes';
import { AD_CONFIG, SUBSCRIPTION_CONFIG } from '../../config/subscriptionConfig';

/**
 * Forced rewarded video — user MUST watch full video to sync or export.
 * Active ONLY in production + Lite tier + not UITesting.
 * CRITICAL: Never permanently block user if ad fails — use fallback.
 */
export const shouldShowAd = (
  tier: SubscriptionTier,
  environment: 'production' | 'development',
  isUITesting: boolean
): boolean => {
  return tier === SubscriptionTier.Lite && environment === 'production' && !isUITesting;
};

export const requiresVideoAdForSync = (
  tier: SubscriptionTier,
  environment: 'production' | 'development',
  isUITesting: boolean
): boolean => {
  return tier === SubscriptionTier.Lite && environment === 'production' && !isUITesting;
};

export const requiresVideoAdForExport = (
  tier: SubscriptionTier,
  environment: 'production' | 'development',
  isUITesting: boolean
): boolean => {
  return tier === SubscriptionTier.Lite && environment === 'production' && !isUITesting;
};

/** Azure cloud backup — paid tiers only (Pro $7 or Business $14) */
/**
 * Every paid tier (Pro $7 = AdFree enum, Business $14 = Pro enum, and the canonical v2
 * Pro+Sync / Enterprise supersets) unlocks the paid feature set.
 */
export const isPaidTier = (tier: SubscriptionTier | undefined): boolean =>
  tier === SubscriptionTier.AdFree ||
  tier === SubscriptionTier.Pro ||
  tier === SubscriptionTier.ProSync ||
  tier === SubscriptionTier.Enterprise;

/**
 * Device Sync v2 (same-owner multi-device) — Pro+Sync and Enterprise ONLY. Plain paid
 * tiers do not sync; the relay enforces the same rule on the JWT `tier` claim, and this
 * gate keeps other tiers from generating any sync traffic.
 */
export const canUseDeviceSync = (tier: SubscriptionTier | string | undefined | null): boolean =>
  tier === SubscriptionTier.ProSync || tier === SubscriptionTier.Enterprise;

export const canUseAzureSync = (tier: SubscriptionTier): boolean => {
  return isPaidTier(tier);
};

/**
 * Email PDF to customer — Pro or Business only (Free tier is blocked).
 * AdFree enum = "Pro" ($7), Pro enum = "Business" ($14). Both can send.
 */
export const canSendEmail = (tier: SubscriptionTier): boolean => {
  return isPaidTier(tier);
};

/** Send email via device's native email client — ALL tiers */
export const canSendEmailViaClient = (_tier: SubscriptionTier): boolean => {
  return true;
};

/** Export to JSON/Google Drive — paid tiers only */
export const canExport = (tier: SubscriptionTier): boolean => {
  return isPaidTier(tier);
};

/**
 * Max companies per tier.
 *   Free (Lite enum):     1
 *   Pro ($7, AdFree enum): 2
 *   Business ($14, Pro):   Infinity
 * AdFree = 2 matches what the landing page sells ("Sin Publicidad … hasta 2
 * empresas", FAQ.js / Documentation.js); CLAUDE.md's old "3" was stale and
 * was corrected 2026-10-31.
 */
export const getMaxCompanies = (tier: SubscriptionTier): number => {
  switch (tier) {
    case SubscriptionTier.Lite:    return SUBSCRIPTION_CONFIG.freeTierLimits.maxCompanies;
    // AGENTS.md subscription tiers: AdFree = 2 companies (was drifted to 3).
    case SubscriptionTier.AdFree:  return 2;
    case SubscriptionTier.Pro:
    case SubscriptionTier.ProSync:
    case SubscriptionTier.Enterprise:
      return Infinity;
  }
};

/**
 * Monthly invoice creation limit for the Free tier.
 * Returns Infinity for paid tiers and for test (Pruebas) companies: the
 * production-access wizard alone mints dozens of test DTEs per type, so
 * counting them would lock a new Free user out of practising right away.
 */
export const getMaxInvoicesPerMonth = (
  tier: SubscriptionTier,
  isProductionCompany: boolean = true,
): number => {
  return tier === SubscriptionTier.Lite && isProductionCompany
    ? SUBSCRIPTION_CONFIG.freeTierLimits.invoicesPerMonth
    : Infinity;
};

/** Check if the user is within the Free-tier monthly invoice cap. */
export const canCreateInvoice = (
  tier: SubscriptionTier,
  invoicesThisMonth: number,
  isProductionCompany: boolean = true,
): boolean => {
  return invoicesThisMonth < getMaxInvoicesPerMonth(tier, isProductionCompany);
};

/** PDF watermark: removed — free tier shows a site link under the logo instead. */
export const requiresPdfWatermark = (_tier: SubscriptionTier): boolean => {
  return false;
};

/**
 * Free tier MUST display the Facturas Simples app logo on PDFs (regardless of
 * any company-uploaded logo). This enforces the same branding rule as the
 * "Versión Gratis" watermark — Lite users get full DTE functionality but the
 * generated documents are visibly attributed to Facturas Simples until the
 * customer upgrades to a paid plan. Paid tiers (AdFree, Pro) get to use their
 * own uploaded logo (with the app logo as fallback when none is uploaded).
 */
export const requiresAppLogoOnPdf = (tier: SubscriptionTier): boolean => {
  return tier === SubscriptionTier.Lite;
};

/** Check if user can create another company */
export const canCreateCompany = (tier: SubscriptionTier, currentCompanyCount: number): boolean => {
  return currentCompanyCount < getMaxCompanies(tier);
};

/** Compras is FREE in all tiers */
export const canUseCompras = (_tier: SubscriptionTier): boolean => {
  return true;
};

/** Get app branding name per tier */
export const getAppBranding = (tier: SubscriptionTier): string => {
  switch (tier) {
    case SubscriptionTier.Lite:    return 'Facturas Simples Lite';
    case SubscriptionTier.AdFree:  return 'Facturas Simples';
    case SubscriptionTier.Pro:     return 'Facturas Simples Pro';
    case SubscriptionTier.ProSync: return 'Facturas Simples Pro+Sync';
    case SubscriptionTier.Enterprise: return 'Facturas Simples Enterprise';
  }
};

/** Excel export of invoices — available for ALL tiers */
export const canExportExcel = (_tier: SubscriptionTier): boolean => {
  return true;
};

export const requiresVideoAdForExcelExport = (
  tier: SubscriptionTier,
  environment: 'production' | 'development',
  isUITesting: boolean
): boolean => {
  return tier === SubscriptionTier.Lite && environment === 'production' && !isUITesting;
};

/** Batch PDF export of multiple invoices — paid tiers only */
export const canBatchExportPDF = (tier: SubscriptionTier): boolean => {
  return isPaidTier(tier);
};

/** Upload exports to Google Drive — paid tiers only */
export const canUploadToDrive = (tier: SubscriptionTier): boolean => {
  return isPaidTier(tier);
};

/**
 * Libros IVA (MH F-07 annex export) — Pro ($7) and Business ($14) tiers.
 * Per the 2026-Q2 tier spec in subscriptionConfig.ts:19-27.
 */
export const canUseLibrosIVA = (tier: SubscriptionTier): boolean => {
  return isPaidTier(tier);
};

/**
 * POS consolidation wizard (many tickets → one DTE) — paid tiers. The POS
 * register itself (selling, printing, X/Z cierre) stays free: it is the
 * daily-engagement hook. See openspec/changes/add-pos-tickets §7.
 */
export const canUsePosConsolidation = (tier: SubscriptionTier): boolean => {
  return isPaidTier(tier);
};

/**
 * Desktop rewarded-ad wait gate.
 * On desktop (web), always Platform.OS === 'web' — no RN Platform import needed.
 */
export const requiresDesktopAdWait = (
  tier: SubscriptionTier,
  environment: 'production' | 'development',
  isUITesting: boolean
): boolean => {
  return (
    tier === SubscriptionTier.Lite &&
    environment === 'production' &&
    !isUITesting &&
    AD_CONFIG.desktop.DESKTOP_REWARDED_ADS_ENABLED
  );
};
