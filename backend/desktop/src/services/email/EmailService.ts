/**
 * EmailService — Envía facturas por correo electrónico desde el escritorio.
 *
 * Genera el PDF, lo guarda en un directorio temporal y abre un enlace mailto:
 * con asunto y cuerpo prellenados. El usuario adjunta el PDF manualmente.
 *
 * Nota: mailto: no permite adjuntar archivos programáticamente; el flujo
 * estándar es guardar el PDF y luego abrir el cliente de correo.
 */

import { Invoice } from '@/types/invoice';
import { Company } from '@/types/company';
import { InvoicePDFGenerator, type PdfOptions, type PdfDocumentMode } from '@/services/pdf/InvoicePDFGenerator';

export interface EmailResult {
  success: boolean;
  savedPath?: string;
  error?: string;
}

export class EmailService {
  /**
   * Genera el PDF de la factura, lo guarda en la carpeta de documentos del usuario
   * y abre el cliente de correo con asunto y cuerpo prellenados.
   *
   * @param invoice - Factura a enviar
   * @param company - Empresa emisora
   * @param recipientEmail - Correo del destinatario (usa el del cliente si no se especifica)
   * @returns Resultado de la operación con la ruta del PDF guardado
   */
  static async sendInvoiceByEmail(
    invoice: Invoice,
    company: Company,
    recipientEmail?: string,
    pdfOptions: PdfOptions = {},
  ): Promise<EmailResult> {
    return this.sendDocumentByEmail(invoice, company, recipientEmail, 'invoice', pdfOptions);
  }

  /**
   * Genera una cotización PDF, la guarda y abre el cliente de correo con texto
   * no tributario. El usuario adjunta el PDF manualmente igual que en facturas.
   */
  static async sendQuoteByEmail(
    invoice: Invoice,
    company: Company,
    recipientEmail?: string,
    pdfOptions: PdfOptions = {},
  ): Promise<EmailResult> {
    return this.sendDocumentByEmail(invoice, company, recipientEmail, 'quote', pdfOptions);
  }

  private static async sendDocumentByEmail(
    invoice: Invoice,
    company: Company,
    recipientEmail: string | undefined,
    documentMode: PdfDocumentMode,
    pdfOptions: PdfOptions,
  ): Promise<EmailResult> {
    try {
      const options = { ...pdfOptions, documentMode };
      const buffer = await InvoicePDFGenerator.generatePDF(invoice, company, options);

      if (buffer.byteLength === 0) {
        // Modo navegador — solo abrir mailto sin PDF
        this.openMailto(invoice, company, recipientEmail, documentMode);
        return { success: true };
      }

      const savedPath = await this.savePDFToTemp(invoice, buffer, documentMode);

      this.openMailto(invoice, company, recipientEmail, documentMode);

      return { success: true, savedPath };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Error desconocido al enviar por email';
      console.error('EmailService error:', err);
      return { success: false, error };
    }
  }

  // ── Privados ────────────────────────────────────────────────────────────

  /**
   * Guarda el buffer PDF en una carpeta privada de la aplicación.
   * Devuelve la ruta donde fue guardado.
   */
  private static async savePDFToTemp(
    invoice: Invoice,
    buffer: Uint8Array,
    documentMode: PdfDocumentMode,
  ): Promise<string> {
    const fileName = this.buildFileName(invoice, documentMode);

    if (window.electronAPI?.getAppPath && window.electronAPI?.writeFile) {
      const userDataFolder = await window.electronAPI.getAppPath('userData');
      const filePath = `${userDataFolder}/email-attachments/${fileName}`;
      const base64 = uint8ArrayToBase64(buffer);
      await window.electronAPI.writeFile(filePath, base64, 'base64');
      return filePath;
    }

    // Sin IPC disponible — crear blob URL (solo en navegador)
    const blob = new Blob([buffer.buffer as ArrayBuffer], { type: 'application/pdf' });
    return URL.createObjectURL(blob);
  }

  /**
   * Construye y abre un enlace mailto: con asunto y cuerpo prellenados.
   */
  private static openMailto(
    invoice: Invoice,
    company: Company,
    recipientEmail: string | undefined,
    documentMode: PdfDocumentMode,
  ): void {
    const ref = documentMode === 'quote'
      ? invoice.invoiceNumber
      : invoice.controlNumber || invoice.invoiceNumber;
    const recipientName =
      invoice.customer?.businessName ||
      (invoice.customer
        ? `${invoice.customer.firstName} ${invoice.customer.lastName}`.trim()
        : 'cliente');

    const to = recipientEmail || invoice.customer?.email || '';

    const subject = encodeURIComponent(
      documentMode === 'quote'
        ? `Cotización ${ref} - ${company.nombreComercial}`
        : `Factura ${ref} - ${company.nombreComercial}`
    );

    const totalAmount =
      invoice.totals?.totalPagar ??
      invoice.totalAmountIncludingTax ??
      invoice.totalAmount ??
      0;

    const bodyText = documentMode === 'quote'
      ? [
          `Estimado/a ${recipientName},`,
          '',
          'Le compartimos la cotización solicitada:',
          '',
          `  • Referencia: ${ref}`,
          `  • Fecha: ${invoice.date.substring(0, 10)}`,
          `  • Total estimado: $${totalAmount.toFixed(2)}`,
          '',
          'Este documento no es tributario y no sustituye factura ni comprobante fiscal.',
          'Por favor encuentre el archivo PDF de cotización adjunto a este correo.',
          '',
          'Atentamente,',
          company.nombreComercial,
          company.correo,
          '',
          '---',
          'Enviado con Car Spa',
        ].join('\n')
      : [
          `Estimado/a ${recipientName},`,
          '',
          `Le enviamos adjunto el documento tributario electrónico (DTE) correspondiente a:`,
          '',
          `  • Referencia: ${ref}`,
          `  • Fecha: ${invoice.date.substring(0, 10)}`,
          `  • Total: $${totalAmount.toFixed(2)}`,
          '',
          'Por favor encuentre el archivo PDF adjunto a este correo.',
          '',
          'Atentamente,',
          company.nombreComercial,
          company.correo,
          '',
          '---',
          'Enviado con Car Spa',
        ].join('\n');

    const body = encodeURIComponent(bodyText);
    const mailtoUrl = `mailto:${to}?subject=${subject}&body=${body}`;

    window.open(mailtoUrl, '_blank');
  }

  private static buildFileName(invoice: Invoice, documentMode: PdfDocumentMode): string {
    if (documentMode === 'quote') {
      return `Cotizacion_${invoice.invoiceNumber || 'sin-numero'}.pdf`;
    }
    return `${invoice.controlNumber || invoice.invoiceNumber}.pdf`;
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
