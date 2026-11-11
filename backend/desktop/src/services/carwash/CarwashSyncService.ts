// CarwashSyncService — keeps the desktop in step with the API.
//
//  - signed in: subscribe to /api/events (SSE) with exponential reconnect;
//    `jobs`/`arrivals` change events debounce (~500 ms) a refresh.
//  - stream down: poll every `pollSeconds` (refresh + outbox flush).
//  - outbox flushes on start, on every (re)connect, after each local write, on poll.
//  - 401: ONE silent re-login (Google refresh → /api/auth/google), then signed-out.
//
// The service owns no Redux; the slice wires it through `SyncCallbacks`.

import { CarwashApiError, type CarwashClientLike } from './CarwashApiClient';
import { defaultEventStreamOpener, type EventStreamHandle, type EventStreamOpener } from './CarwashEventStream';
import { carwashOutbox, type CarwashOutbox, type FlushResult } from './CarwashOutbox';
import { createSseParser, parseChangeTopic } from './sseParser';
import type { CarwashSession, CarwashSettings, CarwashSyncStatus } from './types';

export interface SyncCallbacks {
  /** Re-reads packages/jobs/summary/employees into the store. */
  refresh: () => Promise<void>;
  onFlushed: (result: FlushResult) => void;
  onStatus: (status: CarwashSyncStatus) => void;
  /** Silent Google re-login. Resolve the new session, or null when impossible. */
  silentReLogin: () => Promise<CarwashSession | null>;
  /** Session is gone for good: clear it and mark signed-out. */
  onSignedOut: () => void;
}

export interface SyncDeps {
  client: CarwashClientLike;
  outbox?: CarwashOutbox;
  getSettings: () => CarwashSettings;
  getSession: () => CarwashSession | null;
  openStream?: EventStreamOpener;
  debounceMs?: number;
  backoffMinMs?: number;
  backoffMaxMs?: number;
}

export class CarwashSyncService {
  private readonly deps: Required<Omit<SyncDeps, 'client' | 'getSettings' | 'getSession'>> & Pick<SyncDeps, 'client' | 'getSettings' | 'getSession'>;
  private callbacks: SyncCallbacks;
  private running = false;
  private stream: EventStreamHandle | null = null;
  private streamLive = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private backoff: number;
  private reLoginAttempted = false;
  private generation = 0;
  private status: CarwashSyncStatus = { state: 'signed-out', pending: 0, lastSyncedAt: null, lastError: null };

  constructor(deps: SyncDeps, callbacks: SyncCallbacks) {
    // `??` per field: callers (the slice) pass optional deps explicitly as `undefined`,
    // and a spread would let that `undefined` replace the default.
    this.deps = {
      client: deps.client,
      getSettings: deps.getSettings,
      getSession: deps.getSession,
      outbox: deps.outbox ?? carwashOutbox,
      openStream: deps.openStream ?? defaultEventStreamOpener,
      debounceMs: deps.debounceMs ?? 500,
      backoffMinMs: deps.backoffMinMs ?? 1000,
      backoffMaxMs: deps.backoffMaxMs ?? 30_000,
    };
    this.callbacks = callbacks;
    this.backoff = this.deps.backoffMinMs;
  }

  getStatus(): CarwashSyncStatus {
    return this.status;
  }

  isRunning(): boolean {
    return this.running;
  }

  private setStatus(patch: Partial<CarwashSyncStatus>): void {
    this.status = { ...this.status, ...patch };
    this.callbacks.onStatus(this.status);
  }

  async start(): Promise<void> {
    this.stop(false);
    const session = this.deps.getSession();
    if (!session) {
      this.setStatus({ state: 'signed-out', lastError: null });
      return;
    }
    this.running = true;
    this.reLoginAttempted = false;
    this.generation += 1;
    this.setStatus({ state: 'connecting', lastError: null });
    this.startPolling();
    this.connect();
    await this.syncNow();
  }

  stop(emit = true): void {
    this.running = false;
    this.generation += 1;
    this.streamLive = false;
    this.closeStream();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.reconnectTimer = this.pollTimer = this.debounceTimer = null;
    this.backoff = this.deps.backoffMinMs;
    if (emit) this.setStatus({ state: 'signed-out' });
  }

  /** Flush the outbox then refresh. Safe to call repeatedly. */
  async syncNow(): Promise<void> {
    if (!this.running) return;
    try {
      await this.flush();
      await this.callbacks.refresh();
      this.setStatus({ lastSyncedAt: new Date().toISOString(), lastError: null, ...(this.streamLive ? {} : { state: 'polling' as const }) });
    } catch (err) {
      await this.handleFailure(err);
    }
  }

