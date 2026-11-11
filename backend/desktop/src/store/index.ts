// Redux store configuration — Desktop version

import { configureStore } from '@reduxjs/toolkit';
import { TypedUseSelectorHook, useDispatch, useSelector } from 'react-redux';
import { persistStore, FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER } from 'redux-persist';

// Persistence
import { rootReducer } from './persistence';

// Middleware
import { networkMiddleware } from './middleware/networkMiddleware';
import { syncMiddleware } from './middleware/syncMiddleware';
import { syncCaptureMiddleware, installComprasCapture, installTicketCapture } from '../services/sync/capture';
import AuthProviderService from '../services/auth/AuthProviderService';
import { updateSessionToken } from './slices/authSlice';
import { ticketConsolidationMiddleware } from './middleware/ticketConsolidationMiddleware';
import { auditCaptureMiddleware, installAuditCapture } from '../services/localUsers/auditCapture';
import { setCompanyIdentityResolver } from '../services/compras/receptorMatch';
import { getDeviceId } from '../services/sync/deviceId';

// Warm the Device Sync device id: product stock changes are recorded in each
// product's convergent ledger under it (productSlice reads it synchronously).
void getDeviceId().catch(() => undefined);

export const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [
          FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER,
          'persist/PERSIST',
          'persist/REHYDRATE',
          'persist/REGISTER',
        ],
        ignoredActionsPaths: ['meta.arg', 'payload.timestamp'],
        ignoredPaths: ['app.notifications'],
      },
      immutableCheck: {
        warnAfter: 128,
      },
    })
    .concat(networkMiddleware)
    .concat(syncMiddleware)
    .concat(syncCaptureMiddleware)
    .concat(ticketConsolidationMiddleware)
    .concat(auditCaptureMiddleware),
  devTools: import.meta.env.DEV,
});

export const persistor = persistStore(store);

// Device Sync v2: compras and POS tickets live in appStorage databases, so their
// local writes reach the outbox through each database's change listener, not the
// Redux middleware.
installComprasCapture(store);
installTicketCapture(store);
// Local audit log: who created/modified what (tickets + compras via their DB listeners).
installAuditCapture(store);
// Compras email import skips DTEs addressed to another NIT/NRC — background
// syncs have no company object at hand, so they resolve it from the store.
setCompanyIdentityResolver((companyId) => {
  const company = store.getState().companies.companies.find((c) => c.id === companyId);
  return company ? { nit: company.nit, nrc: company.nrc } : null;
});

// A renewed internal JWT (AuthProviderService.getFreshToken) replaces the in-memory one.
AuthProviderService.onSessionTokenRenewed((token) => store.dispatch(updateSessionToken(token)));

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// Typed hooks for React components
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

// Selectors
export * from './selectors/authSelectors';
export * from './selectors/companySelectors';
export * from './selectors/invoiceSelectors';
export * from './selectors/customerSelectors';
export * from './selectors/productSelectors';
export * from './selectors/catalogSelectors';
export * from './selectors/appSelectors';
export * from './selectors/subscriptionSelectors';
export * from './selectors/comprasSelectors';
export * from './selectors/accountsSelectors';
export * from './selectors/localUsersSelectors';

export default store;
