// Google OAuth Service for Electron + Web
// Electron: the main process runs the system-browser loopback flow
//   (electron/googleOAuthService.cjs) and keeps refresh tokens in the keychain.
// Web/dev: uses window.open popup flow.
//
// Sign-in asks only for `openid email profile`. Drive and Gmail access are
// requested when the user first uses those features (getAccessTokenForScope),
// and expired access tokens are renewed with the stored refresh token.

import { appStorage } from '../storage/ElectronStorage';
import { getViteEnv } from '@/config/viteEnv';
import { jwtExpiresAt } from '@/utils/jwt';

export const GOOGLE_SCOPES = {
  DRIVE_FILE: 'https://www.googleapis.com/auth/drive.file',
  GMAIL_READONLY: 'https://www.googleapis.com/auth/gmail.readonly',
} as const;

export type GoogleApiScope = (typeof GOOGLE_SCOPES)[keyof typeof GOOGLE_SCOPES];

const BASE_SCOPES = ['openid', 'email', 'profile'];
// Sessions saved before scopes were requested on demand were granted
// Drive + Gmail at sign-in.
const LEGACY_GRANTED_SCOPES = [...BASE_SCOPES, GOOGLE_SCOPES.DRIVE_FILE, GOOGLE_SCOPES.GMAIL_READONLY];
// Renew a little before Google's expiry so a request never starts with a dying token.
const EXPIRY_MARGIN_MS = 60_000;

export interface GoogleUser {
  id: string;         // Google sub claim
  email: string;
  name: string;
  picture?: string;
  idToken: string;    // Google identity token exchanged with the app API
  accessToken: string; // For Google Drive API
}

export interface GoogleAuthorization {
  user: GoogleUser;
  accessToken: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
  grantedScopes: string[];
}

export interface RefreshedGoogleToken {
  accessToken: string;
  expiresAt: number;
  grantedScopes: string[];
  idToken?: string;
}

/** No usable token and the caller did not allow an interactive sign-in. */
export class GoogleAuthRequiredError extends Error {
  constructor(message = 'Tu sesión de Google expiró. Vuelve a conectar tu cuenta de Google.') {
    super(message);
    this.name = 'GoogleAuthRequiredError';
  }
}

const STORAGE_KEYS = {
  ACCESS_TOKEN: 'google_access_token',
  ID_TOKEN: 'google_id_token',
  USER: 'google_user',
  EXPIRES_AT: 'google_token_expires_at',
  GRANTED_SCOPES: 'google_granted_scopes',
};

const GOOGLE_OAUTH_ENDPOINTS = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  userInfo: 'https://www.googleapis.com/oauth2/v3/userinfo',
};

const SCOPE_DENIED_MESSAGES: Record<GoogleApiScope, string> = {
  [GOOGLE_SCOPES.DRIVE_FILE]:
    'No concediste acceso a Google Drive. Vuelve a intentarlo y marca la casilla de Drive en la pantalla de Google.',
  [GOOGLE_SCOPES.GMAIL_READONLY]:
    'No concediste acceso de lectura a Gmail. Vuelve a intentarlo y marca la casilla de Gmail en la pantalla de Google.',
};

function getCredentials(): { clientId: string; clientSecret: string } {
  const env = getViteEnv();
  return {
    clientId: env.VITE_GOOGLE_CLIENT_ID ?? '',
    clientSecret: env.VITE_GOOGLE_CLIENT_SECRET ?? '',
  };
}

function getRedirectUri(): string {
  // Web popup flow only — the Electron flow picks its own loopback port.
  return getViteEnv().VITE_GOOGLE_REDIRECT_URI ?? 'http://localhost:5173/auth/callback';
}

function electronApi(): Window['electronAPI'] {
  return typeof window !== 'undefined' ? window.electronAPI : undefined;
}

function parseScopes(scope: string | null | undefined): string[] {
  return (scope ?? '').split(/\s+/).filter(Boolean);
}

const API_SCOPES = new Set<string>(Object.values(GOOGLE_SCOPES));

/** Drive/Gmail scopes present in a granted set (Google reports email/profile as userinfo.* URLs). */
function apiScopes(granted: string[]): GoogleApiScope[] {
  return granted.filter((s): s is GoogleApiScope => API_SCOPES.has(s));
}

function expiresAtFrom(expiresInSeconds: number | undefined): number {
  return Date.now() + (Number(expiresInSeconds) || 3600) * 1000;
}

