// companySlice → MhClient → TelemetryService → LocalLogger reads import.meta.env, which
// ts-jest's CommonJS build can't parse — stub the logging layer.
jest.mock('@/services/logging/LocalLogger', () => ({
  LocalLogger: { initialize: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), log: jest.fn() },
}));
jest.mock('@/services/telemetry/TelemetryService', () => ({
  TelemetryService: { initialize: jest.fn(), trackEvent: jest.fn(), trackException: jest.fn(), trackTrace: jest.fn() },
  default: { initialize: jest.fn(), trackEvent: jest.fn(), trackException: jest.fn(), trackTrace: jest.fn() },
}));
jest.mock('@/services/storage/ElectronStorage', () => {
  const map = new Map<string, string>();
  const storage = {
    getItem: jest.fn(async (key: string) => (map.has(key) ? map.get(key)! : null)),
    setItem: jest.fn(async (key: string, value: string) => {
      map.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      map.delete(key);
    }),
    clear: jest.fn(async () => {
      map.clear();
    }),
    getAllKeys: jest.fn(async () => Array.from(map.keys())),
  };
  return { appStorage: storage, electronPersistStorage: storage };
});

import { addCustomer, updateCustomer, deleteCustomer } from '@/store/slices/customerSlice';
import { addProduct } from '@/store/slices/productSlice';
import { addInvoice, updateInvoice } from '@/store/slices/invoiceSlice';
import { hydrateCompanies } from '@/store/slices/companySlice';
import { setSyncDeviceId } from '@/store/slices/syncV2Slice';
import { InvoiceStatus, InvoiceType } from '@/types';
import { SubscriptionTier } from '@/services/subscription/SubscriptionTypes';
import { SyncV2Engine, type SyncV2Environment } from '@/services/sync/syncV2Service';
import {
  createSyncTestStore,
  createTestDevice,
  FakeConnection,
  FakeRelay,
  makeCompany,
  setTier,
  settle,
  waitUntil,
  TEST_NIT,
  type TestDevice,
} from './helpers/syncFakeRelay';

const CO = `co${TEST_NIT}`;

const customerInput = (companyId: string, firstName: string) => ({
  firstName,
  lastName: 'Prueba',
  nationalId: '',
  nit: '',
  email: `${firstName.toLowerCase()}@test.com`,
  phone: '77778888',
  documentType: '13',
  companyId,
} as any);

const productFor = (companyId: string, id: string, name: string) => ({
  id,
  productName: name,
  unitPrice: 25,
  companyId,
  isActive: true,
  createdAt: '2026-09-24T00:00:00.000Z',
  updatedAt: '2026-09-24T00:00:00.000Z',
} as any);

const invoiceInput = (companyId: string, invoiceNumber: string, id?: string) => ({
  id,
  invoiceNumber,
  date: '2026-09-24',
  invoiceType: InvoiceType.Factura,
  companyId,
  customerId: undefined,
  items: [{ productId: 'p1', productName: 'Servicio', quantity: 1, unitPrice: 10 }],
} as any);

const customersOf = (device: TestDevice) => device.store.getState().customers.customers;
const invoicesOf = (device: TestDevice) => device.store.getState().invoices.invoices;
const syncOf = (device: TestDevice) => device.store.getState().syncV2.companies[CO];

