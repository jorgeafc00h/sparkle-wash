import { API_CONFIG, API_ENDPOINTS, getApiConfig } from '../../config/api';
import { isViteProduction } from '@/config/viteEnv';
import { appStorage } from '../storage/ElectronStorage';
import { jwtExpiresAt } from '@/utils/jwt';
import type { AuthProvider, AuthProviderLinkingState, User } from '../../types';
import GoogleAuthService, { type GoogleUser } from './GoogleAuthService';

type AuthApiUser = Partial<User> & {
  userId?: string;
  internalUserId?: string;
  name?: string;
  givenName?: string;
  familyName?: string;
  picture?: string;
  photoUrl?: string;
};

type AuthApiResponse = {
  requiresLinking?: boolean;
  message?: string;
  error?: string;
  token?: string;
  jwt?: string;
  accessToken?: string;
  appToken?: string;
  internalJwt?: string;
  /** Internal account id — Invoices.Api login answers `{ userId, internalJwt }` without a `user` object. */
  userId?: string;
  refreshToken?: string | null;
  user?: AuthApiUser;
  account?: AuthApiUser;
  provider?: AuthProvider;
  email?: string;
  linkToken?: string;
  providerLinkToken?: string;
  linkedProviders?: AuthProvider[];
  providers?: AuthProvider[];
  /** Sync tables (co{NIT}) already linked to the account — the relay authorizes on these. */
  companies?: string[];
};

export type AuthLoginResult =
  | {
      authenticated: true;
      user: User;
      token: string;
      refreshToken: string | null;
      linkedProviders: AuthProvider[];
      /** Companies (co{NIT} sync keys) the session carries, when the API reported them. */
      companies: string[];
    }
  | {
      authenticated: false;
      requiresLinking: true;
      providerLinking: AuthProviderLinkingState;
    };

export interface AuthSession {
  user: User;
  token: string;
  refreshToken: string | null;
  linkedProviders: AuthProvider[];
}

const STORAGE_KEYS = {
  TOKEN: 'app_auth_token',
  REFRESH_TOKEN: 'app_auth_refresh_token',
  USER: 'app_auth_user',
  PROVIDERS: 'app_auth_linked_providers',
};

function isProduction(): boolean {
  return isViteProduction();
}

function getBaseUrl(): string {
  return getApiConfig(isProduction()).baseUrl;
}

function getTokenFromResponse(data: AuthApiResponse): string | null {
  // `internalJwt` is what Invoices.Api POST /api/auth/login actually returns; the
  // other names exist for the mocked e2e API and older shapes.
  return data.internalJwt ?? data.token ?? data.jwt ?? data.appToken ?? data.accessToken ?? null;
}

function getProviders(
  data: AuthApiResponse,
  fallback: AuthProvider,
  existingProviders: AuthProvider[] = [],
): AuthProvider[] {
  const providers = data.linkedProviders ?? data.providers ?? existingProviders;
  const normalized = providers.map((provider) => String(provider).toLowerCase());
  normalized.push(String(fallback).toLowerCase());
  return Array.from(new Set(normalized));
}

function splitName(name: string | undefined): { firstName: string; lastName: string } {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: 'Usuario', lastName: '' };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date();
}

function mapUser(apiUser: AuthApiUser | undefined, providerUser: GoogleUser): User {
  const displayName = apiUser?.name ?? providerUser.name;
  const split = splitName(displayName);

  return {
    id: String(
      apiUser?.id ??
        apiUser?.userId ??
        apiUser?.internalUserId ??
        providerUser.id,
    ),
    email: String(apiUser?.email ?? providerUser.email),
    firstName: String(apiUser?.firstName ?? apiUser?.givenName ?? split.firstName),
    lastName: String(apiUser?.lastName ?? apiUser?.familyName ?? split.lastName),
    avatar: apiUser?.avatar ?? apiUser?.picture ?? apiUser?.photoUrl ?? providerUser.picture,
    phone: apiUser?.phone,
    isEmailVerified: apiUser?.isEmailVerified ?? true,
    createdAt: toDate(apiUser?.createdAt),
    updatedAt: toDate(apiUser?.updatedAt),
  };
}

const AUTH_REQUEST_TIMEOUT_MS = 30_000;

