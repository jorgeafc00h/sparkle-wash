// GoogleAuthService (renderer) — on-demand scopes, expiry + refresh, and the
// Gmail token helper built on it.

jest.mock('@/config/viteEnv', () => ({
  getViteEnv: () => ({
    PROD: false,
    DEV: true,
    VITE_GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
    VITE_GOOGLE_CLIENT_SECRET: 'client-secret',
  }),
  isViteProduction: () => false,
}));

jest.mock('@/services/storage/ElectronStorage', () => {
  const map = new Map<string, string>();
  return {
    __map: map,
    appStorage: {
      getItem: jest.fn(async (key: string) => (map.has(key) ? map.get(key)! : null)),
      setItem: jest.fn(async (key: string, value: string) => {
        map.set(key, value);
      }),
      removeItem: jest.fn(async (key: string) => {
        map.delete(key);
      }),
      getAllKeys: jest.fn(async () => Array.from(map.keys())),
    },
  };
});

jest.mock('@/services/security/SecureStorageService', () => {
  const creds = new Map<string, { accessToken?: string; refreshToken?: string }>();
  return {
    SecureStorageService: {
      getGmailCredentials: jest.fn(async (id: string) => creds.get(id) ?? null),
      setGmailCredentials: jest.fn(async (id: string, value: { accessToken?: string; refreshToken?: string }) => {
        creds.set(id, value);
      }),
      removeGmailCredentials: jest.fn(async (id: string) => {
        creds.delete(id);
      }),
    },
  };
});

import GoogleAuthService, { GOOGLE_SCOPES, GoogleAuthRequiredError } from '@/services/auth/GoogleAuthService';
import { getGmailAccessToken, linkGmailAccount } from '@/services/compras/GmailAuthService';
import { ComprasDatabase } from '@/services/compras/ComprasDatabase';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const storageMap: Map<string, string> = require('@/services/storage/ElectronStorage').__map;

const DRIVE = GOOGLE_SCOPES.DRIVE_FILE;
const GMAIL = GOOGLE_SCOPES.GMAIL_READONLY;
const HOUR = 60 * 60 * 1000;

const electronAPI = {
  googleSignIn: jest.fn(),
  googleRefreshToken: jest.fn(),
  googleSignOut: jest.fn(async () => ({ success: true })),
  googleCancelSignIn: jest.fn(async () => true),
  googleReopenSignIn: jest.fn(async () => true),
};

function userInfo(sub: string, email: string) {
  return { ok: true, json: async () => ({ sub, email, name: 'Usuario', picture: '' }) };
}

function seedSession(opts: { sub?: string; email?: string; token?: string; expiresAt?: number; scopes?: string | null }) {
  const user = { id: opts.sub ?? 'acct-1', email: opts.email ?? 'owner@gmail.com', name: 'Owner', idToken: 'id-old', accessToken: opts.token ?? 'tok-old' };
  storageMap.set('google_user', JSON.stringify(user));
  storageMap.set('google_access_token', user.accessToken);
  storageMap.set('google_id_token', user.idToken);
  if (opts.expiresAt !== undefined) storageMap.set('google_token_expires_at', String(opts.expiresAt));
  if (opts.scopes !== null && opts.scopes !== undefined) storageMap.set('google_granted_scopes', opts.scopes);
}

beforeEach(() => {
  storageMap.clear();
  jest.clearAllMocks();
  electronAPI.googleSignIn.mockReset();
  electronAPI.googleRefreshToken.mockReset();
  (globalThis as { window?: unknown }).window = { electronAPI };
  (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => userInfo('acct-1', 'owner@gmail.com'));
});

