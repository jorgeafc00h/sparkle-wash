// ComprasExportService — Exporta compras a Excel (.xlsx)
// Usa la librería xlsx (SheetJS) ya instalada en el proyecto

import * as XLSX from 'xlsx';
import type { Compra } from '@/types/compras';
import { CompraSource, excludeInternalUse } from '@/types/compras';

// ── Etiquetas legibles ─────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<CompraSource, string> = {
  [CompraSource.Email]: 'Correo',
  [CompraSource.OCR]: 'OCR',
  [CompraSource.Manual]: 'Manual',
};

function formatVerificado(compra: Compra): string {
  if (compra.verified === true) return 'Sí';
  if (compra.verified === false) return 'No válido';
  return 'Sin verificar';
}

// ── Autoajuste de columnas ────────────────────────────────────────────────────

function autofitColumns(worksheet: XLSX.WorkSheet, rows: (string | number)[][]): void {
  const colWidths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, idx) => {
      const len = String(cell ?? '').length;
      colWidths[idx] = Math.max(colWidths[idx] ?? 0, len);
    });
  }
  worksheet['!cols'] = colWidths.map((w) => ({ wch: Math.min(w + 2, 50) }));
}

// ── Servicio ──────────────────────────────────────────────────────────────────

export class ComprasExportService {
  /**
   * Build the Excel Blob + filename without downloading. Reusable by both the
   * browser download path and the Drive upload path.
   */
  static buildExcelBlob(
    allCompras: Compra[],
    companyName: string,
    options: { includeInternal?: boolean } = {},
  ): { blob: Blob; fileName: string } {
    // Export general (no MH): uso interno solo si se pide explícitamente.
    const compras = options.includeInternal ? allCompras : excludeInternalUse(allCompras);
    const withInternalColumn = options.includeInternal === true;
    if (compras.length === 0) {
      throw new Error('No hay compras para exportar.');
    }

    const workbook = XLSX.utils.book_new();

    // ── Hoja: Compras ──────────────────────────────────────────────────────────
    // Columnas de desglose fiscal en el orden del Libro de Compras (anexo
    // F-07 de MH): Gravada, Exenta, No Sujeta, Subtotal, IVA, IVA Retenido,
    // Renta Retenida, Total.
    const headers = [
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
      ...(withInternalColumn ? ['Uso interno', 'Motivo / referencia'] : []),
    ];

    const rows: (string | number)[][] = compras.map((c) => [
      c.fecha,
      c.emisorNit,
      c.emisorNombreComercial ?? c.emisorNombre,
      c.tipoDte,
      c.numeroControl,
      c.totalGravada,
      c.totalExenta ?? 0,
      c.totalNoSuj ?? 0,
      c.subTotal ?? 0,
      c.totalIva,
      c.ivaRete1 ?? 0,
      c.reteRenta ?? 0,
      c.totalPagar,
      SOURCE_LABELS[c.source] ?? c.source,
      formatVerificado(c),
      ...(withInternalColumn
        ? [
            c.internalUse === true ? 'Sí' : 'No',
            [c.internalReason, c.documentReference].filter(Boolean).join(' / '),
          ]
        : []),
    ]);

    const sheetData = [headers, ...rows];
    const worksheet = XLSX.utils.aoa_to_sheet(sheetData);

    // Formato de moneda para columnas numéricas: Total Gravada .. Total a
    // Pagar → índices 5-12 (F..M).
    const currencyFormat = '"$"#,##0.00';
    const range = XLSX.utils.decode_range(worksheet['!ref'] ?? 'A1');
    for (let row = 1; row <= range.e.r; row++) {
      for (const col of [5, 6, 7, 8, 9, 10, 11, 12]) {
        const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
        if (worksheet[cellRef]) {
          worksheet[cellRef].z = currencyFormat;
        }
      }
    }

    autofitColumns(worksheet, sheetData);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Compras');

    // ── Hoja: Resumen por Emisor ───────────────────────────────────────────────
    const emisorMap = new Map<string, { nombre: string; count: number; totalPagar: number }>();
    for (const c of compras) {
      const existing = emisorMap.get(c.emisorNit);
      if (existing) {
        existing.count++;
        existing.totalPagar += c.totalPagar;
      } else {
        emisorMap.set(c.emisorNit, {
          nombre: c.emisorNombreComercial ?? c.emisorNombre,
          count: 1,
          totalPagar: c.totalPagar,
        });
      }
    }

    const summaryHeaders = ['Emisor NIT', 'Nombre Emisor', 'Cantidad', 'Total a Pagar'];
    const summaryRows: (string | number)[][] = Array.from(emisorMap.entries())
      .sort((a, b) => b[1].totalPagar - a[1].totalPagar)
      .map(([nit, info]) => [nit, info.nombre, info.count, info.totalPagar]);

    const summarySheetData = [summaryHeaders, ...summaryRows];
    const summaryWorksheet = XLSX.utils.aoa_to_sheet(summarySheetData);

    // Formato moneda para columna Total a Pagar (índice 3)
    const summaryRange = XLSX.utils.decode_range(summaryWorksheet['!ref'] ?? 'A1');
    for (let row = 1; row <= summaryRange.e.r; row++) {
      const cellRef = XLSX.utils.encode_cell({ r: row, c: 3 });
      if (summaryWorksheet[cellRef]) {
        summaryWorksheet[cellRef].z = currencyFormat;
      }
    }

    autofitColumns(summaryWorksheet, summarySheetData);
    XLSX.utils.book_append_sheet(workbook, summaryWorksheet, 'Resumen por Proveedor');

    // ── Generar y descargar ───────────────────────────────────────────────────
    const safeName = companyName.replace(/[^a-zA-Z0-9_\-]/g, '_').substring(0, 30);
    const dateStr = new Date().toISOString().substring(0, 10);
    const fileName = `Compras_${safeName}_${dateStr}.xlsx`;

    const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    return { blob, fileName };
  }

