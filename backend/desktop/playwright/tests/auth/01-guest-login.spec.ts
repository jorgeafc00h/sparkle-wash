import { test, expect } from '@playwright/test';
import { seedEmptyAppState } from '../../fixtures/seed-state';

test.describe('Auth — Guest Login', () => {
  test('welcome page is accessible at /welcome route', async ({ page }) => {
    // The welcome page is at /welcome — navigate there directly
    await page.goto('/#/welcome');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('welcome')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Car Spa').first()).toBeVisible();
  });

  test('clicking Comenzar como Invitado navigates to onboarding', async ({ page }) => {
    await page.goto('/#/welcome');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('welcome')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('guest-btn').click();

    // Onboarding redirects immediately to /companies/add (no companies exist) or /home
    await expect(page).toHaveURL(/\/(onboarding|companies\/add|home)/, { timeout: 5000 });
  });

  test('authenticated guest with company sees sidebar', async ({ page }) => {
    await seedEmptyAppState(page);

    // After seeding, sidebar should be visible (app is in authenticated state)
    await expect(page.getByTestId('sidebar-inicio')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('sidebar-facturas')).toBeVisible();
    await expect(page.getByTestId('sidebar-clientes')).toBeVisible();
  });
});
