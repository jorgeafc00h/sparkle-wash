// ComprasDatabase.backfillTaxBreakdownFields — DTE tax-breakdown fields backfill
//
// Mocks `@/services/storage/ElectronStorage` (the `appStorage` module
// ComprasDatabase persists through) with an in-memory Map, following the
// same manual-mock approach as comprasDatabase.link.test.ts. Since
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

/** A minimal DTE object whose resumen carries the tax-breakdown fields. */
function makeDte(overrides: Record<string, unknown> = {}) {
  return {
    identificacion: {
      tipoDte: '03',
      codigoGeneracion: 'COMPRA-GEN-001',
      numeroControl: 'DTE-03-COMPRA',
      fecEmi: '2026-06-20',
      horEmi: '09:00:00',
    },
    emisor: { nit: '0614-010101-101-1', nombre: 'Proveedor Demo', nrc: '12345' },
    receptor: { nit: '06140101991022', nombre: 'Mi Empresa', nrc: '54321' },
    cuerpoDocumento: [],
    resumen: {
      totalNoSuj: 5,
      totalExenta: 10,
      totalGravada: 100,
      subTotal: 115,
      totalIva: 13,
      ivaRete1: 1.15,
      reteRenta: 2.5,
      totalPagar: 124.35,
      montoTotalOperacion: 124.35,
      tipoMoneda: 'USD',
    },
    ...overrides,
  };
}

describe('ComprasDatabase.backfillTaxBreakdownFields', () => {
  it('recovers the new fields for a record whose columns are missing but originalJson has them', async () => {
    const companyId = 'company-backfill-1';
    const compra = baseCompra(companyId, { id: 'legacy-1', originalJson: JSON.stringify(makeDte()) });
    await ComprasDatabase.insertCompra(compra);

    const before = await ComprasDatabase.getCompraById('legacy-1');
    expect(before!.totalExenta).toBeUndefined();
    expect(before!.receptorNit).toBeUndefined();

    const result = await ComprasDatabase.backfillTaxBreakdownFields(companyId);
    expect(result.scanned).toBe(1);
    expect(result.updated).toBe(1);

    const after = await ComprasDatabase.getCompraById('legacy-1');
    expect(after!.totalNoSuj).toBe(5);
    expect(after!.totalExenta).toBe(10);
    expect(after!.subTotal).toBe(115);
    expect(after!.ivaRete1).toBe(1.15);
    expect(after!.reteRenta).toBe(2.5);
    expect(after!.montoTotalOperacion).toBe(124.35);
    expect(after!.tipoMoneda).toBe('USD');
    expect(after!.horaEmision).toBe('09:00:00');
    expect(after!.receptorNit).toBe('06140101991022');
    expect(after!.receptorNombre).toBe('Mi Empresa');
    expect(after!.receptorNrc).toBe('54321');

    // Persisted JSON blob reflects the backfilled fields too.
    const raw = await appStorage.getItem(`compras_db_${companyId}`);
    const persisted = JSON.parse(raw as string) as Compra[];
    expect(persisted.find((c) => c.id === 'legacy-1')).toMatchObject({ totalExenta: 10, receptorNit: '06140101991022' });
  });

  it('is idempotent — a second run finds nothing left to update', async () => {
    const companyId = 'company-backfill-2';
    await ComprasDatabase.insertCompra(
      baseCompra(companyId, { id: 'legacy-2', originalJson: JSON.stringify(makeDte()) }),
    );

    const first = await ComprasDatabase.backfillTaxBreakdownFields(companyId);
    expect(first.updated).toBe(1);

    const second = await ComprasDatabase.backfillTaxBreakdownFields(companyId);
    expect(second).toEqual({ scanned: 0, updated: 0 });
  });

  it('is cheap and safe when there is nothing to backfill (no compras for the company)', async () => {
    const result = await ComprasDatabase.backfillTaxBreakdownFields('company-backfill-empty');
    expect(result).toEqual({ scanned: 0, updated: 0 });
  });

  it('skips records without originalJson (manual/OCR entries)', async () => {
    const companyId = 'company-backfill-3';
    await ComprasDatabase.insertCompra(baseCompra(companyId, { id: 'manual-1', originalJson: undefined }));

    const result = await ComprasDatabase.backfillTaxBreakdownFields(companyId);
    expect(result).toEqual({ scanned: 0, updated: 0 });
  });

  it('does not touch a record that already has the new fields populated', async () => {
    const companyId = 'company-backfill-4';
    await ComprasDatabase.insertCompra(
      baseCompra(companyId, {
        id: 'already-done',
        originalJson: JSON.stringify(makeDte({ resumen: { ...makeDte().resumen, totalExenta: 999 } })),
        totalNoSuj: 5,
        totalExenta: 10,
        subTotal: 115,
        ivaRete1: 1.15,
        reteRenta: 2.5,
        montoTotalOperacion: 124.35,
        tipoMoneda: 'USD',
        receptorNit: '06140101991022',
        horaEmision: '10:00:00',
        receptorNombre: 'Cliente Demo',
        receptorNrc: '123456',
      }),
    );

    const result = await ComprasDatabase.backfillTaxBreakdownFields(companyId);
    expect(result).toEqual({ scanned: 0, updated: 0 });

    const after = await ComprasDatabase.getCompraById('already-done');
    expect(after!.totalExenta).toBe(10); // untouched, not re-derived to 999
  });

  it('backfills horaEmision/receptorNombre/receptorNrc on a record missing only those fields', async () => {
    // Regression guard: `missingAField` used to check only 8 fields and omit
    // these 3, even though the write path below populates all of them — a
    // record with the other 8 already present but these 3 missing was
    // permanently skipped, even on repeated backfill runs.
    const companyId = 'company-backfill-partial';
    await ComprasDatabase.insertCompra(
      baseCompra(companyId, {
        id: 'missing-three',
        originalJson: JSON.stringify(makeDte()),
        totalNoSuj: 5,
        totalExenta: 10,
        subTotal: 115,
        ivaRete1: 1.15,
        reteRenta: 2.5,
        montoTotalOperacion: 124.35,
        tipoMoneda: 'USD',
        receptorNit: '06140101991022',
        horaEmision: undefined,
        receptorNombre: undefined,
        receptorNrc: undefined,
      }),
    );

    const result = await ComprasDatabase.backfillTaxBreakdownFields(companyId);
    expect(result).toEqual({ scanned: 1, updated: 1 });

    const after = await ComprasDatabase.getCompraById('missing-three');
    expect(after!.horaEmision).toBeDefined();
    expect(after!.receptorNombre).toBeDefined();
    expect(after!.receptorNrc).toBeDefined();
  });

  it('scans every known company when companyId is omitted', async () => {
    const companyA = 'company-backfill-all-a';
    const companyB = 'company-backfill-all-b';
    await ComprasDatabase.insertCompra(
      baseCompra(companyA, { id: 'a-1', originalJson: JSON.stringify(makeDte()) }),
    );
    await ComprasDatabase.insertCompra(
      baseCompra(companyB, { id: 'b-1', originalJson: JSON.stringify(makeDte()) }),
    );

    const result = await ComprasDatabase.backfillTaxBreakdownFields();
    expect(result.updated).toBeGreaterThanOrEqual(2);

    const a = await ComprasDatabase.getCompraById('a-1');
    const b = await ComprasDatabase.getCompraById('b-1');
    expect(a!.totalExenta).toBe(10);
    expect(b!.totalExenta).toBe(10);
  });
});
