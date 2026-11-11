import { test, expect } from '@playwright/test';
import {
  seedProUserWithGoogleAuth,
  seedProUserWithoutGoogleAuth,
  seedLiteUserState,
  seedLiteUserWithDataState,
  GOOGLE_USER,
} from '../../fixtures/pro-state';
import { TEST_COMPANY } from '../../fixtures/seed-state';
import { navigateToTab } from '../../utils/helpers';

test.describe('Sync Settings — UI States', () => {
  test('settings page shows Registros de Sincronización card for all users', async ({ page }) => {
    await seedLiteUserState(page);
    await navigateToTab(page, 'configuracion');

    await expect(page.getByTestId('settings')).toBeVisible({ timeout: 10000 });
    // All tiers can access sync logs (MH submission history, not cloud sync)
    await expect(page.getByText('Registros de Sincronización')).toBeVisible();
    await expect(page.getByText('Historial de envíos al MH')).toBeVisible();
  });

  test('settings page shows Registros de Sincronización card for Pro user', async ({ page }) => {
    await seedProUserWithGoogleAuth(page);
    await navigateToTab(page, 'configuracion');

    await expect(page.getByTestId('settings')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Registros de Sincronización')).toBeVisible();
  });

  test('Sync Logs page loads and shows empty state when no logs exist', async ({ page }) => {
    await seedLiteUserState(page);
    await page.goto('/#/settings/sync-logs');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('sync-logs')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Sin registros de sincronización')).toBeVisible();
    await expect(
      page.getByText('Los registros aparecerán aquí cuando envíes documentos al Ministerio de Hacienda.'),
    ).toBeVisible();
  });

  test('Dashboard shows Pendientes de Sincronizar card for Lite user', async ({ page }) => {
    await seedLiteUserWithDataState(page);
    await navigateToTab(page, 'inicio');

    await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Pendientes de Sincronizar')).toBeVisible();
  });

  test('Dashboard shows Pendientes de Sincronizar card for Pro user', async ({ page }) => {
    await seedProUserWithGoogleAuth(page);
    await navigateToTab(page, 'inicio');

    await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Pendientes de Sincronizar')).toBeVisible();
  });

  test('Profile page shows account details for Pro Google-authed user', async ({ page }) => {
    await seedProUserWithGoogleAuth(page);
    await navigateToTab(page, 'perfil');

    await expect(page.getByTestId('profile')).toBeVisible({ timeout: 10000 });

    // Account details section shows for non-guest users
    await expect(page.getByText('Detalles de la Cuenta')).toBeVisible();
    await expect(page.getByText('Correo')).toBeVisible();
    // Email appears twice (in the card header and the details section) — use first()
    await expect(page.getByText(GOOGLE_USER.email).first()).toBeVisible();
  });

  test('Profile page does NOT show account details for guest Lite user', async ({ page }) => {
    await seedLiteUserState(page);
    await navigateToTab(page, 'perfil');

    await expect(page.getByTestId('profile')).toBeVisible({ timeout: 10000 });

    // Guest mode — no Detalles de la Cuenta section
    await expect(page.getByText('Detalles de la Cuenta')).not.toBeVisible();
    await expect(page.getByText('Modo Invitado')).toBeVisible();
  });

  test('Settings page shows company name in sidebar footer', async ({ page }) => {
    await seedProUserWithoutGoogleAuth(page);
    await navigateToTab(page, 'configuracion');

    await expect(page.getByTestId('settings')).toBeVisible({ timeout: 10000 });
    // Sidebar shows current company name and DEV badge
    await expect(page.getByText(TEST_COMPANY.nombreComercial)).toBeVisible();
    await expect(page.getByText('DEV')).toBeVisible();
  });
});
