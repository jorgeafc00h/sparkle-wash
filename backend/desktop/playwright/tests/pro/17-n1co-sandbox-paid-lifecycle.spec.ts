import { test, expect, Page, APIRequestContext } from '@playwright/test';
import { N1CO_TEST_CARDS, DEFAULT_CARDHOLDER, N1COTestCard } from '../../fixtures/n1co-cards';
import { seedLiteUserWithGoogleAuth } from '../../fixtures/pro-state';

/**
 * Live N1CO sandbox lifecycle: one account goes Free → Pro ($7) → Business ($14)
 * → cancelled, and the paid gates are checked at every step. NO mocks: real card
 * tokenization, real 3DS, real sandbox subscriptions, and the backend's stored
 * subscription is what the app re-reads on every fresh session.
 *
 * Needs a backend in Development with `N1CO_DEV_TEST_AUTH_ENABLED=true`, sandbox
 * N1CO keys and the sandbox plan ids (`N1CO_PRO_PLAN_ID`, `N1CO_BUSINESS_PLAN_ID`),
 * reached through the Vite proxy (`VITE_N1CO_PROXY_TARGET=<api>` on the dev server).
 *
 * Run: `N1CO_SANDBOX=1 npx playwright test pro/17-n1co-sandbox-paid-lifecycle --workers=1`
 */
const sandboxEnabled = process.env.N1CO_SANDBOX === '1';
const DEV_TEST_TOKEN = 'fake-id-token-for-testing';
test.skip(!sandboxEnabled, 'Set N1CO_SANDBOX=1 to run live N1CO sandbox tests');
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const AUTH_HEADERS = {
  Authorization: `Bearer ${DEV_TEST_TOKEN}`,
  'Content-Type': 'application/json',
};

interface ServerStatus {
  tier: string;
  subscription: { n1coSubscriptionId?: string; status?: string; tier?: string } | null;
}

async function serverStatus(request: APIRequestContext): Promise<ServerStatus> {
  const res = await request.get('/subscription/n1co/status', { headers: AUTH_HEADERS, timeout: 30_000 });
  expect(res.ok(), `status endpoint answered ${res.status()}`).toBeTruthy();
  return (await res.json()) as ServerStatus;
}

async function cancelOnServer(request: APIRequestContext): Promise<void> {
  await request
    .post('/subscription/n1co/cancel', {
      headers: AUTH_HEADERS,
      data: { reason: 'Playwright paid-lifecycle reset' },
      timeout: 30_000,
    })
    .catch(() => undefined);
}

async function goToPromo(page: Page): Promise<void> {
  await page.goto('/#/settings/promo');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('heading', { name: 'Pagar con tarjeta' })).toBeVisible({ timeout: 15_000 });
}

async function fillCardForm(page: Page, card: N1COTestCard): Promise<void> {
  await page.getByLabel('Nombre del titular').fill(DEFAULT_CARDHOLDER.name);
  await page.getByLabel('Número de tarjeta').fill(card.number);
  await page.getByLabel('Mes').fill(DEFAULT_CARDHOLDER.month);
  await page.getByLabel('Año').fill(DEFAULT_CARDHOLDER.year);
  await page.getByLabel('CVV').fill(DEFAULT_CARDHOLDER.cvv);
  await page.getByLabel('Correo de facturación').fill(DEFAULT_CARDHOLDER.email);
}

async function completeThreeDSIfRequired(page: Page): Promise<boolean> {
  const modal = page.getByTestId('threeds-modal');
  const shown = await modal.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
  if (!shown) return false;
  const closedByItself = await modal.waitFor({ state: 'hidden', timeout: 10_000 }).then(() => true).catch(() => false);
  if (closedByItself) return true;
  const challenge = page.frameLocator('[data-testid="threeds-iframe"]');
  await challenge
    .getByRole('button', { name: /continue|continuar|aprobar|complete/i })
    .first()
    .click({ timeout: 15_000 })
    .catch(async () => {
      const form = challenge.locator('form').first();
      await form.waitFor({ state: 'attached', timeout: 5_000 });
      await form.evaluate((f: HTMLFormElement) => f.submit());
    });
  await modal.waitFor({ state: 'hidden', timeout: 30_000 });
  return true;
}

