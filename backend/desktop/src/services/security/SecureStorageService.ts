// SecureStorageService — secrets (cert password, MH credentials, tokens).
//
// In Electron:   uses window.electronAPI.secure{Get,Set,Delete} which go
//                through safeStorage (macOS Keychain / Windows DPAPI /
//                libsecret) in the main process.
// In browser:    falls back to appStorage (electron-store IPC or localStorage).
//                This is acceptable for dev, but a warning is logged.

import { appStorage } from '../storage/ElectronStorage';

interface StoredCredentials {
  user: string;
  password: string;
  certificateKey?: string;
  invoiceNumber?: string;
}

export interface GmailCredentials {
  accessToken?: string;
  refreshToken?: string;
}

interface ElectronSecureApi {
  secureGet: (service: string, account: string) => Promise<string | null>;
  secureSet: (service: string, account: string, password: string) => Promise<boolean>;
  secureDelete: (service: string, account: string) => Promise<boolean>;
  secureIsAvailable?: () => Promise<boolean>;
}

function secureApi(): ElectronSecureApi | null {
  const w = typeof window !== 'undefined' ? (window as any) : null;
  const api = w?.electronAPI;
  if (
    api &&
    typeof api.secureGet === 'function' &&
    typeof api.secureSet === 'function' &&
    typeof api.secureDelete === 'function'
  ) {
    return api as ElectronSecureApi;
  }
  return null;
}

const SERVICE = 'SparkleWash';

async function setSecret(account: string, value: string): Promise<void> {
  const api = secureApi();
  if (api) {
    await api.secureSet(SERVICE, account, value);
    return;
  }
  await appStorage.setItem(`secure:${account}`, value);
}

async function getSecret(account: string): Promise<string | null> {
  const api = secureApi();
  if (api) {
    return api.secureGet(SERVICE, account);
  }
  return appStorage.getItem(`secure:${account}`);
}

async function deleteSecret(account: string): Promise<void> {
  const api = secureApi();
  if (api) {
    await api.secureDelete(SERVICE, account);
    return;
  }
  await appStorage.removeItem(`secure:${account}`);
}

export class SecureStorageService {
  private static readonly CERTIFICATE_PASSWORD_PREFIX = 'cert_password_';
  private static readonly CERTIFICATE_DATA_PREFIX = 'cert_data_';
  private static readonly COMPANY_CREDENTIALS_PREFIX = 'company_creds_';
  private static readonly GMAIL_CREDENTIALS_PREFIX = 'gmail_creds_';
  private static readonly AUTH_TOKEN_KEY = 'auth_token';
  private static readonly REFRESH_TOKEN_KEY = 'refresh_token';
  private static readonly SELECTED_COMPANY_KEY = 'selected_company';

  // ─── Certificate (password hash + XML) ────────────────────────────────────
  //
  // Hacienda issues a separate signing certificate for production. Same
  // scheme as the MH credentials below: test companies keep the original
  // NIT-only keys; production companies get their own and fall back to the
  // test company's until they save theirs. Saving one environment never
  // overwrites the other.

  private static envKey(prefix: string, nit: string, isProduction: boolean): string {
    return isProduction ? `${prefix}prod_${nit}` : `${prefix}${nit}`;
  }

  /**
   * Certificate keys: written under the digits-only NIT; read under every
   * spelling an older build may have used. company.nit is free text (users
   * type the dashes printed on their card) while every signer looks the
   * certificate up by the DTE emisor NIT (digits) — a certificate stored
   * under "0614-140494-134-2" was found only while the in-memory signer cache
   * was warm, so after a restart signing failed for those companies.
   */
  private static certKeys(prefix: string, nit: string, isProduction: boolean): string[] {
    const digits = nit.replace(/\D/g, '');
    const dashed = digits.length === 14
      ? `${digits.slice(0, 4)}-${digits.slice(4, 10)}-${digits.slice(10, 13)}-${digits.slice(13)}`
      : null;
    const spellings = [digits || nit, nit, dashed].filter((v): v is string => !!v);
    return [...new Set(spellings)].map((n) => this.envKey(prefix, n, isProduction));
  }

