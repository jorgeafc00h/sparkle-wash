/**
 * Device Sync v2 (Pro+Sync) — Desktop coded UI (openspec add-device-sync-v2 tasks 4.3, 5.1–5.5).
 *
 * Gating: Free / plain paid tiers get the locked panel and open NO hub socket and NO
 * /api/v2/sync request. Pro+Sync: the page talks to a REAL local Invoices.SyncApi while a
 * Node SyncPeer plays the owner's Android phone — the same relay, token shape and payload
 * codec as the Detox suite (e2e/sync-v2.e2e.js), so both clients cross the same wire.
 */

import { test, expect, type Page } from '@playwright/test';
import { seedDeviceSyncUser } from '../../fixtures/pro-state';
import { mintSyncToken, relayUrl, startRelay, stopRelay, SyncPeer, SYNC_CO } from '../../fixtures/sync-relay';

test.describe.configure({ mode: 'serial' });

const openSyncPage = async (page: Page) => {
  await page.goto('/#/settings');
  await page.getByTestId('settings-device-sync').click();
  await expect(page.getByTestId('sync-v2-screen')).toBeVisible();
};

const trackSyncTraffic = (page: Page) => {
  const traffic: string[] = [];
  page.on('websocket', (ws) => {
    if (ws.url().includes('/hubs/sync')) traffic.push(ws.url());
  });
  page.on('request', (request) => {
    if (request.url().includes('/hubs/sync') || request.url().includes('/api/v2/sync')) traffic.push(request.url());
  });
  return traffic;
};

test.describe('Device Sync v2 — gating', () => {
  // Every tier without device sync (Free, Sin Publicidad, plain Pro) — holding a token the relay
  // WOULD accept, so only the client gate keeps it off the relay.
  for (const tier of ['lite', 'adfree', 'pro'] as const) {
    test(`${tier}: locked Pro+Sync panel and zero sync traffic`, async ({ page }) => {
      const traffic = trackSyncTraffic(page);
      // Even with a relay configured, a tier without device sync must never connect.
      await seedDeviceSyncUser(page, tier, { baseUrl: relayUrl(), token: mintSyncToken() });
      await openSyncPage(page);
      await expect(page.getByTestId('sync-v2-locked')).toBeVisible();
      await expect(page.getByTestId('sync-v2-upgrade-button')).toBeVisible();
      await expect(page.getByTestId('sync-now-button')).toHaveCount(0);
      await page.waitForTimeout(1500);
      expect(traffic).toEqual([]);
    });
  }
});

