// Production wiring for the Device Sync v2 engine on Desktop: @microsoft/signalr for
// /hubs/sync, fetch for the REST fallback, the internal app JWT from AuthProviderService,
// and the relay origin from VITE_SYNC_API_URL.
//
// The hub connection skips the HTTP negotiate and goes straight to WebSockets: browsers
// (Electron's app:// renderer and the web build) apply CORS to fetch but not to
// WebSockets, so the hub never depends on the relay's CORS policy. The upgrade request is
// still HTTP, so it wakes the scale-to-zero container exactly like negotiate would.
// Playwright seeds `fs_sync_v2_test` in localStorage to point at a local relay.

import { HttpTransportType, HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { getViteEnv } from '@/config/viteEnv';
import AuthProviderService from '../auth/AuthProviderService';
import { store } from '../../store';
import pkg from '../../../package.json';
import { isHubError, companySyncKey, type ChangeEnvelope, type DeviceManifest, type PushResponse, type SyncStatusResponse } from './protocol';
import { SyncV2Engine, type HubConnectionLike, type SyncRestClient, type SyncV2Environment } from './syncV2Service';
import { SyncBurstController } from './syncBurstController';
import { canUseDeviceSync } from '../subscription/FeatureGate';
import { isCompanyClaimed, type SyncV2State } from '../../store/slices/syncV2Slice';
import { fetchRegisteredSyncDevices, type SyncDevicesResult } from './syncDevicesService';
import { onOutboxChanged } from './capture';
import type { Company } from '@/types';

export interface SyncV2TestOverrides {
  baseUrl?: string;
  token?: string;
  staggerMaxMs?: number;
  flushDebounceMs?: number;
}

export const SYNC_V2_TEST_STORAGE_KEY = 'fs_sync_v2_test';

const readTestOverrides = (): SyncV2TestOverrides => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SYNC_V2_TEST_STORAGE_KEY) : null;
    return raw ? (JSON.parse(raw) as SyncV2TestOverrides) : {};
  } catch {
    return {};
  }
};

export const getSyncV2BaseUrl = (): string =>
  readTestOverrides().baseUrl ?? (getViteEnv().VITE_SYNC_API_URL as string | undefined)?.trim() ?? '';

export const createSignalRConnection = (hubUrl: string, accessTokenFactory: () => Promise<string>): HubConnectionLike =>
  new HubConnectionBuilder()
    .withUrl(hubUrl, {
      accessTokenFactory,
      transport: HttpTransportType.WebSockets,
      skipNegotiation: true,
    })
    .withAutomaticReconnect([0, 2_000, 5_000, 10_000, 30_000])
    .configureLogging(LogLevel.Warning)
    .build() as unknown as HubConnectionLike;

export const createFetchRestClient = (baseUrl: string, getToken: () => Promise<string | null>): SyncRestClient => {
  const origin = baseUrl.replace(/\/+$/, '');
  const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const token = await getToken();
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 401 || response.status === 403) {
      return { error: response.status === 403 ? 'forbidden' : 'unauthorized' } as T;
    }
    if (response.status === 429) return { error: 'rate_limited' } as T;
    if (!response.ok) throw new Error(`Sync HTTP ${response.status}`);
    return (await response.json()) as T;
  };

  return {
    push: async (co: string, changes: ChangeEnvelope[]) =>
      // A 401/403 comes back as { error } — the engine treats it like a hub authz error.
      request<PushResponse>('POST', `/api/v2/sync/${co}/push`, { co, changes }),
    status: async (co: string): Promise<SyncStatusResponse> => {
      const result = await request<unknown>('GET', `/api/v2/sync/${co}/status`);
      if (isHubError(result)) throw new Error(result.error);
      return result as SyncStatusResponse;
    },
    putDevice: async (co: string, manifest: DeviceManifest) => {
      await request('PUT', `/api/v2/sync/${co}/devices/${encodeURIComponent(manifest.deviceId)}`, manifest);
    },
  };
};

export const createDefaultSyncEnvironment = (): SyncV2Environment => {
  const overrides = readTestOverrides();
  return {
    baseUrl: getSyncV2BaseUrl(),
    getToken: async () => overrides.token ?? (await AuthProviderService.getFreshToken()),
    createConnection: createSignalRConnection,
    createRestClient: createFetchRestClient,
    platform: 'desktop',
    appVersion: pkg.version,
    staggerMaxMs: overrides.staggerMaxMs ?? 30_000,
    flushDebounceMs: overrides.flushDebounceMs ?? 2_000,
    now: () => new Date(),
    random: Math.random,
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
};

let engine: SyncV2Engine | null = null;

/** App-wide engine bound to the Redux store (one relay session at a time). */
export const getSyncV2Engine = (): SyncV2Engine => {
  if (!engine) engine = new SyncV2Engine(store, createDefaultSyncEnvironment());
  return engine;
};

/** Test/support hook: rebuild the engine after overrides change. */
export const resetSyncV2EngineForTests = (): void => {
  engine = null;
  burstController = null;
};

// ─── burst session policy (Phase 2) ───

/** Structural subset of RootState the burst gating reads (kept loose for Jest). */
interface BurstGatingState {
  auth: { isAuthenticated: boolean };
  subscription?: { tier?: string };
  syncV2?: SyncV2State;
  companies: { currentCompany: Company | null };
}

/**
 * Background bursts need a company the account PROVED to the backend (claim) —
 * anything else would open a session the relay refuses. Guests hold no JWT, so
 * only an authenticated session qualifies.
 */
const isBackgroundSyncEligible = (): boolean => {
  const state = store.getState() as BurstGatingState;
  if (!state.auth?.isAuthenticated) return false;
  const company = state.companies?.currentCompany;
  const co = companySyncKey(company);
  if (!co) return false;
  if (!(canUseDeviceSync(state.subscription?.tier) || state.syncV2?.entitled)) return false;
  return isCompanyClaimed(state.syncV2?.claims ?? {}, company);
};

/** "Automático" is armed only when enabled AND the company has more than one device. */
const isAutoSyncArmed = (): boolean => {
  const state = store.getState() as BurstGatingState;
  const sync = state.syncV2;
  if (!sync?.autoSync) return false;
  const co = companySyncKey(state.companies?.currentCompany);
  if (!co) return false;
  return (sync.registeredDevices[co]?.length ?? 0) > 1;
};

let burstController: SyncBurstController | null = null;

/** App-wide burst controller (mounted once by useSyncV2Lifecycle). */
export const getSyncBurstController = (): SyncBurstController => {
  if (!burstController) {
    burstController = new SyncBurstController({
      engine: getSyncV2Engine(),
      isBackgroundEligible: isBackgroundSyncEligible,
      isAutoArmed: isAutoSyncArmed,
      onOutboxChanged,
    });
  }
  return burstController;
};

/**
 * Devices the relay knows for `co` (GET /api/sync/devices) with this install's
 * credentials — the test overrides' token when seeded, the internal JWT otherwise.
 * Any failure resolves to "unavailable" (single-device assumption).
 */
export const fetchRegisteredSyncDevicesForEnv = async (co: string): Promise<SyncDevicesResult> => {
  const overrides = readTestOverrides();
  return fetchRegisteredSyncDevices(co, {
    baseUrl: getSyncV2BaseUrl(),
    getToken: async () => overrides.token ?? (await AuthProviderService.getFreshToken()),
  });
};
