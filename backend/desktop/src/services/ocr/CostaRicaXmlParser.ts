// Custom deserializer for Costa Rica's electronic-invoice family v4.4 XML
// (namespaces under https://cdn.comprobanteselectronicos.go.cr/xml-schemas/).
//
// All v4.4 document types share the same body shape (Clave, Emisor,
// Receptor, DetalleServicio, ResumenFactura) and only differ in the root
// element name. We accept any of them and map the source type into our
// `ExtractedPurchase.documentType` enum at the bottom.
//
// Supported roots:
//   <FacturaElectronica>             → 'factura'
//   <TiqueteElectronico>             → 'ticket'
//   <FacturaElectronicaCompra>       → 'factura'  (factura recibida del proveedor)
//   <FacturaElectronicaExportacion>  → 'factura'  (export — out of scope but shape matches)
//   <NotaCreditoElectronica>         → 'otro'     (NC reduces a previous invoice)
//   <NotaDebitoElectronica>          → 'otro'     (ND increases a previous invoice)
//   <ReciboElectronicoPago>          → 'otro'     (payment receipt)
//
// `MensajeReceptor` is intentionally excluded — its body (accept/reject
// envelope) is unrelated to the invoice extraction shape.
//
// Confidence is 1.0 because we're parsing a signed authoritative document,
// not guessing from pixels.
//
// Reference body fields (relevant subset):
//   <Clave>50627042600310166484700100001010000114225118498785</Clave>
//   <NumeroConsecutivo>00100001010000114225</NumeroConsecutivo>
//   <FechaEmision>2026-04-27T16:03:17-06:00</FechaEmision>
//   <Emisor>
//     <Nombre>FERRETERIA SALAS SYC S.A</Nombre>
//     <Identificacion><Tipo>02</Tipo><Numero>3101664847</Numero></Identificacion>
//     <NombreComercial>...</NombreComercial>
//     ...
//   </Emisor>
//   <DetalleServicio><LineaDetalle>...</LineaDetalle>...</DetalleServicio>
//   <ResumenFactura>
//     <TotalVentaNeta>...</TotalVentaNeta>
//     <TotalImpuesto>...</TotalImpuesto>
//     <TotalComprobante>...</TotalComprobante>
//   </ResumenFactura>

import { XMLParser } from 'fast-xml-parser';
import type { ExtractedPurchase, ExtractionResult } from './PurchaseOcrService';

const CR_NAMESPACE_PREFIX =
  'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/';

const SUPPORTED_ROOTS = [
  'FacturaElectronica',
  'TiqueteElectronico',
  'FacturaElectronicaCompra',
  'FacturaElectronicaExportacion',
  'NotaCreditoElectronica',
  'NotaDebitoElectronica',
  'ReciboElectronicoPago',
] as const;
type CrRoot = (typeof SUPPORTED_ROOTS)[number];

const ROOT_TO_DOC_TYPE: Record<CrRoot, ExtractedPurchase['documentType']> = {
  FacturaElectronica: 'factura',
  TiqueteElectronico: 'ticket',
  FacturaElectronicaCompra: 'factura',
  FacturaElectronicaExportacion: 'factura',
  NotaCreditoElectronica: 'otro',
  NotaDebitoElectronica: 'otro',
  ReciboElectronicoPago: 'otro',
};

const ROOT_TO_HUMAN_LABEL: Record<CrRoot, string> = {
  FacturaElectronica: 'Factura Electrónica',
  TiqueteElectronico: 'Tiquete Electrónico',
  FacturaElectronicaCompra: 'Factura Electrónica de Compra',
  FacturaElectronicaExportacion: 'Factura de Exportación',
  NotaCreditoElectronica: 'Nota de Crédito',
  NotaDebitoElectronica: 'Nota de Débito',
  ReciboElectronicoPago: 'Recibo de Pago',
};

interface CrLineaDetalle {
  NumeroLinea?: number | string;
  CodigoCABYS?: string;
  Cantidad?: number | string;
  UnidadMedida?: string;
  Detalle?: string;
  PrecioUnitario?: number | string;
  MontoTotal?: number | string;
  SubTotal?: number | string;
  MontoTotalLinea?: number | string;
  Impuesto?: { Monto?: number | string } | Array<{ Monto?: number | string }>;
}

interface CrInvoiceBody {
  Clave?: string;
  NumeroConsecutivo?: string;
  FechaEmision?: string;
  Emisor?: {
    Nombre?: string;
    Identificacion?: { Tipo?: string; Numero?: string };
    NombreComercial?: string;
  };
  Receptor?: {
    Nombre?: string;
    Identificacion?: { Tipo?: string; Numero?: string };
  };
  DetalleServicio?: {
    LineaDetalle?: CrLineaDetalle | CrLineaDetalle[];
  };
  ResumenFactura?: {
    TotalVenta?: number | string;
    TotalVentaNeta?: number | string;
    TotalImpuesto?: number | string;
    TotalComprobante?: number | string;
    CodigoTipoMoneda?: { CodigoMoneda?: string };
  };
}

