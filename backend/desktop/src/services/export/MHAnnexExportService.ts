// MH F-07 Annex CSV Export Service
// Generates 5 CSV files for the Ministerio de Hacienda F-07 IVA declaration:
//   Anexo 1 — Ventas a Contribuyentes (CCF 03 + Notas de Crédito 05 / Débito 06)
//   Anexo 2 — Ventas a Consumidor Final (Factura + Exportacion, grouped by SV day)
//   Anexo 3 — Compras a Contribuyentes (purchases that carry crédito fiscal:
//             CCF 03 + NC 05 / ND 06 received — a Factura 01 gives no crédito
//             fiscal and is not part of this annex)
//   Anexo 5 — Compras a Sujetos Excluidos (FSE 14 the company ISSUED — the
//             buyer issues the FSE — plus any tipo 14 recorded in Compras)
//   Anulados — Invalidated documents
//
// Format: UTF-8 BOM, semicolon-separated, no headers, DD/MM/YYYY dates, 2 decimal places
// Dates are El Salvador calendar dates (svDateOf) — never the UTC date of an ISO timestamp.
// Desktop adaptation: uses browser download instead of expo-file-system + expo-sharing

import { Invoice, InvoiceType, InvoiceStatus } from '../../types/invoice';
import { Customer } from '../../types/customer';
import { Compra, excludeInternalUse } from '../../types/compras';
import { svDateOf, todaySV } from '../../utils/svDate';

const BOM = '\uFEFF';

/**
 * Sign of a Nota de Crédito's amounts in the F-07 annexes: it reverses part of
 * a CCF, so its rows subtract (negative ventas/débito in Anexo 1, negative
 * compras/crédito in Anexo 3). Notas de Débito add (positive).
 * NOTE: confirm against the MH portal validator if Hacienda ever rejects the
 * signed rows — this is the single switch.
 */
export const NOTA_CREDITO_AMOUNT_SIGN = -1;

const ANEXO1_INVOICE_TYPES = new Map<InvoiceType, string>([
  [InvoiceType.CCF, '03'],
  [InvoiceType.NotaCredito, '05'],
  [InvoiceType.NotaDebito, '06'],
]);

const ANEXO3_PURCHASE_TYPES = new Set(['03', '05', '06']);

export interface MHAnnexExportResult {
  files: string[];   // Object URLs of generated Blob files
  artifacts: MHAnnexArtifact[]; // Raw CSV content for Drive upload / re-use
  counts: {
    anexo1: number;
    anexo2: number;
    anexo3: number;
    anexo5: number;
    anulados: number;
  };
}

export interface MHAnnexArtifact {
  fileName: string;
  content: string; // UTF-8 BOM + CSV body
  mimeType: 'text/csv';
}

export class MHAnnexExportService {

