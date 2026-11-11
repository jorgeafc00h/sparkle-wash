// CarwashSettingsStore — settings in appStorage; the staff session token in the OS
// keychain when available (SecureStorage falls back to appStorage in browser/tests).
//
// NOTE: the API's SPARKLEWASH_GOOGLE_CLIENT_ID must include this desktop app's
// Google client id, or POST /api/auth/google answers 401 for desktop sign-ins.

import { appStorage } from '../storage/ElectronStorage';
import { getViteEnv } from '@/config/viteEnv';
import { DEFAULT_CARWASH_SETTINGS, type CarwashSession, type CarwashSettings } from './types';
import { normalizeRegisterCode } from './workTicketNumber';

export const CARWASH_SETTINGS_KEY = 'carwash_settings_v1';
export const CARWASH_SESSION_ACCOUNT = 'carwash_session';
const SECURE_SERVICE = 'SparkleWash';

export function defaultCarwashSettings(): CarwashSettings {
  const envUrl = (getViteEnv() as Record<string, unknown>).VITE_SPARKLEWASH_API_URL;
  return {
    ...DEFAULT_CARWASH_SETTINGS,
    apiBaseUrl: typeof envUrl === 'string' && envUrl.trim() ? envUrl.trim().replace(/\/+$/, '') : DEFAULT_CARWASH_SETTINGS.apiBaseUrl,
  };
}

export function sanitizeCarwashSettings(input: Partial<CarwashSettings> | null | undefined): CarwashSettings {
  const base = defaultCarwashSettings();
  const src = input ?? {};
  const apiBaseUrl = typeof src.apiBaseUrl === 'string' && src.apiBaseUrl.trim() ? src.apiBaseUrl.trim().replace(/\/+$/, '') : base.apiBaseUrl;
  const copies = Number(src.workTicketCopies);
  const poll = Number(src.pollSeconds);
  return {
    apiBaseUrl,
    registerCode: src.registerCode !== undefined ? normalizeRegisterCode(src.registerCode) : base.registerCode,
    autoPrintWorkTicket: typeof src.autoPrintWorkTicket === 'boolean' ? src.autoPrintWorkTicket : base.autoPrintWorkTicket,
    workTicketCopies: Number.isFinite(copies) ? Math.min(3, Math.max(1, Math.round(copies))) : base.workTicketCopies,
    workTicketFooter: typeof src.workTicketFooter === 'string' ? src.workTicketFooter.slice(0, 200) : base.workTicketFooter,
    pollSeconds: Number.isFinite(poll) ? Math.min(300, Math.max(5, Math.round(poll))) : base.pollSeconds,
  };
}

interface ElectronSecureApi {
  secureGet: (service: string, account: string) => Promise<string | null>;
  secureSet: (service: string, account: string, value: string) => Promise<boolean>;
  secureDelete: (service: string, account: string) => Promise<boolean>;
}

function secureApi(): ElectronSecureApi | null {
  const api = typeof window !== 'undefined' ? (window as unknown as { electronAPI?: Partial<ElectronSecureApi> }).electronAPI : undefined;
  if (api && typeof api.secureGet === 'function' && typeof api.secureSet === 'function' && typeof api.secureDelete === 'function') {
    return api as ElectronSecureApi;
  }
  return null;
}

export async function loadCarwashSettings(): Promise<CarwashSettings> {
  try {
    const raw = await appStorage.getItem(CARWASH_SETTINGS_KEY);
    return sanitizeCarwashSettings(raw ? (JSON.parse(raw) as Partial<CarwashSettings>) : null);
  } catch {
    return defaultCarwashSettings();
  }
}

export async function saveCarwashSettings(settings: CarwashSettings): Promise<CarwashSettings> {
  const clean = sanitizeCarwashSettings(settings);
  await appStorage.setItem(CARWASH_SETTINGS_KEY, JSON.stringify(clean));
  return clean;
}

export async function loadCarwashSession(): Promise<CarwashSession | null> {
  try {
    const api = secureApi();
    const raw = api
      ? await api.secureGet(SECURE_SERVICE, CARWASH_SESSION_ACCOUNT)
      : await appStorage.getItem(`secure:${CARWASH_SESSION_ACCOUNT}`);
    if (!raw) return null;
    const session = JSON.parse(raw) as CarwashSession;
    if (!session?.sessionToken || typeof session.sessionToken !== 'string') return null;
    const expires = Date.parse(session.expiresAt);
    if (Number.isFinite(expires) && expires <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export async function saveCarwashSession(session: CarwashSession): Promise<void> {
  const raw = JSON.stringify(session);
  const api = secureApi();
  if (api) await api.secureSet(SECURE_SERVICE, CARWASH_SESSION_ACCOUNT, raw);
  else await appStorage.setItem(`secure:${CARWASH_SESSION_ACCOUNT}`, raw);
}

export async function clearCarwashSession(): Promise<void> {
  try {
    const api = secureApi();
    if (api) await api.secureDelete(SECURE_SERVICE, CARWASH_SESSION_ACCOUNT);
    else await appStorage.removeItem(`secure:${CARWASH_SESSION_ACCOUNT}`);
  } catch {
    /* nothing to clear */
  }
}
