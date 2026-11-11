// Subscription slice — Desktop version (N1CO only, no mobile IAP)

import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import {
  SubscriptionTier,
  SubscriptionState,
  SubscriptionProduct,
  ActiveSubscription,
} from '../../services/subscription/SubscriptionTypes';
import N1COService, {
  N1COCardData,
  N1COCustomerData,
  N1COPlan,
  N1COSubscriptionResult,
  N1COThreeDSConfirmationContext,
} from '../../services/subscription/N1COService';
import { SUBSCRIPTION_CONFIG } from '../../config/subscriptionConfig';
import AuthProviderService from '../../services/auth/AuthProviderService';
import GoogleAuthService from '../../services/auth/GoogleAuthService';
import { logoutUser, updateSessionToken } from './authSlice';
import { selectAuthToken } from '../selectors/authSelectors';
import {
  bestTier,
  fetchAccountEntitlement,
} from '../../services/subscription/AccountEntitlementService';
import { startSyncTrial as startSyncTrialRequest } from '../../services/subscription/SyncTrialService';
import type { AccountEntitlement } from '../../services/subscription/SubscriptionTypes';
import type { RootState } from '../index';

function planForTier(tier: SubscriptionTier): N1COPlan {
  // Tier enum naming is historical (see subscriptionConfig.ts:24-27):
  //   AdFree = "Pro"      ($7)
  //   Pro    = "Business" ($14)
  const cfg = tier === SubscriptionTier.Pro
    ? SUBSCRIPTION_CONFIG.n1coPlans.pro
    : SUBSCRIPTION_CONFIG.n1coPlans.adFree;
  return { name: cfg.name, amount: cfg.amount, billingCycleType: cfg.billingCycleType };
}

const initialState: SubscriptionState = {
  tier: SubscriptionTier.Lite,
  isInitialized: false,
  loading: false,
  error: null,
  availableProducts: [],
  activeSubscription: null,
  purchaseInProgress: false,
  trialStarting: false,
  syncTrialUsed: false,
};

const SUBSCRIPTION_CONFIRMATION_POLL = {
  maxAttempts: 15,
  delayMs: 2000,
} as const;

// The N1CO endpoints (/subscription/n1co/*) authenticate with a GOOGLE id_token
// (Invoices.Api GoogleAuthEndpointFilter). Since sign-in moved to POST
// /api/auth/login this sent the internal session JWT instead, so status,
// checkout, cancel and change-card all answered 401 for every signed-in user
// (only the account-entitlement fallback kept the tier right).
async function resolveIdToken(
  _getState: () => Parameters<typeof selectAuthToken>[0],
): Promise<string | null> {
  return GoogleAuthService.getFreshIdToken();
}

async function confirmActiveSubscription(
  idToken: string,
  expectedTier: SubscriptionTier,
  subscriptionId: string | number | null | undefined,
  failureMessage: string,
) {
  if (subscriptionId === null || subscriptionId === undefined || subscriptionId === '') {
    throw new Error('N1CO no devolvió el identificador de la suscripción');
  }

  const settled = await N1COService.pollUntilActiveSubscription(
    idToken,
    expectedTier,
    subscriptionId,
    SUBSCRIPTION_CONFIRMATION_POLL,
  );

  if (!settled?.activeSubscription) {
    throw new Error(failureMessage);
  }

  return settled;
}

async function complete3DSIfRequired(
  idToken: string,
  result: N1COSubscriptionResult,
  cancelledMessage: string,
  confirmationContext?: N1COThreeDSConfirmationContext,
): Promise<N1COSubscriptionResult> {
  let current = result;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (current.status !== 'AUTHENTICATION_REQUIRED') {
      return current;
    }

    if (!current.authUrl) {
      throw new Error('N1CO requirió autenticación 3DS pero no devolvió la URL de autenticación');
    }

    const threeDSResult = await N1COService.handle3DS(current.authUrl);
    if (threeDSResult.status !== 'SUCCESS') {
      throw new Error(cancelledMessage);
    }

    if (!threeDSResult.authenticationId) {
      throw new Error(
        'N1CO completó la autenticación 3DS pero no devolvió el identificador de autenticación',
      );
    }

    current = await N1COService.confirm3DS(
      threeDSResult.authenticationId,
      idToken,
      confirmationContext,
    );
    if (current.status === 'FAILED') {
      throw new Error(current.error ?? 'N1CO rechazó la suscripción después de la autenticación 3DS');
    }
  }

  if (current.status === 'AUTHENTICATION_REQUIRED') {
    throw new Error('N1CO solicitó una autenticación 3DS adicional y no se pudo completar automáticamente');
  }

  return current;
}