function num(v: unknown): number {
  if (v === undefined || v === null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function str(v: unknown): string {
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

/** Detects whether a raw XML payload looks like any of the supported CR
 *  v4.4 electronic-document types — OR a related MH envelope
 *  (MensajeHacienda / MensajeReceptor) so we can give a friendly error
 *  for those instead of a generic "not Costa Rica" rejection. Cheap
 *  string sniff so we can skip parsing non-CR payloads (e.g. SV signed
 *  XMLs which we don't support yet). */
export function isCostaRicaInvoiceXml(xml: string): boolean {
  if (xml.includes(CR_NAMESPACE_PREFIX)) return true;
  if (SUPPORTED_ROOTS.some((root) => new RegExp(`<${root}\\b`).test(xml))) {
    return true;
  }
  return /<MensajeHacienda\b|<MensajeReceptor\b/.test(xml);
}

/** Pick the supported root key from a parsed XML object. Returns
 *  `undefined` when the XML uses a root we don't handle (e.g.
 *  MensajeReceptor, or some unrelated XML). */
function pickRoot(
  parsed: Record<string, unknown>,
): { root: CrRoot; body: CrInvoiceBody } | undefined {
  for (const root of SUPPORTED_ROOTS) {
    if (parsed[root] && typeof parsed[root] === 'object') {
      return { root, body: parsed[root] as CrInvoiceBody };
    }
  }
  return undefined;
}

export function parseCostaRicaInvoiceXml(xml: string): ExtractionResult {
  if (!isCostaRicaInvoiceXml(xml)) {
    return {
      ok: false,
      error:
        'El XML no parece ser un documento electrónico de Costa Rica (v4.x). ' +
        'Solo se soportan formatos del Ministerio de Hacienda de CR por ahora.',
    };
  }

  let parsed: Record<string, unknown>;
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      // Drop the XML namespace prefix so we can address fields by their
      // local name — CR documents use the default namespace on every tag.
      removeNSPrefix: true,
      // Keep ALL values as strings. The 50-digit `<Clave>` exceeds
      // Number.MAX_SAFE_INTEGER and would silently round to scientific
      // notation if parsed numerically — we'd lose the canonical
      // identifier needed to look the document up in MH later. Our `num()`
      // helper coerces the numeric fields (cantidad, precios, totales) at
      // the read sites where precision is bounded.
      parseTagValue: false,
      trimValues: true,
    });
    parsed = parser.parse(xml) as Record<string, unknown>;
  } catch (err) {
    return {
      ok: false,
      error: `Error al parsear XML: ${err instanceof Error ? err.message : 'desconocido'}`,
      rawText: xml,
    };
  }

  const picked = pickRoot(parsed);
  if (!picked) {
    // Friendlier message when the file is an MH response envelope rather
    // than an actual invoice — these come paired with the invoice download
    // and users frequently grab them by accident.
    if (parsed.MensajeHacienda) {
      return {
        ok: false,
        error:
          'Este XML es una respuesta del Ministerio de Hacienda (MensajeHacienda), no una factura. Importa el XML del comprobante en su lugar.',
        rawText: xml,
      };
    }
    if (parsed.MensajeReceptor) {
      return {
        ok: false,
        error:
          'Este XML es una confirmación de receptor (MensajeReceptor), no una factura. Importa el XML del comprobante en su lugar.',
        rawText: xml,
      };
    }
    return {
      ok: false,
      error:
        `XML sin raíz soportada. Tipos válidos: ${SUPPORTED_ROOTS.join(', ')}.`,
      rawText: xml,
    };
  }
  const { root, body } = picked;

  const emisor = body.Emisor ?? {};
  const lineas = body.DetalleServicio?.LineaDetalle;
  const lineasArr: CrLineaDetalle[] = Array.isArray(lineas)
    ? lineas
    : lineas
      ? [lineas]
      : [];
  const resumen = body.ResumenFactura ?? {};

  // Date — CR uses ISO 8601 with TZ; we just want YYYY-MM-DD.
  const fecha = str(body.FechaEmision);
  const dateOnly = fecha.length >= 10 ? fecha.slice(0, 10) : '';

  const items: ExtractedPurchase['items'] = lineasArr.map((l) => ({
    description: str(l.Detalle).replace(/\s+/g, ' ').trim() || 'Producto',
    quantity: num(l.Cantidad),
    unitPrice: num(l.PrecioUnitario),
    total: num(l.MontoTotalLinea ?? l.MontoTotal),
  }));

  const documentType = ROOT_TO_DOC_TYPE[root];
  const humanLabel = ROOT_TO_HUMAN_LABEL[root];

  const data: ExtractedPurchase = {
    documentType,
    vendor: {
      // For NC/ND the "issuer" is still the supplier — same field.
      name: str(emisor.NombreComercial) || str(emisor.Nombre),
      // CR cédula jurídica (10 digits) — keep as-is, downstream sanitizer
      // will accept since it's not validated against the SV NIT regex
      // when documentType is non-SV.
      nit: str(emisor.Identificacion?.Numero),
      nrc: '',
    },
    // Prepend the human-readable kind to the document number for non-FE
    // types so the user can spot a Nota de Crédito vs a Factura at a
    // glance in the import preview without having to expand the row.
    documentNumber:
      root === 'FacturaElectronica' || root === 'FacturaElectronicaCompra'
        ? str(body.NumeroConsecutivo)
        : `[${humanLabel}] ${str(body.NumeroConsecutivo)}`,
    codigoGeneracion: str(body.Clave),
    date: dateOnly,
    subtotal: num(resumen.TotalVentaNeta ?? resumen.TotalVenta),
    iva: num(resumen.TotalImpuesto),
    total: num(resumen.TotalComprobante),
    items,
    confidence: 1.0,
  };

  return { ok: true, data, rawText: xml };
}
