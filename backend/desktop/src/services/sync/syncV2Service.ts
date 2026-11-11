// Device Sync v2 session engine (design D3/D5/D6, spec "User-initiated sync sessions").
//
// A session is user-initiated ("Sincronizar") or resumed on foreground:
//   connect (negotiate may cold-start the relay) → Register(manifest)
//   → [epoch changed ⇒ adopt + full snapshot] → push outbox (≤500/batch)
//   → Pull(cursor) until drained, applying through the merge engine (cursor committed
//     only after each page is applied) → QueryPeers(since) → ReportManifest → status.
// While the session stays open: debounced outbox flushes, live pulls on ChangesAvailable,
// answers to DataRequested, EpochReset recovery (0–30 s stagger) and digest reconcile.
// Every step runs on one serialized queue, so a live pull never interleaves with a flush.
//
// Transport and clock are injected (SyncV2Environment) — Jest drives two engines against
// an in-memory relay; production wires @microsoft/signalr + fetch.

import type { AnyAction } from '@reduxjs/toolkit';
import {
  adoptEpoch,
  ackOutbox,
  addConflicts,
  dropOutboxKeys,
  enqueueOutbox,
  mergeCorrelativoMaxima,
  pruneTombstones,
  recordRemoteVersions,
  rejectOutbox,
  sessionCompleted,
  setCursor,
  setPeers,
  setPendingVerify,
  setSyncDeviceId,
  setSyncEntitled,
  setSyncStatus,
  type CompanySyncState,
  type OutboxRef,
  type SyncV2State,
} from '../../store/slices/syncV2Slice';
import type { Company } from '@/types';
import { canUseDeviceSync } from '../subscription/FeatureGate';
import { getDeviceId } from './deviceId';
import { onOutboxChanged, SELF_DEVICE_PLACEHOLDER } from './capture';
import {
  applyDelete,
  applyUpsert,
  digestKeyFor,
  findLocalMatch,
  listLocalEntities,
  loadLocalEntity,
  maxCorrelativoByDocType,
  serializeForWire,
  type AdapterContext,
  type SyncReadableState,
} from './entityAdapters';
import { mergeChange, purchaseDedupeKey, type SyncConflict, type SyncEntity, type VersionMeta } from './mergeEngine';
import { decodePayload, encodePayload, PayloadTooLargeError } from './payloadCodec';
import { buildDigest, diffDigestItems, digestsMatch, parseDigestLines, type DigestItem } from './digestService';
import {
  companySyncKey,
  entityKey,
  HUB_EVENTS,
  HUB_METHODS,
  isHubError,
  parseEntityKey,
  SYNC_ENTITY_TYPES,
  SYNC_LIMITS,
  type ChangeEnvelope,
  type DeviceManifest,
  type EntityDigest,
  type HubErrorPayload,
  type LogEntry,
  type PullResponse,
  type PushResponse,
  type QueryPeersResponse,
  type RegisterResponse,
  type SyncEntityType,
  type SyncStatusResponse,
} from './protocol';

// ─── transport seams ───

export interface HubConnectionLike {
  /** SignalR HubConnectionState: 'Connected' | 'Connecting' | 'Reconnecting' | 'Disconnected' | … */
  readonly state?: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  invoke<T = unknown>(method: string, ...args: unknown[]): Promise<T>;
  on<Args extends unknown[]>(event: string, handler: (...args: Args) => void): void;
  off(event: string): void;
  onclose(callback: (error?: Error) => void): void;
  onreconnecting?(callback: (error?: Error) => void): void;
  onreconnected?(callback: (connectionId?: string) => void): void;
}

export interface SyncRestClient {
  push(co: string, changes: ChangeEnvelope[]): Promise<PushResponse>;
  status(co: string): Promise<SyncStatusResponse>;
  putDevice(co: string, manifest: DeviceManifest): Promise<void>;
}

