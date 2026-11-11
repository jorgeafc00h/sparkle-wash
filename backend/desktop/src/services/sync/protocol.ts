// Device Sync v2 — wire protocol shared with Invoices.SyncApi (/hubs/sync + /api/v2/sync/*)
// and the App.Desktop client. Keep these shapes byte-identical across platforms:
// the server relays envelopes opaquely, so both clients must agree on every field.
// Protocol reference: docs/SYNC_V2_REDIS_SIGNALR_STRATEGY.md §6 (OpenSpec change wins on conflict).

import type { Company } from '@/types';

/** Entity types the relay accepts (server SyncValidator.EntityTypes). */
export type SyncEntityType = 'invoice' | 'customer' | 'product' | 'purchase' | 'company' | 'ticket';

export const SYNC_ENTITY_TYPES: readonly SyncEntityType[] = [
  'company',
  'customer',
  'product',
  'invoice',
  'purchase',
  'ticket',
] as const;

export type SyncOp = 'upsert' | 'delete';

/**
 * One relayed change. Wire names are short on purpose (t/id/op/u/d/p):
 * t = entity type, id = entity id, op = upsert|delete, u = ISO updatedAt,
 * d = origin deviceId, p = base64(gzip(JSON payload)).
 */
export interface ChangeEnvelope {
  t: SyncEntityType;
  id: string;
  op: SyncOp;
  u: string;
  d: string;
  p: string;
}

export interface DeviceManifest {
  deviceId: string;
  platform: 'android' | 'desktop' | 'ios';
  appVersion: string;
  lastSyncAt: string | null;
  lastSeenId: string | null;
  epoch: string | null;
  lastLocalChangeAt: string | null;
  /** Live (non-tombstoned) entity counts keyed by SyncEntityType. */
  counts: Partial<Record<SyncEntityType, number>>;
  /** Highest correlativo issued per DTE type code ("01", "03", …). */
  maxCorrelativo: Record<string, number>;
}

export interface RegisterResponse {
  epoch: string;
  head: string;
  peers: DeviceManifest[];
}

export interface RejectedChange {
  index: number;
  reason: string;
}

export interface PushResponse {
  lastId: string;
  rejected: RejectedChange[];
}

export interface LogEntry {
  id: string;
  change: ChangeEnvelope;
}

export interface PullResponse {
  entries: LogEntry[];
  /** The log HEAD — not the last returned entry (clients advance to the last applied id). */
  lastId: string;
  epoch: string;
  /** More entries exist after this page. */
  hasMore?: boolean;
  /** The cursor predates the oldest retained entry: the relay's bounded log was trimmed. */
  truncated?: boolean;
}

export interface SyncStatusResponse {
  epoch: string;
  head: string;
  devices: DeviceManifest[];
  online: string[];
  correlativoMaxima: Record<string, number>;
}

export interface QueryPeersResponse {
  sent: boolean;
  onlinePeers: string[];
}

/** Per-type digest used by the count-mismatch reconcile (§6.5). */
export interface EntityDigest {
  type: SyncEntityType;
  count: number;
  hash: string;
  /** `key:updatedAt` list — only exchanged when the hashes differ. */
  items?: string[];
}

/** Hub error payload (403-equivalent authz failures, validation errors). */
export interface HubErrorPayload {
  error: string;
  limit?: number;
}

export const SYNC_LIMITS = {
  maxChangesPerPush: 500,
  maxPullEntries: 500,
  maxPayloadBytes: 16 * 1024,
  /**
   * Byte budget per Push message. SignalR servers cap inbound message size (ASP.NET Core
   * defaults to 32 KB), so batches are cut by size as well as count — a 500-entry snapshot
   * of real invoices would otherwise get the socket closed mid-push.
   */
  maxPushBytes: 256 * 1024,
  /** Retries of a batch the relay refused with `rate_limited` (1 s, 2 s, 4 s, 8 s, 8 s back-off). */
  maxRateLimitRetries: 5,
} as const;

/** Hub method + event names — a typo here is a silent no-op on the wire. */
export const HUB_METHODS = {
  register: 'Register',
  push: 'Push',
  pull: 'Pull',
  reportManifest: 'ReportManifest',
  queryPeers: 'QueryPeers',
  requestDigest: 'RequestDigest',
  digest: 'Digest',
} as const;

export const HUB_EVENTS = {
  changesAvailable: 'ChangesAvailable',
  peersChanged: 'PeersChanged',
  epochReset: 'EpochReset',
  dataRequested: 'DataRequested',
  digestRequested: 'DigestRequested',
  digestAvailable: 'DigestAvailable',
} as const;

export const isHubError = (value: unknown): value is HubErrorPayload =>
  !!value && typeof value === 'object' && typeof (value as HubErrorPayload).error === 'string';

/** Suffix that keeps a Pruebas (test-environment) company out of its production twin's group. */
export const TEST_ENVIRONMENT_KEY_SUFFIX = 'test';

export const isProductionSyncCompany = (
  company: Partial<Pick<Company, 'environment' | 'isProduction'>> | null | undefined,
): boolean => company?.isProduction === true || company?.environment === 'PRODUCTION';

/**
 * Canonical company key `{co}`: `co` + NIT digits, lowercase alphanumerics only —
 * the same canonicalization as the v1 `co{NIT}` tables (server SyncCo.Normalize),
 * so the JWT `companies` claim and the hub group line up for every device of
 * the owner regardless of each device's local company id. A Pruebas company shares
 * its NIT with the production twin the production-access wizard creates, so
 * non-production companies get a `test` suffix — test DTEs never reach the
 * production group.
 */
export const companySyncKey = (
  company: Pick<Company, 'id' | 'nit'> & Partial<Pick<Company, 'environment' | 'isProduction'>> | null | undefined,
): string | null => {
  if (!company) return null;
  const nitDigits = (company.nit ?? '').replace(/\D/g, '');
  const base = nitDigits.length > 0 ? `co${nitDigits}` : `co${company.id ?? ''}`;
  const raw = isProductionSyncCompany(company) ? base : `${base}${TEST_ENVIRONMENT_KEY_SUFFIX}`;
  const normalized = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized.length >= 3 && normalized.length <= 63 ? normalized : null;
};

/** Stable map key for per-entity bookkeeping (outbox, versions, tombstones). */
export const entityKey = (t: SyncEntityType, id: string): string => `${t}:${id}`;

export const parseEntityKey = (key: string): { t: SyncEntityType; id: string } => {
  const index = key.indexOf(':');
  return { t: key.slice(0, index) as SyncEntityType, id: key.slice(index + 1) };
};
