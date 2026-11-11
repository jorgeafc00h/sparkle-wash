// In-memory stand-in for Invoices.SyncApi with the same observable semantics the clients
// depend on (reviewed contract, 2026-09-25): per-company epoch, monotonic log ids, Pull paging
// by id with hasMore/truncated, ChangesAvailable fan-out excluding the sender, PeersChanged with
// the full ONLINE list (newcomer included, recipients filter themselves out), EpochReset to a
// caller registering with a stale epoch, DataRequested (never echoed to the requester), digest
// relay to the requester only, rate_limited back-pressure, one device per connection, and
// restart() = cold start (new epoch, empty memory).

import { configureStore, combineReducers, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import companies from '@/store/slices/companySlice';
import invoices from '@/store/slices/invoiceSlice';
import customers from '@/store/slices/customerSlice';
import products from '@/store/slices/productSlice';
import syncV2, { setSyncDeviceId } from '@/store/slices/syncV2Slice';
import { hydrateCompanies } from '@/store/slices/companySlice';
import { syncCaptureMiddleware } from '@/services/sync/capture';
import { SyncV2Engine, type HubConnectionLike, type SyncRestClient, type SyncV2Environment } from '@/services/sync/syncV2Service';
import type { ChangeEnvelope, DeviceManifest } from '@/services/sync/protocol';
import { SubscriptionTier } from '@/services/subscription/SubscriptionTypes';
import { CompanyEnvironment, CompanyStatus, type Company } from '@/types';

// Desktop's real subscriptionSlice pulls N1COService (import.meta.env) which ts-jest's
// CommonJS build can't load; capture + engine only read `subscription.tier`.
const subscriptionStub = createSlice({
  name: 'subscription',
  initialState: { tier: SubscriptionTier.Lite as SubscriptionTier },
  reducers: {
    setTier(state, action: PayloadAction<SubscriptionTier>) {
      state.tier = action.payload;
    },
  },
});
export const { setTier } = subscriptionStub.actions;
const subscription = subscriptionStub.reducer;

type Handler = (...args: unknown[]) => void;

export interface RelayCall {
  deviceId: string | undefined;
  method: string;
  args: unknown[];
}

interface CompanyLog {
  epoch: string;
  seq: number;
  log: { id: string; change: ChangeEnvelope }[];
  manifests: Map<string, DeviceManifest>;
  corr: Record<string, number>;
}

let epochCounter = 0;

export class FakeRelay {
  private companies = new Map<string, CompanyLog>();
  readonly connections = new Set<FakeConnection>();
  readonly calls: RelayCall[] = [];
  /** Envelope indexes (per push) the relay should reject, keyed by entity id. */
  rejectIds = new Map<string, string>();
  forbidden = false;
  supportsDigest = true;
  /** The next N pushes (hub or REST) are refused with `rate_limited`. */
  rateLimitedPushes = 0;
  /** Bounded log like the relay's 20K trim (tests use small bounds to force `truncated`). */
  maxLogEntries = Number.POSITIVE_INFINITY;
  /** When set, the NEXT Pull invocation parks until the returned promise resolves. */
  hangPull: (() => Promise<void>) | null = null;

  company(co: string): CompanyLog {
    let state = this.companies.get(co);
    if (!state) {
      state = { epoch: `epoch-${++epochCounter}`, seq: 0, log: [], manifests: new Map(), corr: {} };
      this.companies.set(co, state);
    }
    return state;
  }

  /** Cold start: every company loses its log/manifests and gets a new epoch. */
  restart(): void {
    this.companies.clear();
  }

  broadcast(from: FakeConnection | null, co: string, event: string, ...args: unknown[]): void {
    for (const connection of this.connections) {
      if (connection === from || connection.co !== co) continue;
      connection.deliver(event, ...args);
    }
  }

  onlinePeers(co: string, exclude?: string): string[] {
    return Array.from(new Set(Array.from(this.connections)
      .filter(connection => connection.co === co && connection.deviceId && connection.deviceId !== exclude)
      .map(connection => connection.deviceId!)));
  }

  /** The PeersChanged payload: manifests of every device online right now. */
  onlineManifests(co: string): DeviceManifest[] {
    const state = this.company(co);
    return this.onlinePeers(co)
      .map(deviceId => state.manifests.get(deviceId))
      .filter((manifest): manifest is DeviceManifest => !!manifest);
  }

  takeRateLimit(): boolean {
    if (this.rateLimitedPushes <= 0) return false;
    this.rateLimitedPushes--;
    return true;
  }

  status(co: string) {
    const state = this.company(co);
    return {
      epoch: state.epoch,
      head: String(state.seq),
      devices: Array.from(state.manifests.values()),
      online: this.onlinePeers(co),
      correlativoMaxima: { ...state.corr },
    };
  }

  mergeCorr(co: string, maxima: Record<string, number> | undefined): void {
    const state = this.company(co);
    for (const [docType, value] of Object.entries(maxima ?? {})) {
      if ((state.corr[docType] ?? 0) < value) state.corr[docType] = value;
    }
  }

  append(co: string, changes: ChangeEnvelope[]): { lastId: string; rejected: { index: number; reason: string }[] } {
    const state = this.company(co);
    const rejected: { index: number; reason: string }[] = [];
    changes.forEach((change, index) => {
      const reason = this.rejectIds.get(change.id);
      if (reason) {
        rejected.push({ index, reason });
        return;
      }
      state.seq++;
      state.log.push({ id: String(state.seq), change });
    });
    if (state.log.length > this.maxLogEntries) state.log.splice(0, state.log.length - this.maxLogEntries);
    return { lastId: String(state.seq), rejected };
  }

  restClient(): SyncRestClient {
    return {
      push: async (co, changes) => {
        this.calls.push({ deviceId: undefined, method: 'REST:push', args: [co, changes.length] });
        if (this.takeRateLimit()) return { error: 'rate_limited' } as never;
        const result = this.append(co, changes);
        // The relay names the pushing device (the envelopes' author) as the origin.
        this.broadcast(null, co, 'ChangesAvailable', co, result.lastId, changes[0]?.d ?? 'rest');
        return result;
      },
      status: async co => this.status(co),
      putDevice: async (co, manifest) => {
        this.company(co).manifests.set(manifest.deviceId, manifest);
      },
    };
  }
}

export class FakeConnection implements HubConnectionLike {
  private handlers = new Map<string, Handler>();
  private closeHandlers: ((error?: Error) => void)[] = [];
  deviceId: string | undefined;
  co: string | undefined;
  started = false;
  /** Mirrors SignalR HubConnectionState; tests flip it to 'Reconnecting' to simulate a drop. */
  state: string = 'Disconnected';

  constructor(private readonly relay: FakeRelay) {}

  async start(): Promise<void> {
    this.started = true;
    this.state = 'Connected';
    this.relay.connections.add(this);
  }

  async stop(): Promise<void> {
    this.started = false;
    this.state = 'Disconnected';
    this.relay.connections.delete(this);
    if (this.co) this.relay.broadcast(this, this.co, 'PeersChanged', this.co, this.relay.onlineManifests(this.co));
    this.closeHandlers.forEach(handler => handler());
  }

  /** Server → client event, delivered asynchronously like a real socket. */
  deliver(event: string, ...args: unknown[]): void {
    const handler = this.handlers.get(event);
    if (handler) setTimeout(() => handler(...args), 0);
  }

  on<Args extends unknown[]>(event: string, handler: (...args: Args) => void): void {
    this.handlers.set(event, handler as unknown as Handler);
  }

  off(event: string): void {
    this.handlers.delete(event);
  }

  onclose(callback: (error?: Error) => void): void {
    this.closeHandlers.push(callback);
  }

  async invoke<T>(method: string, ...args: unknown[]): Promise<T> {
    if (this.state !== 'Connected') {
      throw new Error("Cannot send data if the connection is not in the 'Connected' State.");
    }
    this.relay.calls.push({ deviceId: this.deviceId, method, args });
    const [co] = args as [string];
    if (this.relay.forbidden) return { error: 'forbidden' } as T;
    const state = this.relay.company(co);

    switch (method) {
      case 'Register': {
        const manifest = args[1] as DeviceManifest;
        if (this.deviceId && this.deviceId !== manifest.deviceId) return { error: 'device_id_mismatch' } as T;
        const previousCo = this.co;
        this.deviceId = manifest.deviceId;
        this.co = co;
        state.manifests.set(manifest.deviceId, manifest);
        this.relay.mergeCorr(co, manifest.maxCorrelativo);
        const peers = this.relay.onlineManifests(co).filter(m => m.deviceId !== manifest.deviceId);
        if (previousCo && previousCo !== co) {
          this.relay.broadcast(this, previousCo, 'PeersChanged', previousCo, this.relay.onlineManifests(previousCo));
        }
        if (manifest.epoch && manifest.epoch !== state.epoch) this.deliver('EpochReset', co, state.epoch);
        this.relay.broadcast(this, co, 'PeersChanged', co, this.relay.onlineManifests(co));
        return { epoch: state.epoch, head: String(state.seq), peers } as T;
      }
      case 'Push': {
        if (this.relay.takeRateLimit()) return { error: 'rate_limited' } as T;
        const result = this.relay.append(co, args[1] as ChangeEnvelope[]);
        if (result.lastId !== '0') this.relay.broadcast(this, co, 'ChangesAvailable', co, result.lastId, this.deviceId);
        return result as T;
      }
      case 'Pull': {
        if (this.relay.hangPull) {
          const hang = this.relay.hangPull;
          this.relay.hangPull = null;
          await hang();
        }
        const since = Math.max(0, Number(args[1] ?? '0') || 0);
        const max = Number(args[2] ?? 500);
        const remaining = state.log.filter(entry => Number(entry.id) > since);
        const entries = remaining.slice(0, max);
        const oldest = state.log.length ? Number(state.log[0].id) : state.seq + 1;
        // Like the real relay: lastId is the HEAD, not the last returned entry.
        return {
          entries,
          lastId: String(state.seq),
          epoch: state.epoch,
          hasMore: remaining.length > entries.length,
          truncated: since > 0 && since + 1 < oldest && since < state.seq,
        } as T;
      }
      case 'ReportManifest': {
        const manifest = args[1] as DeviceManifest;
        if (this.deviceId && this.deviceId !== manifest.deviceId) return { error: 'device_id_mismatch' } as T;
        state.manifests.set(manifest.deviceId, manifest);
        this.relay.mergeCorr(co, manifest.maxCorrelativo);
        return { ok: true } as T;
      }
      case 'QueryPeers': {
        this.relay.broadcast(this, co, 'DataRequested', co, this.deviceId, args[1] ?? '');
        return { sent: true, onlinePeers: this.relay.onlinePeers(co, this.deviceId) } as T;
      }
      case 'RequestDigest': {
        if (!this.relay.supportsDigest) throw new Error("Method does not exist.");
        this.relay.broadcast(this, co, 'DigestRequested', co, this.deviceId, args[1]);
        return { sent: true, onlinePeers: this.relay.onlinePeers(co, this.deviceId) } as T;
      }
      case 'Digest': {
        const [, requesterId, digest] = args as [string, string, unknown];
        let delivered = 0;
        for (const connection of this.relay.connections) {
          if (connection.co === co && connection.deviceId === requesterId) {
            connection.deliver('DigestAvailable', co, this.deviceId, digest);
            delivered++;
          }
        }
        return { ok: true, delivered } as T;
      }
      default:
        throw new Error(`Unknown hub method ${method}`);
    }
  }
}

// ─── test devices ───

export const TEST_NIT = '06141804941018';

export const makeCompany = (id: string, overrides: Partial<Company> = {}): Company => ({
  id,
  nit: TEST_NIT,
  nrc: '123456-7',
  nombre: 'Empresa Sync',
  nombreComercial: 'SyncCo',
  descActividad: 'Software',
  codActividad: '62010',
  tipoEstablecimiento: '01',
  establecimiento: 'Casa Matriz',
  telefono: '22223333',
  correo: 'sync@test.com',
  codEstableMH: 'M001',
  codEstable: '0001',
  codPuntoVentaMH: 'P001',
  codPuntoVenta: '0001',
  departamento: 'San Salvador',
  departamentoCode: '06',
  municipio: 'San Salvador',
  municipioCode: '14',
  complemento: 'Calle 1',
  direccion: 'Calle 1',
  environment: CompanyEnvironment.Production,
  isProduction: true,
  isTestAccount: false,
  status: CompanyStatus.Active,
  hasValidCertificate: true,
  hasApiCredentials: true,
  isDefault: true,
  userId: 'user-1',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...overrides,
} as Company);

export const createSyncTestStore = () =>
  configureStore({
    reducer: combineReducers({ companies, invoices, customers, products, subscription, syncV2 }),
    middleware: getDefaultMiddleware =>
      getDefaultMiddleware({ serializableCheck: false, immutableCheck: false }).concat(syncCaptureMiddleware),
  });

export type SyncTestStore = ReturnType<typeof createSyncTestStore>;

export interface TestDevice {
  name: string;
  deviceId: string;
  store: SyncTestStore;
  engine: SyncV2Engine;
  connections: FakeConnection[];
  timers: { delay: number }[];
}

export const createTestDevice = (
  relay: FakeRelay,
  options: {
    name: string;
    deviceId: string;
    companyId: string;
    tier?: SubscriptionTier;
    token?: string | null;
    staggerMaxMs?: number;
    random?: () => number;
    companyOverrides?: Partial<Company>;
  },
): TestDevice => {
  const store = createSyncTestStore();
  store.dispatch(hydrateCompanies([makeCompany(options.companyId, options.companyOverrides)]));
  store.dispatch(setTier(options.tier ?? SubscriptionTier.ProSync));
  store.dispatch(setSyncDeviceId(options.deviceId));

  const connections: FakeConnection[] = [];
  const timers: { delay: number }[] = [];
  const env: SyncV2Environment = {
    baseUrl: 'http://relay.test',
    getToken: async () => (options.token === undefined ? 'test-token' : options.token),
    getDeviceId: async () => options.deviceId,
    createConnection: () => {
      const connection = new FakeConnection(relay);
      connections.push(connection);
      return connection;
    },
    createRestClient: () => relay.restClient(),
    platform: 'android',
    appVersion: '1.0.40',
    staggerMaxMs: options.staggerMaxMs ?? 0,
    flushDebounceMs: 0,
    now: () => new Date(),
    random: options.random ?? (() => 0),
    setTimer: (callback, ms) => {
      timers.push({ delay: ms });
      return setTimeout(callback, 0);
    },
    clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };

  return { name: options.name, deviceId: options.deviceId, store, engine: new SyncV2Engine(store, env), connections, timers };
};

/** Lets queued socket events, debounced flushes and pulls run to completion. */
export const settle = async (rounds = 25): Promise<void> => {
  for (let i = 0; i < rounds; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
};

export const waitUntil = async (predicate: () => boolean, rounds = 200): Promise<void> => {
  for (let i = 0; i < rounds; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error('condition not met');
};
