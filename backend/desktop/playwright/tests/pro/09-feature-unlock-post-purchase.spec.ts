import { test, expect, Page } from '@playwright/test';
import {
  seedLiteUserWithGoogleAuth,
  ADFREE_ACTIVE_SUBSCRIPTION,
  PRO_ACTIVE_SUBSCRIPTION,
} from '../../fixtures/pro-state';
import { navigateToTab } from '../../utils/helpers';

// These tests exercise the actual user-facing payoff of a successful N1CO
// purchase: after the API round-trip, the paid features become available in
// the UI. Mocks intentionally use the real Invoices.Api response shape so a
// future regression in the contract is caught here as well as in 03.

const CARD = {
  number: '4111 1111 1111 1111',
  name: 'Test User',
  month: '12',
  year: '2028',
  cvv: '123',
  email: 'pro@gmail.com',
};

function mockN1COSuccess(page: Page, resultTier: 'adfree' | 'pro') {
  const subscription =
    resultTier === 'pro' ? PRO_ACTIVE_SUBSCRIPTION : ADFREE_ACTIVE_SUBSCRIPTION;
  const subscriptionId = subscription.n1coSubscriptionId ?? subscription.transactionId;
  let hasSubscribed = false;

  page.route('**/subscription/n1co/payment-method', (route) =>
    route.fulfill({ json: { id: 'pm_test_unlock_001' } }),
  );
  page.route('**/subscription/n1co/subscribe', (route) => {
    hasSubscribed = true;
    return route.fulfill({
      json: {
        status: 'SUCCEEDED',
        subscriptionId,
        authUrl: null,
        authId: null,
        tier: resultTier,
      },
    });
  });
  page.route('**/subscription/n1co/status', (route) => {
    if (!hasSubscribed) {
      return route.fulfill({ json: { tier: 'lite', subscription: null } });
    }

    return route.fulfill({ json: { tier: resultTier, subscription } });
  });
}

function mockN1COFailed(page: Page) {
  page.route('**/subscription/n1co/payment-method', (route) =>
    route.fulfill({ json: { id: 'pm_test_unlock_fail_001' } }),
  );
  page.route('**/subscription/n1co/subscribe', (route) =>
    route.fulfill({
      json: { status: 'FAILED', error: 'Tu tarjeta fue rechazada por N1CO.' },
    }),
  );
  page.route('**/subscription/n1co/status', (route) =>
    route.fulfill({ json: { tier: 'lite', subscription: null } }),
  );
}

async function purchaseTier(page: Page, tier: 'adfree' | 'pro'): Promise<void> {
  const planRegex = tier === 'adfree' ? /Pro.*\$7\.00\/mes/ : /Business.*\$14\.00\/mes/;
  const payRegex = tier === 'adfree' ? /Pagar \$7\.00\/mes/ : /Pagar \$14\.00\/mes/;
  await page.goto('/#/settings/promo');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('heading', { name: 'Pagar con tarjeta' })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: planRegex }).click();
  await page.getByLabel('Nombre del titular').fill(CARD.name);
  await page.getByLabel('Número de tarjeta').fill(CARD.number);
  await page.getByLabel('Mes').fill(CARD.month);
  await page.getByLabel('Año').fill(CARD.year);
  await page.getByLabel('CVV').fill(CARD.cvv);
  await page.getByLabel('Correo de facturación').fill(CARD.email);
  await page.getByRole('button', { name: payRegex }).click();
  await expect(page.getByText('¡Suscripción activada!')).toBeVisible({ timeout: 10000 });
}

// ── Pro tier ($7) unlocks ─────────────────────────────────────────────────────