afterAll(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('GoogleAuthService.signIn', () => {
  it('asks only for identity scopes and passes the client secret to the main process', async () => {
    electronAPI.googleSignIn.mockResolvedValue({
      idToken: 'id-1',
      accessToken: 'tok-1',
      scope: 'openid email profile',
      expiresIn: 3599,
      accountId: 'acct-1',
    });

    const user = await GoogleAuthService.signIn();

    expect(electronAPI.googleSignIn).toHaveBeenCalledWith({
      clientId: 'client-id.apps.googleusercontent.com',
      clientSecret: 'client-secret',
      scopes: [],
      loginHint: undefined,
    });
    expect(user).toMatchObject({ id: 'acct-1', email: 'owner@gmail.com', idToken: 'id-1', accessToken: 'tok-1' });
    expect(storageMap.get('google_granted_scopes')).toBe('openid email profile');
    expect(Number(storageMap.get('google_token_expires_at'))).toBeGreaterThan(Date.now() + 50 * 60 * 1000);
  });

  it('surfaces the main-process error and clears the pending state', async () => {
    electronAPI.googleSignIn.mockResolvedValue({ error: 'Autenticación cancelada' });
    const states: boolean[] = [];
    const off = GoogleAuthService.onSignInPendingChange((p) => states.push(p));
    await expect(GoogleAuthService.signIn()).rejects.toThrow('Autenticación cancelada');
    off();
    expect(states).toEqual([true, false]);
    expect(GoogleAuthService.isSignInPending()).toBe(false);
  });
});

describe('GoogleAuthService.getAccessTokenForScope', () => {
  it('returns a fresh cached token that carries the scope', async () => {
    seedSession({ token: 'tok-fresh', expiresAt: Date.now() + HOUR, scopes: `openid email profile ${DRIVE}` });
    await expect(GoogleAuthService.getAccessTokenForScope(DRIVE)).resolves.toBe('tok-fresh');
    expect(electronAPI.googleRefreshToken).not.toHaveBeenCalled();
  });

  it('renews an expired token from the stored refresh token', async () => {
    seedSession({ expiresAt: Date.now() - 1000, scopes: `openid email profile ${DRIVE}` });
    electronAPI.googleRefreshToken.mockResolvedValue({ accessToken: 'tok-new', scope: `openid ${DRIVE}`, expiresIn: 3600, accountId: 'acct-1' });

    await expect(GoogleAuthService.getAccessTokenForScope(DRIVE)).resolves.toBe('tok-new');
    expect(electronAPI.googleRefreshToken).toHaveBeenCalledWith({
      clientId: 'client-id.apps.googleusercontent.com',
      clientSecret: 'client-secret',
      accountId: 'acct-1',
      scope: DRIVE,
    });
    expect(storageMap.get('google_access_token')).toBe('tok-new');
  });

  it('treats a pre-refresh legacy session (no expiry stored) as expired', async () => {
    seedSession({ scopes: null }); // legacy: no expires_at, no granted scopes
    electronAPI.googleRefreshToken.mockResolvedValue({ error: 'No hay una autorización guardada', reauthRequired: true });
    await expect(GoogleAuthService.getAccessTokenForScope(DRIVE)).rejects.toBeInstanceOf(GoogleAuthRequiredError);
  });

  it('asks for the missing scope interactively, keeping the scopes the session already had', async () => {
    seedSession({ expiresAt: Date.now() + HOUR, scopes: `openid email profile ${GMAIL}` });
    electronAPI.googleRefreshToken.mockResolvedValue({ error: 'none', reauthRequired: true });
    electronAPI.googleSignIn.mockResolvedValue({
      idToken: 'id-2',
      accessToken: 'tok-drive',
      scope: `openid email profile ${GMAIL} ${DRIVE}`,
      expiresIn: 3600,
      accountId: 'acct-1',
    });

    await expect(GoogleAuthService.getAccessTokenForScope(DRIVE, { interactive: true })).resolves.toBe('tok-drive');
    expect(electronAPI.googleSignIn).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: [GMAIL, DRIVE], loginHint: 'owner@gmail.com' }),
    );
  });

  it('fails clearly when the user unticks the requested scope (granular consent)', async () => {
    seedSession({ expiresAt: Date.now() + HOUR, scopes: 'openid email profile' });
    electronAPI.googleRefreshToken.mockResolvedValue({ error: 'none', reauthRequired: true });
    electronAPI.googleSignIn.mockResolvedValue({
      idToken: 'id-3',
      accessToken: 'tok-basic',
      scope: 'openid email profile',
      expiresIn: 3600,
      accountId: 'acct-1',
    });
    await expect(GoogleAuthService.getAccessTokenForScope(DRIVE, { interactive: true })).rejects.toThrow(/Google Drive/);
  });

  it('never opens a browser when not interactive', async () => {
    seedSession({ expiresAt: Date.now() + HOUR, scopes: 'openid email profile' });
    electronAPI.googleRefreshToken.mockResolvedValue({ error: 'none', reauthRequired: true });
    await expect(GoogleAuthService.getAccessTokenForScope(GMAIL)).rejects.toBeInstanceOf(GoogleAuthRequiredError);
    expect(electronAPI.googleSignIn).not.toHaveBeenCalled();
  });
});

describe('GoogleAuthService.authorize / signOut', () => {
  it("leaves the app's session alone when another account is authorized with updateSession: same-account", async () => {
    seedSession({ sub: 'acct-1', email: 'owner@gmail.com', expiresAt: Date.now() + HOUR, scopes: 'openid email profile' });
    (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => userInfo('acct-2', 'compras@empresa.com'));
    electronAPI.googleSignIn.mockResolvedValue({ idToken: 'id-x', accessToken: 'tok-x', scope: `openid ${GMAIL}`, expiresIn: 3600, accountId: 'acct-2' });

    const auth = await GoogleAuthService.authorize({ scopes: [GMAIL], updateSession: 'same-account' });
    expect(auth.user.email).toBe('compras@empresa.com');
    expect(JSON.parse(storageMap.get('google_user')!).id).toBe('acct-1');
  });

  it('revokes the grant on explicit logout and clears every session key', async () => {
    seedSession({ expiresAt: Date.now() + HOUR, scopes: 'openid email profile' });
    await GoogleAuthService.signOut({ revoke: true });
    expect(electronAPI.googleSignOut).toHaveBeenCalledWith({ accountId: 'acct-1', revoke: true });
    expect([...storageMap.keys()].filter((k) => k.startsWith('google_'))).toEqual([]);
  });

  it('does not revoke on a plain local sign-out', async () => {
    seedSession({ expiresAt: Date.now() + HOUR, scopes: 'openid email profile' });
    await GoogleAuthService.signOut();
    expect(electronAPI.googleSignOut).not.toHaveBeenCalled();
  });
});

