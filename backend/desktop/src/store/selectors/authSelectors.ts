// Auth selectors for accessing auth state

import { createSelector } from '@reduxjs/toolkit';
import { RootState } from '../index';

// Base selectors
export const selectAuth = (state: RootState) => state.auth;

// Derived selectors
export const selectIsAuthenticated = createSelector(
  [selectAuth],
  (auth) => auth.isAuthenticated
);

export const selectIsGuestMode = createSelector(
  [selectAuth],
  (auth) => auth.isGuestMode
);

export const selectCurrentUser = createSelector(
  [selectAuth],
  (auth) => auth.user
);

export const selectAuthLoading = createSelector(
  [selectAuth],
  (auth) => auth.loading
);

export const selectAuthError = createSelector(
  [selectAuth],
  (auth) => auth.error
);

export const selectAuthToken = createSelector(
  [selectAuth],
  (auth) => auth.token
);

export const selectLinkedAuthProviders = createSelector(
  [selectAuth],
  (auth) => auth.linkedProviders
);

export const selectProviderLinking = createSelector(
  [selectAuth],
  (auth) => auth.providerLinking
);

// Note: selectedCompanyId is now managed in companySlice, use selectSelectedCompanyId from companySelectors instead

export const selectUserDisplayName = createSelector(
  [selectCurrentUser],
  (user) => {
    if (!user) return 'Unknown User';
    return `${user.firstName} ${user.lastName}`.trim();
  }
);

export const selectUserInitials = createSelector(
  [selectCurrentUser],
  (user) => {
    if (!user) return 'U';
    const firstInitial = user.firstName?.charAt(0) || '';
    const lastInitial = user.lastName?.charAt(0) || '';
    return `${firstInitial}${lastInitial}`.toUpperCase();
  }
);

export const selectHasValidSession = createSelector(
  [selectAuth],
  (auth) => auth.isAuthenticated && auth.token && auth.user
);

export const selectSessionExpiresAt = createSelector(
  [selectAuthToken],
  (token) => {
    if (!token) return null;
    
    try {
      // Decode JWT to get expiration time
      const payload = JSON.parse(atob(token.split('.')[1]));
      return new Date(payload.exp * 1000);
    } catch (error) {
      return null;
    }
  }
);

export const selectIsSessionExpired = createSelector(
  [selectSessionExpiresAt],
  (expiresAt) => {
    if (!expiresAt) return false;
    return new Date() >= expiresAt;
  }
);

export const selectHasCompletedOnboarding = createSelector(
  [selectAuth],
  (auth) => auth.hasCompletedOnboarding
);

export const selectShouldShowMainApp = createSelector(
  [selectAuth],
  (auth) => {
    return auth.isAuthenticated || (auth.isGuestMode && auth.hasCompletedOnboarding);
  }
);
