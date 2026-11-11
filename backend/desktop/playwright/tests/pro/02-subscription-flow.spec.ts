import { test, expect } from '@playwright/test';
import {
  seedLiteUserState,
  seedAdFreeUserState,
  seedProUserWithGoogleAuth,
  seedProUserWithoutGoogleAuth,
  ADFREE_ACTIVE_SUBSCRIPTION,
  PRO_ACTIVE_SUBSCRIPTION,
} from '../../fixtures/pro-state';
import { navigateToTab } from '../../utils/helpers';

async function mockSubscriptionStatus(
  page: import('@playwright/test').Page,
  tier: 'adfree' | 'pro',
) {
  const subscription = tier === 'pro' ? PRO_ACTIVE_SUBSCRIPTION : ADFREE_ACTIVE_SUBSCRIPTION;
  await page.route('**/subscription/n1co/status', (route) =>
    route.fulfill({ json: { tier, subscription } }),
  );
}

test.describe('Subscription Flow — Account Summary', () => {
  test('settings page shows Free badge for Lite user', async ({ page }) => {
    await seedLiteUserState(page);
    await navigateToTab(page, 'configuracion');

    await expect(page.getByTestId('settings')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Free')).toBeVisible();
  });

  test('settings page shows Business badge for Pro user', async ({ page }) => {
    await mockSubscriptionStatus(page, 'pro');
    await seedProUserWithGoogleAuth(page);
    await navigateToTab(page, 'configuracion');

    await expect(page.getByTestId('settings')).toBeVisible({ timeout: 10000 });
    // The Cuenta card shows the tier badge — scope to the badge element specifically
    await expect(
      page.locator('span.bg-purple-100').filter({ hasText: 'Business' }),
    ).toBeVisible();
  });

  test('Account summary page shows Business plan details for Pro user', async ({ page }) => {
    await mockSubscriptionStatus(page, 'pro');
    await seedProUserWithoutGoogleAuth(page);
    await page.goto('/#/settings/account');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('account-summary')).toBeVisible({ timeout: 10000 });

    // Plan actual section shows Business tier.
    await expect(page.getByText('Plan Actual')).toBeVisible();
    // The Business badge in the account summary — scope to the container to avoid sidebar matches.
    await expect(
      page.getByTestId('account-summary').locator('span.bg-purple-100').filter({ hasText: 'Business' }),
    ).toBeVisible();

    // Business = everything in Pro + unlimited companies (FeatureGate: every paid gate is
    // isPaidTier, so email / batch PDF / Libros IVA are Pro features too).
    const summary = page.getByTestId('account-summary');
    await expect(summary.getByText('Todo lo de Pro')).toBeVisible();
    await expect(summary.getByText('Empresas ilimitadas')).toBeVisible();
    await expect(summary.getByText('Soporte prioritario')).toBeVisible();

    // Top-tier users don't see "Cambiar Plan".
    await expect(page.getByRole('button', { name: 'Cambiar Plan' })).not.toBeVisible();
  });

  test('Account summary page shows upgrade prompt for Lite user', async ({ page }) => {
    await seedLiteUserState(page);
    await page.goto('/#/settings/account');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('account-summary')).toBeVisible({ timeout: 10000 });

    // Free tier label.
    await expect(page.getByText('Free (Gratis)')).toBeVisible();

    // Lite features
    await expect(page.getByText('1 empresa máximo')).toBeVisible();

    // Upgrade button is visible for non-top-tier users.
    await expect(page.getByRole('button', { name: 'Cambiar Plan' })).toBeVisible();
  });

  test('Account summary shows Pro plan details for AdFree user', async ({ page }) => {
    await mockSubscriptionStatus(page, 'adfree');
    await seedAdFreeUserState(page);
    await page.goto('/#/settings/account');
    await page.waitForLoadState('domcontentloaded');

    const summary = page.getByTestId('account-summary');
    await expect(summary).toBeVisible({ timeout: 10000 });

    await expect(summary.getByText('Pro')).toBeVisible();
    // FeatureGate.getMaxCompanies(AdFree) === 2 (the page used to say 3).
    await expect(summary.getByText('2 empresas máximo')).toBeVisible();
    await expect(summary.getByText('Libros IVA')).toBeVisible();
    await expect(summary.getByText('Exportación PDF en lote')).toBeVisible();
    await expect(summary.getByText('Sin anuncios')).toBeVisible();

    // Pro ($7) can still upgrade to Business.
    await expect(page.getByRole('button', { name: 'Cambiar Plan' })).toBeVisible();
  });

  test('Account summary shows usage stats with invoice count', async ({ page }) => {
    await mockSubscriptionStatus(page, 'pro');
    await seedProUserWithGoogleAuth(page);
    await page.goto('/#/settings/account');
    await page.waitForLoadState('domcontentloaded');

    const summary = page.getByTestId('account-summary');
    await expect(summary).toBeVisible({ timeout: 10000 });

    // Usage section — scope to the account-summary card so the sidebar's
    // "Empresas" link (same text) doesn't trigger a strict-mode violation.
    await expect(summary.getByText('Uso Actual')).toBeVisible();
    await expect(summary.getByText('Empresas', { exact: true })).toBeVisible();
    await expect(summary.getByText('Documentos emitidos')).toBeVisible();
    await expect(summary.getByText('Compras registradas')).toBeVisible();

    // Pro company limit label is "Ilimitadas" (shown as "1 / Ilimitadas")
    await expect(summary.getByText(/Ilimitadas/)).toBeVisible();
  });
});