  private static async firstHit(
    keys: string[],
    read: (key: string) => Promise<string | null>,
  ): Promise<string | null> {
    for (const key of keys) {
      const value = await read(key);
      if (value) return value;
    }
    return null;
  }

  static async storeCertificatePassword(nit?: string, password?: string, isProduction = false): Promise<void> {
    if (!nit || !password) return;
    await setSecret(this.certKeys(this.CERTIFICATE_PASSWORD_PREFIX, nit, isProduction)[0], password);
  }

  static async getCertificatePassword(nit?: string, isProduction = false): Promise<string | null> {
    if (!nit) return null;
    const own = await this.firstHit(this.certKeys(this.CERTIFICATE_PASSWORD_PREFIX, nit, isProduction), getSecret);
    if (own || !isProduction) return own;
    return this.firstHit(this.certKeys(this.CERTIFICATE_PASSWORD_PREFIX, nit, false), getSecret);
  }

  static async removeCertificatePassword(nit?: string, isProduction = false): Promise<void> {
    if (!nit) return;
    for (const key of this.certKeys(this.CERTIFICATE_PASSWORD_PREFIX, nit, isProduction)) await deleteSecret(key);
  }

  static async storeCertificateData(nit: string, certificateXml: string, isProduction = false): Promise<void> {
    // Certificate XML itself isn't encrypted (it's the public cert + encrypted
    // private key), but we keep it through the same API for consistency.
    await appStorage.setItem(this.certKeys(this.CERTIFICATE_DATA_PREFIX, nit, isProduction)[0], certificateXml);
  }

  static async getCertificateData(nit: string, isProduction = false): Promise<string | null> {
    const read = (key: string) => appStorage.getItem(key);
    const own = await this.firstHit(this.certKeys(this.CERTIFICATE_DATA_PREFIX, nit, isProduction), read);
    if (own || !isProduction) return own;
    return this.firstHit(this.certKeys(this.CERTIFICATE_DATA_PREFIX, nit, false), read);
  }

  static async removeCertificateData(nit: string, isProduction = false): Promise<void> {
    for (const key of this.certKeys(this.CERTIFICATE_DATA_PREFIX, nit, isProduction)) await appStorage.removeItem(key);
  }

  /**
   * Whether a production company signs with the test company's certificate
   * because it never uploaded its own.
   */
  static async usesInheritedCertificate(nit?: string, isProduction = false): Promise<boolean> {
    if (!nit || !isProduction) return false;
    const read = (key: string) => appStorage.getItem(key);
    if (await this.firstHit(this.certKeys(this.CERTIFICATE_DATA_PREFIX, nit, true), read)) return false;
    return !!(await this.firstHit(this.certKeys(this.CERTIFICATE_DATA_PREFIX, nit, false), read));
  }

  // ─── Company Credentials (MH user + password) ────────────────────────────
  //
  // Hacienda's production API password is separate from the test one. Same
  // per-environment keys and production → test fallback as the certificate
  // (the copy-on-promote default the iOS app uses).

  private static credentialsKey(nit: string, isProduction: boolean): string {
    return this.envKey(this.COMPANY_CREDENTIALS_PREFIX, nit, isProduction);
  }

  private static async readCredentials(key: string): Promise<StoredCredentials | null> {
    const raw = await getSecret(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredCredentials;
    } catch {
      return null;
    }
  }

  static async storeCredentials(
    nit?: string,
    credentials?: StoredCredentials,
    isProduction = false,
  ): Promise<void> {
    if (!nit || !credentials) return;
    await setSecret(this.credentialsKey(nit, isProduction), JSON.stringify(credentials));
  }

  static async getCredentials(nit?: string, isProduction = false): Promise<StoredCredentials | null> {
    if (!nit) return null;
    const own = await this.readCredentials(this.credentialsKey(nit, isProduction));
    if (own || !isProduction) return own;
    return this.readCredentials(this.credentialsKey(nit, false));
  }

  /**
   * Whether a production company is using the test company's credentials
   * because it never saved its own.
   */
  static async usesInheritedCredentials(nit?: string, isProduction = false): Promise<boolean> {
    if (!nit || !isProduction) return false;
    if (await this.readCredentials(this.credentialsKey(nit, true))) return false;
    return !!(await this.readCredentials(this.credentialsKey(nit, false)));
  }