describe('GmailAuthService', () => {
  it('reuses the cached Gmail token while it is fresh', async () => {
    await ComprasDatabase.linkGmail('co-fresh', 'compras@empresa.com', 'gm-fresh', undefined, {
      googleAccountId: 'acct-9',
      tokenExpiresAt: Date.now() + HOUR,
    });
    await expect(getGmailAccessToken('co-fresh')).resolves.toBe('gm-fresh');
    expect(electronAPI.googleRefreshToken).not.toHaveBeenCalled();
  });

  it('renews an expired Gmail token from the refresh token of the linked account', async () => {
    await ComprasDatabase.linkGmail('co-expired', 'compras@empresa.com', 'gm-old', undefined, {
      googleAccountId: 'acct-9',
      tokenExpiresAt: Date.now() - 1000,
    });
    electronAPI.googleRefreshToken.mockResolvedValue({ accessToken: 'gm-new', scope: `openid ${GMAIL}`, expiresIn: 3600, accountId: 'acct-9' });

    await expect(getGmailAccessToken('co-expired')).resolves.toBe('gm-new');
    expect(electronAPI.googleRefreshToken).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'acct-9', scope: GMAIL }));
    const link = await ComprasDatabase.getLinkedGmail('co-expired');
    expect(link).toMatchObject({ accessToken: 'gm-new', googleAccountId: 'acct-9' });
    expect(link!.tokenExpiresAt).toBeGreaterThan(Date.now());
  });

  it('returns null for a legacy link that cannot be renewed (background sync must not prompt)', async () => {
    await ComprasDatabase.linkGmail('co-legacy', 'compras@empresa.com', 'gm-legacy');
    await expect(getGmailAccessToken('co-legacy')).resolves.toBeNull();
    expect(electronAPI.googleSignIn).not.toHaveBeenCalled();
  });

  it('rejects a link where the user did not grant Gmail access', async () => {
    electronAPI.googleSignIn.mockResolvedValue({ idToken: 'id', accessToken: 'tok', scope: 'openid email profile', expiresIn: 3600, accountId: 'acct-1' });
    await expect(linkGmailAccount('co-denied', { reauthorize: true })).rejects.toThrow(/Gmail/);
    await expect(ComprasDatabase.getLinkedGmail('co-denied')).resolves.toBeNull();
  });

  it("links with the app's session when it already carries Gmail access", async () => {
    seedSession({ sub: 'acct-1', email: 'owner@gmail.com', token: 'tok-gmail', expiresAt: Date.now() + HOUR, scopes: `openid email profile ${GMAIL}` });
    await expect(linkGmailAccount('co-session')).resolves.toEqual({ email: 'owner@gmail.com', accessToken: 'tok-gmail' });
    expect(electronAPI.googleSignIn).not.toHaveBeenCalled();
    await expect(ComprasDatabase.getLinkedGmail('co-session')).resolves.toMatchObject({ googleAccountId: 'acct-1' });
  });
});

describe('GoogleAuthService.getFreshIdToken (N1CO endpoints authenticate with Google)', () => {
  const jwt = (secondsFromNow: number, tag = 'x') => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `${b64({ alg: 'RS256' })}.${b64({ sub: 'acct-1', tag, exp: Math.floor(Date.now() / 1000) + secondsFromNow })}.sig`;
  };

  it('returns a Google id_token with time left as is', async () => {
    seedSession({});
    const fresh = jwt(50 * 60);
    storageMap.set('google_id_token', fresh);

    expect(await GoogleAuthService.getFreshIdToken()).toBe(fresh);
    expect(electronAPI.googleRefreshToken).not.toHaveBeenCalled();
  });

  it('renews an id_token about to expire with the main-process refresh token', async () => {
    seedSession({});
    storageMap.set('google_id_token', jwt(60, 'old'));
    const renewed = jwt(3600, 'new');
    electronAPI.googleRefreshToken.mockResolvedValue({ accessToken: 'tok-new', expiresIn: 3599, scope: 'openid email profile', idToken: renewed });

    expect(await GoogleAuthService.getFreshIdToken()).toBe(renewed);
    expect(electronAPI.googleRefreshToken).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'acct-1' }));
    expect(storageMap.get('google_id_token')).toBe(renewed);
  });

  it('passes non-JWT fixture tokens through and returns null without a session', async () => {
    storageMap.set('google_id_token', 'fake-id-token-for-testing');
    expect(await GoogleAuthService.getFreshIdToken()).toBe('fake-id-token-for-testing');
    storageMap.clear();
    expect(await GoogleAuthService.getFreshIdToken()).toBeNull();
  });
});
