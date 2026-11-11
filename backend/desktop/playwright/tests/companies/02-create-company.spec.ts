import { test, expect } from '@playwright/test';
import { seedEmptyAppState } from '../../fixtures/seed-state';
import { navigateToTab } from '../../utils/helpers';

test.describe('Companies — Create', () => {
  test('wizard shows step 1 with basic info fields', async ({ page }) => {
    // Use Pro tier state so add company is not disabled
    await seedEmptyAppState(page, 'pro');
    await page.goto('/#/companies/add');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('sidebar-inicio')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('create-company')).toBeVisible({ timeout: 8000 });

    // Step 1 fields should be present
    await expect(page.getByLabel('Nombre Legal', { exact: false })).toBeVisible();
    await expect(page.getByLabel('Nombre Comercial', { exact: false })).toBeVisible();
  });

  test('fill step 1 and advance to step 2', async ({ page }) => {
    await seedEmptyAppState(page, 'pro');
    await page.goto('/#/companies/add');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('create-company')).toBeVisible({ timeout: 10000 });

    // Fill step 1
    await page.getByLabel('Nombre Legal', { exact: false }).fill('Empresa E2E S.A. de C.V.');
    await page.getByLabel('Nombre Comercial', { exact: false }).fill('Empresa E2E');

    // Click Siguiente
    await page.getByRole('button', { name: /Siguiente/i }).click();

    // Step 2 heading should appear (use heading role to avoid strict mode with step indicator)
    await expect(page.getByRole('heading', { name: 'Contacto y Ubicación' })).toBeVisible({ timeout: 5000 });
  });
});