  /**
   * Export all MH F-07 annexes for the given month.
   * Returns Blob URLs and triggers browser downloads.
   */
  static async exportMHAnexos(
    invoices: Invoice[],
    purchases: Compra[],
    companyName: string,
    opts: {
      download?: boolean;
      /** Resolves a document's customer when it stores only a customerId. */
      customers?: Customer[];
    } = { download: true },
  ): Promise<MHAnnexExportResult> {
    // Compras de uso interno nunca viajan a Hacienda.
    purchases = excludeInternalUse(purchases);
    const files: string[] = [];
    const artifacts: MHAnnexArtifact[] = [];
    const stamp = dateStamp();
    const customerById = new Map((opts.customers ?? []).map(c => [c.id, c]));
    const customerOf = (inv: Invoice): Customer | undefined =>
      inv.customer ?? (inv.customerId ? customerById.get(inv.customerId) : undefined);
    const safeName = sanitizeFileName(companyName);
    const counts = { anexo1: 0, anexo2: 0, anexo3: 0, anexo5: 0, anulados: 0 };
    const emit = (csv: string, fileName: string) => {
      artifacts.push({ fileName, content: csv, mimeType: 'text/csv' });
      if (opts.download !== false) {
        const url = downloadCSV(csv, fileName);
        if (url) files.push(url);
      }
    };

    // ── Anexo 1 — Ventas a Contribuyentes (CCF / NC / ND, Completada) ──
    // Notas de crédito and débito adjust the CCFs declared here, so they are
    // rows of this annex with their own tipo de documento (05 / 06) and signed
    // amounts (an NC subtracts — NOTA_CREDITO_AMOUNT_SIGN).
    const anexo1Invoices = invoices
      .filter(i => ANEXO1_INVOICE_TYPES.has(i.invoiceType) && i.status === InvoiceStatus.Completada)
      .sort((a, b) => svDateOf(a.date).localeCompare(svDateOf(b.date)));
    if (anexo1Invoices.length > 0) {
      let csv = BOM;
      for (const inv of anexo1Invoices) {
        const customer = customerOf(inv);
        const customerName = customerLegalName(customer).toUpperCase();
        const nitOrNrc = digitsOnly(customer?.nit) || digitsOnly(customer?.nrc ?? customer?.taxRegistrationNumber);
        const dui = digitsOnly(customer?.nationalId);
        const tipoDoc = ANEXO1_INVOICE_TYPES.get(inv.invoiceType)!;
        const sign = inv.invoiceType === InvoiceType.NotaCredito ? NOTA_CREDITO_AMOUNT_SIGN : 1;

        // L = IVA-exclusive base of the gravado lines (subTotal); exento and no
        // sujeto sales have their own columns; P = the whole document.
        const gravada = inv.totals?.subTotal ?? inv.subtotal ?? 0;
        const exenta = inv.totals?.totalExenta ?? 0;
        const noSuj = inv.totals?.totalNoSuj ?? 0;
        // Col R (v15): Tipo de Operación Renta — 1=solo gravada, 2=solo exenta,
        // 3=solo no sujeta, 4=mixta. Computed from the sales buckets.
        const tipoOperacion = computeTipoOperacion(gravada, exenta, noSuj);

        const row = [
          formatDateMH(inv.date),
          '4',
          tipoDoc,
          stripHyphens(inv.controlNumber),
          inv.receptionSeal ?? '',
          stripHyphens(inv.generationCode),
          '',
          nitOrNrc,
          customerName,
          formatSigned(exenta, sign),
          formatSigned(noSuj, sign),
          formatSigned(gravada, sign),
          formatSigned(inv.totals?.tax ?? inv.tax, sign),
          '0.00',
          '0.00',
          formatSigned(inv.totals?.totalAmount ?? inv.totalAmount, sign),
          dui,
          String(tipoOperacion),
          '3',
          '1',
        ].join(';');
        csv += row + '\n';
      }
      emit(csv, `Anexo1_${safeName}_${stamp}.csv`);
      counts.anexo1 = anexo1Invoices.length;
    }

    // ── Anexo 2 — Ventas a Consumidor Final (Factura + Exportacion, grouped by day) ──
    const anexo2Invoices = invoices.filter(
      i => (i.invoiceType === InvoiceType.Factura || i.invoiceType === InvoiceType.FacturaExportacion)
        && i.status === InvoiceStatus.Completada,
    );
    if (anexo2Invoices.length > 0) {
      let csv = BOM;

      const groups = new Map<string, { tipo: string; invoices: Invoice[] }>();
      for (const inv of anexo2Invoices) {
        // El Salvador calendar day — an ISO timestamp from 18:00 SV on is
        // already "tomorrow" in UTC.
        const dayKey = svDateOf(inv.date);
        const tipo = inv.invoiceType === InvoiceType.FacturaExportacion ? '11' : '01';
        const groupKey = `${dayKey}_${tipo}`;
        if (!groups.has(groupKey)) groups.set(groupKey, { tipo, invoices: [] });
        groups.get(groupKey)!.invoices.push(inv);
      }

      const sortedKeys = [...groups.keys()].sort();
      for (const key of sortedKeys) {
        const group = groups.get(key)!;
        const sorted = group.invoices.sort((a, b) => a.date.localeCompare(b.date));
        const fecha = formatDateMH(sorted[0].date);
        const tipo = group.tipo;

        const firstGenCode = stripHyphens(sorted[0].generationCode);
        const lastGenCode = stripHyphens(sorted[sorted.length - 1].generationCode);

        let totalFactura = 0;
        let totalExportacion = 0;
        let totalExenta = 0;
        let totalNoSuj = 0;
        // Each sale bucket goes to its own column. `totals.totalAmount` is the
        // whole document (gravado + exento + no sujeto), so counting it as
        // "gravadas" put exento/no sujeto sales in two columns and doubled them
        // in the total. Consumer-final gravadas are reported IVA-included
        // (totals.totalGravada on a Factura); a FEX is entirely export sales.
        for (const inv of sorted) {
          const { gravada, exenta, noSuj } = saleBucketsOf(inv);
          totalExenta += exenta;
          totalNoSuj += noSuj;
          if (tipo === '11') totalExportacion += gravada;
          else totalFactura += gravada;
        }
        const grandTotal = totalFactura + totalExportacion + totalExenta + totalNoSuj;
        const ventasGravadas = tipo === '01' ? formatDecimal2(totalFactura) : '0.00';
        const expFueraCA = tipo === '11' ? formatDecimal2(totalExportacion) : '0.00';
        // Col U (v15): Tipo de Operación Renta (same rules as Anexo 1).
        const tipoOperacion = computeTipoOperacion(totalFactura + totalExportacion, totalExenta, totalNoSuj);

        const row = [
          fecha, '4', tipo, 'N/A', 'N/A', 'N/A', 'N/A',
          firstGenCode, lastGenCode, '',
          formatDecimal2(totalExenta), '0.00', formatDecimal2(totalNoSuj),
          ventasGravadas, '0.00', expFueraCA, '0.00', '0.00', '0.00',
          formatDecimal2(grandTotal), String(tipoOperacion), '3', '2',
        ].join(';');
        csv += row + '\n';
      }
      emit(csv, `Anexo2_${safeName}_${stamp}.csv`);
      counts.anexo2 = anexo2Invoices.length;
    }

    // ── Anulados — Invalidated Documents ──
    // Col A = numeroControl (DTE), col G = selloRecibido. Previously both
    // were emitted as empty strings; MH's portal silently rejects rows
    // whose col A isn't the DTE's resolution number.
    const anulados = invoices.filter(i => i.status === InvoiceStatus.Anulada);
    if (anulados.length > 0) {
      let csv = BOM;
      for (const inv of anulados) {
        const docTypeCode = getDocumentTypeCode(inv.invoiceType);
        const genCode = stripHyphens(inv.generationCode);
        const row = [
          stripHyphens(inv.controlNumber ?? ''),
          '4',
          '0',
          '0',
          docTypeCode,
          'D',
          inv.receptionSeal ?? '',
          '0',
          '0',
          genCode,
        ].join(';');
        csv += row + '\n';
      }
      emit(csv, `Anulados_${safeName}_${stamp}.csv`);
      counts.anulados = anulados.length;
    }

    // ── Anexo 3 — Compras a Contribuyentes (tipoDte 03, 05, 06) ──
    // Only documents that carry crédito fiscal. A Factura (01) bought from a
    // supplier gives none, so declaring it here claimed IVA the company can't
    // deduct. A received NC subtracts (NOTA_CREDITO_AMOUNT_SIGN).
    const anexo3Purchases = purchases.filter(p => ANEXO3_PURCHASE_TYPES.has(p.tipoDte));
    if (anexo3Purchases.length > 0) {
      let csv = BOM;
      for (const p of anexo3Purchases) {
        const fecha = convertDateFormat(p.fecha);
        const numDoc = stripHyphens(p.codigoGeneracion);
        const gravada = p.totalGravada ?? 0;
        const exenta = (p as any).totalExenta ?? 0;
        const noSuj = (p as any).totalNoSuj ?? 0;
        // Prefer the actual IVA amount from the purchase DTE (it accounts for
        // rounding + multi-rate scenarios). Fall back to 13% of gravada only
        // when the source didn't carry totalIva.
        const creditoFiscalNum = p.totalIva && p.totalIva > 0 ? p.totalIva : gravada * 0.13;
        const sign = p.tipoDte === '05' ? NOTA_CREDITO_AMOUNT_SIGN : 1;
        const creditoFiscal = formatSigned(creditoFiscalNum, sign);
        // MH col O = net purchase amount (excluding IVA). Previously we sent
        // totalPagar which includes IVA — MH's validator sums col J + O and
        // flags the row when the IVA is double-counted.
        const totalNet = gravada + exenta + noSuj;
        const total = formatSigned(totalNet, sign);
        const tipoOperacion = computeTipoOperacion(gravada, exenta, noSuj);

        const row = [
          fecha, '4', p.tipoDte, numDoc, digitsOnly(p.emisorNit) || p.emisorNit, p.emisorNombre,
          formatSigned(exenta + noSuj, sign), '0.00', '0.00', formatSigned(gravada, sign),
          '0.00', '0.00', '0.00', creditoFiscal, total, '',
          String(tipoOperacion), '2', '4', '2', '3',
        ].join(';');
        csv += row + '\n';
      }
      emit(csv, `Anexo3_${safeName}_${stamp}.csv`);
      counts.anexo3 = anexo3Purchases.length;
    }

    // ── Anexo 5 — Compras a Sujetos Excluidos (FSE 14) ──
    // The FSE is issued by the BUYER: the company's own completed FSE invoices
    // are its purchases from sujetos excluidos. Tipo 14 records in Compras (if
    // any were imported) follow, skipping one already issued here.
    const issuedFSE = invoices.filter(
      i => i.invoiceType === InvoiceType.SujetoExcluido && i.status === InvoiceStatus.Completada,
    );
    const issuedCodes = new Set(issuedFSE.map(i => stripHyphens(i.generationCode).toUpperCase()).filter(Boolean));
    const anexo5Purchases = purchases.filter(
      p => p.tipoDte === '14' && !issuedCodes.has(stripHyphens(p.codigoGeneracion).toUpperCase()),
    );
    if (issuedFSE.length + anexo5Purchases.length > 0) {
      let csv = BOM;
      for (const inv of issuedFSE) {
        const supplier = customerOf(inv);
        const nitDigits = digitsOnly(supplier?.nit);
        const duiDigits = digitsOnly(supplier?.nationalId);
        const otherDoc = digitsOnly(supplier?.documentNumber) || (supplier?.documentNumber ?? '');
        const [docType, numId] = nitDigits.length >= 14
          ? ['1', nitDigits]
          : duiDigits.length === 9
            ? ['2', duiDigits]
            : nitDigits
              ? [detectDocType(nitDigits), nitDigits]
              : ['3', otherDoc || duiDigits];
        const row = [
          docType,
          numId,
          customerLegalName(supplier),
          formatDateMH(inv.date),
          inv.receptionSeal ?? '',
          stripHyphens(inv.generationCode),
          formatDecimal2(inv.totals?.totalAmount ?? inv.totalAmount),
          formatDecimal2(inv.totals?.ivaRete1 ?? 0),
          '2',
          '2',
          '4',
          '2',
          '5',
        ].join(';');
        csv += row + '\n';
      }
      for (const p of anexo5Purchases) {
        const docType = detectDocType(p.emisorNit);
        const numId = stripHyphens(p.emisorNit);
        const fecha = convertDateFormat(p.fecha);
        const numDoc = stripHyphens(p.codigoGeneracion);
        const total = formatDecimal2(p.totalPagar);
        const ivaRete = formatDecimal2(p.totalIva);

        const row = [
          docType,
          numId,
          p.emisorNombre,
          fecha,
          // Col E = reception seal (selloRecibido). Previously '' — MH's
          // validator for sujetos excluidos rejects rows missing this when
          // the purchase is electronic.
          (p as any).selloRecibido ?? '',
          numDoc,
          total,
          ivaRete,
          '2',
          '2',
          '4',
          '2',
          '5',
        ].join(';');
        csv += row + '\n';
      }
      emit(csv, `Anexo5_${safeName}_${stamp}.csv`);
      counts.anexo5 = issuedFSE.length + anexo5Purchases.length;
    }

    return { files, artifacts, counts };
  }

