// carwashSlice — SparkleWash workboard state + thunks (see docs/SPARKLEWASH_INTEGRATION.md).
//
// Jobs = server jobs merged with local pending jobs (`local-<uuid>` ids created offline).
// Every write is optimistic: applied locally, queued in the durable outbox with an
// idempotency key, then flushed. A 4xx from the server rolls the optimistic change back
// (marking `syncError`); network errors leave it pending until the outbox drains.
// The session token is NOT persisted with redux-persist (secure storage owns it).

import { createAsyncThunk, createSelector, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { getViteEnv } from '@/config/viteEnv';
import GoogleAuthService from '../../services/auth/GoogleAuthService';
import { CarwashApiClient, CarwashApiError, type CarwashClientLike } from '../../services/carwash/CarwashApiClient';
import type { EventStreamOpener } from '../../services/carwash/CarwashEventStream';
import { carwashOutbox, normalizePlate, type CarwashOutbox, type FlushResult } from '../../services/carwash/CarwashOutbox';
import {
  clearCarwashSession,
  defaultCarwashSettings,
  loadCarwashSession,
  loadCarwashSettings,
  sanitizeCarwashSettings,
  saveCarwashSession,
  saveCarwashSettings as persistCarwashSettings,
} from '../../services/carwash/CarwashSettingsStore';
import { CarwashSyncService } from '../../services/carwash/CarwashSyncService';
import { nextWorkTicketNumber } from '../../services/carwash/workTicketNumber';
import {
  NEXT_JOB_STATUSES,
  isLocalJobId,
  type CarwashJob,
  type CarwashOutboxOp,
  type CarwashSession,
  type CarwashSettings,
  type CarwashSyncStatus,
  type Employee,
  type JobPayment,
  type JobPaymentInput,
  type JobStatus,
  type JobSummary,
  type JobView,
  type PackageCatalog,
  type WalkInInput,
} from '../../services/carwash/types';

export const MAX_CACHED_JOBS = 300;

export interface CarwashState {
  initialized: boolean;
  settings: CarwashSettings;
  session: CarwashSession | null;
  /** Cached catalog (packages + vehicle classes), persisted for offline use. */
  packages: PackageCatalog | null;
  employees: Employee[];
  jobs: CarwashJob[];
  summary: JobSummary | null;
  sync: CarwashSyncStatus;
  loading: boolean;
  signingIn: boolean;
  error: string | null;
}

const initialState: CarwashState = {
  initialized: false,
  settings: defaultCarwashSettings(),
  session: null,
  packages: null,
  employees: [],
  jobs: [],
  summary: null,
  sync: { state: 'signed-out', pending: 0, lastSyncedAt: null, lastError: null },
  loading: false,
  signingIn: false,
  error: null,
};

type CarwashRoot = { carwash: CarwashState };
type ThunkConfig = { state: CarwashRoot; rejectValue: string };

// ── Dependencies (injectable for tests) ────────────────────────────────
export interface CarwashDeps {
  client: CarwashClientLike;
  outbox: CarwashOutbox;
  nextTicket: (registerCode: string) => Promise<string>;
  uuid: () => string;
  now: () => Date;
  /** Google id token for the API; `interactive` opens the consent flow. */
  getGoogleIdToken: (interactive: boolean) => Promise<string | null>;
  openStream?: EventStreamOpener;
  debounceMs?: number;
}

const defaultUuid = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
};

const createDefaultDeps = (): CarwashDeps => ({
  client: new CarwashApiClient({ baseUrl: defaultCarwashSettings().apiBaseUrl }),
  outbox: carwashOutbox,
  nextTicket: (code) => nextWorkTicketNumber(code),
  uuid: defaultUuid,
  now: () => new Date(),
  getGoogleIdToken: async (interactive) => {
    const existing = await GoogleAuthService.getFreshIdToken();
    if (existing && !interactive) return existing;
    if (interactive) return (await GoogleAuthService.signIn()).idToken;
    return existing;
  },
});

