import { test, expect, Page } from '@playwright/test';
import { N1CO_TEST_CARDS, DEFAULT_CARDHOLDER, N1COTestCard } from '../../fixtures/n1co-cards';
import { seedLiteUserWithGoogleAuth } from '../../fixtures/pro-state';

/**
 * Live N1CO sandbox tests — these talk to `k-invoices-api-dev` which is wired
 * to `https://api-sandbox.n1co.shop/api/v2`. NO mocks: a real round-trip
 * tokenizes the card with N1CO, creates a real sandbox subscription, and
 * exercises the 3DS popup for cards that require it.
 *
 * Prerequisites before enabling (current blockers):
 *   1. `N1CO_API_KEY` + `N1CO_API_SECRET` populated on the dev backend.
 *      `Invoices.Api/Invoices.Api/appsettings.json` ships them empty — they
 *      need to be set in Azure App Service config or local user secrets.
 *   2. Dev backend must accept the seeded `fake-id-token-for-testing` —
 *      either a [DevOnly] header gate, or trust of a known test sub.
 *      Without this, every call returns 401 before reaching N1CO.
 *
 * Enable with `N1CO_SANDBOX=1 npx playwright test pro/08-n1co-sandbox`.
 */
const sandboxEnabled = process.env.N1CO_SANDBOX === '1';
const DEV_TEST_TOKEN = 'fake-id-token-for-testing';
test.skip(!sandboxEnabled, 'Set N1CO_SANDBOX=1 to run live N1CO sandbox tests');

// Real round-trips can be slow — N1CO sandbox + dev cold-starts may push past
// the default 30s. Bump per-test.
test.setTimeout(90_000);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function goToPromo(page: Page): Promise<void> {
  await page.goto('/#/settings/promo');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('heading', { name: 'Pagar con tarjeta' })).toBeVisible({ timeout: 15_000 });
}

