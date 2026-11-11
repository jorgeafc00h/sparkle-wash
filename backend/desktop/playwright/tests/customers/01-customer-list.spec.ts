import { test, expect } from '@playwright/test';
import { seedEmptyAppState, seedPopulatedAppState } from '../../fixtures/seed-state';
import { navigateToTab } from '../../utils/helpers';

test.describe('Customers — List', () => {
  test('shows empty state when no customers', async ({ page }) => {
    await seedEmptyAppState(page);
    await navigateToTab(page, 'clientes');

    await expect(page.getByTestId('customer-list')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('No hay clientes')).toBeVisible();
  });

  test('shows customer data table when customers exist', async ({ page }) => {
    await seedPopulatedAppState(page);
    await navigateToTab(page, 'clientes');

    await expect(page.getByTestId('customer-list')).toBeVisible({ timeout: 10000 });
    // Should show customer names from seeded data
    await expect(page.getByText('Maria Gonzalez')).toBeVisible();
    await expect(page.getByText('Ana Lopez')).toBeVisible();
  });

  test('search filters customers by name', async ({ page }) => {
    await seedPopulatedAppState(page);
    await navigateToTab(page, 'clientes');

    await expect(page.getByTestId('customer-list')).toBeVisible({ timeout: 10000 });

    // Type in search input
    const searchInput = page.getByPlaceholder('Buscar por nombre, NIT o DUI...');
    await searchInput.fill('Ana');

    // Ana should be visible, Maria should not
    await expect(page.getByText('Ana Lopez')).toBeVisible();
    await expect(page.getByText('Maria Gonzalez')).not.toBeVisible();
  });
});
