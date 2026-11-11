import { test, expect } from '@playwright/test';
import { seedPopulatedAppState, TEST_COMPANY } from '../../fixtures/seed-state';
import { navigateToTab } from '../../utils/helpers';

test.describe('Companies — List', () => {
  test('shows company in list', async ({ page }) => {
    await seedPopulatedAppState(page);
    // Navigate directly to companies page
    await page.goto('/#/companies');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('sidebar-inicio')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('company-list')).toBeVisible({ timeout: 10000 });

    // TestCo appears both in sidebar footer and table cell — use cell selector
    await expect(page.getByRole('cell', { name: TEST_COMPANY.nombreComercial })).toBeVisible();
  });

  test('click company row navigates to company detail', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/companies');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('sidebar-inicio')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('company-list')).toBeVisible({ timeout: 10000 });

    // Click on the TestCo row (use table cell to avoid strict mode violation with sidebar)
    await page.getByRole('cell', { name: TEST_COMPANY.nombreComercial }).click();
    await expect(page).toHaveURL(/\/companies\//, { timeout: 8000 });
  });

  // 2026-09 badge/predeterminar fix: the ACTIVE company (where DTEs/tickets
  // are created — what the sidebar badge reflects) must be labeled on the list
  // so it can't be confused with the "Predeterminada" star, and the detail
  // page confirms the active state instead of leaving it ambiguous.
  test('marks the active company on the list and on its detail page', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/companies');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('company-list')).toBeVisible({ timeout: 10000 });

    // The seeded company is the selected one — its row carries the "Activa" badge.
    await expect(
      page.locator('tbody tr', { hasText: TEST_COMPANY.nombreComercial }).getByText('Activa'),
    ).toBeVisible();

    // Detail page confirms the active company (DTE/tickets destination).
    await page.getByRole('cell', { name: TEST_COMPANY.nombreComercial }).click();
    await expect(page).toHaveURL(/\/companies\//, { timeout: 8000 });
    await expect(page.getByTestId('company-active-badge')).toBeVisible();
    await expect(page.getByTestId('select-company-btn')).toHaveCount(0);
  });
});
