/**
 * Product categories — end to end (2026-09 category filter enhancement).
 *
 * Covers the full UX loop:
 *   Configuración → Categorías: create categories ahead of use
 *   Product form:  assign via dropdown + quick-add "+ Nueva categoría…"
 *   Product list:  filter by the category dropdown (combined with chips/search)
 *   Settings:      rename rewrites the affected products, delete guarded in use
 *
 * Sync note: categories ride the product payload (plain `product.category`
 * string, App.ReactNative parity) — assigning one here is a normal
 * products/updateProduct write, so it reaches the Device-Sync outbox.
 */

import { test, expect } from '@playwright/test';
import { seedPopulatedAppState, waitForAppReady } from '../../fixtures/seed-state';

test.describe('Product categories', () => {
  test.beforeEach(async ({ page }) => {
    await seedPopulatedAppState(page);
  });

  test('create categories in Configuración, assign on the product form, filter the list', async ({ page }) => {
    // ── Configuración → Categorías de Productos ────────────────────────────
    await page.goto('/#/settings');
    await waitForAppReady(page);
    await page.getByTestId('settings-product-categories').click();
    await expect(page.getByTestId('product-categories')).toBeVisible();

    // Empty state invites the first category.
    await expect(page.getByTestId('categories-empty')).toBeVisible();

    await page.getByTestId('new-category-name').fill('Accesorios');
    await page.getByTestId('add-category-btn').click();
    await expect(page.getByTestId('category-row-Accesorios')).toBeVisible();
    await expect(page.getByTestId('category-count-Accesorios')).toContainText('0 productos');

    await page.getByTestId('new-category-name').fill('Periféricos');
    await page.getByTestId('add-category-btn').click();
    await expect(page.getByTestId('categories-list').locator('li')).toHaveCount(2);

    // Duplicate names are rejected with a toast.
    await page.getByTestId('new-category-name').fill('Accesorios');
    await page.getByTestId('add-category-btn').click();
    await expect(page.getByTestId('categories-list').locator('li')).toHaveCount(2);

    // ── Assign from the product form dropdown ─────────────────────────────
    await page.goto('/#/products/add');
    await waitForAppReady(page);

    await page.getByLabel('Nombre del Producto').fill('Mouse inalámbrico');
    await page.getByLabel('Precio Unitario ($)').fill('12.50');
    await page.getByLabel('Categoría', { exact: true }).selectOption('Accesorios');
    await page.getByTestId('submit-product-btn').click();
    await expect(page).toHaveURL(/#\/products$/);

    // The new product shows its category under the name.
    const row = page.getByTestId('product-list').locator('tbody tr', { hasText: 'Mouse inalámbrico' });
    await expect(row).toContainText('Accesorios');

    // ── Quick-add a category inline on the form ───────────────────────────
    await page.goto('/#/products/add');
    await waitForAppReady(page);
    await page.getByLabel('Nombre del Producto').fill('Teclado mecánico');
    await page.getByLabel('Precio Unitario ($)').fill('25.00');
    await page.getByLabel('Categoría', { exact: true }).selectOption('__new__');
    await page.getByTestId('new-category-input').fill('Gaming');
    await page.getByTestId('submit-product-btn').click();
    await expect(page).toHaveURL(/#\/products$/);

    // ── Filter the list with the dropdown ─────────────────────────────────
    await expect(page.getByTestId('product-list').locator('tbody tr')).toHaveCount(7); // 5 seeded + 2 new

    await page.getByTestId('category-filter').selectOption('Accesorios');
    await expect(page.getByTestId('product-list').locator('tbody tr')).toHaveCount(1);
    await expect(page.getByTestId('product-list').locator('tbody tr').first()).toContainText('Mouse inalámbrico');

    // Combines with the stock chips: Accesorios ∩ Servicios hits the empty
    // state (DataTable renders one placeholder row when nothing matches).
    await page.getByTestId('filter-chip-SERVICES').click();
    await expect(page.getByTestId('product-list').locator('tbody tr').first()).toContainText(
      'No se encontraron productos',
    );

    // …and with search.
    await page.getByTestId('filter-chip-ALL').click();
    await page.getByTestId('product-search').locator('input').fill('teclado');
    await expect(page.getByTestId('product-list').locator('tbody tr').first()).toContainText(
      'No se encontraron productos',
    );
    await page.getByTestId('category-filter').selectOption('Gaming');
    await expect(page.getByTestId('product-list').locator('tbody tr')).toHaveCount(1);

    await page.getByTestId('category-filter').selectOption('ALL');
    await page.getByTestId('product-search').locator('input').fill('');
    await expect(page.getByTestId('product-list').locator('tbody tr')).toHaveCount(7);
  });

  test('rename in Configuración rewrites the products; delete is guarded while in use', async ({ page }) => {
    // Seed a category via a product (the auto-add path).
    await page.goto('/#/products/add');
    await waitForAppReady(page);
    await page.getByLabel('Nombre del Producto').fill('Cable HDMI 2m');
    await page.getByLabel('Precio Unitario ($)').fill('9.50');
    await page.getByLabel('Categoría', { exact: true }).selectOption('__new__');
    await page.getByTestId('new-category-input').fill('Cables');
    await page.getByTestId('submit-product-btn').click();
    await expect(page).toHaveURL(/#\/products$/);

    await page.goto('/#/settings/categories');
    await waitForAppReady(page);
    await expect(page.getByTestId('category-row-Cables')).toBeVisible();
    await expect(page.getByTestId('category-count-Cables')).toContainText('1 producto');

    // Delete is disabled while a product uses the category.
    await expect(page.getByTestId('delete-btn-Cables')).toBeDisabled();

    // Rename: the list entry moves and the product follows.
    await page.getByTestId('rename-btn-Cables').click();
    await page.getByTestId('rename-input-Cables').fill('Cableado');
    await page.getByTestId('rename-confirm-Cables').click();
    await expect(page.getByTestId('category-row-Cableado')).toBeVisible();
    await expect(page.getByTestId('category-count-Cableado')).toContainText('1 producto');

    await page.goto('/#/products');
    await waitForAppReady(page);
    await expect(
      page.getByTestId('product-list').locator('tbody tr', { hasText: 'Cable HDMI 2m' }),
    ).toContainText('Cableado');

    // Now unused categories can be deleted.
    await page.goto('/#/settings/categories');
    await waitForAppReady(page);
    await page.getByTestId('new-category-name').fill('Vacía');
    await page.getByTestId('add-category-btn').click();
    await expect(page.getByTestId('delete-btn-Vacía')).toBeEnabled();
    await page.getByTestId('delete-btn-Vacía').click();
    await expect(page.getByTestId('category-row-Vacía')).toHaveCount(0);
  });
});
