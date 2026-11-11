// DTEJsonParser — Convierte un JSON DTE del Ministerio de Hacienda en un registro Compra
// Portado desde la app React Native

import type { Compra, CompraItem, CompraPaymentCondition, CompraSource } from '@/types/compras';
import { decodeBase64ToText as decodeAttachmentBase64 } from './textDecoding';
import { CompraSource as CompraSourceEnum } from '@/types/compras';

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return undefined;
}

function numberOrUndefined(value: number | undefined): number | undefined {
  return value !== undefined ? Number(value) : undefined;
}

interface ParsedDTEIdentificacion {
  tipoDte?: string;
  codigoGeneracion?: string;
  numeroControl?: string;
  fecEmi?: string;
  horEmi?: string;
}

interface ParsedDTERelatedDocument {
  tipoDocumento?: string;
  numeroDocumento?: string;
  codigoGeneracion?: string;
  codigoGeneracionRef?: string;
  numeroControl?: string;
}

interface ParsedDTEEmisor {
  nit?: string;
  nrc?: string;
  nombre?: string;
  nombreComercial?: string;
}

interface ParsedDTEReceptor {
  nit?: string;
  numDocumento?: string;
  nombre?: string;
  nrc?: string;
}

interface ParsedDTEItem {
  numItem?: number;
  descripcion?: string;
  cantidad?: number;
  precioUni?: number;
  ventaGravada?: number;
  ivaItem?: number;
}

interface ParsedDTEResumen {
  totalNoSuj?: number;
  totalExenta?: number;
  totalGravada?: number;
  subTotal?: number;
  totalIva?: number;
  ivaRete1?: number;
  reteRenta?: number;
  totalPagar?: number;
  montoTotalOperacion?: number;
  tipoMoneda?: string;
  selloRecibido?: string;
  condicionOperacion?: number | string | null;
  pagos?: ParsedDTEPayment[];
}

interface ParsedDTERespuestaHacienda {
  selloRecibido?: string;
  estado?: string;
}

interface ParsedDTEPayment {
  plazo?: string | null;
  periodo?: number | string | null;
}

export interface ParsedDTE {
  identificacion?: ParsedDTEIdentificacion;
  emisor?: ParsedDTEEmisor;
  receptor?: ParsedDTEReceptor;
  cuerpoDocumento?: ParsedDTEItem[];
  resumen?: ParsedDTEResumen;
  respuestaHacienda?: ParsedDTERespuestaHacienda;
  documentoRelacionado?: ParsedDTERelatedDocument[] | ParsedDTERelatedDocument;
}

export class DTEJsonParser {
  private static readonly validTypes = ['01', '03', '04', '05', '06', '07', '08', '09', '11', '14', '15'];

  private static normalizePaymentCondition(value: unknown): CompraPaymentCondition {
    const parsed = Number(value);
    return parsed === 2 || parsed === 3 ? parsed : 1;
  }

  private static normalizePaymentTermCode(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    return ['01', '02', '03'].includes(value) ? value : null;
  }

  private static normalizePaymentTermPeriod(value: unknown): number | null {
    const parsed = typeof value === 'string'
      ? Number.parseInt(value, 10)
      : Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private static addPaymentTerm(issueDate: string | undefined, termCode: string | null, termPeriod: number | null): string | undefined {
    if (!issueDate || !termCode || !termPeriod) return undefined;
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(issueDate);
    if (!match) return undefined;
    const date = new Date(Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
    ));

    switch (termCode) {
      case '01':
        date.setUTCDate(date.getUTCDate() + termPeriod);
        break;
      case '02':
        date.setUTCMonth(date.getUTCMonth() + termPeriod);
        break;
      case '03':
        date.setUTCFullYear(date.getUTCFullYear() + termPeriod);
        break;
      default:
        return undefined;
    }

    return date.toISOString().slice(0, 10);
  }

  /**
   * Parsea un string JSON y lo convierte en un objeto Compra.
   * Retorna null si el JSON no corresponde a un DTE válido.
   */
  static parse(
    jsonString: string,
    companyId: string,
    source?: CompraSource,
    gmailMessageId?: string,
  ): Compra | null {
    const normalized = DTEJsonParser.normalize(jsonString);
    if (!normalized) {
      console.warn('DTEJsonParser.parse: sin forma de DTE reconocible');
      return null;
    }
    return DTEJsonParser.parseDTEObject(
      normalized.object,
      companyId,
      source,
      gmailMessageId,
      normalized.canonicalJson,
    );
  }

