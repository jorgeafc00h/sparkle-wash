// DTE Mapping Service - Mirrors Swift MHService.swift
// Handles invoice type-specific mapping with proper null handling for API compliance

import {
  DTE_Base,
  DTEIdentification,
  DTEEmisor,
  DTEReceptor,
  DTEBody,
  DTESummary,
  RelatedDocument,
  DTETribute,
  DTEAddress,
  DTEExtension,
  DTEPayment,
  DTE_InvalidationRequest,
  ContingenciaRequest,
  DTE_OperacionesEspecialesRequest,
  DTE_RetornoRequest,
  DTEOperacionesEspecialesBody,
  DTERetornoBody,
  DTERetornoDocumento,
  DTERetornoRelatedDocument,
} from '../../types/dte';
import { Invoice, InvoiceType, InvoiceDetail } from '../../types/invoice';
import {
  computeLine,
  sumLines,
  documentTotals,
  allocateCents,
  canInvoiceTaxCategory,
  roundMoney as roundMoneyShared,
  type ComputedLine,
} from '../../utils/invoiceTotals';
import { Company } from '../../types/company';
import { Customer, CustomerDocumentType, CustomerType } from '../../types/customer';
import { isDistritoValidForMunicipio } from '../catalog/distritoCatalog';

// IMPORTANT: API serialization note
// The remote DTE API requires certain optional fields to be present and serialized
// as null in the JSON payload (not omitted). To satisfy this, the mapping code
// intentionally assigns `undefined` or `null` to selected DTE properties such as
// `otrosDocumentos`, `extension`, `apendice`, and `ventaTercero` in specific
// DTE payloads. Do NOT change these assignments to omit the property or to a
// different value without first verifying the API contract. If the serializer
// behavior or API expectations change, update the mapping and add tests that
// assert the serialized JSON shape.

export enum DocumentType {
  FACTURA = "01",
  CCF = "03",
  NOTA_REMISION = "04",
  NOTA_CREDITO = "05",
  NOTA_DEBITO = "06",
  COMPROBANTE_RETENCION = "07",
  COMPROBANTE_LIQUIDACION = "08",
  DOCUMENTO_CONTABLE_LIQUIDACION = "09",
  FACTURA_EXPORTACION = "11",
  SUJETO_EXCLUIDO = "14",
  COMPROBANTE_DONACION = "15",
  EVENTO_OPERACIONES_ESPECIALES = "17",
  EVENTO_RETORNO = "18"
}

export const NORMATIVA_2_SCHEMA_VERSIONS: Record<string, number> = {
  // Latest Normativa DTE 2.0 schema versions used by direct MH envelopes.
  [DocumentType.FACTURA]: 2,
  [DocumentType.CCF]: 4,
  [DocumentType.NOTA_REMISION]: 4,
  [DocumentType.NOTA_CREDITO]: 4,
  [DocumentType.NOTA_DEBITO]: 4,
  [DocumentType.COMPROBANTE_RETENCION]: 2,
  [DocumentType.COMPROBANTE_LIQUIDACION]: 2,
  [DocumentType.DOCUMENTO_CONTABLE_LIQUIDACION]: 2,
  [DocumentType.FACTURA_EXPORTACION]: 3,
  [DocumentType.SUJETO_EXCLUIDO]: 2,
  [DocumentType.COMPROBANTE_DONACION]: 2,
  [DocumentType.EVENTO_OPERACIONES_ESPECIALES]: 1,
  [DocumentType.EVENTO_RETORNO]: 1,
  invalidacion: 3,
  contingencia: 4,
};

/** Invalidation "Fecha del Evento" may differ from the DTE's generation date only for FE, FEX and FSE. */
export const INVALIDATION_FREE_EVENT_DATE_TYPES: ReadonlySet<string> = new Set(['01', '11', '14']);

/** DTE types MH allows to be issued in contingency (Manual Funcional v2.0, Normativa 2.0 Anexo IV). */
export const CONTINGENCY_DTE_TYPES: ReadonlySet<string> = new Set(['01', '03', '04', '05', '06', '07', '11', '14']);

// Motivo for invalidation
export interface Motivo {
  codEstableMH?: string;
  codEstable?: string;
  codPuntoVentaMH?: string;
  codPuntoVenta?: string;
}

export interface OperacionesEspecialesEventInput {
  codigoGeneracion?: string;
  date?: string | Date;
  items: Array<Omit<DTEOperacionesEspecialesBody, 'numItem'>>;
  resumen?: Partial<DTE_OperacionesEspecialesRequest['resumen']>;
  apendice?: DTE_OperacionesEspecialesRequest['apendice'];
}

export interface RetornoEventInput {
  codigoGeneracion?: string;
  date?: string | Date;
  fusion?: string | null;
  tipoContingencia?: number | null;
  motivoContin?: string | null;
  documentoRelacionado: DTERetornoRelatedDocument[];
  documento: DTERetornoDocumento | null;
  items: Array<Omit<DTERetornoBody, 'numItem'>>;
  resumen?: Partial<DTE_RetornoRequest['resumen']>;
  ventaTercero?: DTE_RetornoRequest['ventaTercero'];
  compraTercero?: DTE_RetornoRequest['compraTercero'];
  apendice?: DTE_RetornoRequest['apendice'];
}

export class DTEMappingService {
  private static getNormativa2Version(documentType: string): number {
    return NORMATIVA_2_SCHEMA_VERSIONS[documentType] ?? 1;
  }

  private static paymentCondition(invoice: Invoice): 1 | 2 | 3 {
    const value = Number(invoice.paymentCondition ?? 1);
    return value === 2 || value === 3 ? value : 1;
  }

  private static paymentTermCode(invoice: Invoice): string | null {
    return this.paymentCondition(invoice) === 1 ? null : invoice.paymentTermCode || '01';
  }

  private static paymentTermPeriod(invoice: Invoice): number | null {
    return this.paymentCondition(invoice) === 1 ? null : invoice.paymentTermPeriod || 30;
  }

  private static buildPayment(
    invoice: Invoice,
    codigo: string,
    amount: number,
    referencia: string | null = null,
  ): DTEPayment {
    return {
      codigo,
      montoPago: Math.round(amount * 100) / 100,
      referencia: referencia as any,
      plazo: this.paymentTermCode(invoice) as any,
      periodo: this.paymentTermPeriod(invoice) as any,
    };
  }

