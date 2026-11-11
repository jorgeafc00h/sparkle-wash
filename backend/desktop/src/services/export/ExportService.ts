/**
 * ExportService — Orquestador unificado de exportaciones
 *
 * Coordina todos los métodos de exportación: Excel, PDF, PDF masivo,
 * Anexos MH (CSV), Google Drive y JSON.
 */

import { Invoice } from '@/types/invoice';
import { Company } from '@/types/company';
import { Compra } from '@/types/compras';
import { InvoiceExcelExportService } from './InvoiceExcelExportService';
import { MHAnnexExportService } from './MHAnnexExportService';
import GoogleDriveExportService, { BackupData } from './GoogleDriveExportService';
import { InvoicePDFGenerator } from '../pdf/InvoicePDFGenerator';
import { PDFBatchExportService } from '../pdf/PDFBatchExportService';
import { currentSVYearMonth, svYearMonthOf } from '../../utils/svDate';

// ── Tipos ─────────────────────────────────────────────────────────────────────

export enum ExportFormat {
  Excel        = 'excel',
  PDF          = 'pdf',
  PDFBatch     = 'pdf-batch',
  CSV_MH       = 'csv-mh',
  GoogleDrive  = 'google-drive',
  JSON         = 'json',
}

export interface ExportOptions {
  format: ExportFormat;
  invoices?: Invoice[];
  compras?: Compra[];
  company: Company;
  dateFrom?: string;
  dateTo?: string;
  onProgress?: (current: number, total: number) => void;
  /** Para ExportFormat.JSON: datos a serializar */
  jsonData?: unknown;
  /** Para ExportFormat.JSON: nombre del archivo (sin extensión) */
  jsonFilename?: string;
}

export interface ExportResult {
  success: boolean;
  /** Ruta o URL del archivo generado (cuando aplica) */
  filePath?: string;
  /** Cantidad de archivos generados (para exportaciones masivas o CSV) */
  fileCount?: number;
  /** Mensaje de error si success === false */
  error?: string;
}

// ── Servicio ──────────────────────────────────────────────────────────────────

export class ExportService {

  /**
   * Método principal de exportación.
   * Delega al servicio especializado según el formato indicado.
   */
  static async export(options: ExportOptions): Promise<ExportResult> {
    const { format, invoices = [], compras = [], company, onProgress } = options;

    try {
      switch (format) {

        case ExportFormat.Excel:
          return await this.exportInvoicesToExcel(invoices, company);

        case ExportFormat.PDF: {
          const invoice = invoices[0];
          if (!invoice) {
            return { success: false, error: 'No se proporcionó ninguna factura para exportar.' };
          }
          return await this.exportInvoiceToPDF(invoice, company);
        }

        case ExportFormat.PDFBatch:
          return await this.exportInvoicesBatchPDF(invoices, company, onProgress);

        case ExportFormat.CSV_MH: {
          const { dateFrom, dateTo } = options;
          if (!dateFrom || !dateTo) {
            return { success: false, error: 'Se requieren fechas de inicio y fin para los anexos MH.' };
          }
          return await this.exportMHAnnex(invoices, compras, company, dateFrom, dateTo);
        }

        case ExportFormat.GoogleDrive:
          return await this.exportToGoogleDrive(invoices, compras, company);

        case ExportFormat.JSON: {
          const data = options.jsonData ?? invoices;
          const filename = options.jsonFilename ?? `exportacion_${company.nit ?? 'empresa'}`;
          return await this.exportToJSON(data, filename);
        }

        default:
          return { success: false, error: `Formato de exportación no reconocido: ${format}` };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido al exportar';
      console.error('[ExportService] Error al exportar:', error);
      return { success: false, error: message };
    }
  }

  // ── Métodos de conveniencia ────────────────────────────────────────────────

  /**
   * Exporta facturas a Excel (.xlsx) y dispara la descarga en el navegador.
   */
  static async exportInvoicesToExcel(invoices: Invoice[], company: Company): Promise<ExportResult> {
    try {
      if (invoices.length === 0) {
        return { success: false, error: 'No hay facturas para exportar.' };
      }

      // El Salvador calendar month of the first invoice (current SV month as
      // fallback) — never the UTC month of a parsed date-only string.
      const { year: exportYear, month: exportMonth } =
        svYearMonthOf(invoices[0].date) ?? currentSVYearMonth();

      const url = await InvoiceExcelExportService.exportMonthlyInvoices(
        invoices,
        invoices.map(i => i.customer).filter(Boolean) as NonNullable<Invoice['customer']>[],
        company.nit ?? company.nombre,
        exportYear,
        exportMonth,
      );

      return { success: true, filePath: url, fileCount: invoices.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al exportar a Excel';
      return { success: false, error: message };
    }
  }

  /**
   * Genera y guarda el PDF de una factura individual.
   */
  static async exportInvoiceToPDF(invoice: Invoice, company: Company): Promise<ExportResult> {
    try {
      const saved = await InvoicePDFGenerator.generateAndSavePDF(invoice, company);
      if (!saved) {
        // El usuario canceló el diálogo de guardar — no es un error fatal
        return { success: false, error: 'Exportación cancelada por el usuario.' };
      }
      return { success: true, fileCount: 1 };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al generar PDF';
      return { success: false, error: message };
    }
  }

  /**
   * Exporta múltiples facturas a PDFs individuales en la carpeta seleccionada.
   */
  static async exportInvoicesBatchPDF(
    invoices: Invoice[],
    company: Company,
    onProgress?: (current: number, total: number) => void,
  ): Promise<ExportResult> {
    try {
      if (invoices.length === 0) {
        return { success: false, error: 'No hay facturas para exportar.' };
      }

      await PDFBatchExportService.exportBatch(invoices, company, onProgress);
      return { success: true, fileCount: invoices.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error en exportación masiva de PDFs';
      return { success: false, error: message };
    }
  }

  /**
   * Exporta los anexos MH F-07 (5 archivos CSV) para el período indicado.
   */
  static async exportMHAnnex(
    invoices: Invoice[],
    compras: Compra[],
    company: Company,
    _dateFrom: string,
    _dateTo: string,
  ): Promise<ExportResult> {
    try {
      const result = await MHAnnexExportService.exportMHAnexos(
        invoices,
        compras,
        company.nombreComercial,
      );

      return {
        success: true,
        fileCount: result.files.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al exportar anexos MH';
      return { success: false, error: message };
    }
  }

  /**
   * Sube un respaldo completo de datos a Google Drive.
   */
  static async exportToGoogleDrive(
    invoices: Invoice[],
    compras: Compra[],
    company: Company,
  ): Promise<ExportResult> {
    try {
      const backupData: BackupData = {
        version: '1.0.0',
        exportDate: new Date().toISOString(),
        companies: [company],
        customers: [],
        products: [],
        invoices,
      };

      const { webViewLink } = await GoogleDriveExportService.exportBackup(backupData);
      return { success: true, filePath: webViewLink };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al subir a Google Drive';
      return { success: false, error: message };
    }
  }

  /**
   * Exporta datos arbitrarios a un archivo JSON y dispara la descarga.
   */
  static async exportToJSON(data: unknown, filename: string): Promise<ExportResult> {
    try {
      const jsonStr = JSON.stringify(data, null, 2);
      const safeFilename = filename.replace(/[^a-zA-Z0-9_-]/g, '_');
      const fileName = safeFilename.endsWith('.json') ? safeFilename : `${safeFilename}.json`;

      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      return { success: true, filePath: url };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al exportar JSON';
      return { success: false, error: message };
    }
  }
}
