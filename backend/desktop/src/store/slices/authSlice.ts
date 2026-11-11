// Auth slice for user authentication and session management

import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { AuthProvider, AuthState, User } from '../../types';
import GoogleAuthService from '../../services/auth/GoogleAuthService';
import AuthProviderService, { AuthLoginResult, AuthSession } from '../../services/auth/AuthProviderService';

// Initial state
const initialState: AuthState = {
  user: null,
  isAuthenticated: false,
  isGuestMode: false,
  hasCompletedOnboarding: false,
  loading: false,
  error: null,
  token: null,
  refreshToken: null,
  selectedCompanyId: null,
  linkedProviders: [],
  providerLinking: null,
};

// Authentication on Desktop is Google SSO + Guest only. The legacy
// email/password thunks were stubs that posted to non-existent endpoints and
// have been removed — see store/slices/authSlice.ts history if resurrecting.

export const updateProfile = createAsyncThunk(
  'auth/updateProfile',
  async (
    profileData: Partial<User>,
    { getState, rejectWithValue }
  ) => {
    try {
      const state = getState() as { auth: AuthState };
      const { token } = state.auth;

      // TODO: Implement actual profile update API call
      const response = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(profileData),
      });

      if (!response.ok) {
        const error = await response.json();
        return rejectWithValue(error.message || 'Profile update failed');
      }

      const data = await response.json();
      return data.user;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Network error');
    }
  }
);

export const logoutUser = createAsyncThunk(
  'auth/logoutUser',
  async () => {
    try {
      await Promise.all([
        AuthProviderService.clearSession(),
        // Explicit logout: revoke the Google grant, not just the local copy.
        GoogleAuthService.signOut({ revoke: true }),
      ]);
    } catch (error) {
      // Continue with logout even if API call fails
      console.warn('Logout cleanup failed:', error);
    }
  }
);

export const deactivateAccount = createAsyncThunk(
  'auth/deactivateAccount',
  async (_, { getState, rejectWithValue }) => {
    try {
      const state = getState() as { auth: AuthState };
      const { user, token } = state.auth;

      if (!user || !token) {
        return rejectWithValue('Usuario no autenticado');
      }

      // TODO: Implement actual deactivate account API call
      const response = await fetch('/api/auth/deactivate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          email: user.email,
          userId: user.id,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        return rejectWithValue(error.message || 'Error al desactivar cuenta');
      }

      return { success: true };
    } catch (error: any) {
      return rejectWithValue(error.message || 'Error de conexión');
    }
  }
);

// Google Sign-In thunk
export const googleSignIn = createAsyncThunk<AuthLoginResult, void, { rejectValue: string }>(
  'auth/googleSignIn',
  async (_, { rejectWithValue }) => {
    try {
      const googleUser = await GoogleAuthService.signIn();
      return await AuthProviderService.loginWithGoogle(googleUser);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Error al iniciar sesión con Google';
      return rejectWithValue(message);
    }
  }
);

// Google Sign-Out thunk
export const googleSignOut = createAsyncThunk(
  'auth/googleSignOut',
  async () => {
    await Promise.all([
      AuthProviderService.clearSession(),
      GoogleAuthService.signOut({ revoke: true }),
    ]);
  }
);

export const linkGoogleProvider = createAsyncThunk<AuthSession & { companies?: string[] }, void, { rejectValue: string }>(
  'auth/linkGoogleProvider',
  async (_, { getState, rejectWithValue }) => {
    try {
      const state = getState() as { auth: AuthState };
      const token = await AuthProviderService.getFreshToken(state.auth.token);
      if (!token) {
        return rejectWithValue('Debes iniciar sesión antes de vincular Google');
      }

      const googleUser = await GoogleAuthService.signIn();
      return await AuthProviderService.linkGoogleProvider(googleUser, token);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'No se pudo vincular Google';
      return rejectWithValue(message);
    }
  }
);

export const deleteAccount = createAsyncThunk(
  'auth/deleteAccount',
  async (_, { getState, rejectWithValue }) => {
    try {
      const state = getState() as { auth: AuthState };
      const { user, token } = state.auth;

      if (!user || !token) {
        return rejectWithValue('Usuario no autenticado');
      }

      // TODO: Implement actual delete account API call
      const response = await fetch('/api/auth/delete', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          email: user.email,
          userId: user.id,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        return rejectWithValue(error.message || 'Error al eliminar cuenta');
      }

      return { success: true };
    } catch (error: any) {
      return rejectWithValue(error.message || 'Error de conexión');
    }
  }
);

