// googleOAuthService — Electron main-process Google OAuth for installed apps.
//
// Follows Google's "OAuth 2.0 for iOS & Desktop Apps" guidance:
//   • the consent page opens in the user's SYSTEM browser (shell.openExternal) —
//     Google's policy disallows OAuth inside embedded webviews (BrowserWindow);
//   • the redirect is a loopback listener on 127.0.0.1 with a RANDOM free port
//     (Desktop-type clients accept any loopback port);
//   • PKCE (S256) AND the client secret are both sent in the code exchange.
//     Google treats a Desktop client's secret as non-confidential, but its
//     token endpoint still rejects a code exchange without it
//     ("client_secret is missing") — dropping it broke every sign-in.
//
// Refresh tokens never leave the main process: they are kept in the
// safeStorage-backed secret store, keyed by the Google account id (`sub`),
// one entry per granted scope set (signing in with fewer scopes must not
// clobber a refresh token that still carries Gmail/Drive access).

'use strict';

const http = require('http');
const crypto = require('crypto');

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

const BASE_SCOPES = ['openid', 'email', 'profile'];
const ALLOWED_SCOPES = new Set([
  ...BASE_SCOPES,
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/gmail.readonly',
]);
const VALID_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 300;
const LOOPBACK_HOST = '127.0.0.1';
const CALLBACK_PATH = '/auth/callback';
const REFRESH_SERVICE = 'google-oauth';
const MAX_REFRESH_ENTRIES = 4;
const ACCOUNT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

const CANCELLED_ERROR = 'Autenticación cancelada';

// ── Pure helpers (exported for tests) ─────────────────────────────────────

function parseScopeString(scope) {
  if (typeof scope !== 'string') return [];
  return scope.split(/\s+/).filter(Boolean);
}

