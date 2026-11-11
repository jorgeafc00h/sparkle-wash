// Device Sync v2 state (design D2/D6): per-company epoch + cursor, the persisted outbox,
// the version map (LWW metadata + tombstones), peer manifests, conflicts and correlativo
// maxima. Persisted (see store/persistence.ts) so an edit captured before a process death
// is still pushed on the next session.
//
// The outbox holds REFERENCES ({t,id,op,u}), not payloads: the payload is materialized
// from the current entity at flush time, so repeated edits coalesce into one push and a
// large snapshot never bloats persisted state.
//
// Phase 1/2 additions: `claims` (companies this account proved against the backend via
// POST /api/auth/companies/claim — persisted, so "empresa vinculada" survives restarts)
// and `registeredDevices` (GET /api/sync/devices, runtime-only — gates the "Automático"
// option to companies with more than one device).

import { createSlice, createAsyncThunk, isAnyOf, type PayloadAction } from '@reduxjs/toolkit';
import type { DeviceManifest, SyncEntityType, SyncOp } from '../../services/sync/protocol';
import { companySyncKey, entityKey, isProductionSyncCompany, TEST_ENVIRONMENT_KEY_SUFFIX } from '../../services/sync/protocol';
import type { RegisteredSyncDevice } from '../../services/sync/syncDevicesService';
import { claimCompany, CLAIM_MESSAGES, type CompanyClaimResult } from '../../services/sync/companyClaimService';
import AuthProviderService from '../../services/auth/AuthProviderService';
import {
  googleSignIn,
  googleSignOut,
  linkGoogleProvider,
  logout,
  logoutUser,
  updateSessionToken,
} from './authSlice';
import type { Company } from '@/types';
import type { SyncConflict, VersionMeta } from '../../services/sync/mergeEngine';

export type SyncV2Status = 'idle' | 'locked' | 'connecting' | 'syncing' | 'live' | 'offline' | 'error';

export interface OutboxRef {
  t: SyncEntityType;
  id: string;
  op: SyncOp;
  u: string;
  /** Purchase dedupe key carried by tombstones so peers can match independent imports. */
  k?: string;
}

export interface RejectedRef {
  key: string;
  reason: string;
  at: string;
}

/** Outcome of one company claim (persisted so restarts and the panel know the state). */
export interface CompanyClaimState {
  status: 'claimed' | 'failed';
  /** The co{NIT-digits} key the backend linked. */
  companyId?: string;
  at: string;
  /** Last definitive failure (wrong credentials) — retried via "Vincular empresa". */
  error?: string | null;
}

export interface CompanySyncState {
  epoch: string | null;
  /** Last applied server log id within `epoch` ('0' = from the start). */
  cursor: string;
  lastSyncAt: string | null;
  lastLocalChangeAt: string | null;
  outbox: Record<string, OutboxRef>;
  versions: Record<string, VersionMeta>;
  devices: DeviceManifest[];
  correlativoMaxima: Record<string, number>;
  conflicts: SyncConflict[];
  pendingVerify: SyncEntityType[];
  rejected: RejectedRef[];
}

export interface SyncV2State {
  deviceId: string | null;
  status: SyncV2Status;
  lastError: string | null;
  /** Background bursts ("Automático") — manual-only by default, and only offered when the company has more than one device. */
  autoSync: boolean;
  /**
   * The relay accepted this user's JWT (tier pro_sync/enterprise + company membership).
   * Lets capture run for entitlements granted server-side (centralized N1CO purchase)
   * before the local subscription tier catches up; cleared on a forbidden response.
   */
  entitled: boolean;
  /** Companies (co keys) this account proved to the backend — persisted. */
  claims: Record<string, CompanyClaimState>;
  /** Claim attempts in flight (runtime). */
  claiming: Record<string, boolean>;
  /** Devices the relay knows per company, GET /api/sync/devices (runtime). */
  registeredDevices: Record<string, RegisteredSyncDevice[]>;
  /** Transient presence (not persisted): deviceIds online per company. */
  onlineByCo: Record<string, string[]>;
  companies: Record<string, CompanySyncState>;
}

