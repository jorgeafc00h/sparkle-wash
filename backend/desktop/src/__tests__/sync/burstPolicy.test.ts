// Burst session policy (Phase 2) — the state machine around SyncV2Engine sessions:
// an outbox change debounces ONE session open, a settled session lingers ~90 s and
// then closes with a REST flush, manual sync opens immediately, and background
// triggers never run while signed out / unclaimed / with "Automático" disarmed.
// Driven entirely on the Jest fake clock.

import {
  BURST_LINGER_MS,
  BURST_OPEN_DEBOUNCE_MS,
  STARTUP_PULL_DELAY_MS,
  SyncBurstController,
} from '@/services/sync/syncBurstController';

class FakeEngine {
  started = 0;
  stopped = 0;
  restFlushes = 0;
  live = false;
  activeCo: string | null = null;
  failStarts = false;

  async startSession(): Promise<{ ok: boolean }> {
    this.started++;
    if (this.failStarts) return { ok: false };
    this.live = true;
    this.activeCo = 'co1';
    return { ok: true };
  }

  async stopSession(options: { flushViaRest?: boolean } = {}): Promise<void> {
    this.stopped++;
    if (options.flushViaRest) this.restFlushes++;
    this.live = false;
    this.activeCo = null;
  }

  isLive(): boolean {
    return this.live;
  }

  activeCompanyKey(): string | null {
    return this.activeCo;
  }
}

interface Harness {
  engine: FakeEngine;
  controller: SyncBurstController;
  eligible: ReturnType<typeof jest.fn>;
  armed: ReturnType<typeof jest.fn>;
  outboxListeners: Array<() => void>;
  notifyOutbox: () => void;
}

const setup = (options: { eligible?: boolean; armed?: boolean } = {}): Harness => {
  const engine = new FakeEngine();
  const eligible = jest.fn(() => options.eligible ?? true);
  const armed = jest.fn(() => options.armed ?? true);
  const outboxListeners: Array<() => void> = [];
  const controller = new SyncBurstController({
    engine,
    isBackgroundEligible: eligible,
    isAutoArmed: armed,
    onOutboxChanged: listener => {
      outboxListeners.push(listener);
      return () => {
        const index = outboxListeners.indexOf(listener);
        if (index >= 0) outboxListeners.splice(index, 1);
      };
    },
  });
  controller.start();
  return {
    engine,
    controller,
    eligible,
    armed,
    outboxListeners,
    notifyOutbox: () => outboxListeners.forEach(listener => listener()),
  };
};

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('SyncBurstController — outbox bursts', () => {
  test('many outbox changes coalesce into exactly one debounced session open', async () => {
    const { engine, notifyOutbox } = setup();

    notifyOutbox();
    notifyOutbox();
    notifyOutbox();
    notifyOutbox();
    await jest.advanceTimersByTimeAsync(BURST_OPEN_DEBOUNCE_MS - 1);
    expect(engine.started).toBe(0); // still inside the debounce window

    await jest.advanceTimersByTimeAsync(1);
    expect(engine.started).toBe(1); // fired once, after the LAST change

    notifyOutbox(); // session now live: no new open is scheduled
    await jest.advanceTimersByTimeAsync(BURST_OPEN_DEBOUNCE_MS + 5_000);
    expect(engine.started).toBe(1);
  });

  test('the debounce restarts on each change (3–5 s after the LAST one)', async () => {
    const { engine, notifyOutbox } = setup();

    notifyOutbox();
    await jest.advanceTimersByTimeAsync(2_000);
    notifyOutbox(); // restarts the window
    await jest.advanceTimersByTimeAsync(2_000);
    expect(engine.started).toBe(0);
    await jest.advanceTimersByTimeAsync(BURST_OPEN_DEBOUNCE_MS);
    expect(engine.started).toBe(1);
  });

  test('no background session while signed out or unclaimed', async () => {
    const { engine, notifyOutbox, controller } = setup({ eligible: false });

    notifyOutbox();
    await jest.advanceTimersByTimeAsync(BURST_OPEN_DEBOUNCE_MS * 3);
    expect(engine.started).toBe(0);

    controller.scheduleStartupPull();
    await jest.advanceTimersByTimeAsync(STARTUP_PULL_DELAY_MS * 3);
    expect(engine.started).toBe(0);
  });

  test('no background session while "Automático" is disarmed (single device)', async () => {
    const { engine, notifyOutbox, controller } = setup({ armed: false });

    notifyOutbox();
    await jest.advanceTimersByTimeAsync(BURST_OPEN_DEBOUNCE_MS * 3);
    controller.scheduleStartupPull();
    await jest.advanceTimersByTimeAsync(STARTUP_PULL_DELAY_MS * 3);
    expect(engine.started).toBe(0);

    // The manual button is never gated by the auto option.
    await controller.syncNow();
    expect(engine.started).toBe(1);
  });
});

