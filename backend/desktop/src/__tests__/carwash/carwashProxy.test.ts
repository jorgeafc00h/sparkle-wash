const { carwashFetch, startCarwashEvents } = require('../../../electron/carwashProxy.cjs');

const okFetch = (body = '{"ok":true}', status = 200) =>
  jest.fn(async () => new Response(body, { status, headers: { 'content-type': 'application/json' } }));

describe('carwashProxy.carwashFetch', () => {
  it('forwards an allowed request and returns status/headers/body', async () => {
    const fetchImpl = okFetch();
    const res = await carwashFetch(
      { baseUrl: 'http://localhost:8080/', path: '/api/jobs', method: 'post', headers: { Authorization: 'Bearer t', 'Idempotency-Key': 'k1234567', 'X-Evil': 'x' }, body: '{}' },
      { fetchImpl },
    );
    expect(res).toMatchObject({ ok: true, status: 200, body: '{"ok":true}' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:8080/api/jobs');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(Object.keys(init.headers as object).map((h) => h.toLowerCase())).not.toContain('x-evil');
  });

  it.each([
    ['non-http base', { baseUrl: 'file:///etc', path: '/api/jobs' }],
    ['creds in base', { baseUrl: 'http://u:p@host', path: '/api/jobs' }],
    ['path outside /api/', { baseUrl: 'http://h', path: '/admin' }],
    ['path traversal', { baseUrl: 'http://h', path: '/api/../x' }],
    ['bad method', { baseUrl: 'http://h', path: '/api/jobs', method: 'TRACE' }],
  ])('rejects %s without fetching', async (_n, cfg) => {
    const fetchImpl = okFetch();
    const res = await carwashFetch(cfg, { fetchImpl });
    expect(res).toMatchObject({ ok: false, status: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('caps the request body size', async () => {
    const fetchImpl = okFetch();
    const res = await carwashFetch({ baseUrl: 'http://h', path: '/api/jobs', method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) }, { fetchImpl });
    expect(res.errorKind).toBe('blocked');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('times out for real', async () => {
    const fetchImpl = jest.fn((_u: string, init: RequestInit) => new Promise((_res, rej) => {
      init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('t'), { name: 'TimeoutError' })));
    }));
    const res = await carwashFetch({ baseUrl: 'http://h', path: '/api/jobs', timeoutMs: 30 }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res).toMatchObject({ ok: false, status: 0, errorKind: 'timeout' });
  });

  it('reports network failures as status 0 and never echoes the token', async () => {
    const fetchImpl = jest.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' } });
    });
    const res = await carwashFetch({ baseUrl: 'http://h', path: '/api/jobs', headers: { Authorization: 'Bearer SECRET' } }, { fetchImpl });
    expect(res.status).toBe(0);
    expect(JSON.stringify(res)).not.toContain('SECRET');
  });
});

describe('carwashProxy.startCarwashEvents', () => {
  it('streams chunks and stops on demand', async () => {
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(enc.encode('event: change\n'));
        c.enqueue(enc.encode('data: {"topic":"jobs"}\n\n'));
        c.close();
      },
    });
    const fetchImpl = jest.fn(async () => new Response(stream, { status: 200 }));
    const events: any[] = [];
    const handle = startCarwashEvents({ baseUrl: 'http://h', token: 'tok' }, (m: any) => events.push(m), { fetchImpl });
    await handle.done;
    expect(events.map((e) => e.type)).toEqual(['open', 'chunk', 'chunk', 'end']);
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('refuses without a token', () => {
    const events: any[] = [];
    startCarwashEvents({ baseUrl: 'http://h', token: '' }, (m: any) => events.push(m), { fetchImpl: okFetch() });
    expect(events[0].type).toBe('error');
  });
});
