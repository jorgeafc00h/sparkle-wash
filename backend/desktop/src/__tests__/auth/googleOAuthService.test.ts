// electron/googleOAuthService.cjs — main-process Google OAuth for installed apps.
//
// Drives the real loopback server: `openExternal` captures the consent URL
// (standing in for the system browser), the test then plays the browser's
// redirect against the 127.0.0.1 callback, and a fetch stub stands in for
// Google's token endpoint.

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  createGoogleOAuthService,
  normalizeScopes,
  validateIdTokenClaims,
  mergeRefreshEntries,
  pickRefreshEntry,
} = require('../../../electron/googleOAuthService.cjs');

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const CLIENT_SECRET = 'test-secret';
const DRIVE = 'https://www.googleapis.com/auth/drive.file';
const GMAIL = 'https://www.googleapis.com/auth/gmail.readonly';

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function idToken(claims: Record<string, unknown>): string {
  return `${b64url({ alg: 'RS256' })}.${b64url(claims)}.signature`;
}

function memorySecrets() {
  const map = new Map<string, string>();
  return {
    map,
    get: jest.fn((service: string, account: string) => map.get(`${service}::${account}`) ?? null),
    set: jest.fn((service: string, account: string, value: string) => {
      map.set(`${service}::${account}`, value);
      return true;
    }),
    delete: jest.fn((service: string, account: string) => {
      map.delete(`${service}::${account}`);
    }),
  };
}

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function setup(tokenResponse?: (body: URLSearchParams) => ReturnType<typeof jsonResponse>) {
  const secrets = memorySecrets();
  let resolveOpened: (url: string) => void;
  const opened = new Promise<string>((resolve) => {
    resolveOpened = resolve;
  });
  const requests: Array<{ url: string; body: URLSearchParams }> = [];
  const fetchImpl = jest.fn(async (url: string, init: { body: string }) => {
    const body = new URLSearchParams(init.body);
    requests.push({ url, body });
    if (tokenResponse) return tokenResponse(body);
    return jsonResponse(200, {});
  });
  const onBrowserReturned = jest.fn();
  const service = createGoogleOAuthService({
    openExternal: jest.fn(async (url: string) => resolveOpened(url)),
    secrets,
    fetchImpl,
    onBrowserReturned,
    timeoutMs: 10_000,
  });
  return { service, secrets, opened, requests, fetchImpl, onBrowserReturned };
}

async function browserRedirect(authUrl: string, params: Record<string, string>): Promise<{ status: number; text: string }> {
  const redirectUri = new URL(authUrl).searchParams.get('redirect_uri')!;
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const resp = await fetch(url);
  return { status: resp.status, text: await resp.text() };
}

describe('googleOAuthService — pure helpers', () => {
  it('always includes identity scopes and drops scopes outside the allow-list', () => {
    expect(normalizeScopes([GMAIL, 'https://www.googleapis.com/auth/admin'])).toEqual([
      'openid',
      'email',
      'profile',
      GMAIL,
    ]);
    expect(normalizeScopes(undefined)).toEqual(['openid', 'email', 'profile']);
  });

  it('validates iss / aud / exp / nonce on the id_token', () => {
    const now = 1_800_000_000;
    const ok = { iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: now + 3600, nonce: 'n1', sub: '42' };
    expect(validateIdTokenClaims(ok, { clientId: CLIENT_ID, nonce: 'n1', nowSeconds: now })).toBeNull();
    expect(validateIdTokenClaims({ ...ok, iss: 'https://evil.example' }, { clientId: CLIENT_ID, nonce: 'n1', nowSeconds: now })).toMatch(/Emisor/);
    expect(validateIdTokenClaims({ ...ok, aud: 'other' }, { clientId: CLIENT_ID, nonce: 'n1', nowSeconds: now })).toMatch(/Audiencia/);
    expect(validateIdTokenClaims({ ...ok, exp: now - 3600 }, { clientId: CLIENT_ID, nonce: 'n1', nowSeconds: now })).toMatch(/expirado/);
    expect(validateIdTokenClaims({ ...ok, nonce: 'other' }, { clientId: CLIENT_ID, nonce: 'n1', nowSeconds: now })).toMatch(/Nonce/);
  });

  it('keeps a refresh token whose scopes are not covered by a newer, narrower grant', () => {
    const gmail = { scopes: ['openid', 'email', 'profile', GMAIL], token: 'r-gmail' };
    const basic = { scopes: ['openid', 'email', 'profile'], token: 'r-basic' };
    const merged = mergeRefreshEntries([gmail], basic);
    expect(merged.map((e: { token: string }) => e.token)).toEqual(['r-basic', 'r-gmail']);
    expect(pickRefreshEntry(merged, GMAIL).token).toBe('r-gmail');
    expect(pickRefreshEntry(merged, DRIVE)).toBeNull();

    // A grant that covers everything replaces both.
    const all = { scopes: ['openid', 'email', 'profile', GMAIL, DRIVE], token: 'r-all' };
    expect(mergeRefreshEntries(merged, all).map((e: { token: string }) => e.token)).toEqual(['r-all']);
  });
});

