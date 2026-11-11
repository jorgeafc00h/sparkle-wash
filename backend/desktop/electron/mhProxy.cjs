// mhProxy — the main-process half of `window.electronAPI.mhFetch`.
//
// MH DTE submission and /seguridad/auth go through the main process so the
// renderer isn't blocked by CORS. The destination is restricted to MH's DTE
// API hosts, /seguridad/auth and /fesv/*, POST only, three headers.
//
// Failures come back as { ok: false, status: 0, error, errorKind, errorCode }
// so the renderer's telemetry can tell a timeout from DNS / TLS / a refused
// connection. Nothing in a failure is ever derived from the request body —
// the auth body carries the NIT and the password — or the Authorization
// header.

'use strict';

const MH_HOSTS = new Set(['apitest.dtes.mh.gob.sv', 'api.dtes.mh.gob.sv']);
const AUTH_PATH = '/seguridad/auth';
const AUTH_TIMEOUT_MS = 30000;
// MH's test API can take 30-90 s under load; a stalled connection used to
// hang the renderer's submission forever.
const SUBMIT_TIMEOUT_MS = 300000;
const ALLOWED_HEADERS = new Set(['accept', 'authorization', 'content-type']);

function describeBudget(ms) {
  return ms >= 60000 ? `${Math.round(ms / 60000)} minutos` : `${Math.round(ms / 1000)} segundos`;
}

// Error codes worth naming (undici / Node net / TLS). Anything else is
// reported as 'network' with its code.
const NETWORK_KINDS = [
  [/^(ENOTFOUND|EAI_AGAIN)$/, 'dns'],
  [/^(ECONNREFUSED)$/, 'refused'],
  [/^(ECONNRESET|EPIPE|UND_ERR_SOCKET|UND_ERR_CLOSED)$/, 'reset'],
  [/^(ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT)$/, 'connect-timeout'],
  [/^(EHOSTUNREACH|ENETUNREACH|ENETDOWN)$/, 'unreachable'],
  [/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/i, 'tls'],
];

const SPANISH_KIND = {
  dns: 'no se pudo resolver el servidor de Hacienda (¿sin internet o DNS?)',
  refused: 'Hacienda rechazó la conexión',
  reset: 'la conexión con Hacienda se cortó',
  'connect-timeout': 'no se pudo conectar con Hacienda a tiempo',
  unreachable: 'no hay ruta de red hacia Hacienda',
  tls: 'falló la conexión segura (TLS) con Hacienda — revisa la fecha y hora del equipo',
  redirect: 'Hacienda respondió con una redirección; por seguridad no se siguió',
  network: 'error de red al contactar a Hacienda',
};

/**
 * Classifies a fetch() rejection. Only error names/codes and undici's own
 * cause message are used (e.g. "getaddrinfo ENOTFOUND api.dtes.mh.gob.sv"),
 * never anything from the request.
 */
function describeFetchFailure(err, timeoutMs) {
  if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return {
      error: `Hacienda no respondió en ${describeBudget(timeoutMs)}. Intenta de nuevo.`,
      errorKind: 'timeout',
      errorCode: `TIMEOUT_${Math.round(timeoutMs / 1000)}S`,
    };
  }
  const cause = err && err.cause;
  const causeMessage = String((cause && cause.message) || '');
  if (/redirect/i.test(causeMessage) || /redirect/i.test(String((err && err.message) || ''))) {
    return { error: SPANISH_KIND.redirect, errorKind: 'redirect', errorCode: 'REDIRECT' };
  }
  const code = String((cause && cause.code) || (err && err.code) || '');
  const kind = (NETWORK_KINDS.find(([re]) => re.test(code)) || [null, 'network'])[1];
  const detail = (causeMessage || String((err && err.message) || '')).replace(/\s+/g, ' ').trim().slice(0, 160);
  return {
    error: `${SPANISH_KIND[kind]}${code ? ` (${code})` : ''}${detail ? `: ${detail}` : ''}`,
    errorKind: kind,
    errorCode: code || undefined,
  };
}

function reject(error, errorKind = 'invalid') {
  return { ok: false, status: 0, error, errorKind };
}

/**
 * @param {object} config { url, method, headers, body } from the renderer.
 * @param {{ fetchImpl?: typeof fetch }} [deps] injectable for tests.
 */
async function mhFetch(config, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  if (!config || typeof config !== 'object') return reject('Configuración inválida');

  const { url, method = 'POST', headers = {}, body } = config;
  if (typeof url !== 'string') return reject('URL inválida');

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return reject('URL inválida');
  }
  if (parsed.protocol !== 'https:' || !MH_HOSTS.has(parsed.hostname) || parsed.port !== '') {
    return reject('Host no permitido', 'blocked');
  }
  const isAuth = parsed.pathname === AUTH_PATH;
  if (!isAuth && !parsed.pathname.startsWith('/fesv/')) return reject('Ruta MH no permitida', 'blocked');

  const normalizedMethod = String(method).toUpperCase();
  if (normalizedMethod !== 'POST') return reject('Método no permitido', 'blocked');

  const requestHeaders = {};
  if (headers && typeof headers === 'object') {
    for (const [name, value] of Object.entries(headers)) {
      if (ALLOWED_HEADERS.has(name.toLowerCase()) && typeof value === 'string') requestHeaders[name] = value;
    }
  }
  const has = (name) => Object.keys(requestHeaders).some((h) => h.toLowerCase() === name);
  if (!has('accept')) requestHeaders.Accept = 'application/json';
  if (!has('content-type')) requestHeaders['Content-Type'] = 'application/json';

  // Auth is a quick credentials check; DTE submission can take longer while
  // MH processes large documents under load.
  const timeoutMs = isAuth ? AUTH_TIMEOUT_MS : SUBMIT_TIMEOUT_MS;
  try {
    const response = await fetchImpl(url, {
      method: normalizedMethod,
      headers: requestHeaders,
      body: typeof body === 'string' ? body : JSON.stringify(body),
      // Never follow: a 307/308 would re-send the body (for auth: the NIT and
      // password) to wherever MH's response points, outside the allowlist.
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, body: text };
  } catch (err) {
    return { ok: false, status: 0, ...describeFetchFailure(err, timeoutMs) };
  }
}

module.exports = { mhFetch, describeFetchFailure, AUTH_TIMEOUT_MS, SUBMIT_TIMEOUT_MS };
