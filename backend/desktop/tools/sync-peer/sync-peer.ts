/**
 * sync-peer.ts — headless Desktop device peer for centralized cross-device sync testing.
 *
 * Runs the REAL App.Desktop sync stack — SyncV2Engine, the capture middleware, the Redux
 * slices and the entity adapters — with no UI, so "the Desktop app" can join a test relay
 * from a container or CI alongside the Android emulator (Detox) and the Invoices.SyncApi
 * relay. The Playwright suites drive the real Electron app; this harness is the cheap,
 * always-on stand-in for matrix scenarios (e.g. stock changing on the phone shows up here,
 * and vice versa) where rendering a whole Desktop is not the point.
 *
 * What is real: engine session loop, capture seam, merge/apply path, wire codec, digest.
 * What is simulated: nothing but the user — scenario steps dispatch the same actions the
 * UI dispatches (updateProduct, …) through the same middleware chain.
 *
 * Configuration (env):
 *   SYNC_PEER_URL          relay origin, e.g. http://127.0.0.1:5099 (required unless --selftest)
 *   SYNC_PEER_TOKEN        internal JWT; minted from SYNC_PEER_SIGNING_KEY when absent
 *   SYNC_PEER_SIGNING_KEY  HS256 key shared with the relay (test default in e2e helpers)
 *   SYNC_PEER_COMPANIES    company keys the token carries (default co06141404941342test)
 *   SYNC_PEER_TIER         token tier (default pro_sync)
 *   SYNC_PEER_NIT          NIT of the seeded company (default 06141404941342, Pruebas)
 *   SYNC_PEER_WAIT_MS      keep the session open this long for incoming changes (default 20000)
 *   SYNC_PEER_EXPECT_STOCK final stock assertion for uitest-product-001 (optional)
 *
 * Usage:
 *   npx tsx tools/sync-peer/sync-peer.ts --selftest        # no relay: store+capture plumbing
 *   npx tsx tools/sync-peer/sync-peer.ts                   # scenario against SYNC_PEER_URL
 *   docker compose -f tools/sync-peer/docker-compose.yml up --build   # relay + this peer
 */

import { configureStore, combineReducers, type AnyAction } from '@reduxjs/toolkit';
import * as signalR from '@microsoft/signalr';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SyncV2Engine, type SyncV2Environment, type SyncStore } from '../../src/services/sync/syncV2Service';
import type { PushResponse, SyncStatusResponse } from '../../src/services/sync/protocol';
import type { ChangeEnvelope, DeviceManifest } from '../../src/services/sync/protocol';
import { syncCaptureMiddleware } from '../../src/services/sync/capture';
import companyReducer, { hydrateCompanies, setSelectedCompany } from '../../src/store/slices/companySlice';
import productReducer, { addProduct, applyInvoiceStockDeduction } from '../../src/store/slices/productSlice';
import customerReducer from '../../src/store/slices/customerSlice';
import invoiceReducer from '../../src/store/slices/invoiceSlice';
import subscriptionReducer, { setTier } from '../../src/store/slices/subscriptionSlice';
import syncV2Reducer, { setSyncDeviceId } from '../../src/store/slices/syncV2Slice';

const PRODUCT_ID = 'uitest-product-001';
const DEFAULT_NIT = '06141404941342';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ─── token minting (same shape the relay validates; see RN e2e/helpers/SyncPeer.js) ───

function mintToken(signingKey: string, companies: string[], tier: string): string {
  const enc = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url').replace(/=+$/, '');
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT', kid: 'fs-sync-1' };
  const payload = {
    sub: 'desktop-sync-peer',
    tier,
    companies: JSON.stringify(companies),
    iss: 'fs-sync',
    aud: 'fs-sync',
    nbf: now,
    iat: now,
    exp: now + 6 * 3600,
  };
  const data = `${enc(header)}.${enc(payload)}`;
  const sig = createHmac('sha256', signingKey).update(data).digest('base64url');
  return `${data}.${sig}`;
}

/** Stable per-host device id so relaunches resume the same device row. */
function resolveDeviceId(): string {
  const fromEnv = process.env.SYNC_PEER_DEVICE_ID;
  if (fromEnv) return fromEnv;
  const file = join(tmpdir(), 'fs-sync-peer-device-id');
  try {
    if (existsSync(file)) return readFileSync(file, 'utf8').trim();
    const id = `desktop-peer-${randomUUID().slice(0, 8)}`;
    writeFileSync(file, id);
    return id;
  } catch {
    return `desktop-peer-${randomUUID().slice(0, 8)}`;
  }
}

// ─── REST fallback client (inline copy of syncV2Environment's — that module reads Vite env) ───

