// Sync middleware — Desktop version
// Monitors Redux actions and triggers Azure cloud sync for Pro users with app auth

import type { Middleware } from '@reduxjs/toolkit';
import { setSyncStatus, addNotification } from '../slices/appSlice';
import CloudSyncService, { getTableName } from '../../services/sync/CloudSyncService';
import AuthProviderService from '../../services/auth/AuthProviderService';
import { selectCurrentTier } from '../selectors/subscriptionSelectors';
import { canUseAzureSync } from '../../services/subscription/FeatureGate';
import type { RootState } from '../index';
import type { Company } from '../../types';

// Actions that trigger sync
const SYNC_TRIGGERS = [
  'invoices/createInvoice/fulfilled',
  'invoices/updateInvoice/fulfilled',
  'companies/createCompany/fulfilled',
  'companies/updateCompany/fulfilled',
  'customers/createCustomer/fulfilled',
  'customers/updateCustomerAsync/fulfilled',
  'products/createProduct/fulfilled',
  'products/updateProduct/fulfilled',
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const syncMiddleware: Middleware = (store) => (next) => (action: any) => {
  const result = next(action);

  if (typeof action === 'object' && action !== null && 'type' in action) {
    const actionType = action.type as string;
    if (SYNC_TRIGGERS.includes(actionType)) {
      void syncToCloud(actionType, action.payload, store.dispatch, store.getState as () => RootState);
    }
  }

  return result;
};

function asRecord(payload: unknown): Record<string, unknown> | null {
  return typeof payload === 'object' && payload !== null
    ? payload as Record<string, unknown>
    : null;
}

function resolveCompanyForSync(actionType: string, payload: unknown, state: RootState): Company | null {
  const record = asRecord(payload);

  if (actionType.startsWith('companies/') && record?.nit) {
    return payload as Company;
  }

  const companyId = typeof record?.companyId === 'string' ? record.companyId : null;
  if (companyId) {
    const company = state.companies.companies.find((candidate) => candidate.id === companyId);
    if (company) return company;
  }

  if (state.companies.currentCompany) return state.companies.currentCompany;
  if (state.companies.selectedCompanyId) {
    return state.companies.companies.find(
      (candidate) => candidate.id === state.companies.selectedCompanyId,
    ) ?? null;
  }

  return null;
}

async function syncToCloud(
  actionType: string,
  payload: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dispatch: any,
  getState: () => RootState,
) {
  try {
    // Gate: Pro ($7) or Business ($14) tier — per subscriptionConfig.ts:19-27
    const tier = selectCurrentTier(getState());
    if (!canUseAzureSync(tier)) return;

    // Gate: must have an internal app JWT
    const appToken = await AuthProviderService.getFreshToken(getState().auth.token);
    if (!appToken) return;

    const company = resolveCompanyForSync(actionType, payload, getState());
    const companyKey = company?.nit ?? company?.id;
    if (!companyKey) return;

    const tableName = getTableName(companyKey);

    dispatch(setSyncStatus('syncing'));

    if (actionType.startsWith('invoices/')) {
      await CloudSyncService.syncInvoice(payload, tableName);
    } else if (actionType.startsWith('companies/')) {
      await CloudSyncService.syncCompany(payload, tableName);
    } else if (actionType.startsWith('customers/')) {
      await CloudSyncService.syncCustomer(payload, tableName);
    } else if (actionType.startsWith('products/')) {
      // Products don't have a dedicated sync endpoint — skip silently
    }

    dispatch(setSyncStatus('success'));
  } catch (error) {
    console.warn('Cloud sync failed:', error);
    dispatch(setSyncStatus('error'));
    dispatch(addNotification({
      title: 'Error de sincronización',
      message: 'No se pudo sincronizar con la nube',
      type: 'error',
      read: false,
    }));
  }
}
