/**
 * PDFBatchExportService — Exporta múltiples facturas a PDF en un directorio
 *
 * Muestra un diálogo de selección de carpeta y genera un PDF por factura.
 */

import { Invoice } from '@/types/invoice';
import { Company } from '@/types/company';
import { InvoicePDFGenerator } from './InvoicePDFGenerator';

export class PDFBatchExportService {
  /**
   * Exporta un lote de facturas a PDFs en la carpeta seleccionada por el usuario.
   *
   * @param invoices - Lista de facturas a exportar
   * @param company - Empresa emisora
   * @param onProgress - Callback opcional (factura actual, total)
   */
  static async exportBatch(
    invoices: Invoice[],
    company: Company,
    onProgress?: (current: number, total: number) => void
  ): Promise<void> {
    if (invoices.length === 0) return;

    if (!window.electronAPI?.showOpenDialog || !window.electronAPI?.printToPDF) {
      throw new Error('La exportación masiva solo está disponible en la aplicación de escritorio.');
    }

    // Seleccionar carpeta de destino
    const paths = await window.electronAPI.showOpenDialog({
      title: 'Seleccionar carpeta de destino',
      properties: ['openDirectory'],
    });

    if (!paths || paths.length === 0) return; // usuario canceló

    const folderPath = paths[0];

    for (let i = 0; i < invoices.length; i++) {
      const invoice = invoices[i];
      onProgress?.(i + 1, invoices.length);

      try {
        const buffer = await InvoicePDFGenerator.generatePDF(invoice, company);
        const fileName = `${invoice.controlNumber || invoice.invoiceNumber}.pdf`;
        const filePath = `${folderPath}/${fileName}`;

        const base64 = uint8ArrayToBase64(buffer);
        await window.electronAPI.writeFile(filePath, base64, 'base64');
      } catch (err) {
        console.error(`Error al exportar factura ${invoice.invoiceNumber}:`, err);
        // Continuar con las demás facturas aunque una falle
      }
    }
  }
}

// ── Utilidad interna ────────────────────────────────────────────────────────

function uint8ArrayToBase64(buffer: Uint8Array): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
