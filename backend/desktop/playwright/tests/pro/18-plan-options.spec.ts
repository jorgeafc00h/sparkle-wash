import { test, expect, Page } from '@playwright/test';
import {
  seedPlanUser,
  ADFREE_ACTIVE_SUBSCRIPTION,
  PRO_ACTIVE_SUBSCRIPTION,
} from '../../fixtures/pro-state';

/**
 * What each plan state is offered (2026-11-07 review fixes):
 *  - only real upgrades are sold — no "Mejorar plan" that lists cheaper plans;
 *  - a running free trial can buy any plan, with a note that it replaces the trial;
 *  - card update / cancel only exist for an N1CO subscription (a trial has none);
 *  - plan copy uses the real company cap from FeatureGate (Pro = 2).
 */

const IN_10_DAYS = () => new Date(Date.now() + 10 * 24 * 60 * 60 * 1000 - 60_000).toISOString();

const PRO_SYNC_TRIAL_SUBSCRIPTION = {
  productId: 'n1co.facturassimples.pro.monthly',
  tier: 'pro_sync',
  purchaseDate: new Date().toISOString(),
  expiryDate: IN_10_DAYS(),
  isAutoRenewing: true,
  transactionId: '',
  platform: 'web',
  n1coSubscriptionId: '',
};

async function openAccount(page: Page) {
  await page.goto('/#/settings/account');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByTestId('account-summary')).toBeVisible({ timeout: 10_000 });
}

async function openPromo(page: Page) {
  await page.goto('/#/settings/promo');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('heading', { name: 'Planes y Códigos Promocionales' })).toBeVisible({ timeout: 10_000 });
}

test.describe('Plan options by plan state', () => {
  test('Free user: both plans offered, Pro advertises the real 2-company cap', async ({ page }) => {
    await seedPlanUser(page, { tier: 'lite' });
    await openPromo(page);
    await expect(page.getByRole('heading', { name: 'Pagar con tarjeta' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Pro.*\$7\.00\/mes/ })).toContainText('2 empresas');
    await expect(page.getByRole('button', { name: /Business.*\$14\.00\/mes/ })).toContainText('Empresas ilimitadas');
    await expect(page.getByText(/3 empresas/)).toHaveCount(0);
  });

  test('Pro user: only the Business upgrade, usage shows "/ 2"', async ({ page }) => {
    await seedPlanUser(page, { tier: 'adfree', activeSubscription: ADFREE_ACTIVE_SUBSCRIPTION });
    await openAccount(page);
    await expect(page.getByText(/^\d+ \/ 2$/)).toBeVisible();
    await expect(page.getByText('2 empresas máximo')).toBeVisible();
    await expect(page.getByTestId('account-change-card-btn')).toBeVisible();
    await expect(page.getByTestId('account-cancel-subscription-btn')).toBeVisible();

    await openPromo(page);
    await expect(page.getByRole('button', { name: /Business.*\$14\.00\/mes/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Pro.*\$7\.00\/mes/ })).toHaveCount(0);
  });

  test('Business user: nothing to buy, card management stays', async ({ page }) => {
    await seedPlanUser(page, { tier: 'pro', activeSubscription: PRO_ACTIVE_SUBSCRIPTION });
    await openAccount(page);
    await expect(page.getByRole('button', { name: 'Cambiar Plan' })).toHaveCount(0);
    await expect(page.getByTestId('account-cancel-subscription-btn')).toBeVisible();
    await openPromo(page);
    await expect(page.getByRole('heading', { name: 'Pagar con tarjeta' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Mejorar plan' })).toHaveCount(0);
  });

  test('Paid Pro+Sync user: no downgrade offered as "Mejorar plan"', async ({ page }) => {
    await seedPlanUser(page, {
      tier: 'pro_sync',
      activeSubscription: { ...PRO_ACTIVE_SUBSCRIPTION, tier: 'pro_sync', n1coSubscriptionId: 'sub-prosync-1' },
    });
    await openAccount(page);
    await expect(page.getByRole('button', { name: 'Cambiar Plan' })).toHaveCount(0);
    await openPromo(page);
    await expect(page.getByRole('button', { name: 'Mejorar plan' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Pagar con tarjeta' })).toHaveCount(0);
  });

  test('Free-trial user: trial shown, no card/cancel actions, any plan can be bought', async ({ page }) => {
    await seedPlanUser(page, {
      tier: 'pro_sync',
      activeSubscription: PRO_SYNC_TRIAL_SUBSCRIPTION,
      trialUntil: IN_10_DAYS(),
    });
    await openAccount(page);
    await expect(page.getByTestId('account-trial-badge')).toHaveText('Prueba gratis: 10 días restantes');
    await expect(page.getByTestId('account-change-card-btn')).toHaveCount(0);
    await expect(page.getByTestId('account-cancel-subscription-btn')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cambiar Plan' })).toBeVisible();

    await openPromo(page);
    await expect(page.getByTestId('promo-trial-note')).toBeVisible();
    await expect(page.getByRole('button', { name: /Pro.*\$7\.00\/mes/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Business.*\$14\.00\/mes/ })).toBeVisible();
  });
});
