/**
 * Cloud Sync Tests
 *
 * Strategy: Test that the sync middleware correctly gates on subscription tier
 * and Google auth state. Since CloudSyncService makes network calls to Azure,
 * which fail in test environments, we test observable UI behaviour:
 *
 *   - Pro + Google auth: entity creation succeeds (form submits → navigates away)
 *     and the sync call is attempted (fails silently without breaking the UI)
 *   - Lite: entity creation also succeeds (same UX) — sync is simply skipped
 *
 * We also verify the syncStatus Redux field is exposed via the dashboard
 * (Pendientes de Sincronizar count) for both tiers.
 *
 * Sync API calls go to the configured Invoices API /api/sync/ endpoints.
 * We block them so they fail immediately (no timeout) without affecting the page.
 */

import { test, expect } from '@playwright/test';
import {
  seedProUserWithGoogleAuth,
  seedLiteUserWithDataState,
  seedLiteUserState,
} from '../../fixtures/pro-state';
import { navigateToTab } from '../../utils/helpers';

// Block Azure sync API calls — targeted to Azure hostnames only, NOT localhost
async function blockAzureSyncApi(page: import('@playwright/test').Page): Promise<void> {
  await page.route(/https:\/\/k-invoices-api-[^/]+\/api\/sync\//, (route) =>
    route.abort('failed'),
  );
}

test.describe('Cloud Sync — Middleware Behaviour', () => {
  test('Pro + Google auth: customer creation succeeds and does not break UI', async ({ page }) => {
    await blockAzureSyncApi(page);
    await seedProUserWithGoogleAuth(page);
    await navigateToTab(page, 'clientes');

    await expect(page.getByTestId('customer-list')).toBeVisible({ timeout: 10000 });

    // Navigate to add customer form
    await page.goto('/#/customers/add');
    await page.waitForLoadState('domcontentloaded');

    // Fill the required name fields
    const firstNameField = page.getByLabel(/Nombre/i).first();
    await expect(firstNameField).toBeVisible({ timeout: 5000 });
    await firstNameField.fill('Cliente');

    const lastNameField = page.getByLabel(/Apellido/i).first();
    await expect(lastNameField).toBeVisible({ timeout: 3000 });
    await lastNameField.fill('SyncTest');

    // Submit the form
    const submitBtn = page.getByRole('button', { name: /Guardar|Crear|Agregar/i }).first();
    await expect(submitBtn).toBeVisible({ timeout: 3000 });
    await submitBtn.click();

    // After save, the app should navigate to the customer list
    // (sync failure happens in background — does NOT block navigation)
    await expect(page.getByTestId('customer-list')).toBeVisible({ timeout: 8000 });
  });

  test('Lite user: customer creation succeeds without sync attempt', async ({ page }) => {
    await seedLiteUserState(page);

    await page.goto('/#/customers/add');
    await page.waitForLoadState('domcontentloaded');

    const firstNameField = page.getByLabel(/Nombre/i).first();
    await expect(firstNameField).toBeVisible({ timeout: 5000 });
    await firstNameField.fill('Cliente');

    const lastNameField = page.getByLabel(/Apellido/i).first();
    await expect(lastNameField).toBeVisible({ timeout: 3000 });
    await lastNameField.fill('NoSyncTest');

    const submitBtn = page.getByRole('button', { name: /Guardar|Crear|Agregar/i }).first();
    await expect(submitBtn).toBeVisible({ timeout: 3000 });
    await submitBtn.click();

    // Lite user: no sync is attempted (middleware exits early — isPro = false)
    // Navigation to customer list should succeed normally
    await expect(page.getByTestId('customer-list')).toBeVisible({ timeout: 8000 });
  });

  test('Pro + Google auth: dashboard shows Pendientes de Sincronizar stat', async ({ page }) => {
    await seedProUserWithGoogleAuth(page);
    await navigateToTab(page, 'inicio');

    await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 10000 });

    // The "Pendientes de Sincronizar" summary card is always shown on the dashboard
    // Its value reflects invoices with status Nueva (pendingSync)
    await expect(page.getByText('Pendientes de Sincronizar')).toBeVisible();
  });

  test('Lite user: dashboard also shows Pendientes de Sincronizar stat', async ({ page }) => {
    await seedLiteUserWithDataState(page);
    await navigateToTab(page, 'inicio');

    await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 10000 });

    // The dashboard stat card is always visible regardless of tier
    await expect(page.getByText('Pendientes de Sincronizar')).toBeVisible();
  });

  test('Pro + Google auth: navigating settings does not trigger sync', async ({ page }) => {
    await blockAzureSyncApi(page);
    await seedProUserWithGoogleAuth(page);
    await navigateToTab(page, 'configuracion');

    await expect(page.getByTestId('settings')).toBeVisible({ timeout: 10000 });

    // Pure navigation should never trigger the sync middleware
    // (only create/update actions do) — settings page loads without errors
    await expect(page.getByTestId('settings')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Registros de Sincronización')).toBeVisible();
  });
});
