// Registered sync devices (Phase 2) — GET /api/sync/devices gating: the parse is
// defensive (a 404 or unexpected shape means "single device", never a broken panel),
// the multi-device gate needs a second device, and rows tagged for another company
// are filtered out.

import {
  fetchRegisteredSyncDevices,
  isMultiDeviceCompany,
  parseSyncDevicesBody,
} from '@/services/sync/syncDevicesService';

const CO = 'co06141804941018';
const OTHER_CO = 'co99999999999999';

const response = (body: unknown, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response);

const device = (overrides: Record<string, unknown> = {}) => ({
  deviceId: 'device-1',
  co: CO,
  platform: 'desktop',
  lastSeen: '2026-09-28T12:00:00.000Z',
  ...overrides,
});

const fetchMock = (impl: () => Promise<Response>) => jest.fn(impl) as unknown as jest.MockedFunction<typeof fetch>;

const deps = (fetchImpl: jest.MockedFunction<typeof fetch>) => ({
  fetchImpl,
  getToken: jest.fn(async () => 'internal-jwt'),
});

describe('fetchRegisteredSyncDevices', () => {
  test('returns the relay devices with the Bearer token', async () => {
    const fetchImpl = fetchMock(async () => response({ devices: [device(), device({ deviceId: 'device-2' })] }));

    const result = await fetchRegisteredSyncDevices(CO, { baseUrl: 'https://sync.example.com/', ...deps(fetchImpl) });

    expect(result).toEqual({
      kind: 'devices',
      devices: [
        { deviceId: 'device-1', co: CO, platform: 'desktop', lastSeen: '2026-09-28T12:00:00.000Z' },
        { deviceId: 'device-2', co: CO, platform: 'desktop', lastSeen: '2026-09-28T12:00:00.000Z' },
      ],
    });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://sync.example.com/api/sync/devices');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer internal-jwt');
  });

  test('a 404 (endpoint not deployed) is single-device, not an error', async () => {
    const fetchImpl = fetchMock(async () => response({ error: 'not found' }, 404));

    const result = await fetchRegisteredSyncDevices(CO, { baseUrl: 'https://sync.example.com', ...deps(fetchImpl) });

    expect(result).toEqual({ kind: 'unavailable' });
  });

  test('a 403 (tier/membership refusal) is single-device, not an error', async () => {
    const fetchImpl = fetchMock(async () => response({ error: 'forbidden' }, 403));

    const result = await fetchRegisteredSyncDevices(CO, { baseUrl: 'https://sync.example.com', ...deps(fetchImpl) });

    expect(result).toEqual({ kind: 'unavailable' });
  });

  test('a network failure is single-device, not an error', async () => {
    const fetchImpl = fetchMock(async () => {
      throw new TypeError('fetch failed');
    });

    const result = await fetchRegisteredSyncDevices(CO, { baseUrl: 'https://sync.example.com', ...deps(fetchImpl) });

    expect(result).toEqual({ kind: 'unavailable' });
  });

  test('rows tagged for another company are dropped; untagged rows are kept', async () => {
    const fetchImpl = fetchMock(async () => response({
      devices: [device(), device({ deviceId: 'device-2', co: OTHER_CO }), device({ deviceId: 'device-3', co: null })],
    }));

    const result = await fetchRegisteredSyncDevices(CO, { baseUrl: 'https://sync.example.com', ...deps(fetchImpl) });

    expect(result.kind).toBe('devices');
    if (result.kind === 'devices') {
      expect(result.devices.map(d => d.deviceId).sort()).toEqual(['device-1', 'device-3']);
    }
  });

  test('lastSyncAt is accepted when lastSeen is absent', async () => {
    const fetchImpl = fetchMock(async () => response({
      devices: [{ deviceId: 'device-1', lastSyncAt: '2026-09-28T10:00:00.000Z' }],
    }));

    const result = await fetchRegisteredSyncDevices(CO, { baseUrl: 'https://sync.example.com', ...deps(fetchImpl) });

    expect(result.kind === 'devices' ? result.devices[0].lastSeen : null).toBe('2026-09-28T10:00:00.000Z');
  });

  test('no baseUrl ⇒ unavailable (relay not configured)', async () => {
    const fetchImpl = jest.fn() as unknown as jest.MockedFunction<typeof fetch>;

    const result = await fetchRegisteredSyncDevices(CO, { baseUrl: '', ...deps(fetchImpl) });

    expect(result).toEqual({ kind: 'unavailable' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('parseSyncDevicesBody — defensive shapes', () => {
  test('the alternate companies[] grouping is flattened', () => {
    const rows = parseSyncDevicesBody({
      companies: [
        { co: CO, devices: [device()] },
        { co: OTHER_CO, devices: [device({ deviceId: 'device-9' })] },
      ],
    });

    expect(rows).not.toBeNull();
    expect(rows!.map(d => d.deviceId).sort()).toEqual(['device-1', 'device-9']);
  });

  test('unexpected shapes are null (⇒ single-device assumption)', () => {
    expect(parseSyncDevicesBody(null)).toBeNull();
    expect(parseSyncDevicesBody({})).toBeNull();
    expect(parseSyncDevicesBody({ devices: 'yes' })).toBeNull();
    expect(parseSyncDevicesBody({ devices: [] })).toBeNull(); // no usable rows
    expect(parseSyncDevicesBody({ devices: [{ noDeviceId: true }] })).toBeNull();
  });
});

describe('isMultiDeviceCompany — the "Automático" gate', () => {
  test('a single registered device does not arm the auto option', () => {
    expect(isMultiDeviceCompany([{ deviceId: 'only-me', co: CO, platform: null, lastSeen: null }])).toBe(false);
  });

  test('two or more registered devices arm it', () => {
    const two = [
      { deviceId: 'me', co: CO, platform: 'desktop', lastSeen: null },
      { deviceId: 'phone', co: CO, platform: 'android', lastSeen: null },
    ];
    expect(isMultiDeviceCompany(two)).toBe(true);
  });
});