/** Base scopes + the requested allow-listed extras, de-duplicated. */
function normalizeScopes(requested) {
  const extras = Array.isArray(requested) ? requested : parseScopeString(requested);
  const out = [...BASE_SCOPES];
  for (const s of extras) {
    if (ALLOWED_SCOPES.has(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

function base64UrlJson(segment) {
  return JSON.parse(Buffer.from(String(segment), 'base64url').toString('utf8'));
}

function decodeIdTokenPayload(idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('id_token mal formado');
  return base64UrlJson(parts[1]);
}

/**
 * Claim checks for an id_token received directly from Google's token endpoint
 * over TLS (OIDC Core §3.1.3.7 allows skipping the signature in that case).
 * Returns an error message, or null when the claims are acceptable.
 */
function validateIdTokenClaims(payload, { clientId, nonce, nowSeconds }) {
  if (!payload || typeof payload !== 'object') return 'id_token sin contenido';
  if (!VALID_ISSUERS.has(payload.iss)) return 'Emisor de id_token inválido';
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(clientId)) return 'Audiencia de id_token inválida';
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_SECONDS < now) return 'id_token expirado';
  if (nonce !== undefined && payload.nonce !== nonce) return 'Nonce inválido en id_token';
  if (!payload.sub) return 'id_token sin identificador de cuenta';
  return null;
}

/** Adds a refresh token, dropping entries whose scopes it fully covers. */
function mergeRefreshEntries(entries, entry) {
  const covered = (e) => e.scopes.every((s) => entry.scopes.includes(s));
  const kept = (Array.isArray(entries) ? entries : []).filter((e) => e && !covered(e));
  return [entry, ...kept].slice(0, MAX_REFRESH_ENTRIES);
}

/** Newest entry that carries `requiredScope` (any entry when none is required). */
function pickRefreshEntry(entries, requiredScope) {
  const list = Array.isArray(entries) ? entries : [];
  if (!requiredScope) return list[0] ?? null;
  return list.find((e) => Array.isArray(e.scopes) && e.scopes.includes(requiredScope)) ?? null;
}

function buildAuthUrl({ clientId, redirectUri, scopes, state, nonce, codeChallenge, loginHint }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    // consent → Google issues a refresh token for this grant every time;
    // select_account → the user can switch accounts.
    prompt: 'select_account consent',
  });
  if (loginHint) params.set('login_hint', loginHint);
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

function mapAuthorizationError(error) {
  if (error === 'access_denied') return CANCELLED_ERROR;
  return `Google rechazó la autorización (${error})`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function callbackPage(ok, message) {
  const title = ok ? 'Sesión iniciada' : 'No se pudo iniciar sesión';
  const color = ok ? '#15803d' : '#b91c1c';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Car Spa</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;text-align:center;padding:48px;color:#1f2937">
<h2 style="color:${color}">${escapeHtml(title)}</h2>
<p>${escapeHtml(message)}</p>
<p style="color:#6b7280">Puedes cerrar esta pestaña y volver a Car Spa.</p>
</body></html>`;
}

// ── Service ───────────────────────────────────────────────────────────────

/**
 * @param {object} deps
 * @param {(url: string) => Promise<void>} deps.openExternal  opens the system browser
 * @param {{ get(service: string, account: string): string|null, set(service: string, account: string, value: string): boolean, delete(service: string, account: string): void }} deps.secrets
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {(...args: unknown[]) => void} [deps.log]
 * @param {() => void} [deps.onBrowserReturned]  called when Google redirects back (focus the app)
 * @param {number} [deps.timeoutMs]
 */
function createGoogleOAuthService(deps) {
  const {
    openExternal,
    secrets,
    // Resolved per call so an Electron e2e can stand in for Google's endpoints.
    fetchImpl = (...args) => globalThis.fetch(...args),
    log = () => {},
    onBrowserReturned = () => {},
    timeoutMs = SIGN_IN_TIMEOUT_MS,
  } = deps;

  /** @type {{ authUrl: string|null, finish: (result: object) => void } | null} */
  let pending = null;

  function loadRefreshEntries(accountId) {
    try {
      const raw = secrets.get(REFRESH_SERVICE, `refresh:${accountId}`);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveRefreshEntries(accountId, entries) {
    if (entries.length === 0) {
      secrets.delete(REFRESH_SERVICE, `refresh:${accountId}`);
    } else {
      secrets.set(REFRESH_SERVICE, `refresh:${accountId}`, JSON.stringify(entries));
    }
  }

  async function postForm(url, fields) {
    const resp = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    });
    const data = await resp.json().catch(() => ({}));
    return { ok: resp.ok, status: resp.status, data };
  }

  function signIn(options) {
    const { clientId, clientSecret, scopes, loginHint } = options || {};
    if (!clientId) return Promise.resolve({ error: 'VITE_GOOGLE_CLIENT_ID no configurado' });
    if (!clientSecret) return Promise.resolve({ error: 'VITE_GOOGLE_CLIENT_SECRET no configurado' });

    // One interactive flow at a time — a new attempt supersedes the old one.
    if (pending) pending.finish({ error: CANCELLED_ERROR });

    const requestedScopes = normalizeScopes(scopes);
    const state = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      let redirectUri = '';
      const flow = { authUrl: null, finish: null };

      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (pending === flow) pending = null;
        server.close();
        resolve(result);
      };
      flow.finish = finish;

      const server = http.createServer(async (req, res) => {
        const reqUrl = new URL(req.url || '/', `http://${LOOPBACK_HOST}`);
        if (reqUrl.pathname !== CALLBACK_PATH) {
          res.writeHead(404, { Connection: 'close' });
          res.end();
          return;
        }
        const respond = (status, ok, message) => {
          res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
          res.end(callbackPage(ok, message));
        };
        // A request without our state did not come from this flow — ignore it
        // instead of letting any local process cancel the sign-in.
        if (settled || reqUrl.searchParams.get('state') !== state) {
          respond(400, false, 'Solicitud de autenticación no reconocida.');
          return;
        }
        onBrowserReturned();

        const error = reqUrl.searchParams.get('error');
        const code = reqUrl.searchParams.get('code');
        if (error || !code) {
          const message = error ? mapAuthorizationError(error) : 'Google no devolvió un código de autorización';
          respond(200, false, message);
          finish({ error: message });
          return;
        }

        try {
          const { ok, data } = await postForm(TOKEN_ENDPOINT, {
            code,
            client_id: clientId,
            client_secret: clientSecret,
            code_verifier: codeVerifier,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          });
          if (!ok) {
            const message = data.error_description || data.error || 'Error al obtener tokens de Google';
            log('Google OAuth token exchange failed:', data.error, data.error_description);
            respond(200, false, message);
            finish({ error: message });
            return;
          }
          if (!data.id_token || !data.access_token) {
            respond(200, false, 'Respuesta incompleta de Google.');
            finish({ error: 'Google no devolvió id_token' });
            return;
          }

          let payload;
          try {
            payload = decodeIdTokenPayload(data.id_token);
          } catch {
            payload = null;
          }
          const claimError = validateIdTokenClaims(payload, { clientId, nonce });
          if (claimError) {
            respond(200, false, claimError);
            finish({ error: claimError });
            return;
          }

          const grantedScopes = data.scope ? parseScopeString(data.scope) : requestedScopes;
          if (data.refresh_token) {
            saveRefreshEntries(
              payload.sub,
              mergeRefreshEntries(loadRefreshEntries(payload.sub), {
                scopes: grantedScopes,
                token: data.refresh_token,
                createdAt: new Date().toISOString(),
              }),
            );
          }
          log('Google OAuth scopes granted:', grantedScopes.join(' '));
          respond(200, true, `Conectado como ${payload.email || 'tu cuenta de Google'}.`);
          finish({
            idToken: data.id_token,
            accessToken: data.access_token,
            scope: grantedScopes.join(' '),
            expiresIn: Number(data.expires_in) || 3600,
            accountId: payload.sub,
            email: payload.email,
          });
        } catch (err) {
          respond(200, false, 'Error de red al contactar a Google.');
          finish({ error: (err && err.message) || 'Error de red al obtener tokens' });
        }
      });

      server.on('error', (err) => {
        log('OAuth server error:', err.message);
        finish({ error: 'No se pudo iniciar el servidor de autenticación: ' + err.message });
      });

      server.listen(0, LOOPBACK_HOST, async () => {
        const { port } = server.address();
        redirectUri = `http://${LOOPBACK_HOST}:${port}${CALLBACK_PATH}`;
        flow.authUrl = buildAuthUrl({
          clientId,
          redirectUri,
          scopes: requestedScopes,
          state,
          nonce,
          codeChallenge,
          loginHint,
        });
        pending = flow;
        timer = setTimeout(
          () => finish({ error: 'Tiempo de espera agotado. Vuelve a intentar el inicio de sesión con Google.' }),
          timeoutMs,
        );
        log('Google OAuth: opening system browser, callback on port', port);
        try {
          await openExternal(flow.authUrl);
        } catch (err) {
          finish({ error: 'No se pudo abrir el navegador: ' + ((err && err.message) || err) });
        }
      });
    });
  }

  function cancel() {
    if (!pending) return false;
    pending.finish({ error: CANCELLED_ERROR });
    return true;
  }

  async function reopen() {
    if (!pending || !pending.authUrl) return false;
    await openExternal(pending.authUrl);
    return true;
  }

  async function refresh(options) {
    const { clientId, clientSecret, accountId, scope } = options || {};
    if (!clientId || !clientSecret) return { error: 'Credenciales OAuth no configuradas' };
    if (typeof accountId !== 'string' || !ACCOUNT_ID_RE.test(accountId)) {
      return { error: 'Cuenta de Google inválida', reauthRequired: true };
    }
    const entries = loadRefreshEntries(accountId);
    const entry = pickRefreshEntry(entries, scope);
    if (!entry) return { error: 'No hay una autorización guardada para esta cuenta', reauthRequired: true };

    try {
      const { ok, data } = await postForm(TOKEN_ENDPOINT, {
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: entry.token,
        grant_type: 'refresh_token',
      });
      if (!ok) {
        if (data.error === 'invalid_grant') {
          // Revoked, expired (Testing-mode apps: 7 days) or password changed.
          saveRefreshEntries(accountId, entries.filter((e) => e !== entry));
          return { error: 'La autorización de Google expiró o fue revocada', reauthRequired: true };
        }
        return { error: data.error_description || data.error || 'No se pudo renovar el acceso de Google' };
      }
      return {
        accessToken: data.access_token,
        idToken: data.id_token,
        scope: data.scope || entry.scopes.join(' '),
        expiresIn: Number(data.expires_in) || 3600,
        accountId,
      };
    } catch (err) {
      return { error: (err && err.message) || 'Error de red al renovar el acceso de Google' };
    }
  }

  /** Forgets (and optionally revokes at Google) the account's refresh tokens. */
  async function signOut(options) {
    const { accountId, revoke } = options || {};
    if (typeof accountId !== 'string' || !ACCOUNT_ID_RE.test(accountId)) return { success: true };
    const entries = loadRefreshEntries(accountId);
    if (revoke) {
      await Promise.all(
        entries.map((e) =>
          postForm(REVOKE_ENDPOINT, { token: e.token }).catch((err) => log('Google token revoke failed:', err.message)),
        ),
      );
    }
    saveRefreshEntries(accountId, []);
    return { success: true };
  }

  return { signIn, cancel, reopen, refresh, signOut, isPending: () => !!pending };
}

module.exports = {
  createGoogleOAuthService,
  normalizeScopes,
  parseScopeString,
  decodeIdTokenPayload,
  validateIdTokenClaims,
  mergeRefreshEntries,
  pickRefreshEntry,
  buildAuthUrl,
  CANCELLED_ERROR,
};
