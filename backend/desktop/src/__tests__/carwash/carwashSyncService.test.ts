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
    },
    callbacks,
  );
  return { service, client, handlers, refresh, silentReLogin, onSignedOut, statuses, signOut: () => { current = null; } };
}

describe('CarwashSyncService', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

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