test.describe('Feature unlock after Pro ($7) purchase', () => {
  test('Drive export card appears in Settings page', async ({ page }) => {
    // Per subscriptionConfig.ts:19-27, Pro ($7, AdFree enum) unlocks Drive
    // when the user is also signed in with Google. seedLiteUserWithGoogleAuth
    // satisfies the Google prerequisite, and the purchase satisfies the tier.
    mockN1COSuccess(page, 'adfree');
    await seedLiteUserWithGoogleAuth(page);
    await purchaseTier(page, 'adfree');

    await navigateToTab(page, 'configuracion');
    await expect(page.getByTestId('settings')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Exportar a Google Drive')).toBeVisible({ timeout: 5000 });
  });

  test('Home upgrade card disappears after purchase', async ({ page }) => {
    mockN1COSuccess(page, 'adfree');
    await seedLiteUserWithGoogleAuth(page);

    await navigateToTab(page, 'inicio');
    await expect(page.getByTestId('pro-upgrade-card')).toBeVisible({ timeout: 10000 });

    await purchaseTier(page, 'adfree');
    await navigateToTab(page, 'inicio');
    await expect(page.getByTestId('pro-upgrade-card')).not.toBeVisible();
  });

  test('Account summary updates from Free to Pro tier', async ({ page }) => {
    mockN1COSuccess(page, 'adfree');
    await seedLiteUserWithGoogleAuth(page);

    await page.goto('/#/settings/account');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('account-summary')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Free \(Gratis\)/i)).toBeVisible();

    await purchaseTier(page, 'adfree');

    await page.goto('/#/settings/account');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('account-summary').getByText('Pro')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Sin anuncios')).toBeVisible();
  });
});

// ── Business tier ($14) unlocks ───────────────────────────────────────────────

test.describe('Feature unlock after Business ($14) purchase', () => {
  test('Drive export card appears in Settings page', async ({ page }) => {
    mockN1COSuccess(page, 'pro');
    await seedLiteUserWithGoogleAuth(page);
    await purchaseTier(page, 'pro');

    await navigateToTab(page, 'configuracion');
    await expect(page.getByText('Exportar a Google Drive')).toBeVisible({ timeout: 5000 });
  });

  test('Account summary updates from Lite to Pro/Business tier', async ({ page }) => {
    mockN1COSuccess(page, 'pro');
    await seedLiteUserWithGoogleAuth(page);

    await purchaseTier(page, 'pro');

    await page.goto('/#/settings/account');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('account-summary')).toBeVisible({ timeout: 10000 });
    await expect(
      page
        .getByTestId('account-summary')
        .locator('span.bg-purple-100')
        .filter({ hasText: 'Business' }),
    ).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Empresas ilimitadas')).toBeVisible();
  });

  test('Cambiar Plan button hidden once Business is active', async ({ page }) => {
    mockN1COSuccess(page, 'pro');
    await seedLiteUserWithGoogleAuth(page);
    await purchaseTier(page, 'pro');

    await page.goto('/#/settings/account');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('account-summary')).toBeVisible({ timeout: 10000 });
    // Business is the top tier — no upgrade option remains.
    await expect(page.getByRole('button', { name: 'Cambiar Plan' })).not.toBeVisible();
  });
});

// ── Negative paths ────────────────────────────────────────────────────────────

test.describe('Failed purchase keeps Lite intact', () => {
  test('Declined card leaves user as Lite and Drive export stays hidden', async ({ page }) => {
    mockN1COFailed(page);
    await seedLiteUserWithGoogleAuth(page);

    await page.goto('/#/settings/promo');
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: /Pro.*\$7\.00\/mes/ }).click();
    await page.getByLabel('Nombre del titular').fill(CARD.name);
    await page.getByLabel('Número de tarjeta').fill(CARD.number);
    await page.getByLabel('Mes').fill(CARD.month);
    await page.getByLabel('Año').fill(CARD.year);
    await page.getByLabel('CVV').fill(CARD.cvv);
    await page.getByLabel('Correo de facturación').fill(CARD.email);
    await page.getByRole('button', { name: /Pagar \$7\.00\/mes/ }).click();

    // Surface the backend error
    await expect(page.getByText(/rechazada por N1CO/i)).toBeVisible({ timeout: 10000 });

    // Feature gates should still be locked
    await navigateToTab(page, 'configuracion');
    await expect(page.getByText('Exportar a Google Drive')).not.toBeVisible();
  });
});
