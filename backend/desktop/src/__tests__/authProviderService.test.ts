import AuthProviderService from '../services/auth/AuthProviderService';
import type { GoogleUser } from '../services/auth/GoogleAuthService';

function installLocalStorageMock() {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: jest.fn((key: string) => storage.get(key) ?? null),
      setItem: jest.fn((key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: jest.fn((key: string) => {
        storage.delete(key);
      }),
      clear: jest.fn(() => {
        storage.clear();
      }),
      key: jest.fn((index: number) => Array.from(storage.keys())[index] ?? null),
      get length() {
        return storage.size;
      },
    },
    configurable: true,
  });
}

function mockFetch(data: unknown, ok = true, status = ok ? 200 : 409) {
  globalThis.fetch = jest.fn(async () => ({
    ok,
    status,
    json: async () => data,
  })) as jest.Mock;
}

const googleUser: GoogleUser = {
  id: 'google-sub-123',
  email: 'google@example.com',
  name: 'Google User',
  picture: 'https://example.com/avatar.png',
  idToken: 'google.id.token',
  accessToken: 'google.access.token',
};

describe('AuthProviderService', () => {
  beforeEach(async () => {
    jest.resetAllMocks();
    installLocalStorageMock();
    await AuthProviderService.clearSession();
  });

  it('posts Google sign-in to /auth/login and stores the internal user/JWT', async () => {
    mockFetch({
      token: 'internal.jwt',
      refreshToken: 'refresh.jwt',
      user: {
        id: 'internal-user-1',
        email: 'owner@example.com',
        firstName: 'Ana',
        lastName: 'Diaz',
      },
      linkedProviders: ['google'],
    });

    const result = await AuthProviderService.loginWithGoogle(googleUser);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/login'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ provider: 'google', token: 'google.id.token' }),
      }),
    );
    expect(result.authenticated).toBe(true);
    if (result.authenticated) {
      expect(result.user.id).toBe('internal-user-1');
      expect(result.token).toBe('internal.jwt');
      expect(result.linkedProviders).toEqual(['google']);
    }

    const session = await AuthProviderService.getSession();
    expect(session?.token).toBe('internal.jwt');
    expect(session?.user.id).toBe('internal-user-1');
  });

  it('returns provider-linking state for requiresLinking without storing a session', async () => {
    mockFetch({
      requiresLinking: true,
      provider: 'google',
      email: 'different-google@example.com',
      message: 'Vincula Google desde una cuenta existente.',
      linkToken: 'link-token',
    }, false);

    const result = await AuthProviderService.loginWithGoogle(googleUser);

    expect(result.authenticated).toBe(false);
    if (!result.authenticated) {
      expect(result.providerLinking).toEqual({
        required: true,
        provider: 'google',
        email: 'different-google@example.com',
        message: 'Vincula Google desde una cuenta existente.',
        linkToken: 'link-token',
      });
      expect(result.providerLinking.message.toLowerCase()).not.toContain(['join', 'company'].join(' '));
    }
    await expect(AuthProviderService.getSession()).resolves.toBeNull();
  });

  it('links Google through /auth/providers/link with the internal JWT', async () => {
    mockFetch({
      user: {
        id: 'internal-user-1',
        email: 'owner@example.com',
        firstName: 'Ana',
        lastName: 'Diaz',
      },
      linkedProviders: ['apple', 'google'],
    });

    const session = await AuthProviderService.linkGoogleProvider(googleUser, 'internal.jwt');

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/providers/link'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer internal.jwt',
        }),
        body: JSON.stringify({ provider: 'google', token: 'google.id.token' }),
      }),
    );
    expect(session.token).toBe('internal.jwt');
    expect(session.linkedProviders).toEqual(['apple', 'google']);
  });
  it('maps the real Invoices.Api login shape ({ userId, internalJwt }) onto the session', async () => {
    mockFetch({ userId: 'acct-42', internalJwt: 'internal.jwt', requiresLinking: false, companies: ['co0614'], tier: 'free' });

    const result = await AuthProviderService.loginWithGoogle(googleUser);

    expect(result.authenticated).toBe(true);
    if (result.authenticated) {
      expect(result.user.id).toBe('acct-42');
      expect(result.user.email).toBe('google@example.com');
      expect(result.token).toBe('internal.jwt');
      expect(result.companies).toEqual(['co0614']);
    }
  });

  it('turns a blocked/unreachable API (fetch TypeError, e.g. CORS) into a Spanish connection error', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as jest.Mock;

    await expect(AuthProviderService.loginWithGoogle(googleUser)).rejects.toThrow(
      /No se pudo conectar con el servidor de Facturas Simples/,
    );
    expect(await AuthProviderService.getSession()).toBeNull();
  });

  it('reports the HTTP status when the API rejects the Google token with an empty body', async () => {
    mockFetch(undefined, false, 401);
    globalThis.fetch = jest.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      },
    })) as jest.Mock;

    await expect(AuthProviderService.loginWithGoogle(googleUser)).rejects.toThrow(/HTTP 401/);
  });

  it('surfaces a bare JSON-string error body from the API', async () => {
    mockFetch('provider and token are required', false, 400);

    await expect(AuthProviderService.loginWithGoogle(googleUser)).rejects.toThrow('provider and token are required');
  });
});

describe('AuthProviderService.getFreshToken — 24 h internal JWT renewal', () => {
  const jwt = (expSecondsFromNow: number) => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `${b64({ alg: 'HS256' })}.${b64({ sub: 'acct-1', exp: Math.floor(Date.now() / 1000) + expSecondsFromNow })}.sig`;
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    installLocalStorageMock();
    await AuthProviderService.clearSession();
  });

  it('returns a token with plenty of life unchanged, without calling the API', async () => {
    const token = jwt(10 * 3600);
    await AuthProviderService.updateToken(token);
    globalThis.fetch = jest.fn() as jest.Mock;

    expect(await AuthProviderService.getFreshToken()).toBe(token);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('re-mints a token about to expire via POST /auth/refresh, stores it and notifies listeners', async () => {
    const old = jwt(10 * 60);
    const fresh = jwt(24 * 3600);
    await AuthProviderService.updateToken(old);
    mockFetch({ userId: 'acct-1', internalJwt: fresh });
    const renewed: string[] = [];
    const off = AuthProviderService.onSessionTokenRenewed((t) => renewed.push(t));

    const [a, b] = await Promise.all([AuthProviderService.getFreshToken(), AuthProviderService.getFreshToken()]);

    expect(a).toBe(fresh);
    expect(b).toBe(fresh);
    expect(fetch).toHaveBeenCalledTimes(1); // concurrent callers share one renewal
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/refresh'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${old}` }) }),
    );
    expect(await AuthProviderService.getToken()).toBe(fresh);
    expect(renewed).toEqual([fresh]);
    off();
  });

  it('keeps the old token when renewal is impossible (no Google session), so the API 401 surfaces as before', async () => {
    const expired = jwt(-60);
    await AuthProviderService.updateToken(expired);
    globalThis.fetch = jest.fn() as jest.Mock;

    expect(await AuthProviderService.getFreshToken()).toBe(expired);
  });

  it('passes non-JWT tokens (e2e fixtures) straight through', async () => {
    expect(await AuthProviderService.getFreshToken('jwt-e2e')).toBe('jwt-e2e');
  });
});
