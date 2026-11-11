import { test, expect, Page } from '@playwright/test';
import {
  seedLiteUserState,
  seedLiteUserWithGoogleAuth,
  seedAdFreeUserState,
  ADFREE_ACTIVE_SUBSCRIPTION,
  PRO_ACTIVE_SUBSCRIPTION,
} from '../../fixtures/pro-state';
import { N1CO_TEST_CARDS } from '../../fixtures/n1co-cards';

// ── Test card numbers ─────────────────────────────────────────────────────────
// N1CO sandbox test cards.
// The actual network calls are mocked via page.route() — these numbers are
// never sent to production N1CO. They keep the local UI/contract suite aligned
// with the live sandbox suite in 08-n1co-sandbox-purchase.spec.ts.
const CARDS = {
  visaSuccess: {
    number: N1CO_TEST_CARDS.visaSuccessNo3DS.number,
    formatted: '4000 0566 5566 5556',
    brand: 'Visa',
  },
  mastercardSuccess: {
    number: N1CO_TEST_CARDS.mastercardSuccessNo3DS.number,
    formatted: '5267 2600 0000 0001',
    brand: 'Mastercard',
  },
  visaDeclined: {
    number: N1CO_TEST_CARDS.visaDeclinedNo3DS.number,
    formatted: '4242 4242 4242 4242',
    brand: 'Visa (declined)',
  },
  visa3DS: {
    number: N1CO_TEST_CARDS.visaSuccess3DS.number,
    formatted: '4000 0000 0000 1000',
    brand: 'Visa (3DS)',
  },
};

const CARD_OWNER = {
  name: 'Test User',
  month: '12',
  year: '2028',
  cvv: '123',
  email: 'test@facturassimples.com',
};

// Hermetic by default: the seeded Google token is a Playwright placeholder, so the startup
// status / entitlement checks answer 401 like a backend that doesn't know it. Without this the
// suite depended on whatever API the Vite proxy pointed at (production rejected the token; a
// sandbox backend that knows the test user re-tiered the seeded state mid-test). Routes a test
// registers itself take precedence over these.
test.beforeEach(async ({ page }) => {
  await page.route('**/subscription/n1co/status**', (route) => route.fulfill({ status: 401, body: '' }));
  await page.route('**/api/v2/account/entitlements**', (route) => route.fulfill({ status: 401, body: '' }));
});

// ── API mock helpers ──────────────────────────────────────────────────────────

// These mock responses MUST match the actual shape returned by
// Invoices.Api/Features/N1CO/Commands/{CreatePaymentMethodEndpoint,SubscribeEndpoint}.cs
// — keep them in sync if the backend contract changes.

function mockN1COSuccess(page: Page, resultTier: 'adfree' | 'pro' = 'adfree') {
  const subscription = resultTier === 'pro' ? PRO_ACTIVE_SUBSCRIPTION : ADFREE_ACTIVE_SUBSCRIPTION;
  const subscriptionId = subscription.n1coSubscriptionId ?? subscription.transactionId;

  page.route('**/subscription/n1co/payment-method', (route) =>
    // N1CO sandbox returns `id`; backend passes through unchanged.
    route.fulfill({ json: { id: 'pm_test_success_001' } })
  );
  page.route('**/subscription/n1co/subscribe', (route) =>
    route.fulfill({
      json: {
        status: 'SUCCEEDED',
        subscriptionId,
        authUrl: null,
        authId: null,
        tier: resultTier,
      },
    })
  );
  page.route('**/subscription/n1co/status', (route) =>
    route.fulfill({ json: { tier: resultTier, subscription } })
  );
}

function mockN1CODeclined(page: Page) {
  // First step (tokenize) succeeds — N1CO rejects at subscribe time.
  page.route('**/subscription/n1co/payment-method', (route) =>
    route.fulfill({ json: { id: 'pm_test_declined_001' } })
  );
  page.route('**/subscription/n1co/subscribe', (route) =>
    route.fulfill({
      json: { status: 'FAILED', error: 'Tu tarjeta fue rechazada. Verifica los datos e intenta nuevamente.' },
    })
  );
}

