// App slice for global app state management

import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { AppState, AppNotification } from '../../types';

// Initial state
const initialState: AppState = {
  isInitialized: false,
  isOnline: true,
  currentTheme: 'system',
  language: 'es', // Default to Spanish for El Salvador
  environment: 'development',
  isUITesting: false,
  lastSyncDate: undefined,
  syncStatus: 'idle',
  notifications: [],
};

// Async thunks
export const initializeApp = createAsyncThunk(
  'app/initializeApp',
  async (_, { dispatch }) => {
    try {
      console.log('🚀 Initializing app...');
      
      // Check network connectivity first
      const connectivityResult = await dispatch(checkConnectivity()).unwrap();
      console.log('🌐 Connectivity check result:', connectivityResult);
      
      // Test API connectivity if we have internet
      if (connectivityResult.isOnline) {
        console.log('🔗 Testing API endpoints...');
        try {
          const apiResult = await dispatch(testApiConnectivity()).unwrap();
          console.log('🔗 API test results:', apiResult);
        } catch (error) {
          console.warn('🔗 API connectivity test failed:', error);
        }
      }
      
      // TODO: Load user preferences from storage
      // TODO: Check for stored auth session
      // TODO: Initialize database
      
      console.log('✅ App initialization completed');
      
      return {
        isInitialized: true,
        isOnline: connectivityResult.isOnline,
        preferences: {
          theme: 'system',
          language: 'es',
        }
      };
    } catch (error: any) {
      console.error('❌ App initialization failed:', error);
      throw new Error(`App initialization failed: ${error.message}`);
    }
  }
);

export const checkConnectivity = createAsyncThunk(
  'app/checkConnectivity',
  async () => {
    try {
      console.log('🌐 Checking network connectivity...');
      
      // Test general internet connectivity first
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      const response = await fetch('https://www.google.com/favicon.ico', {
        method: 'HEAD',
        signal: controller.signal,
        cache: 'no-cache'
      });
      
      clearTimeout(timeoutId);
      
      const isOnline = response.ok;
      console.log(`🌐 General connectivity: ${isOnline ? 'ONLINE' : 'OFFLINE'}`);
      
      return { isOnline };
    } catch (error) {
      console.log('🌐 Network connectivity: OFFLINE (error:', error, ')');
      return { isOnline: false };
    }
  }
);