async function buy(page: Page, plan: 'pro' | 'business', card: N1COTestCard): Promise<void> {
  const planRegex = plan === 'pro' ? /Pro.*\$7\.00\/mes/ : /Business.*\$14\.00\/mes/;
  const payRegex = plan === 'pro' ? /Pagar \$7\.00\/mes/ : /Pagar \$14\.00\/mes/;
  await goToPromo(page);
  await page.getByRole('button', { name: planRegex }).click();
  await fillCardForm(page, card);
  await page.getByRole('button', { name: payRegex }).click();
  const used3DS = await completeThreeDSIfRequired(page);
  test.info().annotations.push({ type: '3ds', description: `${plan}: challenge ${used3DS ? 'shown' : 'not shown'}` });
  await expect(page.getByText('¡Suscripción activada!')).toBeVisible({ timeout: 60_000 });
}

/** Sidebar entries gated by tier render as a disabled element with data-locked="tier". */
async function expectSidebarGate(page: Page, testId: string, locked: boolean): Promise<void> {
  const item = page.getByTestId(testId);
  await expect(item).toBeVisible({ timeout: 15_000 });
  if (locked) {
    await expect(item).toHaveAttribute('data-locked', 'tier', { timeout: 15_000 });
  } else {
    await expect(item).not.toHaveAttribute('data-locked', /.*/, { timeout: 15_000 });
  }
}

async function expectAccountPlan(page: Page, label: 'Free (Gratis)' | 'Pro' | 'Business'): Promise<void> {
  await page.goto('/#/settings/account');
  await page.waitForLoadState('domcontentloaded');
  const summary = page.getByTestId('account-summary');
  await expect(summary).toBeVisible({ timeout: 15_000 });
  await expect(summary.locator('span').filter({ hasText: new RegExp(`^${label.replace(/[()]/g, '\\$&')}$`) }).first())
    .toBeVisible({ timeout: 20_000 });
}

async function expectPaidGates(page: Page, unlocked: boolean): Promise<void> {
  await page.goto('/#/home');
  await page.waitForLoadState('domcontentloaded');
  await expectSidebarGate(page, 'sidebar-libros-iva', !unlocked);
  await expectSidebarGate(page, 'sidebar-pos-consolidar', !unlocked);
  const upgradeCard = page.getByTestId('pro-upgrade-card');
  if (unlocked) await expect(upgradeCard).toHaveCount(0, { timeout: 15_000 });
  else await expect(upgradeCard).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('sidebar-configuracion').click();
  const drive = page.getByText('Exportar a Google Drive');
  if (unlocked) await expect(drive).toBeVisible({ timeout: 10_000 });
  else await expect(drive).toHaveCount(0, { timeout: 10_000 });

  // The gated routes themselves, not just the sidebar.
  await page.goto('/#/invoices/libros-iva');
  await page.waitForLoadState('domcontentloaded');
  if (unlocked) {
    await expect(page.getByTestId('libros-iva')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('libros-iva-locked')).toHaveCount(0);
  } else {
    await expect(page.getByTestId('libros-iva-locked')).toBeVisible({ timeout: 15_000 });
  }
}

