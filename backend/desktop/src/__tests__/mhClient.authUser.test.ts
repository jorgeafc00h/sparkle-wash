import axios from 'axios';
import { MhClient, normalizeMhUser } from '../services/api/MhClient';

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
const authOk = { status: 200, data: { status: 'OK', body: { token: 'Bearer abc' } } };
const sentUser = (call: any[]) => new URLSearchParams(call[1]).get('user');

describe('normalizeMhUser', () => {
  it('strips separators from NIT/DUI-shaped users', () => {
    expect(normalizeMhUser('0614-140494-134-2')).toBe('06141404941342');
    expect(normalizeMhUser(' 06141404941342 ')).toBe('06141404941342');
  });

  it('leaves anything else alone apart from trimming', () => {
    expect(normalizeMhUser(' usuario.mh ')).toBe('usuario.mh');
  });
});

describe('MhClient auth user', () => {
  beforeEach(() => mockedPost.mockReset());

  it('authenticates a dashed NIT as its digits', async () => {
    mockedPost.mockResolvedValueOnce(authOk);
    await new MhClient(false).authenticate({ userName: '0614-140494-134-2', password: 'secret' });
    expect(sentUser(mockedPost.mock.calls[0])).toBe('06141404941342');
  });

  it('validates credentials with the digits-only user', async () => {
    mockedPost.mockResolvedValueOnce(authOk);
    const outcome = await new MhClient(false).validateCredentials({ userName: '0614-140494-134-2', password: 'secret' });
    expect(outcome.valid).toBe(true);
    expect(mockedPost.mock.calls[0][0]).toBe('https://apitest.dtes.mh.gob.sv/seguridad/auth');
    expect(sentUser(mockedPost.mock.calls[0])).toBe('06141404941342');
  });

  it('validates production credentials against the production auth endpoint', async () => {
    mockedPost.mockResolvedValueOnce(authOk);
    const outcome = await new MhClient(true).validateCredentials({ userName: '06141404941342', password: 'secret' });
    expect(outcome.valid).toBe(true);
    expect(mockedPost.mock.calls[0][0]).toBe('https://api.dtes.mh.gob.sv/seguridad/auth');
  });

  it('shares one cached token between the dashed and digits spellings', async () => {
    mockedPost.mockResolvedValueOnce(authOk);
    const client = new MhClient(false);
    await client.getToken({ userName: '06141404941342', password: 'secret' });
    await client.getToken({ userName: '0614-140494-134-2', password: 'secret' });
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });
});