function isFresh(expiresAt: number): boolean {
  return expiresAt - EXPIRY_MARGIN_MS > Date.now();
}

// ── Pending interactive flow (the user is in the system browser) ─────────

type PendingListener = (pending: boolean) => void;
const pendingListeners = new Set<PendingListener>();
let signInPending = false;

function setPending(pending: boolean): void {
  signInPending = pending;
  pendingListeners.forEach((listener) => listener(pending));
}

// ── Web popup flow (development / browser) ────────────────────────────────

async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hash);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomBase64Url(byteLen: number): string {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function openWebPopup(scopes: string[], loginHint?: string): Promise<{ code: string; codeVerifier: string }> {
  const codeVerifier = randomBase64Url(32);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  return new Promise((resolve, reject) => {
    const state = crypto.randomUUID();
    const params = new URLSearchParams({
      client_id: getCredentials().clientId,
      redirect_uri: getRedirectUri(),
      response_type: 'code',
      scope: scopes.join(' '),
      access_type: 'offline',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    if (loginHint) params.set('login_hint', loginHint);

    const authUrl = `${GOOGLE_OAUTH_ENDPOINTS.auth}?${params.toString()}`;
    const popup = window.open(authUrl, 'google-auth', 'width=500,height=650,centerscreen=yes');

    if (!popup) {
      reject(new Error('No se pudo abrir la ventana de autenticación. Revisa el bloqueador de popups.'));
      return;
    }

    const messageHandler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'GOOGLE_AUTH_CODE' && event.data?.state === state) {
        cleanup();
        resolve({ code: event.data.code as string, codeVerifier });
      } else if (event.data?.type === 'GOOGLE_AUTH_ERROR') {
        cleanup();
        reject(new Error(event.data.error ?? 'Error en autenticación de Google'));
      }
    };

    const pollTimer = setInterval(() => {
      if (popup.closed) {
        cleanup();
        reject(new Error('Autenticación cancelada'));
      }
    }, 500);

    function cleanup() {
      clearInterval(pollTimer);
      window.removeEventListener('message', messageHandler);
    }

    window.addEventListener('message', messageHandler);
  });
}

interface FlowTokens {
  idToken: string;
  accessToken: string;
  grantedScopes: string[];
  expiresAt: number;
}

async function exchangeCodeForTokens(code: string, codeVerifier: string, requested: string[]): Promise<FlowTokens> {
  const { clientId, clientSecret } = getCredentials();
  const resp = await fetch(GOOGLE_OAUTH_ENDPOINTS.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      // Google's token endpoint rejects the exchange without the secret,
      // even with PKCE ("client_secret is missing").
      client_secret: clientSecret,
      code_verifier: codeVerifier,
      redirect_uri: getRedirectUri(),
      grant_type: 'authorization_code',
    }).toString(),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as { error_description?: string }).error_description ?? 'Error al obtener tokens de Google');
  }

  const data = await resp.json() as { id_token: string; access_token: string; scope?: string; expires_in?: number };
  return {
    idToken: data.id_token,
    accessToken: data.access_token,
    grantedScopes: data.scope ? parseScopes(data.scope) : requested,
    expiresAt: expiresAtFrom(data.expires_in),
  };
}

async function runInteractiveFlow(scopes: string[], loginHint?: string): Promise<FlowTokens> {
  const api = electronApi();
  if (api?.googleSignIn) {
    // Client credentials are passed because process.env.VITE_* is not
    // available in the packaged Electron main process.
    setPending(true);
    try {
      const result = await api.googleSignIn({ ...getCredentials(), scopes, loginHint });
      if (!result || 'error' in result) {
        throw new Error(result?.error ?? 'Google Sign-In cancelado');
      }
      if (!result.idToken) throw new Error('Google no devolvió id_token');
      return {
        idToken: result.idToken,
        accessToken: result.accessToken,
        grantedScopes: parseScopes(result.scope),
        expiresAt: expiresAtFrom(result.expiresIn),
      };
    } finally {
      setPending(false);
    }
  }

  const requested = [...BASE_SCOPES, ...scopes];
  const { code, codeVerifier } = await openWebPopup(requested, loginHint);
  return exchangeCodeForTokens(code, codeVerifier, requested);
}

