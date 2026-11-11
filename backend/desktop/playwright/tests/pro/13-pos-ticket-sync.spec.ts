/**
 * Device Sync v2 — POS tickets as a synced entity (openspec add-pos-tickets task 6.2).
 *
 * Same wire as pro/11-device-sync: a REAL local Invoices.SyncApi relay and a Node
 * SyncPeer playing the owner's phone. Covers both directions:
 *   Desktop → phone: a POS sale captured by the TicketDatabase listener reaches
 *   the outbox, the live session pushes it, and the peer receives a `ticket`
 *   envelope with the sale payload.
 *   phone → Desktop: a ticket upserted by the peer lands in TicketDatabase and
 *   shows up in the ticket history.
 */

import { test, expect } from '@playwright/test';
import { seedDeviceSyncUser } from '../../fixtures/pro-state';
import { mintSyncToken, relayUrl, startRelay, stopRelay, SyncPeer, SYNC_CO } from '../../fixtures/sync-relay';

test.describe.configure({ mode: 'serial' });

test.describe('Device Sync v2 — POS tickets', () => {
  let peer: SyncPeer;

  test.beforeAll(async () => {
    test.setTimeout(420_000); // first run (or relay-source change) rebuilds the snapshot
    await startRelay();
  });

  test.afterAll(async () => {
    await peer?.close();
    await stopRelay();
  });

  test('a POS sale syncs to the phone, and a phone ticket appears on the Desktop', async ({ page }) => {
    test.setTimeout(180_000);
    peer = await new SyncPeer().connect();
    await peer.register();

    await seedDeviceSyncUser(page, 'pro_sync', {
      baseUrl: relayUrl(),
      token: mintSyncToken({ companies: [SYNC_CO] }),
    });

    // Open a sync session.
    await page.goto('/#/settings');
    await page.getByTestId('settings-device-sync').click();
    await expect(page.getByTestId('sync-v2-panel')).toBeVisible();
    await page.getByTestId('sync-now-button').click();
    await expect(page.getByTestId('sync-v2-status-text')).toHaveText('En línea', { timeout: 30_000 });

    // ── Desktop → phone: sell one Papel Bond A4 through the POS. ──
    await page.goto('/#/pos');
    await expect(page.getByTestId('pos-register')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('pos-product-prod-003').click();
    await page.getByTestId('btn-charge').click();
    await page.getByTestId('btn-confirm-payment').click();
    await expect(page.getByText(/Ticket #\d+ guardado/).last()).toBeVisible({ timeout: 30_000 });

    const received = await peer.waitForReceived(({ change, payload }) =>
      change.t === 'ticket' && Array.isArray(payload?.payments) && payload.payments.length > 0);
    expect(received.change.op).toBe('upsert');
    expect(received.payload).toMatchObject({
      status: 'COMPLETED',
      companyId: expect.any(String),
      payments: [expect.objectContaining({ method: 'EFECTIVO' })],
    });
    expect(received.payload.items[0]).toMatchObject({ productName: 'Papel Bond A4', quantity: 1 });

    // The stock deduction rides along on the product entity: the peer's copy
    // of Papel Bond A4 drops to 99 (the sale alone syncing without the stock
    // movement is exactly the divergence this regression locks out).
    const stockChange = await peer.waitForReceived(({ change, payload }) =>
      change.t === 'product'
      && (payload as { id?: string }).id === 'prod-003'
      && (payload as { stockQuantity?: number }).stockQuantity === 99);
    expect(stockChange.change.op).toBe('upsert');

    // The desktop's manifest counts the ticket.
    const desktopRow = (await peer.status()).devices.find((device) => device.platform === 'desktop');
    expect(desktopRow?.counts.ticket).toBeGreaterThanOrEqual(1);

    // ── phone → Desktop: the phone upserts its own ticket. ──
    const nowIso = new Date().toISOString();
    await peer.upsert('ticket', {
      id: 'tkt_android_001',
      companyId: '1',
      sequential: 77,
      status: 'COMPLETED',
      items: [{ id: 'l1', productName: 'Recarga telefónica', quantity: 1, unitPrice: 5, lineTotal: 5, taxCategory: 'GRAVADO' }],
      payments: [{ id: 'p1', method: 'EFECTIVO', amount: 5, tendered: 5, change: 0 }],
      totalAmount: 5,
      taxIncluded: 0.58,
      createdAt: nowIso,
      completedAt: nowIso,
      printedCount: 1,
      updatedAt: nowIso,
    });

    await page.goto('/#/pos/tickets');
    await expect(page.getByTestId('ticket-row-77')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('ticket-row-77')).toContainText('Completado');
    await page.getByTestId('ticket-row-77').click();
    await expect(page.getByTestId('ticket-detail-77')).toContainText('Recarga telefónica');
    await expect(page.getByTestId('ticket-detail-77')).toContainText('$5.00');
  });
});
