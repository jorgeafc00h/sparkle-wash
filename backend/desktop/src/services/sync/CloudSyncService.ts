// Azure Cloud Sync Service
// Replaces Firebase sync — uses Azure API endpoints with internal app JWT auth

import axios from 'axios';
import { getApiConfig } from '../../config/api';
import { API_CONFIG } from '../../config/api';
import { isViteProduction } from '@/config/viteEnv';
import AuthProviderService from '../auth/AuthProviderService';

// ── Types ─────────────────────────────────────────────────────────────────

export interface SyncStatus {
  lastSyncDate?: string;
  totalInvoices: number;
  totalCustomers: number;
  totalCompanies: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function isProduction(): boolean {
  return isViteProduction();
}

function getBaseUrl(): string {
  return getApiConfig(isProduction()).baseUrl;
}

async function getHeaders(): Promise<Record<string, string>> {
  const appToken = await AuthProviderService.getFreshToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'apiKey': API_CONFIG.apiKey,
  };
  if (appToken) {
    headers['Authorization'] = `Bearer ${appToken}`;
  }
  return headers;
}

/**
 * Canonical table name convention: use the company's NIT prefixed with "co".
 * Azure Table names must be alphanumeric, so punctuation is stripped.
 */
export function getTableName(companyNit: string): string {
  const sanitized = companyNit.replace(/[^a-zA-Z0-9]/g, '');
  return `co${sanitized}`;
}

/**
 * Migration fallback for legacy records written before app accounts were
 * company-scoped. New sync writes should not use this.
 */
export function getLegacyUserTableName(googleId: string): string {
  return `user${googleId.replace(/[^a-zA-Z0-9]/g, '')}`;
}

// ── Service ───────────────────────────────────────────────────────────────

const CloudSyncService = {
  async syncInvoice(invoice: unknown, tableName: string): Promise<void> {
    await axios.post(
      `${getBaseUrl()}/sync/invoice/${tableName}`,
      invoice,
      { headers: await getHeaders(), timeout: API_CONFIG.timeout },
    );
  },

  async syncCustomer(customer: unknown, tableName: string): Promise<void> {
    await axios.post(
      `${getBaseUrl()}/sync/customer/${tableName}`,
      customer,
      { headers: await getHeaders(), timeout: API_CONFIG.timeout },
    );
  },

  async syncCompany(company: unknown, tableName: string): Promise<void> {
    await axios.post(
      `${getBaseUrl()}/sync/company/${tableName}`,
      company,
      { headers: await getHeaders(), timeout: API_CONFIG.timeout },
    );
  },

  async batchSync(
    data: { invoices: unknown[]; customers: unknown[]; companies: unknown[] },
    tableName: string,
  ): Promise<void> {
    await axios.post(
      `${getBaseUrl()}/sync/batch/${tableName}`,
      data,
      { headers: await getHeaders(), timeout: API_CONFIG.timeout },
    );
  },

  async getSyncStatus(userId: string): Promise<SyncStatus> {
    const resp = await axios.get<SyncStatus>(
      `${getBaseUrl()}/sync/status`,
      {
        headers: { ...(await getHeaders()), userId },
        timeout: API_CONFIG.timeout,
      },
    );
    return resp.data;
  },

  async deleteInvoice(tableName: string, partitionKey: string, rowKey: string): Promise<void> {
    await axios.delete(
      `${getBaseUrl()}/sync/invoice/${tableName}/${partitionKey}/${rowKey}`,
      { headers: await getHeaders(), timeout: API_CONFIG.timeout },
    );
  },

  async deleteCustomer(tableName: string, partitionKey: string, rowKey: string): Promise<void> {
    await axios.delete(
      `${getBaseUrl()}/sync/customer/${tableName}/${partitionKey}/${rowKey}`,
      { headers: await getHeaders(), timeout: API_CONFIG.timeout },
    );
  },
};

export default CloudSyncService;
