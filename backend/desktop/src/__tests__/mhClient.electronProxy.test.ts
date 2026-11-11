// MhClient over the Electron main-process proxy (window.electronAPI.mhFetch),
// the path every packaged Desktop install uses for /seguridad/auth. A network
// failure there used to reach App Insights as AuthError { statusCode: 0 } with
// nothing else — a timeout, a DNS failure and a TLS error looked identical.

import { MhClient } from '../services/api/MhClient';
import { TelemetryService } from '../services/telemetry/TelemetryService';

jest.mock('axios', () => {
  const instance = { post: jest.fn(), get: jest.fn() };
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => instance),
      post: jest.fn(),
      isAxiosError: (e: any) => !!e?.isAxiosError,
    },
  };
});
jest.mock('../services/api/SyncLogger', () => ({
  SyncLogger: { logSyncError: jest.fn(), logSyncRequest: jest.fn(), logSyncResponse: jest.fn() },
}));
jest.mock('../services/telemetry/TelemetryService', () => ({
  TelemetryService: { trackDependency: jest.fn(), trackEvent: jest.fn(), trackException: jest.fn() },
}));

const trackEvent = TelemetryService.trackEvent as jest.Mock;
const credentials = { userName: '0614-140494-134-2', password: 'proxy-secret' };
const mhFetch = jest.fn();

describe('MhClient — Electron proxy auth', () => {
  beforeAll(() => {
    (globalThis as any).window = { electronAPI: { mhFetch } };
  });
  afterAll(() => {
    delete (globalThis as any).window;
  });
  beforeEach(() => {
    mhFetch.mockReset();
    trackEvent.mockReset();
  });

  it('authenticates through the proxy with the NIT digits as user', async () => {
    mhFetch.mockResolvedValueOnce({ ok: true, status: 200, body: JSON.stringify({ status: 'OK', body: { token: 'Bearer t' } }) });
    await expect(new MhClient(false).authenticate(credentials)).resolves.toBe('Bearer t');
    expect(mhFetch).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://apitest.dtes.mh.gob.sv/seguridad/auth',
      method: 'POST',
      body: 'user=06141404941342&pwd=proxy-secret',
    }));
  });

  it('a proxy timeout reaches telemetry as a timeout, not a bare status 0', async () => {
    mhFetch.mockResolvedValueOnce({
      ok: false,
      status: 0,
      error: 'Hacienda no respondió en 30 segundos. Intenta de nuevo.',
      errorKind: 'timeout',
      errorCode: 'TIMEOUT_30S',
    });

    const outcome = await new MhClient(true).validateCredentials(credentials);

    expect(outcome).toEqual({ valid: false, statusCode: 0 });
    expect(trackEvent).toHaveBeenCalledWith('AuthError', expect.objectContaining({
      step: 'validate-credentials',
      host: 'api.dtes.mh.gob.sv',
      statusCode: 0,
      errorKind: 'timeout',
      errorCode: 'TIMEOUT_30S',
      error: 'Hacienda no respondió en 30 segundos. Intenta de nuevo.',
    }));
  });

  it('authenticate reports a DNS failure with its kind and never the credentials', async () => {
    mhFetch.mockResolvedValueOnce({
      ok: false,
      status: 0,
      error: 'no se pudo resolver el servidor de Hacienda (¿sin internet o DNS?) (ENOTFOUND): getaddrinfo ENOTFOUND apitest.dtes.mh.gob.sv',
      errorKind: 'dns',
      errorCode: 'ENOTFOUND',
    });

    await expect(new MhClient(false).authenticate(credentials)).rejects.toThrow('verifique sus credenciales');

    expect(trackEvent).toHaveBeenCalledWith('AuthError', expect.objectContaining({
      step: 'authenticate',
      statusCode: 0,
      errorKind: 'dns',
      errorCode: 'ENOTFOUND',
    }));
    const sent = JSON.stringify(trackEvent.mock.calls);
    expect(sent).not.toContain('proxy-secret');
    expect(sent).not.toContain('06141404941342');
  });

  it('an MH rejection through the proxy (106) keeps reporting what MH said, with no transport fields', async () => {
    mhFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: JSON.stringify({ status: 'ERROR', body: { codigoMsg: '106', descripcionMsg: 'CREDENCIALES INVÁLIDAS' } }),
    });

    const outcome = await new MhClient(true).validateCredentials(credentials);

    expect(outcome).toEqual({ valid: false, statusCode: 200 });
    const [, props] = trackEvent.mock.calls[0];
    expect(props).toMatchObject({ statusCode: 200, mhCode: '106', mhMessage: 'CREDENCIALES INVÁLIDAS' });
    expect(props).not.toHaveProperty('errorKind');
  });
});
