// Hacienda answers a rejected user/password with HTTP 200 + status ERROR (code
// 106 "CREDENCIALES INVÁLIDAS", as seen in production App Insights). The
// Desktop authenticates against MH directly, so without this event a customer's
// rejected production password left no trace in App Insights.

import axios from 'axios';
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

const mockedPost = (axios as any).post as jest.Mock;
const trackEvent = TelemetryService.trackEvent as jest.Mock;
const rejected = {
  status: 200,
  data: { status: 'ERROR', body: { estado: 'RECHAZADO', codigoMsg: '106', descripcionMsg: 'CREDENCIALES INVÁLIDAS' } },
};
const credentials = { userName: '06141404941342', password: 'wrong-secret' };

describe('MhClient — auth failure telemetry', () => {
  beforeEach(() => {
    mockedPost.mockReset();
    trackEvent.mockReset();
    (TelemetryService.trackException as jest.Mock).mockReset();
  });

  it('authenticate reports the production host and what MH said, once', async () => {
    mockedPost.mockResolvedValueOnce(rejected);

    await expect(new MhClient(true).authenticate(credentials)).rejects.toThrow(
      'Error al autenticar usuario, verifique sus credenciales de hacienda',
    );

    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith('AuthError', {
      step: 'authenticate',
      host: 'api.dtes.mh.gob.sv',
      statusCode: 200,
      mhCode: '106',
      mhMessage: 'CREDENCIALES INVÁLIDAS',
    });
    expect(TelemetryService.trackException).not.toHaveBeenCalled();
  });

  it('validateCredentials reports a rejection against the test host', async () => {
    mockedPost.mockResolvedValueOnce(rejected);

    const outcome = await new MhClient(false).validateCredentials(credentials);

    expect(outcome).toEqual({ valid: false, statusCode: 200 });
    expect(trackEvent).toHaveBeenCalledWith('AuthError', expect.objectContaining({
      step: 'validate-credentials',
      host: 'apitest.dtes.mh.gob.sv',
      mhCode: '106',
    }));
  });

  it('validateCredentials reports an unreachable host with status 0', async () => {
    mockedPost.mockRejectedValueOnce({ isAxiosError: true, message: 'ENOTFOUND' });

    const outcome = await new MhClient(true).validateCredentials(credentials);

    expect(outcome).toEqual({ valid: false, statusCode: 0 });
    expect(trackEvent).toHaveBeenCalledWith('AuthError', expect.objectContaining({
      step: 'validate-credentials',
      host: 'api.dtes.mh.gob.sv',
      statusCode: 0,
    }));
  });

  it('never sends the user or password', async () => {
    mockedPost.mockResolvedValueOnce(rejected);
    await new MhClient(true).validateCredentials(credentials);
    const sent = JSON.stringify(trackEvent.mock.calls);
    expect(sent).not.toContain('wrong-secret');
    expect(sent).not.toContain('06141404941342');
  });

  it('a successful validation sends no AuthError', async () => {
    mockedPost.mockResolvedValueOnce({ status: 200, data: { status: 'OK', body: { token: 'Bearer abc' } } });
    await new MhClient(true).validateCredentials(credentials);
    expect(trackEvent).not.toHaveBeenCalled();
  });
});
