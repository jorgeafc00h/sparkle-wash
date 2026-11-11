import { test, expect, Page } from '@playwright/test';
import {
  seedLiteUserState,
  seedProUserWithGoogleAuth,
  seedProUserPastDue,
  PRO_ACTIVE_SUBSCRIPTION,
} from '../../fixtures/pro-state';

// Mock helpers — match the real Invoices.Api change-payment-method shape.
function mockChangePaymentSuccess(page: Page) {
  page.route('**/subscription/n1co/change-payment-method', (route) =>
    route.fulfill({
      json: {
        status: 'SUCCEEDED',
        subscriptionId: 'sub-new-001',
        customerId: 'cust-001',
        authUrl: null,
        tier: 'pro',
      },
    }),
  );
  page.route('**/subscription/n1co/status', (route) =>
    route.fulfill({
      json: {
        tier: 'pro',
        status: 'active',
        subscription: {
          productId: 'n1co.facturassimples.business.monthly',
          tier: 'pro',
          status: 'active',
          purchaseDate: '2026-05-20T00:00:00.000Z',
          expiryDate: '2026-06-20T00:00:00.000Z',
          isAutoRenewing: true,
          transactionId: 'sub-new-001',
          platform: 'web',
          n1coSubscriptionId: 'sub-new-001',
          n1coCustomerId: 'cust-001',
        },
      },
    }),
  );
}

function mockChangePaymentFailed(page: Page) {
  page.route('**/subscription/n1co/change-payment-method', (route) =>
    route.fulfill({
      json: { status: 'FAILED', error: 'El pago con la nueva tarjeta fue rechazado.' },
    }),
  );
}

function mockCancelSubscriptionSuccess(page: Page) {
  page.route('**/subscription/n1co/cancel', (route) =>
    route.fulfill({ json: { status: 'SUCCEEDED', cancelled: true } }),
  );
}

function mockCancelSubscriptionFailed(page: Page) {
  page.route('**/subscription/n1co/cancel', (route) =>
    route.fulfill({ json: { status: 'FAILED', error: 'No se pudo cancelar con N1CO.' } }),
  );
}

function mockStatusPaymentFailed(page: Page) {
  page.route('**/subscription/n1co/status', (route) =>
    route.fulfill({
      json: {
        tier: 'lite',
        status: 'payment_failed',
        subscription: {
          ...PRO_ACTIVE_SUBSCRIPTION,
          status: 'payment_failed',
          expiryDate: '2026-06-20T00:00:00.000Z',
        },
      },
    }),
  );
}

function mockStatusPaymentFailedAtRootOnly(page: Page) {
  const { status: _ignoredStatus, ...subscriptionWithoutStatus } = PRO_ACTIVE_SUBSCRIPTION;
  page.route('**/subscription/n1co/status', (route) =>
    route.fulfill({
      json: {
        tier: 'lite',
        status: 'payment_failed',
        subscription: {
          ...subscriptionWithoutStatus,
          expiryDate: '2026-06-20T00:00:00.000Z',
        },
      },
    }),
  );
}

function mockStatusActivePro(page: Page) {
  page.route('**/subscription/n1co/status', (route) =>
    route.fulfill({
      json: {
        tier: 'pro',
        status: 'active',
        subscription: {
          ...PRO_ACTIVE_SUBSCRIPTION,
          status: 'active',
        },
      },
    }),
  );
}

function mockStatusCancelled(page: Page) {
  page.route('**/subscription/n1co/status', (route) =>
    route.fulfill({
      json: {
        tier: 'lite',
        status: 'cancelled',
        subscription: null,
      },
    }),
  );
}

const CARD = {
  number: '4111 1111 1111 1111',
  name: 'Updated User',
  month: '12',
  year: '2030',
  cvv: '321',
};