export const MAX_CONFLICTS = 50;
export const MAX_REJECTED = 50;

export const createCompanySyncState = (): CompanySyncState => ({
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
});

const initialState: SyncV2State = {
  deviceId: null,
  status: 'idle',
  lastError: null,
  autoSync: false,
  entitled: false,
  claims: {},
  claiming: {},
  registeredDevices: {},
  onlineByCo: {},
  companies: {},
};

const toMillis = (iso: string | null | undefined): number => {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
};

const ensureCompany = (state: SyncV2State, co: string): CompanySyncState => {
  if (!state.companies[co]) state.companies[co] = createCompanySyncState();
  return state.companies[co];
};

/**
 * Whether `company` is claimed for the signed-in account. The Pruebas twin rides the
 * production claim — the relay authorizes co{nit}test from the production key — so a
 * test company counts as claimed once its production twin is.
 */
export const isCompanyClaimed = (
  claims: Record<string, CompanyClaimState>,
  company: Parameters<typeof companySyncKey>[0],
): boolean => {
  const co = companySyncKey(company);
  if (!co) return false;
  if (claims[co]?.status === 'claimed') return true;
  if (!isProductionSyncCompany(company) && co.endsWith(TEST_ENVIRONMENT_KEY_SUFFIX)) {
    return claims[co.slice(0, -TEST_ENVIRONMENT_KEY_SUFFIX.length)]?.status === 'claimed';
  }
  return false;
};

/** Seeds claim state from a sign-in session's already-linked companies. */
const seedSessionClaims = (state: SyncV2State, companies: unknown): void => {
  if (!Array.isArray(companies)) return;
  const at = new Date().toISOString();
  for (const co of companies) {
    // The backend session is authoritative: it also overwrites a stale local `failed`
    // record (e.g. wrong-credential attempts from before the company was linked).
    if (typeof co === 'string' && co && state.claims[co]?.status !== 'claimed') {
      state.claims[co] = { status: 'claimed', companyId: co, at };
    }
  }
};

/** Claims are account-scoped: drop them (and the runtime device list) on sign-out. */
const clearAccountSyncState = (state: SyncV2State): void => {
  state.claims = {};
  state.claiming = {};
  state.registeredDevices = {};
  state.onlineByCo = {};
};

/**
 * App-wide claim serialization. The claim endpoint returns a refreshed internal JWT
 * listing the companies linked SO FAR; two claims racing their token persist could
 * leave storage holding the token of whichever finished first — one that lacks the
 * other company, which the relay would then refuse until the next sign-in. Running
 * one claim at a time (dispatch order) makes every token a superset of the previous.
 */
let claimQueue: Promise<unknown> = Promise.resolve();
const enqueueClaim = <T>(work: () => Promise<T>): Promise<T> => {
  const run = claimQueue.then(work, work);
  claimQueue = run.then(() => undefined, () => undefined);
  return run;
};

/**
 * Proves ownership of the company's NIT against the backend (the company's MH
 * credentials + the internal JWT) and links co{NIT} to the account. Dispatched on
 * sign-in, on production activation and from the "Vincular empresa" action.
 */
