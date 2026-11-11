/**
 * InvoicePDFGenerator — Genera PDFs de facturas DTE para el escritorio
 *
 * Usa window.electronAPI.printToPDF (IPC → hidden BrowserWindow.printToPDF)
 * en producción y window.print() en modo navegador/dev.
 *
 * Portado de: App.ReactNative/FacturasSimplesRN/src/services/pdf/InvoicePDFGenerator.ts
 */

import QRCode from 'qrcode';
import { Invoice, InvoiceType } from '@/types/invoice';
import {
  carriesIva,
  computeLine,
  documentTotals,
  isIvaExclusiveType,
  roundMoney,
  sumLines,
} from '@/utils/invoiceTotals';
import { DTEMappingService } from '@/services/dte/DTEMappingService';
import { Company, CompanyEnvironment } from '@/types/company';
import { SubscriptionTier } from '@/services/subscription/SubscriptionTypes';
import facturasSimplesLogo from '@/assets/facturasSimples.png';

const escapeHtml = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};


/**
 * Consulta pública URL printed as the DTE's QR (Manual Técnico v2.0 §5): one host
 * for both ambientes — the ambiente is a query parameter (test companies used to
 * print a pilotomhqa.mh.gob.sv QR) — and fechaEmi is the DTE's own fecEmi
 * (toLocaleDateString('es-SV') was not zero-padded: "9/1/2026" → "2026-1-9").
 * Empty when the invoice has no codigoGeneracion yet.
 */
export function consultaPublicaUrl(
  invoice: Pick<Invoice, 'generationCode' | 'date'>,
  company: Pick<Company, 'environment'>,
): string {
  if (!invoice.generationCode) return '';
  const ambiente = company.environment === CompanyEnvironment.Production ? '01' : '00';
  return `https://admin.factura.gob.sv/consultaPublica?ambiente=${ambiente}&codGen=${invoice.generationCode}&fechaEmi=${DTEMappingService.emissionDateOf(invoice)}`;
}

export type PdfDocumentMode = 'invoice' | 'quote';

export interface PdfOptions {
  /**
   * Selects whether the generated document is a signed DTE invoice or a quote
   * produced before submission to MH.
   */
  documentMode?: PdfDocumentMode;
  /**
   * Render a diagonal "VERSIÓN GRATIS" watermark across every page.
   * Used by the Free tier to encourage upgrade.
   */
  watermark?: boolean;
  /**
   * Subscription tier of the user generating the PDF.
   * Drives logo gating: Lite ALWAYS shows the Facturas Simples app logo
   * (branding/compliance rule for free tier), AdFree/Pro show the company
   * uploaded logo (with the app logo as fallback when none is uploaded).
   */
  tier?: SubscriptionTier;
}

// Module-scoped cache for the app logo data URL — fetching the bundled PNG and
// converting to base64 is non-trivial; we only ever need to do it once per page
// load. `null` means "not yet fetched"; once resolved it stays cached.
let appLogoDataUrlCache: string | null = null;
let appLogoFetchPromise: Promise<string> | null = null;

/**
 * Loads the Facturas Simples app logo (bundled via Vite) as a base64 data URL
 * suitable for embedding inside the generated PDF HTML. Cached at module scope
 * so PDF generation never refetches the asset.
 */
async function getAppLogoDataUrl(): Promise<string> {
  if (appLogoDataUrlCache) return appLogoDataUrlCache;
  if (appLogoFetchPromise) return appLogoFetchPromise;

  appLogoFetchPromise = (async () => {
    try {
      const response = await fetch(facturasSimplesLogo);
      const blob = await response.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      appLogoDataUrlCache = dataUrl;
      return dataUrl;
    } catch {
      // If the asset fails to load (e.g. printToPDF child window without
      // network), fall back to an empty string — caller will skip the <img>.
      appLogoDataUrlCache = '';
      return '';
    } finally {
      appLogoFetchPromise = null;
    }
  })();

  return appLogoFetchPromise;
}

