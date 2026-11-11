// Signing certificate per Hacienda environment. Hacienda issues a production
// certificate (with its own password) after homologation; the TEST and
// PRODUCTION companies share a NIT, so registering the production one must not
// overwrite the test company's, and production signs with its own key. A
// production company that never uploaded one keeps signing with the test
// certificate (copy-on-promote, like the iOS app).

// jose ships ESM that ts-jest doesn't transform; record which key gets imported.
jest.mock('jose', () => ({
  importPKCS8: jest.fn(async (pem: string) => ({ pem })),
  CompactSign: jest.fn().mockImplementation(() => ({
    setProtectedHeader() { return this; },
    sign: async () => 'header.payload.signature',
  })),
}));

const store = new Map<string, string>();
jest.mock('../../services/storage/ElectronStorage', () => ({
  appStorage: {
    getItem: jest.fn(async (k: string) => store.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    removeItem: jest.fn(async (k: string) => void store.delete(k)),
    getAllKeys: jest.fn(async () => [...store.keys()]),
  },
}));

import { importPKCS8 } from 'jose';
import { SecureStorageService } from '@/services/security/SecureStorageService';
import { CertificateService } from '@/services/security/CertificateService';
import { getSignerService } from '@/services/signing/SignerService';

const COMPANY_NIT = '0614-140494-134-2'; // typed as printed
const CERT_NIT = '06141404941342'; // Hacienda's .crt carries digits only
const TEST_HASH = 'a'.repeat(128);
const PROD_HASH = 'b'.repeat(128);
const TEST_KEY = Buffer.from('test-private-key').toString('base64');
const PROD_KEY = Buffer.from('prod-private-key').toString('base64');

const certXml = (nit: string, clave: string, key: string) => `<?xml version="1.0"?>
<CertificadoMH>
  <_id>cert-${clave.slice(0, 4)}</_id>
  <nit>${nit}</nit>
  <publicKey><clave>pub</clave><encodied>${Buffer.from('pub').toString('base64')}</encodied></publicKey>
  <privateKey><clave>${clave}</clave><encodied>${key}</encodied></privateKey>
  <activo>true</activo>
</CertificadoMH>`;

const importedKey = () => {
  const calls = (importPKCS8 as jest.Mock).mock.calls;
  return calls[calls.length - 1][0] as string;
};

describe('Certificate per environment', () => {
  beforeEach(() => {
    store.clear();
    (importPKCS8 as jest.Mock).mockClear();
    const signer = getSignerService();
    signer.reloadCertificate(COMPANY_NIT, false);
    signer.reloadCertificate(COMPANY_NIT, true);
  });

  it("accepts Hacienda's digits-only NIT for a company NIT typed with dashes", async () => {
    await expect(
      CertificateService.storeCertificateForCompany(COMPANY_NIT, certXml(CERT_NIT, TEST_HASH, TEST_KEY), TEST_HASH),
    ).resolves.toBeUndefined();
    expect((await CertificateService.validateCertificate(COMPANY_NIT)).valid).toBe(true);
  });

  it('a company NIT typed with dashes still signs after a restart (signers look it up by digits)', async () => {
    await CertificateService.storeCertificateForCompany(COMPANY_NIT, certXml(CERT_NIT, TEST_HASH, TEST_KEY), TEST_HASH);
    const signer = getSignerService();
    signer.reloadCertificate(COMPANY_NIT, false); // cold cache, as after a restart
    // DTE send / homologation pass the emisor NIT (digits only).
    await expect(signer.signAsync({ nit: CERT_NIT, passwordPri: TEST_HASH, dteJson: '{}' })).resolves.toMatchObject({ status: 'OK' });
    expect(importedKey()).toContain(TEST_KEY);
    expect(await SecureStorageService.getCertificatePassword(CERT_NIT)).toBe(TEST_HASH);
  });

  it('finds a certificate an older build stored under the dashed NIT', async () => {
    store.set(`cert_data_${COMPANY_NIT}`, certXml(CERT_NIT, TEST_HASH, TEST_KEY));
    expect(await SecureStorageService.getCertificateData(CERT_NIT)).toContain(TEST_KEY);
    expect(await SecureStorageService.getCertificateData(COMPANY_NIT)).toContain(TEST_KEY);
    await SecureStorageService.removeCertificateData(CERT_NIT);
    expect(store.has(`cert_data_${COMPANY_NIT}`)).toBe(false);
  });

  it("still refuses another taxpayer's certificate", async () => {
    await expect(
      CertificateService.storeCertificateForCompany(COMPANY_NIT, certXml('06149999999999', TEST_HASH, TEST_KEY), TEST_HASH),
    ).rejects.toThrow('El certificado pertenece al NIT 06149999999999');
  });

  it('a production company inherits the test certificate until it uploads its own', async () => {
    await CertificateService.storeCertificateForCompany(COMPANY_NIT, certXml(CERT_NIT, TEST_HASH, TEST_KEY), TEST_HASH);

    expect(await SecureStorageService.usesInheritedCertificate(COMPANY_NIT, true)).toBe(true);
    expect(await SecureStorageService.getCertificatePassword(COMPANY_NIT, true)).toBe(TEST_HASH);
    expect((await CertificateService.validateCertificate(COMPANY_NIT, true)).valid).toBe(true);
  });

  it('registering the production certificate keeps the test one, and each signs with its own key', async () => {
    await CertificateService.storeCertificateForCompany(COMPANY_NIT, certXml(CERT_NIT, TEST_HASH, TEST_KEY), TEST_HASH);
    await SecureStorageService.storeCertificatePassword(COMPANY_NIT, PROD_HASH, true);
    await CertificateService.storeCertificateForCompany(COMPANY_NIT, certXml(CERT_NIT, PROD_HASH, PROD_KEY), PROD_HASH, true);

    expect(await SecureStorageService.getCertificatePassword(COMPANY_NIT)).toBe(TEST_HASH);
    expect(await SecureStorageService.getCertificatePassword(COMPANY_NIT, true)).toBe(PROD_HASH);
    expect(await SecureStorageService.usesInheritedCertificate(COMPANY_NIT, true)).toBe(false);
    expect((await CertificateService.validateCertificate(COMPANY_NIT)).valid).toBe(true);
    expect((await CertificateService.validateCertificate(COMPANY_NIT, true)).valid).toBe(true);

    // After a restart (empty cache) each environment loads its own key.
    const signer = getSignerService();
    signer.reloadCertificate(COMPANY_NIT, false);
    signer.reloadCertificate(COMPANY_NIT, true);

    await signer.signAsync({ nit: COMPANY_NIT, passwordPri: PROD_HASH, dteJson: '{}', isProduction: true });
    expect(importedKey()).toContain(PROD_KEY);
    await signer.signAsync({ nit: COMPANY_NIT, passwordPri: TEST_HASH, dteJson: '{}' });
    expect(importedKey()).toContain(TEST_KEY);
  });

  it('the production password does not unlock the test certificate', async () => {
    await CertificateService.storeCertificateForCompany(COMPANY_NIT, certXml(CERT_NIT, TEST_HASH, TEST_KEY), TEST_HASH);
    await expect(
      getSignerService().signAsync({ nit: COMPANY_NIT, passwordPri: PROD_HASH, dteJson: '{}' }),
    ).rejects.toThrow('Credenciales invalidas');
  });

  it('removing the production certificate falls back to the test one', async () => {
    await CertificateService.storeCertificateForCompany(COMPANY_NIT, certXml(CERT_NIT, TEST_HASH, TEST_KEY), TEST_HASH);
    await CertificateService.storeCertificateForCompany(COMPANY_NIT, certXml(CERT_NIT, PROD_HASH, PROD_KEY), PROD_HASH, true);

    await CertificateService.removeCertificateForCompany(COMPANY_NIT, true);

    expect(await SecureStorageService.getCertificateData(COMPANY_NIT)).toContain(TEST_KEY);
    expect(await SecureStorageService.usesInheritedCertificate(COMPANY_NIT, true)).toBe(true);
    expect(await SecureStorageService.getCertificatePassword(COMPANY_NIT, true)).toBe(TEST_HASH);
  });

  it('deleting the production company clears only its own secrets', async () => {
    await SecureStorageService.storeCredentials(COMPANY_NIT, { user: CERT_NIT, password: 'test' });
    await SecureStorageService.storeCredentials(COMPANY_NIT, { user: CERT_NIT, password: 'prod' }, true);
    await CertificateService.storeCertificateForCompany(COMPANY_NIT, certXml(CERT_NIT, TEST_HASH, TEST_KEY), TEST_HASH);
    await CertificateService.storeCertificateForCompany(COMPANY_NIT, certXml(CERT_NIT, PROD_HASH, PROD_KEY), PROD_HASH, true);

    await SecureStorageService.clearCompanyData(COMPANY_NIT, true);

    expect((await SecureStorageService.getCredentials(COMPANY_NIT))?.password).toBe('test');
    expect(await SecureStorageService.getCertificateData(COMPANY_NIT)).toContain(TEST_KEY);
    expect(await SecureStorageService.getCertificatePassword(COMPANY_NIT)).toBe(TEST_HASH);
  });
});