  static async removeCredentials(nit: string, isProduction = false): Promise<void> {
    await deleteSecret(this.credentialsKey(nit, isProduction));
  }

  // ─── Gmail Credentials ──────────────────────────────────────────────────

  static async setGmailCredentials(companyId: string, credentials: GmailCredentials): Promise<void> {
    await setSecret(`${this.GMAIL_CREDENTIALS_PREFIX}${companyId}`, JSON.stringify(credentials));
  }

  static async getGmailCredentials(companyId: string): Promise<GmailCredentials | null> {
    const raw = await getSecret(`${this.GMAIL_CREDENTIALS_PREFIX}${companyId}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as GmailCredentials;
    } catch {
      return null;
    }
  }

  static async removeGmailCredentials(companyId: string): Promise<void> {
    await deleteSecret(`${this.GMAIL_CREDENTIALS_PREFIX}${companyId}`);
  }

  // ─── Auth Token ───────────────────────────────────────────────────────────

  static async storeAuthToken(token: string): Promise<void> {
    await setSecret(this.AUTH_TOKEN_KEY, token);
  }

  static async getAuthToken(): Promise<string | null> {
    return getSecret(this.AUTH_TOKEN_KEY);
  }

  static async removeAuthToken(): Promise<void> {
    await deleteSecret(this.AUTH_TOKEN_KEY);
  }

  // ─── Refresh Token ────────────────────────────────────────────────────────

  static async storeRefreshToken(token: string): Promise<void> {
    await setSecret(this.REFRESH_TOKEN_KEY, token);
  }

  static async getRefreshToken(): Promise<string | null> {
    return getSecret(this.REFRESH_TOKEN_KEY);
  }

  static async removeRefreshToken(): Promise<void> {
    await deleteSecret(this.REFRESH_TOKEN_KEY);
  }

  // ─── Current Company (not secret) ─────────────────────────────────────────

  static async setCurrentCompanyNit(nit: string): Promise<void> {
    await appStorage.setItem(this.SELECTED_COMPANY_KEY, nit);
  }

  static async getCurrentCompanyNit(): Promise<string | null> {
    return appStorage.getItem(this.SELECTED_COMPANY_KEY);
  }

  // ─── Clear ────────────────────────────────────────────────────────────────

  static async clearCompanyData(nit: string, isProduction = false): Promise<void> {
    await this.removeCredentials(nit, isProduction);
    await this.removeCertificatePassword(nit, isProduction);
    await this.removeCertificateData(nit, isProduction);
  }

  static async clearAllData(): Promise<void> {
    const prefixes = [
      this.CERTIFICATE_PASSWORD_PREFIX,
      this.CERTIFICATE_DATA_PREFIX,
      this.COMPANY_CREDENTIALS_PREFIX,
      this.GMAIL_CREDENTIALS_PREFIX,
    ];
    const allKeys = await appStorage.getAllKeys();
    const keysToRemove = allKeys.filter(
      (key) => prefixes.some((p) => key.startsWith(p)) || key.startsWith('secure:'),
    );
    for (const k of keysToRemove) {
      await appStorage.removeItem(k);
    }
    await this.removeAuthToken();
    await this.removeRefreshToken();
    await appStorage.removeItem(this.SELECTED_COMPANY_KEY);
  }

  // ─── Diagnostics ──────────────────────────────────────────────────────────

  /** True when secrets are protected by the OS keychain (safeStorage). */
  static async isKeychainAvailable(): Promise<boolean> {
    const api = secureApi();
    if (api?.secureIsAvailable) {
      try {
        return await api.secureIsAvailable();
      } catch {
        return false;
      }
    }
    return false;
  }

  static async initializeAndTest(): Promise<{ success: boolean; message: string }> {
    try {
      await setSecret('__fs_secret_test', '1');
      const round = await getSecret('__fs_secret_test');
      await deleteSecret('__fs_secret_test');
      const ok = round === '1';
      const via = secureApi() ? 'safeStorage' : 'appStorage (degraded)';
      return { success: ok, message: `secure storage via ${via}` };
    } catch (e) {
      return { success: false, message: String(e) };
    }
  }
}
