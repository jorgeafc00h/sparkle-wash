// Subscription selectors

import { createSelector } from '@reduxjs/toolkit';
import { RootState } from '../index';
import { SubscriptionTier } from '../../services/subscription/SubscriptionTypes';

// Base selector
export const selectSubscription = (state: RootState) => state.subscription;

export const selectCurrentTier = createSelector(
  [selectSubscription],
  (subscription) => subscription.tier
);

export const selectIsSubscriptionInitialized = createSelector(
  [selectSubscription],
  (subscription) => subscription.isInitialized
);

export const selectSubscriptionLoading = createSelector(
  [selectSubscription],
  (subscription) => subscription.loading
);

export const selectSubscriptionError = createSelector(
  [selectSubscription],
  (subscription) => subscription.error
);

export const selectAvailableProducts = createSelector(
  [selectSubscription],
  (subscription) => subscription.availableProducts
);

export const selectActiveSubscription = createSelector(
  [selectSubscription],
  (subscription) => subscription.activeSubscription
);

export const selectPurchaseInProgress = createSelector(
  [selectSubscription],
  (subscription) => subscription.purchaseInProgress
);

// Tier check selectors
export const selectIsLite = createSelector(
  [selectCurrentTier],
  (tier) => tier === SubscriptionTier.Lite
);

export const selectIsAdFree = createSelector(
  [selectCurrentTier],
  (tier) => tier === SubscriptionTier.AdFree
);

export const selectIsPro = createSelector(
  [selectCurrentTier],
  (tier) =>
    tier === SubscriptionTier.Pro ||
    tier === SubscriptionTier.ProSync ||
    tier === SubscriptionTier.Enterprise
);

/**
 * Determines if an ad should be shown before sync.
 * Ads ONLY show when: tier === 'lite' AND env === 'production' AND !isUITesting
 *
 * Usage: pass environment and isUITesting from app state.
 * This selector only checks the tier part — use shouldShowAd() from FeatureGate
 * for the full check including env and UITesting flags.
 */
export const selectIsAdEligible = createSelector(
  [selectCurrentTier],
  (tier) => tier === SubscriptionTier.Lite
);
