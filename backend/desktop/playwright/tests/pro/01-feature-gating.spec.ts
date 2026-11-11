import { test, expect } from '@playwright/test';
import {
  seedLiteUserState,
  seedLiteUserWithDataState,
  seedAdFreeUserState,
  seedAdFreeUserWithGoogleAuth,
  seedProUserWithGoogleAuth,
  seedProUserWithoutGoogleAuth,
  ADFREE_ACTIVE_SUBSCRIPTION,
  PRO_ACTIVE_SUBSCRIPTION,
} from '../../fixtures/pro-state';
import { navigateToTab } from '../../utils/helpers';

async function mockSubscriptionStatus(
  page: import('@playwright/test').Page,
  tier: 'adfree' | 'pro',
) {
  const subscription = tier === 'pro' ? PRO_ACTIVE_SUBSCRIPTION : ADFREE_ACTIVE_SUBSCRIPTION;
  await page.route('**/subscription/n1co/status', (route) =>
    route.fulfill({ json: { tier, subscription } }),
  );
}

test.describe('Feature Gating — Tier Access Control', () => {
  test('Lite user does NOT see Google Drive export card in settings', async ({ page }) => {
    await seedLiteUserState(page);
    await navigateToTab(page, 'configuracion');

    await expect(page.getByTestId('settings')).toBeVisible({ timeout: 10000 });

    // Google Drive export card only shows for Pro + signed-in with Google
    await expect(page.getByText('Exportar a Google Drive')).not.toBeVisible();
  });

  test('AdFree user does NOT see Drive export card without Google sign-in', async ({ page }) => {
    // Per subscriptionConfig.ts:19-27 spec, AdFree (Pro $7) DOES unlock Drive
    // export — but the card also requires Google sign-in. seedAdFreeUserState
    // does NOT seed Google tokens, so the gate stays closed via Google rather
    // than via tier.
    await mockSubscriptionStatus(page, 'adfree');
    await seedAdFreeUserState(page);
    await navigateToTab(page, 'configuracion');

    await expect(page.getByTestId('settings')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Exportar a Google Drive')).not.toBeVisible();
  });

  test('AdFree user WITH Google auth sees Drive export card', async ({ page }) => {
    await mockSubscriptionStatus(page, 'adfree');
    await seedAdFreeUserWithGoogleAuth(page);
    await navigateToTab(page, 'configuracion');

    await expect(page.getByTestId('settings')).toBeVisible({ timeout: 10000 });
    // Per spec, AdFree (Pro $7) gets Drive when also signed in with Google.
    await expect(page.getByText('Exportar a Google Drive')).toBeVisible({ timeout: 5000 });
  });

  test('Pro user WITHOUT Google auth does NOT see Google Drive export card', async ({ page }) => {
    await mockSubscriptionStatus(page, 'pro');
    await seedProUserWithoutGoogleAuth(page);
    await navigateToTab(page, 'configuracion');

    await expect(page.getByTestId('settings')).toBeVisible({ timeout: 10000 });

    // Pro tier but not signed in with Google — Drive card hidden
    await expect(page.getByText('Exportar a Google Drive')).not.toBeVisible();
  });

  test('Pro user WITH Google auth sees Google Drive export card in settings', async ({ page }) => {
    await mockSubscriptionStatus(page, 'pro');
    await seedProUserWithGoogleAuth(page);
    await navigateToTab(page, 'configuracion');

    await expect(page.getByTestId('settings')).toBeVisible({ timeout: 10000 });

    // Pro + signed-in with Google — Drive export card must appear
    await expect(page.getByText('Exportar a Google Drive')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Respaldo seguro en la nube')).toBeVisible();
  });

  test('Cuenta badge shows Free for Lite user', async ({ page }) => {
    await seedLiteUserState(page);
    await navigateToTab(page, 'configuracion');

    await expect(page.getByTestId('settings')).toBeVisible({ timeout: 10000 });

    // The Cuenta card shows the tier badge
    await expect(page.getByText('Free')).toBeVisible();
  });

  test('Cuenta badge shows Business for Pro user', async ({ page }) => {
    await mockSubscriptionStatus(page, 'pro');
    await seedProUserWithGoogleAuth(page);
    await navigateToTab(page, 'configuracion');

    await expect(page.getByTestId('settings')).toBeVisible({ timeout: 10000 });

    // Pro tier badge on Cuenta card — scope to the purple badge element specifically
    await expect(
      page.locator('span.bg-purple-100').filter({ hasText: 'Business' }),
    ).toBeVisible();
  });

  test('Lite user sees Libros IVA sidebar item as locked but clickable (opens the trial offer)', async ({ page }) => {
    await seedLiteUserWithDataState(page);
    const libros = page.getByTestId('sidebar-libros-iva');
    await expect(libros).toBeVisible({ timeout: 10000 });
    await expect(libros).toHaveAttribute('data-locked', 'tier');
    await libros.click();
    await expect(page.getByTestId('libros-iva-locked')).toBeVisible({ timeout: 10000 });
  });

  test('AdFree user sees Libros IVA sidebar item as enabled', async ({ page }) => {
    await mockSubscriptionStatus(page, 'adfree');
    await seedAdFreeUserState(page);
    const libros = page.getByTestId('sidebar-libros-iva');
    await expect(libros).toBeVisible({ timeout: 10000 });
    await expect(libros).not.toHaveAttribute('data-locked', /.*/);
  });

  test('Lite user can access Google Drive export page but sees locked state', async ({ page }) => {
    await seedLiteUserWithDataState(page);
    await page.goto('/#/settings/google-drive');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('google-drive-export')).toBeVisible({ timeout: 10000 });

    // Locked state messaging for non-Pro users
    await expect(page.getByText('Función Pro')).toBeVisible();
    await expect(page.getByText(/requiere una suscripción Pro/i)).toBeVisible();
  });

  test('Lite user cannot use Libros IVA via direct URL', async ({ page }) => {
    await seedLiteUserWithDataState(page);
    await page.goto('/#/invoices/libros-iva');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('libros-iva-locked')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Disponible con Pro o Business/i)).toBeVisible();
  });
});
