import { test, expect } from '@playwright/test';
import { seedPopulatedAppState } from '../../fixtures/seed-state';
import { navigateToTab } from '../../utils/helpers';

test.describe('Products — Stock Management', () => {
  test('create tracked product with threshold and show low-stock status in detail', async ({ page }) => {
    await seedPopulatedAppState(page);
    await navigateToTab(page, 'productos');

    await page.getByTestId('add-product-btn').click();
    await expect(page.getByTestId('product-form')).toBeVisible({ timeout: 10000 });

    await page.getByLabel('Nombre del Producto', { exact: false }).first().fill('Producto Inventario E2E');
    await page.getByLabel('Precio Unitario', { exact: false }).first().fill('25.00');
    await page.getByLabel('Cantidad en Stock', { exact: false }).first().fill('4');
    await page.getByLabel('Umbral Stock Bajo', { exact: false }).first().fill('5');

    await page.getByTestId('submit-product-btn').click();

    await expect(page.getByTestId('product-list')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Producto Inventario E2E')).toBeVisible({ timeout: 5000 });

    await page.getByText('Producto Inventario E2E').click();
    await expect(page.getByTestId('product-detail')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('heading', { name: 'Inventario', exact: true })).toBeVisible();
    await expect(page.getByText('Stock bajo', { exact: true })).toBeVisible();
  });

  test('stock adjustment updates product to out-of-stock state', async ({ page }) => {
    await seedPopulatedAppState(page);
    await navigateToTab(page, 'productos');

    await page.getByTestId('stock-adjustment-btn').click();
    await expect(page.getByTestId('stock-adjustment-page')).toBeVisible({ timeout: 10000 });

    await page.getByLabel('Ajuste para Laptop Dell Inspiron').fill('-10');
    await page.getByTestId('save-stock-btn').click();

    await expect(page.getByText('Se actualizaron 1 producto')).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: 'Volver' }).click();
    await expect(page.getByTestId('product-list')).toBeVisible({ timeout: 5000 });

    const laptopRow = page.locator('tr', { hasText: 'Laptop Dell Inspiron' });
    await expect(laptopRow.getByText('Sin stock')).toBeVisible({ timeout: 5000 });
  });
});
