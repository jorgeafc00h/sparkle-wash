/**
 * FULL cross-client Device Sync v2 scenario — the real Desktop app and the real Android
 * app (Detox, emulator) exchanging data through ONE local Invoices.SyncApi.
 *
 * Driven by App.ReactNative/FacturasSimplesRN/scripts/e2e-full-sync.sh, which starts the
 * relay once (SYNC_E2E_EXTERNAL=1) and runs, in order:
 *   phase A (this file)  — Desktop syncs its company data into the warm relay
 *   phase B (Detox)      — Android syncs: sees the Desktop data, edits a product
 *   phase C (this file)  — Desktop syncs again: sees Android's data and edit
 * Skipped unless FULL_SYNC_PHASE is set, so the regular Playwright run never needs the
 * emulator.
 */

import { test, expect, type Page } from '@playwright/test';
import { seedDeviceSyncUser } from '../../fixtures/pro-state';
import { mintSyncToken, relayUrl, SYNC_CO } from '../../fixtures/sync-relay';

const PHASE = process.env.FULL_SYNC_PHASE;

const syncNow = async (page: Page) => {
  await seedDeviceSyncUser(page, 'pro_sync', { baseUrl: relayUrl(), token: mintSyncToken({ companies: [SYNC_CO] }) });
  await page.goto('/#/settings/sync');
  await expect(page.getByTestId('sync-v2-panel')).toBeVisible();
  await page.getByTestId('sync-now-button').click();
  await expect(page.getByTestId('sync-v2-status-text')).toHaveText('En línea', { timeout: 30_000 });
};

test.describe('Full sync — Desktop ↔ Android through the relay', () => {
  test('phase A: Desktop pushes its company data into the relay', async ({ page }) => {
    test.skip(PHASE !== 'A', 'run via scripts/e2e-full-sync.sh (FULL_SYNC_PHASE=A)');
    await syncNow(page);
    // Snapshot flushed: nothing left in the outbox.
    await expect(page.getByTestId('sync-v2-outbox-count')).toHaveText('Cambios pendientes de enviar: 0', { timeout: 30_000 });
  });

  test('phase C: Desktop receives the Android app\'s data and its live edit', async ({ page }) => {
    test.skip(PHASE !== 'C', 'run via scripts/e2e-full-sync.sh (FULL_SYNC_PHASE=C)');
    await syncNow(page);
    // The Android device registered in phase B.
    await expect(page.locator('[data-testid^="sync-v2-device-"]').filter({ hasText: 'Android' }).first()).toBeVisible({ timeout: 30_000 });

    // Android's seeded customer and its edited product arrived on the Desktop.
    await page.getByTestId('sidebar-clientes').click();
    await expect(page.getByText('Juan Prueba').first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('sidebar-productos').click();
    await expect(page.getByText('Editado En Android').first()).toBeVisible({ timeout: 30_000 });
  });
});