describe('googleOAuthService — sign-in flow', () => {
  it('opens the system browser on a random 127.0.0.1 port and exchanges the code WITH the client secret', async () => {
    let nonce = '';
    const ctx = setup(() =>
      jsonResponse(200, {
        access_token: 'ya29.access',
        id_token: idToken({ iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 3600, nonce, sub: '1234567890', email: 'user@gmail.com' }),
        refresh_token: '1//refresh',
        expires_in: 3599,
        scope: `openid https://www.googleapis.com/auth/userinfo.email ${GMAIL}`,
      }),
    );

    const result = ctx.service.signIn({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, scopes: [GMAIL], loginHint: 'user@gmail.com' });
    const authUrl = await ctx.opened;
    const auth = new URL(authUrl);
    nonce = auth.searchParams.get('nonce')!;

    expect(auth.origin + auth.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(auth.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(auth.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
    expect(auth.searchParams.get('redirect_uri')).not.toContain(':9876');
    expect(auth.searchParams.get('scope')).toBe(`openid email profile ${GMAIL}`);
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
    expect(auth.searchParams.get('login_hint')).toBe('user@gmail.com');
    // Incremental auth is not supported for installed apps.
    expect(auth.searchParams.has('include_granted_scopes')).toBe(false);

    const page = await browserRedirect(authUrl, { code: '4/auth-code', state: auth.searchParams.get('state')! });
    expect(page.status).toBe(200);
    expect(page.text).toContain('Sesión iniciada');

    await expect(result).resolves.toEqual({
      idToken: expect.any(String),
      accessToken: 'ya29.access',
      scope: `openid https://www.googleapis.com/auth/userinfo.email ${GMAIL}`,
      expiresIn: 3599,
      accountId: '1234567890',
      email: 'user@gmail.com',
    });

    expect(ctx.requests).toHaveLength(1);
    const body = ctx.requests[0].body;
    expect(ctx.requests[0].url).toBe('https://oauth2.googleapis.com/token');
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('4/auth-code');
    expect(body.get('client_id')).toBe(CLIENT_ID);
    expect(body.get('client_secret')).toBe(CLIENT_SECRET);
    expect(body.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.get('redirect_uri')).toBe(auth.searchParams.get('redirect_uri'));
    expect(ctx.onBrowserReturned).toHaveBeenCalled();

    // The refresh token stays in the main-process secret store, never in the result.
    const stored = JSON.parse(ctx.secrets.map.get('google-oauth::refresh:1234567890')!);
    expect(stored).toEqual([expect.objectContaining({ token: '1//refresh', scopes: expect.arrayContaining([GMAIL]) })]);
    expect(JSON.stringify(await result)).not.toContain('1//refresh');
  });

  it('refuses to start without a client secret (Google rejects the exchange otherwise)', async () => {
    const ctx = setup();
    await expect(ctx.service.signIn({ clientId: CLIENT_ID, clientSecret: '' })).resolves.toEqual({
      error: 'VITE_GOOGLE_CLIENT_SECRET no configurado',
    });
  });

  it('ignores callbacks with a foreign state instead of aborting the sign-in', async () => {
    let nonce = '';
    const ctx = setup(() =>
      jsonResponse(200, {
        access_token: 'ya29.ok',
        id_token: idToken({ iss: 'accounts.google.com', aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 3600, nonce, sub: '77' }),
        expires_in: 3600,
      }),
    );
    const result = ctx.service.signIn({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const authUrl = await ctx.opened;
    nonce = new URL(authUrl).searchParams.get('nonce')!;

    const forged = await browserRedirect(authUrl, { error: 'access_denied', state: 'forged' });
    expect(forged.status).toBe(400);
    expect(ctx.service.isPending()).toBe(true);

    await browserRedirect(authUrl, { code: 'c', state: new URL(authUrl).searchParams.get('state')! });
    await expect(result).resolves.toMatchObject({ accessToken: 'ya29.ok', accountId: '77' });
  });

  it('maps a declined consent to "Autenticación cancelada"', async () => {
    const ctx = setup();
    const result = ctx.service.signIn({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const authUrl = await ctx.opened;
    await browserRedirect(authUrl, { error: 'access_denied', state: new URL(authUrl).searchParams.get('state')! });
    await expect(result).resolves.toEqual({ error: 'Autenticación cancelada' });
    expect(ctx.fetchImpl).not.toHaveBeenCalled();
  });

  it('surfaces the token endpoint error', async () => {
    const ctx = setup(() => jsonResponse(400, { error: 'invalid_request', error_description: 'client_secret is missing.' }));
    const result = ctx.service.signIn({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const authUrl = await ctx.opened;
    await browserRedirect(authUrl, { code: 'c', state: new URL(authUrl).searchParams.get('state')! });
    await expect(result).resolves.toEqual({ error: 'client_secret is missing.' });
  });

  it('rejects an id_token issued for another client', async () => {
    let nonce = '';
    const ctx = setup(() =>
      jsonResponse(200, {
        access_token: 'ya29',
        id_token: idToken({ iss: 'https://accounts.google.com', aud: 'someone-else', exp: Math.floor(Date.now() / 1000) + 3600, nonce, sub: '1' }),
      }),
    );
    const result = ctx.service.signIn({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const authUrl = await ctx.opened;
    nonce = new URL(authUrl).searchParams.get('nonce')!;
    await browserRedirect(authUrl, { code: 'c', state: new URL(authUrl).searchParams.get('state')! });
    await expect(result).resolves.toEqual({ error: 'Audiencia de id_token inválida' });
  });

  it('cancel() ends the pending flow (the app cannot see the browser tab)', async () => {
    const ctx = setup();
    const result = ctx.service.signIn({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    await ctx.opened;
    expect(ctx.service.cancel()).toBe(true);
    await expect(result).resolves.toEqual({ error: 'Autenticación cancelada' });
    expect(ctx.service.isPending()).toBe(false);
  });

  it('times out when the user never comes back', async () => {
    const secrets = memorySecrets();
    const service = createGoogleOAuthService({
      openExternal: jest.fn(async () => undefined),
      secrets,
      fetchImpl: jest.fn(),
      timeoutMs: 50,
    });
    await expect(service.signIn({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })).resolves.toEqual({
      error: expect.stringContaining('Tiempo de espera agotado'),
    });
  });
});

describe('googleOAuthService — refresh / sign-out', () => {
  function seeded(entries: unknown[], tokenResponse: (body: URLSearchParams) => ReturnType<typeof jsonResponse>) {
    const ctx = setup(tokenResponse);
    ctx.secrets.map.set('google-oauth::refresh:42', JSON.stringify(entries));
    return ctx;
  }

  it('renews an access token with the refresh token that carries the scope', async () => {
    const ctx = seeded(
      [
        { scopes: ['openid', 'email', 'profile'], token: 'r-basic' },
        { scopes: ['openid', 'email', 'profile', GMAIL], token: 'r-gmail' },
      ],
      () => jsonResponse(200, { access_token: 'ya29.new', expires_in: 3599, scope: `openid ${GMAIL}` }),
    );
    const result = await ctx.service.refresh({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, accountId: '42', scope: GMAIL });
    expect(result).toMatchObject({ accessToken: 'ya29.new', expiresIn: 3599, scope: `openid ${GMAIL}`, accountId: '42' });
    const body = ctx.requests[0].body;
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('r-gmail');
    expect(body.get('client_secret')).toBe(CLIENT_SECRET);
  });

  it('forgets a revoked refresh token and asks for re-authorization', async () => {
    const ctx = seeded([{ scopes: ['openid', GMAIL], token: 'r-gmail' }], () =>
      jsonResponse(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }),
    );
    const result = await ctx.service.refresh({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, accountId: '42', scope: GMAIL });
    expect(result).toMatchObject({ reauthRequired: true });
    expect(ctx.secrets.map.has('google-oauth::refresh:42')).toBe(false);
  });

  it('reports re-authorization when no stored grant carries the scope', async () => {
    const ctx = seeded([{ scopes: ['openid'], token: 'r' }], () => jsonResponse(200, {}));
    await expect(
      ctx.service.refresh({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, accountId: '42', scope: DRIVE }),
    ).resolves.toMatchObject({ reauthRequired: true });
    expect(ctx.fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects malformed account ids from the renderer', async () => {
    const ctx = setup();
    await expect(
      ctx.service.refresh({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, accountId: '../secrets' }),
    ).resolves.toMatchObject({ reauthRequired: true });
  });

  it('revokes and forgets the account tokens on sign-out', async () => {
    const ctx = seeded([{ scopes: ['openid'], token: 'r-1' }], () => jsonResponse(200, {}));
    await ctx.service.signOut({ accountId: '42', revoke: true });
    expect(ctx.requests).toEqual([{ url: 'https://oauth2.googleapis.com/revoke', body: expect.any(URLSearchParams) }]);
    expect(ctx.requests[0].body.get('token')).toBe('r-1');
    expect(ctx.secrets.map.has('google-oauth::refresh:42')).toBe(false);
  });
});
