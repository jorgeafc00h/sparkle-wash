/**
 * Test (Pruebas) companies must be able to practise freely:
 *  1. the Free-tier monthly cap never applies to them (the production-access
 *     wizard alone mints dozens of test DTEs, which used to trip the paywall);
 *  2. a certificate cached under a dashed company NIT still signs when the
 *     signer is asked for the digits-only NIT (dte.emisor.nit / nitDigits).
 */
// jose ships ESM that ts-jest doesn't transform; this suite asserts cache keying,
// not the cryptography (covered on RN by CertificateSigningEndToEnd.test.ts).
jest.mock('jose', () => ({
  importPKCS8: jest.fn(async () => ({})),
  CompactSign: jest.fn().mockImplementation(() => ({
    setProtectedHeader() { return this; },
    sign: async () => 'header.payload.signature',
  })),
}));

jest.mock('../services/security/SecureStorageService', () => ({
  SecureStorageService: { getCertificateData: jest.fn(async () => null) },
}));

import { canCreateInvoice, getMaxInvoicesPerMonth } from '../services/subscription/FeatureGate';
import { SubscriptionTier } from '../services/subscription/SubscriptionTypes';
import { getSignerService } from '../services/signing/SignerService';

describe('Free-tier monthly cap', () => {
  it('caps Lite production companies at 10/month', () => {
    expect(getMaxInvoicesPerMonth(SubscriptionTier.Lite)).toBe(10);
    expect(canCreateInvoice(SubscriptionTier.Lite, 10)).toBe(false);
  });

  it('never caps test (Pruebas) companies', () => {
    expect(getMaxInvoicesPerMonth(SubscriptionTier.Lite, false)).toBe(Infinity);
    expect(canCreateInvoice(SubscriptionTier.Lite, 500, false)).toBe(true);
  });
});

describe('SignerService NIT keying', () => {
  it('signs with the digits-only NIT for a certificate cached under a dashed NIT', async () => {
    const keyData = { clave: 'hash', encoded: new Uint8Array([1, 2, 3]) };
    const signer = getSignerService();
    signer.setCachedCertificate('0614-140494-134-2', {
      id: '1', nit: '06141404941342', publicKey: keyData, privateKey: keyData, activo: true,
    });

    const res = await signer.signAsync({ nit: '06141404941342', passwordPri: 'hash', dteJson: '{}' });
    expect(res.status).toBe('OK');
    expect(res.body.split('.')).toHaveLength(3);
  });
});