function createFetchRestClient(baseUrl: string, getToken: () => Promise<string | null>) {
  const origin = baseUrl.replace(/\/+$/, '');
  const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const token = await getToken();
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 401 || response.status === 403) {
      return { error: response.status === 403 ? 'forbidden' : 'unauthorized' } as T;
    }
    if (response.status === 429) return { error: 'rate_limited' } as T;
    if (!response.ok) throw new Error(`Sync HTTP ${response.status}`);
    return (await response.json()) as T;
  };

  return {
    push: async (co: string, changes: ChangeEnvelope[]): Promise<PushResponse> =>
      request('POST', `/api/v2/sync/${co}/push`, { co, changes }),
    status: async (co: string): Promise<SyncStatusResponse> => {
      const result = await request<unknown>('GET', `/api/v2/sync/${co}/status`);
      if (result && typeof result === 'object' && 'error' in result) {
        throw new Error(String((result as { error: unknown }).error));
      }
      return result as SyncStatusResponse;
    },
    putDevice: async (co: string, manifest: DeviceManifest): Promise<void> => {
      await request('PUT', `/api/v2/sync/${co}/devices/${encodeURIComponent(manifest.deviceId)}`, manifest);
    },
  };
}

// ─── the headless store: real reducers + the real capture seam ───

function buildStore() {
  return configureStore({
    reducer: combineReducers({
      companies: companyReducer,
      customers: customerReducer,
      products: productReducer,
      invoices: invoiceReducer,
      subscription: subscriptionReducer,
      syncV2: syncV2Reducer,
    }),
    middleware: getDefaultMiddleware =>
      getDefaultMiddleware({ serializableCheck: false }).concat(syncCaptureMiddleware),
  });
}

type PeerStore = ReturnType<typeof buildStore>;

interface PeerState {
  companies: { companies: Array<{ id: string; nit?: string; environment?: string }> };
  products: { products: Array<{ id: string; productName?: string; stock?: number; stockQuantity?: number }> };
  invoices: { invoices: unknown[] };
  syncV2: {
    deviceId: string | null;
    companies: Record<string, { outbox?: unknown[]; versions?: Record<string, unknown> }>;
  };
}

function dumpState(store: PeerStore) {
  const state = store.getState() as unknown as PeerState;
  const company = state.companies.companies[0];
  const perCompany = Object.entries(state.syncV2.companies ?? {})
    .filter(([co]) => co.includes((company?.nit ?? '').replace(/\D/g, '')))
    .map(([co, data]) => ({
      co,
      outbox: data?.outbox ? Object.keys(data.outbox).length : 0,
      versions: data?.versions ? Object.keys(data.versions).length : 0,
    }));
  return {
    company: company ? { id: company.id, nit: company.nit, environment: company.environment } : null,
    products: state.products.products.map(p => ({
      id: p.id,
      name: p.productName,
      stock: p.stock ?? p.stockQuantity ?? 0,
    })),
    invoiceCount: state.invoices.invoices.length,
    syncV2: perCompany,
  };
}

const log = (label: string, value: unknown) =>
  process.stdout.write(`[sync-peer] ${label} ${JSON.stringify(value)}\n`);

// ─── scenario ───

/**
 * The Desktop's completed sale: the SAME action InvoiceDetailPage dispatches when MH
 * accepts a DTE (mutates stock in place — companyId survives, which the capture seam
 * needs to map the product to its company group).
 */
function dispatchSale(store: PeerStore, units: number) {
  const now = new Date().toISOString();
  store.dispatch(
    applyInvoiceStockDeduction({
      invoiceId: `peer-sale-${now}`,
      items: [{ productId: PRODUCT_ID, quantity: units }],
      createdAt: now,
      createdBy: 'sync-peer',
    }) as unknown as AnyAction,
  );
}

function seedScenario(store: PeerStore, nit: string, deviceId: string) {
  const now = new Date().toISOString();
  store.dispatch(setTier('pro_sync'));
  store.dispatch(
    hydrateCompanies([
      {
        id: 'peer-company',
        nit,
        name: 'Empresa Pruebas Peer',
        isDefault: true,
        environment: 'TEST', // non-PRODUCTION ⇒ co{nit}test group, like the seeded apps
        createdAt: now,
        updatedAt: now,
      } as never,
    ]) as unknown as AnyAction,
  );
  store.dispatch(setSelectedCompany('peer-company') as unknown as AnyAction);
  store.dispatch(setSyncDeviceId(deviceId) as unknown as AnyAction);
  store.dispatch(
    addProduct({
      id: PRODUCT_ID,
      productName: 'Adaptador USB-C',
      description: 'Adaptador USB-C a HDMI y USB 3.0',
      unitPrice: 24.99,
      companyId: 'peer-company',
      tipoItem: '1',
      trackInventory: true,
      stock: 40,
      stockQuantity: 40,
      minStock: 8,
      lowStockThreshold: 8,
      createdAt: now,
      updatedAt: now,
    } as never) as unknown as AnyAction,
  );
}