export interface SyncV2Environment {
  /** Relay origin, e.g. https://sync.example.com — empty disables sync ("no configurado"). */
  baseUrl: string;
  getToken: () => Promise<string | null>;
  /** Per-install identity (default: AsyncStorage-backed deviceId.ts). */
  getDeviceId?: () => Promise<string>;
  createConnection: (hubUrl: string, accessTokenFactory: () => Promise<string>) => HubConnectionLike;
  createRestClient: (baseUrl: string, getToken: () => Promise<string | null>) => SyncRestClient;
  platform: DeviceManifest['platform'];
  appVersion: string;
  /** Upper bound of the EpochReset re-seed stagger (spec: 0–30 s). */
  staggerMaxMs: number;
  /** Debounce for outbox flushes while a session is open (spec: ≈2 s). */
  flushDebounceMs: number;
  now: () => Date;
  random: () => number;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

export interface SyncStore {
  getState: () => unknown;
  dispatch: (action: AnyAction) => unknown;
}

interface EngineState extends SyncReadableState {
  subscription?: { tier?: string };
  syncV2: SyncV2State;
}

export type SessionOutcome =
  | { ok: true; pulled: number; pushed: number }
  | { ok: false; reason: 'locked' | 'no-company' | 'no-token' | 'not-configured' | 'forbidden' | 'offline' | 'busy' | 'error'; message: string };

interface SessionContext extends AdapterContext {
  deviceId: string;
  /**
   * Session generation this context belongs to. Every stopSession() bumps the engine's
   * counter, so work started for an older generation can tell it was cancelled and must
   * not resurrect the session or overwrite the status the stop (sign-out, lost
   * entitlement, linger close) already published.
   */
  generation: number;
}

export const TOMBSTONE_RETENTION_DAYS = 90;
const PULL_DEBOUNCE_MS = 250;

export const SYNC_MESSAGES = {
  locked: 'La sincronización entre dispositivos está disponible en el plan Pro+Sync.',
  noCompany: 'Selecciona una empresa para sincronizar.',
  noToken: 'Inicia sesión con tu cuenta para sincronizar tus dispositivos.',
  notConfigured: 'El servicio de sincronización no está configurado.',
  forbidden: 'Tu cuenta no tiene acceso a sincronizar esta empresa (requiere Pro+Sync).',
  offline: 'No se pudo conectar con el servicio de sincronización. Tus cambios quedan guardados y se enviarán en la próxima sesión.',
} as const;

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : 'Error desconocido';

const toMillis = (iso: string | null | undefined): number => {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
};

export class SyncV2Engine {
  private connection: HubConnectionLike | null = null;
  private context: SessionContext | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private flushTimer: unknown = null;
  private pullTimer: unknown = null;
  private staggerTimer: unknown = null;
  private unsubscribeOutbox: (() => void) | null = null;
  private stopping = false;
  private starting: Promise<SessionOutcome> | null = null;
  /** Bumped by every stopSession — in-flight work for older generations is cancelled. */
  private sessionGeneration = 0;
  /** Digest repairs in flight: entity type → count the peer's digest reported. */
  private readonly repairTargets = new Map<SyncEntityType, number>();

  constructor(private readonly store: SyncStore, private readonly env: SyncV2Environment) {}

  // ─── public API ───

  isLive(): boolean {
    return this.connection !== null && this.context !== null;
  }

  activeCompanyKey(): string | null {
    return this.context?.co ?? null;
  }

