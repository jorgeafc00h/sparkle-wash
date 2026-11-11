/**
 * Product list — inventory health summary + filter chips (2026-09-26 UX pass).
 *
 * The summary cards give the owner a stock pulse (totals, low-stock,
 * out-of-stock, inventory value at cost) and double as one-click filters.
 * Seeded products: 2 inventory-tracked (laptop stock 10/threshold 2, paper
 * stock 100/threshold 10), 1 low-stock (chair stock 5 = threshold 5),
 * 2 services.
 */

import { test, expect } from '@playwright/test';
import { seedPopulatedAppState, waitForAppReady } from '../../fixtures/seed-state';

test.describe('Product list inventory summary', () => {
  test.beforeEach(async ({ page }) => {
    await seedPopulatedAppState(page);
  });

  test('summary cards reflect seeded stock and filter the table', async ({ page }) => {
    await page.goto('/#/products');
    await waitForAppReady(page);

    await expect(page.getByTestId('product-inventory-summary')).toBeVisible();
    await expect(page.getByTestId('stat-total-products')).toContainText('5');
    await expect(page.getByTestId('stat-low-stock')).toContainText('1'); // Silla 5 ≤ 5
    await expect(page.getByTestId('stat-out-of-stock')).toContainText('0');

    // One click on "Agotados" (empty here) still filters; "Stock bajo" narrows to the chair.
    await page.getByTestId('stat-low-stock').click();
    await expect(page.getByTestId('product-list').locator('tbody tr')).toHaveCount(1);
    await expect(page.getByTestId('product-list').locator('tbody tr').first()).toContainText('Silla');

    // Chips clear back to the full list.
    await page.getByTestId('filter-chip-ALL').click();
    await expect(page.getByTestId('product-list').locator('tbody tr')).toHaveCount(5);
  });

  test('barcode is searchable and shown under the code column', async ({ page }) => {
    await page.goto('/#/products');
    await waitForAppReady(page);

    await page.getByTestId('product-search').locator('input').fill('7891234567890');
    await expect(page.getByTestId('product-list').locator('tbody tr')).toHaveCount(1);
    await expect(page.getByTestId('product-list').locator('tbody tr').first()).toContainText('Laptop');
    await expect(page.getByTestId('product-list').locator('tbody tr').first()).toContainText('7891234567890');
  });
});
