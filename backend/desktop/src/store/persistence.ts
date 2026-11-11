// Redux persistence configuration — Desktop version
// Swaps AsyncStorage for localStorage (redux-persist default web storage)

import { electronPersistStorage as storage } from '../services/storage/ElectronStorage';
import { persistReducer, persistStore, type PersistedState } from 'redux-persist';
import { combineReducers } from '@reduxjs/toolkit';

// Import slices
import authSlice from './slices/authSlice';
import appSlice from './slices/appSlice';
import companySlice from './slices/companySlice';
import invoiceReducer from './slices/invoiceSlice';
import customerReducer from './slices/customerSlice';
import productSlice from './slices/productSlice';
import catalogSlice from './slices/catalogSlice';
import subscriptionSlice from './slices/subscriptionSlice';
import comprasSlice from './slices/comprasSlice';
import accountsSlice from './slices/accountsSlice';
import syncV2Slice from './slices/syncV2Slice';
import localUsersSlice from './slices/localUsersSlice';
import auditSlice from './slices/auditSlice';
import carwashSlice from './slices/carwashSlice';

// Auth persist config
// Persist user profile, auth flags, selected company, and linked providers.
// The internal app JWT is stored separately by AuthProviderService in appStorage.
const authPersistConfig = {
  key: 'auth',
  storage,
  whitelist: ['user', 'selectedCompanyId', 'isAuthenticated', 'isGuestMode', 'hasCompletedOnboarding', 'linkedProviders'],
  blacklist: ['token', 'refreshToken', 'loading', 'error', 'providerLinking'],
};

// App persist config
const appPersistConfig = {
  key: 'app',
  storage,
  whitelist: ['currentTheme', 'language', 'lastSyncDate'],
  blacklist: ['notifications', 'isOnline'],
};

// Company persist config
const companyPersistConfig = {
  key: 'companies',
  storage,
  whitelist: ['companies', 'selectedCompanyId'],
  blacklist: ['loading', 'error'],
};

// Catalog persist config
const catalogPersistConfig = {
  key: 'catalogs',
  storage,
  whitelist: ['catalogs', 'syncInfo', 'lastFullSync'],
  blacklist: ['loading', 'error', 'searchTerm', 'filters'],
};

const customerPersistConfig = {
  key: 'customers',
  storage,
  whitelist: ['customers', 'selectedCustomerId', 'lastUpdatedAt'],
  blacklist: ['loading', 'error', 'searchTerm'],
};

const invoicePersistConfig = {
  key: 'invoices',
  storage,
  whitelist: ['invoices', 'selectedInvoiceId', 'pendingSync', 'lastSyncDate'],
  blacklist: ['loading', 'error', 'searchTerm'],
};

const productPersistConfig = {
  key: 'products',
  storage,
  whitelist: ['products', 'stockMovements', 'categories', 'brands', 'suppliers', 'currentProduct'],
  blacklist: ['loading', 'error', 'searchTerm', 'filters'],
};

const subscriptionPersistConfig = {
  key: 'subscription',
  storage,
  whitelist: ['tier', 'activeSubscription', 'accountEntitlement', 'syncTrialUsed'],
  blacklist: ['loading', 'error', 'purchaseInProgress', 'trialStarting', 'isInitialized', 'availableProducts'],
};

// Device Sync v2: epoch/cursor/outbox/versions must survive restarts (an edit captured
// before the app closes is still pushed next session), and so do the proven company
// claims ("empresa vinculada"). Presence, session status and the registered-device
// list are runtime-only. Throttled so capture bursts coalesce into one app-storage write.
const syncV2PersistConfig = {
  key: 'syncV2',
  storage,
  // v2: sessions are burst-based — a persisted always-on autoSync opt-in from the
  // session era must not keep opening background sessions. Everyone starts manual and
  // re-enables "Automático" (offered for multi-device companies only, anyway).
  version: 2,
  // redux-persist runs migrate on every rehydrate, so the one-time reset is keyed on
  // the STORED version: everything older than v2 was written by the always-on session
  // era and restarts manual (the stored _persist.version is preserved by createMigrate
  // semantics — see redux-persist's own version comparison).
  migrate: (state: unknown): Promise<PersistedState> => {
    if (!state || typeof state !== 'object') return Promise.resolve(state as PersistedState);
    const typed = state as { _persist?: { version?: number }; autoSync?: boolean };
    if ((typed._persist?.version ?? -1) >= 2) return Promise.resolve(typed as PersistedState);
    return Promise.resolve({
      ...typed,
      autoSync: false,
      _persist: { ...typed._persist, version: 2, rehydrated: true },
    } as PersistedState);
  },
  whitelist: ['deviceId', 'autoSync', 'entitled', 'companies', 'claims'],
  blacklist: ['status', 'lastError', 'onlineByCo', 'claiming', 'registeredDevices'],
  throttle: 300,
};

export const syncV2PersistWhitelistForTests: readonly string[] = syncV2PersistConfig.whitelist;

const accountsPersistConfig = {
  key: 'accounts',
  storage,
  whitelist: ['entries', 'payments', 'lastUpdatedAt'],
  blacklist: ['searchTerm', 'statusFilter', 'activeDirection', 'error'],
};

// Local users: the directory (owner + users + PIN hashes) persists; the active
// session does not — the app starts locked whenever user control is on.
const localUsersPersistConfig = {
  key: 'localUsers',
  storage,
  whitelist: ['enabled', 'owner', 'users'],
  blacklist: ['activeUserId'],
};

// Local audit trail (who created/modified what). Device-local by design: it is a
// separate persisted slice, never part of a synced entity payload. Throttled —
// a bulk write (e.g. 55 production-access invoices) lands as one storage write.
const auditPersistConfig = {
  key: 'audit',
  storage,
  whitelist: ['stamps', 'events'],
  throttle: 500,
};

// Create root reducer with persistence
const rootReducer = combineReducers({
  auth: persistReducer(authPersistConfig, authSlice),
  app: persistReducer(appPersistConfig, appSlice),
  companies: persistReducer(companyPersistConfig, companySlice),
  invoices: persistReducer(invoicePersistConfig, invoiceReducer),
  customers: persistReducer(customerPersistConfig, customerReducer),
  products: persistReducer(productPersistConfig, productSlice),
  catalogs: persistReducer(catalogPersistConfig, catalogSlice),
  subscription: persistReducer(subscriptionPersistConfig, subscriptionSlice),
  accounts: persistReducer(accountsPersistConfig, accountsSlice),
  syncV2: persistReducer(syncV2PersistConfig, syncV2Slice),
  localUsers: persistReducer(localUsersPersistConfig, localUsersSlice),
  audit: persistReducer(auditPersistConfig, auditSlice),
  // SparkleWash workboard cache (jobs bounded to 300, catalog, employees) so it renders offline.
  // The session token and sync status are runtime-only (secure storage owns the token).
  carwash: persistReducer({
    key: 'carwash',
    storage,
    whitelist: ['packages', 'employees', 'jobs', 'summary'],
  }, carwashSlice),
  compras: persistReducer({
    key: 'compras',
    storage,
    whitelist: ['compras', 'monthlyTotal', 'dbInitialized'],
    blacklist: ['loading', 'error', 'searchTerm', 'dateFrom', 'dateTo', 'selectedCompraId', 'linkedGmailEmail', 'syncState'],
  }, comprasSlice),
});

export { rootReducer };

export const createPersistor = (store: Parameters<typeof persistStore>[0]) => {
  return persistStore(store);
};
