import { test, expect } from '@playwright/test';
import { seedEmptyAppState, seedPopulatedAppState } from '../../fixtures/seed-state';
import { navigateToTab } from '../../utils/helpers';

test.describe('Compras — List', () => {
  test('shows empty state when no compras', async ({ page }) => {
    await seedEmptyAppState(page);
    await navigateToTab(page, 'compras');

    await expect(page.getByTestId('compras-list')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('No hay compras registradas')).toBeVisible({ timeout: 8000 });
  });

  test('shows compras page with list UI when populated', async ({ page }) => {
    await seedPopulatedAppState(page);
    await navigateToTab(page, 'compras');

    await expect(page.getByTestId('compras-list')).toBeVisible({ timeout: 10000 });
    // Page title heading should be visible
    await expect(page.getByRole('heading', { name: 'Compras' }).first()).toBeVisible();
  });
});
