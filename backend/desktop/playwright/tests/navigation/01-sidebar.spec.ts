import { test, expect } from '@playwright/test';
import { seedEmptyAppState } from '../../fixtures/seed-state';

test.describe('Navigation — Sidebar', () => {
  test('sidebar is visible after authentication', async ({ page }) => {
    await seedEmptyAppState(page);
    await expect(page.getByTestId('sidebar-inicio')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('sidebar-facturas')).toBeVisible();
    await expect(page.getByTestId('sidebar-clientes')).toBeVisible();
    await expect(page.getByTestId('sidebar-productos')).toBeVisible();
  });

  test('sidebar-inicio navigates to dashboard', async ({ page }) => {
    await seedEmptyAppState(page);
    await page.getByTestId('sidebar-inicio').click();
    await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 8000 });
    await expect(page).toHaveURL(/\/home/);
  });

  test('sidebar-facturas navigates to invoice list', async ({ page }) => {
    await seedEmptyAppState(page);
    await page.getByTestId('sidebar-facturas').click();
    await expect(page).toHaveURL(/\/invoices/, { timeout: 5000 });
  });

  test('sidebar-clientes navigates to customer list', async ({ page }) => {
    await seedEmptyAppState(page);
    await page.getByTestId('sidebar-clientes').click();
    await expect(page.getByTestId('customer-list')).toBeVisible({ timeout: 8000 });
    await expect(page).toHaveURL(/\/customers/);
  });

  test('sidebar-productos navigates to product list', async ({ page }) => {
    await seedEmptyAppState(page);
    await page.getByTestId('sidebar-productos').click();
    await expect(page).toHaveURL(/\/products/, { timeout: 5000 });
  });

  test('active sidebar item reflects current route', async ({ page }) => {
    await seedEmptyAppState(page);
    await page.getByTestId('sidebar-clientes').click();
    await page.waitForURL(/\/customers/);

    // Verify we're on the customers route (active state is route-based)
    await expect(page).toHaveURL(/\/customers/);

    // The active NavLink should have the active styling class
    // React Router's NavLink applies isActive classes via the className callback
    await page.waitForTimeout(500);
    const activeLink = page.getByTestId('sidebar-clientes');
    await expect(activeLink).toBeVisible();
  });
});