export class InvoicePDFGenerator {
  /**
   * Genera el PDF de una factura y devuelve el buffer.
   * En modo Electron usa el IPC pdf:generate.
   * En modo navegador abre el HTML en una ventana nueva para imprimir.
   */
  static async generatePDF(
    invoice: Invoice,
    company: Company,
    options: PdfOptions = {},
  ): Promise<Uint8Array> {
    const html = await this.buildHTML(invoice, company, options);

    if (typeof window !== 'undefined' && window.electronAPI?.printToPDF) {
      const buffer = await window.electronAPI.printToPDF(html, {
        landscape: false,
        pageSize: 'Letter',
      });
      return buffer;
    }

    // Modo navegador/dev — abre ventana de impresión y devuelve buffer vacío
    await this.generateAndPreviewPDF(invoice, company, options);
    return new Uint8Array(0);
  }

  /**
   * Genera el PDF y muestra un diálogo de guardar archivo.
   * Devuelve true si el archivo fue guardado, false si el usuario canceló.
   */
  static async generateAndSavePDF(
    invoice: Invoice,
    company: Company,
    options: PdfOptions = {},
  ): Promise<boolean> {
    const html = await this.buildHTML(invoice, company, options);

    if (!window.electronAPI?.printToPDF) {
      // Modo navegador — abrir preview
      const previewWin = window.open('', '_blank');
      if (previewWin) {
        previewWin.document.write(html);
        previewWin.document.close();
        previewWin.focus();
        previewWin.print();
      }
      return false;
    }

    const buffer = await window.electronAPI.printToPDF(html, {
      landscape: false,
      pageSize: 'Letter',
    });

    const fileName = options.documentMode === 'quote'
      ? `Cotizacion_${invoice.invoiceNumber || 'sin-numero'}.pdf`
      : `${invoice.controlNumber || invoice.invoiceNumber}.pdf`;

    const filePath = await window.electronAPI.showSaveDialog({
      title: 'Guardar PDF',
      defaultPath: fileName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });

    if (!filePath) return false;

    // Escribir el buffer binario via IPC (base64)
    const base64 = uint8ArrayToBase64(buffer);
    await window.electronAPI.writeFile(filePath, base64, 'base64');

    return true;
  }

  /**
   * Genera el HTML listo para previsualizar en un iframe.
   * Método público para InvoicePDFPreview.
   */
  static async getPreviewHTML(
    invoice: Invoice,
    company: Company,
    options: PdfOptions = {},
  ): Promise<string> {
    return this.buildHTML(invoice, company, options);
  }

  /**
   * Genera el PDF y lo abre en una ventana del navegador (modo dev/preview).
   */
  static async generateAndPreviewPDF(
    invoice: Invoice,
    company: Company,
    options: PdfOptions = {},
  ): Promise<void> {
    const html = await this.buildHTML(invoice, company, options);
    const previewWin = window.open('', '_blank');
    if (previewWin) {
      previewWin.document.write(html);
      previewWin.document.close();
      previewWin.focus();
    }
  }

  // ── Construcción del HTML ────────────────────────────────────────────────

  private static async buildHTML(
    invoice: Invoice,
    company: Company,
    options: PdfOptions = {},
  ): Promise<string> {
    const isQuoteMode = options.documentMode === 'quote';

    // QR ambiente comes from company.environment — the same source as the DTE's
    // own ambiente (InvoiceGenerationService resolveEnvironmentCode).
    const qrUrl = !isQuoteMode ? consultaPublicaUrl(invoice, company) : '';

    const qrCodeDataUrl = qrUrl
      ? await QRCode.toDataURL(qrUrl, { width: 150, margin: 1 })
      : '';

    // Logo gating by subscription tier.
    //   Lite (free):     ALWAYS the Facturas Simples app logo. The customer's
    //                    upload is intentionally ignored — same compliance/
    //                    branding rule as the "Versión Gratis" watermark.
    //   AdFree / Pro:    customer's uploaded logo, falling back to the app
    //                    logo when no logo has been uploaded yet.
    //   undefined tier:  treated as Lite (safe default — never leak a
    //                    customer logo for an unknown caller).
    const isFreeTier = !options.tier || options.tier === SubscriptionTier.Lite;
    let logoDataUrl = '';
    if (isFreeTier) {
      logoDataUrl = await getAppLogoDataUrl();
    } else if (company.invoiceLogo) {
      logoDataUrl = `data:image/png;base64,${company.invoiceLogo}`;
    } else {
      logoDataUrl = await getAppLogoDataUrl();
    }

    return this.generateHTMLContent(invoice, company, qrCodeDataUrl, logoDataUrl, options);
  }

