// CarwashSyncService — keeps the desktop in step with the API.
//
//  - signed in: subscribe to /api/events (SSE) with exponential reconnect;
//    `jobs`/`arrivals` change events debounce (~500 ms) a refresh.
//  - stream down: poll every `pollSeconds` (refresh + outbox flush).
//  - outbox flushes on start, on every (re)connect, after each local write, on poll.
//  - 401: ONE silent re-login (Google refresh → /api/auth/google), shared by every request that
//    hit the 401 at the same time; signed-out only if it fails or the new session is rejected too.
//  - a stream that goes quiet for `idleTimeoutMs` (no data, not even the server heartbeat) is a
//    half-open connection: it is dropped and reconnected, and polling covers the gap.
//  - stop() fences in-flight work: a refresh or flush that resolves afterwards changes nothing.
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
  /** Outbox scope of the signed-in account; flushes only send that scope's entries. */
  getScope?: () => string | null;
  openStream?: EventStreamOpener;
  debounceMs?: number;
  backoffMinMs?: number;
  backoffMaxMs?: number;
  /** No stream data (the API heartbeats every 15 s) for this long → treat the stream as dead. */
  idleTimeoutMs?: number;
}

export class CarwashSyncService {
  private readonly deps: Required<Omit<SyncDeps, 'client' | 'getSettings' | 'getSession' | 'getScope'>> &
    Pick<SyncDeps, 'client' | 'getSettings' | 'getSession' | 'getScope'>;
  private callbacks: SyncCallbacks;
  private running = false;
  private stream: EventStreamHandle | null = null;
  private streamLive = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private backoff: number;
  /** Set when a silent re-login ran; cleared once a request succeeds with the new session. */
  private reLoginAttempted = false;
  private reLogin: Promise<boolean> | null = null;
  private generation = 0;
  private status: CarwashSyncStatus = { state: 'signed-out', pending: 0, lastSyncedAt: null, lastError: null };