  /**
   * Exporta compras a Excel (.xlsx) y dispara la descarga del navegador.
   */
  static async exportToExcel(
    compras: Compra[],
    companyName: string,
    options: { includeInternal?: boolean } = {},
  ): Promise<void> {
    const { blob, fileName } = this.buildExcelBlob(compras, companyName, options);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /**
   * Build a CSV Blob + filename for compras without downloading.
   */
  static buildCsvBlob(
    allCompras: Compra[],
    dateFrom: string,
    dateTo: string,
  ): { blob: Blob; fileName: string } {
    // El CSV es el formato de carga a MH: NUNCA incluye compras de uso interno.
    const compras = excludeInternalUse(allCompras);
    // Columnas de desglose fiscal en el orden del Libro de Compras (anexo
    // F-07 de MH): Gravada, Exenta, No Sujeta, Subtotal, IVA, IVA Retenido,
    // Renta Retenida, Total.
    const headers = [
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
    ];
    const rows = compras.map((c) => [
      c.fecha,
      c.emisorNit,
      c.emisorNombre,
      c.tipoDte,
      c.codigoGeneracion,
      c.totalGravada.toFixed(2),
      (c.totalExenta ?? 0).toFixed(2),
      (c.totalNoSuj ?? 0).toFixed(2),
      (c.subTotal ?? 0).toFixed(2),
      c.totalIva.toFixed(2),
      (c.ivaRete1 ?? 0).toFixed(2),
      (c.reteRenta ?? 0).toFixed(2),
      c.totalPagar.toFixed(2),
      SOURCE_LABELS[c.source] ?? c.source,
    ]);
    const csv = [headers, ...rows].map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const fileName = `compras_${dateFrom || 'inicio'}_${dateTo || 'fin'}.csv`;
    return { blob, fileName };
  }
}