let deps: CarwashDeps = createDefaultDeps();
let syncService: CarwashSyncService | null = null;

/** Test hook: replace dependencies and drop any running sync service. */
export function __setCarwashDepsForTests(partial: Partial<CarwashDeps> | null): void {
  syncService?.stop(false);
  syncService = null;
  deps = partial ? { ...createDefaultDeps(), ...partial } : createDefaultDeps();
}

export function getCarwashSyncService(): CarwashSyncService | null {
  return syncService;
}

// ── Helpers ────────────────────────────────────────────────────────────
const errMessage = (err: unknown, fallback = 'Error desconocido'): string =>
  err instanceof Error && err.message ? err.message : fallback;

const byArrivalDesc = (a: JobView, b: JobView): number => (a.arrivalAt < b.arrivalAt ? 1 : a.arrivalAt > b.arrivalAt ? -1 : 0);

function capJobs(jobs: CarwashJob[]): CarwashJob[] {
  const local = jobs.filter((j) => isLocalJobId(j.id) || j.pendingSync);
  const rest = jobs.filter((j) => !(isLocalJobId(j.id) || j.pendingSync)).sort(byArrivalDesc).slice(0, MAX_CACHED_JOBS);
  return [...local, ...rest].sort(byArrivalDesc);
}

function upsertJob(jobs: CarwashJob[], job: CarwashJob): void {
  const i = jobs.findIndex((j) => j.id === job.id);
  if (i >= 0) jobs[i] = { ...jobs[i], ...job, pendingSync: jobs[i].pendingSync, syncError: jobs[i].syncError };
  else jobs.push(job);
}

function paymentFields(job: CarwashJob, payments: JobPayment[]): Pick<CarwashJob, 'payments' | 'paidUsd' | 'paymentStatus' | 'paidAt'> {
  const paidUsd = Math.round(payments.reduce((sum, p) => sum + p.amountUsd, 0) * 100) / 100;
  const paid = paidUsd >= job.priceUsd - 0.0001;
  const last = payments[payments.length - 1];
  return {
    payments,
    paidUsd,
    paymentStatus: paid ? 'paid' : paidUsd > 0 ? 'partial' : 'unpaid',
    paidAt: paid ? job.paidAt ?? last?.recordedAt ?? null : null,
  };
}