  /** Starts (or re-runs, when already live) a sync session for the selected company. */
  startSession(): Promise<SessionOutcome> {
    if (this.starting) return this.starting;
    this.starting = this.runStart().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  /** Closes the session; optionally makes one opportunistic REST flush of the outbox first. */
  async stopSession(options: { flushViaRest?: boolean } = {}): Promise<void> {
    const context = this.context;
    this.stopping = true;
    this.sessionGeneration++;
    try {
      this.clearTimers();
      this.unsubscribeOutbox?.();
      this.unsubscribeOutbox = null;
      const connection = this.connection;
      this.connection = null;
      this.context = null;
      if (connection) {
        try {
          await connection.stop();
        } catch {
          // already closed
        }
      }
      if (options.flushViaRest && context && this.outboxRefs(context.co).length > 0) {
        await this.flushOutbox(context, 'rest').catch(() => undefined);
      }
      this.store.dispatch(setSyncStatus({ status: 'idle' }));
    } finally {
      this.stopping = false;
    }
  }

  // ─── session start ───

  private async runStart(): Promise<SessionOutcome> {
    const state = this.state();
    if (!canUseDeviceSync(state.subscription?.tier) && !state.syncV2.entitled) {
      this.store.dispatch(setSyncStatus({ status: 'locked' }));
      return { ok: false, reason: 'locked', message: SYNC_MESSAGES.locked };
    }
    if (!this.env.baseUrl) {
      this.store.dispatch(setSyncStatus({ status: 'error', error: SYNC_MESSAGES.notConfigured }));
      return { ok: false, reason: 'not-configured', message: SYNC_MESSAGES.notConfigured };
    }
    const company = this.selectedCompany(state);
    const co = companySyncKey(company);
    if (!company || !co) {
      this.store.dispatch(setSyncStatus({ status: 'error', error: SYNC_MESSAGES.noCompany }));
      return { ok: false, reason: 'no-company', message: SYNC_MESSAGES.noCompany };
    }
    const token = await this.env.getToken();
    if (!token) {
      this.store.dispatch(setSyncStatus({ status: 'error', error: SYNC_MESSAGES.noToken }));
      return { ok: false, reason: 'no-token', message: SYNC_MESSAGES.noToken };
    }

    // Session generation at entry: any stopSession that runs while this start awaits
    // (token/deviceId lookups, the company-switch stop below, connection.start) bumps
    // the engine's counter and cancels the start. Our OWN company-switch stop is the
    // one expected restart, so its result is adopted instead of treated as a cancel.
    let generation = this.sessionGeneration;

    const deviceId = await (this.env.getDeviceId ?? getDeviceId)();
    if (this.state().syncV2.deviceId !== deviceId) this.store.dispatch(setSyncDeviceId(deviceId));

    // A live session for another company is closed first; for the same company the
    // running connection is reused (the user tapped "Sincronizar" again).
    if (this.context && this.context.co !== co) {
      await this.stopSession();
      generation = this.sessionGeneration;
    }

    const context: SessionContext = {
      co,
      companyId: company.id,
      deviceId,
      generation,
      getState: () => this.state(),
      dispatch: action => this.store.dispatch(action as AnyAction),
    };
    if (this.sessionGeneration !== generation) {
      // stopSession already ran (e.g. during the token/deviceId lookups): do not even
      // publish 'connecting' — the stop owns the final status.
      return { ok: false, reason: 'error', message: 'La sesión se cerró mientras conectaba.' };
    }

    this.store.dispatch(setSyncStatus({ status: 'connecting' }));
    // A socket dropped by a relay restart sits in 'Reconnecting' (no onclose yet): reusing
    // it fails every invoke — start over on a fresh connection instead.
    if (this.connection && this.connection.state !== undefined && this.connection.state !== 'Connected') {
      const stale = this.connection;
      this.connection = null;
      this.stopping = true;
      try {
        await stale.stop();
      } catch {
        // already gone
      } finally {
        this.stopping = false;
      }
    }
    if (!this.connection) {
      const connection = this.env.createConnection(`${this.env.baseUrl.replace(/\/+$/, '')}/hubs/sync`, async () => (await this.env.getToken()) ?? '');
      this.attachHandlers(connection);
      try {
        await connection.start();
      } catch (error) {
        if (this.sessionGeneration !== context.generation) {
          // The start was already cancelled by stopSession — the failure status below
          // must not overwrite what the stop published.
          return { ok: false, reason: 'error', message: 'La sesión se cerró mientras conectaba.' };
        }
        this.store.dispatch(setSyncStatus({ status: 'offline', error: SYNC_MESSAGES.offline }));
        // Opportunistic REST flush — the relay may be reachable over plain HTTP.
        await this.flushOutbox(context, 'rest').catch(() => undefined);
        return { ok: false, reason: 'offline', message: `${SYNC_MESSAGES.offline} (${describeError(error)})` };
      }
      if (this.sessionGeneration !== context.generation) {
        // stopSession ran while the socket was connecting (sign-out, lost entitlement, …):
        // the session it closed must not resurrect from this late open — drop the socket
        // we just got and publish nothing (the stop already set the final status).
        try {
          await connection.stop();
        } catch {
          // already gone
        }
        return { ok: false, reason: 'error', message: 'La sesión se cerró mientras conectaba.' };
      }
      this.connection = connection;
    }
    this.context = context;

    const outcome = await this.enqueue(() => this.initialSync(context));
    if (this.sessionGeneration !== context.generation) return outcome;
    if (outcome.ok) {
      this.unsubscribeOutbox?.();
      this.unsubscribeOutbox = onOutboxChanged(() => this.scheduleFlush());
    } else if (outcome.reason === 'forbidden' || outcome.reason === 'error') {
      await this.stopSession();
      this.store.dispatch(setSyncStatus({ status: 'error', error: outcome.message }));
    }
    return outcome;
  }

  private async initialSync(context: SessionContext): Promise<SessionOutcome> {
    try {
      if (this.sessionGeneration === context.generation) {
        this.store.dispatch(setSyncStatus({ status: 'syncing' }));
      }
      this.store.dispatch(pruneTombstones({
        co: context.co,
        before: new Date(this.env.now().getTime() - TOMBSTONE_RETENTION_DAYS * 86_400_000).toISOString(),
      }));

      const registered = await this.register(context);
      if (!registered.ok) return registered;

      const pushed = await this.flushOutbox(context, 'hub');
      const pulled = await this.pullAll(context);

      const since = registered.freshEpoch ? '' : this.companyState(context.co).lastSyncAt ?? '';
      await this.queryPeers(context, since);
      // Complete first so the manifest peers see carries THIS session's lastSyncAt.
      this.store.dispatch(sessionCompleted({ co: context.co, at: this.env.now().toISOString() }));
      await this.reportManifest(context);
      await this.refreshStatus(context);

      // A stopSession while the loop ran already published the final status ('idle'/
      // 'locked') — a late 'live' here would wedge the panel for a signed-out user.
      if (this.sessionGeneration === context.generation) {
        this.store.dispatch(setSyncStatus({ status: 'live' }));
      }
      return { ok: true, pulled, pushed };
    } catch (error) {
      const message = describeError(error);
      if (this.sessionGeneration === context.generation) {
        this.store.dispatch(setSyncStatus({ status: 'error', error: message }));
      }
      return { ok: false, reason: 'error', message };
    }
  }

  // ─── protocol steps ───

  private async register(context: SessionContext): Promise<{ ok: true; freshEpoch: boolean } | Extract<SessionOutcome, { ok: false }>> {
    const manifest = await this.buildManifest(context);
    const response = await this.invoke<RegisterResponse | HubErrorPayload>(HUB_METHODS.register, context.co, manifest);
    if (isHubError(response)) {
      this.store.dispatch(setSyncEntitled(false));
      const forbidden = response.error === 'forbidden';
      const message = forbidden ? SYNC_MESSAGES.forbidden : `Registro rechazado: ${response.error}`;
      return { ok: false, reason: forbidden ? 'forbidden' : 'error', message };
    }

    this.store.dispatch(setSyncEntitled(true));
    this.applyPeers(context.co, response.peers ?? []);

    const local = this.companyState(context.co);
    const freshEpoch = local.epoch !== response.epoch;
    if (freshEpoch) {
      // First session for this company, or the relay restarted (cold start = new epoch):
      // our cursor is meaningless and the relay may hold nothing from us — re-seed.
      this.store.dispatch(adoptEpoch({ co: context.co, epoch: response.epoch }));
      await this.enqueueSnapshot(context, '');
    }
    return { ok: true, freshEpoch };
  }

  /** Pushes the outbox in ≤500 batches; returns how many envelopes the relay accepted. */
  private async flushOutbox(context: SessionContext, via: 'hub' | 'rest'): Promise<number> {
    let accepted = 0;
    let rateLimitedRetries = 0;
    // Bounded loop: each iteration either acks or rejects every ref it took.
    for (let guard = 0; guard < 1000; guard++) {
      const refs = this.outboxRefs(context.co).slice(0, SYNC_LIMITS.maxChangesPerPush);
      if (refs.length === 0) break;

      const envelopes: ChangeEnvelope[] = [];
      const sent: OutboxRef[] = [];
      const localRejects: { ref: OutboxRef; reason: string }[] = [];
      const vanished: OutboxRef[] = [];
      let batchBytes = 0;
      for (const ref of refs) {
        try {
          const envelope = await this.materialize(context, ref);
          if (envelope) {
            const size = envelope.p.length + envelope.id.length + 160; // payload + envelope overhead
            // Cut the batch by bytes too; the rest goes out on the next loop iteration.
            if (envelopes.length > 0 && batchBytes + size > SYNC_LIMITS.maxPushBytes) break;
            batchBytes += size;
            envelopes.push(envelope);
            sent.push(ref);
          } else {
            vanished.push(ref);
          }
        } catch (error) {
          localRejects.push({ ref, reason: error instanceof PayloadTooLargeError ? 'payload_too_large' : 'encode_failed' });
        }
      }
      const at = this.env.now().toISOString();
      if (vanished.length) this.store.dispatch(ackOutbox({ co: context.co, refs: vanished }));
      if (localRejects.length) this.store.dispatch(rejectOutbox({ co: context.co, items: localRejects, at }));
      if (envelopes.length === 0) continue;

      const response = via === 'hub'
        ? await this.invoke<PushResponse | HubErrorPayload>(HUB_METHODS.push, context.co, envelopes)
        : await this.env.createRestClient(this.env.baseUrl, this.env.getToken).push(context.co, envelopes);
      if (isHubError(response)) {
        if (response.error === 'rate_limited' && rateLimitedRetries < SYNC_LIMITS.maxRateLimitRetries) {
          // Relay back-pressure (big first snapshots on fast links): same batch again after a pause.
          await this.pause(Math.min(1000 * 2 ** rateLimitedRetries, 8000));
          rateLimitedRetries++;
          continue;
        }
        if (response.error === 'forbidden') this.store.dispatch(setSyncEntitled(false));
        throw new Error(response.error === 'forbidden' ? SYNC_MESSAGES.forbidden : `Envío rechazado: ${response.error}`);
      }

      rateLimitedRetries = 0;
      const rejectedIndexes = new Map((response.rejected ?? []).map(item => [item.index, item.reason]));
      const acked = sent.filter((_, index) => !rejectedIndexes.has(index));
      const rejected = sent
        .map((ref, index) => ({ ref, reason: rejectedIndexes.get(index) }))
        .filter((item): item is { ref: OutboxRef; reason: string } => item.reason !== undefined);
      this.store.dispatch(ackOutbox({ co: context.co, refs: acked }));
      if (rejected.length) this.store.dispatch(rejectOutbox({ co: context.co, items: rejected, at }));
      accepted += acked.length;
    }
    return accepted;
  }

  /** Pull until drained. The cursor advances to the LAST APPLIED entry id, never to head. */
  private async pullAll(context: SessionContext): Promise<number> {
    let applied = 0;
    for (let guard = 0; guard < 10_000; guard++) {
      const company = this.companyState(context.co);
      const cursor = company.cursor || '0';
      const response = await this.invoke<PullResponse | HubErrorPayload>(HUB_METHODS.pull, context.co, cursor, SYNC_LIMITS.maxPullEntries);
      if (isHubError(response)) throw new Error(`Descarga rechazada: ${response.error}`);

      if (company.epoch && response.epoch && response.epoch !== company.epoch) {
        // The relay restarted between Register and Pull: re-seed under the new epoch.
        this.store.dispatch(adoptEpoch({ co: context.co, epoch: response.epoch }));
        await this.enqueueSnapshot(context, '');
        await this.flushOutbox(context, 'hub');
        continue;
      }

      const entries = response.entries ?? [];
      if (entries.length === 0) break;
      const first = Number(entries[0].id);
      const gap = cursor !== '0' && Number.isFinite(first) && first > Number(cursor) + 1;
      if (response.truncated || gap) {
        // Entries between our cursor and the oldest retained one were trimmed from the
        // relay's bounded log: ask peers for everything instead of silently skipping.
        await this.queryPeers(context, '');
      }

      applied += await this.applyEntries(context, entries);
      this.store.dispatch(setCursor({ co: context.co, epoch: response.epoch || company.epoch || '', cursor: entries[entries.length - 1].id }));
      if (!(response.hasMore ?? entries.length >= SYNC_LIMITS.maxPullEntries)) break;
    }
    return applied;
  }

  private async queryPeers(context: SessionContext, since: string): Promise<void> {
    const response = await this.invoke<QueryPeersResponse | HubErrorPayload>(HUB_METHODS.queryPeers, context.co, since);
    if (!isHubError(response) && Array.isArray(response?.onlinePeers)) {
      this.store.dispatch(setPeers({ co: context.co, online: response.onlinePeers }));
    }
  }

  private async reportManifest(context: SessionContext): Promise<void> {
    const manifest = await this.buildManifest(context);
    await this.invoke(HUB_METHODS.reportManifest, context.co, manifest);
  }

  /** REST status adds offline devices + server correlativo maxima; failures are non-fatal. */
  private async refreshStatus(context: SessionContext): Promise<void> {
    try {
      const status = await this.env.createRestClient(this.env.baseUrl, this.env.getToken).status(context.co);
      if (!status || isHubError(status)) return;
      this.store.dispatch(setPeers({
        co: context.co,
        devices: (status.devices ?? []).filter(device => device.deviceId !== context.deviceId),
        online: (status.online ?? []).filter(id => id !== context.deviceId),
      }));
      this.store.dispatch(mergeCorrelativoMaxima({ co: context.co, maxima: status.correlativoMaxima ?? {} }));
    } catch {
      // status is advisory
    }
  }

  // ─── applying remote changes ───

  private async applyEntries(context: SessionContext, entries: LogEntry[]): Promise<number> {
    let applied = 0;
    const conflicts: SyncConflict[] = [];
    for (const entry of entries) {
      const change = entry.change;
      if (!change || change.d === context.deviceId) continue; // our own push echoed back
      try {
        if (await this.applyChange(context, change, conflicts)) applied++;
      } catch (error) {
        console.warn('syncV2: failed to apply change', change.t, change.id, describeError(error));
      }
    }
    if (conflicts.length) this.store.dispatch(addConflicts({ co: context.co, conflicts }));
    return applied;
  }

  private async applyChange(context: SessionContext, change: ChangeEnvelope, conflicts: SyncConflict[]): Promise<boolean> {
    const type = change.t;
    if (!SYNC_ENTITY_TYPES.includes(type)) return false;
    const payload = change.p ? decodePayload<Record<string, unknown>>(change.p) : {};
    const remoteEntity = change.op === 'upsert' ? ({ ...payload, id: change.id } as SyncEntity) : undefined;
    const dedupeKey = type === 'purchase'
      ? (typeof payload.k === 'string' ? payload.k : purchaseDedupeKey(remoteEntity))
      : undefined;

    const local = await findLocalMatch(context, type, change.id, remoteEntity, dedupeKey);
    const localKey = entityKey(type, local?.id ?? change.id);
    const meta = this.versionFor(context, localKey);
    const decision = mergeChange(type, local, meta, { op: change.op, u: change.u, d: change.d, entity: remoteEntity }, context.deviceId);
    conflicts.push(...decision.conflicts);

    switch (decision.kind) {
      case 'skip':
        if (decision.reason === 'unknown-delete') {
          // Remember the tombstone so a late, older upsert from a third device can't resurrect it.
          this.store.dispatch(recordRemoteVersions({
            co: context.co,
            versions: [{ key: localKey, meta: { u: change.u, d: change.d, del: true, ...(dedupeKey ? { k: dedupeKey } : {}) } }],
          }));
        }
        return false;
      case 'delete':
        if (local) await applyDelete(context, type, local.id);
        this.store.dispatch(recordRemoteVersions({
          co: context.co,
          versions: [{ key: localKey, meta: { ...decision.version, del: true, ...(dedupeKey ? { k: dedupeKey } : {}) } }],
        }));
        this.store.dispatch(dropOutboxKeys({ co: context.co, keys: [localKey] }));
        return true;
      case 'upsert': {
        await applyUpsert(context, type, decision.entity, local?.id);
        this.store.dispatch(recordRemoteVersions({ co: context.co, versions: [{ key: localKey, meta: { ...decision.version } }] }));
        if (decision.version.d === change.d) {
          // The remote version superseded ours: a queued local ref for it is obsolete.
          this.store.dispatch(dropOutboxKeys({ co: context.co, keys: [localKey] }));
        } else {
          // Merged result is attributed to OUR version (e.g. lattice kept a higher local
          // status): push it so the peer converges on the same content + version.
          this.store.dispatch(enqueueOutbox({ co: context.co, refs: [{ t: type, id: local?.id ?? change.id, op: 'upsert', u: decision.version.u }] }));
        }
        return true;
      }
    }
  }

  // ─── outbox materialization + snapshots ───

  private async materialize(context: SessionContext, ref: OutboxRef): Promise<ChangeEnvelope | null> {
    if (ref.op === 'delete') {
      return {
        t: ref.t,
        id: ref.id,
        op: 'delete',
        u: ref.u,
        d: context.deviceId,
        p: encodePayload(ref.k ? { id: ref.id, k: ref.k } : { id: ref.id }),
      };
    }
    const entity = await loadLocalEntity(context, ref.t, ref.id);
    if (!entity) return null; // deleted after capture; the delete ref supersedes it
    const meta = this.versionFor(context, entityKey(ref.t, ref.id));
    const u = meta?.u && toMillis(meta.u) > toMillis(ref.u) ? meta.u : ref.u;
    return {
      t: ref.t,
      id: ref.id,
      op: 'upsert',
      u,
      d: context.deviceId,
      p: encodePayload(serializeForWire(ref.t, entity, u)),
    };
  }

  /** Every live entity (+ tombstones) newer than `since` ('' = all) into the outbox. */
  private async enqueueSnapshot(context: SessionContext, since: string): Promise<number> {
    const sinceMillis = since ? toMillis(since) : Number.NEGATIVE_INFINITY;
    const refs: OutboxRef[] = [];
    for (const type of SYNC_ENTITY_TYPES) {
      for (const entity of await listLocalEntities(context, type)) {
        const meta = this.versionFor(context, entityKey(type, entity.id));
        const u = meta?.u || entity.updatedAt || this.env.now().toISOString();
        if (toMillis(u) > sinceMillis) refs.push({ t: type, id: entity.id, op: 'upsert', u });
      }
    }
    for (const [key, meta] of Object.entries(this.companyState(context.co).versions)) {
      if (!meta.del || toMillis(meta.u) <= sinceMillis) continue;
      const { t, id } = parseEntityKey(key);
      refs.push({ t, id, op: 'delete', u: meta.u, ...(meta.k ? { k: meta.k } : {}) });
    }
    if (refs.length) this.store.dispatch(enqueueOutbox({ co: context.co, refs }));
    return refs.length;
  }

  // ─── manifest, digest ───

  private async buildManifest(context: SessionContext): Promise<DeviceManifest> {
    const state = this.state();
    const company = this.companyState(context.co);
    const counts: Partial<Record<SyncEntityType, number>> = {};
    for (const type of SYNC_ENTITY_TYPES) counts[type] = (await listLocalEntities(context, type)).length;
    return {
      deviceId: context.deviceId,
      platform: this.env.platform,
      appVersion: this.env.appVersion,
      lastSyncAt: company.lastSyncAt,
      lastSeenId: company.cursor,
      epoch: company.epoch,
      lastLocalChangeAt: company.lastLocalChangeAt,
      counts,
      maxCorrelativo: maxCorrelativoByDocType(state.invoices.invoices, context.companyId),
    };
  }

  async digestFor(context: SessionContext, type: SyncEntityType, includeItems: boolean): Promise<EntityDigest> {
    return buildDigest(type, await this.digestItems(context, type), includeItems);
  }

  private async digestItems(context: SessionContext, type: SyncEntityType): Promise<DigestItem[]> {
    const items: DigestItem[] = [];
    for (const entity of await listLocalEntities(context, type)) {
      const meta = this.versionFor(context, entityKey(type, entity.id));
      items.push({ key: digestKeyFor(type, entity), u: meta?.u || entity.updatedAt || '' });
    }
    return items;
  }

  /** Peers at our epoch + cursor reporting different counts ⇒ run the digest exchange. */
  private async checkCountMismatch(context: SessionContext, peers: DeviceManifest[]): Promise<void> {
    const mine = await this.buildManifest(context);
    const mismatched = new Set<SyncEntityType>();
    for (const peer of peers) {
      if (peer.deviceId === context.deviceId || peer.epoch !== mine.epoch || peer.lastSeenId !== mine.lastSeenId) continue;
      for (const type of SYNC_ENTITY_TYPES) {
        if (peer.counts?.[type] !== undefined && peer.counts[type] !== mine.counts[type]) mismatched.add(type);
      }
    }
    if (mismatched.size === 0) {
      if (this.companyState(context.co).pendingVerify.length) this.store.dispatch(setPendingVerify({ co: context.co, types: [] }));
      return;
    }
    this.store.dispatch(setPendingVerify({ co: context.co, types: Array.from(mismatched) }));
    for (const type of mismatched) {
      try {
        await this.invoke(HUB_METHODS.requestDigest, context.co, type);
      } catch {
        // Relay without digest support: stays "Pendiente de verificar" until the next peer event.
      }
    }
  }

  private async answerDigestRequest(context: SessionContext, requesterId: string, type: SyncEntityType): Promise<void> {
    const digest = await this.digestFor(context, type, true);
    await this.invoke(HUB_METHODS.digest, context.co, requesterId, digest);
  }

  private async reconcileDigest(context: SessionContext, theirs: EntityDigest): Promise<void> {
    const mine = await this.digestFor(context, theirs.type, false);
    if (digestsMatch(mine, theirs)) {
      this.clearPendingVerify(context, theirs.type);
      return;
    }
    const diff = diffDigestItems(await this.digestItems(context, theirs.type), parseDigestLines(theirs.items ?? []));
    if (diff.toPush.length) {
      const pushKeys = new Set(diff.toPush);
      const refs: OutboxRef[] = [];
      for (const entity of await listLocalEntities(context, theirs.type)) {
        if (!pushKeys.has(digestKeyFor(theirs.type, entity))) continue;
        const meta = this.versionFor(context, entityKey(theirs.type, entity.id));
        refs.push({ t: theirs.type, id: entity.id, op: 'upsert', u: meta?.u || entity.updatedAt || this.env.now().toISOString() });
      }
      if (refs.length) this.store.dispatch(enqueueOutbox({ co: context.co, refs }));
      await this.flushOutbox(context, 'hub');
    }
    if (diff.toRequest.length) {
      // Cleared once a pull brings our count up to what the peer reported.
      this.repairTargets.set(theirs.type, theirs.count);
      await this.queryPeers(context, '');
    } else {
      // Nothing missing on our side; the peer converges when it pulls our push.
      this.clearPendingVerify(context, theirs.type);
    }
  }

  private clearPendingVerify(context: SessionContext, type: SyncEntityType): void {
    this.repairTargets.delete(type);
    const pending = this.companyState(context.co).pendingVerify;
    if (pending.includes(type)) {
      this.store.dispatch(setPendingVerify({ co: context.co, types: pending.filter(item => item !== type) }));
    }
  }

  private async settleRepairs(context: SessionContext): Promise<void> {
    for (const [type, target] of Array.from(this.repairTargets.entries())) {
      if ((await listLocalEntities(context, type)).length >= target) this.clearPendingVerify(context, type);
    }
  }

  // ─── hub events ───

  private attachHandlers(connection: HubConnectionLike): void {
    connection.on(HUB_EVENTS.changesAvailable, (co: string, _lastId: string, originDeviceId: string) => {
      const context = this.context;
      if (!context || co !== context.co || originDeviceId === context.deviceId) return;
      this.schedulePull();
    });

    connection.on(HUB_EVENTS.peersChanged, (co: string, peers: DeviceManifest[]) => {
      const context = this.context;
      if (!context || co !== context.co) return;
      this.applyPeers(co, (peers ?? []).filter(peer => peer.deviceId !== context.deviceId));
      void this.enqueue(() => this.checkCountMismatch(context, peers ?? [])).catch(() => undefined);
    });

    connection.on(HUB_EVENTS.dataRequested, (co: string, requesterId: string, since: string) => {
      const context = this.context;
      if (!context || co !== context.co || requesterId === context.deviceId) return;
      void this.enqueue(async () => {
        await this.enqueueSnapshot(context, since ?? '');
        if (await this.flushOutbox(context, 'hub')) await this.catchUpCursor(context);
      }).catch(error => console.warn('syncV2: DataRequested answer failed', describeError(error)));
    });

    connection.on(HUB_EVENTS.epochReset, (co: string, epoch: string) => {
      const context = this.context;
      if (!context || co !== context.co || this.companyState(co).epoch === epoch) return;
      // Stagger re-seeds so every device of the owner doesn't hammer a fresh relay at once.
      const delay = Math.floor(this.env.random() * this.env.staggerMaxMs);
      if (this.staggerTimer) this.env.clearTimer(this.staggerTimer);
      this.staggerTimer = this.env.setTimer(() => {
        this.staggerTimer = null;
        void this.enqueue(async () => {
          // Register already adopted this epoch (the relay also signals it on Register):
          // the snapshot went out then — don't re-seed twice.
          if (this.companyState(co).epoch === epoch) return;
          this.store.dispatch(adoptEpoch({ co, epoch }));
          await this.enqueueSnapshot(context, '');
          await this.register(context);
          await this.flushOutbox(context, 'hub');
          await this.pullAll(context);
          await this.reportManifest(context);
        }).catch(error => console.warn('syncV2: epoch re-seed failed', describeError(error)));
      }, delay);
    });

    connection.on(HUB_EVENTS.digestRequested, (co: string, requesterId: string, type: SyncEntityType) => {
      const context = this.context;
      if (!context || co !== context.co || requesterId === context.deviceId) return;
      void this.enqueue(() => this.answerDigestRequest(context, requesterId, type)).catch(() => undefined);
    });

    connection.on(HUB_EVENTS.digestAvailable, (co: string, _fromDeviceId: string, digest: EntityDigest) => {
      const context = this.context;
      if (!context || co !== context.co || !digest) return;
      void this.enqueue(() => this.reconcileDigest(context, digest)).catch(() => undefined);
    });

    connection.onclose(() => {
      if (this.stopping || this.connection !== connection) return;
      this.connection = null;
      const context = this.context;
      this.context = null;
      this.clearTimers();
      this.store.dispatch(setSyncStatus({ status: 'offline', error: SYNC_MESSAGES.offline }));
      if (context && this.outboxRefs(context.co).length) void this.flushOutbox(context, 'rest').catch(() => undefined);
    });

    connection.onreconnecting?.(() => {
      if (this.connection === connection && this.context) {
        this.store.dispatch(setSyncStatus({ status: 'connecting' }));
      }
    });

    connection.onreconnected?.(() => {
      const context = this.context;
      if (!context) return;
      // A reconnect may have landed on a recycled relay: re-run the full session loop.
      void this.enqueue(() => this.initialSync(context)).catch(() => undefined);
    });
  }

  // ─── helpers ───

  private scheduleFlush(): void {
    const context = this.context;
    if (!context) return;
    if (this.flushTimer) this.env.clearTimer(this.flushTimer);
    this.flushTimer = this.env.setTimer(() => {
      this.flushTimer = null;
      void this.enqueue(async () => {
        if (await this.flushOutbox(context, 'hub')) await this.catchUpCursor(context);
      }).catch(error => console.warn('syncV2: flush failed', describeError(error)));
    }, this.env.flushDebounceMs);
  }

  private schedulePull(): void {
    const context = this.context;
    if (!context) return;
    if (this.pullTimer) this.env.clearTimer(this.pullTimer);
    this.pullTimer = this.env.setTimer(() => {
      this.pullTimer = null;
      void this.enqueue(async () => {
        await this.pullAll(context);
        // A merge can keep something the remote lacked (our sales in a stock
        // counter, a higher ticket status) and is then re-queued under OUR
        // version — send it now, or the peer only converges on our next
        // unrelated local change.
        if (this.outboxRefs(context.co).length && await this.flushOutbox(context, 'hub')) {
          await this.catchUpCursor(context);
        }
        await this.settleRepairs(context);
        await this.reportManifest(context);
      }).catch(error => console.warn('syncV2: live pull failed', describeError(error)));
    }, PULL_DEBOUNCE_MS);
  }

  /**
   * The relay never notifies a device of its own pushes, so without this the pusher's
   * cursor lags behind peers that pulled those entries — and the "same epoch + cursor"
   * guard of the count-mismatch check would never match. Own echoes are skipped on apply.
   */
  private async catchUpCursor(context: SessionContext): Promise<void> {
    await this.pullAll(context);
    await this.reportManifest(context);
  }

  private clearTimers(): void {
    for (const timer of [this.flushTimer, this.pullTimer, this.staggerTimer]) {
      if (timer) this.env.clearTimer(timer);
    }
    this.flushTimer = null;
    this.pullTimer = null;
    this.staggerTimer = null;
  }

  /** Serializes every protocol step (initial loop, live pulls, flushes, answers). */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async invoke<T>(method: string, ...args: unknown[]): Promise<T> {
    if (!this.connection) throw new Error(SYNC_MESSAGES.offline);
    return this.connection.invoke<T>(method, ...args);
  }

  private pause(ms: number): Promise<void> {
    return new Promise(resolve => {
      this.env.setTimer(resolve, ms);
    });
  }

  private applyPeers(co: string, peers: DeviceManifest[]): void {
    this.store.dispatch(setPeers({ co, devices: peers, online: peers.map(peer => peer.deviceId) }));
    const maxima: Record<string, number> = {};
    for (const peer of peers) {
      for (const [docType, value] of Object.entries(peer.maxCorrelativo ?? {})) {
        if ((maxima[docType] ?? 0) < value) maxima[docType] = value;
      }
    }
    if (Object.keys(maxima).length) this.store.dispatch(mergeCorrelativoMaxima({ co, maxima }));
  }

  private versionFor(context: SessionContext, key: string): VersionMeta | undefined {
    const meta = this.companyState(context.co).versions[key];
    if (!meta) return undefined;
    return meta.d === SELF_DEVICE_PLACEHOLDER ? { ...meta, d: context.deviceId } : meta;
  }

  private outboxRefs(co: string): OutboxRef[] {
    const refs = Object.values(this.companyState(co).outbox);
    // Parents before children: a peer applying an invoice already knows its customer.
    const order = new Map(SYNC_ENTITY_TYPES.map((type, index) => [type, index]));
    return refs.sort((a, b) => (order.get(a.t) ?? 0) - (order.get(b.t) ?? 0) || toMillis(a.u) - toMillis(b.u));
  }

  private companyState(co: string): CompanySyncState {
    return this.state().syncV2.companies[co] ?? {
      epoch: null,
      cursor: '0',
      lastSyncAt: null,
      lastLocalChangeAt: null,
      outbox: {},
      versions: {},
      devices: [],
      correlativoMaxima: {},
      conflicts: [],
      pendingVerify: [],
      rejected: [],
    };
  }

  private selectedCompany(state: EngineState): Company | undefined {
    const companies = state.companies.companies;
    return (
      state.companies.currentCompany ??
      companies.find(company => company.id === state.companies.selectedCompanyId) ??
      companies.find(company => company.isDefault) ??
      companies[0]
    );
  }

  private state(): EngineState {
    return this.store.getState() as EngineState;
  }
}