  private static generateHTMLContent(
    invoice: Invoice,
    company: Company,
    qrCodeDataUrl: string,
    logoDataUrl: string,
    options: PdfOptions = {},
  ): string {
    const isFreeTier = !options.tier || options.tier === SubscriptionTier.Lite;
    const isQuoteMode = options.documentMode === 'quote';

    // Fecha formateada
    const formattedDate = new Date(invoice.date).toLocaleString('es-SV', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    // Totals: the same per-line computation (utils/invoiceTotals.computeLine)
    // the stored invoice and the DTE mapper use, and the 1% retention, the 1%
    // percepción and the FSE renta decided by the stored invoice exactly like
    // DTEMappingService.mapResumen (documentTotals) — so every
    // printed figure is the figure in the JSON Hacienda received. IVA-exclusive
    // documents (CCF, NC, ND, NR) print pre-IVA prices + the IVA tributo; a
    // Factura prints IVA-inclusive amounts; FEX / FSE / CD carry no IVA.
    const lines = (invoice.items || []).map((item) => computeLine(item, invoice.invoiceType));
    const sums = sumLines(lines);
    const totals = documentTotals(invoice);
    const exclusive = isIvaExclusiveType(invoice.invoiceType);
    const withIva = carriesIva(invoice.invoiceType);
    const isFSE = invoice.invoiceType === InvoiceType.SujetoExcluido;
    const subTotalVentas = withIva
      ? roundMoney(sums.totalNoSuj + sums.totalExenta + sums.totalGravada)
      : totals.totalAmount;
    const totalAmount = totals.totalAmount;
    const tax = totals.tax;
    const ivaRete1 = totals.ivaRete1;
    const ivaPerci1 = totals.ivaPerci1 ?? 0;
    const reteRenta = totals.reteRenta;
    // = resumen.totalPagar: what the document actually charges.
    const totalPagar = totals.totalPagar;

    // Filas de ítems — venta* columns are NET of the per-item discount
    // (montoDescu prints in its own column), split by tax bucket. Chrome:
    // zebra striping and alignment come from the stylesheet (nth-child +
    // classes), mirroring the iOS renderer which fills even rows full-bleed
    // and right-aligns numeric columns with no gridlines.
    const money = (n: number) => `$${n.toFixed(2)}`;
    const itemsHTML = (invoice.items || [])
      .map((item, index) => {
        const line = lines[index];
        return `
          <tr>
            <td>${index + 1}</td>
            <td>${line.cantidad}</td>
            <td>${escapeHtml(item.productName)}</td>
            <td class="col-money">${money(line.precioUni)}</td>
            <td class="col-money">${money(line.montoDescu)}</td>
            <td class="col-money">${money(line.bucket === 'noSuj' ? line.venta : 0)}</td>
            <td class="col-money">${money(line.bucket === 'exenta' ? line.venta : 0)}</td>
            <td class="col-money">${money(line.bucket === 'gravada' ? line.venta : 0)}</td>
          </tr>`;
      })
      .join('');

    // Summary rows — labels + row visibility mirror iOS L379-391 and the DTE
    // resumen: discounts are per item (montoDescu), so the three global
    // discount rows are 0 like descuNoSuj/descuExenta/descuGravada; the IVA
    // row prints on IVA-exclusive documents; retention rows only when they
    // apply (zero-value noise rows are omitted).
    const summaryRows: [string, number][] = [
      ['Sumatoria de Ventas', subTotalVentas],
      ['Monto Global de Descuento, Rebajas y Otros a Ventas No Sujetas:', 0],
      ['Monto Global de Descuento, Rebajas y Otros a Ventas Exentas:', 0],
      ['Monto Global de Descuento, Rebajas y Otros a Ventas Gravadas:', 0],
      ...(exclusive ? [['20 - Impuesto al Valor Agregado 13%:', tax] as [string, number]] : []),
      ['Sub Total:', subTotalVentas],
      ...(ivaPerci1 > 0 ? [['(+) Percepción IVA 1%:', ivaPerci1] as [string, number]] : []),
      ...(ivaRete1 > 0 ? [['(-) IVA Retenido:', ivaRete1] as [string, number]] : []),
      // FSE without renta (purchase of goods, applyRentaRetention off) prints no withholding row.
      ...(isFSE && reteRenta > 0 ? [['(-) Retención Renta:', reteRenta] as [string, number]] : []),
      ['Monto Total de la Operación:', totalAmount],
      ['Total Otros Montos No Afectos:', 0],
      ['Total a Pagar:', totalPagar],
    ];

    const summaryHTML = summaryRows
      .map(([label, amount]) => `
        <tr>
          <td>${label}</td>
          <td class="resumen-value">$${amount.toFixed(2)}</td>
        </tr>`)
      .join('');

    // "Total en letras" reads the amount the document charges (Total a Pagar) —
    // it used to spell a "Sumatoria" that subtracted the retention from the
    // pre-IVA base (CCF $113 → "CIEN") or added the discount back.
    const totalInWords = this.numberToWords(totalPagar);
    const documentTypeStr = this.getDocumentTypeString(invoice.invoiceType);
    const documentLabel = isQuoteMode ? 'COTIZACIÓN' : documentTypeStr;

    // iOS L194-196: prefers NIT if customer hasInvoiceSettings AND nit is
    // non-empty; otherwise falls back to nationalId.
    const customerDocNumber =
      (invoice.customer as any)?.hasInvoiceSettings && invoice.customer?.nit
        ? invoice.customer.nit
        : invoice.customer?.nationalId || '';

    // iOS Customer.fullName always returns firstName + " " + lastName,
    // never businessName. Fallback "Undefined User " per Swift source.
    const customerName = invoice.customer
      ? (`${invoice.customer.firstName ?? ''} ${invoice.customer.lastName ?? ''}`.trim() || 'Undefined User')
      : 'N/A';

    // Metadata band — mirrors the iOS grid: QR 75×75 at the 30pt inset,
    // then three columns starting at x=130/306/459 (176/153/153pt wide),
    // label directly above value with a 20pt row pitch.
    const metadataSectionHTML = isQuoteMode
      ? `
    <div class="metadata-section">
      <div class="metadata-grid metadata-grid--quote">
        <div class="metadata-col" style="flex: 0 0 176pt;">
          <div class="metadata-label">Número de Cotización:</div>
          <div class="metadata-value">${escapeHtml(invoice.invoiceNumber)}</div>
          <div class="metadata-label">Fecha de Emisión:</div>
          <div class="metadata-value">${formattedDate}</div>
        </div>
        <div class="metadata-col" style="flex: 0 0 153pt;">
          <div class="metadata-label">Estado:</div>
          <div class="metadata-value">Pendiente de aprobación</div>
          <div class="metadata-label">Condición:</div>
          <div class="metadata-value">Contado</div>
        </div>
        <div class="metadata-col" style="flex: 1;">
          <div class="metadata-label">Documento:</div>
          <div class="metadata-value">Documento no tributario. No sustituye factura ni comprobante fiscal.</div>
        </div>
      </div>
    </div>`
      : `
    <div class="metadata-section">
      ${qrCodeDataUrl ? `<img src="${qrCodeDataUrl}" class="qr-code" alt="Código QR" />` : ''}
      <div class="metadata-grid">
        <div class="metadata-col" style="flex: 0 0 176pt;">
          <div class="metadata-label">Modelo de Facturación:</div>
          <div class="metadata-value">MODELO FACTURACIÓN PREVIO</div>
          <div class="metadata-label">Código de Generación:</div>
          <div class="metadata-value">${escapeHtml(invoice.generationCode)}</div>
          <div class="metadata-label">Número de Control:</div>
          <div class="metadata-value">${escapeHtml(invoice.controlNumber)}</div>
          <div class="metadata-label">Sello de Recepción:</div>
          <div class="metadata-value">${escapeHtml(invoice.receptionSeal)}</div>
        </div>
        <div class="metadata-col" style="flex: 0 0 153pt;">
          <div class="metadata-label">Tipo de Transmisión:</div>
          <div class="metadata-value">TRANSMISIÓN NORMAL</div>
          <div class="metadata-label">Versión de JSON:</div>
          <div class="metadata-value">${this.getSchemaVersion(invoice)}</div>
        </div>
        <div class="metadata-col" style="flex: 0 0 153pt;">
          <div class="metadata-label">Fecha y Hora de Generación:</div>
          <div class="metadata-value">${formattedDate}</div>
        </div>
      </div>
    </div>`;

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    /* Layout mirrors the iOS InvoicePDFGenerator (UIGraphicsPDFRenderer with
       absolute coordinates): full-bleed section bands, 30pt left text inset,
       items table running to the right paper edge, no gridlines, 6–9pt type,
       and the footer pair pinned to the page bottom. */
    @page { size: Letter; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; font-size: 7pt; line-height: 1.3; color: #000; }
    .page { width: 612pt; min-height: 792pt; margin: 0 auto; background: #fff; position: relative; display: flex; flex-direction: column; }

    /* iOS L65-70: company block at x=30, 12pt line pitch; logo 75×75 top-right. */
    .company-header { padding: 10pt 120pt 0 30pt; }
    .company-name { font-size: 8pt; font-weight: bold; color: #555; line-height: 12pt; }
    .company-line { font-size: 9pt; line-height: 12pt; }
    .logo { position: absolute; top: 5pt; right: 45pt; width: 75pt; height: 75pt; object-fit: contain; }
    .free-tier-link { position: absolute; top: 83pt; right: 45pt; width: 75pt; text-align: center; font-size: 5.5pt; color: #059669; text-decoration: none; }

    .title-section { background: #555; color: #fff; text-align: center; padding: 3pt 0; margin-top: 5pt; }
    .title-section h1, .title-section h2 { font-size: 8pt; font-weight: bold; line-height: 12pt; }

    .metadata-section { background: #f2f2f2; display: flex; padding: 5pt 0 10pt 30pt; }
    .qr-code { flex: 0 0 75pt; width: 75pt; height: 75pt; }
    .metadata-grid { display: flex; flex: 1; min-width: 0; padding-left: 25pt; }
    .metadata-grid--quote { padding-left: 0; }
    .metadata-col { min-width: 0; padding-right: 12pt; }
    .metadata-label { font-size: 7pt; color: #808080; line-height: 10pt; }
    .metadata-value { font-size: 7pt; color: #000; line-height: 10pt; }

    .section-header { background: #555; color: #fff; text-align: center; font-size: 7.5pt; font-weight: bold; line-height: 20pt; margin-top: 5pt; }
    .section-content { background: #f2f2f2; padding: 5pt 30pt 10pt; }
    .grid-3col { display: flex; width: 100%; }
    .grid-col { min-width: 0; }
    .field { margin-bottom: 5pt; }
    .field-label { font-size: 7pt; color: #808080; line-height: 10pt; }
    .field-value { font-size: 7pt; color: #000; line-height: 10pt; }

    /* iOS L216-218: columns 25/35/220/60×5 from x=30 to x=610. Here the
       first cell absorbs the 30pt inset and the last one the 2pt right edge
       so the zebra bands bleed the full 612pt page width, exactly like the
       renderer's edge-to-edge fills. table-layout:fixed + overflow-wrap
       give the measured no-overflow behavior of wrapDescription. */
    .items-table { width: 612pt; table-layout: fixed; border-collapse: collapse; margin-top: 5pt; }
    .items-table th { font-size: 7.5pt; font-weight: bold; color: #000; text-align: left; border: none; padding: 2pt; line-height: 10pt; }
    .items-table td { font-size: 7pt; color: #000; border: none; padding: 2.5pt 2pt; line-height: 10pt; vertical-align: top; overflow-wrap: anywhere; }
    .items-table tbody tr:nth-child(odd) td { background: #f2f2f2; }
    .items-table th:first-child, .items-table td:first-child { padding-left: 30pt; }
    .col-money { text-align: right; }

    /* iOS L305 pins this pair at pageHeight − 165. margin-top:auto inside the
       page flex column keeps that bottom-anchored look while letting long
       item lists push it onto a second page instead of overlapping it. */
    .footer-tables { display: flex; margin-top: auto; padding-top: 5pt; }
    .footer-half { width: 50%; min-width: 0; }
    .half-header { background: #555; color: #fff; text-align: center; font-size: 7.5pt; font-weight: bold; line-height: 20pt; }
    .footer-content { background: #f2f2f2; padding: 5pt 10pt 8pt 30pt; }
    .footer-row { font-size: 7pt; line-height: 12pt; }
    .footer-label { display: inline-block; width: 40%; }
    .footer-value { display: inline-block; width: 58%; }
    .total-words { font-size: 6pt; text-transform: uppercase; margin-top: 5pt; line-height: 10pt; }
    .footer-right .footer-content { padding: 0; }
    .resumen-table { width: 100%; table-layout: fixed; border-collapse: collapse; }
    .resumen-table td { font-size: 6pt; border: none; padding: 0 4pt; line-height: 12pt; }
    .resumen-table tbody tr:nth-child(odd) td { background: #fafafa; }
    .resumen-value { text-align: right; }

    .app-footer { margin-top: 3pt; padding: 0 3pt 6pt; font-size: 6pt; color: #000; }
    .app-footer-link { color: inherit; text-decoration: none; }
    .app-footer-url { display: block; font-size: 5.5pt; color: #555; margin-top: 1pt; padding-left: 14pt; }

    .watermark { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-45deg); font-size: 48pt; font-weight: bold; color: rgba(85, 85, 85, 0.10); white-space: nowrap; pointer-events: none; }

    /* Screen (iframe preview / dev window): neutral backdrop, centered page. */
    @media screen {
      body { background: #e5e7eb; padding: 16pt 0; }
      .page { box-shadow: 0 2pt 8pt rgba(0, 0, 0, 0.3); }
    }
    @media print {
      body { padding: 0; }
      .page { box-shadow: none; }
    }
  </style>
</head>
<body>
  <div class="page">
    ${options.watermark ? '<div class="watermark">VERSIÓN GRATIS</div>' : ''}

    <!-- Encabezado de empresa -->
    <div class="company-header">
      <div class="company-name">${escapeHtml(company.nombreComercial.toUpperCase())}</div>
      <div class="company-line">NIT: ${escapeHtml(company.nit)}  NRC: ${escapeHtml(company.nrc)}</div>
      <div class="company-line">Actividad Económica: ${escapeHtml(company.descActividad)}</div>
      <div class="company-line">Dirección: ${escapeHtml(company.complemento)}</div>
      <div class="company-line">Correo Electrónico: ${escapeHtml(company.correo)}</div>
      <div class="company-line">Teléfono: ${escapeHtml(company.telefono)}      Tipo de Establecimiento: ${escapeHtml(company.establecimiento)}</div>
    </div>

    ${logoDataUrl ? `<img src="${logoDataUrl}" class="logo" alt="Logo" />` : ''}
    ${isFreeTier ? `<a href="https://www.facturasimples.pro" class="free-tier-link">www.facturasimples.pro</a>` : ''}

    <!-- Tipo de documento -->
    <div class="title-section">
      <h1>${isQuoteMode ? 'DOCUMENTO NO TRIBUTARIO' : 'DOCUMENTO TRIBUTARIO ELECTRÓNICO'}</h1>
      <h2>${escapeHtml(documentLabel)}</h2>
    </div>

    <!-- Metadatos + QR -->
    ${metadataSectionHTML}

    <!-- Receptor -->
    <div class="section-header">RECEPTOR</div>
    <div class="section-content">
      <div class="grid-3col">
        <div class="grid-col" style="flex: 0 0 174pt;">
          <div class="field">
            <div class="field-label">Nombre ó Razón Social:</div>
            <div class="field-value">${escapeHtml(customerName)}</div>
          </div>
          <div class="field">
            <div class="field-label">NRC:</div>
            <div class="field-value">${escapeHtml(invoice.customer?.nrc)}</div>
          </div>
        </div>
        <div class="grid-col" style="flex: 0 0 204pt;">
          <div class="field">
            <div class="field-label">Tipo de Documento:</div>
            <div class="field-value">DUI/NIT</div>
          </div>
          <div class="field">
            <div class="field-label">Actividad Económica:</div>
            <div class="field-value">${InvoicePDFGenerator.splitText(escapeHtml(invoice.customer?.descActividad), 35)}</div>
          </div>
        </div>
        <div class="grid-col" style="flex: 1;">
          <div class="field">
            <div class="field-label">N° Documento:</div>
            <div class="field-value">${escapeHtml(customerDocNumber)}</div>
          </div>
          <div class="field">
            <div class="field-label">Dirección:</div>
            <div class="field-value">${InvoicePDFGenerator.splitText(escapeHtml(invoice.customer?.address), 40)}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Cuerpo del documento -->
    <div class="section-header">CUERPO DEL DOCUMENTO</div>
    <table class="items-table">
      <thead>
        <tr>
          <th style="width: 55pt;">N°</th>
          <th style="width: 35pt;">Cant.</th>
          <th style="width: 220pt;">Descripción</th>
          <th style="width: 60pt;">Precio<br/>Unitario</th>
          <th style="width: 60pt;">Descuento<br/>ítem</th>
          <th style="width: 60pt;">Ventas no<br/>sujetas</th>
          <th style="width: 60pt;">Ventas<br/>exentas</th>
          <th style="width: 62pt;">Ventas<br/>gravadas</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHTML}
      </tbody>
    </table>

    <!-- Pie: extensión y resumen, anclados al fondo de la página -->
    <div class="footer-tables">
      <div class="footer-half footer-left">
        <div class="half-header">EXTENSIÓN / TOTAL EN LETRAS</div>
        <div class="footer-content">
          <div class="footer-row">
            <span class="footer-label">Nombre Entrega:</span>
            <span class="footer-value">${escapeHtml(invoice.nombEntrega) || '-'}</span>
          </div>
          <div class="footer-row">
            <span class="footer-label">N° Documento:</span>
            <span class="footer-value">${escapeHtml(invoice.docuEntrega) || '-'}</span>
          </div>
          <div class="footer-row">
            <span class="footer-label">Nombre Recibe:</span>
            <span class="footer-value">${escapeHtml(invoice.receptor) || '-'}</span>
          </div>
          <div class="footer-row">
            <span class="footer-label">N° Documento:</span>
            <span class="footer-value">${escapeHtml(invoice.receptorDocu) || '-'}</span>
          </div>
          <div class="footer-row" style="margin-top: 8pt;">
            <span class="footer-label">Total en Letras:</span>
          </div>
          <div class="total-words">${escapeHtml(totalInWords)}</div>
        </div>
      </div>
      <div class="footer-half footer-right">
        <div class="half-header">RESUMEN</div>
        <div class="footer-content">
          <table class="resumen-table">
            <tbody>
              ${summaryHTML}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="app-footer">
      <a href="http://www.facturasimples.pro" class="app-footer-link"><svg viewBox="0 0 32 32" width="10" height="13" style="vertical-align:middle;margin-right:4pt;"><rect width="32" height="32" rx="6" fill="#059669"/><path d="M8 10h16M8 16h12M8 22h8" stroke="white" stroke-width="2.5" stroke-linecap="round"/></svg>Facturas Simples</a>
      <a href="http://www.facturasimples.pro" class="app-footer-link app-footer-url">facturasimples.pro</a>
    </div>
  </div>
</body>
</html>`;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Devuelve el nombre en español del tipo de documento.
   * Usa los valores del enum InvoiceType del Desktop (Factura=0, CCF=1, etc.)
   */
  private static getDocumentTypeString(invoiceType: InvoiceType): string {
    const mapping: Record<InvoiceType, string> = {
      [InvoiceType.Factura]: 'FACTURA',
      [InvoiceType.CCF]: 'COMPROBANTE DE CRÉDITO FISCAL',
      [InvoiceType.NotaCredito]: 'NOTA DE CRÉDITO',
      [InvoiceType.SujetoExcluido]: 'SUJETO EXCLUIDO',
      [InvoiceType.NotaDebito]: 'NOTA DE DÉBITO',
      [InvoiceType.NotaRemision]: 'NOTA DE REMISIÓN',
      [InvoiceType.ComprobanteLiquidacion]: 'COMPROBANTE DE LIQUIDACIÓN',
      [InvoiceType.FacturaExportacion]: 'FACTURA DE EXPORTACIÓN',
      [InvoiceType.ComprobanteRetencion]: 'COMPROBANTE DE RETENCIÓN',
      [InvoiceType.DocumentoContableLiquidacion]: 'DOC. CONTABLE DE LIQUIDACIÓN',
      [InvoiceType.ComprobanteDonacion]: 'COMPROBANTE DE DONACIÓN',
      [InvoiceType.EventoOperacionesEspeciales]: 'EVENTO DE OPERACIONES ESPECIALES',
      [InvoiceType.EventoRetorno]: 'EVENTO DE RETORNO',
    };
    return mapping[invoiceType] ?? 'DOCUMENTO TRIBUTARIO ELECTRÓNICO';
  }

  private static getSchemaVersion(invoice: Invoice): number {
    const mapping: Record<string, number> = {
      '01': 2,
      '03': 4,
      '04': 4,
      '05': 4,
      '06': 4,
      '07': 2,
      '08': 2,
      '09': 2,
      '11': 3,
      '14': 2,
      '15': 2,
      '17': 1,
      '18': 1,
    };
    return mapping[invoice.documentType] ?? (invoice.invoiceType === InvoiceType.CCF ? 4 : 2);
  }

  /** iOS SplitText(text, maxLength) — truncates + wraps at maxLength chars. */
  private static splitText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...<br/>' + text.substring(maxLength);
  }

  /**
   * Mirrors iOS `numberToWords` (NumberFormatter spellOut locale es_SV:
   * "… DÓLARES Y … CENTAVOS") with the 60-char SplitText wrap that iOS
   * applies at the end. See amountToWordsEs.
   */
  private static numberToWords(amount: number): string {
    const result = amountToWordsEs(amount);
    // iOS SplitText(result, 60) inserts a line break at 60 chars.
    if (result.length > 60) {
      return result.substring(0, 60) + '...\n' + result.substring(60);
    }
    return result;
  }
}

// ── Monto en letras ─────────────────────────────────────────────────────────

const WORD_UNITS = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
const WORD_TEENS = ['DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE'];
const WORD_TENS = ['', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
// 21-29 are a single word, with written accents (veintidós, veintitrés, veintiséis).
const WORD_TWENTIES = ['VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
const WORD_HUNDREDS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

/** 0–99; `apocope` gives "UN" / "VEINTIÚN" / "TREINTA Y UN" before MIL / MILLONES. */
function wordsUnder100(n: number, apocope: boolean): string {
  if (n <= 0) return '';
  if (n < 10) return n === 1 && apocope ? 'UN' : WORD_UNITS[n];
  if (n < 20) return WORD_TEENS[n - 10];
  if (n < 30) {
    if (n === 20) return 'VEINTE';
    if (n === 21 && apocope) return 'VEINTIÚN';
    return WORD_TWENTIES[n - 21];
  }
  const t = Math.floor(n / 10);
  const u = n % 10;
  if (u === 0) return WORD_TENS[t];
  return `${WORD_TENS[t]} Y ${u === 1 && apocope ? 'UN' : WORD_UNITS[u]}`;
}

function wordsUnder1000(n: number, apocope: boolean): string {
  if (n <= 0) return '';
  if (n === 100) return 'CIEN';
  const h = Math.floor(n / 100);
  return [h > 0 ? WORD_HUNDREDS[h] : '', wordsUnder100(n % 100, apocope)].filter(Boolean).join(' ');
}

function integerToWordsEs(value: number): string {
  const n = Math.floor(Math.max(0, value));
  if (n === 0) return 'CERO';
  const parts: string[] = [];
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  if (millions > 0) {
    parts.push(millions === 1 ? 'UN MILLÓN' : `${integerToWordsEsUnderMillionApocope(millions)} MILLONES`);
  }
  if (thousands > 0) parts.push(thousands === 1 ? 'MIL' : `${wordsUnder1000(thousands, true)} MIL`);
  if (rest > 0) parts.push(wordsUnder1000(rest, false));
  return parts.join(' ');
}

/** Multiplier of MILLONES (may itself contain MIL: "DOS MIL MILLONES"). */
function integerToWordsEsUnderMillionApocope(n: number): string {
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (thousands > 0) parts.push(thousands === 1 ? 'MIL' : `${wordsUnder1000(thousands, true)} MIL`);
  if (rest > 0) parts.push(wordsUnder1000(rest, true));
  return parts.join(' ');
}

/**
 * Amount in Spanish words, iOS / ICU es_SV spellOut style:
 * 1234.56 → "MIL DOSCIENTOS TREINTA Y CUATRO DÓLARES Y CINCUENTA Y SEIS CENTAVOS",
 * 0.50 → "CERO DÓLARES Y CINCUENTA CENTAVOS". Cents come from the rounded total
 * cents (118.30 is 118.2999… in binary — truncating dropped a centavo).
 */
export function amountToWordsEs(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return 'CERO DÓLARES';
  const totalCents = Math.round(amount * 100);
  const integerPart = Math.floor(totalCents / 100);
  const cents = totalCents % 100;
  let words = `${integerToWordsEs(integerPart)} DÓLARES`;
  if (cents > 0) words += ` Y ${integerToWordsEs(cents)} CENTAVOS`;
  return words;
}

// ── Utilidad interna ────────────────────────────────────────────────────────

/**
 * Convierte un Uint8Array a una cadena base64.
 * Necesario para pasar el buffer PDF a través del IPC de Electron
 * usando encoding 'base64'.
 */
function uint8ArrayToBase64(buffer: Uint8Array): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
