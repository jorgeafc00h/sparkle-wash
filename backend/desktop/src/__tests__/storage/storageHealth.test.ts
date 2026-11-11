import { electronPersistStorage, appStorage } from '@/services/storage/ElectronStorage';
import {
  clearStorageWriteFailure,
  getLastStorageWriteFailure,
  onStorageWriteFailure,
} from '@/services/storage/storageHealth';

describe('storageHealth — failed writes are reported, not swallowed', () => {
  const setItem = jest.fn();

  beforeEach(() => {
    clearStorageWriteFailure();
    setItem.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = {
      electronAPI: { getPlatform: () => 'electron', storage: { setItem } },
    };
  });

  afterAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).window;
  });

  it('redux-persist storage reports and rethrows a rejected write', async () => {
    setItem.mockRejectedValueOnce(new Error('storage value exceeds 67108864 bytes'));
    const seen: string[] = [];
    const off = onStorageWriteFailure((f) => seen.push(f.key));

    await expect(electronPersistStorage.setItem('persist:invoices', '{}')).rejects.toThrow(/exceeds/);

    expect(seen).toEqual(['persist:invoices']);
    expect(getLastStorageWriteFailure()?.message).toMatch(/exceeds/);
    off();
  });

  it('appStorage reports too, and successful writes report nothing', async () => {
    setItem.mockResolvedValueOnce(undefined);
    await appStorage.setItem('ok', '1');
    expect(getLastStorageWriteFailure()).toBeNull();

    setItem.mockRejectedValueOnce(new Error('disk full'));
    await expect(appStorage.setItem('tickets_db_co-1', '{}')).rejects.toThrow('disk full');
    expect(getLastStorageWriteFailure()?.key).toBe('tickets_db_co-1');
  });
});
