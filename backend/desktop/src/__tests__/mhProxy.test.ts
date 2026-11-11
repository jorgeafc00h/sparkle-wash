// electron/mhProxy.cjs — the main-process side of window.electronAPI.mhFetch.
// Found in review (2026-10-31): the 30 s auth timeout was reported as
// "Hacienda no respondió en 5 minutos"; fetch() followed redirects, so a
// 307/308 from MH would re-send the auth form body (NIT + password) to a host
// outside the allowlist; and every network failure reached telemetry as
// statusCode 0 with no hint of why.

import * as http from 'http';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { mhFetch, describeFetchFailure } = require('../../electron/mhProxy.cjs');

const AUTH_URL = 'https://apitest.dtes.mh.gob.sv/seguridad/auth';
const DTE_URL = 'https://api.dtes.mh.gob.sv/fesv/recepciondte';
const AUTH_BODY = 'user=06141404941342&pwd=s3cr3t-Password';

const timeoutError = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });

describe('mh:fetch proxy', () => {
  it('never follows redirects and bounds every request', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200, text: async () => '{"status":"OK"}' }));
    const result = await mhFetch(
      { url: AUTH_URL, headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: 'x=1' }, body: AUTH_BODY },
      { fetchImpl },
    );
    expect(result).toEqual({ ok: true, status: 200, body: '{"status":"OK"}' });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.body).toBe(AUTH_BODY);
    expect(init.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' });
  });

  it('reports the budget that actually ran out: 30 s for auth, 5 min for DTE submission', async () => {
    const fetchImpl = jest.fn(async () => { throw timeoutError(); });
    const auth = await mhFetch({ url: AUTH_URL, body: AUTH_BODY }, { fetchImpl });
    expect(auth).toMatchObject({ ok: false, status: 0, errorKind: 'timeout', errorCode: 'TIMEOUT_30S' });
    expect(auth.error).toBe('Hacienda no respondió en 30 segundos. Intenta de nuevo.');

    const dte = await mhFetch({ url: DTE_URL, body: { documento: 'jws' } }, { fetchImpl });
    expect(dte).toMatchObject({ errorKind: 'timeout', errorCode: 'TIMEOUT_300S' });
    expect(dte.error).toBe('Hacienda no respondió en 5 minutos. Intenta de nuevo.');
  });

  it('a network failure says why, without the NIT or the password', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('getaddrinfo ENOTFOUND apitest.dtes.mh.gob.sv'), { code: 'ENOTFOUND' }),
      });
    });
    const result = await mhFetch({ url: AUTH_URL, body: AUTH_BODY }, { fetchImpl });
    expect(result).toMatchObject({ ok: false, status: 0, errorKind: 'dns', errorCode: 'ENOTFOUND' });
    expect(result.error).toContain('ENOTFOUND');
    expect(JSON.stringify(result)).not.toMatch(/s3cr3t|06141404941342/);
  });

  it('keeps the allowlist: MH hosts over https on the default port, /seguridad/auth and /fesv/*, POST only', async () => {
    const fetchImpl = jest.fn();
    for (const config of [
      { url: 'https://evil.example.com/seguridad/auth' },
      { url: 'http://apitest.dtes.mh.gob.sv/seguridad/auth' },
      { url: 'https://apitest.dtes.mh.gob.sv:8443/seguridad/auth' },
      { url: 'https://apitest.dtes.mh.gob.sv/otra/ruta' },
      { url: AUTH_URL, method: 'GET' },
    ]) {
      expect(await mhFetch({ ...config, body: AUTH_BODY }, { fetchImpl })).toMatchObject({ ok: false, status: 0, errorKind: 'blocked' });
    }
    expect(await mhFetch(null, { fetchImpl })).toMatchObject({ ok: false, errorKind: 'invalid' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('failure classification against real Node fetch errors', () => {
  let server: http.Server;
  let base: string;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.writeHead(307, { Location: 'http://127.0.0.1:1/steal' });
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it("redirect: 'error' refuses a 307 and is classified as a redirect", async () => {
    const err = await fetch(`${base}/seguridad/auth`, { method: 'POST', body: AUTH_BODY, redirect: 'error' }).catch((e) => e);
    expect(err?.name).toBe('TypeError'); // rejected, not followed
    expect(describeFetchFailure(err, 30000)).toMatchObject({ errorKind: 'redirect', errorCode: 'REDIRECT' });
  });

  it('a refused connection is classified as refused', async () => {
    const closed = http.createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));
    const err = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST', body: AUTH_BODY }).catch((e) => e);
    expect(describeFetchFailure(err, 30000)).toMatchObject({ errorKind: 'refused', errorCode: 'ECONNREFUSED' });
  });
});