async function resetSandboxSubscription(page: Page): Promise<void> {
  await page.request.post('/subscription/n1co/cancel', {
    headers: {
      'Authorization': `Bearer ${DEV_TEST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    data: { reason: 'Playwright sandbox reset' },
    timeout: 30_000,
  }).catch(() => {
    // No active sandbox subscription is a valid starting state.
  });
}

async function fillCardForm(page: Page, card: N1COTestCard): Promise<void> {
  await page.getByLabel('Nombre del titular').fill(DEFAULT_CARDHOLDER.name);
  await page.getByLabel('Número de tarjeta').fill(card.number);
  await page.getByLabel('Mes').fill(DEFAULT_CARDHOLDER.month);
  await page.getByLabel('Año').fill(DEFAULT_CARDHOLDER.year);
  await page.getByLabel('CVV').fill(DEFAULT_CARDHOLDER.cvv);
  await page.getByLabel('Correo de facturación').fill(DEFAULT_CARDHOLDER.email);
}

async function clickPlan(page: Page, tier: 'pro' | 'business'): Promise<void> {
  const regex = tier === 'pro' ? /Pro.*\$7\.00\/mes/ : /Business.*\$14\.00\/mes/;
  await page.getByRole('button', { name: regex }).click();
}

async function clickPay(page: Page, tier: 'pro' | 'business'): Promise<void> {
  const regex = tier === 'pro' ? /Pagar \$7\.00\/mes/ : /Pagar \$14\.00\/mes/;
  await page.getByRole('button', { name: regex }).click();
}

async function completeThreeDSIfRequired(page: Page): Promise<void> {
  const modal = page.getByTestId('threeds-modal');
  const requiresChallenge = await modal.waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!requiresChallenge) return;

  const closedAutomatically = await modal.waitFor({ state: 'hidden', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (closedAutomatically) return;

  const challenge = page.frameLocator('[data-testid="threeds-iframe"]');
  const continueBtn = challenge
    .getByRole('button', { name: /continue|continuar|aprobar|complete|complete authentication/i })
    .first();

  await continueBtn.click({ timeout: 15_000 }).catch(async () => {
    const form = challenge.locator('form').first();
    await form.waitFor({ state: 'attached', timeout: 5_000 });
    await form.evaluate((formEl: HTMLFormElement) => formEl.submit());
  });

  await modal.waitFor({ state: 'hidden', timeout: 30_000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('N1CO sandbox — success cards', () => {
  for (const cardKey of ['visaSuccess3DS', 'mastercardSuccess3DS'] as const) {
    const card = N1CO_TEST_CARDS[cardKey];
    test(`Pro ($7) purchase succeeds with ${card.brand} (${card.scenario})`, async ({ page }) => {
      await resetSandboxSubscription(page);
      await seedLiteUserWithGoogleAuth(page);
      await goToPromo(page);
      await clickPlan(page, 'pro');
      await fillCardForm(page, card);
      await clickPay(page, 'pro');
      await completeThreeDSIfRequired(page);

      await expect(page.getByText('¡Suscripción activada!')).toBeVisible({ timeout: 60_000 });
    });
  }
});

// N1CO's documented declined/failure cards are not deterministic for
// subscription flows: some return no visible rejection, and the failure
// challenge does not consistently expose a fail/close control in automation.
test.describe.skip('N1CO sandbox — declined cards (manual only)', () => {
  for (const cardKey of ['visaDeclinedNo3DS', 'mastercardDeclinedNo3DS'] as const) {
    const card = N1CO_TEST_CARDS[cardKey];
    test(`Pro ($7) purchase fails with ${card.brand} (${card.scenario})`, async ({ page }) => {
      await resetSandboxSubscription(page);
      await seedLiteUserWithGoogleAuth(page);
      await goToPromo(page);
      await clickPlan(page, 'pro');
      await fillCardForm(page, card);
      await clickPay(page, 'pro');

      // Backend returns { status: 'FAILED', error } → slice rejects with the error.
      await expect(
        page.getByText(/rechazad[ao]|error|inválida|insuficiente/i),
      ).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('¡Suscripción activada!')).not.toBeVisible();
    });
  }
});

test.describe('N1CO sandbox — 3DS authentication cards', () => {
  test(`Visa 3DS success — challenge completes, tier upgrades`, async ({ page }) => {
    const card = N1CO_TEST_CARDS.visaSuccess3DS;
    await resetSandboxSubscription(page);
    await seedLiteUserWithGoogleAuth(page);
    await goToPromo(page);
    await clickPlan(page, 'pro');
    await fillCardForm(page, card);

    await clickPay(page, 'pro');

    await expect(page.getByTestId('threeds-modal')).toBeVisible({ timeout: 30_000 });
    await completeThreeDSIfRequired(page);

    // Popup either closes itself or we let main page's status poll confirm.
    await expect(page.getByText('¡Suscripción activada!')).toBeVisible({ timeout: 60_000 });
  });

  // Kept as manual coverage until N1CO sandbox exposes stable automation hooks
  // for challenge failure/close controls.
  test.skip(`Visa 3DS failure — challenge completes with failure, no tier change`, async ({ page }) => {
    const card = N1CO_TEST_CARDS.visaFailed3DS;
    await resetSandboxSubscription(page);
    await seedLiteUserWithGoogleAuth(page);
    await goToPromo(page);
    await clickPlan(page, 'pro');
    await fillCardForm(page, card);

    await clickPay(page, 'pro');

    await expect(page.getByTestId('threeds-modal')).toBeVisible({ timeout: 30_000 });
    const challenge = page.frameLocator('[data-testid="threeds-iframe"]');

    const failBtn = challenge
      .getByRole('button', { name: /fail|rechazar|deny|cancel|cancelar/i })
      .first();
    await failBtn.click({ timeout: 15_000 }).catch(async () => {
      await page.getByTestId('threeds-modal-close').click();
    });

    // Slice should reject — toast appears (3DS failure or canceled message)
    await expect(
      page.getByText(/3DS|autenticación|cancelada|fallida|no se pudo confirmar/i),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('¡Suscripción activada!')).not.toBeVisible();
  });
});

test.describe('N1CO sandbox — Business ($14) tier', () => {
  test(`Business purchase succeeds with Visa 3DS`, async ({ page }) => {
    const card = N1CO_TEST_CARDS.visaSuccess3DS;
    await resetSandboxSubscription(page);
    await seedLiteUserWithGoogleAuth(page);
    await goToPromo(page);
    await clickPlan(page, 'business');
    await fillCardForm(page, card);
    await clickPay(page, 'business');
    await completeThreeDSIfRequired(page);

    await expect(page.getByText('¡Suscripción activada!')).toBeVisible({ timeout: 60_000 });

    // After purchase, account summary should show the Business (Pro enum) tier
    await page.goto('/#/settings/account');
    await page.waitForLoadState('domcontentloaded');
    await expect(
      page
        .getByTestId('account-summary')
        .locator('span.bg-purple-100')
        .filter({ hasText: 'Business' }),
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ── Feature unlock smoke test (post-real-purchase) ────────────────────────────

test.describe('N1CO sandbox — paid features unlock after purchase', () => {
  test('Business purchase unlocks Drive export card', async ({ page }) => {
    const card = N1CO_TEST_CARDS.visaSuccess3DS;
    await resetSandboxSubscription(page);
    await seedLiteUserWithGoogleAuth(page);
    await goToPromo(page);
    await clickPlan(page, 'business');
    await fillCardForm(page, card);
    await clickPay(page, 'business');
    await completeThreeDSIfRequired(page);
    await expect(page.getByText('¡Suscripción activada!')).toBeVisible({ timeout: 60_000 });

    await page.getByTestId('sidebar-configuracion').click();
    await expect(page.getByText('Exportar a Google Drive')).toBeVisible({ timeout: 10_000 });
  });
});
