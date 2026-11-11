// CarwashOutbox — durable, ordered queue of carwash writes.
//
// Entries replay in `seq` order with their idempotency key, so a flush that is
// interrupted (crash, offline) can be repeated safely. Outcomes per entry:
//   - network error / 5xx / 408 / 429 → stop, keep entry (retry next flush)
//   - 401                             → stop, keep entry (session expired)
//   - 409 on walk-in with a `job` body for the same ticket/plate → success
//   - other 4xx                       → entry marked `failed` (+ lastError), flush continues
// A successful walk-in remaps its `local-…` id to the server id in every later
// queued op and in `idMap`, which the caller uses to replace the local job.

import { appStorage } from '../storage/ElectronStorage';
import { CarwashApiError, type CarwashClientLike } from './CarwashApiClient';
import {
  isLocalJobId,
  type CarwashOutboxEntry,
  type CarwashOutboxOp,
  type JobView,
} from './types';

export const CARWASH_OUTBOX_KEY = 'carwash_outbox_v1';

export interface OutboxStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface OutboxDeps {
  storage?: OutboxStorage;
  now?: () => Date;
  uuid?: () => string;
}

export type FlushStop = 'network' | 'unauthorized' | 'server' | null;

export interface FlushResult {
  /** Entries delivered (including 409-with-job successes). */
  sent: number;
  /** Latest server copy of each job touched by this flush. */
  jobs: JobView[];
  /** local job id → server job id for walk-ins delivered in this flush. */
  idMap: Record<string, string>;
  /** Entries newly marked failed in this flush. */
  failed: CarwashOutboxEntry[];
  stopped: FlushStop;
  /** Non-failed entries still waiting. */
  remaining: number;
}

interface PersistedOutbox {
  version: 1;
  nextSeq: number;
  entries: CarwashOutboxEntry[];
  idMap: Record<string, string>;
}

function defaultUuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function normalizePlate(plate: string): string {
  return String(plate ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function opJobId(op: CarwashOutboxOp): string | null {
  return op.kind === 'walk-in' ? null : op.jobId;
}

function withJobId(op: CarwashOutboxOp, jobId: string): CarwashOutboxOp {
  return op.kind === 'walk-in' ? op : ({ ...op, jobId } as CarwashOutboxOp);
}

function describeError(err: unknown): string {
  if (err instanceof CarwashApiError) return err.message;
  return err instanceof Error ? err.message : 'Error desconocido';
}

export class CarwashOutbox {
  private readonly storage: OutboxStorage;
  private readonly now: () => Date;
  private readonly uuid: () => string;
  private state: PersistedOutbox = { version: 1, nextSeq: 1, entries: [], idMap: {} };
  private loaded: Promise<void> | null = null;
  private flushChain: Promise<unknown> = Promise.resolve();
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(deps: OutboxDeps = {}) {
    this.storage = deps.storage ?? appStorage;
    this.now = deps.now ?? (() => new Date());
    this.uuid = deps.uuid ?? defaultUuid;
  }

  load(): Promise<void> {
    if (!this.loaded) {
      this.loaded = (async () => {
        try {
          const raw = await this.storage.getItem(CARWASH_OUTBOX_KEY);
          if (!raw) return;
          const parsed = JSON.parse(raw) as Partial<PersistedOutbox>;
          if (!Array.isArray(parsed.entries)) return;
          const entries = parsed.entries.filter((e) => e && typeof e.seq === 'number' && e.op).sort((a, b) => a.seq - b.seq);
          const maxSeq = entries.reduce((m, e) => Math.max(m, e.seq), 0);
          this.state = {
            version: 1,
            entries,
            idMap: parsed.idMap && typeof parsed.idMap === 'object' ? parsed.idMap : {},
            nextSeq: Math.max(Number(parsed.nextSeq) || 1, maxSeq + 1),
          };
        } catch {
          /* corrupt outbox: start empty rather than blocking the app */
        }
      })();
    }
    return this.loaded;
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.state);
    const write = this.writeChain.then(() => this.storage.setItem(CARWASH_OUTBOX_KEY, snapshot));
    this.writeChain = write.catch(() => undefined);
    return write;
  }

  async list(): Promise<CarwashOutboxEntry[]> {
    await this.load();
    return this.state.entries.map((e) => ({ ...e }));
  }

  async pendingCount(): Promise<number> {
    await this.load();
    return this.state.entries.filter((e) => !e.failed).length;
  }

  async failedEntries(): Promise<CarwashOutboxEntry[]> {
    await this.load();
    return this.state.entries.filter((e) => e.failed).map((e) => ({ ...e }));
  }

  /** Server id a local id was remapped to (survives restarts), or the id itself. */
  async resolveJobId(id: string): Promise<string> {
    await this.load();
    return this.state.idMap[id] ?? id;
  }

  async enqueue(op: CarwashOutboxOp): Promise<CarwashOutboxEntry> {
    await this.load();
    const jobId = opJobId(op);
    const mapped = jobId ? this.state.idMap[jobId] : undefined;
    const entry: CarwashOutboxEntry = {
      id: this.uuid(),
      seq: this.state.nextSeq++,
      idempotencyKey: this.uuid(),
      createdAt: this.now().toISOString(),
      attempts: 0,
      lastError: null,
      op: mapped ? withJobId(op, mapped) : op,
    };
    this.state.entries.push(entry);
    await this.persist();
    return { ...entry };
  }

  /** Re-arms failed entries (e.g. a "reintentar" button). */
  async retryFailed(entryId?: string): Promise<void> {
    await this.load();
    for (const e of this.state.entries) {
      if (e.failed && (!entryId || e.id === entryId)) {
        e.failed = false;
        e.lastError = null;
      }
    }
    await this.persist();
  }

  async discard(entryId: string): Promise<void> {
    await this.load();
    this.state.entries = this.state.entries.filter((e) => e.id !== entryId);
    await this.persist();
  }

  async clear(): Promise<void> {
    await this.load();
    this.state = { version: 1, nextSeq: this.state.nextSeq, entries: [], idMap: {} };
    await this.persist();
  }

  /** Flushes run one after another, so a flush requested mid-flight also sees entries enqueued meanwhile. */
  flush(client: CarwashClientLike): Promise<FlushResult> {
    const run = this.flushChain.then(() => this.runFlush(client));
    this.flushChain = run.catch(() => undefined);
    return run;
  }

  private nextReady(): CarwashOutboxEntry | undefined {
    return this.state.entries.find((e) => !e.failed);
  }

  private async runFlush(client: CarwashClientLike): Promise<FlushResult> {
    await this.load();
    const result: FlushResult = { sent: 0, jobs: [], idMap: {}, failed: [], stopped: null, remaining: 0 };
    const latest = new Map<string, JobView>();

    for (;;) {
      const entry = this.nextReady();
      if (!entry) break;

      // Rewrite a local id that already has a server id (walk-in delivered earlier).
      const jobId = opJobId(entry.op);
      if (jobId && isLocalJobId(jobId)) {
        const mapped = this.state.idMap[jobId];
        if (mapped) entry.op = withJobId(entry.op, mapped);
        else {
          entry.failed = true;
          entry.lastError = 'El servicio local no se pudo sincronizar';
          result.failed.push({ ...entry });
          await this.persist();
          continue;
        }
      }

      try {
        const job = await this.send(client, entry);
        this.state.entries = this.state.entries.filter((e) => e.id !== entry.id);
        result.sent += 1;
        if (job) {
          latest.set(job.id, job);
          if (entry.op.kind === 'walk-in') this.remapLocalId(entry.op.localJobId, job.id, result);
        }
        await this.persist();
      } catch (err) {
        entry.attempts += 1;
        entry.lastError = describeError(err);
        if (err instanceof CarwashApiError) {
          if (err.isNetwork) {
            result.stopped = 'network';
          } else if (err.status === 401) {
            result.stopped = 'unauthorized';
          } else if (err.status >= 500 || err.status === 408 || err.status === 429) {
            result.stopped = 'server';
          } else {
            entry.failed = true;
            result.failed.push({ ...entry });
          }
        } else {
          result.stopped = 'network';
        }
        await this.persist();
        if (result.stopped) break;
      }
    }

    result.jobs = [...latest.values()];
    result.remaining = this.state.entries.filter((e) => !e.failed).length;
    return result;
  }

  private remapLocalId(localId: string, serverId: string, result: FlushResult): void {
    if (localId === serverId) return;
    this.state.idMap[localId] = serverId;
    result.idMap[localId] = serverId;
    for (const e of this.state.entries) {
      if (opJobId(e.op) === localId) e.op = withJobId(e.op, serverId);
    }
  }

  private async send(client: CarwashClientLike, entry: CarwashOutboxEntry): Promise<JobView | null> {
    const op = entry.op;
    const key = entry.idempotencyKey;
    switch (op.kind) {
      case 'walk-in':
        try {
          return await client.createWalkIn(op.input, key);
        } catch (err) {
          if (err instanceof CarwashApiError && err.status === 409) {
            const existing = (err.body as { job?: JobView } | null)?.job;
            if (
              existing &&
              typeof existing === 'object' &&
              (existing.ticketNumber === op.input.ticketNumber || normalizePlate(existing.plate) === normalizePlate(op.input.plate))
            ) {
              return existing;
            }
          }
          throw err;
        }
      case 'transition':
        return client.transitionJob(op.jobId, op.status, key);
      case 'assign':
        return client.assignEmployee(op.jobId, op.employeeId, key);
      case 'ticket':
        return client.setJobTicket(op.jobId, op.ticketNumber, key);
      case 'payment':
        return client.recordPayment(op.jobId, op.payment, key);
    }
  }
}

export const carwashOutbox = new CarwashOutbox();