async function postJson<T>(
  path: string,
  body: unknown,
  token?: string,
): Promise<{ ok: boolean; status: number; data: T }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apiKey: API_CONFIG.apiKey,
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${getBaseUrl()}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      // fetch() never times out on its own: a stalled API left the welcome
      // screen on "Iniciando sesión…" with every button disabled.
      signal: AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error('El servidor de Facturas Simples no respondió a tiempo. Intenta de nuevo en unos minutos.');
    }
    // fetch() rejects with an opaque TypeError ("Failed to fetch") when the API is
    // unreachable or the browser blocks the response (CORS) — never show that raw.
    throw new Error('No se pudo conectar con el servidor de Facturas Simples. Revisa tu conexión a internet e intenta de nuevo.');
  }

  const data = await response.json().catch(() => ({} as T));
  return { ok: response.ok, status: response.status, data: data as T };
}

function failureMessage(data: AuthApiResponse | string, status: number, fallback: string): string {
  // Invoices.Api answers some failures with a bare JSON string or an empty body.
  if (typeof data === 'string' && data.trim()) return data;
  if (data && typeof data === 'object' && (data.message ?? data.error)) return String(data.message ?? data.error);
  return status === 401 ? `${fallback}: la cuenta de Google no fue aceptada (HTTP 401)` : `${fallback} (HTTP ${status})`;
}

function buildProviderLinking(data: AuthApiResponse, provider: AuthProvider): AuthProviderLinkingState {
  return {
    required: true,
    provider: data.provider ?? provider,
    email: data.email ?? data.user?.email ?? data.account?.email,
    message:
      data.message ??
      'Esta cuenta de Google debe vincularse con una cuenta existente antes de continuar.',
    linkToken: data.linkToken ?? data.providerLinkToken,
  };
}

async function persistSession(session: AuthSession): Promise<void> {
  await Promise.all([
    appStorage.setItem(STORAGE_KEYS.TOKEN, session.token),
    session.refreshToken
      ? appStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, session.refreshToken)
      : appStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN),
    appStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(session.user)),
    appStorage.setItem(STORAGE_KEYS.PROVIDERS, JSON.stringify(session.linkedProviders)),
  ]);
}

function parseStoredUser(raw: string): User | null {
  try {
    const parsed = JSON.parse(raw) as User;
    return {
      ...parsed,
      createdAt: toDate(parsed.createdAt),
      updatedAt: toDate(parsed.updatedAt),
    };
  } catch {
    return null;
  }
}

// The internal JWT lives ≤ 24 h (Invoices.Api InternalJwtIssuer). Nothing renewed it,
// so a day after sign-in Device Sync, entitlements, the sync trial and company
// claims all failed until the user signed out and back in.
const SESSION_REFRESH_MARGIN_MS = 60 * 60 * 1000;
const MIN_REFRESHABLE_MS = 30 * 1000;

/** `exp` (ms) of a JWT, or null when the token is not a decodable JWT. */
export const sessionTokenExpiresAt = jwtExpiresAt;

const renewListeners = new Set<(token: string) => void>();
let renewal: Promise<string | null> | null = null;

async function renewSession(token: string, expiresAt: number): Promise<string | null> {
  // Still valid → re-mint from current membership/entitlements.
  if (expiresAt - Date.now() > MIN_REFRESHABLE_MS) {
    try {
      const { ok, data } = await postJson<AuthApiResponse>(API_ENDPOINTS.AUTH_REFRESH, {}, token);
      const fresh = ok ? getTokenFromResponse(data) : null;
      if (fresh) return fresh;
    } catch {
      // fall through to a provider re-login
    }
  }
  // Expired (or refresh refused) → log in again with a silently renewed Google id_token.
  try {
    const current = await GoogleAuthService.getCurrentUser();
    if (!current) return null;
    const refreshed = await GoogleAuthService.refreshAccount(current.id);
    if (!refreshed?.idToken) return null;
    const result = await AuthProviderService.loginWithGoogle({
      ...current,
      idToken: refreshed.idToken,
      accessToken: refreshed.accessToken,
    });
    return result.authenticated ? result.token : null;
  } catch {
    return null;
  }
}