export const claimSyncCompany = createAsyncThunk<CompanyClaimResult | null, Company>(
  'syncV2/claimCompany',
  async (company, { dispatch, getState }) => {
    const co = companySyncKey(company);
    if (!co) return null;
    const syncState = (getState() as { syncV2?: SyncV2State }).syncV2;
    if (syncState?.claiming?.[co]) return null; // already running (sign-in + button race)
    dispatch(setClaiming({ co, claiming: true }));
    try {
      const result = await enqueueClaim(() => claimCompany(company, {
        alreadyClaimed: isCompanyClaimed(syncState?.claims ?? {}, company),
      }));
      // A sign-out while the claim was in flight cleared the account's sync state and
      // the stored session — applying the result now would write the JWT back into
      // storage for a logged-out user and re-seed claims that were just reset.
      const stillSignedIn = (getState() as { auth?: { isAuthenticated?: boolean } }).auth?.isAuthenticated !== false;
      const at = new Date().toISOString();
      if (stillSignedIn && (result.kind === 'claimed' || result.kind === 'already-claimed')) {
        // The refreshed JWT carries the company — persist it (never logged) so the
        // next sync session is authorized by the relay.
        if (result.token) {
          try {
            await AuthProviderService.updateToken(result.token);
            dispatch(updateSessionToken(result.token));
          } catch {
            // Storage failure must not lose the claim state.
          }
        }
        dispatch(companyClaimSucceeded({ co, companyId: result.companyId, at, companies: result.companies }));
      } else if (stillSignedIn && result.kind === 'invalid-credentials') {
        dispatch(companyClaimFailed({ co, error: result.message, at }));
      }
      // Transient outcomes (offline / Hacienda down / not signed in / credentials not
      // saved yet) leave the company unclaimed so a later sign-in retries.
      return result;
    } catch {
      return { kind: 'error', message: CLAIM_MESSAGES.error };
    } finally {
      dispatch(setClaiming({ co, claiming: false }));
    }
  },
);

export interface LocalChange extends OutboxRef {}

