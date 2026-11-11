import { test, expect } from '@playwright/test';
import {
  seedProUserWithGoogleAuth,
  seedProUserWithoutGoogleAuth,
  seedLiteUserState,
  seedAdFreeUserState,
} from '../../fixtures/pro-state';

// Block actual Google Drive API calls so they fail quickly without hanging
async function blockDriveApi(page: import('@playwright/test').Page): Promise<void> {
  await page.route('https://www.googleapis.com/**', (route) => route.abort('failed'));
  await page.route('https://www.googleusercontent.com/**', (route) => route.abort('failed'));
}

test.describe('Google Drive Export Page', () => {
  test('Pro + signed-in user can navigate to Google Drive export page', async ({ page }) => {
    await blockDriveApi(page);
    await seedProUserWithGoogleAuth(page);

    await page.goto('/#/settings/google-drive');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('google-drive-export')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Exportar a Google Drive')).toBeVisible();
  });

  test('Pro + signed-in user sees Crear Respaldo button', async ({ page }) => {
    await blockDriveApi(page);
    await seedProUserWithGoogleAuth(page);

    await page.goto('/#/settings/google-drive');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('google-drive-export')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /Crear Respaldo/i })).toBeVisible();
  });

  test('Pro + signed-in user sees Respaldos Existentes section', async ({ page }) => {
    await blockDriveApi(page);
    await seedProUserWithGoogleAuth(page);

    await page.goto('/#/settings/google-drive');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('google-drive-export')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Respaldos Existentes')).toBeVisible();
    // Blocked Drive API → empty backups list
    await expect(page.getByText('No hay respaldos en Google Drive aún.')).toBeVisible({
      timeout: 8000,
    });
  });

  test('Lite user sees Función Pro locked state on Drive export page', async ({ page }) => {
    await seedLiteUserState(page);

    await page.goto('/#/settings/google-drive');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('google-drive-export')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Función Pro')).toBeVisible();
    await expect(page.getByText(/requiere una suscripción Pro/i)).toBeVisible();

    // Crear Respaldo button must NOT appear in locked state
    await expect(page.getByRole('button', { name: /Crear Respaldo/i })).not.toBeVisible();
  });

  test('AdFree (Pro $7) user can access Drive export page (no longer locked)', async ({ page }) => {
    await blockDriveApi(page);
    await seedAdFreeUserState(page);

    await page.goto('/#/settings/google-drive');
    await page.waitForLoadState('domcontentloaded');

    // Per subscriptionConfig.ts:19-27, Pro ($7) gets Drive — should NOT see the
    // locked state. AdFree user lacks Google auth, so they see the sign-in
    // prompt instead.
    await expect(page.getByTestId('google-drive-export')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Función Pro')).not.toBeVisible();
    await expect(page.getByText('Inicia sesión con Google')).toBeVisible();
  });

  test('Pro user NOT signed in with Google sees sign-in prompt on Drive page', async ({ page }) => {
    await seedProUserWithoutGoogleAuth(page);

    await page.goto('/#/settings/google-drive');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('google-drive-export')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Inicia sesión con Google')).toBeVisible();
    await expect(
      page.getByText(/necesitas iniciar sesión con tu cuenta de Google/i),
    ).toBeVisible();

    // Crear Respaldo button must NOT appear
    await expect(page.getByRole('button', { name: /Crear Respaldo/i })).not.toBeVisible();
  });

  test('Drive export page accessible via Settings card for Pro + Google auth user', async ({ page }) => {
    await blockDriveApi(page);
    await seedProUserWithGoogleAuth(page);

    // Navigate to settings
    await page.goto('/#/settings');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('settings')).toBeVisible({ timeout: 10000 });

    // Click the Google Drive export card
    const driveCard = page.locator('button:has-text("Exportar a Google Drive")').first();
    await expect(driveCard).toBeVisible({ timeout: 5000 });
    await driveCard.click();

    await expect(page).toHaveURL(/\/settings\/google-drive/, { timeout: 5000 });
    await expect(page.getByTestId('google-drive-export')).toBeVisible({ timeout: 8000 });
  });
});
