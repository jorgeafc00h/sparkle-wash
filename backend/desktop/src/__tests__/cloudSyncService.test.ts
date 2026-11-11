import axios from 'axios';
import CloudSyncService, {
  getLegacyUserTableName,
  getTableName,
} from '../services/sync/CloudSyncService';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
  },
}));

function installLocalStorageMock() {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: jest.fn((key: string) => storage.get(key) ?? null),
      setItem: jest.fn((key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: jest.fn((key: string) => {
        storage.delete(key);
      }),
      clear: jest.fn(() => {
        storage.clear();
      }),
      key: jest.fn((index: number) => Array.from(storage.keys())[index] ?? null),
      get length() {
        return storage.size;
      },
    },
    configurable: true,
  });
}

describe('CloudSyncService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installLocalStorageMock();
    localStorage.setItem('app_auth_token', 'internal.jwt');
  });

  it('uses company-scoped co{nit} table names and keeps legacy user names separate', () => {
    expect(getTableName('0614-010101-001-2')).toBe('co06140101010012');
    expect(getLegacyUserTableName('google-sub_123')).toBe('usergooglesub123');
  });

  it('sends cloud sync requests with the internal app JWT', async () => {
    const mockedAxios = axios as jest.Mocked<typeof axios>;
    mockedAxios.post.mockResolvedValue({ data: {} });

    await CloudSyncService.syncInvoice(
      { id: 'invoice-1' },
      getTableName('0614-010101-001-2'),
    );

    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining('/sync/invoice/co06140101010012'),
      { id: 'invoice-1' },
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer internal.jwt',
        }),
      }),
    );
  });
});