function mockN1CO3DS(page: Page) {
  const subscription = {
    ...ADFREE_ACTIVE_SUBSCRIPTION,
    n1coSubscriptionId: '9001',
    transactionId: '9001',
    status: 'active',
  };

  page.route('**/subscription/n1co/payment-method', (route) =>
    route.fulfill({ json: { id: 'pm_test_3ds_001' } })
  );
  page.route('**/subscription/n1co/subscribe', (route) =>
    route.fulfill({
      json: {
        status: 'AUTHENTICATION_REQUIRED',
        subscriptionId: null,
        authUrl: 'https://front-3ds.n1co.com/auth/mock-success',
        authId: 'auth_test_001',
        tier: 'adfree',
      },
    })
  );
  page.route('**/subscription/n1co/confirm-3ds', (route) =>
    route.fulfill({
      json: {
        status: 'SUCCEEDED',
        subscriptionId: '9001',
        customerId: 'cust_3ds_001',
        authUrl: null,
        authId: null,
        tier: 'adfree',
      },
    })
  );
  page.route('https://front-3ds.n1co.com/auth/mock-success', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `
        <!doctype html>
        <html>
          <body>
            <button id="complete">Completar autenticación</button>
            <script>
              document.getElementById('complete').addEventListener('click', () => {
                parent.postMessage({
                  MessageType: 'authentication.complete',
                  Status: 'SUCCESS',
                  AuthenticationId: 'auth_test_001'
                }, '*');
              });
            </script>
          </body>
        </html>
      `,
    })
  );
  page.route('**/subscription/n1co/status', (route) =>
    route.fulfill({ json: { tier: 'adfree', subscription } })
  );
}

function mockN1COStatusSettlesAfterRetries(page: Page): { getStatusCalls: () => number } {
  let statusCalls = 0;

  page.route('**/subscription/n1co/payment-method', (route) =>
    route.fulfill({ json: { id: 'pm_test_retry_001' } })
  );
  page.route('**/subscription/n1co/subscribe', (route) =>
    route.fulfill({
      json: {
        status: 'SUCCEEDED',
        subscriptionId: 7001,
        authUrl: null,
        authId: null,
        tier: 'adfree',
      },
    })
  );
  page.route('**/subscription/n1co/status', (route) => {
    statusCalls += 1;
    if (statusCalls < 3) {
      return route.fulfill({ json: { tier: 'lite', subscription: null } });
    }

    return route.fulfill({
      json: {
        tier: 'adfree',
        subscription: {
          ...ADFREE_ACTIVE_SUBSCRIPTION,
          transactionId: '7001',
          n1coSubscriptionId: '7001',
        },
      },
    });
  });

  return {
    getStatusCalls: () => statusCalls,
  };
}

async function fillCardForm(page: Page, cardNumber: string) {
  await page.getByLabel('Nombre del titular').fill(CARD_OWNER.name);
  await page.getByLabel('Número de tarjeta').fill(cardNumber);
  await page.getByLabel('Mes').fill(CARD_OWNER.month);
  await page.getByLabel('Año').fill(CARD_OWNER.year);
  await page.getByLabel('CVV').fill(CARD_OWNER.cvv);
  await page.getByLabel('Correo de facturación').fill(CARD_OWNER.email);
}

async function goToPromo(page: Page) {
  await page.goto('/#/settings/promo');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('heading', { name: 'Pagar con tarjeta' })).toBeVisible({ timeout: 10000 });
}

// ── UI-only tests (no auth required) ─────────────────────────────────────────

