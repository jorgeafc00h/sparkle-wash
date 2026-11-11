/**
 * Device Sync v2 coded-UI fixtures (Desktop): a REAL local Invoices.SyncApi plus a Node
 * SignalR peer that plays the owner's Android phone. Mirrors the Detox helpers in
 * App.ReactNative/FacturasSimplesRN/e2e/helpers (SyncApiServer.js / SyncPeer.js) —
 * same token shape, same payload codec, same relay, so both suites cross the same wire.
 *
 * The relay is built from a snapshot copy of Invoices.Api/Invoices.SyncApi (never inside
 * that working tree) and served on 0.0.0.0:<port>. Env overrides: SYNC_API_PROJECT_DIR,
 * SYNC_E2E_PORT, SYNC_E2E_SIGNING_KEY, SYNC_E2E_EXTERNAL=1 (relay already running),
 * SYNC_E2E_REBUILD=1 (force a rebuild; otherwise it rebuilds when the relay source changes).
 */

import { execSync, spawn, type ChildProcess } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import * as signalR from '@microsoft/signalr';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const SYNC_SIGNING_KEY = process.env.SYNC_E2E_SIGNING_KEY || 'detox-sync-signing-key-0123456789abcdef';
// Playwright runs spec files on parallel worker processes that each start their
// own relay: default the port and work dir per TEST_WORKER_INDEX so workers
// never bind the same port or rmSync each other's publish dir mid-run. An
// explicit SYNC_E2E_PORT (external/shared-relay runs, sync-peer tooling) wins.
const WORKER_INDEX = Number(process.env.TEST_WORKER_INDEX || 0);
export const SYNC_PORT = Number(process.env.SYNC_E2E_PORT || 5099 + WORKER_INDEX);
/** Pruebas company NIT 0614-140494-134-2 — the same group key the Detox suite uses. */
export const SYNC_CO = 'co06141404941342test';

const PROJECT_DIR = process.env.SYNC_API_PROJECT_DIR
  || path.resolve(HERE, '../../../Invoices.Api/Invoices.SyncApi');
const WORK_DIR = path.join(os.tmpdir(), `fs-syncapi-e2e-w${WORKER_INDEX}`);
const PUBLISH_DIR = path.join(WORK_DIR, 'publish');
const EXTERNAL = process.env.SYNC_E2E_EXTERNAL === '1';

export const relayUrl = (): string => `http://localhost:${SYNC_PORT}`;

let child: ChildProcess | null = null;

/** Content hash of the relay sources — a cached publish is reused only while it matches. */
function sourceStamp(): string {
  const hash = crypto.createHash('sha1');
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === 'bin' || entry.name === 'obj') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else hash.update(path.relative(PROJECT_DIR, full)).update(fs.readFileSync(full));
    }
  };
  walk(PROJECT_DIR);
  return hash.digest('hex');
}

function buildRelay(): void {
  if (EXTERNAL) return;
  const stamp = sourceStamp();
  const stampFile = path.join(WORK_DIR, 'source.sha1');
  const cached = fs.existsSync(path.join(PUBLISH_DIR, 'Invoices.SyncApi.dll'))
    && fs.existsSync(stampFile) && fs.readFileSync(stampFile, 'utf8') === stamp;
  if (cached && process.env.SYNC_E2E_REBUILD !== '1') return;
  const source = path.join(WORK_DIR, 'src');
  fs.rmSync(WORK_DIR, { recursive: true, force: true });
  fs.mkdirSync(source, { recursive: true });
  execSync(`rsync -a --exclude bin --exclude obj "${PROJECT_DIR}/" "${source}/"`);
  execSync(`dotnet publish "${source}/Invoices.SyncApi.csproj" -c Release -o "${PUBLISH_DIR}" -nologo -v q`, {
    stdio: 'inherit',
    timeout: 300_000,
  });
  fs.writeFileSync(stampFile, stamp);
}

