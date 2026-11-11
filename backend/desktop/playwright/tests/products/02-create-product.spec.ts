import { test, expect } from '@playwright/test';
import { seedEmptyAppState } from '../../fixtures/seed-state';
import { navigateToTab } from '../../utils/helpers';

test.describe('Products — Create', () => {
  test('navigate to add product form and fill required fields', async ({ page }) => {
    await seedEmptyAppState(page);
    await navigateToTab(page, 'productos');

    // Click add product button (data-testid preferred)
    await page.getByTestId('add-product-btn').click();
    await expect(page.getByTestId('product-form')).toBeVisible({ timeout: 10000 });

    // Fill required name field
    await page.getByLabel('Nombre del Producto', { exact: false }).first().fill('Producto Test');
    await expect(page.getByLabel('Nombre del Producto', { exact: false }).first()).toHaveValue('Producto Test');
  });

  test('submit product form adds to list', async ({ page }) => {
    await seedEmptyAppState(page);
    await navigateToTab(page, 'productos');

    await page.getByTestId('add-product-btn').click();
    await expect(page.getByTestId('product-form')).toBeVisible({ timeout: 10000 });

    // Fill required fields — productName and unitPrice are required
    await page.getByLabel('Nombre del Producto', { exact: false }).first().fill('Nuevo Producto E2E');
    await page.getByLabel('Precio Unitario', { exact: false }).first().fill('10.00');
    await page.getByTestId('submit-product-btn').click();

    // Should go back to products list and show the new product
    await expect(page.getByTestId('product-list')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Nuevo Producto E2E')).toBeVisible({ timeout: 5000 });
  });
});