  /** Call after enqueuing a local write. */
  async flush(): Promise<FlushResult | null> {
    if (!this.running) return null;
    const result = await this.deps.outbox.flush(this.deps.client);
    this.setStatus({ pending: result.remaining });
    this.callbacks.onFlushed(result);
    if (result.stopped === 'unauthorized') throw new CarwashApiError('Sesión expirada', { status: 401 });
    if (result.stopped === 'network' || result.stopped === 'server') {
      this.setStatus({ state: this.streamLive ? 'live' : 'offline', lastError: 'Sin conexión con el servidor' });
    }
    return result;
  }

  /** Call after enqueuing a local write. Never throws; null when not signed in / failed. */
  async afterLocalWrite(): Promise<FlushResult | null> {
    if (!this.running) {
      this.setStatus({ pending: await this.deps.outbox.pendingCount() });
      return null;
    }
    try {
      return await this.flush();
    } catch (err) {
      await this.handleFailure(err);
      return null;
    }
  }

  /** For callers that hit the API themselves (e.g. a manual refresh): routes 401/network handling. */
  reportFailure(err: unknown): Promise<void> {
    return this.handleFailure(err);
  }

  private async handleFailure(err: unknown): Promise<void> {
    if (err instanceof CarwashApiError && err.status === 401) {
      await this.handleUnauthorized();
      return;
    }
    const isNetwork = err instanceof CarwashApiError && err.isNetwork;
    this.setStatus({
      state: isNetwork ? 'offline' : this.streamLive ? 'live' : 'error',
      lastError: err instanceof Error ? err.message : 'Error de sincronización',
    });
  }

  private async handleUnauthorized(): Promise<void> {
    if (!this.running) return;
    if (this.reLoginAttempted) {
      this.stop(false);
      this.callbacks.onSignedOut();
      return;
    }
    this.reLoginAttempted = true;
    let session: CarwashSession | null = null;
    try {
      session = await this.callbacks.silentReLogin();
    } catch {
      session = null;
    }
    if (!session) {
      this.stop(false);
      this.callbacks.onSignedOut();
      return;
    }
    this.deps.client.setToken(session.sessionToken);
    this.reLoginAttempted = false;
    this.closeStream();
    this.connect();
    await this.syncNow();
  }

  // ── Stream ───────────────────────────────────────────────────────────
  private closeStream(): void {
    this.stream?.close();
    this.stream = null;
  }

  private connect(): void {
    const session = this.deps.getSession();
    if (!this.running || !session) return;
    this.closeStream();
    const gen = this.generation;
    const parser = createSseParser({
      onMessage: (msg) => {
        const topic = parseChangeTopic(msg);
        if (topic === 'jobs' || topic === 'arrivals') this.scheduleRefresh();
      },
    });
    this.setStatus({ state: this.streamLive ? 'live' : 'connecting' });
    this.stream = this.deps.openStream(
      { baseUrl: this.deps.getSettings().apiBaseUrl, token: session.sessionToken },
      {
        onOpen: (status) => {
          if (gen !== this.generation) return;
          if (status === 401) {
            void this.handleUnauthorized();
            return;
          }
          if (status >= 200 && status < 300) {
            this.streamLive = true;
            this.backoff = this.deps.backoffMinMs;
            this.setStatus({ state: 'live', lastError: null });
            void this.syncNow();
          }
        },
        onData: (text) => {
          if (gen === this.generation) parser.push(text);
        },
        onEnd: () => this.onStreamDown(gen),
        onError: () => this.onStreamDown(gen),
      },
    );
  }

  private onStreamDown(gen: number): void {
    if (gen !== this.generation || !this.running) return;
    this.streamLive = false;
    this.closeStream();
    this.setStatus({ state: 'polling' });
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, this.deps.backoffMaxMs);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private scheduleRefresh(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.refreshOnly();
    }, this.deps.debounceMs);
  }

  private async refreshOnly(): Promise<void> {
    if (!this.running) return;
    try {
      await this.callbacks.refresh();
      this.setStatus({ lastSyncedAt: new Date().toISOString(), lastError: null });
    } catch (err) {
      await this.handleFailure(err);
    }
  }

  // ── Polling fallback ─────────────────────────────────────────────────
  private startPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    const ms = Math.max(5, this.deps.getSettings().pollSeconds) * 1000;
    this.pollTimer = setInterval(() => {
      if (!this.streamLive) void this.syncNow();
    }, ms);
  }
}