async function waitForHealth(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${relayUrl()}/health`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Invoices.SyncApi did not become healthy on ${relayUrl()}`);
}

export async function startRelay(): Promise<void> {
  if (EXTERNAL) return waitForHealth();
  buildRelay();
  // The durable store must be PER-START, not just per-worker: WORK_DIR (and with it
  // syncstore.db) survives between runs, so a later run's — or a later spec file's —
  // opening pull would replay stale entities and device manifests (specs match rows
  // by name and `.find()` the desktop device, so yesterday's rows break them). Wiping
  // on every start still exercises the real SQLite path, and keeps pro/11's relay
  // restart a genuine cold start (fresh epoch) as the spec describes.
  const dbPath = path.join(WORK_DIR, 'syncstore.db');
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
  child = spawn('dotnet', [path.join(PUBLISH_DIR, 'Invoices.SyncApi.dll')], {
    env: {
      ...process.env,
      ASPNETCORE_URLS: `http://0.0.0.0:${SYNC_PORT}`,
      ASPNETCORE_ENVIRONMENT: 'Development',
      Sync__JwtSigningKey: SYNC_SIGNING_KEY,
      // Per-worker durable store exercises the real SQLite path without
      // cross-worker contention (nolock single-writer stays per process).
      SYNC_DB_PATH: dbPath,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await waitForHealth();
}

export async function stopRelay(): Promise<void> {
  if (EXTERNAL || !child) return;
  const proc = child;
  child = null;
  await new Promise<void>((resolve) => {
    proc.once('exit', () => resolve());
    proc.kill('SIGTERM');
    setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* gone */ }
      resolve();
    }, 5000);
  });
}

