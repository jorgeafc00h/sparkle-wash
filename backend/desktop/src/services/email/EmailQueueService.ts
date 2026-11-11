import { API_CONFIG, API_HEADERS } from '@/config/api';
import { getHttpClient } from '@/services/api/HttpClient';
import { Company } from '@/types/company';
import { Invoice, InvoiceType } from '@/types/invoice';

export enum EmailNotificationType {
  DTE = 0,
  Promotional = 1,
  Quote = 2,
}

interface EmailNotificationPayload {
  Email: string;
  CustomerName: string;
  CustomerReference: string;
  nit: string;
  fileName: string;
  jsonFileName: string;
  pdfFileName?: string;
  documentNumber?: string;
  companyName?: string;
  issueDate?: string;
  total?: string;
  containerName: string;
  content?: string;
  notificationType: EmailNotificationType;
}

export interface QueueDocumentEmailInput {
  invoice: Invoice;
  company: Company;
  recipientEmail: string;
  pdfBase64?: string;
}

function getCustomerName(invoice: Invoice): string {
  const customer = invoice.customer;
  if (customer?.businessName) return customer.businessName;
  const fullName = [customer?.firstName, customer?.lastName].filter(Boolean).join(' ').trim();
  return fullName || 'Cliente';
}

function getCustomerReference(invoice: Invoice): string {
  return invoice.customer?.nit || invoice.customer?.nationalId || '';
}

function getDocumentTypeCode(type: InvoiceType): string {
  switch (type) {
    case InvoiceType.Factura: return '01';
    case InvoiceType.CCF: return '03';
    case InvoiceType.NotaRemision: return '04';
    case InvoiceType.NotaCredito: return '05';
    case InvoiceType.NotaDebito: return '06';
    case InvoiceType.ComprobanteRetencion: return '07';
    case InvoiceType.ComprobanteLiquidacion: return '08';
    case InvoiceType.DocumentoContableLiquidacion: return '09';
    case InvoiceType.FacturaExportacion: return '11';
    case InvoiceType.SujetoExcluido: return '14';
    case InvoiceType.ComprobanteDonacion: return '15';
    case InvoiceType.EventoOperacionesEspeciales: return '17';
    case InvoiceType.EventoRetorno: return '18';
    default: return '01';
  }
}

function getInvoiceTotal(invoice: Invoice): number {
  return invoice.totals?.totalPagar ??
    invoice.totalAmountIncludingTax ??
    invoice.totalAmount ??
    invoice.total ??
    0;
}

export class EmailQueueService {
  static async queueInvoiceEmail(input: QueueDocumentEmailInput): Promise<boolean> {
    const { invoice, company, recipientEmail, pdfBase64 } = input;
    if (!invoice.generationCode || !invoice.controlNumber) return false;

    const payload: EmailNotificationPayload = {
      Email: recipientEmail,
      CustomerName: getCustomerName(invoice),
      CustomerReference: getCustomerReference(invoice),
      nit: company.nit ?? '',
      fileName: `${invoice.controlNumber}.pdf`,
      jsonFileName: `${invoice.controlNumber}.json`,
      containerName: 'documents',
      content: pdfBase64 ?? '',
      notificationType: EmailNotificationType.DTE,
    };

    await this.sendToQueue(company, payload);
    return true;
  }

  static async queueQuoteEmail(input: QueueDocumentEmailInput): Promise<boolean> {
    const { invoice, company, recipientEmail, pdfBase64 } = input;
    if (!pdfBase64) return false;

    const pdfFileName = `Cotizacion_${invoice.invoiceNumber || 'sin-numero'}.pdf`;
    const payload: EmailNotificationPayload = {
      Email: recipientEmail,
      CustomerName: getCustomerName(invoice),
      CustomerReference: getCustomerReference(invoice),
      nit: company.nit ?? '',
      fileName: pdfFileName,
      jsonFileName: '',
      pdfFileName,
      documentNumber: invoice.invoiceNumber,
      companyName: company.nombreComercial || company.nombre,
      issueDate: invoice.date.substring(0, 10),
      total: `$${getInvoiceTotal(invoice).toFixed(2)}`,
      containerName: 'documents',
      content: pdfBase64,
      notificationType: EmailNotificationType.Quote,
    };

    await this.sendToQueue(company, payload);
    return true;
  }

  private static async sendToQueue(company: Company, payload: EmailNotificationPayload): Promise<void> {
    const isProduction = company.environment === 'PRODUCTION';
    const httpClient = getHttpClient(isProduction);

    await httpClient.post('/email/queue', payload, {
      headers: {
        [API_HEADERS.API_KEY]: API_CONFIG.apiKey,
        [API_HEADERS.CONTENT_TYPE]: 'application/json',
      },
      skipAuth: true,
    });
  }
}

export function uint8ArrayToBase64(buffer: Uint8Array): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
