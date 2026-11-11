import { test, expect } from '@playwright/test';
import {
  seedProUserWithGoogleAuth,
  seedLiteUserState,
  GOOGLE_USER,
} from '../../fixtures/pro-state';
import { navigateToTab } from '../../utils/helpers';

test.describe('Google Auth — UI state', () => {
  test('welcome page shows Google Sign-In button', async ({ page }) => {
    await page.goto('/#/welcome');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('welcome')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('google-signin-btn')).toBeVisible();
    await expect(page.getByText('Iniciar Sesión con Google')).toBeVisible();
  });

  test('welcome page shows Continue as Guest button', async ({ page }) => {
    await page.goto('/#/welcome');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('welcome')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('guest-btn')).toBeVisible();
    await expect(page.getByText('Continuar sin iniciar sesión')).toBeVisible();
  });

  test('signed-in Pro user sees their name and email in profile page', async ({ page }) => {
    await seedProUserWithGoogleAuth(page);
    await navigateToTab(page, 'perfil');

    await expect(page.getByTestId('profile')).toBeVisible({ timeout: 10000 });

    // Name: PRO_USER firstName + lastName = "Pro Usuario"
    // Profile shows name in a paragraph and also in Detalles section — use first()
    await expect(page.getByText('Pro Usuario').first()).toBeVisible();
    // Email appears in profile header and details section — use first()
    await expect(page.getByText(GOOGLE_USER.email).first()).toBeVisible();
    // Auth badge
    await expect(page.getByText('Autenticado')).toBeVisible();
  });

  test('guest user sees Modo Invitado label in profile page', async ({ page }) => {
    await seedLiteUserState(page);
    await navigateToTab(page, 'perfil');

    await expect(page.getByTestId('profile')).toBeVisible({ timeout: 10000 });

    await expect(page.getByText('Modo Invitado')).toBeVisible();
    await expect(page.getByText('Sin cuenta asociada')).toBeVisible();
    // Use exact match to target only the badge text, not the "Modo Invitado" paragraph
    await expect(page.getByText('Invitado', { exact: true })).toBeVisible();
  });

  test('Cerrar Sesión button is visible on profile page', async ({ page }) => {
    await seedProUserWithGoogleAuth(page);
    await navigateToTab(page, 'perfil');

    await expect(page.getByTestId('profile')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /Cerrar Sesión/i })).toBeVisible();
  });

  test('clicking Cerrar Sesión opens confirmation dialog', async ({ page }) => {
    await seedProUserWithGoogleAuth(page);
    await navigateToTab(page, 'perfil');

    await expect(page.getByTestId('profile')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /Cerrar Sesión/i }).click();

    // Confirmation dialog should appear
    await expect(page.getByText('¿Estás seguro de que deseas cerrar sesión?')).toBeVisible({
      timeout: 5000,
    });
  });
});