  // ── Normalización ──────────────────────────────────────────────────────────
  //
  // Los adjuntos DTE llegan en varias formas además de JSON UTF-8 plano, y cada
  // emisor/mailer difiere. Esta capa las normaliza a (1) un objeto DTE de primer
  // nivel y (2) una cadena JSON limpia de *solo* el DTE, para que el resto del
  // parser — y el `originalJson` almacenado — sean agnósticos al formato:
  //   • JWS/JWT: algunos emisores (p.ej. "Facturación SV") adjuntan el token
  //     firmado `header.payload.signature`; el DTE es el segmento `payload`.
  //   • Sobre del firmador: `{ nit, passwordPri, dteJson, … }`, donde el DTE real
  //     está anidado en `dteJson` junto a la contraseña PRIVADA de firma del
  //     emisor. Desenvolvemos `dteJson` y nunca exponemos el sobre, para que ese
  //     secreto jamás se persista en `originalJson`.
  // Los charsets legacy se resuelven aguas arriba, en textDecoding.ts.
  //
  // Espeja SwiftUI DTEPurchaseParser.normalize (FacturasSimples/Services/DTEPurchaseParser.swift).

  /** Devuelve el objeto DTE y una cadena JSON limpia de solo el DTE. */
  static normalize(raw: string): { object: ParsedDTE; canonicalJson: string } | null {
    let object = DTEJsonParser.decodeToObject(raw);
    if (!object) return null;

    // Sobre del firmador: desenvolver el DTE anidado (descartando credenciales).
    let unwrapped = false;
    if (object.identificacion == null) {
      const inner = (object as Record<string, unknown>).dteJson;
      if (inner && typeof inner === 'object') {
        object = inner as ParsedDTE;
        unwrapped = true;
      } else if (typeof inner === 'string') {
        try {
          object = JSON.parse(inner) as ParsedDTE;
          unwrapped = true;
        } catch {
          // se deja `object` como está; la validación de campos lo rechazará
        }
      }
    }

    // Conservar el texto original tal cual solo si ya era JSON DTE limpio de
    // primer nivel. Si no, re-serializar el DTE normalizado para que
    // `originalJson` sea siempre JSON válido y libre de secretos.
    let canonicalJson: string;
    if (!unwrapped && DTEJsonParser.isPlainTopLevelDte(raw)) {
      canonicalJson = raw;
    } else {
      canonicalJson = JSON.stringify(object);
    }
    return { object, canonicalJson };
  }

  /** True si `raw` ya deserializa directamente a un objeto DTE de primer nivel. */
  private static isPlainTopLevelDte(raw: string): boolean {
    try {
      const parsed = JSON.parse(raw);
      return !!parsed && typeof parsed === 'object' && parsed.identificacion != null;
    } catch {
      return false;
    }
  }

