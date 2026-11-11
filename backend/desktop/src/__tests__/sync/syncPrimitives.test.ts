// companySlice → MhClient → TelemetryService → LocalLogger reads import.meta.env, which
// ts-jest's CommonJS build can't parse — stub the logging layer.
jest.mock('@/services/logging/LocalLogger', () => ({
  LocalLogger: { initialize: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), log: jest.fn() },
}));
jest.mock('@/services/telemetry/TelemetryService', () => ({
  TelemetryService: { initialize: jest.fn(), trackEvent: jest.fn(), trackException: jest.fn(), trackTrace: jest.fn() },
  default: { initialize: jest.fn(), trackEvent: jest.fn(), trackException: jest.fn(), trackTrace: jest.fn() },
}));
jest.mock('@/services/storage/ElectronStorage', () => {
  const map = new Map<string, string>();
  const storage = {
    getItem: jest.fn(async (key: string) => (map.has(key) ? map.get(key)! : null)),
    setItem: jest.fn(async (key: string, value: string) => {
      map.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      map.delete(key);
    }),
    clear: jest.fn(async () => {
      map.clear();
    }),
    getAllKeys: jest.fn(async () => Array.from(map.keys())),
  };
  return { appStorage: storage, electronPersistStorage: storage };
});

import { appStorage } from '@/services/storage/ElectronStorage';
import { sha256Hex } from '@/services/sync/sha256';
import { base64ToBytes, bytesToBase64, decodePayload, encodePayload, PayloadTooLargeError } from '@/services/sync/payloadCodec';
import { buildDigest, diffDigestItems, digestLines, digestsMatch, parseDigestLines } from '@/services/sync/digestService';
import {
  DEVICE_ID_STORAGE_KEY,
  generateUuidV4,
  getCachedDeviceId,
  getDeviceId,
  resetDeviceIdCacheForTests,
} from '@/services/sync/deviceId';
import { companySyncKey, entityKey, parseEntityKey } from '@/services/sync/protocol';

describe('sha256', () => {
  it('matches FIPS 180-4 known vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))
      .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('hashes non-ASCII text as UTF-8 (matches Node crypto), incl. surrogate pairs and multi-block input', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodeCrypto = require('crypto');
    const reference = (text: string) => nodeCrypto.createHash('sha256').update(text, 'utf8').digest('hex');
    for (const text of ['Facturación ñ', 'é', '💾 sync', 'x'.repeat(1000), 'línea1\nlínea2:2026-09-24T10:00:00.000Z']) {
      expect(sha256Hex(text)).toBe(reference(text));
    }
  });
});

describe('payloadCodec', () => {
  it('round-trips arbitrary JSON (incl. Spanish text) through gzip+base64', () => {
    const payload = { id: 'inv_1', observaciones: 'Descripción con ñ y acentos — áéíóú', items: [{ q: 1 }, { q: 2 }] };
    const encoded = encodePayload(payload);
    expect(encoded).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(decodePayload(encoded)).toEqual(payload);
  });

  it('is deterministic (gzip mtime pinned)', () => {
    expect(encodePayload({ a: 1 })).toBe(encodePayload({ a: 1 }));
  });

  it('base64 matches the platform encoder for every tail length', () => {
    for (const bytes of [[], [1], [1, 2], [1, 2, 3], [255, 254, 253, 252]]) {
      const input = Uint8Array.from(bytes);
      expect(bytesToBase64(input)).toBe(Buffer.from(input).toString('base64'));
      expect(Array.from(base64ToBytes(bytesToBase64(input)))).toEqual(bytes);
    }
  });

  it('rejects payloads above the relay cap after compression', () => {
    // Random-ish (incompressible) content well above 16 KB.
    let noisy = '';
    let seed = 7;
    for (let i = 0; i < 60000; i++) {
      // xorshift32 — the high-entropy bits keep gzip from finding structure.
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      noisy += String.fromCharCode(33 + ((seed >>> 0) % 90));
    }
    expect(() => encodePayload({ noisy })).toThrow(PayloadTooLargeError);
  });
});

describe('digestService', () => {
  const items = [
    { key: 'c2', u: '2026-09-24T10:00:00.000Z' },
    { key: 'c1', u: '2026-09-24T09:00:00.000Z' },
  ];

  it('produces an order-independent digest', () => {
    const a = buildDigest('customer', items);
    const b = buildDigest('customer', [...items].reverse());
    expect(a).toEqual(b);
    expect(a.count).toBe(2);
    expect(a.hash).toBe(sha256Hex('c1:2026-09-24T09:00:00.000Z\nc2:2026-09-24T10:00:00.000Z'));
    expect(digestsMatch(a, b)).toBe(true);
  });

  it('detects a missing entity and a newer version', () => {
    const peer = [{ key: 'c1', u: '2026-09-24T09:30:00.000Z' }];
    expect(digestsMatch(buildDigest('customer', items), buildDigest('customer', peer))).toBe(false);
    expect(diffDigestItems(items, peer)).toEqual({ toPush: ['c2'], toRequest: ['c1'] });
  });

  it('round-trips digest lines whose keys contain colons', () => {
    const withColons = [{ key: 'cg:ABC-1', u: '2026-09-24T09:00:00.000Z' }];
    expect(parseDigestLines(digestLines(withColons))).toEqual(withColons);
    expect(buildDigest('purchase', withColons, true).items).toEqual(['cg:ABC-1:2026-09-24T09:00:00.000Z']);
  });
});

