import { CarwashApiClient, CarwashApiError, type CarwashTransport } from '@/services/carwash/CarwashApiClient';

function transport(responses: Array<{ status: number; body?: unknown; error?: string } | Error>) {
  const calls: Parameters<CarwashTransport>[0][] = [];
  const fn: CarwashTransport = async (req) => {
    calls.push(req);
    const next = responses.shift()!;
    if (next instanceof Error) throw next;
    return { status: next.status, headers: {}, body: next.body === undefined ? '' : JSON.stringify(next.body), error: next.error };
  };
  return { fn, calls };
}

describe('CarwashApiClient', () => {
  it('sends bearer token, idempotency key and JSON body; trims the base URL', async () => {
    const t = transport([{ status: 200, body: { id: 'j1' } }]);
    const client = new CarwashApiClient({ baseUrl: 'http://api.test///', token: 'tok', transport: t.fn });
    const job = await client.transitionJob('j 1', 'queued', 'key-12345678');
    expect(job).toEqual({ id: 'j1' });
    expect(t.calls[0]).toMatchObject({ baseUrl: 'http://api.test', path: '/api/jobs/j%201/transition', method: 'POST' });
    expect(t.calls[0].headers).toMatchObject({ Authorization: 'Bearer tok', 'Idempotency-Key': 'key-12345678', 'Content-Type': 'application/json' });
    expect(JSON.parse(t.calls[0].body!)).toEqual({ status: 'queued' });
  });

  it('does not send the token to /api/auth/google', async () => {
    const t = transport([{ status: 200, body: { sessionToken: 's' } }]);
    const client = new CarwashApiClient({ baseUrl: 'http://x', token: 'old', transport: t.fn });
    await client.googleLogin('idtok');
    expect(t.calls[0].headers.Authorization).toBeUndefined();
    expect(JSON.parse(t.calls[0].body!)).toEqual({ idToken: 'idtok' });
  });

  it('builds the new walk-in / ticket / payment requests', async () => {
    const t = transport([{ status: 201, body: {} }, { status: 200, body: {} }, { status: 201, body: {} }]);
    const client = new CarwashApiClient({ baseUrl: 'http://x', token: 't', transport: t.fn });
    await client.createWalkIn({ plate: 'ABC', vehicleClass: 'sedan', packageId: 'basic', ticketNumber: 'OT-C1-000001' }, 'walkin-key-1');
    await client.setJobTicket('j1', 'OT-C1-000001', 'ticket-key-1');
    await client.recordPayment('j1', { method: 'cash', amountUsd: 5 }, 'pay-key-123');
    expect(t.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /api/jobs/walk-in',
      'POST /api/jobs/j1/ticket',
      'POST /api/jobs/j1/payments',
    ]);
    expect(JSON.parse(t.calls[0].body!)).toMatchObject({ source: 'desktop-pos', plate: 'ABC' });
    expect(t.calls[2].headers['Idempotency-Key']).toBe('pay-key-123');
  });

  it('throws CarwashApiError with status and parsed body on 4xx', async () => {
    const t = transport([{ status: 409, body: { error: 'dup', job: { id: 'j9' } } }]);
    const client = new CarwashApiClient({ baseUrl: 'http://x', transport: t.fn });
    const err = await client.listJobs().catch((e) => e);
    expect(err).toBeInstanceOf(CarwashApiError);
    expect(err).toMatchObject({ status: 409, isNetwork: false, message: 'dup', body: { job: { id: 'j9' } } });
  });

  it('flags network failures (status 0 and thrown transports)', async () => {
    const t = transport([{ status: 0, error: 'sin conexión' }, new Error('boom')]);
    const client = new CarwashApiClient({ baseUrl: 'http://x', transport: t.fn });
    await expect(client.listJobs()).rejects.toMatchObject({ isNetwork: true, status: 0, message: 'sin conexión' });
    await expect(client.listJobs()).rejects.toMatchObject({ isNetwork: true, message: 'boom' });
  });
});

describe('default transport selection', () => {
  const g = globalThis as unknown as { window?: unknown; fetch?: unknown };
  const originalWindow = g.window;
  const originalFetch = g.fetch;
  afterEach(() => {
    g.window = originalWindow;
    g.fetch = originalFetch;
  });

  it('uses the Electron bridge for absolute URLs', async () => {
    const carwashFetch = jest.fn(async () => ({ status: 200, headers: {}, body: '[]' }));
    g.window = { electronAPI: { carwashFetch } };
    g.fetch = jest.fn();
    const client = new CarwashApiClient({ baseUrl: 'http://api.test', token: 't' });
    await expect(client.listJobs()).resolves.toEqual([]);
    expect(carwashFetch).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: 'http://api.test', path: '/api/jobs', method: 'GET' }));
    expect(g.fetch).not.toHaveBeenCalled();
  });

  it('uses fetch with a relative base URL even when the bridge exists', async () => {
    const carwashFetch = jest.fn();
    g.window = { electronAPI: { carwashFetch } };
    const fetchMock = jest.fn(async () => new Response('[]', { status: 200 }));
    g.fetch = fetchMock;
    const client = new CarwashApiClient({ baseUrl: '/carwash-api' });
    await client.listJobs();
    expect(fetchMock).toHaveBeenCalledWith('/carwash-api/api/jobs', expect.objectContaining({ method: 'GET' }));
    expect(carwashFetch).not.toHaveBeenCalled();
  });

  it('maps a fetch rejection to a network error', async () => {
    g.window = undefined;
    g.fetch = jest.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const client = new CarwashApiClient({ baseUrl: 'http://api.test' });
    await expect(client.listJobs()).rejects.toMatchObject({ isNetwork: true });
  });
});
