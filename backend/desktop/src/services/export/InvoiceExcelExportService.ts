// Invoice Excel Export Service
// Generates .xlsx files for monthly DTE/event export
// Desktop adaptation: uses browser download instead of expo-file-system + expo-sharing

import * as XLSX from 'xlsx';
import { Invoice, InvoiceType, InvoiceStatus } from '../../types/invoice';
import { Customer } from '../../types/customer';
import { isInSVMonth, svDateOf } from '../../utils/svDate';

/**
 * Options for the monthly builders. `prefiltered` = the caller already chose
 * the documents (InvoiceExportPage's date range, possibly spanning months):
 * export them as given instead of re-filtering by year/month.
 */
export interface MonthlyExportOptions {
  prefiltered?: boolean;
}

// El Salvador calendar month — `new Date('2026-10-01')` is UTC midnight
// (Sept 30 in SV) and an ISO timestamp after 18:00 SV is already next day UTC.
const inMonth = (inv: Invoice, year: number, month: number): boolean =>
  isInSVMonth(inv.date, year, month);

const getInvoiceTypeName = (type: InvoiceType): string => {
  switch (type) {
    case InvoiceType.Factura:                return 'Factura';
    case InvoiceType.CCF:                    return 'Comprobante de Credito Fiscal';
    case InvoiceType.NotaCredito:            return 'Nota de Credito';
    case InvoiceType.SujetoExcluido:         return 'Sujeto Excluido';
    case InvoiceType.NotaDebito:             return 'Nota de Debito';
    case InvoiceType.NotaRemision:           return 'Nota de Remision';
    case InvoiceType.ComprobanteLiquidacion: return 'Comprobante de Liquidacion';
    case InvoiceType.FacturaExportacion:     return 'Factura de Exportacion';
    case InvoiceType.ComprobanteRetencion:   return 'Comprobante de Retencion';
    case InvoiceType.DocumentoContableLiquidacion: return 'Documento Contable de Liquidacion';
    case InvoiceType.ComprobanteDonacion:     return 'Comprobante de Donacion';
    case InvoiceType.EventoOperacionesEspeciales: return 'Evento de Operaciones Especiales';
    case InvoiceType.EventoRetorno:           return 'Evento de Retorno';
    default:                                 return 'Desconocido';
  }
};

const getStatusText = (status: InvoiceStatus): string => {
  switch (status) {
    case InvoiceStatus.Nueva:          return 'Nueva';
    case InvoiceStatus.Sincronizando:  return 'Sincronizando';
    case InvoiceStatus.Completada:     return 'Completada';
    case InvoiceStatus.Anulada:        return 'Anulada';
    case InvoiceStatus.Modificada:     return 'Modificada';
    case InvoiceStatus.ErrorEnvio:     return 'Error de Envio';
    default:                           return 'Desconocido';
  }
};

const resolveCustomerName = (customerId: string | undefined, customers: Customer[]): string => {
  if (!customerId) return 'Sin cliente';
  const customer = customers.find(c => c.id === customerId);
  if (!customer) return 'Sin cliente';
  if (customer.businessName) return customer.businessName;
  return `${customer.firstName} ${customer.lastName}`.trim() || 'Sin cliente';
};

const resolveCustomerDocument = (customerId: string | undefined, customers: Customer[]): string => {
  if (!customerId) return '';
  const customer = customers.find(c => c.id === customerId);
  if (!customer) return '';
  return customer.nit || customer.nationalId || '';
};

export interface InvoiceExportPreview {
  count: number;
  totalPagar: number;
  totalIva: number;
}

/**
 * Trigger a browser download for a Blob.
 * Returns the created object URL (caller does not need to revoke it; auto-revoked after 5s).
 */
function downloadBlob(blob: Blob, fileName: string): string {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return url;
}

export class InvoiceExcelExportService {

