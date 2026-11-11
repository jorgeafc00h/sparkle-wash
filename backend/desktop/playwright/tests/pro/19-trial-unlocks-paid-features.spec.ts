import { test, expect, type Page } from '@playwright/test';
import { seedAccountEntitlementUser } from '../../fixtures/pro-state';

// A Free account starts the 60-day trial from a LOCKED paid screen and that screen
// (Libros IVA export, POS consolidation, ...) unlocks without leaving the page.
async function stubTrialBackend(page: Page) {
  const trialUntil = new Date(Date.now() + 30 * 86_400_000).toISOString();
  let granted = false;
  await page.route('**/v2/account/entitlements**', (route) =>
    route.fulfill({
      json: granted
        ? { tier: 'pro_sync', status: 'trialing', trialUntil, features: { sync: true, adFree: true, email: true } }
        : { tier: 'free', status: 'active' },
    }),
  );
  await page.route('**/auth/sync-trial', (route) => {
    granted = true;
    return route.fulfill({ json: { tier: 'pro_sync', trialUntil } });
  });
}

test.describe('Free trial unlocks paid features', () => {
  test('Libros IVA: locked → start trial → export screen', async ({ page }) => {
    await stubTrialBackend(page);
    await seedAccountEntitlementUser(page, 'lite');
    await page.goto('/#/invoices/libros-iva');

    await expect(page.getByTestId('libros-iva-locked')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('trial-offer')).toContainText('Libros de IVA');
    await page.getByTestId('trial-offer-start').click();

    await expect(page.getByTestId('libros-iva')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('libros-iva-locked')).toHaveCount(0);
  });

  test('Sidebar: a Free user clicks the locked Libros IVA item and reaches the trial offer', async ({ page }) => {
    await stubTrialBackend(page);
    await seedAccountEntitlementUser(page, 'lite');
    await page.goto('/#/home');
    const item = page.getByTestId('sidebar-libros-iva');
    await expect(item).toHaveAttribute('data-locked', 'tier', { timeout: 15_000 });
    await item.click();
    await page.getByTestId('trial-offer-start').click();
    await expect(page.getByTestId('libros-iva')).toBeVisible({ timeout: 15_000 });
    await expect(item).not.toHaveAttribute('data-locked', /.*/);
  });

  test('POS consolidation: locked → start trial → wizard', async ({ page }) => {
    await stubTrialBackend(page);
    await seedAccountEntitlementUser(page, 'lite');
    await page.goto('/#/pos/consolidate');

    await expect(page.getByTestId('pos-consolidate-locked')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('trial-offer-start').click();

    await expect(page.getByTestId('pos-consolidate')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('pos-consolidate-locked')).toHaveCount(0);
  });

  test('trial already used (server 409): offer replaced by notice, screen stays locked', async ({ page }) => {
    await page.route('**/v2/account/entitlements**', (route) =>
      route.fulfill({ json: { tier: 'free', status: 'active' } }),
    );
    await page.route('**/auth/sync-trial', (route) => route.fulfill({ status: 409, json: { alreadyUsed: true } }));
    await seedAccountEntitlementUser(page, 'lite');
    await page.goto('/#/invoices/libros-iva');
    await page.getByTestId('trial-offer-start').click();
    await expect(page.getByTestId('trial-offer-used')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('trial-offer-start')).toHaveCount(0);
    await expect(page.getByTestId('libros-iva-locked')).toBeVisible();
  });
});