async function fetchUserInfo(accessToken: string): Promise<{ sub: string; email: string; name: string; picture?: string }> {
  const resp = await fetch(GOOGLE_OAUTH_ENDPOINTS.userInfo, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) throw new Error('Error al obtener información del usuario de Google');
  return resp.json() as Promise<{ sub: string; email: string; name: string; picture?: string }>;
}

// ── Session persistence ───────────────────────────────────────────────────

async function saveSession(auth: GoogleAuthorization): Promise<void> {
  await appStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, auth.accessToken);
  await appStorage.setItem(STORAGE_KEYS.ID_TOKEN, auth.user.idToken);
  await appStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(auth.user));
  await appStorage.setItem(STORAGE_KEYS.EXPIRES_AT, String(auth.expiresAt));
  await appStorage.setItem(STORAGE_KEYS.GRANTED_SCOPES, auth.grantedScopes.join(' '));
}

async function loadSession(): Promise<GoogleAuthorization | null> {
  const user = await GoogleAuthService.getCurrentUser();
  const accessToken = await appStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
  if (!user || !accessToken) return null;
  const expiresAt = Number(await appStorage.getItem(STORAGE_KEYS.EXPIRES_AT)) || 0;
  const scopes = await appStorage.getItem(STORAGE_KEYS.GRANTED_SCOPES);
  return {
    user,
    accessToken,
    expiresAt,
    grantedScopes: scopes ? parseScopes(scopes) : LEGACY_GRANTED_SCOPES,
  };
}

// ── Public API ────────────────────────────────────────────────────────────