async function fillCardForm(page: Page) {
  await page.getByLabel('Nombre del titular').fill(CARD.name);
  await page.getByLabel('Número de tarjeta').fill(CARD.number);
  await page.getByLabel('Mes').fill(CARD.month);
  await page.getByLabel('Año').fill(CARD.year);
  await page.getByLabel('CVV').fill(CARD.cvv);
}

// ── Banner visibility ────────────────────────────────────────────────────────

test.describe('Past-due banner — visibility', () => {
  test('Past-due Pro user sees the banner on Account Summary', async ({ page }) => {
    mockStatusPaymentFailed(page);
    await seedProUserPastDue(page);
    await page.goto('/#/settings/account');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('account-summary')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('past-due-banner')).toBeVisible();
    await expect(page.getByText(/Pago pendiente/i)).toBeVisible();
    await expect(page.getByTestId('past-due-update-card')).toBeVisible();
  });

  test('API validation result with failed renewal shows past-due recovery banner', async ({ page }) => {
    mockStatusPaymentFailed(page);
    await seedProUserWithGoogleAuth(page);
    await page.goto('/#/settings/account');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('account-summary')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Free (Gratis)')).toBeVisible();
    await expect(page.getByTestId('past-due-banner')).toBeVisible();
    await expect(page.getByTestId('past-due-update-card')).toBeVisible();
  });

  test('root-level payment_failed status is surfaced even when subscription.status is omitted', async ({ page }) => {
    mockStatusPaymentFailedAtRootOnly(page);
    await seedProUserWithGoogleAuth(page);
    await page.goto('/#/settings/account');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('account-summary')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('past-due-banner')).toBeVisible();
    await expect(page.getByTestId('past-due-update-card')).toBeVisible();
  });

  test('API validation result with cancelled subscription closes paid controls', async ({ page }) => {
    mockStatusCancelled(page);
    await seedProUserWithGoogleAuth(page);
    await page.goto('/#/settings/account');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('account-summary')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Free (Gratis)')).toBeVisible();
    await expect(page.getByTestId('past-due-banner')).not.toBeVisible();
    await expect(page.getByTestId('account-change-card-btn')).not.toBeVisible();
    await expect(page.getByTestId('account-cancel-subscription-btn')).not.toBeVisible();
  });

  test('Active Pro user does NOT see the banner', async ({ page }) => {
    mockStatusActivePro(page);
    await seedProUserWithGoogleAuth(page);
    await page.goto('/#/settings/account');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('account-summary')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('past-due-banner')).not.toBeVisible();
  });

  test('Update-card button visible for active paid user', async ({ page }) => {
    mockStatusActivePro(page);
    await seedProUserWithGoogleAuth(page);
    await page.goto('/#/settings/account');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('account-change-card-btn')).toBeVisible();
  });

  test('Cancel subscription button visible for active paid user', async ({ page }) => {
    mockStatusActivePro(page);
    await seedProUserWithGoogleAuth(page);
    await page.goto('/#/settings/account');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('account-cancel-subscription-btn')).toBeVisible();
  });

  test('Update-card button NOT visible for Lite user', async ({ page }) => {
    await seedLiteUserState(page);
    await page.goto('/#/settings/account');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('account-summary')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('account-change-card-btn')).not.toBeVisible();
    await expect(page.getByTestId('account-cancel-subscription-btn')).not.toBeVisible();
  });
});

// ── Cancellation ───────────────────────────────────────────────────────────────

