import { test, expect } from '@playwright/test';
import { seedPopulatedAppState, seedEmptyAppState } from '../../fixtures/seed-state';
import { navigateToTab } from '../../utils/helpers';

test.describe('Dashboard — Home', () => {
  test('shows summary cards', async ({ page }) => {
    await seedPopulatedAppState(page);
    await navigateToTab(page, 'inicio');

    await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 10000 });

    // Summary cards
    await expect(page.getByText('Total Facturas')).toBeVisible();
    await expect(page.getByText('Total Compras')).toBeVisible();
    await expect(page.getByText('Ingresos del Mes')).toBeVisible();
    await expect(page.getByText('Pendientes de Sincronizar')).toBeVisible();
  });

  test('shows recent invoices table when invoices exist', async ({ page }) => {
    await seedPopulatedAppState(page);
    await navigateToTab(page, 'inicio');

    await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Últimas Facturas')).toBeVisible();

    // Seeded invoices should appear — dashboard shows customer name, not control number
    await expect(page.getByText('Maria Gonzalez')).toBeVisible();
  });

  test('quick action Nueva Factura navigates to add invoice', async ({ page }) => {
    await seedEmptyAppState(page);
    await navigateToTab(page, 'inicio');

    await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 10000 });
    await page.getByText('Nueva Factura').click();

    await expect(page).toHaveURL(/\/invoices\/add/, { timeout: 5000 });
  });
});
