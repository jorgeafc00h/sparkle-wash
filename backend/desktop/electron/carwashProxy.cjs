// carwashProxy — main-process half of `window.electronAPI.carwashFetch` and the
// SSE bridge (`carwashEventsStart/Stop`). The renderer origin (app://dist) cannot
// call the SparkleWash API directly (CORS), so requests go through here.
//
// The main process keeps no secrets: the bearer token is passed per call and
// never logged or echoed in errors. Only /api/ paths on http(s) origins.

'use strict';

const DEFAULT_TIMEOUT_MS = 20000;
const MAX_TIMEOUT_MS = 120000;
const MAX_REQUEST_BYTES = 1024 * 1024; // 1 MB request body
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024; // 8 MB response body
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const ALLOWED_HEADERS = new Set(['accept', 'authorization', 'content-type', 'idempotency-key']);

function reject(error, errorKind = 'invalid') {
  return { ok: false, status: 0, headers: {}, body: '', error, errorKind };
}

/** Returns a normalized origin ("http://host:port") or null when not a plain http(s) origin. */
function parseBaseUrl(baseUrl) {
  if (typeof baseUrl !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  return parsed.origin;
}

function buildUrl(baseUrl, path) {
  const origin = parseBaseUrl(baseUrl);
  if (!origin) return { error: 'URL del servidor inválida' };
  if (typeof path !== 'string' || !path.startsWith('/api/') || path.includes('..') || path.includes('\\') || /[\r\n]/.test(path)) {
    return { error: 'Ruta no permitida' };
  }
  return { url: origin + path };
}

function pickHeaders(headers) {
  const out = {};
  if (headers && typeof headers === 'object') {
    for (const [name, value] of Object.entries(headers)) {
      if (ALLOWED_HEADERS.has(name.toLowerCase()) && typeof value === 'string' && !/[\r\n]/.test(value)) out[name] = value;
    }
  }
  return out;
}

function describeFailure(err, timeoutMs) {
  if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return { error: `El servidor no respondió en ${Math.round(timeoutMs / 1000)} segundos`, errorKind: 'timeout' };
  }
  const cause = err && err.cause;
  const code = String((cause && cause.code) || (err && err.code) || '');
  const detail = String((cause && cause.message) || (err && err.message) || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  return { error: `Error de red${code ? ` (${code})` : ''}${detail ? `: ${detail}` : ''}`, errorKind: 'network' };
}

/** Reads a response body up to `limit` bytes; returns null when exceeded. */
async function readCapped(response, limit) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    return Buffer.byteLength(text) > limit ? null : text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      try { await reader.cancel(); } catch { /* ignore */ }
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * @param {{ baseUrl: string, path: string, method?: string, headers?: object, body?: string, timeoutMs?: number }} config
 * @param {{ fetchImpl?: typeof fetch }} [deps]
 * @returns {Promise<{ ok: boolean, status: number, headers: Record<string,string>, body: string, error?: string, errorKind?: string }>}
 */
async function carwashFetch(config, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  if (!config || typeof config !== 'object') return reject('Configuración inválida');
  const { baseUrl, path, headers, body } = config;
  const method = String(config.method || 'GET').toUpperCase();
  if (!ALLOWED_METHODS.has(method)) return reject('Método no permitido', 'blocked');
  const built = buildUrl(baseUrl, path);
  if (built.error) return reject(built.error, 'blocked');
  if (body !== undefined && body !== null && typeof body !== 'string') return reject('Cuerpo inválido');
  if (typeof body === 'string' && Buffer.byteLength(body) > MAX_REQUEST_BYTES) return reject('Solicitud demasiado grande', 'blocked');
  const requested = Number(config.timeoutMs);
  const timeoutMs = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;

  const requestHeaders = pickHeaders(headers);
  if (!Object.keys(requestHeaders).some((h) => h.toLowerCase() === 'accept')) requestHeaders.Accept = 'application/json';
  if (typeof body === 'string' && !Object.keys(requestHeaders).some((h) => h.toLowerCase() === 'content-type')) {
    requestHeaders['Content-Type'] = 'application/json';
  }

  try {
    const response = await fetchImpl(built.url, {
      method,
      headers: requestHeaders,
      body: typeof body === 'string' && method !== 'GET' ? body : undefined,
      redirect: 'error', // never replay a bearer token to a redirect target
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await readCapped(response, MAX_RESPONSE_BYTES);
    if (text === null) return { ok: false, status: response.status, headers: {}, body: '', error: 'Respuesta demasiado grande', errorKind: 'blocked' };
    const outHeaders = {};
    response.headers.forEach((value, name) => { outHeaders[name] = value; });
    return { ok: response.ok, status: response.status, headers: outHeaders, body: text };
  } catch (err) {
    return { ok: false, status: 0, headers: {}, body: '', ...describeFailure(err, timeoutMs) };
  }
}

/**
 * Opens GET /api/events and forwards raw text chunks to `emit`:
 *   { type: 'open', status } | { type: 'chunk', data } | { type: 'error', error } | { type: 'end' }
 * The renderer parses SSE frames and owns reconnect. Returns a handle with stop().
 * @param {{ baseUrl: string, token: string }} config
 * @param {(msg: object) => void} emit
 * @param {{ fetchImpl?: typeof fetch }} [deps]
 */
function startCarwashEvents(config, emit, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const controller = new AbortController();
  const handle = { stop: () => controller.abort(), done: Promise.resolve() };
  const built = buildUrl(config && config.baseUrl, '/api/events');
  if (built.error || !config || typeof config.token !== 'string' || !config.token) {
    emit({ type: 'error', error: built.error || 'Sesión requerida' });
    return handle;
  }
  handle.done = (async () => {
    try {
      const response = await fetchImpl(built.url, {
        method: 'GET',
        headers: { Accept: 'text/event-stream', Authorization: `Bearer ${config.token}`, 'Cache-Control': 'no-cache' },
        redirect: 'error',
        signal: controller.signal,
      });
      emit({ type: 'open', status: response.status });
      if (!response.ok || !response.body) {
        emit({ type: 'end' });
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        emit({ type: 'chunk', data: decoder.decode(value, { stream: true }) });
      }
      emit({ type: 'end' });
    } catch (err) {
      if (controller.signal.aborted) return;
      emit({ type: 'error', error: describeFailure(err, 0).error });
    }
  })();
  return handle;
}

module.exports = { carwashFetch, startCarwashEvents, parseBaseUrl, buildUrl, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES };
