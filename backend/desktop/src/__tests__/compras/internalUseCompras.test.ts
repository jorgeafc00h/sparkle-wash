// Compras "uso interno" — records that are not a valid national DTE are kept
// for internal control only: never exported to MH, never verified.

jest.mock('@/services/storage/ElectronStorage', () => {
  const map = new Map<string, string>();
  return {
    __map: map,
    appStorage: {
      getItem: jest.fn(async (key: string) => (map.has(key) ? map.get(key)! : null)),
      setItem: jest.fn(async (key: string, value: string) => {
        map.set(key, value);
      }),
      removeItem: jest.fn(async (key: string) => {
        map.delete(key);
      }),
      getAllKeys: jest.fn(async () => Array.from(map.keys())),
    },
  };
});

jest.mock('@/services/compras/ConsultaPublicaService', () => ({
  ConsultaPublicaService: {
    verifyCompra: jest.fn(async () => ({ verified: true, estado: 'PROCESADO' })),
  },
}));

import * as XLSX from 'xlsx';
import { ComprasDatabase } from '@/services/compras/ComprasDatabase';
import { ComprasExportService } from '@/services/compras/ComprasExportService';
import { CompraVerificationService } from '@/services/compras/CompraVerificationService';
import { ConsultaPublicaService } from '@/services/compras/ConsultaPublicaService';
import { MHAnnexExportService } from '@/services/export/MHAnnexExportService';
import { CompraSource, excludeInternalUse, isInternalUseCompra, type Compra } from '@/types/compras';

function compra(overrides: Partial<Compra>): Compra {
  return {
    id: 'c1',
    companyId: 'co-1',
    emisorNit: '06142312341234',
    emisorNombre: 'PROVEEDOR NACIONAL',
    tipoDte: '03',
    codigoGeneracion: 'AAAAAAAA-0000-0000-0000-000000000001',
    numeroControl: 'DTE-03-M001P001-000000000000001',
    fecha: '2026-09-15',
    totalGravada: 100,
    totalIva: 13,
    totalPagar: 113,
    source: CompraSource.Manual,
    items: [],
    createdAt: '2026-09-15T10:00:00.000Z',
    updatedAt: '2026-09-15T10:00:00.000Z',
    ...overrides,
  };
}

const NATIONAL = compra({});
const INTERNAL = compra({
  id: 'c-int',
  emisorNit: '',
  emisorNombre: 'AMAZON ABROAD LLC',
  tipoDte: 'UI',
  codigoGeneracion: '',
  numeroControl: '',
  internalUse: true,
  internalReason: 'Compra en el extranjero',
  documentReference: 'ORDER-777',
  totalGravada: 50,
  totalIva: 0,
  totalPagar: 50,
});

const blobText = (blob: Blob): Promise<string> => blob.text();

describe('uso interno — model helpers', () => {
  it('treats missing/legacy flag as a normal purchase', () => {
    expect(isInternalUseCompra(NATIONAL)).toBe(false);
    expect(isInternalUseCompra(INTERNAL)).toBe(true);
    expect(excludeInternalUse([NATIONAL, INTERNAL])).toEqual([NATIONAL]);
  });
});

describe('uso interno — persistence and totals', () => {
  it('stores the flags, keeps legacy records intact and excludes internal from monthly totals', async () => {
    await ComprasDatabase.insertCompra(NATIONAL);
    await ComprasDatabase.insertCompra(INTERNAL);

    const all = await ComprasDatabase.getCompras({ companyId: 'co-1' });
    expect(all).toHaveLength(2);
    const stored = all.find((c) => c.id === 'c-int')!;
    expect(stored.internalUse).toBe(true);
    expect(stored.internalReason).toBe('Compra en el extranjero');
    expect(stored.documentReference).toBe('ORDER-777');
    expect(all.find((c) => c.id === 'c1')!.internalUse).toBeUndefined();

    const totals = await ComprasDatabase.getMonthlyTotals('co-1', 2026, 9);
    expect(totals.count).toBe(1);
    expect(totals.totalPagar).toBe(113);
  });
});

describe('uso interno — exports', () => {
  it('MH annex never contains internal purchases', async () => {
    const result = await MHAnnexExportService.exportMHAnexos(
      [],
      [NATIONAL, compra({ ...INTERNAL, tipoDte: '03' })],
      'Empresa',
      { download: false },
    );
    expect(result.counts.anexo3).toBe(1);
    const joined = result.artifacts.map((a) => a.content).join('\n');
    expect(joined).not.toContain('AMAZON ABROAD');
    expect(joined).toContain('PROVEEDOR NACIONAL');
  });

  it('CSV never includes internal purchases', async () => {
    const { blob } = ComprasExportService.buildCsvBlob([NATIONAL, INTERNAL], '', '');
    const text = await blobText(blob);
    expect(text).toContain('PROVEEDOR NACIONAL');
    expect(text).not.toContain('AMAZON ABROAD');
  });

  it('Excel excludes internal by default and includes them (flagged) on request', async () => {
    const read = async (blob: Blob) => {
      const buf = await blob.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Compras']);
    };

    const plain = await read(ComprasExportService.buildExcelBlob([NATIONAL, INTERNAL], 'Empresa').blob);
    expect(plain).toHaveLength(1);
    expect(plain[0]['Uso interno']).toBeUndefined();

    const general = await read(
      ComprasExportService.buildExcelBlob([NATIONAL, INTERNAL], 'Empresa', { includeInternal: true }).blob,
    );
    expect(general).toHaveLength(2);
    expect(general.filter((r) => r['Uso interno'] === 'Sí')).toHaveLength(1);
  });
});

describe('uso interno — verification', () => {
  beforeEach(() => (ConsultaPublicaService.verifyCompra as jest.Mock).mockClear());

  it('verifyCompra returns internal records untouched without calling the MH', async () => {
    const result = await CompraVerificationService.verifyCompra(INTERNAL, true);
    expect(result).toBe(INTERNAL);
    expect(ConsultaPublicaService.verifyCompra).not.toHaveBeenCalled();
  });

  it('verifyBatch only queries national purchases', async () => {
    const out = await CompraVerificationService.verifyBatch([NATIONAL, INTERNAL], true);
    expect(ConsultaPublicaService.verifyCompra).toHaveBeenCalledTimes(1);
    expect(out.find((c) => c.id === 'c-int')!.verified).toBeUndefined();
    expect(out.find((c) => c.id === 'c1')!.verified).toBe(true);
  });
});
