/**
 * Cross-Platform Account Entitlement — Desktop coded UI
 * (openspec add-cross-platform-entitlement).
 *
 * The "buy with your credit card on any platform, use everywhere" contract on Desktop:
 * GET /api/v2/account/entitlements (internal JWT) is the only channel that answers in
 * these tests — the legacy N1CO status endpoint returns 503, exactly like a backend
 * partial outage — so any tier the page ends up on came from the account entitlement.
 *
 *  - a pro_sync account entitlement unlocks the Device Sync panel,
 *  - a `free` entitlement never over-grants (panel stays locked for a Lite seed),
 *  - an unreachable entitlement endpoint never changes the rehydrated tier.
 */

import { test, expect, type Page } from '@playwright/test';
import { seedAccountEntitlementUser } from '../../fixtures/pro-state';

const ENTITLEMENTS_URL = '**/api/v2/account/entitlements**';

function proSyncEntitlement() {
  return {
    tier: 'pro_sync',
    planTier: 'pro_sync',
    status: 'active',
    planName: 'Business',
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    features: { sync: true, adFree: true, email: true },
  };
}

async function fulfillEntitlements(page: Page, body: unknown, status = 200): Promise<void> {
  await page.route(ENTITLEMENTS_URL, (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }),
  );
}

async function openSyncPage(page: Page): Promise<void> {
  await page.goto('/#/settings');
  await page.getByTestId('settings-device-sync').click();
  await expect(page.getByTestId('sync-v2-screen')).toBeVisible();
}

test.describe('Account entitlement — cross-platform unlock', () => {
  test('a pro_sync account entitlement unlocks Device Sync with the N1CO channel down', async ({ page }) => {
    await fulfillEntitlements(page, proSyncEntitlement());
    await seedAccountEntitlementUser(page, 'lite');

    // The auto-retrying assertions below give the startup entitlement refresh time to
    // land — no manual waitForResponse race.
    await openSyncPage(page);
    await expect(page.getByTestId('sync-v2-locked')).toHaveCount(0);
    await expect(page.getByTestId('sync-v2-upgrade-button')).toHaveCount(0);
    await expect(page.getByTestId('sync-now-button').first()).toBeVisible();
  });

  test('a free account entitlement never over-grants (Lite stays locked)', async ({ page }) => {
    await fulfillEntitlements(page, {
      tier: 'free',
      status: 'none',
      features: { sync: false, adFree: false, email: true },
    });
    await seedAccountEntitlementUser(page, 'lite');

    await openSyncPage(page);
    await expect(page.getByTestId('sync-v2-locked')).toBeVisible();
    await expect(page.getByTestId('sync-v2-upgrade-button')).toBeVisible();
    await expect(page.getByTestId('sync-now-button')).toHaveCount(0);
  });

  test('an unreachable entitlement endpoint keeps the rehydrated tier untouched', async ({ page }) => {
    await fulfillEntitlements(page, { tier: 'free' }, 404);
    await seedAccountEntitlementUser(page, 'adfree');

    await openSyncPage(page);
    // AdFree is paid (no ads) but NOT sync-entitled — the panel stays locked and the
    // app must not crash or show an error state.
    await expect(page.getByTestId('sync-v2-locked')).toBeVisible();
  });
});
