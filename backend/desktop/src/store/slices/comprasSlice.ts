// Compras slice — UI state for received invoices (purchases)
// Actual data lives in SQLite (ComprasDatabase), this tracks UI state only

import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { Compra, ComprasMonthlyTotal, GmailSyncState } from '../../types/compras';
import { ComprasDatabase } from '../../services/compras/ComprasDatabase';
import {
  ComprasSyncManager,
  type ComprasSyncPreferredResult,
} from '../../services/compras/ComprasSyncManager';
import type { SyncDateRange } from '../../services/compras/GmailImportService';

// Progreso determinado ({current,total}) o null cuando no se conoce el total
// todavía (fase indeterminada — mismo contrato que Swift's syncProgress).
export type ComprasProgress = { current: number; total: number } | null;

interface ComprasState {
  // UI state
  loading: boolean;
  error: string | null;
  searchTerm: string;
  dateFrom: string | null;
  dateTo: string | null;
  selectedCompraId: string | null;
  // Cached data from SQLite (refreshed on load)
  compras: Compra[];
  ledgerCompras: Compra[];
  monthlyTotal: ComprasMonthlyTotal | null;
  // Gmail sync state per current company
  linkedGmailEmail: string | null;
  syncState: GmailSyncState | null;
  // Database initialized
  dbInitialized: boolean;
  // ── Manual sync progress (IMAP-preferred, Gmail fallback) ───────────────
  // Driven by the syncComprasNow thunk below. Mirrors the Swift shape
  // (isSyncing/syncProgress/isVerifyingAll/verifyProgress/newPurchasesCount)
  // so the same mental model applies across platforms.
  isSyncing: boolean;
  syncProgress: ComprasProgress;
  isVerifying: boolean;
  verifyProgress: ComprasProgress;
  newPurchasesCount: number;
  syncError: string | null;
}

const initialState: ComprasState = {
  loading: false,
  error: null,
  searchTerm: '',
  dateFrom: null,
  dateTo: null,
  selectedCompraId: null,
  compras: [],
  ledgerCompras: [],
  monthlyTotal: null,
  linkedGmailEmail: null,
  syncState: null,
  dbInitialized: false,
  isSyncing: false,
  syncProgress: null,
  isVerifying: false,
  verifyProgress: null,
  newPurchasesCount: 0,
  syncError: null,
};

// Thunks

export const initComprasDatabase = createAsyncThunk(
  'compras/initDatabase',
  async (_, { rejectWithValue }) => {
    try {
      await ComprasDatabase.init();
      return true;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to initialize compras database');
    }
  }
);

export const loadCompras = createAsyncThunk(
  'compras/load',
  async (companyId: string, { getState, rejectWithValue }) => {
    try {
      const state = getState() as { compras: ComprasState };
      const compras = await ComprasDatabase.getCompras({
        companyId,
        searchTerm: state.compras.searchTerm || undefined,
        dateFrom: state.compras.dateFrom || undefined,
        dateTo: state.compras.dateTo || undefined,
      });
      const ledgerCompras = await ComprasDatabase.getCompras({ companyId });

      const now = new Date();
      const monthlyTotal = await ComprasDatabase.getMonthlyTotals(
        companyId, now.getFullYear(), now.getMonth() + 1,
      );

      const gmailAccount = await ComprasDatabase.getLinkedGmail(companyId);

      return { compras, ledgerCompras, monthlyTotal, linkedGmailEmail: gmailAccount?.email ?? null };
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to load compras');
    }
  }
);

/**
 * Start/restart background compras sync for a company.
 * Resolves the source via ComprasSyncManager.syncPreferred — IMAP when the
 * company has stored credentials, Gmail as the fallback.
 * Call when company changes or sync frequency is updated.
 */
export const startComprasSync = createAsyncThunk(
  'compras/startSync',
  async (
    { companyId, frequencyMinutes }: { companyId: string; frequencyMinutes: number },
    { dispatch, rejectWithValue },
  ) => {
    try {
      await ComprasSyncManager.startForCompany(companyId, frequencyMinutes, (result, error) => {
        if (result && result.imported > 0) {
          // Refresh UI list after background sync imports new compras
          dispatch(loadCompras(companyId));
        }
        if (error) {
          console.warn('ComprasSync: background sync error', error);
        }
      });
      return { companyId, frequencyMinutes };
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to start sync');
    }
  }
);

/**
 * Stop background sync (on app teardown or explicit stop).
 */
export const stopComprasSync = createAsyncThunk(
  'compras/stopSync',
  async () => {
    ComprasSyncManager.stop();
    return true;
  }
);

