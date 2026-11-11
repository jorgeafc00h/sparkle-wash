/**
 * Product barcode (2026-11-01): the product form had no barcode field, so the
 * POS scanner could only find products created through "Crear producto" on a
 * barcode miss. A barcode typed in Productos must reach the register.
 */
import { test, expect } from '@playwright/test';
import { seedPopulatedAppState, waitForAppReady } from '../../fixtures/seed-state';
import { navigateToTab } from '../../utils/helpers';

test.describe('Products — barcode', () => {
  test('a barcode saved in the product form is found by the POS scanner', async ({ page }) => {
    await seedPopulatedAppState(page);
    await navigateToTab(page, 'productos');

    await page.getByTestId('add-product-btn').click();
    await expect(page.getByTestId('product-form')).toBeVisible({ timeout: 10000 });
    await page.getByLabel('Nombre del Producto', { exact: false }).first().fill('Café molido 400 g');
    await page.getByLabel('Precio Unitario', { exact: false }).first().fill('4.25');
    await page.locator('input[name="barcode"]').fill('7401234500017');
    await page.getByTestId('submit-product-btn').click();
    await expect(page.getByTestId('product-list')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Café molido 400 g')).toBeVisible();

    await page.goto('/#/pos');
    await waitForAppReady(page);
    await page.getByTestId('pos-search-input').fill('7401234500017');
    await page.getByTestId('pos-search-input').press('Enter');
    const lines = page.getByTestId('pos-cart-lines').locator('[data-testid^="pos-cart-line-"]');
    await expect(lines).toHaveCount(1);
    await expect(lines.first()).toContainText('Café molido 400 g');
    await expect(page.getByTestId('pos-total')).toContainText('4.25');
  });

  test('editing a product keeps and shows its barcode', async ({ page }) => {
    await seedPopulatedAppState(page);
    await navigateToTab(page, 'productos');
    await page.getByTestId('add-product-btn').click();
    await page.getByLabel('Nombre del Producto', { exact: false }).first().fill('Azúcar 1 kg');
    await page.getByLabel('Precio Unitario', { exact: false }).first().fill('1.10');
    await page.locator('input[name="barcode"]').fill('7400000000011');
    await page.getByTestId('submit-product-btn').click();
    await expect(page.getByTestId('product-list')).toBeVisible({ timeout: 10000 });

    // Open its edit form (route /products/:id/edit) through the store id.
    const id = await page.evaluate(() => {
      const store = (window as unknown as { __fsStore: { getState: () => { products: { products: Array<{ id: string; productName: string }> } } } }).__fsStore;
      return store.getState().products.products.find((p) => p.productName === 'Azúcar 1 kg')?.id;
    });
    expect(id).toBeTruthy();
    await page.goto(`/#/products/${id}/edit`);
    await waitForAppReady(page);
    await expect(page.locator('input[name="barcode"]')).toHaveValue('7400000000011', { timeout: 10000 });
  });
});