// ── Slice ──────────────────────────────────────────────────────────────
const carwashSlice = createSlice({
  name: 'carwash',
  initialState,
  reducers: {
    settingsLoaded(state, action: PayloadAction<CarwashSettings>) {
      state.settings = action.payload;
    },
    sessionChanged(state, action: PayloadAction<CarwashSession | null>) {
      state.session = action.payload;
    },
    initialized(state) {
      state.initialized = true;
    },
    syncStatusChanged(state, action: PayloadAction<CarwashSyncStatus>) {
      state.sync = action.payload;
    },
    /** Replace server data from a successful refresh; local/pending jobs and their optimistic copies survive. */
    refreshed(
      state,
      action: PayloadAction<{ packages: PackageCatalog; jobs: JobView[]; summary: JobSummary | null; employees: Employee[] }>,
    ) {
      const { packages, jobs, summary, employees } = action.payload;
      const previous = new Map(state.jobs.map((j) => [j.id, j]));
      const merged: CarwashJob[] = jobs.map((server) => {
        const prev = previous.get(server.id);
        // An optimistic copy with unsent changes wins until the outbox drains.
        if (prev?.pendingSync) return prev;
        return { ...server, pendingSync: false, syncError: prev?.syncError ?? null };
      });
      const serverIds = new Set(jobs.map((j) => j.id));
      for (const j of state.jobs) if (isLocalJobId(j.id) && !serverIds.has(j.id)) merged.push(j);
      state.jobs = capJobs(merged);
      state.packages = packages;
      state.employees = employees;
      state.summary = summary;
      state.loading = false;
      state.error = null;
    },
    /** Outbox delivered: swap local ids for server ids and upsert the server copies. */
    flushApplied(state, action: PayloadAction<{ jobs: JobView[]; idMap: Record<string, string> }>) {
      const { jobs, idMap } = action.payload;
      const jobsDraft = state.jobs;
      for (const [local, server] of Object.entries(idMap)) {
        const i = jobsDraft.findIndex((j) => j.id === local);
        if (i >= 0) {
          // The server copy carries the full snapshot; if it is not in this batch keep the local one under the new id.
          if (jobs.some((j) => j.id === server)) jobsDraft.splice(i, 1);
          else jobsDraft[i] = { ...jobsDraft[i], id: server };
        }
      }
      for (const job of jobs) upsertJob(jobsDraft, { ...job, pendingSync: false, syncError: null });
      state.jobs = capJobs(jobsDraft);
    },
    marksUpdated(state, action: PayloadAction<{ pendingIds: string[]; errors: Record<string, string> }>) {
      const pending = new Set(action.payload.pendingIds);
      for (const job of state.jobs) {
        job.pendingSync = pending.has(job.id);
        job.syncError = action.payload.errors[job.id] ?? null;
      }
    },
    jobAddedLocal(state, action: PayloadAction<CarwashJob>) {
      state.jobs = capJobs([action.payload, ...state.jobs.filter((j) => j.id !== action.payload.id)]);
    },
    jobRestored(state, action: PayloadAction<{ job: CarwashJob; error: string }>) {
      const i = state.jobs.findIndex((j) => j.id === action.payload.job.id);
      if (i >= 0) state.jobs[i] = { ...action.payload.job, pendingSync: false, syncError: action.payload.error };
    },
    jobTransitionedLocal(state, action: PayloadAction<{ jobId: string; status: Exclude<JobStatus, 'arrived'>; at: string; key: string }>) {
      const job = state.jobs.find((j) => j.id === action.payload.jobId);
      if (!job) return;
      const { status, at, key } = action.payload;
      job.status = status;
      if (status === 'in_progress') job.startedAt = job.startedAt ?? at;
      if (status === 'completed') job.completedAt = at;
      if (status === 'cancelled') job.cancelledAt = at;
      job.transitions = [...job.transitions, { status, at, actor: 'local', idempotencyKey: key }];
      job.pendingSync = true;
    },
    jobAssignedLocal(state, action: PayloadAction<{ jobId: string; employeeId: string; employeeName: string; at: string }>) {
      const job = state.jobs.find((j) => j.id === action.payload.jobId);
      if (!job) return;
      job.assignments = [
        ...job.assignments,
        { employeeId: action.payload.employeeId, employeeName: action.payload.employeeName, assignedAt: action.payload.at },
      ];
      job.pendingSync = true;
    },
    jobTicketLocal(state, action: PayloadAction<{ jobId: string; ticketNumber: string }>) {
      const job = state.jobs.find((j) => j.id === action.payload.jobId);
      if (!job) return;
      job.ticketNumber = action.payload.ticketNumber;
      job.pendingSync = true;
    },
    jobPaymentLocal(state, action: PayloadAction<{ jobId: string; payment: JobPayment }>) {
      const job = state.jobs.find((j) => j.id === action.payload.jobId);
      if (!job) return;
      Object.assign(job, paymentFields(job, [...(job.payments ?? []), action.payload.payment]));
      job.pendingSync = true;
    },
    /** Drop session-scoped data (keeps jobs that still have unsent changes). */
    sessionCleared(state, action: PayloadAction<{ error?: string | null } | undefined>) {
      state.session = null;
      state.employees = [];
      state.summary = null;
      state.jobs = state.jobs.filter((j) => isLocalJobId(j.id) || j.pendingSync);
      state.sync = { ...state.sync, state: 'signed-out', lastError: action.payload?.error ?? null };
    },
    settingsChanged(state, action: PayloadAction<CarwashSettings>) {
      state.settings = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(refreshCarwash.pending, (state) => {
        state.loading = true;
      })
      .addCase(refreshCarwash.rejected, (state, action) => {
        state.loading = false;
        state.error = (action.payload as string | undefined) ?? action.error.message ?? 'Error al actualizar';
      })
      .addCase(signInCarwash.pending, (state) => {
        state.signingIn = true;
        state.error = null;
      })
      .addCase(signInCarwash.fulfilled, (state) => {
        state.signingIn = false;
      })
      .addCase(signInCarwash.rejected, (state, action) => {
        state.signingIn = false;
        state.error = (action.payload as string | undefined) ?? action.error.message ?? 'No se pudo iniciar sesión';
      })
      .addCase(signInCarwashWithToken.pending, (state) => {
        state.signingIn = true;
        state.error = null;
      })
      .addCase(signInCarwashWithToken.fulfilled, (state) => {
        state.signingIn = false;
      })
      .addCase(signInCarwashWithToken.rejected, (state, action) => {
        state.signingIn = false;
        state.error = (action.payload as string | undefined) ?? action.error.message ?? 'No se pudo iniciar sesión';
      });
  },
});

export const carwashActions = carwashSlice.actions;
export default carwashSlice.reducer;
const a = carwashSlice.actions;

// ── Runtime plumbing ───────────────────────────────────────────────────
type Api = { dispatch: (action: any) => any; getState: () => CarwashRoot };

async function updateMarks(api: Api): Promise<void> {
  const entries = await deps.outbox.list();
  const pendingIds: string[] = [];
  const errors: Record<string, string> = {};
  for (const e of entries) {
    const id = e.op.kind === 'walk-in' ? e.op.localJobId : e.op.jobId;
    if (e.failed) errors[id] = e.lastError ?? 'No se pudo sincronizar';
    else pendingIds.push(id);
  }
  api.dispatch(a.marksUpdated({ pendingIds, errors }));
  const status = api.getState().carwash.sync;
  const pending = pendingIds.length;
  if (status.pending !== pending) api.dispatch(a.syncStatusChanged({ ...status, pending }));
}

async function applyFlush(api: Api, result: FlushResult): Promise<void> {
  if (result.jobs.length > 0 || Object.keys(result.idMap).length > 0) {
    api.dispatch(a.flushApplied({ jobs: result.jobs, idMap: result.idMap }));
  }
  await updateMarks(api);
}

async function refreshAll(api: Api): Promise<void> {
  const client = deps.client;
  const [packages, jobs, employees, summary] = await Promise.all([
    client.getPackages(),
    client.listJobs(),
    client.listEmployees(),
    client.getJobsSummary().catch((err: unknown) => {
      if (err instanceof CarwashApiError && (err.isNetwork || err.status === 401)) throw err;
      return null;
    }),
  ]);
  api.dispatch(a.refreshed({ packages, jobs, employees, summary }));
  await updateMarks(api);
}

async function exchangeIdToken(api: Api, idToken: string): Promise<CarwashSession> {
  const client = deps.client;
  client.setToken(null);
  const login = await client.googleLogin(idToken);
  client.setToken(login.sessionToken);
  let email: string | null = null;
  let name: string | null = null;
  try {
    const info = await client.getSession();
    email = info.email ?? null;
    name = info.name ?? null;
  } catch {
    /* profile is optional */
  }
  const session: CarwashSession = {
    sessionToken: login.sessionToken,
    subject: login.subject,
    role: login.role,
    expiresAt: login.expiresAt,
    tenant: login.tenant ?? null,
    email,
    name,
  };
  await saveCarwashSession(session);
  api.dispatch(a.sessionChanged(session));
  return session;
}

function ensureSync(api: Api): CarwashSyncService {
  if (syncService) return syncService;
  syncService = new CarwashSyncService(
    {
      client: deps.client,
      outbox: deps.outbox,
      getSettings: () => api.getState().carwash.settings,
      getSession: () => api.getState().carwash.session,
      openStream: deps.openStream,
      debounceMs: deps.debounceMs,
    },
    {
      refresh: () => refreshAll(api),
      onFlushed: (result) => {
        void applyFlush(api, result);
      },
      onStatus: (status) => {
        api.dispatch(a.syncStatusChanged(status));
      },
      silentReLogin: async () => {
        try {
          const idToken = await deps.getGoogleIdToken(false);
          return idToken ? await exchangeIdToken(api, idToken) : null;
        } catch {
          return null;
        }
      },
      onSignedOut: () => {
        deps.client.setToken(null);
        void clearCarwashSession();
        api.dispatch(a.sessionCleared({ error: 'La sesión expiró. Inicia sesión de nuevo.' }));
      },
    },
  );
  return syncService;
}

type WriteOutcome = { failed: boolean; message: string | null };

/** Enqueue → mark → flush, then report whether the server rejected THIS entry. */
async function queueWrite(api: Api, op: CarwashOutboxOp): Promise<WriteOutcome> {
  const entry = await deps.outbox.enqueue(op);
  await updateMarks(api);
  const sync = syncService;
  if (sync && api.getState().carwash.session) await sync.afterLocalWrite();
  const after = (await deps.outbox.list()).find((e) => e.id === entry.id);
  if (after?.failed) {
    return { failed: true, message: after.lastError ?? 'El servidor rechazó el cambio' };
  }
  return { failed: false, message: null };
}

async function rollbackFailed(api: Api, previous: CarwashJob, op: CarwashOutboxOp, message: string): Promise<void> {
  const entries = await deps.outbox.failedEntries();
  for (const e of entries) {
    if (JSON.stringify(e.op) === JSON.stringify(op)) await deps.outbox.discard(e.id);
  }
  await updateMarks(api);
  api.dispatch(a.jobRestored({ job: previous, error: message }));
}

const findJob = (api: Api, jobId: string): CarwashJob | undefined => api.getState().carwash.jobs.find((j) => j.id === jobId);

// ── Thunks ─────────────────────────────────────────────────────────────
export const initCarwash = createAsyncThunk<void, void, ThunkConfig>('carwash/init', async (_arg, api) => {
  const settings = await loadCarwashSettings();
  api.dispatch(a.settingsLoaded(settings));
  deps.client.setBaseUrl(settings.apiBaseUrl);
  const session = await loadCarwashSession();
  if (session) {
    deps.client.setToken(session.sessionToken);
    api.dispatch(a.sessionChanged(session));
  }
  await updateMarks(api);
  api.dispatch(a.initialized());
  if (session) {
    // Do not block startup: sync flushes the outbox and refreshes in the background.
    void ensureSync(api).start().catch(() => undefined);
  } else {
    api.dispatch(a.syncStatusChanged({ ...api.getState().carwash.sync, state: 'signed-out' }));
  }
});

export const saveCarwashSettings = createAsyncThunk<CarwashSettings, Partial<CarwashSettings>, ThunkConfig>(
  'carwash/saveSettings',
  async (partial, api) => {
    const current = api.getState().carwash.settings;
    const next = await persistCarwashSettings(sanitizeCarwashSettings({ ...current, ...partial }));
    api.dispatch(a.settingsChanged(next));
    if (next.apiBaseUrl !== current.apiBaseUrl) {
      // A session is only valid on the server that issued it.
      deps.client.setBaseUrl(next.apiBaseUrl);
      if (api.getState().carwash.session) {
        syncService?.stop(false);
        deps.client.setToken(null);
        await clearCarwashSession();
        api.dispatch(a.sessionCleared({ error: null }));
      }
    } else if (next.pollSeconds !== current.pollSeconds && syncService?.isRunning()) {
      void syncService.start().catch(() => undefined);
    }
    return next;
  },
);

async function completeSignIn(api: Api, idToken: string): Promise<CarwashSession> {
  const session = await exchangeIdToken(api, idToken);
  void ensureSync(api).start().catch(() => undefined);
  return session;
}

export const signInCarwash = createAsyncThunk<CarwashSession, void, ThunkConfig>('carwash/signIn', async (_arg, api) => {
  try {
    let idToken = await deps.getGoogleIdToken(false);
    if (idToken) {
      try {
        return await completeSignIn(api, idToken);
      } catch (err) {
        // A cached/expired Google token: fall through to the interactive flow once.
        if (!(err instanceof CarwashApiError) || err.status !== 401) throw err;
      }
    }
    idToken = await deps.getGoogleIdToken(true);
    if (!idToken) return api.rejectWithValue('No se pudo obtener la identidad de Google');
    return await completeSignIn(api, idToken);
  } catch (err) {
    if (err instanceof CarwashApiError && err.status === 401) {
      return api.rejectWithValue('Tu cuenta de Google no tiene acceso a este lavado (o el servidor no acepta este cliente de Google).');
    }
    if (err instanceof CarwashApiError && err.status === 503) {
      return api.rejectWithValue('El servidor no tiene configurado el inicio de sesión con Google.');
    }
    return api.rejectWithValue(errMessage(err, 'No se pudo iniciar sesión'));
  }
});

/** Dev/test only: the API dev host accepts `dev:<subject>:<email>` tokens. */
export const signInCarwashWithToken = createAsyncThunk<CarwashSession, string, ThunkConfig>(
  'carwash/signInWithToken',
  async (idToken, api) => {
    const allowed = getViteEnv().DEV === true || (globalThis as { __SPARKLEWASH_TEST__?: boolean }).__SPARKLEWASH_TEST__ === true;
    if (!allowed) return api.rejectWithValue('Solo disponible en desarrollo');
    try {
      return await completeSignIn(api, idToken);
    } catch (err) {
      return api.rejectWithValue(errMessage(err, 'No se pudo iniciar sesión'));
    }
  },
);

export const signOutCarwash = createAsyncThunk<void, void, ThunkConfig>('carwash/signOut', async (_arg, api) => {
  syncService?.stop(false);
  if (api.getState().carwash.session) {
    try {
      await deps.client.deleteSession();
    } catch {
      /* the local session is dropped regardless */
    }
  }
  deps.client.setToken(null);
  await clearCarwashSession();
  api.dispatch(a.sessionCleared({ error: null }));
  await updateMarks(api);
});

export const refreshCarwash = createAsyncThunk<void, void, ThunkConfig>('carwash/refresh', async (_arg, api) => {
  if (!api.getState().carwash.session) return api.rejectWithValue('Inicia sesión para sincronizar');
  try {
    await refreshAll(api);
  } catch (err) {
    await syncService?.reportFailure(err);
    return api.rejectWithValue(errMessage(err, 'No se pudo actualizar'));
  }
});

export const flushCarwashOutbox = createAsyncThunk<number, void, ThunkConfig>('carwash/flushOutbox', async (_arg, api) => {
  if (api.getState().carwash.session && syncService) await syncService.afterLocalWrite();
  else await updateMarks(api);
  return deps.outbox.pendingCount();
});

export const createWalkInJob = createAsyncThunk<CarwashJob, WalkInInput, ThunkConfig>('carwash/createWalkIn', async (input, api) => {
  const plate = normalizePlate(input.plate);
  if (!plate) return api.rejectWithValue('Ingresa la placa del vehículo');
  const state = api.getState().carwash;
  const pkg = state.packages?.packages.find((p) => p.id === input.packageId);
  if (!pkg) return api.rejectWithValue('Paquete no disponible. Conéctate al servidor para cargar el catálogo.');
  const price = pkg.prices?.[input.vehicleClass];
  if (typeof price !== 'number') return api.rejectWithValue('El paquete no tiene precio para esta clase de vehículo');

  const ticketNumber = await deps.nextTicket(state.settings.registerCode);
  const now = deps.now().toISOString();
  const localId = `local-${deps.uuid()}`;
  const employee = input.employeeId ? state.employees.find((e) => e.id === input.employeeId) : undefined;
  const job: CarwashJob = {
    id: localId,
    arrivalId: '',
    plate,
    vehicleClass: input.vehicleClass,
    packageId: pkg.id,
    packageName: pkg.name,
    services: [...pkg.items],
    priceUsd: price,
    currency: state.packages?.currency ?? 'USD',
    status: 'arrived',
    arrivalAt: now,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    elapsedSeconds: 0,
    activeSeconds: null,
    transitions: [{ status: 'arrived', at: now, actor: 'local', idempotencyKey: localId }],
    assignments:
      input.employeeId && employee ? [{ employeeId: employee.id, employeeName: employee.name, assignedAt: now }] : [],
    source: 'desktop-pos',
    ticketNumber,
    customerName: input.customerName?.trim() || null,
    note: input.note?.trim() || null,
    payments: [],
    paidUsd: 0,
    paymentStatus: 'unpaid',
    paidAt: null,
    pendingSync: true,
    syncError: null,
  };
  api.dispatch(a.jobAddedLocal(job));
  const outcome = await queueWrite(api, {
    kind: 'walk-in',
    localJobId: localId,
    input: { ...input, plate, ticketNumber },
  });
  const serverId = await deps.outbox.resolveJobId(localId);
  const latest = findJob(api, serverId) ?? findJob(api, localId) ?? job;
  if (outcome.failed) return { ...latest, pendingSync: false, syncError: outcome.message };
  return latest;
});

async function simpleWrite(
  api: Api,
  jobId: string,
  op: CarwashOutboxOp,
  optimistic: () => void,
): Promise<CarwashJob | string> {
  const previous = findJob(api, jobId);
  if (!previous) return 'El servicio ya no existe';
  const snapshot = JSON.parse(JSON.stringify(previous)) as CarwashJob;
  optimistic();
  const outcome = await queueWrite(api, op);
  if (outcome.failed) {
    const message = outcome.message ?? 'El servidor rechazó el cambio';
    await rollbackFailed(api, snapshot, op, message);
    return message;
  }
  const id = await deps.outbox.resolveJobId(jobId);
  return findJob(api, id) ?? findJob(api, jobId) ?? snapshot;
}

export const transitionJob = createAsyncThunk<CarwashJob, { jobId: string; status: Exclude<JobStatus, 'arrived'> }, ThunkConfig>(
  'carwash/transition',
  async ({ jobId, status }, api) => {
    const job = findJob(api, jobId);
    if (!job) return api.rejectWithValue('El servicio ya no existe');
    if (!NEXT_JOB_STATUSES[job.status].includes(status)) return api.rejectWithValue('Cambio de estado no permitido');
    const at = deps.now().toISOString();
    const result = await simpleWrite(api, jobId, { kind: 'transition', jobId, status }, () =>
      api.dispatch(a.jobTransitionedLocal({ jobId, status, at, key: deps.uuid() })),
    );
    return typeof result === 'string' ? api.rejectWithValue(result) : result;
  },
);

export const assignJobEmployee = createAsyncThunk<CarwashJob, { jobId: string; employeeId: string }, ThunkConfig>(
  'carwash/assignEmployee',
  async ({ jobId, employeeId }, api) => {
    const employee = api.getState().carwash.employees.find((e) => e.id === employeeId);
    if (!employee) return api.rejectWithValue('Empleado no encontrado');
    const at = deps.now().toISOString();
    const result = await simpleWrite(api, jobId, { kind: 'assign', jobId, employeeId }, () =>
      api.dispatch(a.jobAssignedLocal({ jobId, employeeId, employeeName: employee.name, at })),
    );
    return typeof result === 'string' ? api.rejectWithValue(result) : result;
  },
);

export const attachJobTicket = createAsyncThunk<CarwashJob, { jobId: string; ticketNumber: string }, ThunkConfig>(
  'carwash/attachTicket',
  async ({ jobId, ticketNumber }, api) => {
    const ticket = ticketNumber.trim();
    if (!/^[A-Za-z0-9-]{1,32}$/.test(ticket)) return api.rejectWithValue('Número de ticket inválido');
    const result = await simpleWrite(api, jobId, { kind: 'ticket', jobId, ticketNumber: ticket }, () =>
      api.dispatch(a.jobTicketLocal({ jobId, ticketNumber: ticket })),
    );
    return typeof result === 'string' ? api.rejectWithValue(result) : result;
  },
);

export const recordJobPayment = createAsyncThunk<CarwashJob, { jobId: string; payment: JobPaymentInput }, ThunkConfig>(
  'carwash/recordPayment',
  async ({ jobId, payment }, api) => {
    if (!(payment.amountUsd > 0) || payment.amountUsd > 100000) return api.rejectWithValue('Monto de pago inválido');
    const local: JobPayment = {
      id: `local-payment-${deps.uuid()}`,
      method: payment.method,
      amountUsd: payment.amountUsd,
      ticketNumber: payment.ticketNumber ?? null,
      reference: payment.reference ?? null,
      recordedAt: deps.now().toISOString(),
      actor: 'local',
      idempotencyKey: 'local',
    };
    const result = await simpleWrite(api, jobId, { kind: 'payment', jobId, payment }, () =>
      api.dispatch(a.jobPaymentLocal({ jobId, payment: local })),
    );
    return typeof result === 'string' ? api.rejectWithValue(result) : result;
  },
);

// ── Selectors ──────────────────────────────────────────────────────────
export const selectCarwash = (state: CarwashRoot): CarwashState => state.carwash;
export const selectCarwashSettings = (state: CarwashRoot): CarwashSettings => state.carwash.settings;
export const selectCarwashSession = (state: CarwashRoot): CarwashSession | null => state.carwash.session;
/** The cached catalog: packages, vehicle classes and currency. */
export const selectCarwashPackages = (state: CarwashRoot): PackageCatalog | null => state.carwash.packages;
export const selectCarwashEmployees = (state: CarwashRoot): Employee[] => state.carwash.employees;
export const selectCarwashJobs = (state: CarwashRoot): CarwashJob[] => state.carwash.jobs;
export const selectCarwashSyncStatus = (state: CarwashRoot): CarwashSyncStatus => state.carwash.sync;

export const selectCarwashJobsByStatus = createSelector([selectCarwashJobs], (jobs): Record<JobStatus, CarwashJob[]> => {
  const grouped: Record<JobStatus, CarwashJob[]> = { arrived: [], queued: [], in_progress: [], completed: [], cancelled: [] };
  for (const job of jobs) grouped[job.status].push(job);
  return grouped;
});

/** Not cancelled and not fully paid — what the POS "Cobrar lavado" picker lists. */
export const selectUnpaidCarwashJobs = createSelector([selectCarwashJobs], (jobs): CarwashJob[] =>
  jobs.filter((j) => j.status !== 'cancelled' && j.paymentStatus !== 'paid'),
);

export const selectCarwashSummary = createSelector([selectCarwashJobs, (s: CarwashRoot) => s.carwash.summary], (jobs, summary): JobSummary => {
  if (summary) return summary;
  const count = (status: JobStatus) => jobs.filter((j) => j.status === status).length;
  return {
    total: jobs.length,
    arrived: count('arrived'),
    queued: count('queued'),
    inProgress: count('in_progress'),
    completed: count('completed'),
    cancelled: count('cancelled'),
    arrivalsTodayUtc: 0,
    completedTodayUtc: 0,
    averageCompletedSeconds: null,
  };
});

export const selectCarwashJobById = (id: string) => (state: CarwashRoot): CarwashJob | undefined =>
  state.carwash.jobs.find((j) => j.id === id);
