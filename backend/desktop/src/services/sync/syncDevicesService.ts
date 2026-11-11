// Registered sync devices (Device Sync v2, Phase 2) — GET {SYNC_API_URL}/api/sync/devices.
//
// Answers "how many devices does this company have?" WITHOUT opening a session: the
// sync panel only offers the "Automático" background option when more than one device
// is registered, and shows the list (deviceId + relative lastSeen). The endpoint is
// new on the relay, so every failure mode (404 not deployed yet, 403, unexpected
// shape, network) resolves to "unavailable" — callers then assume a single device and
// hide the auto option, never blocking sync on it.

export interface RegisteredSyncDevice {
  deviceId: string;
  /** Company sync key the relay attributes the device to, when it says so. */
  co: string | null;
  platform: string | null;
  /** ISO timestamp of the device's last contact with the relay. */
  lastSeen: string | null;
}

export type SyncDevicesResult =
  | { kind: 'devices'; devices: RegisteredSyncDevice[] }
  | { kind: 'unavailable' };

export interface SyncDevicesDeps {
  fetchImpl?: typeof fetch;
  /** Internal app JWT — the relay authorizes on the Bearer token's companies claim. */
  getToken: () => Promise<string | null>;
}

interface DeviceRow {
  deviceId?: unknown;
  co?: unknown;
  platform?: unknown;
  lastSeen?: unknown;
  lastSyncAt?: unknown;
  lastLocalChangeAt?: unknown;
}

const asIsoOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null;

const mapRow = (row: unknown, coFallback: string | null): RegisteredSyncDevice | null => {
  if (!row || typeof row !== 'object') return null;
  const typed = row as DeviceRow;
  if (typeof typed.deviceId !== 'string' || !typed.deviceId) return null;
  return {
    deviceId: typed.deviceId,
    co: typeof typed.co === 'string' && typed.co ? typed.co : coFallback,
    platform: typeof typed.platform === 'string' ? typed.platform : null,
    lastSeen: asIsoOrNull(typed.lastSeen) ?? asIsoOrNull(typed.lastSyncAt) ?? asIsoOrNull(typed.lastLocalChangeAt),
  };
};

/**
 * Defensive parser for the devices response. Accepted shapes (camelCase, like every
 * other SyncApi payload):
 *   { "devices": [ { "deviceId", "co"?, "platform"?, "lastSeen"? | "lastSyncAt"? } ] }
 *   { "companies": [ { "co", "devices": [ … ] } ] }   (alternate grouping)
 * Anything else — or no usable rows — is "unavailable" so callers fall back to
 * single-device behaviour.
 */
export const parseSyncDevicesBody = (body: unknown): RegisteredSyncDevice[] | null => {
  if (!body || typeof body !== 'object') return null;
  const typed = body as { devices?: unknown; companies?: unknown };

  const rows: RegisteredSyncDevice[] = [];
  if (Array.isArray(typed.devices)) {
    for (const row of typed.devices) {
      const mapped = mapRow(row, null);
      if (mapped) rows.push(mapped);
    }
  } else if (Array.isArray(typed.companies)) {
    for (const company of typed.companies) {
      if (!company || typeof company !== 'object') continue;
      const co = typeof (company as { co?: unknown }).co === 'string' ? (company as { co: string }).co : null;
      const devices = (company as { devices?: unknown }).devices;
      if (!Array.isArray(devices)) continue;
      for (const row of devices) {
        const mapped = mapRow(row, co);
        if (mapped) rows.push(mapped);
      }
    }
  } else {
    return null;
  }
  return rows.length > 0 ? rows : null;
};

/** The "Automático" option needs a second device; our own counts as one of the two. */
export const isMultiDeviceCompany = (devices: RegisteredSyncDevice[]): boolean => devices.length > 1;

/**
 * Fetches the devices the relay knows for `co` (all devices registered for the
 * company, this one included). Rows the relay tags with another company are dropped;
 * untagged rows are kept (a relay that doesn't tag returns one flat list).
 */
export async function fetchRegisteredSyncDevices(
  co: string,
  deps: SyncDevicesDeps & { baseUrl: string },
): Promise<SyncDevicesResult> {
  const origin = deps.baseUrl.replace(/\/+$/, '');
  if (!origin) return { kind: 'unavailable' };

  const doFetch = deps.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
  if (!doFetch) return { kind: 'unavailable' };

  let response: Response;
  try {
    const token = await deps.getToken();
    response = await doFetch(`${origin}/api/sync/devices`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    return { kind: 'unavailable' };
  }
  if (!response.ok) return { kind: 'unavailable' }; // 404/403/… ⇒ single-device assumption

  const body = await response.json().catch(() => null);
  const rows = parseSyncDevicesBody(body);
  if (!rows) return { kind: 'unavailable' };
  return { kind: 'devices', devices: rows.filter(row => !row.co || row.co === co) };
}