test.describe('N1CO Card Purchase — UI', () => {
  test('Cambiar Plan button navigates to promo/purchase page', async ({ page }) => {
    await seedLiteUserState(page);
    await page.goto('/#/settings/account');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('account-summary')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Cambiar Plan' }).click();

    await expect(page).toHaveURL(/#\/settings\/promo/);
  });

  test('promo page shows both Pro and Business plan options for Lite user', async ({ page }) => {
    await seedLiteUserState(page);
    await goToPromo(page);

    await expect(page.getByRole('button', { name: /Pro.*\$7\.00\/mes/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Business.*\$14\.00\/mes/ })).toBeVisible();
  });

  test('selecting Pro plan reveals card form fields', async ({ page }) => {
    await seedLiteUserState(page);
    await goToPromo(page);

    await expect(page.getByLabel('Número de tarjeta')).not.toBeVisible();
    await page.getByRole('button', { name: /Pro.*\$7\.00\/mes/ }).click();

    await expect(page.getByLabel('Nombre del titular')).toBeVisible();
    await expect(page.getByLabel('Número de tarjeta')).toBeVisible();
    await expect(page.getByLabel('Mes')).toBeVisible();
    await expect(page.getByLabel('Año')).toBeVisible();
    await expect(page.getByLabel('CVV')).toBeVisible();
    await expect(page.getByLabel('Correo de facturación')).toBeVisible();
    await expect(page.getByRole('button', { name: /Pagar \$7\.00\/mes/ })).toBeVisible();
  });

  test('selecting Business plan shows correct price', async ({ page }) => {
    await seedLiteUserState(page);
    await goToPromo(page);

    await page.getByRole('button', { name: /Business.*\$14\.00\/mes/ }).click();
    await expect(page.getByRole('button', { name: /Pagar \$14\.00\/mes/ })).toBeVisible();
  });

  test('Visa card number formats with spaces', async ({ page }) => {
    await seedLiteUserState(page);
    await goToPromo(page);

    await page.getByRole('button', { name: /Pro.*\$7\.00\/mes/ }).click();
    await page.getByLabel('Número de tarjeta').fill(CARDS.visaSuccess.number);
    await expect(page.getByLabel('Número de tarjeta')).toHaveValue(CARDS.visaSuccess.formatted);
  });

  test('Mastercard number formats with spaces', async ({ page }) => {
    await seedLiteUserState(page);
    await goToPromo(page);

    await page.getByRole('button', { name: /Pro.*\$7\.00\/mes/ }).click();
    await page.getByLabel('Número de tarjeta').fill(CARDS.mastercardSuccess.number);
    await expect(page.getByLabel('Número de tarjeta')).toHaveValue(CARDS.mastercardSuccess.formatted);
  });

  test('clicking selected plan again deselects and hides form', async ({ page }) => {
    await seedLiteUserState(page);
    await goToPromo(page);

    const proButton = page.getByRole('button', { name: /Pro.*\$7\.00\/mes/ });
    await proButton.click();
    await expect(page.getByLabel('Número de tarjeta')).toBeVisible();
    await proButton.click();
    await expect(page.getByLabel('Número de tarjeta')).not.toBeVisible();
  });

  test('AdFree user only sees Business plan', async ({ page }) => {
    await seedAdFreeUserState(page);
    await goToPromo(page);

    await expect(page.getByText('$14.00/mes')).toBeVisible();
    await expect(page.getByText('$7.00/mes')).not.toBeVisible();
  });

  test('submit without fields shows validation error', async ({ page }) => {
    await seedLiteUserWithGoogleAuth(page);
    await goToPromo(page);

    await page.getByRole('button', { name: /Pro.*\$7\.00\/mes/ }).click();
    await page.getByRole('button', { name: /Pagar \$7\.00\/mes/ }).click();

    await expect(page.getByText('Por favor completa todos los campos de la tarjeta')).toBeVisible({ timeout: 5000 });
  });

  test('unauthenticated user sees Google sign-in warning', async ({ page }) => {
    await seedLiteUserState(page); // guest mode, no Google token
    await goToPromo(page);

    await expect(page.getByText(/iniciar sesión con Google/i)).toBeVisible();
  });

  test('pay button is disabled for unauthenticated user', async ({ page }) => {
    await seedLiteUserState(page);
    await goToPromo(page);

    await page.getByRole('button', { name: /Pro.*\$7\.00\/mes/ }).click();
    const payButton = page.getByRole('button', { name: /Pagar \$7\.00\/mes/ });
    await expect(payButton).toBeDisabled();
  });

  test('authenticated user does not see sign-in warning', async ({ page }) => {
    await seedLiteUserWithGoogleAuth(page);
    await goToPromo(page);

    await expect(page.getByText(/iniciar sesión con Google/i)).not.toBeVisible();
  });

  test('pay button is enabled for authenticated user', async ({ page }) => {
    await seedLiteUserWithGoogleAuth(page);
    await goToPromo(page);

    await page.getByRole('button', { name: /Pro.*\$7\.00\/mes/ }).click();
    await expect(page.getByRole('button', { name: /Pagar \$7\.00\/mes/ })).not.toBeDisabled();
  });
});

// ── Full purchase flow (mocked N1CO API) ──────────────────────────────────────

test.describe('N1CO Purchase Flow — mocked API', () => {
  test('Visa success → Pro plan activated', async ({ page }) => {
    await seedLiteUserWithGoogleAuth(page);
    mockN1COSuccess(page, 'adfree');
    await goToPromo(page);

    await page.getByRole('button', { name: /Pro.*\$7\.00\/mes/ }).click();
    await fillCardForm(page, CARDS.visaSuccess.number);
    await page.getByRole('button', { name: /Pagar \$7\.00\/mes/ }).click();

    await expect(page.getByText('¡Suscripción activada!')).toBeVisible({ timeout: 10000 });
  });

  test('Mastercard success → Pro plan activated', async ({ page }) => {
    await seedLiteUserWithGoogleAuth(page);
    mockN1COSuccess(page, 'adfree');
    await goToPromo(page);

    await page.getByRole('button', { name: /Pro.*\$7\.00\/mes/ }).click();
    await fillCardForm(page, CARDS.mastercardSuccess.number);
    await page.getByRole('button', { name: /Pagar \$7\.00\/mes/ }).click();

    await expect(page.getByText('¡Suscripción activada!')).toBeVisible({ timeout: 10000 });
  });

  test('Visa success → Business plan activated', async ({ page }) => {
    await seedLiteUserWithGoogleAuth(page);
    mockN1COSuccess(page, 'pro');
    await goToPromo(page);

    await page.getByRole('button', { name: /Business.*\$14\.00\/mes/ }).click();
    await fillCardForm(page, CARDS.visaSuccess.number);
    await page.getByRole('button', { name: /Pagar \$14\.00\/mes/ }).click();

    await expect(page.getByText('¡Suscripción activada!')).toBeVisible({ timeout: 10000 });
  });

  test('form resets after successful purchase', async ({ page }) => {
    await seedLiteUserWithGoogleAuth(page);
    mockN1COSuccess(page, 'adfree');
    await goToPromo(page);

    await page.getByRole('button', { name: /Pro.*\$7\.00\/mes/ }).click();
    await fillCardForm(page, CARDS.visaSuccess.number);
    await page.getByRole('button', { name: /Pagar \$7\.00\/mes/ }).click();

    await expect(page.getByText('¡Suscripción activada!')).toBeVisible({ timeout: 10000 });
    // Card form collapses after success
    await expect(page.getByLabel('Número de tarjeta')).not.toBeVisible();
  });

  test('N1CO declined card shows error toast', async ({ page }) => {
    await seedLiteUserWithGoogleAuth(page);
    mockN1CODeclined(page);
    await goToPromo(page);

    await page.getByRole('button', { name: /Pro.*\$7\.00\/mes/ }).click();
    await fillCardForm(page, CARDS.visaDeclined.number);
    await page.getByRole('button', { name: /Pagar \$7\.00\/mes/ }).click();

    await expect(page.getByText(/tarjeta fue rechazada|error al procesar/i)).toBeVisible({ timeout: 10000 });
  });

  test('N1CO 3DS card completes iframe flow and activates plan', async ({ page }) => {
    await seedLiteUserWithGoogleAuth(page);
    mockN1CO3DS(page);
    await goToPromo(page);

    await page.getByRole('button', { name: /Pro.*\$7\.00\/mes/ }).click();
    await fillCardForm(page, CARDS.visa3DS.number);

    // Track whether the N1CO subscribe endpoint was called
    const subscribeRequest = page.waitForRequest('**/subscription/n1co/subscribe');
    await page.getByRole('button', { name: /Pagar \$7\.00\/mes/ }).click();

    // Subscribe endpoint must be reached (3DS flow starts server-side)
    await subscribeRequest;

    await expect(page.getByTestId('threeds-modal')).toBeVisible({ timeout: 10000 });
    const confirmRequest = page.waitForRequest('**/subscription/n1co/confirm-3ds');
    await page
      .frameLocator('[data-testid="threeds-iframe"]')
      .locator('#complete')
      .click();

    await confirmRequest;
    await expect(page.getByText('¡Suscripción activada!')).toBeVisible({ timeout: 15000 });
  });

  test('payment-method token is created as multi-use for subscriptions', async ({ page }) => {
    await seedLiteUserWithGoogleAuth(page);
    mockN1COSuccess(page, 'adfree');
    await goToPromo(page);

    await page.getByRole('button', { name: /Pro.*\$7\.00\/mes/ }).click();
    await fillCardForm(page, CARDS.visaSuccess.number);

    const paymentMethodRequest = page.waitForRequest('**/subscription/n1co/payment-method');
    await page.getByRole('button', { name: /Pagar \$7\.00\/mes/ }).click();
    const request = await paymentMethodRequest;

    expect(request.postDataJSON()).toMatchObject({
      card: {
        singleUse: false,
      },
    });
  });

  test('purchase waits for backend status confirmation before unlocking the tier', async ({ page }) => {
    await seedLiteUserWithGoogleAuth(page);
    const tracker = mockN1COStatusSettlesAfterRetries(page);
    await goToPromo(page);

    await page.getByRole('button', { name: /Pro.*\$7\.00\/mes/ }).click();
    await fillCardForm(page, CARDS.visaSuccess.number);
    await page.getByRole('button', { name: /Pagar \$7\.00\/mes/ }).click();

    await expect(page.getByText('¡Suscripción activada!')).toBeVisible({ timeout: 10000 });
    expect(tracker.getStatusCalls()).toBeGreaterThanOrEqual(3);
  });

  test('unauthenticated user cannot submit even if form filled', async ({ page }) => {
    await seedLiteUserState(page); // no Google token
    await goToPromo(page);

    await page.getByRole('button', { name: /Pro.*\$7\.00\/mes/ }).click();
    await fillCardForm(page, CARDS.visaSuccess.number);

    // Pay button is disabled — no API call should be made
    const payButton = page.getByRole('button', { name: /Pagar \$7\.00\/mes/ });
    await expect(payButton).toBeDisabled();
  });
});

// ── Upgrade card visibility ───────────────────────────────────────────────────

test.describe('N1CO upgrade card visibility', () => {
  test('upgrade card visible on home screen for Lite user', async ({ page }) => {
    await seedLiteUserState(page);
    await page.goto('/#/home');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('pro-upgrade-card')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Suscríbete a Pro')).toBeVisible();
  });

  test('upgrade card NOT visible on home screen for Pro user', async ({ page }) => {
    const { seedProUserWithGoogleAuth } = await import('../../fixtures/pro-state');
    await seedProUserWithGoogleAuth(page);
    await page.goto('/#/home');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('pro-upgrade-card')).not.toBeVisible();
  });

  test('company limit banner shows Ver planes button for Lite user at limit', async ({ page }) => {
    await seedLiteUserState(page);
    await page.goto('/#/companies');
    await page.waitForLoadState('domcontentloaded');

    // Lite user already has 1 company (TEST_COMPANY) → at limit
    await expect(page.getByTestId('company-limit-banner')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('company-limit-upgrade-btn')).toBeVisible();
  });

  test('Ver planes button on home upgrade card opens subscription modal', async ({ page }) => {
    await seedLiteUserState(page);
    await page.goto('/#/home');
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('button', { name: 'Ver planes' }).first().click();
    await expect(page.getByText('Planes de suscripción')).toBeVisible({ timeout: 5000 });
  });
});