describe('SyncV2Engine — two devices through the relay', () => {
  let relay: FakeRelay;
  let phone: TestDevice;
  let desktop: TestDevice;

  beforeEach(() => {
    relay = new FakeRelay();
    phone = createTestDevice(relay, { name: 'phone', deviceId: 'dev-phone', companyId: 'company_phone' });
    desktop = createTestDevice(relay, { name: 'desktop', deviceId: 'dev-desktop', companyId: 'company_desktop' });
  });

  afterEach(async () => {
    await phone.engine.stopSession();
    await desktop.engine.stopSession();
  });

  it('captures local writes into the outbox for Pro+Sync (and re-parents entities on the peer)', async () => {
    phone.store.dispatch(addCustomer(customerInput('company_phone', 'Ana')));
    phone.store.dispatch(addProduct(productFor('company_phone', 'prod-1', 'Consultoría')));
    phone.store.dispatch(addInvoice(invoiceInput('company_phone', '00001', 'inv-1')));

    const outbox = Object.values(syncOf(phone).outbox);
    expect(outbox.map(ref => ref.t).sort()).toEqual(['customer', 'invoice', 'product']);

    expect(await phone.engine.startSession()).toMatchObject({ ok: true });
    expect(Object.keys(syncOf(phone).outbox)).toHaveLength(0);

    expect(await desktop.engine.startSession()).toMatchObject({ ok: true });
    await waitUntil(() => customersOf(desktop).length === 1 && invoicesOf(desktop).length === 1);

    // Each device minted its own company id for the same NIT: entities land on the LOCAL one.
    expect(customersOf(desktop)[0]).toMatchObject({ firstName: 'Ana', companyId: 'company_desktop' });
    // Same id on both devices (Desktop's addInvoice minted it on the phone side here).
    expect(invoicesOf(desktop)[0]).toMatchObject({ id: invoicesOf(phone)[0].id, invoiceNumber: '00001', companyId: 'company_desktop' });
    expect(desktop.store.getState().products.products[0]).toMatchObject({ id: 'prod-1', companyId: 'company_desktop' });
  });

  it('runs the session loop in protocol order: Register → Push → Pull → QueryPeers → ReportManifest', async () => {
    phone.store.dispatch(addCustomer(customerInput('company_phone', 'Ana')));
    await phone.engine.startSession();
    const methods = relay.calls.filter(call => call.deviceId === 'dev-phone' || call.method === 'Register').map(call => call.method);
    expect(methods.slice(0, 5)).toEqual(['Register', 'Push', 'Pull', 'QueryPeers', 'ReportManifest']);
  });

  it('commits the cursor to the last APPLIED entry id, not the relay head', async () => {
    phone.store.dispatch(addCustomer(customerInput('company_phone', 'Ana')));
    phone.store.dispatch(addCustomer(customerInput('company_phone', 'Beto')));
    await phone.engine.startSession();
    await desktop.engine.startSession();
    await waitUntil(() => customersOf(desktop).length === 2);
    const desktopCursor = Number(syncOf(desktop).cursor);
    const phoneEntries = relay.company(CO).log.filter(entry => entry.change.d === 'dev-phone');
    expect(desktopCursor).toBeGreaterThanOrEqual(Number(phoneEntries[phoneEntries.length - 1].id));
  });

  it('relays edits live in both directions while both sessions are open', async () => {
    await phone.engine.startSession();
    await desktop.engine.startSession();

    phone.store.dispatch(addCustomer(customerInput('company_phone', 'Carla')));
    await waitUntil(() => customersOf(desktop).some(c => c.firstName === 'Carla'));

    const id = customersOf(desktop).find(c => c.firstName === 'Carla')!.id;
    await new Promise(resolve => setTimeout(resolve, 5)); // strictly newer updatedAt
    desktop.store.dispatch(updateCustomer({ id, phone: '7000-1234' } as any));
    await waitUntil(() => customersOf(phone).find(c => c.id === id)?.phone === '7000-1234');
  });

  it('propagates deletes as tombstones and never resurrects with an older upsert', async () => {
    phone.store.dispatch(addCustomer(customerInput('company_phone', 'Dora')));
    await phone.engine.startSession();
    await desktop.engine.startSession();
    await waitUntil(() => customersOf(desktop).length === 1);
    const id = customersOf(desktop)[0].id;

    await new Promise(resolve => setTimeout(resolve, 5));
    phone.store.dispatch(deleteCustomer(id));
    await waitUntil(() => customersOf(desktop).length === 0);
    expect(syncOf(desktop).versions[`customer:${id}`]).toMatchObject({ del: true, d: 'dev-phone' });
  });

  it('recovers from a relay cold start (epoch reset) with equal counts on both devices', async () => {
    phone.store.dispatch(addCustomer(customerInput('company_phone', 'Eva')));
    desktop.store.dispatch(addCustomer(customerInput('company_desktop', 'Fabio')));
    await phone.engine.startSession();
    await desktop.engine.startSession();
    await waitUntil(() => customersOf(phone).length === 2 && customersOf(desktop).length === 2);
    const firstEpoch = syncOf(phone).epoch;

    await phone.engine.stopSession();
    await desktop.engine.stopSession();
    relay.restart();

    phone.store.dispatch(addCustomer(customerInput('company_phone', 'Gil')));
    await phone.engine.startSession();
    await desktop.engine.startSession();
    await waitUntil(() => customersOf(phone).length === 3 && customersOf(desktop).length === 3);

    expect(syncOf(phone).epoch).not.toBe(firstEpoch);
    expect(syncOf(phone).epoch).toBe(syncOf(desktop).epoch);
  });

  it('keeps an acknowledged invoice Completada when a peer holds a stale pre-send copy', async () => {
    phone.store.dispatch(addInvoice(invoiceInput('company_phone', '00005', 'inv-5')));
    await phone.engine.startSession();
    await desktop.engine.startSession();
    await waitUntil(() => invoicesOf(desktop).length === 1);
    await phone.engine.stopSession();
    await desktop.engine.stopSession();

    // Phone gets MH acceptance; desktop (offline) keeps editing its pre-send copy afterwards.
    const id = invoicesOf(phone)[0].id;
    phone.store.dispatch(updateInvoice({ id, status: InvoiceStatus.Completada, receptionSeal: 'SEAL-5', controlNumber: 'DTE-01-M001P001-000000000000005' } as any));
    await new Promise(resolve => setTimeout(resolve, 5));
    desktop.store.dispatch(updateInvoice({ id, status: InvoiceStatus.Sincronizando } as any));

    await phone.engine.startSession();
    await desktop.engine.startSession();
    await waitUntil(() => invoicesOf(desktop)[0]?.status === InvoiceStatus.Completada);
    expect(invoicesOf(phone)[0].status).toBe(InvoiceStatus.Completada);
    expect(invoicesOf(desktop)[0]).toMatchObject({ receptionSeal: 'SEAL-5', controlNumber: 'DTE-01-M001P001-000000000000005' });
  });

  it('answers DataRequested so a late device catches up from an online peer (log already recycled)', async () => {
    phone.store.dispatch(addCustomer(customerInput('company_phone', 'Hugo')));
    await phone.engine.startSession();
    // Relay memory lost while the phone stays connected: the log no longer has Hugo.
    const epochBefore = relay.company(CO).epoch;
    relay.company(CO).log.length = 0;
    expect(relay.company(CO).epoch).toBe(epochBefore);

    await desktop.engine.startSession(); // fresh epoch for the desktop ⇒ QueryPeers(since '')
    await waitUntil(() => customersOf(desktop).some(c => c.firstName === 'Hugo'));
  });

  it('seeds the correlativo floor from peer maxima so same-type invoices never collide', async () => {
    phone.store.dispatch(addInvoice(invoiceInput('company_phone', '00118', 'inv-118')));
    await phone.engine.startSession();
    await desktop.engine.startSession();
    await waitUntil(() => (syncOf(desktop).correlativoMaxima['01'] ?? 0) >= 118);
    // DTESubmissionModal: sequential numeroControl starts at max(nextSequenceNumber, floor + 1).
    const floor = syncOf(desktop).correlativoMaxima['01'];
    expect(Math.max(1, floor + 1)).toBe(119);
  });

  it('surfaces relay-rejected envelopes and drops them from the outbox (never retried blindly)', async () => {
    phone.store.dispatch(addProduct(productFor('company_phone', 'prod-bad', 'Demasiado grande')));
    relay.rejectIds.set('prod-bad', 'payload_too_large');
    await phone.engine.startSession();
    expect(syncOf(phone).outbox['product:prod-bad']).toBeUndefined();
    expect(syncOf(phone).rejected[0]).toMatchObject({ key: 'product:prod-bad', reason: 'payload_too_large' });
  });
});

