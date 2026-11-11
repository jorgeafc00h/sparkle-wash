// Per-install device identity for Device Sync v2 (design D1): a random UUID v4 minted
// once and persisted in appStorage (Electron userData/app-storage.json — survives app
// updates; localStorage in the web build). Not a hardware id: a reinstall mints a new
// one, and the relay prunes manifests of devices inactive for 90 days.

import { appStorage } from '../storage/ElectronStorage';

export const DEVICE_ID_STORAGE_KEY = 'sync_device_id';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const generateUuidV4 = (): string => {
  const bytes = new Uint8Array(16);
  const cryptoApi = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

let cachedDeviceId: string | null = null;
let pending: Promise<string> | null = null;

/** Read-or-create; concurrent callers share one mint so two ids can never race into storage. */
export const getDeviceId = async (): Promise<string> => {
  if (cachedDeviceId) return cachedDeviceId;
  if (pending) return pending;

  pending = (async () => {
    const stored = await appStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (stored && UUID_PATTERN.test(stored)) {
      cachedDeviceId = stored;
      return stored;
    }
    const minted = generateUuidV4();
    await appStorage.setItem(DEVICE_ID_STORAGE_KEY, minted);
    cachedDeviceId = minted;
    return minted;
  })();

  try {
    return await pending;
  } finally {
    pending = null;
  }
};

export const getCachedDeviceId = (): string | null => cachedDeviceId;

/** Test hook: forget the in-memory copy (simulates an app restart). */
export const resetDeviceIdCacheForTests = (): void => {
  cachedDeviceId = null;
  pending = null;
};
