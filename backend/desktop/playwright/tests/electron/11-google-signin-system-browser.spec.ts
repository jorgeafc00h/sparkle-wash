/**
 * Google sign-in — real Electron main process, system-browser + loopback flow.
 *
 * Regression for the desktop sign-in break: since 71add40 the code exchange
 * omitted the client secret and Google's token endpoint answered every sign-in
 * with `invalid_request: client_secret is missing`. This drives the whole
 * desktop chain without a person or a Google account:
 *   WelcomePage → IPC → googleOAuthService (shell.openExternal stubbed to
 *   capture the consent URL) → the test plays the browser redirect against the
 *   127.0.0.1 loopback → code exchange (Google's token endpoint stubbed inside
 *   the main process; the request body is asserted) → renderer session → /home.
 * Mock MH — nothing here talks to Hacienda.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeElectron, launchElectron, type ElectronAppHandle } from '../../fixtures/electron-launch';

const E2E_SECRET = 'e2e-desktop-client-secret';

const persist = (value: Record<string, unknown>) => {
  const encoded: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) encoded[k] = JSON.stringify(v);
  encoded._persist = JSON.stringify({ version: -1, rehydrated: true });
  return JSON.stringify(encoded);
};

const SIGNED_OUT = persist({
  user: null,
  isAuthenticated: false,
  isGuestMode: false,
  hasCompletedOnboarding: true,
  loading: false,
  error: null,
  token: null,
  refreshToken: null,
});

/** Stubs the system browser and Google's token endpoint inside the main process. */
async function stubGoogleInMain(handle: ElectronAppHandle) {
  await handle.app.evaluate(({ shell }) => {
    const g = globalThis as unknown as Record<string, any>;
    g.__fsOpened = [];
    g.__fsTokenRequests = [];
    shell.openExternal = async (url: string) => {
      g.__fsOpened.push(url);
    };
    const realFetch = g.fetch;
    g.fetch = async (input: unknown, init?: { body?: unknown }) => {
      const url = String((input as { url?: string })?.url ?? input);
      if (url !== 'https://oauth2.googleapis.com/token') return realFetch(input, init);
      const body = Object.fromEntries(new URLSearchParams(String(init?.body ?? '')));
      g.__fsTokenRequests.push(body);
      const consent = new URL(g.__fsOpened[g.__fsOpened.length - 1]);
      const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const idToken = [
        b64({ alg: 'RS256' }),
        b64({
          iss: 'https://accounts.google.com',
          aud: consent.searchParams.get('client_id'),
          exp: Math.floor(Date.now() / 1000) + 3600,
          nonce: consent.searchParams.get('nonce'),
          sub: 'e2e-google-sub',
          email: 'e2e.owner@gmail.com',
        }),
        'signature',
      ].join('.');
      return new Response(
        JSON.stringify({
          access_token: 'ya29.e2e-access',
          id_token: idToken,
          refresh_token: '1//e2e-refresh',
          expires_in: 3599,
          scope: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };
  });
}

async function consentUrl(handle: ElectronAppHandle): Promise<URL> {
  await expect
    .poll(() => handle.app.evaluate(() => ((globalThis as unknown as Record<string, any>).__fsOpened ?? []).length))
    .toBe(1);
  return new URL(await handle.app.evaluate(() => (globalThis as unknown as Record<string, any>).__fsOpened[0]));
}

test.describe('Google sign-in — system browser + loopback (Electron)', () => {
  let handle: ElectronAppHandle | null = null;
  const previousSecret = process.env.VITE_GOOGLE_CLIENT_SECRET;

  test.beforeAll(() => {
    // The main process falls back to process.env when the renderer's Vite env
    // has no secret (local .env without it). The token endpoint is stubbed,
    // so any value proves the exchange carries it.
    process.env.VITE_GOOGLE_CLIENT_SECRET = previousSecret || E2E_SECRET;
  });

  test.afterAll(() => {
    if (previousSecret === undefined) delete process.env.VITE_GOOGLE_CLIENT_SECRET;
    else process.env.VITE_GOOGLE_CLIENT_SECRET = previousSecret;
  });

  test.afterEach(async () => {
    if (handle) await closeElectron(handle);
    handle = null;
  });

  test('signs in through the system browser and sends the client secret in the code exchange', async () => {
    handle = await launchElectron({ mock: true, extraStorage: { 'persist:auth': SIGNED_OUT } });
    const { window, userDataDir } = handle;
    await stubGoogleInMain(handle);

    await window.route('https://www.googleapis.com/oauth2/v3/userinfo', (route) =>
      route.fulfill({ json: { sub: 'e2e-google-sub', email: 'e2e.owner@gmail.com', name: 'E2E Owner', picture: '' } }),
    );
    await window.route('**/auth/login', (route) =>
      route.fulfill({
        json: {
          internalJwt: 'jwt-e2e',
          user: { id: 'user-e2e', email: 'e2e.owner@gmail.com', firstName: 'E2E', lastName: 'Owner' },
          linkedProviders: ['google'],
          companies: [],
        },
      }),
    );

    await window.evaluate(() => {
      window.location.hash = '#/welcome';
    });
    await expect(window.getByTestId('google-signin-btn')).toBeVisible({ timeout: 30_000 });
    await window.getByTestId('google-signin-btn').click();

    // The consent page went to the system browser; the app waits in a dialog.
    await expect(window.getByTestId('google-signin-pending')).toBeVisible();
    const consent = await consentUrl(handle);
    const redirectUri = consent.searchParams.get('redirect_uri')!;
    expect(consent.origin + consent.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
    expect(consent.searchParams.get('scope')).toBe('openid email profile');
    expect(consent.searchParams.get('code_challenge_method')).toBe('S256');

    // The user finishes in the browser → Google redirects to the loopback.
    const callback = new URL(redirectUri);
    callback.searchParams.set('code', '4/e2e-auth-code');
    callback.searchParams.set('state', consent.searchParams.get('state')!);
    const page = await fetch(callback);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Sesión iniciada');

    // The exchange carried PKCE AND the client secret (the regression).
    const [exchange] = await handle.app.evaluate(() => (globalThis as unknown as Record<string, any>).__fsTokenRequests);
    expect(exchange).toMatchObject({
      grant_type: 'authorization_code',
      code: '4/e2e-auth-code',
      client_id: consent.searchParams.get('client_id'),
      client_secret: process.env.VITE_GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
    });
    expect(exchange.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);

    await expect(window).toHaveURL(/#\/home/, { timeout: 30_000 });
    await expect(window.getByTestId('google-signin-pending')).toBeHidden();

    // The refresh token lives only in the main-process secret store (encrypted
    // when safeStorage is available) — never in the renderer's app storage.
    await expect
      .poll(() => readFileSync(join(userDataDir, 'secrets.json'), 'utf-8'))
      .toContain('google-oauth::refresh:e2e-google-sub');
    expect(readFileSync(join(userDataDir, 'app-storage.json'), 'utf-8')).not.toContain('1//e2e-refresh');
  });

  test('cancelling from the app closes the loopback and leaves the user on the welcome page', async () => {
    handle = await launchElectron({ mock: true, extraStorage: { 'persist:auth': SIGNED_OUT } });
    const { window } = handle;
    await stubGoogleInMain(handle);

    await window.evaluate(() => {
      window.location.hash = '#/welcome';
    });
    await expect(window.getByTestId('google-signin-btn')).toBeVisible({ timeout: 30_000 });
    await window.getByTestId('google-signin-btn').click();
    await expect(window.getByTestId('google-signin-pending')).toBeVisible();
    const consent = await consentUrl(handle);

    await window.getByTestId('google-signin-cancel').click();
    await expect(window.getByTestId('google-signin-pending')).toBeHidden();
    await expect(window).toHaveURL(/#\/welcome/);

    // The one-shot loopback server is gone: a late browser redirect can't land.
    const callback = new URL(consent.searchParams.get('redirect_uri')!);
    callback.searchParams.set('code', 'late');
    callback.searchParams.set('state', consent.searchParams.get('state')!);
    await expect(fetch(callback)).rejects.toThrow();
    const exchanges = await handle.app.evaluate(() => (globalThis as unknown as Record<string, any>).__fsTokenRequests);
    expect(exchanges).toHaveLength(0);
  });
});
