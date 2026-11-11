// ComprasDatabase — link fields (linkedInvoiceId / linkedCustomerId / linkNote).
//
// Mocks `@/services/storage/ElectronStorage` (the `appStorage` module
// ComprasDatabase persists through) with an in-memory Map, following the
// same manual-mock approach as other service tests in this suite. Since
// ComprasDatabase keeps a module-level cache/loaded-set that persists across
// tests within this file, each test uses a unique companyId instead of
// resetting module state.

jest.mock('@/services/storage/ElectronStorage', () => {
  const map = new Map<string, string>();
  return {
    appStorage: {
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
      key: jest.fn(async (i: number) => Array.from(map.keys())[i] ?? null),
      length: jest.fn(async () => map.size),
    },
    electronPersistStorage: {
      getItem: jest.fn(async (key: string) => (map.has(key) ? map.get(key)! : null)),
      setItem: jest.fn(async (key: string, value: string) => {
        map.set(key, value);
      }),
      removeItem: jest.fn(async (key: string) => {
        map.delete(key);
      }),
    },
  };
});

import { ComprasDatabase } from '@/services/compras/ComprasDatabase';
import { appStorage } from '@/services/storage/ElectronStorage';
import { Compra, CompraSource } from '@/types/compras';

function baseCompra(companyId: string, overrides: Partial<Compra> = {}): Compra {
  return {
    id: 'compra-001',
    companyId,
    emisorNit: '0614-010101-101-1',
    emisorNombre: 'Proveedor Demo',
    tipoDte: '03',
    codigoGeneracion: 'COMPRA-GEN-001',
    numeroControl: 'DTE-03-COMPRA',
    fecha: '2026-06-20',
    totalGravada: 100,
    totalIva: 13,
    totalPagar: 113,
    source: CompraSource.Manual,
    items: [],
    createdAt: '2026-06-20T10:00:00.000Z',
    updatedAt: '2026-06-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('ComprasDatabase — link fields', () => {
  it('round-trips linkedInvoiceId/linkedCustomerId/linkNote through insert -> update -> get, then clears them on unlink', async () => {
    const companyId = 'company-link-test-1';
    const compra = baseCompra(companyId);
    await ComprasDatabase.insertCompra(compra);

    const linked = await ComprasDatabase.updateCompraLink(compra.id, {
      linkedInvoiceId: 'invoice-001',
      linkedCustomerId: 'customer-001',
      linkNote: 'Materiales para el proyecto X',
    });

    expect(linked).toMatchObject({
      id: compra.id,
      linkedInvoiceId: 'invoice-001',
      linkedCustomerId: 'customer-001',
      linkNote: 'Materiales para el proyecto X',
    });
    expect(linked!.updatedAt).not.toBe(compra.updatedAt);

    const fetched = await ComprasDatabase.getCompraById(compra.id);
    expect(fetched).toMatchObject({
      linkedInvoiceId: 'invoice-001',
      linkedCustomerId: 'customer-001',
      linkNote: 'Materiales para el proyecto X',
    });

    // Persisted JSON under compras_db_{companyId} reflects the link fields.
    const raw = await appStorage.getItem(`compras_db_${companyId}`);
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw as string) as Compra[];
    expect(persisted.find((c) => c.id === compra.id)).toMatchObject({
      linkedInvoiceId: 'invoice-001',
      linkedCustomerId: 'customer-001',
      linkNote: 'Materiales para el proyecto X',
    });

    // Unlink (all three fields set to null) clears the link everywhere.
    const unlinked = await ComprasDatabase.updateCompraLink(compra.id, {
      linkedInvoiceId: null,
      linkedCustomerId: null,
      linkNote: null,
    });
    expect(unlinked).toMatchObject({
      linkedInvoiceId: null,
      linkedCustomerId: null,
      linkNote: null,
    });

    const rawAfterUnlink = await appStorage.getItem(`compras_db_${companyId}`);
    const persistedAfterUnlink = JSON.parse(rawAfterUnlink as string) as Compra[];
    expect(persistedAfterUnlink.find((c) => c.id === compra.id)).toMatchObject({
      linkedInvoiceId: null,
      linkedCustomerId: null,
      linkNote: null,
    });
  });

  it('returns null when updating the link of a compra that does not exist', async () => {
    const result = await ComprasDatabase.updateCompraLink('compra-does-not-exist', {
      linkedInvoiceId: 'invoice-001',
      linkedCustomerId: null,
      linkNote: null,
    });
    expect(result).toBeNull();
  });

  it('finds the compra via the compras_db_* key-scan fallback when its company is not yet cached', async () => {
    // Write directly to the mocked storage (bypassing insertCompra, which
    // would populate ComprasDatabase's in-memory cache) so this company's
    // data has never been loaded — mirrors a fresh app boot where
    // updateCompraLink is the first call to touch this company.
    const companyId = 'company-link-test-2';
    const compra = baseCompra(companyId, { id: 'compra-002' });
    await appStorage.setItem(`compras_db_${companyId}`, JSON.stringify([compra]));

    const updated = await ComprasDatabase.updateCompraLink(compra.id, {
      linkedInvoiceId: null,
      linkedCustomerId: 'customer-002',
      linkNote: null,
    });

    expect(updated).toMatchObject({ id: compra.id, linkedCustomerId: 'customer-002' });

    const raw = await appStorage.getItem(`compras_db_${companyId}`);
    const persisted = JSON.parse(raw as string) as Compra[];
    expect(persisted.find((c) => c.id === compra.id)).toMatchObject({ linkedCustomerId: 'customer-002' });
  });
});