// Slice
const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    // Clear error state
    clearError: (state) => {
      state.error = null;
    },

    clearProviderLinking: (state) => {
      state.providerLinking = null;
    },
    
    // Set selected company
    setSelectedCompany: (state, action: PayloadAction<string | null>) => {
      state.selectedCompanyId = action.payload;
    },
    
    // Update user locally (for optimistic updates)
    updateUserLocal: (state, action: PayloadAction<Partial<User>>) => {
      if (state.user) {
        state.user = { ...state.user, ...action.payload };
      }
    },
    
    // Reset auth state (for app reset)
    resetAuth: (state) => {
      Object.assign(state, initialState);
    },
    
    // Set loading state manually
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },

    // Restore session from storage
    restoreSession: (state, action: PayloadAction<{
      user: User;
      token: string;
      refreshToken?: string | null;
      selectedCompanyId?: string;
      linkedProviders?: AuthProvider[];
    }>) => {
      state.user = action.payload.user;
      state.token = action.payload.token;
      state.refreshToken = action.payload.refreshToken ?? null;
      state.selectedCompanyId = action.payload.selectedCompanyId || null;
      state.linkedProviders = action.payload.linkedProviders ?? [];
      state.providerLinking = null;
      state.isAuthenticated = true;
      state.loading = false;
      state.error = null;
    },

    // Set authenticated user from a restored internal app session
    setAuthenticatedUser: (state, action: PayloadAction<{
      user: User;
      accessToken: string;
      refreshToken?: string;
      linkedProviders?: AuthProvider[];
    }>) => {
      state.user = action.payload.user;
      state.token = action.payload.accessToken;
      state.refreshToken = action.payload.refreshToken || null;
      state.linkedProviders = action.payload.linkedProviders ?? [];
      state.providerLinking = null;
      state.isAuthenticated = true;
      state.isGuestMode = false;
      state.loading = false;
      state.error = null;
    },

    // Refreshed internal JWT (e.g. after POST /api/auth/companies/claim linked a
    // company and the backend returned a new session). AuthProviderService persists
    // it in appStorage; this keeps the in-memory token in sync.
    updateSessionToken: (state, action: PayloadAction<string>) => {
      if (action.payload) state.token = action.payload;
    },
    
    // Set guest mode (continue without account)
    setGuestMode: (state, action: PayloadAction<boolean>) => {
      state.isGuestMode = action.payload;
      if (action.payload) {
        state.isAuthenticated = false;
        state.user = null;
        state.token = null;
        state.refreshToken = null;
        state.linkedProviders = [];
        state.providerLinking = null;
        state.hasCompletedOnboarding = true; // Mark as completed when entering guest mode
      }
    },

    // Logout action (synchronous)
    logout: (state) => {
      Object.assign(state, initialState);
    },

    // Complete onboarding
    completeOnboarding: (state) => {
      state.hasCompletedOnboarding = true;
      // Set guest mode when onboarding is completed without authentication
      // This ensures the company initialization effect will trigger
      state.isGuestMode = true;
      state.isAuthenticated = false;
    },

    // Reset onboarding (for testing)
    resetOnboarding: (state) => {
      state.hasCompletedOnboarding = false;
    },
  },
  extraReducers: (builder) => {
    // Update profile
    builder
      .addCase(updateProfile.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updateProfile.fulfilled, (state, action) => {
        state.loading = false;
        state.user = action.payload;
        state.error = null;
      })
      .addCase(updateProfile.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });

    // Logout user
    builder
      .addCase(logoutUser.pending, (state) => {
        state.loading = true;
      })
      .addCase(logoutUser.fulfilled, (state) => {
        Object.assign(state, initialState);
      })
      .addCase(logoutUser.rejected, (state) => {
        // Even if logout API fails, clear local state
        Object.assign(state, initialState);
      });

    // Deactivate account
    builder
      .addCase(deactivateAccount.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(deactivateAccount.fulfilled, (state) => {
        state.loading = false;
        // Keep user logged in until they confirm the action
      })
      .addCase(deactivateAccount.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });

    // Delete account
    builder
      .addCase(deleteAccount.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(deleteAccount.fulfilled, (state) => {
        state.loading = false;
        // Keep user logged in until they confirm the action
      })
      .addCase(deleteAccount.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });

    // Google Sign-In
    builder
      .addCase(googleSignIn.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(googleSignIn.fulfilled, (state, action) => {
        state.loading = false;
        if (!action.payload.authenticated) {
          state.providerLinking = action.payload.providerLinking;
          state.error = null;
          return;
        }

        state.user = action.payload.user;
        state.token = action.payload.token;
        state.refreshToken = action.payload.refreshToken;
        state.linkedProviders = action.payload.linkedProviders;
        state.providerLinking = null;
        state.isAuthenticated = true;
        state.isGuestMode = false;
        state.hasCompletedOnboarding = true;
        state.error = null;
      })
      .addCase(googleSignIn.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });

    // Google Sign-Out
    builder
      .addCase(googleSignOut.fulfilled, (state) => {
        Object.assign(state, initialState);
      });

    // Provider linking
    builder
      .addCase(linkGoogleProvider.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(linkGoogleProvider.fulfilled, (state, action) => {
        state.loading = false;
        state.user = action.payload.user;
        state.token = action.payload.token;
        state.refreshToken = action.payload.refreshToken;
        state.linkedProviders = action.payload.linkedProviders;
        state.providerLinking = null;
        state.isAuthenticated = true;
        state.isGuestMode = false;
        state.error = null;
      })
      .addCase(linkGoogleProvider.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });
  },
});

// Actions
export const {
  clearError,
  clearProviderLinking,
  setSelectedCompany,
  updateUserLocal,
  resetAuth,
  setLoading,
  restoreSession,
  setAuthenticatedUser,
  updateSessionToken,
  setGuestMode,
  logout,
  completeOnboarding,
  resetOnboarding,
} = authSlice.actions;

export default authSlice.reducer;
