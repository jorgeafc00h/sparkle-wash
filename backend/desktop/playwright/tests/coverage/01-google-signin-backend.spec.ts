/**
 * Google sign-in — renderer + Invoices.Api `POST /api/auth/login` (web build).
 *
 * electron/11 proves the system-browser/loopback half against a real main
 * process, but it stubs `/auth/login` with an unconditional success. These
 * specs drive WelcomePage → authSlice.googleSignIn → GoogleAuthService →
 * AuthProviderService.loginWithGoogle with the Electron bridge stubbed
 * (`window.electronAPI.googleSignIn`) and every backend answer controlled by
 * `page.route`, so the failure paths the user can actually hit are covered:
 * network/CORS failure, 4xx/5xx, missing token, provider linking, a declined
 * consent, Google userinfo down, a stalled API — plus the request contract the
 * real LoginEndpoint binds.
 */

import { test, expect, type Page, type Route } from '@playwright/test';
import {
  API_HOST,
  TEST_COMPANY,
  blockExternalNetwork,
  persist,
  seedStorage,
  subscriptionState,
} from './_support';

const ID_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJlMmUtZ29vZ2xlLXN1YiJ9.sig';
const GOOGLE_PROFILE = { sub: 'e2e-google-sub', email: 'e2e.owner@gmail.com', name: 'E2E Owner', picture: '' };
const SESSION = {
  internalJwt: 'jwt-e2e-session',
  userId: 'user-e2e',
  user: { id: 'user-e2e', email: GOOGLE_PROFILE.email, firstName: 'E2E', lastName: 'Owner' },
  linkedProviders: ['google'],
  companies: [],
};

type GoogleBridgeResult =
  | { idToken: string; accessToken: string; scope: string; expiresIn: number }
  | { error: string };

const DEFAULT_GOOGLE_RESULT: GoogleBridgeResult = {
  idToken: ID_TOKEN,
  accessToken: 'ya29.e2e-access',
  scope: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
  expiresIn: 3599,
};

interface LoginCapture {
  bodies: Array<Record<string, unknown>>;
}

/**
 * Signed-out user (onboarding done, one company) on the welcome page, with the
 * Electron Google bridge stubbed and Google's userinfo endpoint answered.
 */
async function openWelcome(
  page: Page,
  opts: {
    google?: GoogleBridgeResult;
    userinfo?: (route: Route) => Promise<void> | void;
    login: (route: Route, body: Record<string, unknown>) => Promise<void> | void;
  },
): Promise<LoginCapture> {
  const capture: LoginCapture = { bodies: [] };

  await blockExternalNetwork(page);
  await page.route('https://www.googleapis.com/oauth2/v3/userinfo', async (route) => {
    if (opts.userinfo) return opts.userinfo(route);
    return route.fulfill({ json: GOOGLE_PROFILE });
  });
  await page.route(`https://${API_HOST}/api/auth/login`, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    capture.bodies.push(body);
    return opts.login(route, body);
  });

  await page.addInitScript((result) => {
    const w = window as unknown as Record<string, unknown>;
    w.__googleSignInCalls = 0;
    w.electronAPI = {
      googleSignIn: async () => {
        (w.__googleSignInCalls as number)++;
        return result;
      },
    };
  }, opts.google ?? DEFAULT_GOOGLE_RESULT);

  await seedStorage(page, {
    'persist:auth': persist({
      user: null,
      isAuthenticated: false,
      isGuestMode: false,
      hasCompletedOnboarding: true,
      selectedCompanyId: TEST_COMPANY.id,
      linkedProviders: [],
    }),
    'persist:companies': persist({ companies: [TEST_COMPANY], selectedCompanyId: TEST_COMPANY.id }),
    'persist:subscription': subscriptionState('lite'),
  });

  await page.goto('/#/welcome');
  await expect(page.getByTestId('google-signin-btn')).toBeVisible({ timeout: 20_000 });
  return capture;
}

const errorBanner = (page: Page) => page.getByTestId('welcome').locator('p.text-red-100');

/** After a failed attempt the user is still on the welcome page and can retry. */
async function expectRecoverableFailure(page: Page) {
  await expect(errorBanner(page)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('google-signin-btn')).toBeEnabled();
  await expect(page.getByTestId('google-signin-btn')).toContainText('Iniciar sesión con Google');
  await expect(page).toHaveURL(/#\/welcome/);
  await expect(page.getByTestId('sidebar-inicio')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('app_auth_token'))).toBeNull();
}

