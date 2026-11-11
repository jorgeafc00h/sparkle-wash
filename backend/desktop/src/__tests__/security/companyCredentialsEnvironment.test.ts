// MH credentials per Hacienda environment: a NIT has a TEST and a PRODUCTION
// company, and Hacienda's production API password can differ from the test one.
// Saving one environment must never overwrite the other; a production company
// that never saved its own falls back to the test company's (copy-on-promote,
// like the iOS app).

const store = new Map<string, string>();
jest.mock('../../services/storage/ElectronStorage', () => ({
  appStorage: {
    getItem: jest.fn(async (k: string) => store.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    removeItem: jest.fn(async (k: string) => void store.delete(k)),
    getAllKeys: jest.fn(async () => [...store.keys()]),
  },
}));

import { SecureStorageService } from '@/services/security/SecureStorageService';

const NIT = '06141404941342';
const TEST_CREDS = { user: NIT, password: 'test-pwd' };
const PROD_CREDS = { user: NIT, password: 'prod-pwd' };

describe('SecureStorageService — MH credentials per environment', () => {
  beforeEach(() => store.clear());

  it('keeps the original NIT-only key for test companies', async () => {
    await SecureStorageService.storeCredentials(NIT, TEST_CREDS);
    expect([...store.keys()]).toEqual([`secure:company_creds_${NIT}`]);
    expect(await SecureStorageService.getCredentials(NIT)).toEqual(TEST_CREDS);
  });

  it('a production company falls back to the test credentials until it saves its own', async () => {
    await SecureStorageService.storeCredentials(NIT, TEST_CREDS);
    expect(await SecureStorageService.getCredentials(NIT, true)).toEqual(TEST_CREDS);
    expect(await SecureStorageService.usesInheritedCredentials(NIT, true)).toBe(true);
    expect(await SecureStorageService.usesInheritedCredentials(NIT, false)).toBe(false);
  });

  it('saving production credentials does not overwrite the test company and vice versa', async () => {
    await SecureStorageService.storeCredentials(NIT, TEST_CREDS);
    await SecureStorageService.storeCredentials(NIT, PROD_CREDS, true);
    expect(await SecureStorageService.getCredentials(NIT)).toEqual(TEST_CREDS);
    expect(await SecureStorageService.getCredentials(NIT, true)).toEqual(PROD_CREDS);
    expect(await SecureStorageService.usesInheritedCredentials(NIT, true)).toBe(false);

    await SecureStorageService.storeCredentials(NIT, { user: NIT, password: 'test-pwd-2' });
    expect(await SecureStorageService.getCredentials(NIT, true)).toEqual(PROD_CREDS);
  });

  it('removing production credentials keeps the test ones (production then inherits them)', async () => {
    await SecureStorageService.storeCredentials(NIT, TEST_CREDS);
    await SecureStorageService.storeCredentials(NIT, PROD_CREDS, true);
    await SecureStorageService.removeCredentials(NIT, true);
    expect(await SecureStorageService.getCredentials(NIT)).toEqual(TEST_CREDS);
    expect(await SecureStorageService.getCredentials(NIT, true)).toEqual(TEST_CREDS);
  });

  it('a test company never reads production credentials', async () => {
    await SecureStorageService.storeCredentials(NIT, PROD_CREDS, true);
    expect(await SecureStorageService.getCredentials(NIT)).toBeNull();
    expect(await SecureStorageService.usesInheritedCredentials(NIT, true)).toBe(false);
  });

  it('clearAllData removes both environments', async () => {
    await SecureStorageService.storeCredentials(NIT, TEST_CREDS);
    await SecureStorageService.storeCredentials(NIT, PROD_CREDS, true);
    await SecureStorageService.clearAllData();
    expect(await SecureStorageService.getCredentials(NIT, true)).toBeNull();
  });
});
