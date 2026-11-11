import { test, expect } from '@playwright/test';
import { seedEmptyAppState, seedPopulatedAppState } from '../../fixtures/seed-state';
import { navigateToTab } from '../../utils/helpers';

test.describe('Products — List', () => {
  test('shows empty state when no products', async ({ page }) => {
    await seedEmptyAppState(page);
    await navigateToTab(page, 'productos');

    await expect(page.getByText('No hay productos')).toBeVisible({ timeout: 10000 });
  });

  test('shows product data table when products exist', async ({ page }) => {
    await seedPopulatedAppState(page);
    await navigateToTab(page, 'productos');

    await expect(page.getByText('Servicio de Consultoría')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Laptop Dell Inspiron')).toBeVisible();
  });

  test('search filters products by name', async ({ page }) => {
    await seedPopulatedAppState(page);
    await navigateToTab(page, 'productos');

    await expect(page.getByText('Servicio de Consultoría')).toBeVisible({ timeout: 10000 });

    // Type in search
    const searchInput = page.getByPlaceholder(/Buscar/i);
    await searchInput.first().fill('Laptop');

    await expect(page.getByText('Laptop Dell Inspiron')).toBeVisible();
    await expect(page.getByText('Servicio de Consultoría')).not.toBeVisible();
  });
});
