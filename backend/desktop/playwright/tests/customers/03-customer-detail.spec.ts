import { test, expect } from '@playwright/test';
import { seedPopulatedAppState, SAMPLE_CUSTOMERS } from '../../fixtures/seed-state';
import { navigateToTab } from '../../utils/helpers';

test.describe('Customers — Detail', () => {
  test('navigating to customer detail shows customer info', async ({ page }) => {
    await seedPopulatedAppState(page);
    // Navigate directly to customer detail
    await page.goto(`/#/customers/${SAMPLE_CUSTOMERS[0].id}`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('sidebar-inicio')).toBeVisible({ timeout: 10000 });

    await expect(page.getByTestId('customer-detail')).toBeVisible({ timeout: 8000 });
    // Customer name should appear in the page header or content
    await expect(page.getByText('Maria').first()).toBeVisible();
  });

  test('customer detail shows edit and delete buttons', async ({ page }) => {
    await seedPopulatedAppState(page);
    // Navigate directly to the first customer's detail page
    await page.goto(`/#/customers/${SAMPLE_CUSTOMERS[0].id}`);
    await page.waitForLoadState('domcontentloaded');

    // Wait for sidebar (app ready)
    await expect(page.getByTestId('sidebar-inicio')).toBeVisible({ timeout: 10000 });

    // Should show action buttons (data-testid based)
    await expect(page.getByTestId('edit-customer-btn')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('delete-customer-btn')).toBeVisible();
  });
});