test.describe('Device Sync v2 — relay with the owner\'s phone', () => {
  let peer: SyncPeer;

  test.beforeAll(async () => {
    test.setTimeout(420_000); // first run builds the relay snapshot
    await startRelay();
  });

  test.afterAll(async () => {
    await stopRelay();
  });

  test.afterEach(async () => {
    await peer?.close();
  });

  test('Pro+Sync: phone changes arrive on "Sincronizar", Desktop data reaches the phone, tombstones propagate', async ({ page }) => {
    test.setTimeout(120_000);
    peer = await new SyncPeer().connect();
    await peer.register();
    await peer.upsert('customer', {
      id: 'android-customer-001',
      firstName: 'Cliente',
      lastName: 'Telefono',
      businessName: 'Cliente Desde Android SA',
      nationalId: '012345678',
      nit: '',
      email: 'android@test.com',
      phone: '70000000',
      documentType: '13',
      isActive: true,
      createdAt: new Date().toISOString(),
    });

    await seedDeviceSyncUser(page, 'pro_sync', { baseUrl: relayUrl(), token: mintSyncToken({ companies: [SYNC_CO] }) });
    await openSyncPage(page);
    await expect(page.getByTestId('sync-v2-panel')).toBeVisible();
    await page.getByTestId('sync-now-button').click();
    await expect(page.getByTestId('sync-v2-status-text')).toHaveText('En línea', { timeout: 30_000 });
    await expect(page.getByTestId(`sync-v2-device-${peer.deviceId}`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId(`sync-v2-device-online-${peer.deviceId}`)).toHaveText('En línea');

    // phone → Desktop
    await page.getByTestId('sidebar-clientes').click();
    await expect(page.getByText('Cliente Desde Android SA')).toBeVisible({ timeout: 30_000 });

    // Desktop → phone: the seeded customers went out in the first-session snapshot.
    const maria = await peer.waitForReceived(({ change, payload }) =>
      change.t === 'customer' && payload?.firstName === 'Maria');
    expect(maria.change.d).not.toBe(peer.deviceId);
    const desktopRow = (await peer.status()).devices.find((device) => device.platform === 'desktop');
    expect(desktopRow?.counts.customer).toBeGreaterThanOrEqual(1);

    // phone deletes → tombstone removes it on the Desktop (live pull on ChangesAvailable)
    await peer.remove('customer', 'android-customer-001');
    await expect(page.getByText('Cliente Desde Android SA')).toHaveCount(0, { timeout: 30_000 });
  });

  test('Pro+Sync: an offline phone still gets its row — the REST status call works from the renderer (relay CORS)', async ({ page }) => {
    test.setTimeout(120_000);
    peer = await new SyncPeer().connect();
    await peer.register();
    await peer.close(); // the phone left: it is in no online list anymore

    await seedDeviceSyncUser(page, 'pro_sync', { baseUrl: relayUrl(), token: mintSyncToken({ companies: [SYNC_CO] }) });
    await openSyncPage(page);
    await page.getByTestId('sync-now-button').click();
    await expect(page.getByTestId('sync-v2-status-text')).toHaveText('En línea', { timeout: 30_000 });
    // Register and PeersChanged carry ONLINE devices only: the offline phone's row can only come from
    // GET /api/v2/sync/{co}/status — a cross-origin fetch from the renderer that the relay must allow.
    await expect(page.getByTestId(`sync-v2-device-${peer.deviceId}`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId(`sync-v2-device-online-${peer.deviceId}`)).toHaveText('Desconectado');
  });

  test('Pro+Sync: a relay cold start (new epoch) re-seeds on the next "Sincronizar"', async ({ page }) => {
    test.setTimeout(180_000);
    await seedDeviceSyncUser(page, 'pro_sync', { baseUrl: relayUrl(), token: mintSyncToken({ companies: [SYNC_CO] }) });
    await openSyncPage(page);
    await page.getByTestId('sync-now-button').click();
    await expect(page.getByTestId('sync-v2-status-text')).toHaveText('En línea', { timeout: 30_000 });

    // The relay process restarts: memory (log, manifests) gone, new epoch minted.
    await stopRelay();
    await startRelay();
    peer = await new SyncPeer().connect();
    await peer.register();

    await page.getByTestId('sync-now-button').click();
    await expect(page.getByTestId('sync-v2-status-text')).toHaveText('En línea', { timeout: 60_000 });
    // The Desktop re-seeded its full snapshot under the new epoch.
    const maria = await peer.waitForReceived(({ change, payload }) =>
      change.t === 'customer' && payload?.firstName === 'Maria');
    expect(maria).toBeTruthy();
    const status = await peer.status();
    const desktop = status.devices.find((device) => device.platform === 'desktop');
    expect(desktop?.counts.customer).toBeGreaterThanOrEqual(1);
  });

  test('relay refusal: a Pro+Sync app holding a plain-Pro account token is refused and syncs nothing', async ({ page }) => {
    // The relay is the authority on the paid tier: a stale or tampered local plan does not sync.
    // The relay is shared with the tests above (their Desktop rows stay listed), so the proof is
    // that the refused attempt changes nothing: same Desktop rows, no new change for the phone.
    peer = await new SyncPeer().connect();
    await peer.register();
    const desktopRows = async () => JSON.stringify(
      (await peer.status()).devices
        .filter((device) => device.platform === 'desktop')
        .sort((a, b) => a.deviceId.localeCompare(b.deviceId)),
    );
    await peer.pullAll();
    const rowsBefore = await desktopRows();
    const receivedBefore = peer.received.size;

    await seedDeviceSyncUser(page, 'pro_sync', { baseUrl: relayUrl(), token: mintSyncToken({ companies: [SYNC_CO], tier: 'pro' }) });
    await openSyncPage(page);
    await page.getByTestId('sync-now-button').click();
    await expect(page.getByTestId('sync-v2-error')).toContainText('requiere Pro+Sync', { timeout: 30_000 });

    expect(await desktopRows()).toBe(rowsBefore);
    await peer.pullAll();
    expect(peer.received.size).toBe(receivedBefore);
  });

  test('Pro+Sync: a relay rejection for the company key surfaces as a Spanish error, not a crash', async ({ page }) => {
    peer = await new SyncPeer().connect();
    // Token for ANOTHER company → the relay answers forbidden for this company's group.
    await seedDeviceSyncUser(page, 'pro_sync', { baseUrl: relayUrl(), token: mintSyncToken({ companies: ['co99999999999999'] }) });
    await openSyncPage(page);
    await page.getByTestId('sync-now-button').click();
    await expect(page.getByTestId('sync-v2-error')).toContainText('requiere Pro+Sync', { timeout: 30_000 });
    await expect(page.getByTestId('sync-v2-status-text')).toHaveText('Error');
  });
});