test.describe('Cancel subscription', () => {
  test('Successful cancellation downgrades the account to Lite', async ({ page }) => {
    mockStatusActivePro(page);
    mockCancelSubscriptionSuccess(page);
    await seedProUserWithGoogleAuth(page);

    await page.goto('/#/settings/account');
    await page.waitForLoadState('domcontentloaded');

    await page.getByTestId('account-cancel-subscription-btn').click();
    await expect(page.getByRole('dialog', { name: /Cancelar suscripción/i })).toBeVisible();
    await page.getByRole('dialog', { name: /Cancelar suscripción/i })
      .getByRole('button', { name: 'Cancelar suscripción' })
      .click();

    await expect(page.getByText(/Suscripción cancelada correctamente/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Free (Gratis)')).toBeVisible();
    await expect(page.getByTestId('account-cancel-subscription-btn')).not.toBeVisible();
  });

  test('Failed cancellation keeps the paid account visible', async ({ page }) => {
    mockStatusActivePro(page);
    mockCancelSubscriptionFailed(page);
    await seedProUserWithGoogleAuth(page);

    await page.goto('/#/settings/account');
    await page.waitForLoadState('domcontentloaded');

    await page.getByTestId('account-cancel-subscription-btn').click();
    await page.getByRole('dialog', { name: /Cancelar suscripción/i })
      .getByRole('button', { name: 'Cancelar suscripción' })
      .click();

    await expect(page.getByText(/No se pudo cancelar con N1CO/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('account-cancel-subscription-btn')).toBeVisible();
  });
});

// ── Change-card page ─────────────────────────────────────────────────────────

test.describe('Change payment method page', () => {
  test('Banner CTA navigates to change-card page', async ({ page }) => {
    mockStatusPaymentFailed(page);
    await seedProUserPastDue(page);
    await page.goto('/#/settings/account');
    await page.waitForLoadState('domcontentloaded');

    await page.getByTestId('past-due-update-card').click();
    await expect(page).toHaveURL(/#\/settings\/account\/change-card/);
    await expect(page.getByTestId('change-payment-method')).toBeVisible();
  });

  test('Page shows past-due notice for blocked subscription', async ({ page }) => {
    mockStatusPaymentFailed(page);
    await seedProUserPastDue(page);
    await page.goto('/#/settings/account/change-card');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('past-due-banner')).toBeVisible();
  });

  test('Page shows N1CO badge', async ({ page }) => {
    mockStatusActivePro(page);
    await seedProUserWithGoogleAuth(page);
    await page.goto('/#/settings/account/change-card');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('n1co-badge-block')).toBeVisible();
    await expect(page.getByAltText('N1CO')).toBeVisible();
  });

  test('Successful card update redirects to account', async ({ page }) => {
    mockChangePaymentSuccess(page);
    await seedProUserWithGoogleAuth(page);

    await page.goto('/#/settings/account/change-card');
    await page.waitForLoadState('domcontentloaded');

    await fillCardForm(page);
    await page.getByRole('button', { name: /Guardar nueva tarjeta/ }).click();

    await expect(page.getByText(/Tarjeta actualizada/i)).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/#\/settings\/account$/, { timeout: 10_000 });
  });

  test('Failed card update surfaces the error', async ({ page }) => {
    mockStatusActivePro(page);
    mockChangePaymentFailed(page);
    await seedProUserWithGoogleAuth(page);

    await page.goto('/#/settings/account/change-card');
    await page.waitForLoadState('domcontentloaded');

    await fillCardForm(page);
    await page.getByRole('button', { name: /Guardar nueva tarjeta/ }).click();

    await expect(page.getByText(/rechazado/i)).toBeVisible({ timeout: 10_000 });
    // Still on the change-card page — no redirect
    await expect(page).toHaveURL(/#\/settings\/account\/change-card/);
  });

  test('Lite user sees the "no subscription" CTA', async ({ page }) => {
    await seedLiteUserState(page);
    await page.goto('/#/settings/account/change-card');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByText(/No tienes una suscripción activa/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ver planes' })).toBeVisible();
  });
});

// ── N1CO badge presence ──────────────────────────────────────────────────────

test.describe('N1CO badge', () => {
  test('Badge appears on the promo page card form', async ({ page }) => {
    await seedLiteUserState(page);
    await page.goto('/#/settings/promo');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('n1co-badge-block')).toBeVisible();
    await expect(page.getByAltText('N1CO')).toBeVisible();
  });
});