  constructor(deps: SyncDeps, callbacks: SyncCallbacks) {
    // `??` per field: callers (the slice) pass optional deps explicitly as `undefined`,
    // and a spread would let that `undefined` replace the default.
    this.deps = {
      client: deps.client,
      getSettings: deps.getSettings,
      getSession: deps.getSession,
      getScope: deps.getScope,
      outbox: deps.outbox ?? carwashOutbox,
      openStream: deps.openStream ?? defaultEventStreamOpener,
      debounceMs: deps.debounceMs ?? 500,
      backoffMinMs: deps.backoffMinMs ?? 1000,
      backoffMaxMs: deps.backoffMaxMs ?? 30_000,
      idleTimeoutMs: deps.idleTimeoutMs ?? 45_000,
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
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.reconnectTimer = this.pollTimer = this.debounceTimer = this.idleTimer = null;
    this.backoff = this.deps.backoffMinMs;
    if (emit) this.setStatus({ state: 'signed-out' });
  }

  /** True while `gen` is still the running generation (stop()/start() bump it). */
  private current(gen: number): boolean {
    return this.running && gen === this.generation;
  }

  private token(): string | null {
    return this.deps.getSession()?.sessionToken ?? null;
  }

  /** Flush the outbox then refresh. Safe to call repeatedly. */
  async syncNow(): Promise<void> {
    if (!this.running) return;
    const gen = this.generation;
    const token = this.token();
    try {
      await this.flush();
      if (!this.current(gen)) return;
      await this.callbacks.refresh();
      if (!this.current(gen)) return;
      this.reLoginAttempted = false;
      this.setStatus({ lastSyncedAt: new Date().toISOString(), lastError: null, ...(this.streamLive ? {} : { state: 'polling' as const }) });
    } catch (err) {
      if (this.current(gen)) await this.handleFailure(err, token);
    }
  }

  /** Call after enqueuing a local write. */
  async flush(): Promise<FlushResult | null> {
    if (!this.running) return null;
    const gen = this.generation;
    const result = await this.deps.outbox.flush(this.deps.client, this.deps.getScope?.());
    // Delivered entries are gone from the outbox whatever happened meanwhile, so the store must
    // still learn about them; only the status belongs to the (possibly stopped) generation.
    this.callbacks.onFlushed(result);
    if (!this.current(gen)) return result;
    this.setStatus({ pending: result.remaining });
    if (result.stopped === 'unauthorized') throw new CarwashApiError('Sesión expirada', { status: 401 });
    if (result.stopped === 'network' || result.stopped === 'server') {
      this.setStatus({ state: this.streamLive ? 'live' : 'offline', lastError: 'Sin conexión con el servidor' });
    }
    return result;
  }

  /** Call after enqueuing a local write. Never throws; null when not signed in / failed. */
  async afterLocalWrite(): Promise<FlushResult | null> {
    if (!this.running) {
      this.setStatus({ pending: await this.deps.outbox.pendingCount(this.deps.getScope?.()) });
      return null;
    }
    const gen = this.generation;
    const token = this.token();
    try {
      return await this.flush();
    } catch (err) {
      if (this.current(gen)) await this.handleFailure(err, token);
      return null;
    }
  }

  /**
   * For callers that hit the API themselves (e.g. a manual refresh): routes 401/network handling.
   * Pass the session token the failed request used, so a 401 from before a re-login is ignored.
   */
  reportFailure(err: unknown, tokenUsed?: string | null): Promise<void> {
    return this.handleFailure(err, tokenUsed);
  }

  private async handleFailure(err: unknown, tokenUsed?: string | null): Promise<void> {
    if (!this.running) return;
    if (err instanceof CarwashApiError && err.status === 401) {
      await this.handleUnauthorized(tokenUsed);
      return;
    }
    const isNetwork = err instanceof CarwashApiError && err.isNetwork;
    this.setStatus({
      state: isNetwork ? 'offline' : this.streamLive ? 'live' : 'error',
      lastError: err instanceof Error ? err.message : 'Error de sincronización',
    });
  }

  private async handleUnauthorized(tokenUsed?: string | null): Promise<void> {
    if (!this.running) return;
    // A 401 for a token that has since been replaced (the request left before a re-login finished)
    // says nothing about the current session.
    if (tokenUsed !== undefined && tokenUsed !== this.token() && !this.reLogin) return;
    // Every request that 401s while a re-login runs (stream open, refresh, outbox flush, a
    // reconnect still holding the old token) waits for that same re-login instead of signing out.
    if (this.reLogin) {
      await this.reLogin;
      return;
    }
    if (this.reLoginAttempted) {
      // The fresh session was rejected too (no request has succeeded since the re-login).
      this.signOut();
      return;
    }
    this.reLoginAttempted = true;
    const gen = this.generation;
    const attempt = (async (): Promise<boolean> => {
      let session: CarwashSession | null = null;
      try {
        session = await this.callbacks.silentReLogin();
      } catch {
        session = null;
      }
      if (!this.current(gen)) return false;
      if (!session) {
        this.signOut();
        return false;
      }
      this.deps.client.setToken(session.sessionToken);
      return true;
    })();
    this.reLogin = attempt;
    let ok = false;
    try {
      ok = await attempt;
    } finally {
      this.reLogin = null;
    }
    if (!ok || !this.current(gen)) return;
    this.closeStream();
    this.connect();
    await this.syncNow();
  }

  private signOut(): void {
    this.stop(false);
    this.callbacks.onSignedOut();
  }

  // ── Stream ───────────────────────────────────────────────────────────
  private closeStream(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.stream?.close();
    this.stream = null;
  }

  /** (Re)arms the half-open-connection watchdog; any stream data, including heartbeats, resets it. */
  private armIdleTimer(gen: number): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.onStreamDown(gen);
    }, this.deps.idleTimeoutMs);
  }

  private connect(): void {
    const session = this.deps.getSession();
    if (!this.running || !session) return;
    this.closeStream();
    const gen = this.generation;
    const token = session.sessionToken;
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
            void this.handleUnauthorized(token);
            return;
          }
          if (status >= 200 && status < 300) {
            this.streamLive = true;
            this.backoff = this.deps.backoffMinMs;
            this.armIdleTimer(gen);
            this.setStatus({ state: 'live', lastError: null });
            void this.syncNow();
          }
        },
        onData: (text) => {
          if (gen !== this.generation) return;
          if (this.streamLive) this.armIdleTimer(gen);
          parser.push(text);
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
    const gen = this.generation;
    const token = this.token();
    try {
      await this.callbacks.refresh();
      if (!this.current(gen)) return;
      this.reLoginAttempted = false;
      this.setStatus({ lastSyncedAt: new Date().toISOString(), lastError: null });
    } catch (err) {
      if (this.current(gen)) await this.handleFailure(err, token);
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
