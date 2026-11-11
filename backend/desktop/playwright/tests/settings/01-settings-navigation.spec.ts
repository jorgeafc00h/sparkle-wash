import { test, expect } from '@playwright/test';
import { seedEmptyAppState } from '../../fixtures/seed-state';
import { navigateToTab } from '../../utils/helpers';

test.describe('Settings — Navigation', () => {
  test('settings page shows all setting cards', async ({ page }) => {
    await seedEmptyAppState(page);
    await navigateToTab(page, 'configuracion');

    await expect(page.getByTestId('settings')).toBeVisible({ timeout: 10000 });

    // Settings grid cards — use role 'button' with name to be specific
    await expect(page.getByRole('button', { name: /Empresas/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Catálogos/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Perfil/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Cuenta/i }).first()).toBeVisible();
  });

  test('click Empresas card navigates to company list', async ({ page }) => {
    await seedEmptyAppState(page);
    await navigateToTab(page, 'configuracion');

    await expect(page.getByTestId('settings')).toBeVisible({ timeout: 10000 });

    // Settings cards are <button> elements that call navigate()
    // Get the "Empresas" button by looking for the heading text
    const empresasCard = page.locator('button:has-text("Empresas")').first();
    await empresasCard.click();

    await expect(page.getByTestId('company-list')).toBeVisible({ timeout: 8000 });
  });

  test('click Perfil card navigates to profile page', async ({ page }) => {
    await seedEmptyAppState(page);
    await navigateToTab(page, 'configuracion');

    await expect(page.getByTestId('settings')).toBeVisible({ timeout: 10000 });

    const perfilCard = page.locator('button:has-text("Perfil")').first();
    await perfilCard.click();

    await expect(page).toHaveURL(/\/settings\/profile/, { timeout: 5000 });
  });
});