test.describe('Google sign-in — success', () => {
  test('a valid API session signs the user in, lands on Inicio and is shown on Perfil', async ({ page }) => {
    const capture = await openWelcome(page, { login: (route) => route.fulfill({ json: SESSION }) });

    await page.getByTestId('google-signin-btn').click();
    await expect(page).toHaveURL(/#\/home/, { timeout: 15_000 });
    await expect(page.getByTestId('sidebar-inicio')).toBeVisible();

    // One login call carrying the provider + the Google id token.
    expect(capture.bodies).toHaveLength(1);
    expect(capture.bodies[0].provider).toBe('google');
    expect(Object.values(capture.bodies[0])).toContain(ID_TOKEN);
    // The internal JWT is persisted for later API calls; the Google session too.
    expect(await page.evaluate(() => localStorage.getItem('app_auth_token'))).toBe(SESSION.internalJwt);
    expect(await page.evaluate(() => localStorage.getItem('google_id_token'))).toBe(ID_TOKEN);

    await page.goto('/#/settings/profile');
    await expect(page.getByTestId('profile')).toBeVisible();
    await expect(page.getByTestId('profile').getByText(GOOGLE_PROFILE.email).first()).toBeVisible();
    await expect(page.getByText('Modo Invitado')).toHaveCount(0);
  });

  test('after sign-in, N1CO calls carry the GOOGLE id token and account calls the session JWT', async ({ page }) => {
    // Regression (fixed 2026-10-11): /subscription/n1co/* authenticate with a Google
    // id_token (Invoices.Api GoogleAuthEndpointFilter); since sign-in moved to
    // /api/auth/login the app sent the internal session JWT and every N1CO call
    // (status, checkout, cancel, change card) answered 401 in production.
    const auth: Record<string, string[]> = { n1co: [], entitlements: [] };
    const capture = await openWelcome(page, { login: (route) => route.fulfill({ json: SESSION }) });
    await page.route('**/subscription/n1co/status', (route) => {
      auth.n1co.push(route.request().headers().authorization ?? '');
      return route.fulfill({ json: { tier: 'lite', status: 'none', subscription: null } });
    });
    await page.route('**/api/v2/account/entitlements', (route) => {
      auth.entitlements.push(route.request().headers().authorization ?? '');
      return route.fulfill({ json: { tier: 'free', status: 'none', features: { sync: false, adFree: false, email: true } } });
    });

    await page.getByTestId('google-signin-btn').click();
    await expect(page).toHaveURL(/#\/home/, { timeout: 15_000 });
    expect(capture.bodies).toHaveLength(1);

    await expect.poll(() => auth.n1co.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(new Set(auth.n1co)).toEqual(new Set([`Bearer ${ID_TOKEN}`]));
    await expect.poll(() => auth.entitlements.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(new Set(auth.entitlements)).toEqual(new Set([`Bearer ${SESSION.internalJwt}`]));
  });

  test('contract: the id token travels in the field Invoices.Api binds (`token`) and the real response shape signs in', async ({ page }) => {
    // Regression (fixed 2026-10-10): ≤ 1.3.0 posted `{ provider, idToken }` while
    // Invoices.Api LoginRequest binds `{ provider, token }` ([JsonPropertyName("token")],
    // Features/Auth/Commands/LoginEndpoint.cs) and answered 400 "provider and token
    // are required". This route mirrors the real endpoint: it only issues a session
    // when `token` is present, and answers with the real `{ userId, internalJwt }`
    // shape (no `user` object).
    const capture = await openWelcome(page, {
      login: (route, body) => {
        if (typeof body.provider !== 'string' || !body.provider || typeof body.token !== 'string' || !body.token) {
          return route.fulfill({ status: 400, json: 'provider and token are required' });
        }
        return route.fulfill({
          json: { userId: 'user-e2e', internalJwt: SESSION.internalJwt, requiresLinking: false, companies: [], tier: 'free' },
        });
      },
    });

    await page.getByTestId('google-signin-btn').click();
    await expect.poll(() => capture.bodies.length).toBe(1);
    expect(capture.bodies[0]).toMatchObject({ provider: 'google', token: ID_TOKEN });
    await expect(page).toHaveURL(/#\/home/, { timeout: 10_000 });
    expect(await page.evaluate(() => localStorage.getItem('app_auth_token'))).toBe(SESSION.internalJwt);
    const storedUser = await page.evaluate(() => JSON.parse(localStorage.getItem('app_auth_user') ?? 'null'));
    expect(storedUser).toMatchObject({ id: 'user-e2e', email: GOOGLE_PROFILE.email });
  });
});

test.describe('Google sign-in — backend failures surface an error and never hang', () => {
  test('network failure on /api/auth/login (request aborted)', async ({ page }) => {
    await openWelcome(page, { login: (route) => route.abort('failed') });
    await page.getByTestId('google-signin-btn').click();
    await expectRecoverableFailure(page);
  });

  test('CORS rejection of /api/auth/login (Access-Control-Allow-Origin for another origin)', async ({ page }) => {
    // What the packaged app hit on 2026-10-10 when PROD's allowedOrigins did not
    // list app://dist: the API answered, Chromium refused to hand it over.
    await openWelcome(page, {
      // Playwright injects a permissive Access-Control-Allow-Origin into fulfilled
      // responses that carry none, so send one for a different origin (the
      // landing page, the only origin PROD allowed) to make Chromium block it.
      login: (route) =>
        route.fulfill({
          status: 200,
          headers: { 'Access-Control-Allow-Origin': 'https://www.facturasimples.pro' },
          contentType: 'application/json',
          body: JSON.stringify(SESSION),
        }),
    });
    await page.getByTestId('google-signin-btn').click();
    await expectRecoverableFailure(page);
    await expect(errorBanner(page)).toContainText('No se pudo conectar con el servidor');
  });

  test('a network/CORS failure is explained in Spanish, not as a raw browser error', async ({ page }) => {
    // Regression (fixed 2026-10-10): the raw TypeError "Failed to fetch" used to
    // reach the welcome card. AuthProviderService.postJson now maps it.
    await openWelcome(page, { login: (route) => route.abort('failed') });
    await page.getByTestId('google-signin-btn').click();
    await expect(errorBanner(page)).toBeVisible({ timeout: 10_000 });
    await expect(errorBanner(page)).not.toHaveText(/Failed to fetch|NetworkError|TypeError|Load failed/i);
    await expect(errorBanner(page)).toHaveText(/conexi[oó]n|servidor|internet/i);
  });

  test('HTTP 400 with a bare JSON string body shows the server text', async ({ page }) => {
    await openWelcome(page, { login: (route) => route.fulfill({ status: 400, json: 'provider and token are required' }) });
    await page.getByTestId('google-signin-btn').click();
    await expectRecoverableFailure(page);
    await expect(errorBanner(page)).toContainText('provider and token are required');
  });

  test('HTTP 500 (ProblemDetails) from the API', async ({ page }) => {
    await openWelcome(page, {
      login: (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/problem+json',
          body: JSON.stringify({ type: 'about:blank', title: 'An error occurred', status: 500, detail: 'boom' }),
        }),
    });
    await page.getByTestId('google-signin-btn').click();
    await expectRecoverableFailure(page);
    await expect(errorBanner(page)).toContainText('No se pudo iniciar sesión');
  });

  test('HTTP 401 — the API rejects the Google token (empty body)', async ({ page }) => {
    await openWelcome(page, { login: (route) => route.fulfill({ status: 401, body: '' }) });
    await page.getByTestId('google-signin-btn').click();
    await expectRecoverableFailure(page);
  });

  test('HTTP 200 without a session token is refused', async ({ page }) => {
    await openWelcome(page, { login: (route) => route.fulfill({ json: { userId: 'user-e2e', companies: [] } }) });
    await page.getByTestId('google-signin-btn').click();
    await expectRecoverableFailure(page);
    await expect(errorBanner(page)).toContainText('El servidor no devolvió un token de sesión');
  });

  test('requiresLinking (email already owned by another provider) shows the linking notice, not a session', async ({ page }) => {
    // Shape of the real LoginEndpoint answer for an existing email.
    await openWelcome(page, {
      login: (route) =>
        route.fulfill({ json: { requiresLinking: true, existingUserId: 'user-apple-1', email: GOOGLE_PROFILE.email } }),
    });
    await page.getByTestId('google-signin-btn').click();
    await expect(page.getByTestId('auth-provider-linking-message')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('auth-provider-linking-message')).toContainText('Vinculación de cuenta requerida');
    await expect(page).toHaveURL(/#\/welcome/);
    await expect(page.getByTestId('google-signin-btn')).toBeEnabled();
    expect(await page.evaluate(() => localStorage.getItem('app_auth_token'))).toBeNull();
  });

  test('the user cancels / denies consent in the browser — no API call is made', async ({ page }) => {
    const capture = await openWelcome(page, {
      google: { error: 'Inicio de sesión con Google cancelado' },
      login: (route) => route.fulfill({ json: SESSION }),
    });
    await page.getByTestId('google-signin-btn').click();
    await expectRecoverableFailure(page);
    await expect(errorBanner(page)).toContainText('cancelado');
    expect(capture.bodies).toHaveLength(0);
  });

  test('Google userinfo endpoint down — error surfaced, API never called', async ({ page }) => {
    const capture = await openWelcome(page, {
      userinfo: (route) => route.fulfill({ status: 503, body: '' }),
      login: (route) => route.fulfill({ json: SESSION }),
    });
    await page.getByTestId('google-signin-btn').click();
    await expectRecoverableFailure(page);
    await expect(errorBanner(page)).toContainText('Error al obtener información del usuario de Google');
    expect(capture.bodies).toHaveLength(0);
  });

  test('a stalled /api/auth/login gives up and lets the user retry', async ({ page }) => {
    // Regression (fixed 2026-10-10): postJson had no timeout, so a cold/unresponsive
    // API left "Iniciando sesión…" spinning with both buttons disabled until the
    // app was restarted. It now gives up after 30 s with a Spanish message.
    test.setTimeout(60_000);
    await openWelcome(page, { login: () => new Promise<void>(() => { /* never answers */ }) });
    await page.getByTestId('google-signin-btn').click();
    await expect(page.getByTestId('google-signin-btn')).toContainText('Iniciando sesión');
    await expect(page.getByTestId('google-signin-btn')).toBeEnabled({ timeout: 35_000 });
    await expect(errorBanner(page)).toContainText('no respondió a tiempo');
  });
});
