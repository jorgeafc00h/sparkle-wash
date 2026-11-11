/**
 * Regression tests for the 2026-04-20 UI cleanup batch:
 *   - Invoice delete button (gated to Nueva / ErrorEnvio only).
 *   - Compras view: one Gmail CTA when not linked, reconnect only when linked.
 *   - Compras first-sync default range = 90d (3m).
 */

import { test, expect } from '@playwright/test';
import {
  seedEmptyAppState,
  seedPopulatedAppState,
  waitForAppReady,
} from '../../fixtures/seed-state';
import { navigateToTab } from '../../utils/helpers';

test.describe('Invoice delete — status-gated', () => {
  test('delete button visible for Nueva invoice and removes it from the list', async ({ page }) => {
    await seedPopulatedAppState(page);

    // Seeded inv-003 is status = Nueva.
    await page.goto('/#/invoices/inv-003');
    await waitForAppReady(page);
    await expect(page.getByTestId('invoice-detail')).toBeVisible({ timeout: 10000 });

    const deleteBtn = page.getByTestId('btn-delete-invoice');
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // Confirm dialog — scope to the dialog role to avoid colliding with
    // the trigger button that also reads "Eliminar".
    await page.getByRole('dialog').getByRole('button', { name: /^Eliminar$/ }).click();

    // Lands back on /invoices and the row is gone.
    await expect(page.getByTestId('invoice-list')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('INV-003')).toHaveCount(0);
  });

  test('delete button HIDDEN for Completada invoice', async ({ page }) => {
    await seedPopulatedAppState(page);

    // Seeded inv-001 is status = Completada.
    await page.goto('/#/invoices/inv-001');
    await waitForAppReady(page);
    await expect(page.getByTestId('invoice-detail')).toBeVisible({ timeout: 10000 });

    // Delete must never be offered for a DTE already signed by MH.
    await expect(page.getByTestId('btn-delete-invoice')).toHaveCount(0);
  });
});

test.describe('Compras view — Gmail CTA deduplication', () => {
  test('empty state shows exactly ONE Gmail connect button', async ({ page }) => {
    await seedEmptyAppState(page); // Lite tier, no linked Gmail
    await navigateToTab(page, 'compras');

    const primaryBtn = page.getByTestId('compras-sync-gmail');
    const reconnectBtn = page.getByTestId('compras-reconnect-gmail');

    await expect(primaryBtn).toBeVisible();
    // Reconnect is only meaningful AFTER linking — must not appear here.
    await expect(reconnectBtn).toHaveCount(0);

    // Primary button reads "Conectar..." (not the "Sincronizar Gmail" label
    // reserved for the already-linked case).
    const label = await primaryBtn.innerText();
    expect(label).toMatch(/Conectar/i);
  });

  test('first-sync range picker defaults to "Últimos 3 meses" (90 days)', async ({ page }) => {
    await seedEmptyAppState(page);
    await navigateToTab(page, 'compras');

    const rangeSelect = page.getByTestId('compras-sync-range');
    await expect(rangeSelect).toHaveValue('3m');
  });
});