describe('SyncV2Engine — gating and failure modes', () => {
  it('never connects for Free or plain Pro (locked panel, zero traffic)', async () => {
    for (const tier of [SubscriptionTier.Lite, SubscriptionTier.AdFree, SubscriptionTier.Pro]) {
      const relay = new FakeRelay();
      const device = createTestDevice(relay, { name: 'free', deviceId: 'dev-free', companyId: 'c1', tier });
      device.store.dispatch(addCustomer(customerInput('c1', 'Iris')));
      expect(await device.engine.startSession()).toMatchObject({ ok: false, reason: 'locked' });
      expect(device.connections).toHaveLength(0);
      expect(relay.calls).toHaveLength(0);
      expect(device.store.getState().syncV2.companies[CO]).toBeUndefined(); // nothing captured
      expect(device.store.getState().syncV2.status).toBe('locked');
    }
  });

  it('starts for Enterprise as well as Pro+Sync', async () => {
    const relay = new FakeRelay();
    const device = createTestDevice(relay, { name: 'ent', deviceId: 'dev-ent', companyId: 'c1', tier: SubscriptionTier.Enterprise });
    expect(await device.engine.startSession()).toMatchObject({ ok: true });
    await device.engine.stopSession();
  });

  it('stops and clears the entitlement when the relay answers forbidden', async () => {
    const relay = new FakeRelay();
    relay.forbidden = true;
    const device = createTestDevice(relay, { name: 'x', deviceId: 'dev-x', companyId: 'c1' });
    const outcome = await device.engine.startSession();
    expect(outcome).toMatchObject({ ok: false, reason: 'forbidden' });
    expect(device.store.getState().syncV2.entitled).toBe(false);
    expect(relay.calls.map(call => call.method)).toEqual(['Register']);
    expect(device.engine.isLive()).toBe(false);
  });

  it('requires a signed-in JWT', async () => {
    const relay = new FakeRelay();
    const device = createTestDevice(relay, { name: 'x', deviceId: 'dev-x', companyId: 'c1', token: null });
    expect(await device.engine.startSession()).toMatchObject({ ok: false, reason: 'no-token' });
    expect(device.connections).toHaveLength(0);
  });

  it('staggers the EpochReset re-seed inside the 0–30 s window', async () => {
    const relay = new FakeRelay();
    const device = createTestDevice(relay, {
      name: 'x', deviceId: 'dev-x', companyId: 'c1', staggerMaxMs: 30_000, random: () => 0.5,
    });
    await device.engine.startSession();
    device.connections[0].deliver('EpochReset', CO, 'epoch-new');
    await settle();
    const staggerTimer = device.timers.find(timer => timer.delay === 15_000);
    expect(staggerTimer).toBeDefined();
    device.timers.forEach(timer => {
      expect(timer.delay).toBeGreaterThanOrEqual(0);
      expect(timer.delay).toBeLessThanOrEqual(30_000);
    });
    await waitUntil(() => device.store.getState().syncV2.companies[CO]?.epoch === 'epoch-new' || relay.calls.filter(c => c.method === 'Register').length >= 2);
    await device.engine.stopSession();
  });

  it('keeps captured changes across a simulated restart and pushes them next session', async () => {
    const relay = new FakeRelay();
    const device = createTestDevice(relay, { name: 'x', deviceId: 'dev-x', companyId: 'c1' });
    device.store.dispatch(addCustomer(customerInput('c1', 'Julia')));
    const persistedSync = device.store.getState().syncV2;
    expect(Object.keys(persistedSync.companies[CO].outbox)).toHaveLength(1);

    // "Process death": a fresh engine over the same (rehydrated) state.
    const reborn = createTestDevice(relay, { name: 'x2', deviceId: 'dev-x', companyId: 'c1' });
    reborn.store.dispatch({ type: 'customers/hydrateCustomers', payload: device.store.getState().customers.customers });
    reborn.store.dispatch({ type: 'syncV2/recordLocalChanges', payload: { co: CO, deviceId: 'dev-x', changes: Object.values(persistedSync.companies[CO].outbox) } });
    await reborn.engine.startSession();
    const pushed = relay.company(CO).log.filter(entry => entry.change.t === 'customer');
    expect(pushed).toHaveLength(1);
    await reborn.engine.stopSession();
  });
});