describe('SyncBurstController — linger close', () => {
  test('a settled session closes with a REST flush after ~90 s of outbox silence', async () => {
    const { engine, controller } = setup();

    const outcome = await controller.syncNow();
    expect(outcome.ok).toBe(true);
    expect(engine.live).toBe(true);
    expect(controller.isLingering()).toBe(true);

    await jest.advanceTimersByTimeAsync(BURST_LINGER_MS - 1);
    expect(engine.stopped).toBe(0);

    await jest.advanceTimersByTimeAsync(1);
    expect(engine.stopped).toBe(1);
    expect(engine.restFlushes).toBe(1); // stopSession({ flushViaRest: true })
    expect(engine.live).toBe(false);
  });

  test('outbox activity while live resets the linger', async () => {
    const { engine, controller, notifyOutbox } = setup();

    await controller.syncNow();
    await jest.advanceTimersByTimeAsync(50_000);
    notifyOutbox(); // the user keeps working
    await jest.advanceTimersByTimeAsync(40_000); // 90 s since open — but only 40 since the change
    expect(engine.stopped).toBe(0);

    await jest.advanceTimersByTimeAsync(BURST_LINGER_MS - 40_000);
    expect(engine.stopped).toBe(1);
    expect(engine.restFlushes).toBe(1);
  });

  test('a failed open arms no linger (the engine is idle — nothing to close)', async () => {
    const { engine, controller } = setup();
    engine.failStarts = true;

    const outcome = await controller.syncNow();
    expect(outcome.ok).toBe(false);
    await jest.advanceTimersByTimeAsync(BURST_LINGER_MS * 2);
    expect(engine.stopped).toBe(0);
  });

  test('a linger that fires after the session already ended is a no-op', async () => {
    const { engine, controller } = setup();

    await controller.syncNow();
    await engine.stopSession(); // relay restart / error path closed it first
    await jest.advanceTimersByTimeAsync(BURST_LINGER_MS);
    expect(engine.stopped).toBe(1); // only our explicit stop, not a second one
  });
});

describe('SyncBurstController — manual + startup triggers', () => {
  test('manual sync opens immediately and returns the engine outcome', async () => {
    const { engine, controller } = setup();

    const outcome = await controller.syncNow();
    expect(engine.started).toBe(1); // no debounce wait
    expect(outcome).toEqual({ ok: true });
    expect(controller.isLingering()).toBe(true);
  });

  test('the startup pull runs once per app run', async () => {
    const { engine, controller } = setup();

    controller.scheduleStartupPull();
    await jest.advanceTimersByTimeAsync(STARTUP_PULL_DELAY_MS - 1);
    expect(engine.started).toBe(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(engine.started).toBe(1);

    controller.scheduleStartupPull(); // state changes re-request it
    await jest.advanceTimersByTimeAsync(STARTUP_PULL_DELAY_MS * 3);
    expect(engine.started).toBe(1); // still once
  });

  test('the startup pull does not stack on a live session', async () => {
    const { engine, controller } = setup();

    await controller.syncNow();
    controller.scheduleStartupPull();
    await jest.advanceTimersByTimeAsync(STARTUP_PULL_DELAY_MS * 2);
    expect(engine.started).toBe(1);
  });

  test('stop() detaches: no further opens or linger closes', async () => {
    const { engine, controller, notifyOutbox, outboxListeners } = setup();

    await controller.syncNow();
    controller.stop();
    expect(outboxListeners.length).toBe(0);

    notifyOutbox();
    await jest.advanceTimersByTimeAsync(BURST_OPEN_DEBOUNCE_MS + BURST_LINGER_MS);
    expect(engine.started).toBe(1);
    expect(engine.stopped).toBe(0); // session lifecycle (sign-out/window close) owns that
  });
});
