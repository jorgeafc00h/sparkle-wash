// StickyToolbar — the DTE search/filter band must stay pinned to the top of
// the scrolling content area while the invoice list scrolls (shared
// StickyToolbar component used across all list pages).

import { test, expect } from '@playwright/test';
import { seedPopulatedAppState } from '../../fixtures/seed-state';

test.describe('Sticky search/filter toolbar', () => {
  test('DTE toolbar remains pinned at the top edge while the list scrolls', async ({ page }) => {
    await seedPopulatedAppState(page);
    // Small viewport so the seeded list overflows and the page scrolls.
    await page.setViewportSize({ width: 900, height: 380 });
    await page.goto('/#/invoices');
    await expect(page.getByTestId('search-bar')).toBeVisible({ timeout: 10_000 });

    const toolbar = page.getByTestId('dte-sticky-toolbar');
    await expect(toolbar).toBeVisible();

    const before = await toolbar.boundingBox();
    const main = page.locator('main');
    await main.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(300);

    const after = await toolbar.boundingBox();
    const probe = await main.evaluate((el) => ({
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));

    // The page must actually scroll, and the toolbar must stick flush at
    // the top edge of the scroll area (not scroll away with the content).
    expect(probe.scrollTop).toBeGreaterThan(140);
    expect(after!.y).toBeGreaterThanOrEqual(0);
    expect(after!.y).toBeLessThan(2);
    expect(before!.y).toBeGreaterThan(after!.y);

    // The search input is still usable while pinned.
    const input = page.getByTestId('search-bar').locator('input');
    await input.fill('DTE');
    await expect(input).toHaveValue('DTE');
  });

  test('product list toolbar pins with search + stock chips', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.setViewportSize({ width: 900, height: 380 });
    await page.goto('/#/products');
    await expect(page.getByTestId('product-search')).toBeVisible({ timeout: 10_000 });

    const toolbar = page.getByTestId('product-sticky-toolbar');
    await expect(toolbar).toBeVisible();
    const main = page.locator('main');
    await main.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(300);

    const after = await toolbar.boundingBox();
    expect(after!.y).toBeGreaterThanOrEqual(0);
    expect(after!.y).toBeLessThan(2);
    await expect(page.getByTestId('filter-chip-LOW')).toBeVisible();
  });
});
