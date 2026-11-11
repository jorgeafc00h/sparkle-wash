// ComprasExportService — tax-breakdown export columns (xlsx + csv builders)
//
// Verifies both export builders include the DTE tax-breakdown columns
// (Gravada, Exenta, No Sujeta, Subtotal, IVA, IVA Retenido, Renta Retenida,
// Total) in the MH Libro de Compras (F-07 anexo) column order, with correct
// values, and that legacy records missing the new fields still export
// cleanly (default 0).

import * as XLSX from 'xlsx';
import { ComprasExportService } from '../services/compras/ComprasExportService';
import { Compra, CompraSource } from '../types/compras';

function makeCompra(overrides: Partial<Compra> = {}): Compra {
  return {
    id: 'compra-1',
    companyId: 'company-1',
    emisorNit: '06140101991011',
    emisorNombre: 'Proveedor Demo',
    tipoDte: '03',
    codigoGeneracion: 'GEN-1',
    numeroControl: 'CTRL-1',
    fecha: '2026-05-01',
    totalGravada: 100,
    totalIva: 13,
    totalPagar: 113,
    source: CompraSource.Manual,
    items: [],
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ComprasExportService.buildExcelBlob — tax-breakdown columns', () => {
  it('includes the new Libro de Compras columns, in MH order, with correct values', () => {
    const compra = makeCompra({
      totalGravada: 100,
      totalExenta: 10,
      totalNoSuj: 5,
      subTotal: 115,
      totalIva: 13,
      ivaRete1: 1.15,
      reteRenta: 2.5,
      totalPagar: 124.35,
    });

    // buildExcelBlob doesn't expose the workbook it builds, so spy on the
    // XLSX.utils.aoa_to_sheet call it makes internally to read back exactly
    // what was written (header row + first data row) without needing to
    // parse the resulting Blob's binary xlsx bytes.
    const aoaSpy = jest.spyOn(XLSX.utils, 'aoa_to_sheet');
    const { blob } = ComprasExportService.buildExcelBlob([compra], 'Mi Empresa');
    expect(blob).toBeDefined();
    const sheetData = aoaSpy.mock.calls[0][0] as (string | number)[][];
    aoaSpy.mockRestore();

    const headers = sheetData[0] as string[];
    const row = sheetData[1] as (string | number)[];

    expect(headers).toEqual([
      'Fecha',
      'Emisor NIT',
      'Emisor',
      'Tipo DTE',
      'Número Control',
      'Total Gravada',
      'Total Exenta',
      'Total No Sujeta',
      'Subtotal',
      'IVA',
      'IVA Retenido',
      'Renta Retenida',
      'Total a Pagar',
      'Fuente',
      'Verificado',
    ]);

    const byHeader: Record<string, string | number> = {};
    headers.forEach((h, i) => {
      byHeader[h] = row[i];
    });
    expect(byHeader).toMatchObject({
      'Total Gravada': 100,
      'Total Exenta': 10,
      'Total No Sujeta': 5,
      'Subtotal': 115,
      'IVA': 13,
      'IVA Retenido': 1.15,
      'Renta Retenida': 2.5,
      'Total a Pagar': 124.35,
    });
  });

  it('defaults missing tax-breakdown fields to 0 for a legacy record', () => {
    const compra = makeCompra({
      totalGravada: 50,
      totalIva: 6.5,
      totalPagar: 56.5,
      // no totalExenta/totalNoSuj/subTotal/ivaRete1/reteRenta — pre-migration record
    });

    const aoaSpy = jest.spyOn(XLSX.utils, 'aoa_to_sheet');
    ComprasExportService.buildExcelBlob([compra], 'Mi Empresa');
    const sheetData = aoaSpy.mock.calls[0][0] as (string | number)[][];
    aoaSpy.mockRestore();

    const headers = sheetData[0] as string[];
    const row = sheetData[1] as (string | number)[];
    const byHeader: Record<string, string | number> = {};
    headers.forEach((h, i) => {
      byHeader[h] = row[i];
    });

    expect(byHeader['Total Exenta']).toBe(0);
    expect(byHeader['Total No Sujeta']).toBe(0);
    expect(byHeader['Subtotal']).toBe(0);
    expect(byHeader['IVA Retenido']).toBe(0);
    expect(byHeader['Renta Retenida']).toBe(0);
  });
});

describe('ComprasExportService.buildCsvBlob — tax-breakdown columns', () => {
  it('includes the new Libro de Compras columns, in MH order, with correct values', async () => {
    const compra = makeCompra({
      totalGravada: 100,
      totalExenta: 10,
      totalNoSuj: 5,
      subTotal: 115,
      totalIva: 13,
      ivaRete1: 1.15,
      reteRenta: 2.5,
      totalPagar: 124.35,
    });

    const { blob } = ComprasExportService.buildCsvBlob([compra], '2026-05-01', '2026-05-31');
    const text = await blob.text();
    const [headerLine, dataLine] = text.split('\n');

    expect(headerLine.split(',')).toEqual([
      'Fecha',
      'Emisor NIT',
      'Emisor Nombre',
      'Tipo DTE',
      'Código Generación',
      'Total Gravada',
      'Total Exenta',
      'Total No Sujeta',
      'Subtotal',
      'Total IVA',
      'IVA Retenido',
      'Renta Retenida',
      'Total Pagar',
      'Fuente',
    ]);

    const values = dataLine.split(',');
    expect(values[5]).toBe('100.00'); // Total Gravada
    expect(values[6]).toBe('10.00'); // Total Exenta
    expect(values[7]).toBe('5.00'); // Total No Sujeta
    expect(values[8]).toBe('115.00'); // Subtotal
    expect(values[9]).toBe('13.00'); // Total IVA
    expect(values[10]).toBe('1.15'); // IVA Retenido
    expect(values[11]).toBe('2.50'); // Renta Retenida
    expect(values[12]).toBe('124.35'); // Total Pagar
  });

  it('defaults missing tax-breakdown fields to 0.00 for a legacy record', async () => {
    const compra = makeCompra({ totalGravada: 50, totalIva: 6.5, totalPagar: 56.5 });
    const { blob } = ComprasExportService.buildCsvBlob([compra], '2026-05-01', '2026-05-31');
    const text = await blob.text();
    const [, dataLine] = text.split('\n');
    const values = dataLine.split(',');

    expect(values[6]).toBe('0.00'); // Total Exenta
    expect(values[7]).toBe('0.00'); // Total No Sujeta
    expect(values[8]).toBe('0.00'); // Subtotal
    expect(values[10]).toBe('0.00'); // IVA Retenido
    expect(values[11]).toBe('0.00'); // Renta Retenida
  });
});