  private static toPositiveIntegerQuantity(quantity: number): number {
    const parsed = Number(quantity);
    return Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.trunc(parsed)) : 1;
  }

  /**
   * cuerpoDocumento sale buckets of one line (utils/invoiceTotals.computeLine —
   * the same per-line math the stored totals use).
   */
  private static saleBuckets(line: ComputedLine): { ventaNoSuj: number; ventaExenta: number; ventaGravada: number } {
    return {
      ventaNoSuj: line.bucket === 'noSuj' ? line.venta : 0,
      ventaExenta: line.bucket === 'exenta' ? line.venta : 0,
      ventaGravada: line.bucket === 'gravada' ? line.venta : 0,
    };
  }

  private static linesOf(invoice: Invoice): ComputedLine[] {
    return (invoice.items || []).map((detail) => computeLine(detail, invoice.invoiceType));
  }

  static getSchemaVersionForDocumentType(documentType: string): number {
    return this.getNormativa2Version(documentType);
  }

  static getSchemaVersionForInvoiceType(invoiceType: InvoiceType): number {
    return this.getNormativa2Version(this.getDocumentTypeFromInvoiceType(invoiceType));
  }

  // Helper to get customer full name
  private static getCustomerFullName(customer?: Customer): string {
    if (!customer) return "Unknown Customer";
    if (customer.name) return customer.name;
    return `${customer.firstName} ${customer.lastName}`.trim() || "Unknown Customer";
  }

  /**
   * Main mapping function that routes to specific mappers based on invoice type
   * Mirrors Swift MhClient.mapInvoice
   */
  static mapInvoice(invoice: Invoice, company: Company, environmentCode: string): DTE_Base {
    // Only FE/CCF/NC/ND/NR split lines into exenta / no sujeta (and FEX/FSE/CD
    // carry no IVA at all). Any other type would silently report an exempt
    // line as a 13% gravada sale — refuse instead of issuing a wrong DTE.
    const blocked = (invoice.items || []).find((item) => !canInvoiceTaxCategory(invoice.invoiceType, item.taxCategory));
    if (blocked) {
      throw new Error(
        `"${blocked.productName || 'Producto'}" es exento o no sujeto de IVA y este tipo de documento solo admite ventas gravadas.`,
      );
    }
    switch (invoice.invoiceType) {
      case InvoiceType.NotaCredito:
        return this.mapCreditNote(invoice, company, environmentCode);
      case InvoiceType.NotaDebito:
        return this.mapDebitNote(invoice, company, environmentCode);
      case InvoiceType.NotaRemision:
        return this.mapNotaRemision(invoice, company, environmentCode);
      case InvoiceType.ComprobanteRetencion:
        return this.mapComprobanteRetencion(invoice, company, environmentCode);
      case InvoiceType.ComprobanteLiquidacion:
        return this.mapComprobanteLiquidacion(invoice, company, environmentCode);
      case InvoiceType.DocumentoContableLiquidacion:
        return this.mapDocumentoContableLiquidacion(invoice, company, environmentCode);
      case InvoiceType.ComprobanteDonacion:
        return this.mapComprobanteDonacion(invoice, company, environmentCode);
      case InvoiceType.FacturaExportacion:
        return this.mapFacturaExportacion(invoice, company, environmentCode);
      case InvoiceType.SujetoExcluido:
        return this.mapSujetoExcluido(invoice, company, environmentCode);
      case InvoiceType.EventoOperacionesEspeciales:
        return this.mapInvoiceOperacionesEspecialesEvent(invoice, company, environmentCode) as unknown as DTE_Base;
      case InvoiceType.EventoRetorno:
        return this.mapInvoiceRetornoEvent(invoice, company, environmentCode) as unknown as DTE_Base;
      default:
        return this.mapStandardInvoice(invoice, company, environmentCode);
    }
  }

  private static mapInvoiceOperacionesEspecialesEvent(
    invoice: Invoice,
    company: Company,
    environmentCode: string,
  ): DTE_OperacionesEspecialesRequest {
    return this.mapOperacionesEspecialesEvent(company, environmentCode, {
      codigoGeneracion: invoice.generationCode,
      date: invoice.date,
      items: (invoice.items || []).map((item) => {
        const cantidad = this.toPositiveIntegerQuantity(item.quantity);
        const total = this.roundMoney(cantidad * item.unitPrice);
        return {
          codigoGeneracionRef: invoice.relatedGenerationCode || null,
          tipoDocumento: invoice.relatedDocumentType || '02',
          numDocumento: invoice.relatedDocumentNumber || null,
          fechaEmision: invoice.relatedDocumentDate ? this.formatDate(invoice.relatedDocumentDate) : null,
          cantidad,
          descripcion: item.productName,
          docDel: invoice.specialOperationDocFrom || null,
          docAl: invoice.specialOperationDocTo || null,
          precioUni: item.unitPrice,
          ventaNoSuj: 0,
          ventaExenta: 0,
          ventaGravada: total,
          tributos: null,
        };
      }),
    });
  }

  private static mapInvoiceRetornoEvent(
    invoice: Invoice,
    company: Company,
    environmentCode: string,
  ): DTE_RetornoRequest {
    const sourceGenerationCode = invoice.relatedGenerationCode;
    const sourceDocumentType = invoice.relatedDocumentType as DocumentType | undefined;
    const sourceDocumentDate = invoice.relatedDocumentDate;

    if (!sourceGenerationCode) {
      throw new Error('El Evento de Retorno requiere un DTE origen con código de generación MH.');
    }
    if (!sourceDocumentType || ![DocumentType.FACTURA, DocumentType.FACTURA_EXPORTACION, DocumentType.SUJETO_EXCLUIDO].includes(sourceDocumentType)) {
      throw new Error('El Evento de Retorno requiere un DTE origen tipo 01, 11 o 14.');
    }
    if (!sourceDocumentDate) {
      throw new Error('El Evento de Retorno requiere la fecha de emisión del DTE origen.');
    }

    const isSujetoExcluidoSource = sourceDocumentType === DocumentType.SUJETO_EXCLUIDO;
    const customer = invoice.customer;
    const documento: DTERetornoDocumento | null = customer
      ? {
          tipoDocumento: customer.nit ? '36' : customer.nationalId ? '13' : null,
          numDocumento: customer.nit || customer.nationalId || null,
          nombre: customer.businessName || this.getCustomerFullName(customer),
          codPais: null,
          nombrePais: null,
          telefono: customer.phone || null,
          correo: customer.email || null,
        }
      : null;

    return this.mapRetornoEvent(company, environmentCode, {
      codigoGeneracion: invoice.generationCode,
      date: invoice.date,
      documentoRelacionado: [
        {
          tipoDocumento: sourceDocumentType,
          codigoGeneracion: sourceGenerationCode,
          fechaEmision: this.formatDate(sourceDocumentDate),
        },
      ],
      documento,
      items: (invoice.items || []).map((item) => {
        const cantidad = this.toPositiveIntegerQuantity(item.quantity);
        const total = this.roundMoney(cantidad * item.unitPrice);
        return {
          tipoItem: 2,
          codigoGeneracion: sourceGenerationCode,
          cantidad,
          precioUni: item.unitPrice,
          descripcion: item.productName,
          codigo: item.productId || null,
          uniMedida: 99,
          montoDescu: 0,
          codTributo: null,
          ventaNoSuj: 0,
          ventaExenta: 0,
          ventaGravada: isSujetoExcluidoSource ? 0 : total,
          compra: isSujetoExcluidoSource ? total : 0,
          tributos: null,
          psv: 0,
          ivaItem: isSujetoExcluidoSource ? 0 : this.roundMoney(total - total / 1.13),
          noGravado: 0,
          seguro: 0,
          flete: 0,
          ivaRete: 0,
          reteRenta: 0,
        };
      }),
    });
  }

  /**
   * Maps standard invoice (Factura/CCF) - Mirrors Swift default mapping
   */
  private static mapStandardInvoice(invoice: Invoice, company: Company, environmentCode: string): DTE_Base {
    const isCCF = invoice.invoiceType === InvoiceType.CCF;
    const lines = this.linesOf(invoice);

    const items = (invoice.items || []).map((detail: InvoiceDetail, i): DTEBody => ({
      ...this.formatFromProductDetail(detail, lines[i], isCCF),
      numItem: i + 1,
    }));

    const emisor = this.mapEmisor(company);
    const resumen = this.mapResumen(invoice, lines, isCCF);
    const documentType = this.getDocumentTypeFromInvoiceType(invoice.invoiceType);
    const version = this.getNormativa2Version(documentType);

    const identificacion: DTEIdentification = {
      version,
      ambiente: environmentCode,
      tipoDte: documentType,
      numeroControl: invoice.controlNumber || invoice.invoiceNumber,
      codigoGeneracion: invoice.generationCode || '',
      ...this.transmissionMode(invoice),
      fecEmi: this.formatDate(invoice.date || new Date()),
      horEmi: this.generateTimeStringSV(this.emissionTimeFor(invoice)),
      tipoMoneda: "USD"
    };

    const receptor = this.mapReceptor(invoice, isCCF);

    const dte: DTE_Base = {
      identificacion,
      documentoRelacionado: null as any, // Must be null for standard invoices
      emisor,
      receptor,
      otrosDocumentos: null as any,  // Must be null in JSON (API schema required)
      ventaTercero: null as any,     // Must be null in JSON (API schema required)
      cuerpoDocumento: items,
      resumen,
      apendice: null as any,         // Must be null in JSON (API schema required)
    };

    return dte;
  }

  /**
   * Maps credit note - Mirrors Swift mapCreditNote
   * FIXED: Use formatFromProductDetail to get correct ivaItem/tributos based on isCCF
   */
  private static mapCreditNote(invoice: Invoice, company: Company, environmentCode: string): DTE_Base {
    // NC/ND always reference a CCF
    const isCCF = invoice.relatedInvoiceType === InvoiceType.CCF;

    // NC items: IVA-exclusive like the CCF parent — precioUni = price / 1.13 and
    // montoDescu = discount / 1.13, so cantidad × precioUni − montoDescu = venta.
    // (precioUni used to be derived from the post-discount amount while the
    // discount was ALSO sent: 2 × $50 − $10 → 2 × 39.825 − 8.85 = 70.80 vs 79.65.)
    const lines = this.linesOf(invoice);
    const ivaPerci = documentTotals(invoice).ivaPerci1 ?? 0;
    const items = this.mapNoteItems(invoice, lines, ivaPerci);

    const emisor = this.mapEmisorForCreditNote(company);
    const resumen = this.mapResumenForCreditNote(invoice, lines, isCCF, ivaPerci);
    const documentType = this.getDocumentTypeFromInvoiceType(invoice.invoiceType);

    const identificacion: DTEIdentification = {
      version: this.getNormativa2Version(documentType),
      ambiente: environmentCode,
      tipoDte: documentType,
      numeroControl: invoice.controlNumber || invoice.invoiceNumber,
      codigoGeneracion: invoice.generationCode || '',
      ...this.transmissionMode(invoice),
      fusion: null as any,
      fecEmi: this.formatDate(invoice.date || new Date()),
      horEmi: this.generateTimeStringSV(this.emissionTimeFor(invoice)),
      tipoMoneda: "USD"
    };

    const relatedDoc: RelatedDocument = {
      tipoDocumento: invoice.relatedDocumentType!,
      tipoGeneracion: 2,
      numeroDocumento: this.relatedDocumentNumberOf(invoice),
      fechaEmision: this.formatDate(invoice.relatedDocumentDate!),
    };

    const receptor = this.mapReceptorForCreditNote(invoice, isCCF);

    const dte: DTE_Base = {
      identificacion,
      documentoRelacionado: [relatedDoc],
      emisor,
      receptor,
      ventaTercero: null as any,
      cuerpoDocumento: items,
      resumen,
      apendice: null as any,
    } as any;

    return dte;
  }

  /**
   * cuerpoDocumento of a Nota de Crédito / Débito (IVA-exclusive, CCF parent shape).
   * `ivaPerci` (the note's 1% percepción, = resumen.ivaPerci) is split over the
   * gravado lines by base in whole cents, so Σ item.ivaPerci = resumen.ivaPerci.
   */
  private static mapNoteItems(invoice: Invoice, lines: ComputedLine[], ivaPerci = 0): DTEBody[] {
    const perciShares = allocateCents(ivaPerci, lines.map((line) => line.base));
    return (invoice.items || []).map((detail: InvoiceDetail, i): DTEBody => {
      const line = lines[i];
      const buckets = this.saleBuckets(line);
      return {
        numItem: i + 1,
        cantidad: line.cantidad,
        codigo: "1",
        codTributo: null,
        descripcion: detail.productName || "Unknown Product",
        precioUni: line.precioUni,
        uniMedida: 59,
        montoDescu: line.montoDescu,
        ...buckets,
        // MH: tributos null when the line has no ventaGravada (exento / no sujeto).
        tributos: buckets.ventaGravada > 0 ? ["20"] as any : null as any,
        tipoItem: 2,
        numeroDocumento: this.relatedDocumentNumberOf(invoice),
        noGravado: 0,
        ivaPerci: perciShares[i] ?? 0,
        totalIva: 0,
        ivaRete: 0,
      } as any;
    });
  }

  /**
   * Emisor for Nota de Crédito / Débito. MH forbids `codEstable` and
   * `codPuntoVenta` (and their MH-assigned variants) at this node — only the
   * business identity + address is accepted.
   */
  private static mapEmisorForCreditNote(company: Company): DTEEmisor {
    return {
      nit: this.formatNIT(company.nit) as string,
      nrc: company.nrc || '',
      nombre: company.nombre,
      codActividad: company.codActividad,
      descActividad: company.descActividad,
      nombreComercial: company.nombreComercial,
      direccion: this.mapCompanyAddress(company),
      telefono: this.formatPhoneNumber(company.telefono) || '',
      correo: company.correo,
    } as any;
  }

  /**
   * Maps sujeto excluido (tipoDte 14).
   *
   * Mirrors the Swift app's final JSON after DTE post-processing:
   * omit non-permitted root fields, use SE-specific resumen, and keep only
   * the allowed cuerpoDocumento/emisor keys.
   */
  private static mapSujetoExcluido(invoice: Invoice, company: Company, environmentCode: string): DTE_Base {
    // precioUni carries 8 decimals like every other DTE (it was rounded to 2:
    // 3 × $0.333 → precioUni 0.33 but compra 1.00); compra = cantidad × precioUni.
    const lines = this.linesOf(invoice);
    const items = (invoice.items || []).map((detail: InvoiceDetail, i): DTEBody => {
      const line = lines[i];
      return {
        numItem: i + 1,
        tipoItem: 2,
        cantidad: line.cantidad,
        codigo: null as any,
        uniMedida: 99,
        descripcion: detail.productName || "Unknown Product",
        precioUni: line.precioUni,
        montoDescu: 0,
        compra: line.venta,
      } as any;
    });

    const emisor: any = {
      nit: this.formatNIT(company.nit) || '',
      nrc: company.nrc || '',
      nombre: company.nombre,
      codActividad: company.codActividad,
      descActividad: company.descActividad,
      direccion: this.mapCompanyAddress(company),
      telefono: this.formatPhoneNumber(company.telefono) || '',
      correo: company.correo,
      codEstable: company.codEstable || null,
      codPuntoVenta: company.codPuntoVenta || null,
    } as any;

    // Same figures as the stored totals: reteRenta 10% only on FSE and only
    // when the invoice's stored option keeps it (applyRentaRetention, absent =
    // withheld; off for purchases of goods → reteRenta 0, totalPagar = total).
    const totalCompra = sumLines(lines).totalAmount;
    const reteRenta = documentTotals(invoice).reteRenta;
    const totalPagar = this.roundMoney(totalCompra - reteRenta);

    const resumen: DTESummary = {
      totalCompra: Math.round(totalCompra * 100) / 100,
      descu: 0 as any,
      totalDescu: 0,
      subTotal: Math.round(totalCompra * 100) / 100,
      reteRenta: Math.round(reteRenta * 100) / 100,
      totalPagar: Math.round(totalPagar * 100) / 100,
      totalLetras: this.numberToWords(totalPagar),
      condicionOperacion: this.paymentCondition(invoice),
      observaciones: null as any,
      pagos: [this.buildPayment(invoice, "99", totalPagar)],
    } as any;

    // Identificacion: tipoContingencia + motivoContin must be present as
    // null (MH rejects "Campo {x} es requerido en #/identificacion" when
    // omitted).
    const emissionDate = this.emissionTimeFor(invoice);
    const identificacion: DTEIdentification = {
      version: this.getNormativa2Version(DocumentType.SUJETO_EXCLUIDO),
      ambiente: environmentCode,
      tipoDte: DocumentType.SUJETO_EXCLUIDO,
      numeroControl: invoice.controlNumber || invoice.invoiceNumber,
      codigoGeneracion: invoice.generationCode || '',
      ...this.transmissionMode(invoice),
      fecEmi: this.formatDate(invoice.date || emissionDate),
      horEmi: this.generateTimeStringSV(emissionDate),
      tipoMoneda: "USD",
    };

    const customer = invoice.customer;

    const preferDui =
      customer?.documentType === CustomerDocumentType.DUI ||
      customer?.tipoDocumento === '13' ||
      customer?.customerType === CustomerType.Individual;
    const hasNit = !preferDui && !!(customer?.nit && customer.nit.replace(/\D/g, '').length > 0);
    const seDocType = hasNit ? "36" : "13";
    const numDoc = hasNit
      ? this.formatNIT(customer?.nit) || ''
      : this.formatNationalIdForSujetoExcluido(customer?.nationalId || '');

    const sujetoExcluido: any = {
      nombre: invoice.receptor || this.getCustomerFullName(customer) || 'Unknown Customer',
      codActividad: null,
      descActividad: null,
      direccion: this.mapCustomerAddress(customer),
      telefono: customer?.phone ?? null,
      correo: customer?.email ?? null,
      tipoDocumento: seDocType,
      numDocumento: numDoc,
    };

    const dte: DTE_Base = {
      identificacion,
      documentoRelacionado: undefined as any,
      emisor,
      receptor: sujetoExcluido,
      otrosDocumentos: undefined as any,
      ventaTercero: undefined as any,
      cuerpoDocumento: items,
      resumen,
      extension: undefined as any,
      apendice: null as any,
    } as any;

    return dte;
  }

  /**
   * Maps debit note - Mirrors Swift mapDebitNote
   */
  private static mapDebitNote(invoice: Invoice, company: Company, environmentCode: string): DTE_Base {
    const isCCF = invoice.relatedInvoiceType === InvoiceType.CCF;

    // ND items use IVA-EXCLUSIVE ventaGravada (referencing a CCF whose
    // totals are also IVA-exclusive). MH rejects 113 as ventaGravada when
    // the IVA portion is also being declared in tributos.
    const lines = this.linesOf(invoice);
    const ivaPerci = documentTotals(invoice).ivaPerci1 ?? 0;
    const items = this.mapNoteItems(invoice, lines, ivaPerci);

    const emisor = this.mapEmisorForCreditNote(company);
    const resumen = this.mapResumenForDebitNote(invoice, lines, isCCF, ivaPerci);
    const documentType = this.getDocumentTypeFromInvoiceType(invoice.invoiceType);

    const identificacion: DTEIdentification = {
      version: this.getNormativa2Version(documentType),
      ambiente: environmentCode,
      tipoDte: documentType,
      numeroControl: invoice.controlNumber || invoice.invoiceNumber,
      codigoGeneracion: invoice.generationCode || '',
      ...this.transmissionMode(invoice),
      fusion: null as any,
      fecEmi: this.formatDate(invoice.date || new Date()),
      horEmi: this.generateTimeStringSV(this.emissionTimeFor(invoice)),
      tipoMoneda: "USD"
    };

    const relatedDoc: RelatedDocument = {
      tipoDocumento: invoice.relatedDocumentType!,
      tipoGeneracion: 2,
      numeroDocumento: this.relatedDocumentNumberOf(invoice),
      fechaEmision: this.formatDate(invoice.relatedDocumentDate!),
    };

    const receptor = this.mapReceptorForCreditNote(invoice, isCCF);

    const dte: DTE_Base = {
      identificacion,
      documentoRelacionado: [relatedDoc],
      emisor,
      receptor,
      ventaTercero: null as any,
      cuerpoDocumento: items,
      resumen,
      apendice: null as any,
    } as any;

    return dte;
  }

  /**
   * Maps Nota Remision (tipoDte="04") - FIXED: Extension fields and resumen
   */
  private static mapNotaRemision(invoice: Invoice, company: Company, environmentCode: string): DTE_Base {
    // Mirrors Swift: isCCF = false (line 637)
    const isCCF = false;

    // NR items: NO ivaItem/psv/noGravado. IVA-exclusive like CCF: precioUni =
    // price / 1.13 and montoDescu = discount / 1.13 (the discount used to be
    // subtracted twice — once inside precioUni and again as montoDescu).
    const lines = this.linesOf(invoice);
    const items = (invoice.items || []).map((detail: InvoiceDetail, i): DTEBody => {
      const line = lines[i];
      const buckets = this.saleBuckets(line);
      return {
        numItem: i + 1,
        cantidad: line.cantidad,
        codigo: "1",
        codTributo: null,
        descripcion: detail.productName || "Unknown Product",
        precioUni: line.precioUni,
        uniMedida: 99,
        montoDescu: line.montoDescu,
        ...buckets,
        tributos: buckets.ventaGravada > 0 ? ["20"] as any : null as any,
        tipoItem: 2,
        numeroDocumento: this.relatedDocumentNumberOf(invoice),
      } as any;
    });

    const emisor = this.mapEmisor(company);
    const resumen = this.mapResumenForRemissionNote(invoice, lines, isCCF);
    const documentType = this.getDocumentTypeFromInvoiceType(invoice.invoiceType);

    const identificacion: DTEIdentification = {
      version: this.getNormativa2Version(documentType),
      ambiente: environmentCode,
      tipoDte: documentType,
      numeroControl: invoice.controlNumber || invoice.invoiceNumber,
      codigoGeneracion: invoice.generationCode || '',
      ...this.transmissionMode(invoice),
      fecEmi: this.formatDate(invoice.date || new Date()),
      horEmi: this.generateTimeStringSV(this.emissionTimeFor(invoice)),
      tipoMoneda: "USD"
    };

    const relatedDoc: RelatedDocument = {
      tipoDocumento: invoice.relatedDocumentType!,
      tipoGeneracion: 2,
      numeroDocumento: this.relatedDocumentNumberOf(invoice),
      fechaEmision: this.formatDate(invoice.relatedDocumentDate!)
    };

    const customer = invoice.customer;

    // NR receptor mirrors Swift `MHService.mapNotaRemision` (lines 700-719):
    //   isCompany = customer has both NRC + NIT AND parent doc is a CCF.
    //   isCompany → tipoDocumento "36" (NIT) + numDocumento = NIT digits.
    //   else      → tipoDocumento "13" (DUI) + numDocumento = formatted DUI.
    // Hardcoding "36" while passing a DUI-shaped numDocumento causes MH to
    // reject the document with "numDocumento no cumple el formato".
    const isCompany = !!(
      customer?.nrc &&
      customer?.nit &&
      invoice.relatedInvoiceType === InvoiceType.CCF
    );
    const fallbackToNit = !isCompany && !!customer?.nit && !(customer?.nationalId || '').trim();
    const tipoDocumento = isCompany || fallbackToNit ? "36" : "13";
    const numeroDocumento = isCompany || fallbackToNit
      ? this.formatNIT(customer?.nit) || ''
      : this.formatNationalIdDigits(customer?.nationalId || "");
    const receptor: DTEReceptor = {
      nombre: this.getCustomerFullName(customer) || invoice.receptor || "Unknown Customer",
      nombreComercial: isCompany ? (customer!.businessName ?? null as any) : (null as any),
      codActividad: customer?.codActividad ?? null as any,
      descActividad: customer?.descActividad ?? null as any,
      nrc: isCompany ? customer!.nrc : (null as any),
      direccion: this.mapCustomerAddress(customer),
      telefono: customer?.phone,
      correo: customer?.email,
      tipoDocumento,
      numDocumento: numeroDocumento,
      nit: undefined as any,
      bienTitulo: "01"
    } as any;

    // FIXED: Use correct fields per Swift (lines 703-709)
    const extensionObj: DTEExtension = {
      nombEntrega: invoice.nombEntrega,
      docuEntrega: invoice.docuEntrega,
      nombRecibe: invoice.receptor, // FIXED: Use receptor, not nombEntrega
      docuRecibe: invoice.receptorDocu, // FIXED: Use receptorDocu, not docuEntrega
      observaciones: invoice.observaciones
    };

    const dte: DTE_Base = {
      identificacion,
      documentoRelacionado: [relatedDoc],
      emisor,
      receptor,
      ventaTercero: null as any,
      cuerpoDocumento: items,
      resumen,
      extension: undefined as any,
      apendice: null as any,
    } as any;

    return dte;
  }

  /**
   * Maps comprobante liquidacion - FIXED: Complete rewrite to match Swift
   */
  private static mapComprobanteLiquidacion(invoice: Invoice, company: Company, environmentCode: string): DTE_Base {
    let index = 1;
    const isCCF = invoice.relatedInvoiceType === InvoiceType.CCF;

    // FIXED: Mirrors Swift lines 770-800
    const items = (invoice.items || []).map((detail: InvoiceDetail): DTEBody => {
      const productTotal = Math.round(detail.quantity * detail.unitPrice * 100) / 100;
      const tax = Math.round((productTotal - productTotal / 1.13) * 100) / 100;
      // CL items: NO `descripcion` (forbidden); `exportaciones` + `obsItem`
      // are required.
      return {
        numItem: index++,
        tipoDte: invoice.relatedDocumentType ?? "03",
        numeroDocumento: this.relatedDocumentNumberOf(invoice),
        fechaEmision: this.formatDate(invoice.relatedDocumentDate || new Date()),
        tipoGeneracion: 1,
        ventaGravada: Math.round((productTotal - tax) * 100) / 100,
        ivaItem: tax,
        ventaNoSuj: 0,
        ventaExenta: 0,
        exportaciones: 0,
        tributos: ["20"] as any,
        observaciones: detail.obsItem || (detail.productName || "Servicio"),
      } as any;
    });

    const emisor = this.mapEmisor(company);
    const resumen = this.mapResumenForComprobanteLiquidacion(invoice, items, isCCF);

    const identificacion: DTEIdentification = {
      version: this.getNormativa2Version(DocumentType.COMPROBANTE_LIQUIDACION),
      ambiente: environmentCode,
      tipoDte: DocumentType.COMPROBANTE_LIQUIDACION,
      numeroControl: invoice.controlNumber || invoice.invoiceNumber,
      codigoGeneracion: invoice.generationCode || '',
      tipoModelo: 1,
      tipoOperacion: 1,
      fusion: null,
      // CL identificacion: tipoContingencia/motivoContin NOT permitted.
      fecEmi: this.formatDate(invoice.date || new Date()),
      horEmi: this.generateTimeStringSV(this.emissionTimeFor(invoice)),
      tipoMoneda: "USD",
    } as any;

    const customer = invoice.customer;
    const ccfNit = customer?.nit ?? '';
    const receptor: DTEReceptor = {
      tipoDocumento: ccfNit ? "36" : "13",
      numDocumento: ccfNit
        ? this.formatNIT(ccfNit) || ''
        : this.formatNationalIdDigits(customer?.nationalId || ''),
      codDomiciliado: 1,
      nrc: customer?.nrc ?? null as any,
      nombre: this.getCustomerFullName(customer) || "Unknown Customer",
      nombreComercial: customer?.businessName ?? null as any,
      codActividad: customer?.codActividad ?? null as any,
      descActividad: customer?.descActividad ?? null as any,
      direccion: this.mapCustomerAddress(customer),
      telefono: customer?.phone,
      correo: customer?.email,
    } as any;

    const dte: DTE_Base = {
      identificacion,
      emisor,
      receptor,
      cuerpoDocumento: items,
      resumen,
      apendice: null as any,
    } as any;

    return dte;
  }

  /**
   * Maps Comprobante de Retención (tipoDte 07)
   * Schema: cuerpoDocumento array with codigoRetencionMH, ivaRetenido, montoSujetoGrav per item
   * Resumen: totalSujetoRetencion, totalIVAretenido, totalIVAretenidoLetras
   * API endpoint: POST /api/document/dte/cr/sync
   */
  private static mapComprobanteRetencion(invoice: Invoice, company: Company, environmentCode: string): DTE_Base {
    let index = 1;

    // Map each invoice item to a retención body item
    const items = (invoice.items || []).map((detail: InvoiceDetail) => {
      const productTotal = Math.round((detail.quantity * detail.unitPrice) * 100) / 100;
      const tax = Math.round((productTotal - productTotal / 1.13) * 100) / 100;
      const taxableAmount = Math.round((productTotal - tax) * 100) / 100;
      // IVA retenido 1% = retention rate per MH CAT-006 code 22 (retención
      // del IVA 1%).
      const ivaRetenido = Math.round(taxableAmount * 0.01 * 100) / 100;

      const hasElectronicParent =
        !!invoice.relatedDocumentNumber &&
        /^[0-9a-fA-F-]{36}$/.test(invoice.relatedDocumentNumber);

      return {
        numItem: index++,
        tipoDte: "03",
        tipoGeneracion: hasElectronicParent ? 2 : 1,
        // MH's ComprobanteRetencion schema names this field `numeroDocumento`
        // in cuerpoDocumento (unlike identificacion/receptor, which use
        // `numDocumento`) — sending the wrong name rejects with "Campo
        // numeroDocumento es requerido" + "Campo numDocumento no esta permitido".
        numeroDocumento: this.relatedDocumentNumberOf(invoice) || `DOC-${index}`,
        fechaEmision: this.formatDate(invoice.relatedDocumentDate || new Date()),
        montoSujetoGrav: taxableAmount,
        codigoRetencionMH: "22",
        ivaRetenido,
        descripcion: detail.productName || "Retención",
      };
    });

    const totalSujetoRetencion = items.reduce((sum: number, item: any) => sum + item.montoSujetoGrav, 0);
    const totalIVAretenido = items.reduce((sum: number, item: any) => sum + item.ivaRetenido, 0);

    const emisor: any = {
      nit: this.formatNIT(company.nit),
      nrc: company.nrc || '',
      nombre: company.nombre,
      codActividad: company.codActividad,
      descActividad: company.descActividad,
      nombreComercial: company.nombreComercial,
      direccion: this.mapCompanyAddress(company),
      telefono: this.formatPhoneNumber(company.telefono) || '',
      correo: company.correo,
      codEstable: company.codEstable || null,
      codPuntoVenta: company.codPuntoVenta || null,
    };

    const identificacion: DTEIdentification = {
      version: this.getNormativa2Version(DocumentType.COMPROBANTE_RETENCION),
      ambiente: environmentCode,
      tipoDte: DocumentType.COMPROBANTE_RETENCION,
      numeroControl: invoice.controlNumber || invoice.invoiceNumber,
      codigoGeneracion: invoice.generationCode || '',
      ...this.transmissionMode(invoice),
      fecEmi: this.formatDate(invoice.date || new Date()),
      horEmi: this.generateTimeStringSV(this.emissionTimeFor(invoice)),
      tipoMoneda: "USD",
    };

    const customer = invoice.customer;
    const receptor: DTEReceptor = {
      tipoDocumento: customer?.nit ? "36" : "13",
      numDocumento: this.formatNIT(customer?.nit) ?? this.formatNationalIdDigits(customer?.nationalId || ""),
      nrc: customer?.nrc || null as any,
      nombre: this.getCustomerFullName(customer) || "Unknown Customer",
      codActividad: customer?.codActividad || "00000",
      descActividad: customer?.descActividad || "Actividad económica",
      nombreComercial: customer?.businessName || null as any,
      direccion: this.mapCustomerAddress(customer),
      telefono: customer?.phone || null as any,
      correo: customer?.email || null as any,
    };

    const resumen = {
      totalSujetoRetencion: Math.round(totalSujetoRetencion * 100) / 100,
      totalIva: 0,
      totalIvaRetenido: Math.round(totalIVAretenido * 100) / 100,
      totalLetras: this.numberToWords(totalIVAretenido),
      observaciones: null,
    };

    return {
      identificacion,
      emisor,
      receptor,
      cuerpoDocumento: items as any,
      resumen: resumen as any,
      apendice: null as any,
    } as any;
  }

  /**
   * Maps Documento Contable de Liquidación (tipoDte 09)
   * IMPORTANT: cuerpoDocumento is a SINGLE OBJECT, not an array.
   * Schema fields: periodoLiquidacionFechaInicio, periodoLiquidacionFechaFin,
   *   valorOperaciones, subTotal, iva, montoSujetoPercepcion, ivaPercibido,
   *   comision, porcentComision, ivaComision, liquidoApagar, totalLetras, etc.
   * API endpoint: POST /api/document/dte/dcl/sync
   */
  private static mapDocumentoContableLiquidacion(invoice: Invoice, company: Company, environmentCode: string): DTE_Base {
    const calculations = documentTotals(invoice);
    const totalOperaciones = Math.round(calculations.totalAmount * 100) / 100;
    // DCL: montoSujetoPercepcion = pre-IVA amount, derives from valorOperaciones.
    // subTotal = totalOperaciones (gross). iva = totalOperaciones * 0.13/1.13.
    const subTotal = totalOperaciones;
    const iva = Math.round((totalOperaciones - totalOperaciones / 1.13) * 100) / 100;
    const __preIva = Math.round((totalOperaciones - iva) * 100) / 100;
    // 2% IVA percibido on the taxable amount
    const montoSujetoPercepcion = __preIva;
    const ivaPercibido = Math.round(montoSujetoPercepcion * 0.02 * 100) / 100;
    // 10% commission
    const comision = Math.round(totalOperaciones * 0.10 * 100) / 100;
    const ivaComision = Math.round(comision * 0.13 * 100) / 100;
    const liquidoApagar = Math.round((totalOperaciones - comision - ivaComision - ivaPercibido) * 100) / 100;

    // DCL emisor uses the same codEstable/codPuntoVenta field names as every
    // other DTE type. A prior comment here claimed MH wanted `codigo`/
    // `puntoVenta` instead — the real MH schema rejects that verbatim
    // ("Campo codEstable es requerido en #/emisor" + "Campo codigo no esta
    // permitido en #/emisor"), confirmed against the real MH test endpoint.
    const emisor: any = {
      nit: this.formatNIT(company.nit),
      nrc: company.nrc || '',
      nombre: company.nombre,
      codActividad: company.codActividad,
      descActividad: company.descActividad,
      nombreComercial: company.nombreComercial,
      direccion: this.mapCompanyAddress(company),
      telefono: this.formatPhoneNumber(company.telefono) || '',
      correo: company.correo,
      codEstable: company.codEstable || null,
      codPuntoVenta: company.codPuntoVenta || null,
    };

    const identificacion: DTEIdentification = {
      version: this.getNormativa2Version(DocumentType.DOCUMENTO_CONTABLE_LIQUIDACION),
      ambiente: environmentCode,
      tipoDte: DocumentType.DOCUMENTO_CONTABLE_LIQUIDACION,
      numeroControl: invoice.controlNumber || invoice.invoiceNumber,
      codigoGeneracion: invoice.generationCode || '',
      tipoModelo: 1,
      tipoOperacion: 1,
      fecEmi: this.formatDate(invoice.date || new Date()),
      horEmi: this.generateTimeStringSV(this.emissionTimeFor(invoice)),
      tipoMoneda: "USD",
    } as any;

    const customer = invoice.customer;
    const receptor: any = {
      nit: this.formatNIT(customer?.nit),
      nrc: customer?.nrc || "",
      nombre: this.getCustomerFullName(customer) || "Unknown Customer",
      codActividad: customer?.codActividad || "00000",
      descActividad: customer?.descActividad || "Actividad económica",
      nombreComercial: customer?.businessName || null,
      tipoEstablecimiento: "01",
      direccion: this.mapCustomerAddress(customer),
      telefono: customer?.phone || null,
      correo: customer?.email || null,
    };

    // DCL cuerpoDocumento is a SINGLE OBJECT, not an array
    const cuerpoDocumento = {
      periodoLiquidacionFechaInicio: this.formatDateSV(
        invoice.relatedDocumentDate ? new Date(invoice.relatedDocumentDate) : new Date()
      ),
      periodoLiquidacionFechaFin: this.formatDateSV(new Date()),
      codLiquidacion: null,
      cantidadDoc: invoice.items?.length ?? 1,
      valorOperaciones: totalOperaciones,
      montoSinPercepcion: 0,
      descripSinPercepcion: null,
      subTotal,
      iva,
      montoSujetoPercepcion,
      ivaPercibido,
      comision,
      porcentComision: 10,
      ivaComision,
      liquidoApagar: Math.max(liquidoApagar, 0.01),
      totalLetras: this.numberToWords(Math.max(liquidoApagar, 0.01)),
      observaciones: invoice.observaciones || null,
    };

    const extension = {
      nombEntrega: invoice.nombEntrega || company.nombre,
      docuEntrega: invoice.docuEntrega || company.nit || "",
      codEmpleado: null,
    };

    return {
      identificacion,
      emisor,
      receptor,
      cuerpoDocumento: cuerpoDocumento as any, // Object, not array
      resumen: undefined as any,               // No resumen for DCL
      extension: extension as any,
      apendice: null as any,
    };
  }

  /**
   * Maps Comprobante de Donación (tipoDte 15)
   * Normativa 2.0 uses emisor/receptor roots, not the legacy
   * donatario/donante names.
   */
  private static mapComprobanteDonacion(invoice: Invoice, company: Company, environmentCode: string): DTE_Base {
    let index = 1;

    // CD items — MH rejects tipoItem/tributos here. Requires tipoDonacion.
    const items = (invoice.items || []).map((detail: InvoiceDetail) => {
      const valor = Math.round((detail.quantity * detail.unitPrice) * 100) / 100;
      return {
        numItem: index++,
        tipoDonacion: 1, // 1 = dineraria
        cantidad: detail.quantity,
        codigo: "1",
        uniMedida: 99,
        descripcion: detail.productName || "Donación",
        valorUni: Math.round(detail.unitPrice * 100) / 100,
        valor,
        tipoDepreciacion: 0,
      };
    });

    // valorTotal = Σ valor (the stored totalAmount could predate an edit).
    const valorTotal = this.roundMoney(items.reduce((sum, item) => sum + item.valor, 0));
    const emisor: any = {
      tipoDocumento: "36",
      numDocumento: this.formatNIT(company.nit),
      nrc: company.nrc || null,
      nombre: company.nombre,
      codActividad: company.codActividad,
      descActividad: company.descActividad,
      nombreComercial: company.nombreComercial,
      direccion: this.mapCompanyAddress(company),
      telefono: this.formatPhoneNumber(company.telefono) || null,
      correo: company.correo,
      codEstable: company.codEstable || null,
      codPuntoVenta: company.codPuntoVenta || null,
    };

    const identificacion: DTEIdentification = {
      version: this.getNormativa2Version(DocumentType.COMPROBANTE_DONACION),
      ambiente: environmentCode,
      tipoDte: DocumentType.COMPROBANTE_DONACION,
      numeroControl: invoice.controlNumber || invoice.invoiceNumber,
      codigoGeneracion: invoice.generationCode || '',
      tipoModelo: 1,
      tipoOperacion: 1,
      tipoContingencia: undefined,
      motivoContin: undefined,
      fecEmi: this.formatDate(invoice.date || new Date()),
      horEmi: this.generateTimeStringSV(this.emissionTimeFor(invoice)),
      tipoMoneda: "USD",
    };

    const customer = invoice.customer;
    const receptor: any = {
      tipoDocumento: customer?.nit ? "36" : "13",
      numDocumento: customer?.nit
        ? this.formatNIT(customer.nit)
        : this.formatNationalIdDigits(customer?.nationalId || ""),
      nrc: customer?.nrc || null,
      nombre: this.getCustomerFullName(customer) || "Unknown Donor",
      codActividad: customer?.codActividad || "45209",
      descActividad: customer?.descActividad || "Reparaciones de vehículos n.c.p.",
      direccion: this.mapCustomerAddress(customer),
      telefono: customer?.phone || null,
      correo: customer?.email || null,
      codDomiciliado: 1,
      codPais: (customer as any)?.codPais || "SV",
    };

    const resumen = {
      valorTotal,
      totalLetras: this.numberToWords(valorTotal),
      pagos: [{
        codigo: "01",
        montoPago: valorTotal,
        referencia: "donacion",
      }],
    };

    // CD: otrosDocumentos must be a valid array (minimum 1 entry) per schema.
    const dte: any = {
      identificacion,
      receptor,
      emisor,
      otrosDocumentos: [
        {
          codDocAsociado: 1,
          descDocumento: "Documento de donación",
          detalleDocumento: "Recibo interno de donación",
        },
      ],
      cuerpoDocumento: items,
      resumen,
      apendice: null,
    };
    return dte as DTE_Base;
  }

  /**
   * Maps factura exportacion - FIXED: Complete rewrite to match Swift
   */
  private static mapFacturaExportacion(invoice: Invoice, company: Company, environmentCode: string): DTE_Base {
    // FE schema items are export-specific: no psv/ivaItem and no local sale
    // buckets, but tipoItem/numeroDocumento/codTributo are required.
    const lines = this.linesOf(invoice);
    const items = (invoice.items || []).map((detail: InvoiceDetail, i): any => {
      const line = lines[i];
      return {
        numItem: i + 1,
        tipoItem: 2,
        numeroDocumento: null,
        cantidad: line.cantidad,
        codigo: null,
        codTributo: null,
        descripcion: detail.productName || "Unknown Product",
        precioUni: line.precioUni,
        montoDescu: 0,
        ventaGravada: line.venta,
        tributos: ["C3"],
        noGravado: 0,
        uniMedida: 99,
      };
    });

    // MH requires these keys present for FE. For service exports
    // (`tipoItemExpor=2`), recinto/regimen fields must be JSON null.
    const emisor: any = this.mapEmisor(company);
    emisor.tipoItemExpor = 2;
    emisor.recintoFiscal = null;
    emisor.tipoRegimen = null;
    emisor.regimen = null;

    // FIXED: Dedicated resumen for export invoices per Swift lines 1083-1117
    // Built from the mapped items (0% IVA — the stored totals carry no IVA either).
    const total = sumLines(lines).totalAmount;
    const totalLabel = this.numberToWords(total);

    // FE resumen follows fe-fex-v3 exactly; additionalProperties=false.
    const resumen: any = {
      totalGravada: total,
      descuGravada: 0.0,
      porcentajeDescuento: 0.0,
      totalDescu: 0.0,
      seguro: 0.0,
      flete: 0.0,
      tributos: [{
        codigo: "C3",
        descripcion: "Impuesto al Valor Agregado (exportaciones) 0%",
        valor: 0,
      }],
      montoTotalOperacion: total,
      totalNoGravado: 0,
      totalNoOnerosas: 0,
      totalPagar: total,
      totalLetras: totalLabel,
      saldoFavor: 0,
      condicionOperacion: this.paymentCondition(invoice),
      pagos: [this.buildPayment(invoice, "05", total, "")],
      codIncoterms: null,
      descIncoterms: null,
      numPagoElectronico: null,
      observaciones: null,
    };

    const identificacion: any = {
      version: this.getNormativa2Version(DocumentType.FACTURA_EXPORTACION),
      ambiente: environmentCode,
      tipoDte: DocumentType.FACTURA_EXPORTACION,
      numeroControl: invoice.controlNumber || invoice.invoiceNumber,
      codigoGeneracion: invoice.generationCode || '',
      ...this.transmissionMode(invoice),
      fecEmi: this.formatDate(invoice.date || new Date()),
      horEmi: this.generateTimeStringSV(this.emissionTimeFor(invoice)),
      tipoMoneda: "USD",
    };

    const customer = invoice.customer;

    // Mirrors Swift logic (lines 1140-1167)
    const documentNumber = customer?.tipoDocumento === "36" ? customer?.nit :
                          customer?.tipoDocumento === "13" ?
                          this.formatNationalIdDigits(customer?.nationalId || "") :
                          customer?.nationalId;

    // FE receptor per Swift MHService.mapFacturaExportacion lines 1171-1188:
    //   - NO `direccion` object (address goes in `complemento` field at the
    //     receptor root level).
    //   - codPais / nombrePais / tipoPersona required.
    //   - descActividad required (non-null), codActividad absent.
    const receptor: any = {
      nombre: this.getCustomerFullName(customer) || "International Customer",
      nombreComercial: customer?.businessName ?? null,
      descActividad: customer?.descActividad || "Servicios de exportación",
      telefono: customer?.phone ?? null,
      correo: customer?.email ?? null,
      tipoDocumento: (customer as any)?.tipoDocumento || "37",
      numDocumento: documentNumber || "000000000",
      codPais: (customer as any)?.codPais || "US",
      nombrePais: (customer as any)?.nombrePais || "Estados Unidos",
      tipoPersona: parseInt((customer as any)?.tipoPersona || "1", 10),
      complemento: customer?.address || "Export address",
    };

    // FE: `extension` key must be absent (not null). Keep the others present
    // as null per MH schema.
    const dte: any = {
      identificacion,
      documentoRelacionado: null,
      otrosDocumentos: null,
      ventaTercero: null,
      compraTercero: null,
      emisor,
      receptor,
      cuerpoDocumento: items,
      resumen,
      apendice: null,
    };

    return dte as DTE_Base;
  }

  /**
   * Factura / CCF cuerpoDocumento item — Mirrors Swift formatFromProductDetail.
   * Amounts come from utils/invoiceTotals.computeLine (the stored totals use
   * the same function):
   *   - venta* = cantidad × precioUni − montoDescu, 2 decimals (MH item rule);
   *     the discount is deducted before the IVA split.
   *   - Factura: IVA-inclusive; ivaItem = venta − venta / 1.13 on gravado lines.
   *   - CCF: IVA-exclusive precioUni / montoDescu (price / 1.13, 8 decimals);
   *     IVA goes in resumen.tributos.
   *   - Exento / no sujeto lines carry no IVA: ventaExenta / ventaNoSuj,
   *     ivaItem 0 and tributos null.
   */
  private static formatFromProductDetail(
    detail: InvoiceDetail,
    line: ComputedLine,
    isCCF: boolean,
  ): Omit<DTEBody, 'numItem'> {
    const buckets = this.saleBuckets(line);

    // MH schema distinction: some fields want `null` when not applicable
    // (key must be present); others want the key fully absent.
    //   Factura: ivaItem present, tributos null, codTributo null, numeroDocumento null
    //   CCF:     ivaItem absent, tributos array (null without ventaGravada), numeroDocumento null
    return {
      ivaItem: isCCF ? undefined : line.iva,
      cantidad: line.cantidad,
      codigo: "1",
      // CCF: codTributo must be present as null (MH requires the key).
      // Factura: also null.
      codTributo: null as any,
      descripcion: detail.productName || "Unknown Product",
      // 8 decimals (MH multipleOf 1e-8): a 2-decimal pre-IVA price broke MH's
      // cantidad × precioUni − montoDescu = venta rule on large quantities
      // (1000 × $1.25 → 1110.00 vs 1106.19 — consolidated POS CCFs hit this).
      precioUni: line.precioUni,
      montoDescu: line.montoDescu,
      ventaGravada: buckets.ventaGravada,
      psv: 0,
      noGravado: 0,
      ventaNoSuj: buckets.ventaNoSuj,
      uniMedida: isCCF ? 59 : 99,
      // CCF: tributos carries the per-item IVA as an array of codes (no value);
      // MH requires null when the item has no ventaGravada.
      // Factura: tributos must be null (key present), IVA on ivaItem instead.
      tributos: isCCF && buckets.ventaGravada > 0 ? ["20"] as any : null as any,
      ventaExenta: buckets.ventaExenta,
      tipoItem: 2,
      // Both schemas require the key present as null.
      numeroDocumento: null as any,
    };
  }

  /**
   * Map emisor - Mirrors Swift mapEmisor
   */
  private static mapEmisor(company: Company): DTEEmisor {
    const codEstable = (company as any).codEstable || "";
    const codPuntoVenta = (company as any).codPuntoVenta || "";

    return {
      // MH expects emisor.nit as 14 digits without dashes — formatted forms
      // like "0614-140494-134-2" trip "excede el tamaño permitido" + "no
      // cumple el formato requerido". formatNIT strips non-digits.
      nit: this.formatNIT(company.nit) || '',
      nrc: company.nrc || '',
      nombre: company.nombre,
      codActividad: company.codActividad,
      descActividad: company.descActividad,
      nombreComercial: company.nombreComercial,
      direccion: this.mapCompanyAddress(company),
      telefono: this.formatPhoneNumber(company.telefono) || '',
      correo: company.correo,
      codEstable: codEstable || null,
      codPuntoVenta: codPuntoVenta || null,
    } as any;
  }

  /**
   * Map receptor - Mirrors Swift mapReceptor
   */
  private static mapReceptor(invoice: Invoice, isCCF: boolean): DTEReceptor {
    const customer = invoice.customer;
    const customerName = this.getCustomerFullName(customer) || invoice.receptor || "Unknown Customer";

    const nationalId = customer?.nationalId || "";
    const nit = customer?.nit || "";

    // Mirrors Swift logic (lines 146-151)
    const requiredNit = invoice.invoiceType === InvoiceType.Factura &&
      nit && (customer?.hasExportInvoiceSettings ?? false);

    const hasNationalId = nationalId.trim().length > 0;
    const tipoDoc = requiredNit ? "36" :
      invoice.invoiceType === InvoiceType.Factura && hasNationalId ? "13" : undefined;

    // MH schema asymmetry on Factura (tipoDte 01):
    //   nrc / codActividad / descActividad — key required, value null.
    //   nit / nombreComercial — key forbidden (must be absent, undefined).
    // On CCF all these are carried with real values.
    return {
      nrc: isCCF ? (customer?.nrc ?? null) : null,
      nombre: customerName,
      nombreComercial: isCCF ? (customer?.businessName ?? null) : undefined,
      codActividad: isCCF ? (customer?.codActividad ?? null) : null,
      descActividad: isCCF ? (customer?.descActividad ?? null) : null,
      direccion: this.mapCustomerAddress(customer),
      telefono: customer?.phone,
      correo: customer?.email,
      tipoDocumento: isCCF ? undefined : (tipoDoc ?? null),
      // CCF receptor carries `nit` + `nrc` only (no numDocumento). Factura
      // carries `numDocumento` + `tipoDocumento`.
      numDocumento: requiredNit ? this.formatNIT(nit) :
        isCCF ? undefined :
        hasNationalId ? this.formatNationalIdDigits(nationalId) : null,
      nit: isCCF ? this.formatNIT(nit) : undefined,
    } as any;
  }

  private static mapReceptorForCreditNote(invoice: Invoice, _isCCF: boolean): DTEReceptor {
    const customer = invoice.customer;
    const customerName = this.getCustomerFullName(customer) || invoice.receptor || "Unknown Customer";
    const hasNit = !!customer?.nit;

    // NC/ND v4 receptor uses tipoDocumento/numDocumento, not `nit`.
    return {
      tipoDocumento: hasNit ? "36" : "13",
      numDocumento: hasNit
        ? this.formatNIT(customer?.nit) || ''
        : this.formatNationalIdDigits(customer?.nationalId || ''),
      nrc: customer?.nrc ?? null as any,
      nombre: customerName,
      nombreComercial: customer?.businessName ?? null as any,
      codActividad: customer?.codActividad ?? null as any,
      descActividad: customer?.descActividad ?? null as any,
      direccion: this.mapCustomerAddress(customer),
      telefono: customer?.phone ?? null,
      correo: customer?.email ?? null,
    } as any;
  }

  /**
   * Sale totals of the mapped items, shared by the FE/CCF/NC/ND/NR resúmenes.
   * Everything is a sum of the item values actually sent, so MH's tallies
   * (Σ venta* = total*, Σ ivaItem = totalIva) hold exactly. Discounts are
   * per item only (montoDescu): the global descu* buckets and
   * porcentajeDescuento stay 0, subTotalVentas is the NET Σ venta* and
   * totalDescu = Σ montoDescu — the shape the iOS / RN apps send and MH accepts
   * (subTotalVentas used to be sent gross with descuGravada repeating the item
   * discounts, so totalDescu counted them twice).
   */
  private static saleResumen(lines: ComputedLine[], withIvaTributo: boolean, ivaPerci = 0) {
    const sums = sumLines(lines);
    const subTotalVentas = this.roundMoney(sums.totalNoSuj + sums.totalExenta + sums.totalGravada);
    const iva = sums.totalIva;
    return {
      // resumen.ivaPerci (CCF / NC / ND v4): the 1% percepción of the stored
      // totals (documentTotals → computeTotals.ivaPerci1), added to totalPagar.
      ivaPerci: this.roundMoney(ivaPerci),
      totalNoSuj: sums.totalNoSuj,
      totalExenta: sums.totalExenta,
      totalGravada: sums.totalGravada,
      subTotalVentas,
      totalDescu: sums.totalDescu,
      iva,
      // MH: no IVA tributo without gravada sales (all-exempt documents).
      tributos: withIvaTributo && sums.totalGravada > 0
        ? [{ codigo: "20", descripcion: "Impuesto al Valor Agregado 13%", valor: iva }]
        : null,
    };
  }

  /**
   * Map resumen - Mirrors Swift mapResumen (Factura / CCF)
   */
  private static mapResumen(invoice: Invoice, lines: ComputedLine[], isCCF: boolean): DTESummary {
    // Retention / percepción: ONE source — the stored invoice decides whether
    // the 1% applies (documentTotals), the amount is 1% of the same line base.
    // The DTE used to read the customer's CURRENT flag while taking the amount
    // from the stored totals, so a later change of the flag silently changed
    // the document.
    const docTotals = documentTotals(invoice);
    const ivaRete1 = docTotals.ivaRete1;
    // Percepción only exists on the CCF schema (FE-F-v2 has no ivaPerci).
    const sale = this.saleResumen(lines, isCCF, isCCF ? docTotals.ivaPerci1 ?? 0 : 0);
    // Factura amounts are IVA-inclusive (montoTotalOperacion = subTotal); CCF
    // adds the IVA tributo to the IVA-exclusive subTotal.
    const montoTotalOperacion = isCCF
      ? this.roundMoney(sale.subTotalVentas + sale.iva)
      : sale.subTotalVentas;
    // = stored totals.totalPagar: total + ivaPerci1 − ivaRete1.
    const totalPagar = this.roundMoney(montoTotalOperacion + sale.ivaPerci - ivaRete1);

    return {
      totalNoSuj: sale.totalNoSuj,
      totalExenta: sale.totalExenta,
      totalGravada: sale.totalGravada,
      subTotalVentas: sale.subTotalVentas,
      descuNoSuj: 0.0,
      descuExenta: 0.0,
      descuGravada: 0.0,
      porcentajeDescuento: 0.0,
      totalDescu: sale.totalDescu,
      // Resumen tributos: CCF carries the array; Factura sends null so the
      // key is present (required by MH schema) but empty of values — IVA is
      // already represented on each cuerpoDocumento item for Factura.
      tributos: isCCF ? sale.tributos as any : null as any,
      // subTotal = subTotalVentas − descuNoSuj − descuExenta − descuGravada.
      subTotal: sale.subTotalVentas,
      ivaRete: ivaRete1,
      montoTotalOperacion,
      totalNoGravado: 0,
      totalPagar,
      totalLetras: this.numberToWords(totalPagar),
      // CCF: totalIva must be ABSENT (IVA tracked via resumen.tributos).
      // Factura: totalIva required (= Σ ivaItem).
      totalIva: isCCF ? undefined : sale.iva,
      saldoFavor: 0.0,
      condicionOperacion: this.paymentCondition(invoice),
      pagos: [this.buildPayment(invoice, "01", totalPagar)] as any,
      numPagoElectronico: null as any,
      observaciones: null as any,
      // `ivaPerci` is required on CCF resumen. For Factura the key must be
      // absent because FE-F-v2 has additionalProperties=false.
      ivaPerci: isCCF ? sale.ivaPerci : undefined,
    } as any;
  }

  /**
   * Map resumen for credit note - FIXED: Match Swift field exclusions
   */
  private static mapResumenForCreditNote(_invoice: Invoice, lines: ComputedLine[], _isCCF: boolean, ivaPerci = 0): DTESummary {
    // NC totals derived from the mapped items in IVA-exclusive form (matches
    // the CCF parent). NC v4 forbids porcentajeDescuento / descu* per bucket.
    const sale = this.saleResumen(lines, true, ivaPerci);
    const total = this.roundMoney(sale.subTotalVentas + sale.iva);
    // = stored totals.totalPagar (the note's proportional percepción added).
    const totalPagar = this.roundMoney(total + sale.ivaPerci);

    return {
      totalNoSuj: sale.totalNoSuj,
      totalExenta: sale.totalExenta,
      totalGravada: sale.totalGravada,
      subTotalVentas: sale.subTotalVentas,
      totalDescu: sale.totalDescu,
      tributos: sale.tributos as any,
      montoTotalOperacion: total,
      ivaPerci: sale.ivaPerci,
      totalIva: 0,
      ivaRete: 0,
      totalNoGravado: 0,
      totalPagar,
      totalLetras: this.numberToWords(totalPagar),
      condicionOperacion: 1,
      observaciones: null as any,
      codigoRetencionMH: null,
      // NC: numPagoElectronico FORBIDDEN. ND: REQUIRED.
    } as any;
  }

  /**
   * Map resumen for debit note - Mirrors Swift mapResumenForDebitNote
   */
  private static mapResumenForDebitNote(_invoice: Invoice, lines: ComputedLine[], _isCCF: boolean, ivaPerci = 0): DTESummary {
    // ND figures are derived from the mapped items in IVA-exclusive form.
    const sale = this.saleResumen(lines, true, ivaPerci);
    const total = this.roundMoney(sale.subTotalVentas + sale.iva);
    // = stored totals.totalPagar (the note's proportional percepción added).
    const totalPagar = this.roundMoney(total + sale.ivaPerci);

    return {
      totalNoSuj: sale.totalNoSuj,
      totalExenta: sale.totalExenta,
      totalGravada: sale.totalGravada,
      subTotalVentas: sale.subTotalVentas,
      totalDescu: sale.totalDescu,
      tributos: sale.tributos as any,
      ivaPerci: sale.ivaPerci,
      totalIva: 0,
      ivaRete: 0,
      montoTotalOperacion: total,
      totalNoGravado: 0,
      totalPagar,
      totalLetras: this.numberToWords(totalPagar),
      numPagoElectronico: null as any,
      condicionOperacion: 1,
      observaciones: null as any,
      codigoRetencionMH: null,
    } as any;
  }

  /**
   * ADDED: Map resumen for remission note - Mirrors Swift mapResumenForRemissionNote
   */
  private static mapResumenForRemissionNote(invoice: Invoice, lines: ComputedLine[], _isCCF: boolean): DTESummary {
    // NR items are IVA-exclusive; totals are sums of the mapped items.
    const sale = this.saleResumen(lines, true);
    const total = this.roundMoney(sale.subTotalVentas + sale.iva);

    // NR resumen: tributos required (null without gravada), porcentajeDescuento required.
    return {
      totalNoSuj: sale.totalNoSuj,
      totalExenta: sale.totalExenta,
      totalGravada: sale.totalGravada,
      subTotalVentas: sale.subTotalVentas,
      descuNoSuj: 0.0,
      descuExenta: 0.0,
      descuGravada: 0.0,
      porcentajeDescuento: 0,
      totalDescu: sale.totalDescu,
      tributos: sale.tributos as any,
      subTotal: sale.subTotalVentas,
      montoTotalOperacion: total,
      totalLetras: this.numberToWords(total),
      observaciones: invoice.observaciones || null,
    } as any;
  }

  /**
   * ADDED: Map resumen for comprobante liquidacion - Mirrors Swift mapResumenForComprobanteLiquidacion
   */
  private static mapResumenForComprobanteLiquidacion(invoice: Invoice, _items: DTEBody[], _isCCF: boolean): DTESummary {
    const itemTotals = (invoice.items || []).map((d) => {
      const total = Math.round(d.quantity * d.unitPrice * 100) / 100;
      const tax = Math.round((total - total / 1.13) * 100) / 100;
      return { preIva: Math.round((total - tax) * 100) / 100, tax };
    });
    const totalGravada = Math.round(itemTotals.reduce((s, x) => s + x.preIva, 0) * 100) / 100;
    const totalIva = Math.round(itemTotals.reduce((s, x) => s + x.tax, 0) * 100) / 100;
    const total = Math.round((totalGravada + totalIva) * 100) / 100;
    const totalLabel = this.numberToWords(total);

    // CL resumen: REQUIRES total / totalExportacion / ivaPerci /
    // montoTotalOperacion / condicionOperacion. FORBIDS subTotal /
    // descuExenta / totalDescu / descuNoSuj / ivaRete1 / reteRenta.
    return {
      totalGravada,
      totalNoSuj: 0,
      totalExenta: 0,
      subTotalVentas: totalGravada,
      tributos: [
        { codigo: "20", descripcion: "Impuesto al Valor Agregado 13%", valor: totalIva },
      ],
      total,
      exportacion: 0,
      ivaPerci: 0,
      montoTotalOperacion: total,
      condicionOperacion: 1,
      totalLetras: totalLabel,
      observaciones: invoice.observaciones || null,
    } as any;
  }

  /**
   * Maps invalidation model - Mirrors Swift mapInvalidationModel exactly
   * Swift reference: FacturasSimples/Services/MHService.swift lines 389-434
   */
  static mapInvalidationModel(
    invoice: Invoice,
    company: Company,
    motivo: any,
    nombreEstablecimiento: string,
    environmentCode: string,
    replacementGenerationCode?: string | null
  ): DTE_InvalidationRequest {
    const _emisor = this.mapEmisor(company);

    const emisor = {
      nit: _emisor.nit,
      nombre: _emisor.nombre,
      codEstableMH: company.codEstableMH || 'M001',
      codEstable: company.codEstable || null,
      codPuntoVentaMH: company.codPuntoVentaMH || 'P001',
      codPuntoVenta: company.codPuntoVenta || null,
      telefono: _emisor.telefono,
      correo: _emisor.correo
    };

    const eventDate = new Date();
    // "Fecha del Evento" (Manual Funcional v2.0): for CCF, NR, NC, ND, CR, CL,
    // DCL, CD and events 17/18 it MUST equal the invalidated document's
    // generation date (CCF generated 29-03, transmitted 04-04 → 29-03); only
    // FE, FEX and FSE may use a later date (≤ 3 months).
    const eventDateMayDiffer = INVALIDATION_FREE_EVENT_DATE_TYPES.has(invoice.documentType);

    // Build identificacion for the latest invalidacion schema.
    const identificacion = {
      version: NORMATIVA_2_SCHEMA_VERSIONS.invalidacion,
      ambiente: environmentCode,
      codigoGeneracion: this.generateUUID(),
      fecEmi: eventDateMayDiffer ? this.formatDateSV(eventDate) : this.formatDate(invoice.date),
      horEmi: this.generateTimeStringSV(eventDate),
      fusion: null,
    };

    // Get customer document number (matches Swift lines 409-411)
    const customer = invoice.customer;
    const hasNit = !!customer?.nit;
    const useNit =
      invoice.invoiceType === InvoiceType.CCF ||
      (invoice.invoiceType === InvoiceType.Factura &&
        hasNit &&
        (((customer as any)?.hasInvoiceSettings ?? false) ||
          (customer?.hasExportInvoiceSettings ?? false)));
    const tipoDocumento = useNit ? "36" : "13";
    // Digits only — the same form the original DTE's receptor carried
    // (formatNIT); the raw NIT as typed may contain dashes.
    const docNumber = useNit
      ? this.formatNIT(customer?.nit) || ""
      : this.formatNationalIdDigits(customer?.nationalId || "");

    const normalizedReplacementCode = replacementGenerationCode?.trim().toUpperCase() || null;

    // Build documento with customer information (matches Swift lines 416-428)
    const documento = {
      tipoDte: invoice.documentType,
      codigoGeneracion: invoice.generationCode!,
      selloRecibido: invoice.receptionSeal!,
      numeroControl: invoice.controlNumber!,
      fecEmi: this.formatDate(invoice.date),
      codigoGeneracionR: normalizedReplacementCode,
      tipoDocumento: docNumber ? tipoDocumento : null,
      numDocumento: docNumber || null,
      nombre: this.getCustomerFullName(customer) || "Unknown Customer", // Customer name
      telefono: customer?.phone || null, // Customer phone
      correo: customer?.email || null // Customer email
    };

    // Return with separate motivo object (matches Swift lines 416-433)
    return {
      identificacion,
      emisor,
      documento,
      motivo
    };
  }

  /**
   * ADDED: Maps contingency request - Mirrors Swift mapContingenciaRequest
   */
  static mapContingenciaRequest(
    invoices: Invoice[],
    company: Company,
    environmentCode: string,
    startDate: Date,
    endDate: Date,
    contingencyType: number = 1,
    reason: string,
    nombreResponsable: string,
    duiResponsable: string
  ): ContingenciaRequest {
    let index = 1;

    const detalleDTE = invoices.map((invoice) => ({
      noItem: index++,
      codigoGeneracion: invoice.generationCode || "",
      tipoDoc: invoice.documentType,
    }));

    const identificacion = {
      version: NORMATIVA_2_SCHEMA_VERSIONS.contingencia,
      ambiente: environmentCode,
      codigoGeneracion: this.generateUUID(),
      fTransmision: this.formatDateSV(new Date()),
      hTransmision: this.generateTimeStringSV(new Date())
    };

    const emisor = {
      nit: this.formatNIT(company.nit) || "",
      nombre: company.nombreComercial || company.nombre,
      nombreResponsable,
      tipoDocResponsable: "13", // DUI document type code
      numeroDocResponsable: this.formatNationalIdDigits(duiResponsable),
      tipoEstablecimiento: company.tipoEstablecimiento,
      codEstableMH: company.codEstableMH || null,
      codPuntoVentaMH: company.codPuntoVentaMH || company.codPuntoVenta || null,
      telefono: company.telefono || "",
      correo: company.correo
    };

    const motivoObj = {
      fInicio: this.formatDateSV(startDate),
      fFin: this.formatDateSV(endDate),
      hInicio: this.generateTimeStringSV(startDate),
      hFin: this.generateTimeStringSV(endDate),
      tipoContingencia: contingencyType,
      motivoContingencia: reason,
    };

    return {
      identificacion,
      emisor,
      detalleDTE,
      motivo: motivoObj as any,
    };
  }

  static mapOperacionesEspecialesEvent(
    company: Company,
    environmentCode: string,
    input: OperacionesEspecialesEventInput,
  ): DTE_OperacionesEspecialesRequest {
    const eventDate = input.date ? new Date(input.date) : new Date();
    const items = input.items.map((item, index) => ({
      ...item,
      cantidad: this.toPositiveIntegerQuantity(item.cantidad),
      numItem: index + 1,
    }));
    const totalNoSuj = this.roundMoney(items.reduce((sum, item) => sum + (item.ventaNoSuj || 0), 0));
    const totalExenta = this.roundMoney(items.reduce((sum, item) => sum + (item.ventaExenta || 0), 0));
    const totalGravada = this.roundMoney(items.reduce((sum, item) => sum + (item.ventaGravada || 0), 0));
    const total = this.roundMoney(totalNoSuj + totalExenta + totalGravada);

    return {
      identificacion: {
        version: this.getNormativa2Version(DocumentType.EVENTO_OPERACIONES_ESPECIALES) as 1,
        ambiente: environmentCode,
        tipoModelo: 1,
        tipoOperacion: 1,
        tipoEvento: DocumentType.EVENTO_OPERACIONES_ESPECIALES,
        codigoGeneracion: input.codigoGeneracion || this.generateUUID(),
        fecEmi: this.formatDate(input.date || eventDate),
        horEmi: this.generateTimeStringSV(eventDate),
        tipoMoneda: 'USD',
      },
      emisor: {
        nit: this.formatNIT(company.nit) || '',
        nombre: company.nombre,
      },
      cuerpoDocumento: items,
      resumen: {
        totalNoSuj,
        totalExenta,
        totalGravada,
        subTotal: total,
        tributos: null,
        total,
        totalLetras: this.numberToWords(total),
        ...input.resumen,
      },
      apendice: input.apendice ?? null,
    };
  }

  static mapRetornoEvent(
    company: Company,
    environmentCode: string,
    input: RetornoEventInput,
  ): DTE_RetornoRequest {
    const eventDate = input.date ? new Date(input.date) : new Date();
    const items = input.items.map((item, index) => ({
      ...item,
      numItem: index + 1,
    }));
    const totalNoSuj = this.roundMoney(items.reduce((sum, item) => sum + (item.ventaNoSuj || 0), 0));
    const totalExenta = this.roundMoney(items.reduce((sum, item) => sum + (item.ventaExenta || 0), 0));
    const totalGravada = this.roundMoney(items.reduce((sum, item) => sum + (item.ventaGravada || 0), 0));
    const totalCompraExcluidos = this.roundMoney(items.reduce((sum, item) => sum + (item.compra || 0), 0));
    const totalSeguro = this.roundMoney(items.reduce((sum, item) => sum + (item.seguro || 0), 0));
    const totalFlete = this.roundMoney(items.reduce((sum, item) => sum + (item.flete || 0), 0));
    const totalNoGravado = this.roundMoney(items.reduce((sum, item) => sum + (item.noGravado || 0), 0));
    const totalIva = this.roundMoney(items.reduce((sum, item) => sum + (item.ivaItem || 0), 0));
    const ivaRete = this.roundMoney(items.reduce((sum, item) => sum + (item.ivaRete || 0), 0));
    const reteRenta = this.roundMoney(items.reduce((sum, item) => sum + (item.reteRenta || 0), 0));
    const montoTotalOperacion = this.roundMoney(
      totalNoSuj + totalExenta + totalGravada + totalCompraExcluidos + totalSeguro + totalFlete + totalNoGravado,
    );
    const totalPagar = this.roundMoney(montoTotalOperacion - ivaRete - reteRenta);

    return {
      identificacion: {
        version: this.getNormativa2Version(DocumentType.EVENTO_RETORNO) as 1,
        ambiente: environmentCode,
        tipoModelo: 1,
        tipoOperacion: 1,
        tipoEvento: DocumentType.EVENTO_RETORNO,
        tipoContingencia: input.tipoContingencia ?? null,
        motivoContin: input.motivoContin ?? null,
        codigoGeneracion: input.codigoGeneracion || this.generateUUID(),
        fecEmi: this.formatDate(input.date || eventDate),
        horEmi: this.generateTimeStringSV(eventDate),
        fusion: input.fusion ?? null,
        tipoMoneda: 'USD',
      },
      documentoRelacionado: input.documentoRelacionado,
      emisor: {
        nit: this.formatNIT(company.nit) || '',
        nombre: company.nombre,
        codEstableMH: company.codEstableMH || 'M001',
        codEstable: company.codEstable || null,
        codPuntoVentaMH: company.codPuntoVentaMH || 'P001',
        codPuntoVenta: company.codPuntoVenta || null,
        recintoFiscal: null,
        tipoRegimen: null,
        regimen: null,
        tipoItemExpor: 2,
      },
      documento: input.documento,
      ventaTercero: input.ventaTercero ?? null,
      compraTercero: input.compraTercero ?? null,
      cuerpoDocumento: items,
      resumen: {
        totalNoSuj,
        totalExenta,
        totalGravada,
        totalCompraExcluidos,
        subTotalVentas: this.roundMoney(totalNoSuj + totalExenta + totalGravada),
        tributos: null,
        totalSeguro,
        totalFlete,
        montoTotalOperacion,
        ivaRete,
        reteRenta,
        totalNoGravado,
        totalPagar,
        totalLetras: this.numberToWords(totalPagar),
        totalNoOnerosas: 0,
        totalIva,
        saldoFavor: 0,
        ...input.resumen,
      },
      apendice: input.apendice ?? null,
    };
  }

  // Utility methods
  private static getDocumentTypeFromInvoiceType(invoiceType: InvoiceType): string {
    const mapping = {
      [InvoiceType.Factura]: DocumentType.FACTURA,
      [InvoiceType.CCF]: DocumentType.CCF,
      [InvoiceType.NotaRemision]: DocumentType.NOTA_REMISION,
      [InvoiceType.NotaCredito]: DocumentType.NOTA_CREDITO,
      [InvoiceType.NotaDebito]: DocumentType.NOTA_DEBITO,
      [InvoiceType.ComprobanteRetencion]: DocumentType.COMPROBANTE_RETENCION,
      [InvoiceType.ComprobanteLiquidacion]: DocumentType.COMPROBANTE_LIQUIDACION,
      [InvoiceType.DocumentoContableLiquidacion]: DocumentType.DOCUMENTO_CONTABLE_LIQUIDACION,
      [InvoiceType.FacturaExportacion]: DocumentType.FACTURA_EXPORTACION,
      [InvoiceType.SujetoExcluido]: DocumentType.SUJETO_EXCLUIDO,
      [InvoiceType.ComprobanteDonacion]: DocumentType.COMPROBANTE_DONACION,
      [InvoiceType.EventoOperacionesEspeciales]: DocumentType.EVENTO_OPERACIONES_ESPECIALES,
      [InvoiceType.EventoRetorno]: DocumentType.EVENTO_RETORNO,
    };

    return mapping[invoiceType] || DocumentType.FACTURA;
  }

  private static getCompanyDistrictCode(company: Company): string {
    return this.resolveDistrictCode(
      company.departamentoCode,
      company.municipioCode,
      company.distritoCode,
      company.municipio,
    );
  }

  private static getCustomerDistrictCode(customer?: Customer): string {
    return this.resolveDistrictCode(
      customer?.departmentCode,
      customer?.municipalityCode,
      customer?.districtCode,
      customer?.municipality,
    );
  }

  /** True when a code is a real, user-provided value (not empty/whitespace). */
  private static hasExplicitCode(code?: string): boolean {
    return !!(code && code.trim());
  }

  private static formatDistrictCode(code?: string): string {
    const trimmed = (code || '').trim();
    if (/^\d$/.test(trimmed)) return trimmed.padStart(2, '0');
    return trimmed || '14';
  }

  private static formatMunicipioCode(code?: string): string {
    const trimmed = (code || '').trim();
    if (/^\d$/.test(trimmed)) return trimmed.padStart(2, '0');
    return trimmed || '14';
  }

  /**
   * True when `distritoCode` is a real CAT-008 district for the given
   * (departamento, municipio) pair. Zero-pads single-digit codes first —
   * `distritosScoped.json` stores 2-digit codes, but a captured code can be a
   * raw single digit (see `formatDistrictCode`/`formatMunicipioCode`), so an
   * un-padded comparison would reject an otherwise-valid pairing.
   */
  private static isDistritoActuallyValid(
    departamentoCode?: string,
    municipioCode?: string,
    distritoCode?: string,
  ): boolean {
    if (!distritoCode) return false;
    const pad = (code: string) => (/^\d$/.test(code) ? code.padStart(2, '0') : code);
    return isDistritoValidForMunicipio(
      departamentoCode,
      municipioCode ? pad(municipioCode.trim()) : municipioCode,
      pad(distritoCode.trim()),
    );
  }

  /**
   * Resolve the MH `direccion.distrito` code.
   *
   * PRIMARY PATH (Normativa 2.0): when the record carries an explicit
   * `distritoCode` — captured by the Distrito picker added to the customer /
   * company forms — it is used verbatim. This is the correct, non-guessing
   * path and the one that clears the
   * `[receptor.direccion.distrito] VALOR NO ES PERMITIDO` MH rejection.
   *
   * LEGACY / BEST-EFFORT SHIM (everything below the fast-path): kept ONLY to
   * produce *some* plausible value for un-migrated records saved before the
   * Distrito picker existed (they have departamento + municipio but no
   * distrito). These heuristic tables are provisional and are NOT an
   * authoritative MH mapping — do not extend them; the real fix is to have the
   * user re-select a distrito, or to bundle an authoritative MH-scoped CAT-008.
   */
  private static resolveDistrictCode(
    departamentoCode?: string,
    municipioCode?: string,
    distritoCode?: string,
    localityName?: string,
  ): string {
    // Only trust a captured distritoCode verbatim when it's a real CAT-008 district
    // for the stored (departamento, municipio) pair — see mapCompanyAddress for why
    // a non-empty-but-stale distritoCode (e.g. mirrored from an old CAT-013
    // municipio code) must NOT be trusted. An invalid pairing falls through to the
    // same legacy heuristic used for un-migrated records below.
    if (distritoCode && this.isDistritoActuallyValid(departamentoCode, municipioCode, distritoCode)) {
      return this.formatDistrictCode(distritoCode);
    }

    const normalizedName = (localityName || '')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toUpperCase();
    const looksLikeNormativa2Municipio = /\b(NORTE|CENTRO|SUR|ESTE|OESTE|COSTA)\b/.test(normalizedName);
    if (!looksLikeNormativa2Municipio) {
      return this.formatDistrictCode(municipioCode || '14');
    }

    const defaultDistrictByMunicipio: Record<string, string> = {
      '01:13': '03',
      '01:14': '01',
      '01:15': '08',
      '02:14': '07',
      '02:15': '10',
      '02:16': '04',
      '02:17': '03',
      '03:17': '05',
      '03:18': '15',
      '03:19': '01',
      '03:20': '11',
      '04:34': '05',
      '04:35': '01',
      '04:36': '02',
      '05:23': '17',
      '05:24': '03',
      '05:25': '18',
      '05:26': '01',
      '05:27': '05',
      '05:28': '11',
      '06:20': '02',
      '06:21': '09',
      '06:22': '17',
      '06:23': '14',
      '06:24': '21',
      '07:17': '02',
      '07:18': '01',
      '08:23': '16',
      '08:24': '03',
      '08:25': '05',
      '09:10': '02',
      '09:11': '01',
      '10:14': '03',
      '10:15': '01',
      '11:24': '03',
      '11:25': '01',
      '11:26': '10',
      '12:21': '07',
      '12:22': '17',
      '12:23': '04',
      '13:27': '01',
      '13:28': '08',
      '14:19': '01',
      '14:20': '03',
    };

    return this.formatDistrictCode(defaultDistrictByMunicipio[`${departamentoCode || ''}:${municipioCode || ''}`] || municipioCode || '14');
  }

  /**
   * LEGACY / BEST-EFFORT SHIM. Remaps old-style municipio codes stored by
   * pre-Normativa-2.0 records onto the new CAT-013 municipio codes. Only reached
   * for records WITHOUT an explicit distrito (see mapCompanyAddress /
   * mapCustomerAddress, which bypass this when the Distrito picker was used).
   * Not an authoritative MH mapping — provisional; do not extend.
   */
  private static normalizeMunicipioCode(
    departamentoCode?: string,
    municipioCode?: string,
    distritoCode?: string,
    localityName?: string,
  ): string {
    const key = `${departamentoCode || ''}:${distritoCode || ''}`;
    const normalizedName = (localityName || '')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toUpperCase();
    if (departamentoCode === '06' && distritoCode === '09' && normalizedName.includes('MEJICANOS')) {
      return '23';
    }
    const migrated: Record<string, string> = {
      // Normativa 2.0 separates municipio and distrito. These are the legacy
      // municipality values used by existing seeded records and early desktop
      // installs.
      '02:03': '17', // Chalchuapa -> Santa Ana Oeste
      '02:3': '17', // Chalchuapa legacy unpadded code -> Santa Ana Oeste
      '02:10': '15', // Santa Ana -> Santa Ana Centro
      '03:15': '18', // Sonsonate -> Sonsonate Centro
      '05:01': '26', // Antiguo Cuscatlan legacy code -> La Libertad Este
      '05:1': '26', // Antiguo Cuscatlan -> La Libertad Este
      '05:06': '26', // Antiguo Cuscatlan legacy code -> La Libertad Este
      '05:6': '26', // Huizucar/legacy Antiguo Cuscatlan -> La Libertad Este
      '05:10': '26', // Nuevo Cuscatlan -> La Libertad Este
      '05:11': '28', // Santa Tecla -> La Libertad Sur
      '06:05': '23', // Ciudad Delgado legacy code -> San Salvador Centro
      '06:5': '23', // El Paisnal legacy / Delgado legacy records -> San Salvador Centro
      '06:08': '23', // Mejicanos legacy padded code -> San Salvador Centro
      '06:8': '23', // Mejicanos -> San Salvador Centro
      '06:09': '21', // Nejapa -> San Salvador Oeste
      '06:13': '22', // San Martin / legacy Soyapango records -> San Salvador Este
      '06:14': '23', // San Salvador -> San Salvador Centro
      '06:17': '22', // Soyapango -> San Salvador Este
      '06:19': '23', // Ciudad Delgado -> San Salvador Centro
      '12:17': '22', // San Miguel -> San Miguel Centro
    };
    return migrated[key] || municipioCode || '14';
  }

  private static mapCompanyAddress(company: Company): DTEAddress {
    const distrito = this.getCompanyDistrictCode(company);
    // When the emisor carries an explicit distrito (selected in the Distrito
    // picker) we trust the departamento/municipio/distrito the user chose
    // verbatim. The legacy `normalizeMunicipioCode` remap only exists to repair
    // un-migrated records that lack a distrito, and running it over a
    // fully-specified address can wrongly rewrite the user's municipio.
    //
    // The distrito must ALSO be a real CAT-008 district for the stored
    // (departamento, municipio) pair — not just non-empty. A record can carry a
    // non-empty distritoCode that is stale/pre-migration (e.g. mirrored from the
    // old CAT-013 municipio code, as `TestDataGenerator`/seed fixtures did with
    // municipioCode: '14', distritoCode: '14' for San Salvador, where '14' was
    // never a valid Normativa 2.0 municipio). Trusting that verbatim sends MH an
    // internally-invalid triple ("[.../municipio] no cumple el formato
    // requerido"). Falling through to the legacy remap below fixes it exactly
    // like an un-migrated record.
    const explicit =
      this.hasExplicitCode(company.distritoCode) &&
      this.isDistritoActuallyValid(company.departamentoCode, company.municipioCode, company.distritoCode);
    return {
      departamento: company.departamentoCode || '06',
      municipio: explicit
        ? this.formatMunicipioCode(company.municipioCode)
        : this.normalizeMunicipioCode(
            company.departamentoCode,
            company.municipioCode,
            distrito,
            company.municipio,
          ),
      distrito,
      complemento: company.complemento || company.direccion || 'San Salvador',
    } as any;
  }

  private static mapCustomerAddress(customer?: Customer): DTEAddress {
    const distrito = this.getCustomerDistrictCode(customer);
    // See mapCompanyAddress: an explicit distrito means the receptor address was
    // fully captured by the Distrito picker, so skip the legacy municipio remap —
    // but only when it's a real CAT-008 district for the stored municipio.
    const explicit =
      this.hasExplicitCode(customer?.districtCode) &&
      this.isDistritoActuallyValid(customer?.departmentCode, customer?.municipalityCode, customer?.districtCode);
    return {
      departamento: customer?.departmentCode || '06',
      municipio: explicit
        ? this.formatMunicipioCode(customer?.municipalityCode)
        : this.normalizeMunicipioCode(
            customer?.departmentCode,
            customer?.municipalityCode,
            distrito,
            customer?.municipality,
          ),
      distrito,
      complemento: customer?.address || 'San Salvador',
    } as any;
  }

  /** The DTE's identificacion.fecEmi for an invoice (YYYY-MM-DD, El Salvador calendar date). */
  static emissionDateOf(invoice: Pick<Invoice, 'date'>): string {
    return this.formatDate(invoice.date || new Date());
  }

  private static formatDate(date: Date | string): string {
    if (typeof date === 'string') {
      const trimmed = date.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return trimmed;
      }

      const parsed = new Date(trimmed);
      if (!Number.isNaN(parsed.getTime())) {
        return this.formatDateSV(parsed);
      }

      return trimmed.slice(0, 10);
    }

    return this.formatDateSV(date);
  }

  private static emissionTimeFor(invoice: Invoice): Date {
    if (invoice.date && !/^\d{4}-\d{2}-\d{2}$/.test(invoice.date)) {
      const parsed = new Date(invoice.date);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    return new Date();
  }

  static formatDateSV(date: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/El_Salvador',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
    const m = parts.find((p) => p.type === 'month')?.value ?? '01';
    const d = parts.find((p) => p.type === 'day')?.value ?? '01';
    return `${y}-${m}-${d}`;
  }

  private static generateTimeString(date: Date): string {
    return date.toISOString().split('T')[1].substring(0, 8);
  }

  static generateTimeStringSV(date: Date): string {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/El_Salvador',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      hourCycle: 'h23',
    }).formatToParts(date);
    const hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
    const ss = parts.find((p) => p.type === 'second')?.value ?? '00';
    return `${hh}:${mm}:${ss}`;
  }

  private static formatPhoneNumber(phone?: string): string | undefined {
    if (!phone) return undefined;
    // Remove any non-digit characters
    return phone.replace(/\D/g, '');
  }

  /**
   * Format national id (DUI) into the MH-required `NNNNNNNN-N` pattern.
   * If the input already has the hyphen, preserve it. If it's 9 plain digits,
   * insert the hyphen before the last digit. Anything else (e.g. a NIT) is
   * passed through unchanged — `tipoDocumento` disambiguates on the receiver.
   */
  /**
   * Normalize an MH-issued NIT into `NNNN-NNNNNN-NNN-N` form. MH rejects
   * 14-digit NITs without the hyphens. Input can be either form.
   */
  private static formatNIT(nit?: string): string | undefined {
    if (!nit) return undefined;
    return nit.replace(/\D/g, '');
  }

  /** NIT in the canonical `NNNN-NNNNNN-NNN-N` form. Some MH endpoints
   *  reject the digits-only form and require the dashes. */
  private static formatNITWithDashes(nit?: string): string | undefined {
    if (!nit) return undefined;
    const digits = nit.replace(/\D/g, '');
    if (digits.length !== 14) return nit;
    return `${digits.slice(0, 4)}-${digits.slice(4, 10)}-${digits.slice(10, 13)}-${digits.slice(13)}`;
  }

  private static formatNationalId(nationalId: string): string {
    if (!nationalId) return "";
    if (/^\d{8}-\d$/.test(nationalId)) return nationalId;
    const digitsOnly = nationalId.replace(/\D/g, '');
    if (digitsOnly.length === 9) {
      return `${digitsOnly.slice(0, 8)}-${digitsOnly.slice(8)}`;
    }
    return nationalId;
  }

  private static formatNationalIdDigits(nationalId: string): string {
    return (nationalId || '').replace(/\D/g, '');
  }

  /**
   * MH schema for tipoDte=14 (Sujeto Excluido) expects DUI as 9 digits.
   * Other mappings continue using the dashed form (XXXXXXXX-X).
   */
  private static formatNationalIdForSujetoExcluido(nationalId: string): string {
    if (!nationalId) return "";
    const digitsOnly = nationalId.replace(/\D/g, '');
    return digitsOnly.length === 9 ? digitsOnly : this.formatNationalId(nationalId);
  }

  private static numberToWords(amount: number): string {
    // Simplified number to words conversion
    // In production, this should be a full Spanish implementation
    const rounded = Math.round(amount * 100) / 100;
    return `${rounded.toFixed(2)} DOLARES AMERICANOS`;
  }

  /** Half-up 2-decimal rounding shared with the stored totals (utils/invoiceTotals). */
  private static roundMoney(amount: number): number {
    return roundMoneyShared(amount);
  }

  private static generateUUID(): string {
    return crypto.randomUUID().toUpperCase();
  }

  /**
   * identificacion transmission fields (CAT-003 Modelo de Facturación, CAT-004
   * Tipo de Transmisión, CAT-005 Tipo de Contingencia). A document issued while
   * MH was unreachable must carry Modelo 2 "Diferido" + Transmisión 2
   * "Contingencia" + tipoContingencia, and motivoContin only for tipo 5 —
   * unchanged on its final transmission, because MH matches them against the
   * Evento de Contingencia (Normativa DTE 2.0 Anexo IV; Manual Funcional v2.0).
   * Only FE, CCF, NR, NC, ND, CR, FEX and FSE may be issued in contingency.
   */
  private static transmissionMode(invoice: Invoice): {
    tipoModelo: number;
    tipoOperacion: number;
    // `null` must be serialized (MH requires the keys); the DTE types model them as optional.
    tipoContingencia: any;
    motivoContin: any;
  } {
    const contingency = invoice.contingency;
    if (contingency && CONTINGENCY_DTE_TYPES.has(this.getDocumentTypeFromInvoiceType(invoice.invoiceType))) {
      return {
        tipoModelo: 2,
        tipoOperacion: 2,
        tipoContingencia: contingency.tipoContingencia,
        motivoContin: contingency.tipoContingencia === 5 ? (contingency.motivoContin?.trim() || null) : null,
      };
    }
    return { tipoModelo: 1, tipoOperacion: 1, tipoContingencia: null, motivoContin: null };
  }

  /**
   * numeroDocumento of a related document (documentoRelacionado + item-level).
   * For an ELECTRONIC related DTE (tipoGeneracion 2) MH requires its
   * codigoGeneracion, not its número de control (Manual Funcional v2.0,
   * "Documentos relacionados") — NC/ND/NR/CR/CL created from an issued DTE in
   * the UI carried the control number and MH answered "NO EXISTE UN REGISTRO".
   * relatedGenerationCode also corrects drafts saved before the fix.
   */
  private static relatedDocumentNumberOf(invoice: Invoice): string {
    const code = invoice.relatedGenerationCode?.trim();
    if (code && /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(code)) {
      return code.toUpperCase();
    }
    return invoice.relatedDocumentNumber!;
  }


}
