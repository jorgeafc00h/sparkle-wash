// App selectors for accessing app state

import { createSelector } from '@reduxjs/toolkit';
import { RootState } from '../index';

// Base selectors
export const selectApp = (state: RootState) => state.app;

// Derived selectors
export const selectIsAppInitialized = createSelector(
  [selectApp],
  (app) => app.isInitialized
);

export const selectIsOnline = createSelector(
  [selectApp],
  (app) => app.isOnline
);

export const selectCurrentTheme = createSelector(
  [selectApp],
  (app) => app.currentTheme
);

export const selectLanguage = createSelector(
  [selectApp],
  (app) => app.language
);

export const selectLastSyncDate = createSelector(
  [selectApp],
  (app) => app.lastSyncDate
);

export const selectSyncStatus = createSelector(
  [selectApp],
  (app) => app.syncStatus
);

export const selectNotifications = createSelector(
  [selectApp],
  (app) => app.notifications
);

// Notification selectors
export const selectUnreadNotifications = createSelector(
  [selectNotifications],
  (notifications) => notifications.filter(notification => !notification.read)
);

export const selectUnreadNotificationCount = createSelector(
  [selectUnreadNotifications],
  (unreadNotifications) => unreadNotifications.length
);

export const selectNotificationsByType = createSelector(
  [selectNotifications],
  (notifications) => {
    return notifications.reduce((acc, notification) => {
      const type = notification.type;
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push(notification);
      return acc;
    }, {} as Record<string, typeof notifications>);
  }
);

export const selectRecentNotifications = createSelector(
  [selectNotifications],
  (notifications) => {
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    
    return notifications.filter(notification => 
      new Date(notification.timestamp) >= oneDayAgo
    );
  }
);

export const selectErrorNotifications = createSelector(
  [selectNotifications],
  (notifications) => notifications.filter(notification => 
    notification.type === 'error'
  )
);

export const selectSuccessNotifications = createSelector(
  [selectNotifications],
  (notifications) => notifications.filter(notification => 
    notification.type === 'success'
  )
);

// Sync status selectors
export const selectIsSyncing = createSelector(
  [selectSyncStatus],
  (syncStatus) => syncStatus === 'syncing'
);

export const selectSyncSuccessful = createSelector(
  [selectSyncStatus],
  (syncStatus) => syncStatus === 'success'
);

export const selectSyncFailed = createSelector(
  [selectSyncStatus],
  (syncStatus) => syncStatus === 'error'
);

export const selectTimeSinceLastSync = createSelector(
  [selectLastSyncDate],
  (lastSyncDate) => {
    if (!lastSyncDate) return null;
    
    const now = new Date();
    const lastSync = new Date(lastSyncDate);
    const timeDiff = now.getTime() - lastSync.getTime();
    
    const minutes = Math.floor(timeDiff / (1000 * 60));
    const hours = Math.floor(timeDiff / (1000 * 60 * 60));
    const days = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
    
    if (days > 0) {
      return `${days} day${days > 1 ? 's' : ''} ago`;
    } else if (hours > 0) {
      return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else if (minutes > 0) {
      return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    } else {
      return 'Just now';
    }
  }
);

// App health selectors
export const selectAppHealth = createSelector(
  [selectIsOnline, selectSyncStatus, selectErrorNotifications],
  (isOnline, syncStatus, errorNotifications) => {
    let health: 'good' | 'warning' | 'critical' = 'good';
    const issues: string[] = [];

    if (!isOnline) {
      health = 'warning';
      issues.push('No internet connection');
    }

    if (syncStatus === 'error') {
      health = 'warning';
      issues.push('Sync failed');
    }

    const recentErrors = errorNotifications.filter(notification => {
      const oneHourAgo = new Date();
      oneHourAgo.setHours(oneHourAgo.getHours() - 1);
      return new Date(notification.timestamp) >= oneHourAgo;
    });

    if (recentErrors.length > 3) {
      health = 'critical';
      issues.push('Multiple errors detected');
    }

    return {
      status: health,
      issues,
      isHealthy: health === 'good',
    };
  }
);

// Theme and UI selectors
export const selectEffectiveTheme = createSelector(
  [selectCurrentTheme],
  (currentTheme) => {
    if (currentTheme === 'system') {
      // TODO: Get system theme preference
      // For now, default to light
      return 'light';
    }
    return currentTheme;
  }
);

export const selectIsDarkTheme = createSelector(
  [selectEffectiveTheme],
  (effectiveTheme) => effectiveTheme === 'dark'
);

// Language and localization selectors
export const selectIsSpanish = createSelector(
  [selectLanguage],
  (language) => language === 'es'
);

export const selectIsEnglish = createSelector(
  [selectLanguage],
  (language) => language === 'en'
);

// App readiness selectors
export const selectIsAppReady = createSelector(
  [selectIsAppInitialized, selectIsOnline],
  (isInitialized, isOnline) => isInitialized && isOnline
);

export const selectCanPerformOnlineActions = createSelector(
  [selectIsOnline, selectIsSyncing],
  (isOnline, isSyncing) => isOnline && !isSyncing
);

// Notification display selectors
export const selectTopNotification = createSelector(
  [selectUnreadNotifications],
  (unreadNotifications) => {
    if (unreadNotifications.length === 0) return null;
    
    // Prioritize error notifications
    const errorNotification = unreadNotifications.find(n => n.type === 'error');
    if (errorNotification) return errorNotification;
    
    // Then warning notifications
    const warningNotification = unreadNotifications.find(n => n.type === 'warning');
    if (warningNotification) return warningNotification;
    
    // Finally, return the most recent
    return unreadNotifications.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )[0];
  }
);

export const selectShouldShowSyncIndicator = createSelector(
  [selectIsSyncing, selectLastSyncDate],
  (isSyncing, lastSyncDate) => {
    if (isSyncing) return true;
    
    if (!lastSyncDate) return true; // Never synced
    
    // Show if last sync was more than 1 hour ago
    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);
    const lastSync = new Date(lastSyncDate);
    return lastSync < oneHourAgo;
  }
);