// ── Thunks ────────────────────────────────────────────────────────────────

/**
 * Entitlement persisted for a FREE account that has (or had) a sync trial: the
 * server keeps the trial row after expiry and returns its trialUntil even with
 * tier=free — carrying it lets the Sincronización panel hide the offer for an
 * expired trial without waiting for the server's 409.
 */
const freeTrialEntitlement = (trialUntil: string | null | undefined): AccountEntitlement | null =>
  trialUntil
    ? {
        canonicalTier: 'free',
        planTier: null,
        tier: SubscriptionTier.Lite,
        status: 'none',
        planName: null,
        expiresAt: trialUntil,
        trialUntil,
        features: { sync: false, adFree: false, email: true },
        fetchedAt: new Date().toISOString(),
      }
    : null;

/** accountEntitlement for the thunk's payload: entitled → full, free → trial marker. */
const entitlementOf = (
  fetch: Awaited<ReturnType<typeof fetchAccountEntitlement>>,
): AccountEntitlement | null => {
  if (fetch.kind === 'entitled') return fetch.entitlement;
  if (fetch.kind === 'free') return freeTrialEntitlement(fetch.trialUntil);
  return null;
};

export const initializeSubscription = createAsyncThunk(
  'subscription/initialize',
  async (_, { rejectWithValue, getState }) => {
    const idToken = await resolveIdToken(getState as () => Parameters<typeof selectAuthToken>[0]);
    try {
      const availableProducts = N1COService.getAvailableProducts();
      if (!idToken) {
        // No token yet (app boot before sign-in completes, or offline). Don't
        // clobber the rehydrated tier — reject so the slice keeps whatever
        // redux-persist restored. Explicit logout resets tier elsewhere.
        return rejectWithValue('No autenticado');
      }

      // Cross-platform account entitlement (upgrade-only contributor): a purchase made
      // on ANY platform — N1CO card on web/Android, Google Play on a phone, manual
      // TIER_OVERRIDES — resolves here for the signed-in account. Never a downgrade.
      const accountEntitlement = await fetchAccountEntitlement();
      const accountTier =
        accountEntitlement.kind === 'entitled' ? accountEntitlement.entitlement.tier : null;

      const status = await N1COService.checkStatus(idToken);
      if (!status) {
        if (accountTier) {
          // The legacy N1CO channel is unreachable but the account entitlement answered:
          // apply it (upgrade-only vs the rehydrated tier happens in applyAccountEntitlement).
          return {
            tier: accountTier,
            activeSubscription: null,
            availableProducts,
            accountEntitlement: entitlementOf(accountEntitlement),
          };
        }
        // Backend unreachable. Don't overwrite cached tier — reject so the
        // slice keeps whatever redux-persist rehydrated.
        return rejectWithValue('No se pudo verificar el estado de la suscripción');
      }

      // The N1CO channel stays authoritative for the tier IT knows about (it reflects
      // genuine cancels for web-bought plans); the account entitlement may only raise it
      // (e.g. an Enterprise override or a Play-bought grant the N1CO rows can't see).
      const mergedTier = accountTier ? bestTier(status.tier, accountTier) : status.tier;
      return {
        tier: mergedTier,
        activeSubscription: status.activeSubscription,
        availableProducts,
        accountEntitlement: entitlementOf(accountEntitlement),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to initialize subscription';
      return rejectWithValue(message);
    }
  }
);

export const purchaseProduct = createAsyncThunk(
  'subscription/purchase',
  async (_productId: string, { rejectWithValue }) => {
    return rejectWithValue('Use purchaseN1CO for desktop subscriptions');
  }
);

export const restorePurchases = createAsyncThunk(
  'subscription/restore',
  async (_, { rejectWithValue, getState }) => {
    const idToken = await resolveIdToken(getState as () => Parameters<typeof selectAuthToken>[0]);
    if (!idToken) return rejectWithValue('No autenticado');
    try {
      const status = await N1COService.checkStatus(idToken);
      if (!status) return rejectWithValue('No se pudo verificar el estado de la suscripción');
      return { tier: status.tier, activeSubscription: status.activeSubscription };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Restore failed';
      return rejectWithValue(message);
    }
  }
);

export const purchaseN1CO = createAsyncThunk(
  'subscription/purchaseN1CO',
  async (
    { tier, cardData, customer }: { cardData: N1COCardData; customer: N1COCustomerData; tier: SubscriptionTier },
    { rejectWithValue, getState },
  ) => {
    const idToken = await resolveIdToken(getState as () => Parameters<typeof selectAuthToken>[0]);
    if (!idToken) {
      return rejectWithValue('Debes iniciar sesión antes de suscribirte');
    }

    try {
      // Step 1: Tokenize card
      const paymentMethodId = await N1COService.tokenizeCard(cardData, customer, idToken);

      // Step 2: Create subscription
      const plan = planForTier(tier);
      const result = await N1COService.createSubscription(tier, paymentMethodId, customer, plan, idToken);

      // Backend explicitly returns FAILED with an error message — surface it.
      if (result.status === 'FAILED') {
        return rejectWithValue(result.error ?? 'Pago rechazado por N1CO');
      }

      // Step 3: Complete 3DS if required and confirm the subscription server-side.
      const confirmedResult = await complete3DSIfRequired(
        idToken,
        result,
        'La autenticación 3DS fue cancelada o fallida. No se activó la suscripción.',
        { tier, paymentMethodId, customer },
      );

      // Step 4: Confirm status (source of truth — backend re-fetches from N1CO)
      const settled = await confirmActiveSubscription(
        idToken,
        tier,
        confirmedResult.subscriptionId,
        'No se pudo confirmar la activación de la suscripción. Si tu pago se procesó, verifica el estado en unos minutos.',
      );

      return {
        tier: settled.tier,
        activeSubscription: settled.activeSubscription,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : `Error al procesar suscripción ${tier}`;
      return rejectWithValue(message);
    }
  },
);

export const changePaymentMethodN1CO = createAsyncThunk(
  'subscription/changePaymentMethodN1CO',
  async (
    { cardData }: { cardData: N1COCardData },
    { rejectWithValue, getState },
  ) => {
    const idToken = await resolveIdToken(getState as () => Parameters<typeof selectAuthToken>[0]);
    if (!idToken) {
      return rejectWithValue('Debes iniciar sesión para actualizar tu tarjeta');
    }

    try {
      const previousSubscription = (getState() as RootState).subscription.activeSubscription;
      const result = await N1COService.changePaymentMethod(cardData, idToken);

      const confirmedResult = await complete3DSIfRequired(
        idToken,
        result,
        'La autenticación 3DS fue cancelada o fallida. No se actualizó la tarjeta.',
      );

      const expectedTier = previousSubscription?.tier ?? result.tier;
      const settled = await confirmActiveSubscription(
        idToken,
        expectedTier,
        confirmedResult.subscriptionId,
        'No se pudo confirmar la actualización de la tarjeta. Si el pago se procesó, verifica el estado en unos minutos.',
      );

      return {
        tier: settled.tier,
        activeSubscription: settled.activeSubscription,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Error al actualizar el método de pago';
      return rejectWithValue(message);
    }
  },
);

export const cancelN1CO = createAsyncThunk(
  'subscription/cancelN1CO',
  async (_, { rejectWithValue, getState }) => {
    const idToken = await resolveIdToken(getState as () => Parameters<typeof selectAuthToken>[0]);
    if (!idToken) return rejectWithValue('No autenticado');
    try {
      await N1COService.cancelSubscription(idToken);
      return { tier: SubscriptionTier.Lite };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Error al cancelar suscripción';
      return rejectWithValue(message);
    }
  },
);

export const activateKey = createAsyncThunk(
  'subscription/activateKey',
  async (key: string, { rejectWithValue, getState }) => {
    const idToken = await resolveIdToken(getState as () => Parameters<typeof selectAuthToken>[0]);
    if (!idToken) return rejectWithValue('No autenticado');
    try {
      const result = await N1COService.activateKey(key, idToken);
      if (!result.valid) {
        return rejectWithValue('Clave inválida o ya utilizada');
      }
      return { tier: result.tier };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Error al activar clave';
      return rejectWithValue(message);
    }
  },
);

/**
 * Free 1-month Device Sync trial (POST /api/auth/sync-trial). The SERVER owns
 * the grant; on success the local tier rises to the granted tier (upgrade-only
 * merge) and the entitlement carries trialUntil so the panel can show the days
 * left. A 409 settles `syncTrialUsed` so the offer never nags again.
 */
export const startSyncTrial = createAsyncThunk(
  'subscription/startSyncTrial',
  async (_, { rejectWithValue, dispatch, getState }) => {
    const result = await startSyncTrialRequest();
    switch (result.kind) {
      case 'started': {
        // The relay gates sync on the JWT `tier` claim, minted at login (≤24 h).
        // The grant returns a re-minted internalJwt whose tier claim is already
        // pro_sync — persist it exactly like the company-claim refresh does so
        // the next sync session is authorized without a full re-login. Storage
        // failures must not lose the grant: the server row is the source of truth.
        if (result.internalJwt) {
          const stillSignedIn =
            (getState() as { auth?: { isAuthenticated?: boolean } }).auth?.isAuthenticated !== false;
          if (stillSignedIn) {
            try {
              await AuthProviderService.updateToken(result.internalJwt);
              dispatch(updateSessionToken(result.internalJwt));
            } catch {
              // Best-effort — the next sign-in re-mints the token.
            }
          }
        }
        return result;
      }
      case 'already-used':
        return result;
      case 'unauthenticated':
        return rejectWithValue('Debes iniciar sesión para iniciar la prueba gratis');
      case 'unavailable':
        return rejectWithValue('No se pudo iniciar la prueba gratis. Inténtalo de nuevo más tarde.');
    }
  },
);

// ── Slice ─────────────────────────────────────────────────────────────────

const subscriptionSlice = createSlice({
  name: 'subscription',
  initialState,
  reducers: {
    setTier(state, action: PayloadAction<SubscriptionTier>) {
      state.tier = action.payload;
    },
    setActiveSubscription(state, action: PayloadAction<ActiveSubscription | null>) {
      state.activeSubscription = action.payload;
      if (action.payload) {
        state.tier = action.payload.tier;
      }
    },
    setAvailableProducts(state, action: PayloadAction<SubscriptionProduct[]>) {
      state.availableProducts = action.payload;
    },
    clearError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Sign-out must drop the persisted tier — the next user's entitlement
      // starts fresh. Without this a paid tier survived logout forever
      // (persistence whitelist keeps `tier` across restarts).
      .addCase(logoutUser.fulfilled, (state) => {
        state.tier = SubscriptionTier.Lite;
        state.activeSubscription = null;
        state.accountEntitlement = null;
        // The trial belongs to the signed-in ACCOUNT, not this device profile.
        state.syncTrialUsed = false;
        state.trialStarting = false;
      })
      .addCase(initializeSubscription.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(initializeSubscription.fulfilled, (state, action) => {
        state.loading = false;
        state.isInitialized = true;
        state.tier = action.payload.tier;
        state.activeSubscription = action.payload.activeSubscription;
        state.availableProducts = action.payload.availableProducts;
        state.accountEntitlement = action.payload.accountEntitlement ?? null;
      })
      .addCase(initializeSubscription.rejected, (state, action) => {
        state.loading = false;
        state.isInitialized = true;
        state.error = action.payload as string;
      });

    builder
      .addCase(purchaseProduct.pending, (state) => {
        state.purchaseInProgress = true;
        state.error = null;
      })
      .addCase(purchaseProduct.rejected, (state, action) => {
        state.purchaseInProgress = false;
        state.error = action.payload as string;
      });

    builder
      .addCase(restorePurchases.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(restorePurchases.fulfilled, (state, action) => {
        state.loading = false;
        state.tier = action.payload.tier;
        state.activeSubscription = action.payload.activeSubscription;
      })
      .addCase(restorePurchases.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });

    builder
      .addCase(purchaseN1CO.pending, (state) => {
        state.purchaseInProgress = true;
        state.error = null;
      })
      .addCase(purchaseN1CO.fulfilled, (state, action) => {
        state.purchaseInProgress = false;
        state.tier = action.payload.tier;
        state.activeSubscription = action.payload.activeSubscription;
      })
      .addCase(purchaseN1CO.rejected, (state, action) => {
        state.purchaseInProgress = false;
        state.error = action.payload as string;
      });

    builder
      .addCase(changePaymentMethodN1CO.pending, (state) => {
        state.purchaseInProgress = true;
        state.error = null;
      })
      .addCase(changePaymentMethodN1CO.fulfilled, (state, action) => {
        state.purchaseInProgress = false;
        state.tier = action.payload.tier;
        state.activeSubscription = action.payload.activeSubscription;
      })
      .addCase(changePaymentMethodN1CO.rejected, (state, action) => {
        state.purchaseInProgress = false;
        state.error = action.payload as string;
      });

    builder
      .addCase(cancelN1CO.fulfilled, (state, action) => {
        state.tier = action.payload.tier;
        state.activeSubscription = null;
      })
      .addCase(cancelN1CO.rejected, (state, action) => {
        state.error = action.payload as string;
      });

    builder
      .addCase(activateKey.pending, (state) => {
        state.purchaseInProgress = true;
        state.error = null;
      })
      .addCase(activateKey.fulfilled, (state, action) => {
        state.purchaseInProgress = false;
        state.tier = action.payload.tier;
      })
      .addCase(activateKey.rejected, (state, action) => {
        state.error = action.payload as string;
        state.purchaseInProgress = false;
      });

    builder
      .addCase(startSyncTrial.pending, (state) => {
        state.trialStarting = true;
        state.error = null;
      })
      .addCase(startSyncTrial.fulfilled, (state, action) => {
        state.trialStarting = false;
        if (action.payload.kind === 'already-used') {
          state.syncTrialUsed = true;
          return;
        }
        // Trial granted: raise the tier (upgrade-only) and surface trialUntil on
        // the account entitlement — the Sincronización panel unlocks immediately.
        const { tier, trialUntil } = action.payload;
        state.tier = bestTier(state.tier, tier);
        const existing = state.accountEntitlement;
        const entitlement: AccountEntitlement = {
          // The granted tier IS the canonical string ('pro_sync'/'enterprise') —
          // the entitlements endpoint returns body.tier the same way.
          canonicalTier: tier,
          planTier: existing?.planTier ?? null,
          tier,
          status: 'trialing',
          planName: existing?.planName ?? 'Prueba Pro+Sync',
          expiresAt: trialUntil,
          trialUntil,
          features: { sync: true, adFree: existing?.features.adFree ?? true, email: existing?.features.email ?? true },
          fetchedAt: new Date().toISOString(),
        };
        state.accountEntitlement = entitlement;
      })
      .addCase(startSyncTrial.rejected, (state, action) => {
        state.trialStarting = false;
        state.error = action.payload as string;
      });
  },
});

export const {
  setTier,
  setActiveSubscription,
  setAvailableProducts,
  clearError,
} = subscriptionSlice.actions;

export default subscriptionSlice.reducer;
