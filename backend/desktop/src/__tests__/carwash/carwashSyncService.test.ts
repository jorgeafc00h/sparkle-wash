import { CarwashOutbox } from '@/services/carwash/CarwashOutbox';
import { CarwashSyncService, type SyncCallbacks } from '@/services/carwash/CarwashSyncService';
import type { EventStreamHandlers } from '@/services/carwash/CarwashEventStream';
import type { CarwashSession } from '@/services/carwash/types';
import { DEFAULT_CARWASH_SETTINGS } from '@/services/carwash/types';
import { FakeClient, asClient, httpError, memoryStorage } from './testUtils';

const session: CarwashSession = { sessionToken: 'tok', subject: 's', role: 'operator', expiresAt: '2099-01-01T00:00:00Z' };

function setup() {
  const client = new FakeClient();
  const handlers: EventStreamHandlers[] = [];
  const refresh = jest.fn(async () => undefined);
  const silentReLogin = jest.fn(async (): Promise<CarwashSession | null> => null);
  const onSignedOut = jest.fn();
  const statuses: string[] = [];
  const callbacks: SyncCallbacks = {
    refresh,
    onFlushed: () => undefined,
    onStatus: (s) => statuses.push(s.state),
    silentReLogin,
    onSignedOut,
  };
  let current: CarwashSession | null = session;
  const service = new CarwashSyncService(
    {
      client: asClient(client),
      outbox: new CarwashOutbox({ storage: memoryStorage() }),
      getSettings: () => ({ ...DEFAULT_CARWASH_SETTINGS, pollSeconds: 5 }),
      getSession: () => current,
      openStream: (_cfg, h) => {
        handlers.push(h);
        return { close: () => undefined };
      },
      debounceMs: 500,
      backoffMinMs: 1000,
      backoffMaxMs: 4000,
      idleTimeoutMs: 45_000,
    },
    callbacks,
  );
  return {
    service, client, handlers, refresh, silentReLogin, onSignedOut, statuses,
    signOut: () => { current = null; },
    setSession: (next: CarwashSession | null) => { current = next; },
  };
}