  /**
   * On desktop, files are downloaded directly — no separate share step needed.
   * This method is a no-op kept for API compatibility with the RN version.
   */
  static async shareFiles(_fileUris: string[]): Promise<void> {
    // Downloads are triggered at generation time via downloadCSV()
  }
}

// ── Helper Functions ──

function formatDateMH(dateString: string): string {
  // El Salvador calendar date of the stored value (date-only strings as-is).
  const date = svDateOf(dateString) || dateString.substring(0, 10);
  const parts = date.split('-');
  if (parts.length !== 3) return dateString;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function convertDateFormat(dateString: string): string {
  return formatDateMH(dateString);
}

function formatDecimal2(value: number | undefined | null): string {
  return (value ?? 0).toFixed(2);
}

/** 2-decimal amount with the row's sign; never prints "-0.00". */
function formatSigned(value: number | undefined | null, sign: number): string {
  const n = Math.abs(value ?? 0) < 0.005 ? 0 : (value ?? 0) * sign;
  return (n === 0 ? 0 : n).toFixed(2);
}

/**
 * A document's DTE sale buckets: totals.totalGravada / totalExenta / totalNoSuj
 * when stored (Normativa 2.0 totals); older invoices without them were all
 * gravado, so their gravada = the document total.
 */
function saleBucketsOf(inv: Invoice): { gravada: number; exenta: number; noSuj: number } {
  const totals = inv.totals;
  const exenta = totals?.totalExenta ?? 0;
  const noSuj = totals?.totalNoSuj ?? 0;
  const gravada = totals?.totalGravada ??
    Math.max(0, (totals?.totalAmount ?? inv.totalAmount ?? 0) - exenta - noSuj);
  return { gravada, exenta, noSuj };
}

function digitsOnly(value: string | undefined | null): string {
  return (value ?? '').replace(/\D/g, '');
}

/** Razón social first (businessName), then the stored full name, then first + last. */
function customerLegalName(customer: Customer | undefined): string {
  if (!customer) return '';
  return (
    customer.businessName?.trim() ||
    customer.name?.trim() ||
    [customer.firstName ?? '', customer.lastName ?? ''].filter(Boolean).join(' ').trim()
  );
}

/**
 * MH F-07 (v15) "Tipo de Operación Renta" — derived from which sales buckets
 * carry non-zero amounts. Applied on Anexo 1 col R, Anexo 2 col U, Anexo 3 col Q.
 *   1 = solo gravada, 2 = solo exenta, 3 = solo no sujeta, 4 = mixta.
 * Returns 1 as the default when everything is zero (empty row).
 */
function computeTipoOperacion(gravada: number, exenta: number, noSuj: number): 1 | 2 | 3 | 4 {
  const buckets = [gravada > 0, exenta > 0, noSuj > 0];
  const count = buckets.filter(Boolean).length;
  if (count === 0) return 1;
  if (count > 1) return 4;
  if (buckets[0]) return 1;
  if (buckets[1]) return 2;
  return 3;
}

function stripHyphens(value: string | undefined | null): string {
  return (value ?? '').replace(/-/g, '');
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function dateStamp(): string {
  return todaySV().replace(/-/g, '');
}

function getDocumentTypeCode(invoiceType: InvoiceType): string {
  switch (invoiceType) {
    case InvoiceType.Factura:                 return '01';
    case InvoiceType.CCF:                     return '03';
    case InvoiceType.NotaRemision:            return '04';
    case InvoiceType.NotaCredito:             return '05';
    case InvoiceType.NotaDebito:              return '06';
    case InvoiceType.ComprobanteRetencion:    return '07';
    case InvoiceType.ComprobanteLiquidacion:  return '08';
    case InvoiceType.DocumentoContableLiquidacion: return '09';
    case InvoiceType.FacturaExportacion:      return '11';
    case InvoiceType.SujetoExcluido:          return '14';
    case InvoiceType.ComprobanteDonacion:     return '15';
    case InvoiceType.EventoOperacionesEspeciales: return '17';
    case InvoiceType.EventoRetorno:           return '18';
    default:                                  return '01';
  }
}

function detectDocType(nit: string): string {
  const clean = (nit ?? '').replace(/-/g, '');
  if (clean.length >= 14) return '1'; // NIT
  if (clean.length === 9)  return '2'; // DUI
  return '3'; // Other
}

/**
 * Create a Blob URL for the CSV content and trigger browser download.
 * Returns the object URL (useful for debugging; caller should revoke if needed).
 */
function downloadCSV(content: string, fileName: string): string | null {
  try {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Revoke after a short delay to allow the download to start
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return url;
  } catch (error) {
    console.error(`Failed to download CSV ${fileName}:`, error);
    return null;
  }
}
