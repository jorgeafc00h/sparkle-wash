/**
 * Device Sync v2 — product stock with two registers selling at the same time
 * (2026-11-01). Before: products merged last-writer-wins on the absolute
 * stock, so the Desktop selling 2 and a phone register selling 3 of the same
 * product from 100 both ended at 97 or 98 — one register's sale vanished.
 * Now the stock rides as a convergent counter inside the product payload
 * (src/services/sync/stockLedger.ts) and both registers end at 95.
 *
 * REAL local Invoices.SyncApi relay + a Node SyncPeer playing the phone
 * register (same wire as pro/11 and pro/13).
 */

import { test, expect } from '@playwright/test';
import { seedDeviceSyncUser } from '../../fixtures/pro-state';
import { mintSyncToken, relayUrl, startRelay, stopRelay, SyncPeer, SYNC_CO } from '../../fixtures/sync-relay';

test.describe.configure({ mode: 'serial' });

type Ledger = { base: number; baseAt: string; baseBy: string; devices: Record<string, { in: number; out: number }> };
type ProductPayload = { id: string; stockQuantity?: number; stockLedger?: Ledger } & Record<string, unknown>;

test.describe('Device Sync v2 — stock on two registers', () => {
  let peer: SyncPeer;

  test.beforeAll(async () => {
    test.setTimeout(420_000); // first run (or relay-source change) rebuilds the snapshot
    await startRelay();
  });

  test.afterAll(async () => {
    await peer?.close();
    await stopRelay();
  });

  test('the Desktop sells 2 and the phone register sells 3 at the same time: both end at 95', async ({ page }) => {
    test.setTimeout(180_000);
    peer = await new SyncPeer().connect();
    await peer.register();

    await seedDeviceSyncUser(page, 'pro_sync', {
      baseUrl: relayUrl(),
      token: mintSyncToken({ companies: [SYNC_CO] }),
    });
    await page.goto('/#/settings');
    await page.getByTestId('settings-device-sync').click();
    await page.getByTestId('sync-now-button').click();
    await expect(page.getByTestId('sync-v2-status-text')).toHaveText('En línea', { timeout: 30_000 });

    // ── Desktop register: 2 × Papel Bond A4 (stock 100). ──
    await page.goto('/#/pos');
    await expect(page.getByTestId('pos-register')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('pos-product-prod-003').click();
    await page.getByTestId('pos-product-prod-003').click();
    await page.getByTestId('btn-charge').click();
    await page.getByTestId('btn-confirm-payment').click();
    await expect(page.getByText(/Ticket #\d+ guardado/).last()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('pos-stock-prod-003')).toContainText('Stock 98');

    // The product reaches the phone with the Desktop's counter (out: 2).
    const fromDesktop = await peer.waitForReceived(({ change, payload }) =>
      change.t === 'product'
      && (payload as ProductPayload).id === 'prod-003'
      && (payload as ProductPayload).stockQuantity === 98);
    const desktopCopy = fromDesktop.payload as ProductPayload;
    const desktopLedger = desktopCopy.stockLedger!;
    expect(desktopLedger).toBeTruthy();
    expect(Object.values(desktopLedger.devices).map((d) => d.out)).toEqual([2]);

    // ── Phone register, concurrently: it never saw the Desktop's sale and
    // sold 3 from the same synced copy (same base). ──
    const phoneLedger: Ledger = {
      base: desktopLedger.base,
      baseAt: desktopLedger.baseAt,
      baseBy: desktopLedger.baseBy,
      devices: { [peer.deviceId]: { in: 0, out: 3 } },
    };
    await peer.upsert('product', {
      ...desktopCopy,
      stockLedger: phoneLedger,
      stock: 97,
      stockQuantity: 97,
      updatedAt: new Date().toISOString(),
    });

    // Desktop: both sales count — 100 − 2 − 3.
    await expect(page.getByTestId('pos-stock-prod-003')).toContainText('Stock 95', { timeout: 30_000 });

    // …and the Desktop sends the merged product back, so the phone converges too.
    const merged = await peer.waitForReceived(({ change, payload }) =>
      change.t === 'product'
      && (payload as ProductPayload).id === 'prod-003'
      && (payload as ProductPayload).stockQuantity === 95);
    const outs = Object.values((merged.payload as ProductPayload).stockLedger!.devices).map((d) => d.out).sort();
    expect(outs).toEqual([2, 3]);
  });
});