  /** Deserializa JSON de DTE, tolerando envoltura JWS/JWT además de JSON estándar. */
  private static decodeToObject(raw: string): ParsedDTE | null {
    if (typeof raw !== 'string' || raw.length === 0) return null;
    // 1) JSON estándar (quitando un BOM UTF-8, que JSON.parse rechaza).
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as ParsedDTE;
      }
    } catch (jsonErr) {
      // Not standard JSON — fall through and try JWS/JWT. Log the parse error
      // (rather than swallowing it) since it often pinpoints the exact
      // malformed byte/field if BOTH decode paths end up failing below.
      console.warn('DTEJsonParser.decodeToObject: JSON.parse falló, probando JWS/JWT', jsonErr);
    }
    // 2) JWS/JWT — el DTE es el segmento payload en base64url.
    return DTEJsonParser.decodeJwtPayload(text);
  }

  /**
   * Si `text` es un JWS/JWT compacto (`header.payload.signature`), devuelve el
   * objeto JSON de su segmento `payload`; null en caso contrario.
   */
  private static decodeJwtPayload(text: string): ParsedDTE | null {
    const segments = text.trim().split('.');
    if (segments.length !== 2 && segments.length !== 3) return null;
    const payload = segments[1];
    if (!payload || !/^[A-Za-z0-9_-]+$/.test(payload)) return null;
    try {
      const decoded = decodeAttachmentBase64(payload);
      if (!decoded) return null;
      const parsed = JSON.parse(decoded);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as ParsedDTE;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Convierte un objeto ParsedDTE ya deserializado en un registro Compra.
   */
  static parseDTEObject(
    dte: ParsedDTE,
    companyId: string,
    source?: CompraSource,
    gmailMessageId?: string,
    originalJson?: string,
  ): Compra | null {
    try {
      const identificacion = dte.identificacion;
      const emisor = dte.emisor;
      const receptor = dte.receptor;
      const resumen = dte.resumen;

      // Campos requeridos mínimos
      if (!identificacion?.tipoDte || !identificacion?.codigoGeneracion) {
        console.warn('DTEJsonParser: falta tipoDte o codigoGeneracion');
        return null;
      }
      if (!emisor?.nombre) {
        console.warn('DTEJsonParser: falta emisor.nombre');
        return null;
      }
      if (!DTEJsonParser.validTypes.includes(identificacion.tipoDte)) {
        console.warn('DTEJsonParser: tipoDte no soportado', identificacion.tipoDte);
        return null;
      }

      const now = new Date().toISOString();
      const compraId = crypto.randomUUID();
      const relatedDocument = Array.isArray(dte.documentoRelacionado)
        ? dte.documentoRelacionado[0]
        : dte.documentoRelacionado;
      const relatedDocumentType = stringValue(relatedDocument?.tipoDocumento);
      const relatedDocumentNumber = stringValue(
        relatedDocument?.numeroDocumento ??
        relatedDocument?.codigoGeneracionRef ??
        relatedDocument?.codigoGeneracion ??
        relatedDocument?.numeroControl,
      );
      const relatedGenerationCode = stringValue(
        relatedDocument?.codigoGeneracion ??
        relatedDocument?.codigoGeneracionRef ??
        relatedDocument?.numeroDocumento,
      );
      const relatedControlNumber = stringValue(
        relatedDocument?.numeroControl ??
        relatedDocument?.numeroDocumento,
      );

      // Obtener sello del campo más confiable disponible
      const selloRecibido =
        dte.respuestaHacienda?.selloRecibido ??
        resumen?.selloRecibido ??
        undefined;

      // Construir items desde cuerpoDocumento
      const items: CompraItem[] = (dte.cuerpoDocumento ?? []).map((item, idx) => ({
        id: crypto.randomUUID(),
        compraId,
        numItem: item.numItem ?? idx + 1,
        descripcion: item.descripcion ?? '',
        cantidad: Number(item.cantidad ?? 1),
        precioUni: Number(item.precioUni ?? 0),
        ventaGravada: Number(item.ventaGravada ?? 0),
        ivaItem: item.ivaItem !== undefined ? Number(item.ivaItem) : undefined,
      }));

      // Totales — preferir resumen, caer en suma de items si no hay
      const totalGravada =
        Number(resumen?.totalGravada ?? 0) ||
        items.reduce((acc, i) => acc + i.ventaGravada, 0);

      const totalIva = Number(resumen?.totalIva ?? 0);

      const totalPagar =
        Number(resumen?.totalPagar ?? resumen?.montoTotalOperacion ?? 0) ||
        totalGravada + totalIva;
      const paymentCondition = DTEJsonParser.normalizePaymentCondition(resumen?.condicionOperacion);
      const paymentSource = Array.isArray(resumen?.pagos)
        ? resumen.pagos.find((payment) => payment?.plazo != null || payment?.periodo != null)
        : undefined;
      const parsedPaymentTermCode = DTEJsonParser.normalizePaymentTermCode(paymentSource?.plazo);
      const parsedPaymentTermPeriod = DTEJsonParser.normalizePaymentTermPeriod(paymentSource?.periodo);
      const paymentTermCode = paymentCondition === 1 ? null : parsedPaymentTermCode;
      const paymentTermPeriod = paymentCondition === 1 ? null : parsedPaymentTermPeriod;
      const dueDate = paymentCondition === 1
        ? undefined
        : DTEJsonParser.addPaymentTerm(
          identificacion.fecEmi,
          paymentTermCode,
          paymentTermPeriod,
        );

      const compra: Compra = {
        id: compraId,
        companyId,
        // Emisor
        emisorNit: emisor.nit ?? '',
        emisorNrc: emisor.nrc ?? undefined,
        emisorNombre: emisor.nombre,
        emisorNombreComercial: emisor.nombreComercial ?? undefined,
        // DTE
        tipoDte: identificacion.tipoDte,
        codigoGeneracion: identificacion.codigoGeneracion,
        numeroControl: identificacion.numeroControl ?? '',
        selloRecibido,
        relatedDocumentType,
        relatedDocumentNumber,
        relatedControlNumber,
        relatedGenerationCode,
        fecha: identificacion.fecEmi ?? new Date().toISOString().substring(0, 10),
        dueDate,
        paymentCondition,
        paymentTermCode,
        paymentTermPeriod,
        openInAccounts: false,
        // Totales
        totalGravada,
        totalIva,
        totalPagar,
        totalNoSuj: numberOrUndefined(resumen?.totalNoSuj),
        totalExenta: numberOrUndefined(resumen?.totalExenta),
        subTotal: numberOrUndefined(resumen?.subTotal),
        ivaRete1: numberOrUndefined(resumen?.ivaRete1),
        reteRenta: numberOrUndefined(resumen?.reteRenta),
        montoTotalOperacion: numberOrUndefined(resumen?.montoTotalOperacion ?? resumen?.totalPagar),
        tipoMoneda: resumen?.tipoMoneda ?? 'USD',
        horaEmision: identificacion.horEmi,
        receptorNit: receptor?.nit ?? receptor?.numDocumento,
        receptorNombre: receptor?.nombre,
        receptorNrc: receptor?.nrc,
        // Metadata
        source: source ?? CompraSourceEnum.Manual,
        gmailMessageId,
        originalJson,
        // Items
        items,
        // Verificación — sin verificar inicialmente
        verified: undefined,
        verifiedAt: undefined,
        verifiedEstado: undefined,
        verifiedSello: undefined,
        // Timestamps
        createdAt: now,
        updatedAt: now,
      };

      return compra;
    } catch (error) {
      console.error('DTEJsonParser.parseDTEObject: error al parsear', error);
      return null;
    }
  }
}