  /**
   * Build the Excel Blob + filename for a month, without downloading.
   * Consumed by `exportMonthlyInvoices` (download) and Drive-upload callers.
   */
  static buildMonthlyInvoicesBlob(
    invoices: Invoice[],
    customers: Customer[],
    companyNit: string,
    year: number,
    month: number,
    opts: MonthlyExportOptions = {},
  ): { blob: Blob; fileName: string } {
    const monthStr = String(month).padStart(2, '0');

    const monthlyInvoices = opts.prefiltered ? invoices : invoices.filter(inv => inMonth(inv, year, month));

    if (monthlyInvoices.length === 0) {
      throw new Error(`No se encontraron DTE o eventos para ${monthStr}/${year}`);
    }

    const data = monthlyInvoices.map((inv) => {
      const totals = inv.totals;
      const subTotal = totals?.subTotal ?? inv.subtotal ?? 0;
      const iva = totals?.tax ?? inv.tax ?? 0;
      const ivaRete = totals?.ivaRete1 ?? 0;
      const ivaPerci = totals?.ivaPerci1 ?? 0;
      const reteRenta = totals?.reteRenta ?? 0;
      const totalPagar = totals?.totalPagar ?? inv.totalAmountIncludingTax ?? inv.total ?? 0;

      return {
        'N\u00B0 Control': inv.controlNumber || '',
        'N\u00B0 Documento': inv.invoiceNumber,
        'Tipo DTE/Evento': getInvoiceTypeName(inv.invoiceType),
        'Fecha': svDateOf(inv.date) || inv.date,
        'Cliente': resolveCustomerName(inv.customerId, customers),
        'NIT/DUI Cliente': resolveCustomerDocument(inv.customerId, customers),
        'SubTotal': subTotal,
        // Exento / no sujeto lines carry no IVA: their own columns keep
        // SubTotal + IVA + Exentas + No sujetas == total of the document.
        'Ventas Exentas': totals?.totalExenta ?? 0,
        'Ventas No Sujetas': totals?.totalNoSuj ?? 0,
        'IVA 13%': iva,
        // IVA percepción 1% (agente de percepción, CCF/NC/ND) — part of Total a Pagar.
        'Percepción IVA': ivaPerci,
        'Ret. IVA': ivaRete,
        'Ret. Renta': reteRenta,
        'Total a Pagar': totalPagar,
        'Estado': getStatusText(inv.status),
        'Sello Recepcion': inv.receptionSeal || '',
      };
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, `DTE Eventos ${monthStr}-${year}`);

    // Write to ArrayBuffer for browser download
    const wbout = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const sanitizedNit = companyNit.replace(/[^a-zA-Z0-9]/g, '');
    const fileName = `DTE_Eventos_${sanitizedNit}_${year}-${monthStr}.xlsx`;

    const blob = new Blob([wbout], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    return { blob, fileName };
  }

  /**
   * Export a month's invoices to Excel and trigger browser download.
   * Returns the Blob object URL.
   */
  static async exportMonthlyInvoices(
    invoices: Invoice[],
    customers: Customer[],
    companyNit: string,
    year: number,
    month: number,
    opts: MonthlyExportOptions = {},
  ): Promise<string> {
    const { blob, fileName } = this.buildMonthlyInvoicesBlob(
      invoices, customers, companyNit, year, month, opts,
    );
    return downloadBlob(blob, fileName);
  }

  static getMonthlyPreview(
    invoices: Invoice[],
    year: number,
    month: number,
  ): InvoiceExportPreview {
    const monthlyInvoices = invoices.filter(inv => inMonth(inv, year, month));

    const totalPagar = monthlyInvoices.reduce((sum, inv) => {
      return sum + (inv.totals?.totalPagar ?? inv.totalAmountIncludingTax ?? inv.total ?? 0);
    }, 0);

    const totalIva = monthlyInvoices.reduce((sum, inv) => {
      return sum + (inv.totals?.tax ?? inv.tax ?? 0);
    }, 0);

    return {
      count: monthlyInvoices.length,
      totalPagar,
      totalIva,
    };
  }

  /**
   * Build the JSON Blob + filename for a month without downloading.
   */
  static buildMonthlyInvoicesJSONBlob(
    invoices: Invoice[],
    customers: Customer[],
    companyNit: string,
    year: number,
    month: number,
    opts: MonthlyExportOptions = {},
  ): { blob: Blob; fileName: string } {
    const monthStr = String(month).padStart(2, '0');

    const monthlyInvoices = opts.prefiltered ? invoices : invoices.filter(inv => inMonth(inv, year, month));

    if (monthlyInvoices.length === 0) {
      throw new Error(`No se encontraron DTE o eventos para ${monthStr}/${year}`);
    }

    const data = monthlyInvoices.map(inv => ({
      ...inv,
      customerName: resolveCustomerName(inv.customerId, customers),
      customerDocument: resolveCustomerDocument(inv.customerId, customers),
      invoiceTypeName: getInvoiceTypeName(inv.invoiceType),
      statusText: getStatusText(inv.status),
    }));

    const jsonStr = JSON.stringify(data, null, 2);
    const sanitizedNit = companyNit.replace(/[^a-zA-Z0-9]/g, '');
    const fileName = `DTE_Eventos_${sanitizedNit}_${year}-${monthStr}.json`;

    const blob = new Blob([jsonStr], { type: 'application/json' });
    return { blob, fileName };
  }

  /**
   * Export invoices as a JSON file and trigger browser download.
   * Returns the Blob object URL.
   */
  static async exportMonthlyInvoicesJSON(
    invoices: Invoice[],
    customers: Customer[],
    companyNit: string,
    year: number,
    month: number,
    opts: MonthlyExportOptions = {},
  ): Promise<string> {
    const { blob, fileName } = this.buildMonthlyInvoicesJSONBlob(
      invoices, customers, companyNit, year, month, opts,
    );
    const url = downloadBlob(blob, fileName);
    return url;
  }
}