export const testApiConnectivity = createAsyncThunk(
  'app/testApiConnectivity',
  async (_, { rejectWithValue }) => {
    try {
      console.log('🔗 Testing API connectivity...');
      
      // Import API config
      const { getApiConfig, API_ENDPOINTS } = await import('../../config/api');
      
      // Test both environments
      const devConfig = getApiConfig(false);
      const prodConfig = getApiConfig(true);
      
      const testEndpoint = async (baseUrl: string, env: string) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

        try {
          // Health check is at root domain only
          // baseUrl is like "https://k-invoices-api-prod...azurecontainerapps.io/api"
          // We need "https://k-invoices-api-prod...azurecontainerapps.io/"
          const healthCheckUrl = baseUrl.replace('/api', '/');
          console.log(`🔗 Testing ${env} API health: ${healthCheckUrl}`);

          const response = await fetch(healthCheckUrl, {
            method: 'GET',
            signal: controller.signal,
            cache: 'no-cache',
            headers: {
              'Accept': 'application/json',
              'apiKey': 'eyJhbGciOiJFUzI1NiIsImtpZCI6IlVSS0VZSUQwMDEifQ'
            }
          });

          clearTimeout(timeoutId);

          // Try to parse health check response
          let healthStatus = 'Unknown';
          try {
            const data = await response.json();
            healthStatus = data?.status || 'Unknown';
            console.log(`🔗 ${env} API health status: ${healthStatus}`);
          } catch (parseError) {
            console.warn(`🔗 ${env} API response not JSON`);
          }

          console.log(`🔗 ${env} API response: ${response.status} ${response.statusText}`);

          return {
            env,
            url: healthCheckUrl,
            status: response.status,
            ok: response.ok,
            statusText: response.statusText,
            healthStatus
          };
        } catch (error) {
          clearTimeout(timeoutId);
          console.error(`🔗 ${env} API health check failed:`, error);

          const healthCheckUrl = baseUrl.replace('/api', '/');
          return {
            env,
            url: healthCheckUrl,
            status: 0,
            ok: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      };
      
      const [devResult, prodResult] = await Promise.all([
        testEndpoint(devConfig.baseUrl, 'DEV'),
        testEndpoint(prodConfig.baseUrl, 'PROD')
      ]);
      
      return {
        dev: devResult,
        prod: prodResult,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('🔗 API connectivity test failed:', error);
      return rejectWithValue(error instanceof Error ? error.message : 'Unknown error');
    }
  }
);

export const performSync = createAsyncThunk(
  'app/performSync',
  async (_, { dispatch, getState }) => {
    try {
      // TODO: Implement actual sync logic
      // - Sync pending invoices
      // - Update catalogs if needed
      // - Sync company data
      
      // Simulate sync process
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      return {
        lastSyncDate: new Date().toISOString(),
        success: true,
      };
    } catch (error: any) {
      throw new Error(`Sync failed: ${error.message}`);
    }
  }
);

export const loadUserPreferences = createAsyncThunk(
  'app/loadUserPreferences',
  async () => {
    try {
      // TODO: Load from AsyncStorage
      const preferences = {
        theme: 'system' as const,
        language: 'es',
      };
      
      return preferences;
    } catch (error: any) {
      throw new Error(`Failed to load preferences: ${error.message}`);
    }
  }
);

export const saveUserPreferences = createAsyncThunk(
  'app/saveUserPreferences',
  async (preferences: { theme?: 'light' | 'dark' | 'system'; language?: string }) => {
    try {
      // TODO: Save to AsyncStorage
      return preferences;
    } catch (error: any) {
      throw new Error(`Failed to save preferences: ${error.message}`);
    }
  }
);

// Slice
const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    // Set online/offline status
    setOnlineStatus: (state, action: PayloadAction<boolean>) => {
      state.isOnline = action.payload;
    },
    
    // Set theme
    setTheme: (state, action: PayloadAction<'light' | 'dark' | 'system'>) => {
      state.currentTheme = action.payload;
    },
    
    // Set language
    setLanguage: (state, action: PayloadAction<string>) => {
      state.language = action.payload;
    },
    
    // Add notification
    addNotification: (state, action: PayloadAction<Omit<AppNotification, 'id' | 'timestamp'>>) => {
      const notification: AppNotification = {
        ...action.payload,
        id: `notification_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date().toISOString(),
        read: false,
      };
      state.notifications.unshift(notification);
      
      // Keep only last 50 notifications
      if (state.notifications.length > 50) {
        state.notifications = state.notifications.slice(0, 50);
      }
    },
    
    // Mark notification as read
    markNotificationRead: (state, action: PayloadAction<string>) => {
      const notification = state.notifications.find(n => n.id === action.payload);
      if (notification) {
        notification.read = true;
      }
    },
    
    // Mark all notifications as read
    markAllNotificationsRead: (state) => {
      state.notifications.forEach(notification => {
        notification.read = true;
      });
    },
    
    // Remove notification
    removeNotification: (state, action: PayloadAction<string>) => {
      state.notifications = state.notifications.filter(n => n.id !== action.payload);
    },
    
    // Clear all notifications
    clearNotifications: (state) => {
      state.notifications = [];
    },
    
    // Set sync status
    setSyncStatus: (state, action: PayloadAction<'idle' | 'syncing' | 'success' | 'error'>) => {
      state.syncStatus = action.payload;
    },
    
    // Set last sync date
    setLastSyncDate: (state, action: PayloadAction<string>) => {
      state.lastSyncDate = action.payload;
    },
    
    // Set UITesting mode — called on app start when uitesting launch arg is present
    setIsUITesting: (state, action: PayloadAction<boolean>) => {
      state.isUITesting = action.payload;
    },

    // Reset app state
    resetAppState: (state) => {
      Object.assign(state, {
        ...initialState,
        isInitialized: true, // Keep initialized state
      });
    },
  },
  extraReducers: (builder) => {
    // Initialize app
    builder
      .addCase(initializeApp.pending, (state) => {
        state.isInitialized = false;
      })
      .addCase(initializeApp.fulfilled, (state, action) => {
        state.isInitialized = true;
        state.currentTheme = action.payload.preferences.theme as 'light' | 'dark' | 'system';
        state.language = action.payload.preferences.language;
      })
      .addCase(initializeApp.rejected, (state, action) => {
        state.isInitialized = false;
        // Add error notification
        const notification: AppNotification = {
          id: `error_${Date.now()}`,
          title: 'Initialization Error',
          message: action.error.message || 'Failed to initialize app',
          type: 'error',
          timestamp: new Date().toISOString(),
          read: false,
        };
        state.notifications.unshift(notification);
      });

    // Check connectivity
    builder
      .addCase(checkConnectivity.fulfilled, (state, action) => {
        const wasOffline = !state.isOnline;
        state.isOnline = action.payload.isOnline;
        
        // Add notification when coming back online
        if (wasOffline && action.payload.isOnline) {
          const notification: AppNotification = {
            id: `online_${Date.now()}`,
            title: 'Connection Restored',
            message: 'You are back online',
            type: 'success',
            timestamp: new Date().toISOString(),
            read: false,
          };
          state.notifications.unshift(notification);
        }
      });

    // Perform sync
    builder
      .addCase(performSync.pending, (state) => {
        state.syncStatus = 'syncing';
      })
      .addCase(performSync.fulfilled, (state, action) => {
        state.syncStatus = 'success';
        state.lastSyncDate = action.payload.lastSyncDate;
        
        // Add success notification
        const notification: AppNotification = {
          id: `sync_success_${Date.now()}`,
          title: 'Sync Complete',
          message: 'Data synchronized successfully',
          type: 'success',
          timestamp: new Date().toISOString(),
          read: false,
        };
        state.notifications.unshift(notification);
      })
      .addCase(performSync.rejected, (state, action) => {
        state.syncStatus = 'error';
        
        // Add error notification
        const notification: AppNotification = {
          id: `sync_error_${Date.now()}`,
          title: 'Sync Failed',
          message: action.error.message || 'Failed to synchronize data',
          type: 'error',
          timestamp: new Date().toISOString(),
          read: false,
        };
        state.notifications.unshift(notification);
      });

    // Load user preferences
    builder
      .addCase(loadUserPreferences.fulfilled, (state, action) => {
        state.currentTheme = action.payload.theme;
        state.language = action.payload.language;
      });

    // Save user preferences
    builder
      .addCase(saveUserPreferences.fulfilled, (state, action) => {
        if (action.payload.theme) {
          state.currentTheme = action.payload.theme;
        }
        if (action.payload.language) {
          state.language = action.payload.language;
        }
      });
  },
});

// Actions
export const {
  setOnlineStatus,
  setTheme,
  setLanguage,
  setIsUITesting,
  addNotification,
  markNotificationRead,
  markAllNotificationsRead,
  removeNotification,
  clearNotifications,
  setSyncStatus,
  setLastSyncDate,
  resetAppState,
} = appSlice.actions;

export default appSlice.reducer;