export const deleteCompra = createAsyncThunk(
  'compras/delete',
  async ({ id, companyId }: { id: string; companyId: string }, { dispatch, rejectWithValue }) => {
    try {
      await ComprasDatabase.deleteCompra(id);
      dispatch(loadCompras(companyId));
      return id;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to delete compra');
    }
  }
);

/**
 * Updates a compra's link to a sales invoice/customer (or clears it when
 * unlinking — pass all three fields as null). Reloads the full compras list
 * from the DB afterward (race-free source of truth) while also patching
 * `compras`/`ledgerCompras` directly in the fulfilled reducer below so the
 * UI updates instantly without waiting on the reload round-trip.
 */
export const updateCompraLink = createAsyncThunk(
  'compras/updateLink',
  async (
    {
      id,
      companyId,
      link,
    }: {
      id: string;
      companyId: string;
      link: { linkedInvoiceId: string | null; linkedCustomerId: string | null; linkNote: string | null };
    },
    { dispatch, rejectWithValue },
  ) => {
    try {
      const updated = await ComprasDatabase.updateCompraLink(id, link);
      dispatch(loadCompras(companyId));
      return updated;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to update compra link');
    }
  }
);

const comprasSlice = createSlice({
  name: 'compras',
  initialState,
  reducers: {
    setSearchTerm(state, action: PayloadAction<string>) {
      state.searchTerm = action.payload;
    },
    setDateRange(state, action: PayloadAction<{ from: string | null; to: string | null }>) {
      state.dateFrom = action.payload.from;
      state.dateTo = action.payload.to;
    },
    setSelectedCompraId(state, action: PayloadAction<string | null>) {
      state.selectedCompraId = action.payload;
    },
    clearComprasError(state) {
      state.error = null;
    },
    clearComprasForCompany(state, action: PayloadAction<string>) {
      const companyId = action.payload;
      state.compras = state.compras.filter((compra) => compra.companyId !== companyId);
      if (state.syncState?.companyId === companyId) {
        state.syncState = null;
      }
      state.monthlyTotal = null;
      state.linkedGmailEmail = null;
      if (
        state.selectedCompraId &&
        !state.compras.some((compra) => compra.id === state.selectedCompraId)
      ) {
        state.selectedCompraId = null;
      }
    },
    // ── Manual sync progress reducers (used by syncComprasNow below) ───────
    comprasSyncStarted(state) {
      state.isSyncing = true;
      state.syncProgress = null;
      state.syncError = null;
      state.newPurchasesCount = 0;
    },
    setComprasSyncing(state, action: PayloadAction<boolean>) {
      state.isSyncing = action.payload;
    },
    setComprasSyncProgress(state, action: PayloadAction<ComprasProgress>) {
      state.syncProgress = action.payload;
    },
    setComprasVerifying(state, action: PayloadAction<boolean>) {
      state.isVerifying = action.payload;
    },
    setComprasVerifyProgress(state, action: PayloadAction<ComprasProgress>) {
      state.verifyProgress = action.payload;
    },
    comprasSyncFinished(
      state,
      action: PayloadAction<{ newPurchasesCount: number; error: string | null }>,
    ) {
      state.isSyncing = false;
      state.isVerifying = false;
      state.syncProgress = null;
      state.verifyProgress = null;
      state.newPurchasesCount = action.payload.newPurchasesCount;
      state.syncError = action.payload.error;
    },
    clearSyncError(state) {
      state.syncError = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(initComprasDatabase.fulfilled, (state) => {
        state.dbInitialized = true;
      })
      .addCase(initComprasDatabase.rejected, (state, action) => {
        state.error = action.payload as string;
      });

    builder
      .addCase(loadCompras.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(loadCompras.fulfilled, (state, action) => {
        state.loading = false;
        state.compras = action.payload.compras;
        state.ledgerCompras = action.payload.ledgerCompras;
        state.monthlyTotal = action.payload.monthlyTotal;
        state.linkedGmailEmail = action.payload.linkedGmailEmail;
      })
      .addCase(loadCompras.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });

    builder
      .addCase(deleteCompra.fulfilled, (state, action) => {
        state.compras = state.compras.filter(c => c.id !== action.payload);
        state.ledgerCompras = state.ledgerCompras.filter(c => c.id !== action.payload);
      });

    builder
      .addCase(updateCompraLink.fulfilled, (state, action) => {
        const updated = action.payload;
        if (!updated) return;
        state.compras = state.compras.map((c) => (c.id === updated.id ? updated : c));
        state.ledgerCompras = state.ledgerCompras.map((c) => (c.id === updated.id ? updated : c));
      });
  },
});

export const {
  setSearchTerm,
  setDateRange,
  setSelectedCompraId,
  clearComprasError,
  clearComprasForCompany,
  comprasSyncStarted,
  setComprasSyncing,
  setComprasSyncProgress,
  setComprasVerifying,
  setComprasVerifyProgress,
  comprasSyncFinished,
  clearSyncError,
} = comprasSlice.actions;

function resolveSyncErrorMessage(result: ComprasSyncPreferredResult): string | null {
  if (result.source === 'none') {
    return result.errorMessage ?? 'No hay una fuente de correo configurada. Ve a Ajustes de compras.';
  }
  if (result.authError) {
    return result.errorMessage ?? 'Error de autenticación. Vuelve a conectar tu cuenta de correo.';
  }
  if (result.quotaExceeded) {
    return result.errorMessage ?? 'Cuota diaria de Gmail API agotada.';
  }
  if (result.errors > 0 && result.imported === 0) {
    return result.errorMessage ?? `${result.errors} errores durante la sincronización`;
  }
  return null;
}

/**
 * Sincroniza compras usando la fuente preferida de la empresa (IMAP si hay
 * credenciales guardadas, Gmail como respaldo — ver ComprasSyncManager) y va
 * despachando el progreso a la slice mientras corre, para que
 * ComprasListPage renderice los banners `compras.syncingBanner` /
 * `compras.verifyingBanner`. Refresca la lista una vez que termina el
 * import y otra vez al terminar la verificación diferida.
 */
export const syncComprasNow = createAsyncThunk(
  'compras/syncNow',
  async (
    params: { companyId: string; dateRange?: SyncDateRange; isProduction?: boolean },
    { dispatch },
  ): Promise<ComprasSyncPreferredResult> => {
    const { companyId, dateRange, isProduction } = params;
    dispatch(comprasSyncStarted());

    // Anti-flicker / observability: the import phase over a fast source (local
    // IMAP, or an all-deduped re-sync) can finish in well under a frame, which
    // makes the determinate "Sincronizando… X de Y" bar flash-and-vanish (React
    // batches the rapid dispatches, so it may never even commit). Guarantee a
    // minimum perceptible window so users — and E2E — actually see it. Mirrors
    // Swift, where the streaming socket keeps the bar up during the network fetch.
    const MIN_SYNC_DISPLAY_MS = 600;
    const startedAt = Date.now();
    let lastTotal = 0;
    let verifyStarted = false;

    let result: ComprasSyncPreferredResult;
    try {
      result = await ComprasSyncManager.syncPreferred(companyId, {
        dateRange,
        isProduction,
        autoVerify: true,
        onProgress: (processed, total) => {
          if (total > 0) lastTotal = total;
          dispatch(setComprasSyncProgress(total > 0 ? { current: processed, total } : null));
        },
        onVerifyProgress: (current, total) => {
          if (total <= 0) return;
          if (current === 0) {
            verifyStarted = true;
            // El pase de import terminó y arranca la verificación diferida:
            // baja el banner de sync, levanta el banner (azul) de
            // verificación, y refresca ya para que las filas recién
            // importadas se vean mientras la verificación corre en MH.
            dispatch(setComprasSyncing(false));
            dispatch(setComprasSyncProgress(null));
            dispatch(setComprasVerifying(true));
            dispatch(loadCompras(companyId));
          }
          dispatch(setComprasVerifyProgress({ current, total }));
        },
      });
    } catch (error: any) {
      dispatch(
        comprasSyncFinished({
          newPurchasesCount: 0,
          error: error?.message ?? 'Error al sincronizar compras',
        }),
      );
      throw error;
    }

    // If the import phase never handed off to the verification banner (e.g. an
    // all-deduped re-sync with nothing new to verify), make sure the determinate
    // sync bar was actually committed and perceivable before we tear it down.
    if (!verifyStarted && lastTotal > 0) {
      dispatch(setComprasSyncProgress({ current: lastTotal, total: lastTotal }));
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_SYNC_DISPLAY_MS) {
        await new Promise((resolve) => setTimeout(resolve, MIN_SYNC_DISPLAY_MS - elapsed));
      }
    }

    dispatch(
      comprasSyncFinished({
        newPurchasesCount: result.imported,
        error: resolveSyncErrorMessage(result),
      }),
    );
    await dispatch(loadCompras(companyId));
    return result;
  },
);

export default comprasSlice.reducer;