describe('CarwashSyncService', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('keeps the default event stream when optional deps are passed as undefined (as the slice does)', async () => {
    // Regression: `{ ...defaults, ...deps }` let `openStream: undefined` replace the default opener, so
    // start() threw "openStream is not a function" and the board fell back to slow polling.
    const realFetch = globalThis.fetch;
    const fetchMock = jest.fn((_url: string, _init?: unknown) => new Promise<Response>(() => undefined));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const refresh = jest.fn(async () => undefined);
      const service = new CarwashSyncService(
        {
          client: asClient(new FakeClient()),
          outbox: new CarwashOutbox({ storage: memoryStorage() }),
          getSettings: () => ({ ...DEFAULT_CARWASH_SETTINGS, apiBaseUrl: 'http://api.test' }),
          getSession: () => session,
          openStream: undefined,
          debounceMs: undefined,
        },
        { refresh, onFlushed: () => undefined, onStatus: () => undefined, silentReLogin: async () => null, onSignedOut: () => undefined },
      );
      await expect(service.start()).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/events', expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
      }));
      expect(refresh).toHaveBeenCalled();
      service.stop();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('stays signed-out without a session', async () => {
    const t = setup();
    t.signOut();
    await t.service.start();
    expect(t.service.getStatus().state).toBe('signed-out');
    expect(t.handlers).toHaveLength(0);
  });

  it('goes live on open and debounces refreshes from jobs/arrivals change events', async () => {
    const t = setup();
    await t.service.start();
    t.refresh.mockClear();
    t.handlers[0].onOpen(200);
    await jest.advanceTimersByTimeAsync(10);
    expect(t.service.getStatus().state).toBe('live');
    t.refresh.mockClear();
    t.handlers[0].onData(': heartbeat\n\n');
    t.handlers[0].onData('event: change\ndata: {"topic":"jobs"}\n\nevent: change\ndata: {"topic":"arrivals"}\n\n');
    t.handlers[0].onData('event: change\ndata: {"topic":"employees"}\n\n');
    expect(t.refresh).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(500);
    expect(t.refresh).toHaveBeenCalledTimes(1);
    t.service.stop();
  });

  it('falls back to polling and reconnects with exponential backoff', async () => {
    const t = setup();
    await t.service.start();
    t.handlers[0].onOpen(200);
    await Promise.resolve();
    t.handlers[0].onError('boom');
    expect(t.service.getStatus().state).toBe('polling');
    t.refresh.mockClear();
    await jest.advanceTimersByTimeAsync(1000);
    expect(t.handlers).toHaveLength(2); // reconnect after 1 s
    t.handlers[1].onEnd();
    await jest.advanceTimersByTimeAsync(1999);
    expect(t.handlers).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(t.handlers).toHaveLength(3); // then 2 s
    // polling kept refreshing while the stream was down (pollSeconds = 5)
    expect(t.refresh).toHaveBeenCalled();
    t.service.stop();
  });

  it('flushes the outbox when the stream (re)connects', async () => {
    const t = setup();
    await t.service.start();
    const flush = jest.spyOn(t.service, 'flush');
    t.handlers[0].onOpen(200);
    await Promise.resolve();
    expect(flush).toHaveBeenCalled();
    t.service.stop();
  });

  it('tries ONE silent re-login on 401, then signs out', async () => {
    const t = setup();
    t.client.failNext.listJobs = httpError(401);
    t.refresh.mockRejectedValueOnce(httpError(401)).mockRejectedValueOnce(httpError(401));
    await t.service.start();
    expect(t.silentReLogin).toHaveBeenCalledTimes(1);
    expect(t.onSignedOut).toHaveBeenCalledTimes(1);
    expect(t.service.isRunning()).toBe(false);
  });

  it('shares ONE re-login between requests that 401 at the same time (no spurious sign-out)', async () => {
    const t = setup();
    let finish!: (s: CarwashSession) => void;
    t.silentReLogin.mockImplementation(() => new Promise<CarwashSession>((resolve) => { finish = resolve; }));
    await t.service.start();
    // The saved token is stale: the stream open and a refresh both come back 401 while re-login runs.
    t.handlers[0].onOpen(401);
    t.refresh.mockRejectedValueOnce(httpError(401));
    const refresh = t.service.syncNow();
    await jest.advanceTimersByTimeAsync(10);
    expect(t.silentReLogin).toHaveBeenCalledTimes(1);
    const fresh = { ...session, sessionToken: 'fresh' };
    t.setSession(fresh);
    finish(fresh);
    await refresh;
    await jest.advanceTimersByTimeAsync(10);
    expect(t.onSignedOut).not.toHaveBeenCalled();
    expect(t.service.isRunning()).toBe(true);
    expect(t.client.token).toBe('fresh');
    t.service.stop();
  });

  it('ignores a 401 for a token that a re-login already replaced', async () => {
    const t = setup();
    t.silentReLogin.mockImplementation(async () => {
      const fresh = { ...session, sessionToken: 'fresh' };
      t.setSession(fresh);
      return fresh;
    });
    await t.service.start();
    const stale = t.handlers[0];
    t.refresh.mockRejectedValueOnce(httpError(401));
    await t.service.syncNow(); // re-login → 'fresh'
    expect(t.silentReLogin).toHaveBeenCalledTimes(1);
    stale.onOpen(401); // late answer for the old stream (old generation of the handler is still current)
    await jest.advanceTimersByTimeAsync(10);
    await t.service.reportFailure(httpError(401), 'tok');
    expect(t.silentReLogin).toHaveBeenCalledTimes(1);
    expect(t.onSignedOut).not.toHaveBeenCalled();
    t.service.stop();
  });

  it('a refresh that resolves after stop() changes no status', async () => {
    const t = setup();
    await t.service.start();
    let release!: () => void;
    t.refresh.mockImplementationOnce(() => new Promise<undefined>((resolve) => { release = () => resolve(undefined); }));
    const pending = t.service.syncNow();
    await jest.advanceTimersByTimeAsync(10);
    t.service.stop();
    const after = t.statuses.length;
    release();
    await pending;
    expect(t.statuses.length).toBe(after);
    expect(t.service.getStatus().state).toBe('signed-out');
  });

  it('drops a stream that goes quiet (half-open connection) and reconnects', async () => {
    const t = setup();
    await t.service.start();
    t.handlers[0].onOpen(200);
    await jest.advanceTimersByTimeAsync(10);
    expect(t.service.getStatus().state).toBe('live');
    await jest.advanceTimersByTimeAsync(30_000);
    t.handlers[0].onData(': heartbeat\n\n'); // keeps it alive
    await jest.advanceTimersByTimeAsync(30_000);
    expect(t.handlers).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(15_000); // 45 s without data
    expect(t.service.getStatus().state).toBe('polling');
    await jest.advanceTimersByTimeAsync(1000);
    expect(t.handlers).toHaveLength(2);
    t.service.stop();
  });

  it('resumes after a successful silent re-login', async () => {
    const t = setup();
    t.silentReLogin.mockResolvedValue({ ...session, sessionToken: 'fresh' });
    t.refresh.mockRejectedValueOnce(httpError(401));
    await t.service.start();
    expect(t.client.token).toBe('fresh');
    expect(t.onSignedOut).not.toHaveBeenCalled();
    expect(t.service.isRunning()).toBe(true);
    t.service.stop();
  });
});