const syncV2Slice = createSlice({
  name: 'syncV2',
  initialState,
  reducers: {
    setSyncDeviceId(state, action: PayloadAction<string>) {
      state.deviceId = action.payload;
    },
    setSyncStatus(state, action: PayloadAction<{ status: SyncV2Status; error?: string | null }>) {
      state.status = action.payload.status;
      state.lastError = action.payload.error ?? (action.payload.status === 'error' ? state.lastError : null);
    },
    setAutoSync(state, action: PayloadAction<boolean>) {
      state.autoSync = action.payload;
    },
    setSyncEntitled(state, action: PayloadAction<boolean>) {
      state.entitled = action.payload;
    },
    companyClaimSucceeded(state, action: PayloadAction<{ co: string; companyId: string; at: string; companies?: string[] }>) {
      const { co, companyId, at, companies } = action.payload;
      state.claims[co] = { status: 'claimed', companyId, at };
      // The refreshed session lists EVERY company linked to the account — seed them
      // so later sign-ins skip claims the backend already knows about (and overwrite
      // stale `failed` records the backend contradicts).
      for (const key of companies ?? []) {
        if (typeof key === 'string' && key && state.claims[key]?.status !== 'claimed') {
          state.claims[key] = { status: 'claimed', companyId: key, at };
        }
      }
    },
    companyClaimFailed(state, action: PayloadAction<{ co: string; error: string; at: string }>) {
      state.claims[action.payload.co] = { status: 'failed', error: action.payload.error, at: action.payload.at };
    },
    setClaiming(state, action: PayloadAction<{ co: string; claiming: boolean }>) {
      if (action.payload.claiming) state.claiming[action.payload.co] = true;
      else delete state.claiming[action.payload.co];
    },
    setRegisteredDevices(state, action: PayloadAction<{ co: string; devices: RegisteredSyncDevice[] }>) {
      state.registeredDevices[action.payload.co] = action.payload.devices;
    },
    /** Sign-out: claims are account-scoped, the device list is session-scoped. */
    resetAccountSyncState(state) {
      clearAccountSyncState(state);
    },
    /** Captured local writes: outbox ref (newest wins per entity) + our own version stamp. */
    recordLocalChanges(state, action: PayloadAction<{ co: string; deviceId: string; changes: LocalChange[] }>) {
      const { co, deviceId, changes } = action.payload;
      if (changes.length === 0) return;
      const company = ensureCompany(state, co);
      for (const change of changes) {
        const key = entityKey(change.t, change.id);
        const existing = company.outbox[key];
        if (!existing || toMillis(change.u) >= toMillis(existing.u)) {
          company.outbox[key] = { ...change };
        }
        company.versions[key] = {
          u: change.u,
          d: deviceId,
          ...(change.op === 'delete' ? { del: true } : {}),
          ...(change.k ? { k: change.k } : {}),
        };
        if (toMillis(change.u) > toMillis(company.lastLocalChangeAt)) company.lastLocalChangeAt = change.u;
      }
    },
    /** Snapshot / peer-answer pushes: queue refs without touching version metadata. */
    enqueueOutbox(state, action: PayloadAction<{ co: string; refs: OutboxRef[] }>) {
      const company = ensureCompany(state, action.payload.co);
      for (const ref of action.payload.refs) {
        const key = entityKey(ref.t, ref.id);
        const existing = company.outbox[key];
        if (!existing || toMillis(ref.u) >= toMillis(existing.u)) company.outbox[key] = { ...ref };
      }
    },
    /** Server ack: clear only refs still at the pushed version (a newer edit stays queued). */
    ackOutbox(state, action: PayloadAction<{ co: string; refs: OutboxRef[] }>) {
      const company = state.companies[action.payload.co];
      if (!company) return;
      for (const ref of action.payload.refs) {
        const key = entityKey(ref.t, ref.id);
        const current = company.outbox[key];
        if (current && current.u === ref.u && current.op === ref.op) delete company.outbox[key];
      }
    },
    /** Server/encoder rejection: drop the ref (never retried blindly) and keep a visible record. */
    rejectOutbox(state, action: PayloadAction<{ co: string; items: { ref: OutboxRef; reason: string }[]; at: string }>) {
      const company = state.companies[action.payload.co];
      if (!company) return;
      for (const { ref, reason } of action.payload.items) {
        const key = entityKey(ref.t, ref.id);
        const current = company.outbox[key];
        if (current && current.u === ref.u) delete company.outbox[key];
        company.rejected.unshift({ key, reason, at: action.payload.at });
      }
      company.rejected = company.rejected.slice(0, MAX_REJECTED);
    },
    /** Versions adopted from applied remote changes (also records remote tombstones). */
    recordRemoteVersions(state, action: PayloadAction<{ co: string; versions: { key: string; meta: VersionMeta }[] }>) {
      const company = ensureCompany(state, action.payload.co);
      for (const { key, meta } of action.payload.versions) company.versions[key] = { ...meta };
    },
    /** A local entity was replaced by a remote one — any queued local ref for it is obsolete. */
    dropOutboxKeys(state, action: PayloadAction<{ co: string; keys: string[] }>) {
      const company = state.companies[action.payload.co];
      if (!company) return;
      for (const key of action.payload.keys) delete company.outbox[key];
    },
    setCursor(state, action: PayloadAction<{ co: string; epoch: string; cursor: string }>) {
      const company = ensureCompany(state, action.payload.co);
      company.epoch = action.payload.epoch;
      company.cursor = action.payload.cursor;
    },
    /** EpochReset / cold start: the server lost its log — drop the cursor and adopt the epoch. */
    adoptEpoch(state, action: PayloadAction<{ co: string; epoch: string }>) {
      const company = ensureCompany(state, action.payload.co);
      company.epoch = action.payload.epoch;
      company.cursor = '0';
      company.pendingVerify = [];
    },
    setPeers(state, action: PayloadAction<{ co: string; devices?: DeviceManifest[]; online?: string[] }>) {
      const company = ensureCompany(state, action.payload.co);
      if (action.payload.devices) {
        // Merge by deviceId so a Register (online peers only) doesn't erase offline devices.
        const byId = new Map(company.devices.map(device => [device.deviceId, device]));
        for (const device of action.payload.devices) byId.set(device.deviceId, device);
        company.devices = Array.from(byId.values());
      }
      if (action.payload.online) state.onlineByCo[action.payload.co] = action.payload.online;
    },
    mergeCorrelativoMaxima(state, action: PayloadAction<{ co: string; maxima: Record<string, number> }>) {
      const company = ensureCompany(state, action.payload.co);
      for (const [docType, value] of Object.entries(action.payload.maxima)) {
        if (!Number.isFinite(value)) continue;
        if ((company.correlativoMaxima[docType] ?? 0) < value) company.correlativoMaxima[docType] = value;
      }
    },
    addConflicts(state, action: PayloadAction<{ co: string; conflicts: SyncConflict[] }>) {
      const company = ensureCompany(state, action.payload.co);
      for (const conflict of action.payload.conflicts) {
        const exists = company.conflicts.some(
          item => item.t === conflict.t && item.id === conflict.id && item.field === conflict.field
            && item.remote === conflict.remote,
        );
        if (!exists) company.conflicts.unshift(conflict);
      }
      company.conflicts = company.conflicts.slice(0, MAX_CONFLICTS);
    },
    clearConflicts(state, action: PayloadAction<{ co: string }>) {
      const company = state.companies[action.payload.co];
      if (company) company.conflicts = [];
    },
    setPendingVerify(state, action: PayloadAction<{ co: string; types: SyncEntityType[] }>) {
      ensureCompany(state, action.payload.co).pendingVerify = Array.from(new Set(action.payload.types));
    },
    sessionCompleted(state, action: PayloadAction<{ co: string; at: string }>) {
      ensureCompany(state, action.payload.co).lastSyncAt = action.payload.at;
    },
    /** Tombstones older than the retention window can't matter anymore (server keeps ≤30 days). */
    pruneTombstones(state, action: PayloadAction<{ co: string; before: string }>) {
      const company = state.companies[action.payload.co];
      if (!company) return;
      const cutoff = toMillis(action.payload.before);
      for (const [key, meta] of Object.entries(company.versions)) {
        if (meta.del && toMillis(meta.u) < cutoff && !company.outbox[key]) delete company.versions[key];
      }
    },
    resetSyncV2Company(state, action: PayloadAction<{ co: string }>) {
      delete state.companies[action.payload.co];
      delete state.onlineByCo[action.payload.co];
    },
    resetSyncV2(state) {
      return { ...initialState, deviceId: state.deviceId };
    },
  },
  extraReducers: builder => {
    // A sign-in session reports the account's already-linked companies — seed claim
    // state so Hacienda credentials are not re-proved on every sign-in.
    builder
      .addCase(googleSignIn.fulfilled, (state, action) => {
        if (action.payload.authenticated) seedSessionClaims(state, action.payload.companies);
      })
      .addCase(linkGoogleProvider.fulfilled, (state, action) => {
        seedSessionClaims(state, action.payload.companies);
      })
      // Sign-out: claims belong to the account that proved them.
      .addMatcher(isAnyOf(logoutUser.fulfilled, googleSignOut.fulfilled, logout), state => {
        clearAccountSyncState(state);
      });
  },
});

export const {
  setSyncDeviceId,
  setSyncStatus,
  setAutoSync,
  setSyncEntitled,
  companyClaimSucceeded,
  companyClaimFailed,
  setClaiming,
  setRegisteredDevices,
  resetAccountSyncState,
  recordLocalChanges,
  enqueueOutbox,
  ackOutbox,
  rejectOutbox,
  recordRemoteVersions,
  dropOutboxKeys,
  setCursor,
  adoptEpoch,
  setPeers,
  mergeCorrelativoMaxima,
  addConflicts,
  clearConflicts,
  setPendingVerify,
  sessionCompleted,
  pruneTombstones,
  resetSyncV2Company,
  resetSyncV2,
} = syncV2Slice.actions;

export default syncV2Slice.reducer;