/** HS256 token with the claims the relay authorizes on (companies = JSON-string claim). */
export function mintSyncToken(options: { companies?: string[]; tier?: string; sub?: string } = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT', kid: 'fs-sync-1' });
  const payload = encode({
    sub: options.sub ?? 'playwright-owner',
    tier: options.tier ?? 'pro_sync',
    companies: JSON.stringify(options.companies ?? [SYNC_CO]),
    iss: 'fs-sync',
    aud: 'fs-sync',
    nbf: now - 60,
    iat: now,
    exp: now + 3600,
  });
  const signature = crypto.createHmac('sha256', SYNC_SIGNING_KEY).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

const encodePayload = (payload: unknown) => zlib.gzipSync(Buffer.from(JSON.stringify(payload))).toString('base64');
const decodePayload = (p: string) => JSON.parse(zlib.gunzipSync(Buffer.from(p, 'base64')).toString('utf8'));

interface Received {
  change: { t: string; id: string; op: string; u: string; d: string; p: string };
  payload: Record<string, unknown> | null;
}

/** Node-side peer device (default: the owner's Android phone). */
export class SyncPeer {
  readonly deviceId = `pw-peer-${crypto.randomUUID()}`;
  private connection: signalR.HubConnection | null = null;
  private cursor = '0';
  private epoch: string | null = null;
  private readonly entities = new Map<string, { type: string; entity: Record<string, unknown> }>();
  readonly received = new Map<string, Received>();

  constructor(private readonly token = mintSyncToken(), private readonly co = SYNC_CO, private readonly platform = 'android') {}

  async connect(): Promise<this> {
    this.connection = new signalR.HubConnectionBuilder()
      .withUrl(`${relayUrl()}/hubs/sync`, { accessTokenFactory: () => this.token })
      .configureLogging(signalR.LogLevel.Warning)
      .build();
    this.connection.on('ChangesAvailable', () => { void this.pullAll().catch(() => undefined); });
    this.connection.on('PeersChanged', () => undefined);
    this.connection.on('DataRequested', (_co: string, _requester: string, since: string) => {
      void this.answerDataRequested(since).catch(() => undefined);
    });
    this.connection.on('EpochReset', () => undefined);
    await this.connection.start();
    return this;
  }

  manifest() {
    const counts: Record<string, number> = {};
    for (const key of this.entities.keys()) {
      const type = key.split(':')[0];
      counts[type] = (counts[type] ?? 0) + 1;
    }
    return {
      deviceId: this.deviceId,
      platform: this.platform,
      appVersion: '1.0.40',
      lastSyncAt: new Date().toISOString(),
      lastSeenId: this.cursor,
      epoch: this.epoch,
      lastLocalChangeAt: null,
      counts,
      maxCorrelativo: {},
    };
  }

  async register(): Promise<void> {
    const response = await this.connection!.invoke('Register', this.co, this.manifest());
    if (response?.error) throw new Error(`Register rejected: ${response.error}`);
    if (this.epoch !== response.epoch) {
      this.epoch = response.epoch;
      this.cursor = '0';
    }
  }

  private envelope(type: string, entity: Record<string, unknown>, op: 'upsert' | 'delete' = 'upsert') {
    const u = (entity.updatedAt as string) || new Date().toISOString();
    return {
      t: type,
      id: entity.id as string,
      op,
      u,
      d: this.deviceId,
      p: encodePayload(op === 'delete' ? { id: entity.id } : { ...entity, updatedAt: u }),
    };
  }

  async upsert(type: string, entity: Record<string, unknown>): Promise<void> {
    const stamped = { ...entity, updatedAt: (entity.updatedAt as string) || new Date().toISOString() };
    this.entities.set(`${type}:${String(entity.id)}`, { type, entity: stamped });
    await this.push([this.envelope(type, stamped)]);
  }

  async remove(type: string, id: string): Promise<void> {
    this.entities.delete(`${type}:${id}`);
    await this.push([this.envelope(type, { id, updatedAt: new Date().toISOString() }, 'delete')]);
  }

  private async push(envelopes: unknown[]): Promise<void> {
    const response = await this.connection!.invoke('Push', this.co, envelopes);
    if (response?.error) throw new Error(`Push rejected: ${response.error}`);
  }

  private async answerDataRequested(since: string): Promise<void> {
    const sinceMs = since ? Date.parse(since) : -Infinity;
    const envelopes = [...this.entities.values()]
      .filter(({ entity }) => Date.parse(entity.updatedAt as string) > sinceMs)
      .map(({ type, entity }) => this.envelope(type, entity));
    if (envelopes.length) await this.push(envelopes);
  }

  async pullAll(): Promise<void> {
    for (let guard = 0; guard < 100; guard++) {
      const response = await this.connection!.invoke('Pull', this.co, this.cursor, 500);
      if (response?.error) throw new Error(`Pull rejected: ${response.error}`);
      const entries: { id: string; change: Received['change'] }[] = response.entries ?? [];
      for (const entry of entries) {
        if (entry.change.d === this.deviceId) continue;
        this.received.set(`${entry.change.t}:${entry.change.id}`, {
          change: entry.change,
          payload: entry.change.op === 'upsert' ? decodePayload(entry.change.p) : null,
        });
      }
      if (entries.length === 0) break;
      this.cursor = entries[entries.length - 1].id;
      if (entries.length < 500) break;
    }
  }

  async waitForReceived(predicate: (value: Received) => boolean, timeoutMs = 30_000): Promise<Received> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await this.pullAll();
      for (const value of this.received.values()) {
        if (predicate(value)) return value;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('SyncPeer: the expected change never arrived from the Desktop app');
  }

  async status(): Promise<{ epoch: string; devices: { deviceId: string; platform: string; counts: Record<string, number> }[] }> {
    const response = await fetch(`${relayUrl()}/api/v2/sync/${this.co}/status`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!response.ok) throw new Error(`status HTTP ${response.status}`);
    return response.json();
  }

  async close(): Promise<void> {
    if (!this.connection) return;
    try { await this.connection.stop(); } catch { /* gone */ }
    this.connection = null;
  }
}