const GoogleAuthService = {
  /**
   * Runs the interactive Google flow for `openid email profile` plus `scopes`.
   * `updateSession: 'same-account'` leaves the app's Google session alone when
   * the user authorizes a different account (e.g. a company's Gmail inbox);
   * `'never'` only proves an identity (the local-users lock screen) and never
   * replaces the app's Google session.
   */
  async authorize(options: {
    scopes?: GoogleApiScope[];
    loginHint?: string;
    updateSession?: 'always' | 'same-account' | 'never';
  } = {}): Promise<GoogleAuthorization> {
    const scopes = Array.from(new Set(options.scopes ?? []));
    const tokens = await runInteractiveFlow(scopes, options.loginHint);
    const userInfo = await fetchUserInfo(tokens.accessToken);

    const auth: GoogleAuthorization = {
      user: {
        id: userInfo.sub,
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture,
        idToken: tokens.idToken,
        accessToken: tokens.accessToken,
      },
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt,
      grantedScopes: tokens.grantedScopes,
    };

    const current = await GoogleAuthService.getCurrentUser();
    if (
      options.updateSession !== 'never' &&
      (options.updateSession !== 'same-account' || !current || current.id === auth.user.id)
    ) {
      await saveSession(auth);
    }
    return auth;
  },

  /**
   * Signs in with Google (identity scopes only unless `scopes` is given).
   * In Electron the consent page opens in the system browser.
   */
  async signIn(options: { scopes?: GoogleApiScope[]; loginHint?: string } = {}): Promise<GoogleUser> {
    return (await GoogleAuthService.authorize(options)).user;
  },

  /**
   * Renews an access token from the refresh token the main process keeps for
   * `accountId`. Returns null when there is nothing to refresh (web build,
   * revoked/expired grant, no stored authorization).
   */
  async refreshAccount(accountId: string, scope?: GoogleApiScope): Promise<RefreshedGoogleToken | null> {
    const api = electronApi();
    if (!api?.googleRefreshToken || !accountId) return null;
    const result = await api.googleRefreshToken({ ...getCredentials(), accountId, scope });
    if (!result || 'error' in result) return null;

    const refreshed: RefreshedGoogleToken = {
      accessToken: result.accessToken,
      expiresAt: expiresAtFrom(result.expiresIn),
      grantedScopes: parseScopes(result.scope),
      idToken: result.idToken,
    };
    const session = await loadSession();
    if (session && session.user.id === accountId) {
      await saveSession({
        user: { ...session.user, accessToken: refreshed.accessToken, idToken: refreshed.idToken ?? session.user.idToken },
        accessToken: refreshed.accessToken,
        expiresAt: refreshed.expiresAt,
        grantedScopes: refreshed.grantedScopes,
      });
    }
    return refreshed;
  },

  /**
   * A valid access token for the signed-in account that carries `scope`:
   * cached token → refresh token → (interactive only) a new consent that adds
   * the scope. Throws GoogleAuthRequiredError when not interactive and no
   * token can be produced, or an Error when the user declines the scope.
   */
  async getAccessTokenForScope(
    scope?: GoogleApiScope,
    options: { interactive?: boolean } = {},
  ): Promise<string> {
    const session = await loadSession();
    const carries = (granted: string[]) => !scope || granted.includes(scope);

    if (session) {
      if (carries(session.grantedScopes) && isFresh(session.expiresAt)) return session.accessToken;
      const refreshed = await GoogleAuthService.refreshAccount(session.user.id, scope);
      if (refreshed && carries(refreshed.grantedScopes)) return refreshed.accessToken;
    }

    if (!options.interactive) throw new GoogleAuthRequiredError();

    // Installed apps can't use incremental auth: ask again for everything the
    // session already had plus the new scope.
    const scopes = Array.from(new Set([...apiScopes(session?.grantedScopes ?? []), ...(scope ? [scope] : [])]));
    const auth = await GoogleAuthService.authorize({ scopes, loginHint: session?.user.email });
    if (scope && !auth.grantedScopes.includes(scope)) throw new Error(SCOPE_DENIED_MESSAGES[scope]);
    return auth.accessToken;
  },

  /**
   * Clears the local Google session. `revoke` (explicit app logout) also
   * revokes the grant at Google and forgets the account's refresh tokens —
   * a company Gmail inbox linked with the same account must then reconnect.
   */
  async signOut(options: { revoke?: boolean } = {}): Promise<void> {
    if (options.revoke) {
      const user = await GoogleAuthService.getCurrentUser();
      const api = electronApi();
      if (user?.id && api?.googleSignOut) {
        try {
          await api.googleSignOut({ accountId: user.id, revoke: true });
        } catch (error) {
          console.warn('Google token revocation failed:', error);
        }
      }
    }
    await appStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
    await appStorage.removeItem(STORAGE_KEYS.ID_TOKEN);
    await appStorage.removeItem(STORAGE_KEYS.USER);
    await appStorage.removeItem(STORAGE_KEYS.EXPIRES_AT);
    await appStorage.removeItem(STORAGE_KEYS.GRANTED_SCOPES);
  },

  /** The app's Google session with token expiry and granted scopes. */
  async getSession(): Promise<GoogleAuthorization | null> {
    return loadSession();
  },

  /** The stored access token, which may be expired — prefer getAccessTokenForScope. */
  async getAccessToken(): Promise<string | null> {
    return appStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
  },

  async getIdToken(): Promise<string | null> {
    return appStorage.getItem(STORAGE_KEYS.ID_TOKEN);
  },

  /**
   * A Google id_token for endpoints that authenticate with GOOGLE itself
   * (Invoices.Api /subscription/n1co/* — GoogleAuthEndpointFilter), not with
   * the internal session JWT. Google id_tokens live 1 h: one with < 5 min left
   * is renewed with the main-process refresh token. Tokens that are not
   * decodable JWTs (e2e fixtures) are returned unchanged.
   */
  async getFreshIdToken(): Promise<string | null> {
    const idToken = await GoogleAuthService.getIdToken();
    if (!idToken) return null;
    const expiresAt = jwtExpiresAt(idToken);
    if (expiresAt === null || expiresAt - Date.now() > 5 * 60_000) return idToken;
    const user = await GoogleAuthService.getCurrentUser();
    if (!user) return idToken;
    try {
      const refreshed = await GoogleAuthService.refreshAccount(user.id);
      return refreshed?.idToken ?? idToken;
    } catch {
      return idToken;
    }
  },

  async isSignedIn(): Promise<boolean> {
    return !!(await appStorage.getItem(STORAGE_KEYS.ID_TOKEN));
  },

  async getCurrentUser(): Promise<GoogleUser | null> {
    const raw = await appStorage.getItem(STORAGE_KEYS.USER);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as GoogleUser;
    } catch {
      return null;
    }
  },

  /** True while the user is completing sign-in in the system browser. */
  isSignInPending(): boolean {
    return signInPending;
  },

  onSignInPendingChange(listener: PendingListener): () => void {
    pendingListeners.add(listener);
    return () => {
      pendingListeners.delete(listener);
    };
  },

  async cancelPendingSignIn(): Promise<void> {
    await electronApi()?.googleCancelSignIn?.();
  },

  async reopenPendingSignIn(): Promise<void> {
    await electronApi()?.googleReopenSignIn?.();
  },
};

export default GoogleAuthService;