test.describe('N1CO sandbox — paid lifecycle on one account', () => {
  const ids: { pro?: string; business?: string } = {};

  test.beforeAll(async ({ request }) => {
    await cancelOnServer(request);
    expect((await serverStatus(request)).tier).toBe('lite');
  });

  test('1. Free account: paid gates are locked', async ({ page }) => {
    await seedLiteUserWithGoogleAuth(page);
    await expectAccountPlan(page, 'Free (Gratis)');
    await expectPaidGates(page, false);
  });

  test('2. Buys Pro ($7) with a 3DS Mastercard → paid gates unlock', async ({ page, request }) => {
    await seedLiteUserWithGoogleAuth(page);
    await buy(page, 'pro', N1CO_TEST_CARDS.mastercardSuccess3DS);

    const status = await serverStatus(request);
    expect(status.tier).toBe('adfree');
    expect(status.subscription?.n1coSubscriptionId, 'backend stored the N1CO subscription').toBeTruthy();
    ids.pro = status.subscription!.n1coSubscriptionId!;
    test.info().annotations.push({ type: 'n1co-subscription', description: `pro=${ids.pro}` });

    await expectAccountPlan(page, 'Pro');
    await expect(page.getByText('Sin anuncios').first()).toBeVisible();
    // The account page reads the cap from FeatureGate.getMaxCompanies(AdFree) === 2.
    await expect(page.getByText(/^\d+ \/ 2$/)).toBeVisible();
    await expectPaidGates(page, true);
  });

  test('3. Fresh session re-reads the paid plan from the server', async ({ page }) => {
    // Persisted state says Free (new install / cleared storage); the backend says Pro.
    await seedLiteUserWithGoogleAuth(page);
    await expectAccountPlan(page, 'Pro');
    await expectPaidGates(page, true);
  });

  test('4. Upgrades Pro → Business with a 3DS Visa', async ({ page, request }) => {
    await seedLiteUserWithGoogleAuth(page);
    await expectAccountPlan(page, 'Pro');
    await goToPromo(page);
    // A Pro subscriber is only offered the upgrade.
    await expect(page.getByRole('button', { name: /Pro.*\$7\.00\/mes/ })).toHaveCount(0);
    await buy(page, 'business', N1CO_TEST_CARDS.visaSuccess3DS);

    const status = await serverStatus(request);
    expect(status.tier).toBe('pro');
    ids.business = status.subscription?.n1coSubscriptionId;
    test.info().annotations.push({
      type: 'n1co-subscription',
      description: `pro=${ids.pro} business=${ids.business} — check the pro one is no longer active in N1CO`,
    });
    expect(ids.business).toBeTruthy();
    expect(ids.business).not.toBe(ids.pro);

    await expectAccountPlan(page, 'Business');
    await expect(page.getByText('Empresas ilimitadas').first()).toBeVisible();
    await expectPaidGates(page, true);
  });

  test('5. Updates the card (3DS Mastercard) — plan stays Business', async ({ page, request }) => {
    await seedLiteUserWithGoogleAuth(page);
    await expectAccountPlan(page, 'Business');
    await page.getByTestId('account-change-card-btn').click();
    await expect(page.getByTestId('change-payment-method')).toBeVisible({ timeout: 10_000 });
    const card = N1CO_TEST_CARDS.mastercardSuccess3DS;
    await page.getByLabel('Nombre del titular').fill(DEFAULT_CARDHOLDER.name);
    await page.getByLabel('Número de tarjeta').fill(card.number);
    await page.getByLabel('Mes').fill(DEFAULT_CARDHOLDER.month);
    await page.getByLabel('Año').fill(DEFAULT_CARDHOLDER.year);
    await page.getByLabel('CVV').fill(DEFAULT_CARDHOLDER.cvv);
    await page.getByRole('button', { name: 'Guardar nueva tarjeta' }).click();
    const used3DS = await completeThreeDSIfRequired(page);
    test.info().annotations.push({ type: '3ds', description: `change-card: challenge ${used3DS ? 'shown' : 'not shown'}` });
    await expect(page.getByText('Tarjeta actualizada correctamente.')).toBeVisible({ timeout: 60_000 });

    const status = await serverStatus(request);
    expect(status.tier).toBe('pro');
    test.info().annotations.push({
      type: 'n1co-subscription',
      description: `after card change: ${status.subscription?.n1coSubscriptionId} (was ${ids.business})`,
    });
    ids.business = status.subscription?.n1coSubscriptionId ?? ids.business;
    await expectAccountPlan(page, 'Business');
    await expectPaidGates(page, true);
  });

  test('6. Cancels from Cuenta → back to Free and gates lock again', async ({ page, request }) => {
    await seedLiteUserWithGoogleAuth(page);
    await expectAccountPlan(page, 'Business');
    await page.getByTestId('account-cancel-subscription-btn').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Tu suscripción se cancelará en N1CO');
    await dialog.getByRole('button', { name: 'Cancelar suscripción' }).click();
    await expect(page.getByText('Suscripción cancelada correctamente.')).toBeVisible({ timeout: 30_000 });

    expect((await serverStatus(request)).tier).toBe('lite');
    await expectAccountPlan(page, 'Free (Gratis)');
    await expectPaidGates(page, false);

    // And a fresh session stays Free.
    await seedLiteUserWithGoogleAuth(page);
    await expectAccountPlan(page, 'Free (Gratis)');
  });
});