const AuthProviderService = {
  async loginWithGoogle(googleUser: GoogleUser): Promise<AuthLoginResult> {
    // Invoices.Api binds the provider token as `token` (LoginRequest); ≤ 1.3.0
    // sent `idToken` and got 400 "provider and token are required".
    const { ok, status, data } = await postJson<AuthApiResponse>(API_ENDPOINTS.AUTH_LOGIN, {
      provider: 'google',
      token: googleUser.idToken,
    });

    if (data?.requiresLinking) {
      return {
        authenticated: false,
        requiresLinking: true,
        providerLinking: buildProviderLinking(data, 'google'),
      };
    }

    if (!ok) {
      throw new Error(failureMessage(data, status, 'No se pudo iniciar sesión'));
    }

    const token = getTokenFromResponse(data);
    if (!token) {
      throw new Error('El servidor no devolvió un token de sesión');
    }

    const session: AuthSession = {
      user: mapUser(data.user ?? data.account ?? (data.userId ? { userId: data.userId } : undefined), googleUser),
      token,
      refreshToken: data.refreshToken ?? null,
      linkedProviders: getProviders(data, 'google'),
    };

    await persistSession(session);
    return { authenticated: true, ...session, companies: data.companies ?? [] };
  },

  async linkGoogleProvider(googleUser: GoogleUser, token: string): Promise<AuthSession & { companies?: string[] }> {
    const { ok, status, data } = await postJson<AuthApiResponse>(
      API_ENDPOINTS.AUTH_PROVIDER_LINK,
      {
        provider: 'google',
        token: googleUser.idToken,
      },
      token,
    );

    if (!ok) {
      throw new Error(failureMessage(data, status, 'No se pudo vincular Google'));
    }

    const sessionToken = getTokenFromResponse(data) ?? token;
    const existingSession = await this.getSession();
    const session: AuthSession = {
      user: mapUser(data.user ?? data.account ?? existingSession?.user, googleUser),
      token: sessionToken,
      refreshToken: data.refreshToken ?? existingSession?.refreshToken ?? null,
      linkedProviders: getProviders(data, 'google', existingSession?.linkedProviders),
    };

    await persistSession(session);
    return { ...session, companies: data.companies ?? [] };
  },

  async getToken(): Promise<string | null> {
    return appStorage.getItem(STORAGE_KEYS.TOKEN);
  },

  /**
   * The internal JWT for an authenticated API call, renewed first when it has
   * less than an hour left (POST /api/auth/refresh) or has already expired
   * (silent Google re-login). `preferred` is the caller's in-memory token
   * (redux) — used when present. Concurrent callers share one renewal. Tokens
   * that are not decodable JWTs are returned unchanged.
   */
  async getFreshToken(preferred?: string | null): Promise<string | null> {
    const token = preferred ?? (await this.getToken());
    if (!token) return null;
    const expiresAt = sessionTokenExpiresAt(token);
    if (expiresAt === null || expiresAt - Date.now() > SESSION_REFRESH_MARGIN_MS) return token;

    if (!renewal) {
      renewal = renewSession(token, expiresAt)
        .then(async (fresh) => {
          if (!fresh) return null;
          await appStorage.setItem(STORAGE_KEYS.TOKEN, fresh);
          renewListeners.forEach((listener) => listener(fresh));
          return fresh;
        })
        .finally(() => {
          renewal = null;
        });
    }
    // A failed renewal keeps the old token — the API's 401 then surfaces as before.
    return (await renewal) ?? token;
  },

  /** Notified with every renewed internal JWT (keeps redux auth.token in sync). */
  onSessionTokenRenewed(listener: (token: string) => void): () => void {
    renewListeners.add(listener);
    return () => renewListeners.delete(listener);
  },

  /**
   * Replaces the stored internal JWT — e.g. the refreshed session POST
   * /api/auth/companies/claim returns after linking a company, which the sync
   * relay needs in the token's companies claim. Never logs the token.
   */
  async updateToken(token: string): Promise<void> {
    await appStorage.setItem(STORAGE_KEYS.TOKEN, token);
  },

  async getSession(): Promise<AuthSession | null> {
    const [token, refreshToken, rawUser, rawProviders] = await Promise.all([
      appStorage.getItem(STORAGE_KEYS.TOKEN),
      appStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN),
      appStorage.getItem(STORAGE_KEYS.USER),
      appStorage.getItem(STORAGE_KEYS.PROVIDERS),
    ]);
    if (!token || !rawUser) return null;

    const user = parseStoredUser(rawUser);
    if (!user) return null;

    let linkedProviders: AuthProvider[] = [];
    try {
      linkedProviders = rawProviders ? JSON.parse(rawProviders) as AuthProvider[] : [];
    } catch {
      linkedProviders = [];
    }

    return {
      user,
      token,
      refreshToken,
      linkedProviders,
    };
  },

  async clearSession(): Promise<void> {
    await Promise.all([
      appStorage.removeItem(STORAGE_KEYS.TOKEN),
      appStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN),
      appStorage.removeItem(STORAGE_KEYS.USER),
      appStorage.removeItem(STORAGE_KEYS.PROVIDERS),
    ]);
  },
};

export default AuthProviderService;
