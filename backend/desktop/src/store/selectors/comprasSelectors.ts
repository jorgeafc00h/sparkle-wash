import { createSelector } from '@reduxjs/toolkit';
import { RootState } from '../index';

export const selectComprasState = (state: RootState) => state.compras;

export const selectAllCompras = createSelector(
  [selectComprasState],
  (state) => state.compras,
);

export const selectLedgerCompras = createSelector(
  [selectComprasState],
  (state) => state.ledgerCompras.length > 0 ? state.ledgerCompras : state.compras,
);

export const selectComprasLoading = createSelector(
  [selectComprasState],
  (state) => state.loading,
);

export const selectComprasMonthlyTotal = createSelector(
  [selectComprasState],
  (state) => state.monthlyTotal,
);

export const selectLinkedGmailEmail = createSelector(
  [selectComprasState],
  (state) => state.linkedGmailEmail,
);

export const selectGmailSyncState = createSelector(
  [selectComprasState],
  (state) => state.syncState,
);

// ── Manual sync progress (IMAP-preferred, Gmail fallback) ──────────────────

export const selectComprasIsSyncing = createSelector(
  [selectComprasState],
  (state) => state.isSyncing,
);

export const selectComprasSyncProgress = createSelector(
  [selectComprasState],
  (state) => state.syncProgress,
);

export const selectComprasIsVerifying = createSelector(
  [selectComprasState],
  (state) => state.isVerifying,
);

export const selectComprasVerifyProgress = createSelector(
  [selectComprasState],
  (state) => state.verifyProgress,
);

export const selectComprasNewPurchasesCount = createSelector(
  [selectComprasState],
  (state) => state.newPurchasesCount,
);

export const selectComprasSyncError = createSelector(
  [selectComprasState],
  (state) => state.syncError,
);
