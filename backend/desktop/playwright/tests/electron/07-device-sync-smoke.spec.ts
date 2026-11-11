/**
 * Device Sync v2 — Electron smoke (openspec add-device-sync-v2 task 5.6).
 *
 * The REAL Electron shell (preload bridge + app-storage.json persistence) runs a Pro+Sync
 * session against a local Invoices.SyncApi: the device identity and the persisted sync
 * state must land in userData/app-storage.json — the durability the outbox relies on
 * across app restarts and updates.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { closeElectron, launchElectron, type ElectronAppHandle } from '../../fixtures/electron-launch';
import { mintSyncToken, relayUrl, startRelay, stopRelay, SYNC_CO } from '../../fixtures/sync-relay';

const persist = (value: Record<string, unknown>) => {
  const encoded: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) encoded[k] = JSON.stringify(v);
  encoded._persist = JSON.stringify({ version: -1, rehydrated: true });
  return JSON.stringify(encoded);
};

let handle: ElectronAppHandle | null = null;

test.beforeAll(async () => {
  test.setTimeout(420_000);
  await startRelay();
});

test.afterAll(async () => {
  if (handle) await closeElectron(handle);
  await stopRelay();
});

test('Electron: a Pro+Sync session persists deviceId + sync state in app-storage.json', async () => {
  handle = await launchElectron({
    mock: true,
    extraStorage: {
      'persist:subscription': persist({
        tier: 'pro_sync',
        isInitialized: true,
        loading: false,
        error: null,
        availableProducts: [],
        activeSubscription: null,
        purchaseInProgress: false,
      }),
    },
    localStorage: {
      fs_sync_v2_test: JSON.stringify({
        baseUrl: relayUrl(),
        token: mintSyncToken({ companies: [SYNC_CO] }),
        staggerMaxMs: 0,
        flushDebounceMs: 300,
      }),
    },
  });
  const { window, userDataDir } = handle;

  await window.evaluate(() => { window.location.hash = '#/settings/sync'; });
  await expect(window.getByTestId('sync-v2-panel')).toBeVisible({ timeout: 30_000 });
  await window.getByTestId('sync-now-button').click();
  await expect(window.getByTestId('sync-v2-status-text')).toHaveText('En línea', { timeout: 30_000 });
  await expect(window.getByTestId('sync-v2-outbox-count')).toHaveText('Cambios pendientes de enviar: 0', { timeout: 30_000 });

  // Persistence goes through the preload bridge into userData/app-storage.json.
  await expect.poll(() => {
    const storage = JSON.parse(readFileSync(join(userDataDir, 'app-storage.json'), 'utf-8')) as Record<string, string>;
    const deviceId = storage.sync_device_id;
    const sync = storage['persist:syncV2'] ? JSON.parse(storage['persist:syncV2']) : null;
    const companies = sync?.companies ? JSON.parse(sync.companies) : {};
    return Boolean(deviceId && /^[0-9a-f-]{36}$/.test(deviceId) && companies[SYNC_CO]?.epoch);
  }, { timeout: 15_000 }).toBe(true);
});
