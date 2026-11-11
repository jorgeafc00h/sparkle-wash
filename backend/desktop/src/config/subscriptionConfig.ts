// Subscription & Ad configuration

export const SUBSCRIPTION_CONFIG = {
  // Google Play product IDs
  productIds: {
    adFreeMonthly: 'com.kandangalabs.facturassimples.adfree.monthly',
    proMonthly: 'com.kandangalabs.facturassimples.pro.monthly',
  },

  // Apple App Store product IDs (must match App Store Connect exactly)
  appleProductIds: {
    adFreeMonthly: 'com.kandangalabs.App.plus_ad_free_monthly',
    proMonthly: 'com.kandangalabs.App.enterprise_pro_unlimited_monthly',
    proYearly: 'com.kandangalabs.App.enterprise_pro_unlimited_anual',
  },

  // Prices (display only — actual prices come from store).
  //
  // Desktop tier strategy (2026-Q2 rework):
  //   Free      — 10 invoices/month, watermark, no email, 1 company.
  //   Pro       — $7/mo:  unlimited invoices, MH sync, email, PDF, Libros IVA, Drive.
  //   Business  — $14/mo: everything + multi-empresa, priority support.
  //
  // We reuse the existing SubscriptionTier enum for DB stability:
  //   Lite   → "Free" (display label only)
  //   AdFree → "Pro"       ($7)
  //   Pro    → "Business"  ($14)
  displayPrices: {
    adFreeMonthly: '$7.00',
    proMonthly: '$14.00',
  },

  // N1CO product IDs (Windows/Electron)
  n1coProductIds: {
    adFreeMonthly: 'n1co.facturassimples.pro.monthly',       // ‘Pro’ tier ($7)
    proMonthly: 'n1co.facturassimples.business.monthly',     // ‘Business’ tier ($14)
  },

  // N1CO plan config (created on backend, these are display-only)
  n1coPlans: {
    adFree:  { name: 'Pro',      amount:  7.00, billingCycleType: 'Month' },
    pro:     { name: 'Business', amount: 14.00, billingCycleType: 'Month' },
  },

  // Free tier usage limits (enforced in the UI)
  freeTierLimits: {
    invoicesPerMonth: 10,
    maxCompanies: 1,
  },

  // Azure backend endpoints
  receiptValidationEndpoint: '/subscription/validate',

  // N1CO subscription endpoints (proxied through Azure backend)
  n1coEndpoints: {
    createPaymentMethod: '/subscription/n1co/payment-method',
    subscribe: '/subscription/n1co/subscribe',
    cancel: '/subscription/n1co/cancel',
    status: '/subscription/n1co/status',
  },
};

export const AD_CONFIG = {
  // Google AdMob ad unit IDs
  android: {
    banner: 'ca-app-pub-0726149070503281/3356766660',
    interstitial: 'ca-app-pub-0726149070503281/4169822322',
    rewardedInterstitial: 'ca-app-pub-0726149070503281/8859044162',
    nativeAdvanced: 'ca-app-pub-0726149070503281/6090741219',
    // Google test ad unit IDs for development
    bannerTest: 'ca-app-pub-3940256099942544/6300978111',
    interstitialTest: 'ca-app-pub-3940256099942544/1033173712',
    rewardedInterstitialTest: 'ca-app-pub-3940256099942544/5224354917',
  },
  ios: {
    banner: 'ca-app-pub-XXXXXXXXXXXXXXXX/YYYYYYYYYY', // Replace with real iOS ID
    interstitial: 'ca-app-pub-XXXXXXXXXXXXXXXX/YYYYYYYYYY', // Replace with real iOS ID
    rewardedInterstitial: 'ca-app-pub-XXXXXXXXXXXXXXXX/YYYYYYYYYY', // Replace with real iOS rewarded interstitial ID
    bannerTest: 'ca-app-pub-3940256099942544/2934735716',
    interstitialTest: 'ca-app-pub-3940256099942544/4411468910',
    rewardedInterstitialTest: 'ca-app-pub-3940256099942544/5224354917',
  },

  // AdMob app IDs (configured in app.json)
  appId: {
    android: 'ca-app-pub-0726149070503281~1963793945',
    ios: 'ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY', // Replace with real iOS app ID
  },

  // ─── Desktop Rewarded Ads (Windows/web only) ───────────────────────────────
  // Strategy: while a free-tier user's invoice is being processed, the desktop
  // app shows the landing page in an iframe for ~35 seconds. The landing page
  // hosts AdSense ad units (policy-compliant: ads are served from the approved
  // web domain, not from within the native shell directly).
  //
  // IMPORTANT: Set DESKTOP_REWARDED_ADS_ENABLED = true only when:
  //   1. The AdSense slot ID has been created and wired (REACT_APP_ADSENSE_REWARDED_SLOT env var).
  //   2. The landing page is deployed with the /embed/rewarded route live.
  //   3. QA has verified the iframe loads without X-Frame-Options errors.
  //
  // To flip the feature on: change DESKTOP_REWARDED_ADS_ENABLED to true and redeploy.
  desktop: {
    // Master feature flag — ships as false for safety. Flip to true to launch.
    DESKTOP_REWARDED_ADS_ENABLED: false,

    // How long (ms) the rewarded modal stays open regardless of DTE processing time.
    // 35 seconds is the product-owner-specified reward window.
    DESKTOP_REWARDED_DURATION_MS: 35000,

    // URL of the lightweight embed page on the landing site.
    // TODO: Replace with the real deployed URL once confirmed.
    // Expected format: https://facturassimples.com/embed/rewarded
    DESKTOP_AD_LANDING_URL: 'https://facturassimples.com/embed/rewarded',
  },
};