describe('SyncV2Engine — connection lifecycle', () => {
  it('replaces a connection stuck in Reconnecting when the user taps Sincronizar again (relay cold start)', async () => {
    const relay = new FakeRelay();
    const device = createTestDevice(relay, { name: 'x', deviceId: 'dev-x', companyId: 'c1' });
    expect(await device.engine.startSession()).toMatchObject({ ok: true });

    // Relay process restarts: the client socket drops into automatic-reconnect limbo.
    device.connections[0].state = 'Reconnecting';
    relay.connections.delete(device.connections[0]);
    relay.restart();

    const outcome = await device.engine.startSession();
    expect(outcome).toMatchObject({ ok: true });
    expect(device.connections).toHaveLength(2);
    expect(device.connections[1].state).toBe('Connected');
    // The fresh connection registered under the relay's NEW epoch.
    expect(device.store.getState().syncV2.companies[CO].epoch).toBe(relay.company(CO).epoch);
    await device.engine.stopSession();
  });

  it('reports this session\'s lastSyncAt in the closing manifest', async () => {
    const relay = new FakeRelay();
    const device = createTestDevice(relay, { name: 'x', deviceId: 'dev-x', companyId: 'c1' });
    await device.engine.startSession();
    const manifest = relay.company(CO).manifests.get('dev-x');
    expect(manifest?.lastSyncAt).toBe(device.store.getState().syncV2.companies[CO].lastSyncAt);
    expect(manifest?.lastSyncAt).not.toBeNull();
    await device.engine.stopSession();
  });

  it('a stopSession while the socket is still connecting does not resurrect the session', async () => {
    const relay = new FakeRelay();
    const store = createSyncTestStore();
    store.dispatch(hydrateCompanies([makeCompany('c1')]));
    store.dispatch(setTier(SubscriptionTier.ProSync));
    store.dispatch(setSyncDeviceId('dev-x'));

    // A connection whose start() only resolves when the test releases it — the
    // scale-to-zero relay waking up while the user acts elsewhere in the app.
    const connections: FakeConnection[] = [];
    let releaseStart: (() => void) | null = null;
    const env: SyncV2Environment = {
      baseUrl: 'http://relay.test',
      getToken: async () => 'test-token',
      getDeviceId: async () => 'dev-x',
      createConnection: () => {
        const connection = new FakeConnection(relay);
        const open = connection.start.bind(connection);
        connection.start = () => new Promise<void>(resolve => {
          releaseStart = () => { void open().then(resolve); };
        });
        connections.push(connection);
        return connection;
      },
      createRestClient: () => relay.restClient(),
      platform: 'desktop',
      appVersion: '1.0.40',
      staggerMaxMs: 0,
      flushDebounceMs: 0,
      now: () => new Date(),
      random: () => 0,
      setTimer: (callback, ms) => setTimeout(callback, ms),
      clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    const engine = new SyncV2Engine(store, env);

    const starting = engine.startSession();
    await settle(3); // runStart reaches connection.start() and parks there
    expect(releaseStart).not.toBeNull();

    // Sign-out / entitlement lost while the socket is still connecting.
    await engine.stopSession();
    expect(store.getState().syncV2.status).toBe('idle');

    releaseStart!();
    const outcome = await starting;
    expect(outcome.ok).toBe(false);
    // The session the stop closed stays closed: never registered, never live, and no
    // late 'connecting'/'live' status overwrite for the signed-out app.
    expect(relay.calls).toHaveLength(0);
    expect(engine.isLive()).toBe(false);
    expect(connections[0].started).toBe(false);
    expect(store.getState().syncV2.status).toBe('idle');
  });

  it('a stopSession while the session loop runs does not publish a late live status', async () => {
    const relay = new FakeRelay();
    const store = createSyncTestStore();
    store.dispatch(hydrateCompanies([makeCompany('c1')]));
    store.dispatch(setTier(SubscriptionTier.ProSync));
    store.dispatch(setSyncDeviceId('dev-x'));

    const env: SyncV2Environment = {
      baseUrl: 'http://relay.test',
      getToken: async () => 'test-token',
      getDeviceId: async () => 'dev-x',
      createConnection: () => new FakeConnection(relay),
      createRestClient: () => relay.restClient(),
      platform: 'desktop',
      appVersion: '1.0.40',
      staggerMaxMs: 0,
      flushDebounceMs: 0,
      now: () => new Date(),
      random: () => 0,
      setTimer: (callback, ms) => setTimeout(callback, ms),
      clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    const engine = new SyncV2Engine(store, env);

    // Pull hangs until released: the session loop is mid-flight when the stop lands.
    let releasePull: (() => void) | null = null;
    relay.hangPull = () => new Promise<void>(resolve => { releasePull = resolve; });
    const starting = engine.startSession();
    await waitUntil(() => releasePull !== null);
    expect(store.getState().syncV2.status).toBe('syncing');

    await engine.stopSession();
    releasePull!();
    const outcome = await starting;
    expect(outcome.ok).toBe(false);
    expect(engine.isLive()).toBe(false);
    // The stop's 'idle' is the final word — not a late 'error'/'live' from the loop.
    expect(store.getState().syncV2.status).toBe('idle');
  });
});

describe('SyncV2Engine — count-mismatch digest reconcile', () => {
  it('repairs a divergence the log cannot see: same epoch + cursor, different counts → digest exchange', async () => {
    const relay = new FakeRelay();
    const phone = createTestDevice(relay, { name: 'phone', deviceId: 'dev-phone', companyId: 'company_phone' });
    const desktop = createTestDevice(relay, { name: 'desktop', deviceId: 'dev-desktop', companyId: 'company_desktop' });
    phone.store.dispatch(addCustomer(customerInput('company_phone', 'Ana')));
    await phone.engine.startSession();
    await desktop.engine.startSession();
    await waitUntil(() => customersOf(desktop).length === 1);
    // Both devices caught up to the same head (the count check needs equal cursors).
    await waitUntil(() => syncOf(phone).cursor === String(relay.company(CO).seq) && syncOf(desktop).cursor === String(relay.company(CO).seq), 400);

    // A record that exists on the desktop but never went through the log (e.g. restored
    // from a backup): invisible to cursors, only counts reveal it.
    desktop.store.dispatch({ type: 'customers/syncUpsertCustomer', payload: {
      id: 'restored-1', firstName: 'Restaurado', lastName: 'Backup', companyId: 'company_desktop', nationalId: '', nit: '',
      email: 'r@test.com', phone: '1', documentType: '13', updatedAt: '2026-09-24T12:00:00.000Z',
    } });
    // The desktop re-registers (e.g. the user taps Sincronizar) → PeersChanged carries its counts.
    await desktop.engine.startSession();

    await waitUntil(() => customersOf(phone).some(c => c.firstName === 'Restaurado'), 400);
    expect(relay.calls.some(call => call.method === 'RequestDigest' && call.deviceId === 'dev-phone')).toBe(true);
    expect(relay.calls.some(call => call.method === 'Digest' && call.deviceId === 'dev-desktop')).toBe(true);
    await waitUntil(() => syncOf(phone).pendingVerify.length === 0, 400);
    await phone.engine.stopSession();
    await desktop.engine.stopSession();
  });

  it('marks "Pendiente de verificar" when the relay has no digest support', async () => {
    const relay = new FakeRelay();
    relay.supportsDigest = false;
    const phone = createTestDevice(relay, { name: 'phone', deviceId: 'dev-phone', companyId: 'company_phone' });
    const desktop = createTestDevice(relay, { name: 'desktop', deviceId: 'dev-desktop', companyId: 'company_desktop' });
    await phone.engine.startSession();
    await desktop.engine.startSession();
    await waitUntil(() => syncOf(phone).cursor === String(relay.company(CO).seq) && syncOf(desktop).cursor === String(relay.company(CO).seq), 400);
    desktop.store.dispatch({ type: 'customers/syncUpsertCustomer', payload: {
      id: 'restored-2', firstName: 'Solo', lastName: 'Escritorio', companyId: 'company_desktop', nationalId: '', nit: '',
      email: 's@test.com', phone: '1', documentType: '13', updatedAt: '2026-09-24T12:00:00.000Z',
    } });
    await desktop.engine.startSession();
    await waitUntil(() => (syncOf(phone)?.pendingVerify ?? []).includes('customer'), 400);
    await phone.engine.stopSession();
    await desktop.engine.stopSession();
  });
});

describe('SyncV2Engine — EpochReset idempotence', () => {
  it('ignores an EpochReset for the epoch it already adopted at Register (no double snapshot)', async () => {
    const relay = new FakeRelay();
    const device = createTestDevice(relay, { name: 'x', deviceId: 'dev-x', companyId: 'c1' });
    device.store.dispatch(addCustomer(customerInput('c1', 'Única')));
    await device.engine.startSession();
    const pushesBefore = relay.calls.filter(call => call.method === 'Push').length;
    const current = device.store.getState().syncV2.companies[CO].epoch!;
    device.connections[0].deliver('EpochReset', CO, current);
    await settle();
    expect(relay.calls.filter(call => call.method === 'Push').length).toBe(pushesBefore);
    await device.engine.stopSession();
  });
});

describe('SyncV2Engine — push batching', () => {
  it('cuts pushes by byte budget as well as count (SignalR message-size caps)', async () => {
    const relay = new FakeRelay();
    const device = createTestDevice(relay, { name: 'x', deviceId: 'dev-x', companyId: 'c1' });
    // ~60 customers with ~9 KB of incompressible notes each ≈ 700 KB of payload.
    let seed = 11;
    const noise = () => {
      let text = '';
      for (let i = 0; i < 9000; i++) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        text += String.fromCharCode(33 + ((seed >>> 0) % 90));
      }
      return text;
    };
    for (let i = 0; i < 60; i++) {
      device.store.dispatch(addCustomer({ ...customerInput('c1', `Cliente${i}`), address: noise() } as any));
    }
    await device.engine.startSession();
    const pushes = relay.calls.filter(call => call.method === 'Push');
    expect(pushes.length).toBeGreaterThan(1);
    for (const push of pushes) {
      const bytes = (push.args[1] as { p: string; id: string }[]).reduce((sum, env) => sum + env.p.length + env.id.length + 160, 0);
      expect(bytes).toBeLessThanOrEqual(256 * 1024);
    }
    const pushedCustomers = relay.company(CO).log.filter(entry => entry.change.t === 'customer');
    expect(pushedCustomers).toHaveLength(60);
    expect(Object.keys(device.store.getState().syncV2.companies[CO].outbox)).toHaveLength(0);
    await device.engine.stopSession();
  });
});

describe('SyncV2Engine — reviewed relay contract (2026-09-25)', () => {
  it('backs off and retries the same batch when the relay answers rate_limited', async () => {
    const relay = new FakeRelay();
    const device = createTestDevice(relay, { name: 'x', deviceId: 'dev-x', companyId: 'c1' });
    device.store.dispatch(addCustomer(customerInput('c1', 'Paciente')));
    relay.rateLimitedPushes = 2;

    expect(await device.engine.startSession()).toMatchObject({ ok: true });
    expect(relay.company(CO).log.filter(entry => entry.change.t === 'customer')).toHaveLength(1);
    expect(Object.keys(device.store.getState().syncV2.companies[CO].outbox)).toHaveLength(0);
    // 1 s, then 2 s back-off (the relay's window is 10 s; big snapshots on fast links trip it).
    expect(device.timers.map(timer => timer.delay)).toEqual(expect.arrayContaining([1000, 2000]));
    await device.engine.stopSession();
  });

  it('gives up after the bounded retries and keeps the outbox for the next session', async () => {
    const relay = new FakeRelay();
    const device = createTestDevice(relay, { name: 'x', deviceId: 'dev-x', companyId: 'c1' });
    device.store.dispatch(addCustomer(customerInput('c1', 'Insistente')));
    relay.rateLimitedPushes = 100;

    expect(await device.engine.startSession()).toMatchObject({ ok: false });
    expect(Object.keys(device.store.getState().syncV2.companies[CO].outbox).some(key => key.startsWith('customer:'))).toBe(true);
    expect(device.store.getState().syncV2.lastError).toContain('rate_limited');
    await device.engine.stopSession();
  });

  it('asks peers for everything when the pull says the relay log was trimmed (truncated)', async () => {
    const relay = new FakeRelay();
    const phone = createTestDevice(relay, { name: 'phone', deviceId: 'dev-phone', companyId: 'company_phone' });
    const desktop = createTestDevice(relay, { name: 'desktop', deviceId: 'dev-desktop', companyId: 'company_desktop' });
    phone.store.dispatch(addCustomer(customerInput('company_phone', 'Primera')));
    await phone.engine.startSession();
    await desktop.engine.startSession();
    await waitUntil(() => customersOf(desktop).length === 1);
    await desktop.engine.stopSession();

    // The desktop is away while the phone produces more than the relay keeps.
    relay.maxLogEntries = 2;
    for (const name of ['B', 'C', 'D', 'E']) phone.store.dispatch(addCustomer(customerInput('company_phone', name)));
    await waitUntil(() => Object.keys(syncOf(phone).outbox).length === 0);
    expect(relay.company(CO).log).toHaveLength(2); // the desktop's cursor now points before the oldest entry
    relay.maxLogEntries = Number.POSITIVE_INFINITY;

    relay.calls.length = 0;
    await desktop.engine.startSession();
    const query = relay.calls.find(call => call.method === 'QueryPeers' && call.deviceId === 'dev-desktop' && call.args[1] === '');
    expect(query).toBeDefined();
    await waitUntil(() => customersOf(desktop).length === 5);
    await phone.engine.stopSession();
    await desktop.engine.stopSession();
  });

  it('re-seeds exactly once when the relay signals EpochReset on a stale Register', async () => {
    const relay = new FakeRelay();
    const device = createTestDevice(relay, { name: 'x', deviceId: 'dev-x', companyId: 'c1' });
    device.store.dispatch(addCustomer(customerInput('c1', 'Semilla')));
    await device.engine.startSession();
    await device.engine.stopSession();
    relay.restart();

    relay.calls.length = 0;
    await device.engine.startSession();
    await settle(50);
    const snapshotPushes = relay.calls.filter(call => call.method === 'Push');
    expect(snapshotPushes).toHaveLength(1);
    expect(relay.company(CO).log.filter(entry => entry.change.t === 'customer')).toHaveLength(1);
    await device.engine.stopSession();
  });

  it('shows a newcomer online and drops a device that left (PeersChanged carries the online list)', async () => {
    const relay = new FakeRelay();
    const phone = createTestDevice(relay, { name: 'phone', deviceId: 'dev-phone', companyId: 'company_phone' });
    const desktop = createTestDevice(relay, { name: 'desktop', deviceId: 'dev-desktop', companyId: 'company_desktop' });
    const onlineOn = (device: TestDevice) => device.store.getState().syncV2.onlineByCo[CO] ?? [];

    await phone.engine.startSession();
    await desktop.engine.startSession();
    await waitUntil(() => onlineOn(phone).includes('dev-desktop'));
    expect(onlineOn(phone)).not.toContain('dev-phone');

    await desktop.engine.stopSession();
    await waitUntil(() => !onlineOn(phone).includes('dev-desktop'));
    await phone.engine.stopSession();
  });
});