async function main() {
  const selftest = process.argv.includes('--selftest');
  const relayUrl = process.env.SYNC_PEER_URL ?? '';
  const signingKey = process.env.SYNC_PEER_SIGNING_KEY ?? 'detox-sync-signing-key-0123456789abcdef';
  const companies = (process.env.SYNC_PEER_COMPANIES ?? 'co06141404941342test').split(',').map(s => s.trim()).filter(Boolean);
  const nit = process.env.SYNC_PEER_NIT ?? DEFAULT_NIT;
  const deviceId = resolveDeviceId();

  const store = buildStore();
  seedScenario(store, nit, deviceId);

  if (selftest) {
    // No relay: prove the store + capture plumbing (the deduction lands AND is captured).
    dispatchSale(store, 38);
    await sleep(100);
    const dump = dumpState(store);
    log('selftest-state', dump);
    const product = dump.products.find(p => p.id === PRODUCT_ID);
    if (!product || product.stock !== 2) {
      console.error('[sync-peer] selftest FAILED: expected stock 2 after the sale deduction');
      process.exit(1);
    }
    const outbox = dump.syncV2.reduce((total, entry) => total + entry.outbox, 0);
    if (outbox < 1) {
      console.error('[sync-peer] selftest FAILED: the deduction was not captured into the outbox');
      process.exit(1);
    }
    console.error('[sync-peer] selftest OK (store + sale deduction + capture run headless)');
    return;
  }

  if (!relayUrl) {
    console.error('[sync-peer] SYNC_PEER_URL is required (or pass --selftest)');
    process.exit(1);
  }

  const token =
    process.env.SYNC_PEER_TOKEN ?? mintToken(signingKey, companies, process.env.SYNC_PEER_TIER ?? 'pro_sync');

  const env: SyncV2Environment = {
    baseUrl: relayUrl,
    getToken: async () => token,
    getDeviceId: async () => deviceId,
    createConnection: (hubUrl, accessTokenFactory) =>
      new signalR.HubConnectionBuilder()
        .withUrl(hubUrl, {
          accessTokenFactory,
          skipNegotiation: true,
          transport: signalR.HttpTransportType.WebSockets,
        })
        .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
        .build(),
    createRestClient: (base, getToken) => createFetchRestClient(base, getToken),
    platform: 'desktop',
    appVersion: 'sync-peer-1.0',
    staggerMaxMs: 0,
    flushDebounceMs: 300,
    now: () => new Date(),
    random: Math.random,
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };

  const engine = new SyncV2Engine(store as unknown as SyncStore, env);

  // Container cell race: the relay container may still be booting when this peer
  // starts (compose `depends_on` waits for the container, not the listener).
  let first: Awaited<ReturnType<typeof engine.startSession>> | null = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    first = await engine.startSession();
    log(`session-attempt-${attempt}`, first);
    if (first.ok) break;
    if (first.reason !== 'offline' && first.reason !== 'error') break;
    await sleep(2000);
  }
  if (!first || !first.ok) {
    await engine.stopSession().catch(() => undefined);
    console.error(`[sync-peer] session failed: ${first?.reason} — ${first?.message}`);
    process.exit(1);
  }
  log('company-key', engine.activeCompanyKey());

  // The "sale": the Desktop completes an invoice for 38 units → stock 40 → 2.
  // dispatchSale uses the real deduction action ('products/applyInvoiceStockDeduction'
  // is in the capture allowlist), so the outbox grows exactly as in production.
  await sleep(800);
  dispatchSale(store, 38);

  // Live wait window: incoming phone changes apply through the open session.
  const waitMs = Number(process.env.SYNC_PEER_WAIT_MS ?? 20000);
  let lastDump = '';
  for (let waited = 0; waited < waitMs; waited += 1000) {
    await sleep(1000);
    const dump = JSON.stringify(dumpState(store));
    if (dump !== lastDump) {
      log('state', dumpState(store));
      lastDump = dump;
    }
  }
  log('state-final-before-stop', dumpState(store));

  await engine.stopSession({ flushViaRest: true });

  const finalDump = dumpState(store);
  log('final-state', finalDump);

  const expectStock = process.env.SYNC_PEER_EXPECT_STOCK?.trim() || undefined;
  if (expectStock !== undefined) {
    const product = finalDump.products.find(p => p.id === PRODUCT_ID);
    if (!product || product.stock !== Number(expectStock)) {
      console.error(
        `[sync-peer] FAILED: expected ${PRODUCT_ID} stock ${expectStock}, saw ${product?.stock ?? 'none'}`
      );
      process.exit(1);
    }
    console.error(`[sync-peer] assertion OK: ${PRODUCT_ID} stock === ${expectStock}`);
  }
}

main().catch(error => {
  console.error('[sync-peer] fatal:', error);
  process.exit(1);
});