describe('deviceId', () => {
  beforeEach(async () => {
    await appStorage.clear();
    resetDeviceIdCacheForTests();
  });

  it('mints a UUID v4 once and reuses it', async () => {
    const first = await getDeviceId();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await getDeviceId()).toBe(first);
    expect(getCachedDeviceId()).toBe(first);
  });

  it('is stable across a simulated process restart', async () => {
    const first = await getDeviceId();
    resetDeviceIdCacheForTests();
    expect(await appStorage.getItem(DEVICE_ID_STORAGE_KEY)).toBe(first);
    expect(await getDeviceId()).toBe(first);
  });

  it('concurrent first calls share one mint', async () => {
    const [a, b, c] = await Promise.all([getDeviceId(), getDeviceId(), getDeviceId()]);
    expect(new Set([a, b, c]).size).toBe(1);
  });

  it('replaces a corrupted stored id', async () => {
    await appStorage.setItem(DEVICE_ID_STORAGE_KEY, 'not-a-uuid');
    const minted = await getDeviceId();
    expect(minted).not.toBe('not-a-uuid');
    expect(generateUuidV4()).not.toBe(minted);
  });
});

describe('protocol helpers', () => {
  it('derives the canonical company key from the NIT digits', () => {
    expect(companySyncKey({ id: 'company_1', nit: '0614-180494-101-8', isProduction: true })).toBe('co06141804941018');
    expect(companySyncKey({ id: 'company_1', nit: '06141804941018', environment: 'PRODUCTION' as never })).toBe('co06141804941018');
    expect(companySyncKey({ id: 'company_ABC', nit: '', isProduction: true })).toBe('cocompanyabc');
    expect(companySyncKey(null)).toBeNull();
  });

  it('keeps a Pruebas company out of its production twin group', () => {
    const pruebas = companySyncKey({ id: 'company_1', nit: '06141804941018', environment: 'DEVELOPMENT' as never });
    expect(pruebas).toBe('co06141804941018test');
    expect(pruebas).not.toBe(companySyncKey({ id: 'company_2', nit: '06141804941018', isProduction: true }));
  });

  it('round-trips entity keys', () => {
    expect(parseEntityKey(entityKey('purchase', 'cmp:1'))).toEqual({ t: 'purchase', id: 'cmp:1' });
  });
});

describe('correlativo maxima (cross-platform rule)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { correlativoOf, maxCorrelativoByDocType } = require('@/services/sync/entityAdapters');

  it('counts sequential numbers from invoiceNumber or the numeroControl suffix', () => {
    expect(correlativoOf({ invoiceNumber: '00118', controlNumber: undefined })).toBe(118);
    expect(correlativoOf({ invoiceNumber: 'DTE-01-M001P001-000000000000120', controlNumber: undefined })).toBe(120);
    expect(correlativoOf({ invoiceNumber: '00007', controlNumber: 'DTE-03-M001P001-000000000000009' })).toBe(9);
  });

  it('ignores Desktop time-derived sequences (≥ 1e9)', () => {
    expect(correlativoOf({ invoiceNumber: 'DTE-01-M001P001-077392415650447', controlNumber: 'DTE-01-M001P001-077392415650447' })).toBeNull();
    const maxima = maxCorrelativoByDocType([
      { companyId: 'c', documentType: '01', invoiceNumber: '00118', invoiceType: 0 },
      { companyId: 'c', documentType: '01', invoiceNumber: 'DTE-01-M001P001-077392415650447', invoiceType: 0 },
      { companyId: 'c', documentType: '03', invoiceNumber: '00040', invoiceType: 1 },
      { companyId: 'other', documentType: '01', invoiceNumber: '00999', invoiceType: 0 },
    ], 'c');
    expect(maxima).toEqual({ '01': 118, '03': 40 });
  });
});

describe('invoice type localization (cross-platform rule)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { localizeIncoming } = require('@/services/sync/entityAdapters');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { InvoiceType } = require('@/types');

  it('re-derives the local InvoiceType enum from the MH document type (RN events are 11/12, Desktop 17/18)', () => {
    const fromAndroid = { id: 'ev1', documentType: '17', invoiceType: 11, relatedDocumentType: '03', relatedInvoiceType: 1, companyId: 'rn-co' };
    const local = localizeIncoming('invoice', fromAndroid, 'desktop-co');
    expect(local.invoiceType).toBe(InvoiceType.EventoOperacionesEspeciales);
    expect(local.relatedInvoiceType).toBe(InvoiceType.CCF);
    expect(local.invoiceType).toBe(17);
    expect(local.companyId).toBe('desktop-co');
  });

  it('keeps the type when the document type is unknown', () => {
    expect(localizeIncoming('invoice', { id: 'x', invoiceType: 1 }, 'c').invoiceType).toBe(1);
  });
});
