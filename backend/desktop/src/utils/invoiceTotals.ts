// Invoice totals — single source of truth for the editor (InvoiceTotals), the
// stored invoice (invoiceSlice), the DTE mappers (DTEMappingService), the
// annexes and the PDF. Pure: no store imports.
//
// Every figure is built per line by `computeLine` — the SAME function the DTE
// mappers use for cuerpoDocumento — and the totals are sums of those already
// rounded line values. Summing unrounded lines here while the mappers rounded
// per line made the resumen disagree with the items (CCF 3 × (1.5 × $0.99):
// Σ ventaGravada 3.96 vs totalGravada 3.93).

import { InvoiceDetail, InvoiceType, InvoiceCalculations } from '../types/invoice';
import { TaxCategory } from '../types/product';

export const TAX_FACTOR = 1.13;

export const DTE_SCHEMA_VERSION_BY_INVOICE_TYPE: Record<InvoiceType, number> = {
  [InvoiceType.Factura]: 2,
  [InvoiceType.CCF]: 4,
  [InvoiceType.NotaRemision]: 4,
  [InvoiceType.NotaCredito]: 4,
  [InvoiceType.NotaDebito]: 4,
  [InvoiceType.ComprobanteRetencion]: 2,
  [InvoiceType.ComprobanteLiquidacion]: 2,
  [InvoiceType.DocumentoContableLiquidacion]: 2,
  [InvoiceType.FacturaExportacion]: 3,
  [InvoiceType.SujetoExcluido]: 2,
  [InvoiceType.ComprobanteDonacion]: 2,
  [InvoiceType.EventoOperacionesEspeciales]: 1,
  [InvoiceType.EventoRetorno]: 1,
};

/**
 * Half-up 2-decimal rounding that ignores binary noise: 1.5 × 0.99 = 1.485 is
 * stored as 1.48499999… and `Math.round(x * 100) / 100` gave 1.48 where the
 * decimal arithmetic MH (and the iOS app) use gives 1.49.
 */
export const roundMoney = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Number((value * 100).toPrecision(15))) / 100;
};

/** Unit prices / item discounts carry 8 decimals (MH `multipleOf 1e-8`). */
export const roundUnitPrice = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100000000) / 100000000;
};

// IVA retention 1% (Código Tributario Art. 162): only on operations of at least
// US$100 before IVA — same rule as the iOS app (Invoice.swift ivaRete1).
export const IVA_RETENTION_THRESHOLD = 100;

/**
 * Income-tax retention on Facturas de Sujeto Excluido (resumen.reteRenta).
 * Ley ISR art. 156: services rendered by sujetos excluidos — purchases of
 * goods are normally not withheld, so it is a per-document option
 * (`applyRentaRetention`, ON by default).
 */
export const SUJETO_EXCLUIDO_RENTA_RATE = 0.1;

/** IVA percepción (Código Tributario art. 163) charged by agentes de percepción. */
export const IVA_PERCEPTION_RATE = 0.01;

/** A CCF carries percepción only from US$100.00 of gravado base (IVA excluded). */
export const IVA_PERCEPTION_THRESHOLD = 100;

/**
 * Documents whose resumen carries the percepción (ivaPerci on CCF / NC / ND
 * v4; the Factura schema has no such field). NC/ND carry the proportional
 * percepción of their own base when the referenced CCF carried it — no
 * US$100 threshold of their own.
 */
export const IVA_PERCEPTION_INVOICE_TYPES: ReadonlyArray<InvoiceType> = [
  InvoiceType.CCF,
  InvoiceType.NotaCredito,
  InvoiceType.NotaDebito,
];

/**
 * DTE types whose mappers carry per-line discounts (cuerpoDocumento
 * montoDescu + resumen.totalDescu). Every other type ignores `discount`, in
 * the DTE AND in these totals, so the stored figures always equal the
 * document Hacienda holds.
 */
export const DISCOUNTABLE_INVOICE_TYPES: ReadonlyArray<InvoiceType> = [
  InvoiceType.Factura,
  InvoiceType.CCF,
  InvoiceType.NotaCredito,
  InvoiceType.NotaDebito,
  InvoiceType.NotaRemision,
];

/**
 * DTE types whose mappers split each line into ventaGravada / ventaExenta /
 * ventaNoSuj by the product's tax category.
 */
export const TAX_BUCKET_INVOICE_TYPES: ReadonlyArray<InvoiceType> = [
  InvoiceType.Factura,
  InvoiceType.CCF,
  InvoiceType.NotaCredito,
  InvoiceType.NotaDebito,
  InvoiceType.NotaRemision,
];

/**
 * Documents that carry no IVA at all: exports (0%, tributo C3), purchases from
 * sujetos excluidos and donations. A product's tax category is irrelevant there.
 */
export const NO_IVA_INVOICE_TYPES: ReadonlyArray<InvoiceType> = [
  InvoiceType.FacturaExportacion,
  InvoiceType.SujetoExcluido,
  InvoiceType.ComprobanteDonacion,
];

/**
 * Item amounts are IVA-EXCLUSIVE (precioUni = price / 1.13, IVA declared in
 * resumen.tributos). Prices are stored IVA-inclusive for every document type.
 */
export const IVA_EXCLUSIVE_INVOICE_TYPES: ReadonlyArray<InvoiceType> = [
  InvoiceType.CCF,
  InvoiceType.NotaCredito,
  InvoiceType.NotaDebito,
  InvoiceType.NotaRemision,
];

/** Documents whose resumen carries the 1% IVA retention (ivaRete1 / ivaRete). */
export const IVA_RETENTION_INVOICE_TYPES: ReadonlyArray<InvoiceType> = [
  InvoiceType.Factura,
  InvoiceType.CCF,
];

export function supportsLineDiscounts(type: InvoiceType | null | undefined): boolean {
  return type != null && DISCOUNTABLE_INVOICE_TYPES.includes(type);
}

export function isIvaExclusiveType(type: InvoiceType | null | undefined): boolean {
  return type != null && IVA_EXCLUSIVE_INVOICE_TYPES.includes(type);
}

export function carriesIva(type: InvoiceType | null | undefined): boolean {
  return type == null || !NO_IVA_INVOICE_TYPES.includes(type);
}

export type LineTaxBucket = 'gravada' | 'exenta' | 'noSuj';

/**
 * DTE sale bucket of a product tax category. EXENTO → ventaExenta,
 * NO_GRAVADO → ventaNoSuj (no sujeta). GRAVADO, missing (legacy lines) and
 * EXPORTACION (13% when the good is sold locally; exports go on a FEX at 0%)
 * → ventaGravada.
 */
export function taxBucketOf(category?: TaxCategory | string | null): LineTaxBucket {
  if (category === TaxCategory.EXENTO) return 'exenta';
  if (category === TaxCategory.NO_GRAVADO) return 'noSuj';
  return 'gravada';
}

export const TAX_BUCKET_LABEL: Record<LineTaxBucket, string> = {
  gravada: 'Gravado',
  exenta: 'Exento',
  noSuj: 'No sujeto',
};

/** Whether a line of this tax category can go on this document type. */
export function canInvoiceTaxCategory(
  type: InvoiceType | null | undefined,
  category?: TaxCategory | string | null,
): boolean {
  if (taxBucketOf(category) === 'gravada' || type == null) return true;
  return TAX_BUCKET_INVOICE_TYPES.includes(type) || NO_IVA_INVOICE_TYPES.includes(type);
}

/** Spanish explanation shown when a non-gravado product can't go on `type`. */
export function taxCategoryBlockedMessage(
  type: InvoiceType | null | undefined,
  category?: TaxCategory | string | null,
): string | null {
  if (canInvoiceTaxCategory(type, category)) return null;
  const label = taxBucketOf(category) === 'exenta' ? 'exento' : 'no sujeto';
  return `Este producto es ${label} de IVA y este tipo de documento solo admite ventas gravadas. ` +
    'Emítalo en una Factura, Crédito Fiscal, Nota de Crédito, Nota de Débito o Nota de Remisión.';
}

/** Lines of `items` that `type` can't carry (non-gravado on an unsupported type). */
export function blockedTaxCategoryLines(
  items: ReadonlyArray<Pick<InvoiceDetail, 'taxCategory'>>,
  type: InvoiceType | null | undefined,
): number[] {
  return items.flatMap((item, index) => (canInvoiceTaxCategory(type, item.taxCategory) ? [] : [index]));
}

/** One cuerpoDocumento line exactly as the DTE reports it. */
export interface ComputedLine {
  bucket: LineTaxBucket;
  cantidad: number;
  /** precioUni as sent to MH (8 decimals; IVA-exclusive on CCF/NC/ND/NR gravado lines). */
  precioUni: number;
  /** montoDescu as sent to MH (8 decimals, same IVA treatment as precioUni). */
  montoDescu: number;
  /** venta* as sent to MH = cantidad × precioUni − montoDescu, 2 decimals. */
  venta: number;
  /** IVA of the line: ivaItem on a Factura, the line's share of resumen.tributos on CCF/NC/ND/NR. */
  iva: number;
  /** What the line charges, IVA included (= the editor's line total). */
  total: number;
  /** IVA-exclusive base of a gravado line (0 for exento / no sujeto lines). */
  base: number;
  /** Line discount in stored (price) terms, clamped to the line gross. */
  discount: number;
}

/**
 * The single per-line computation. `discount` and `unitPrice` are stored with
 * the same IVA treatment (inclusive for gravado lines; exento / no sujeto
 * prices carry no IVA at all, so they are never divided by 1.13).
 */
export function computeLine(detail: InvoiceDetail, invoiceType: InvoiceType): ComputedLine {
  const quantity = Number.isFinite(detail.quantity) ? Math.max(0, detail.quantity) : 0;
  const unitPrice = Number.isFinite(detail.unitPrice) ? Math.max(0, detail.unitPrice) : 0;
  const noIva = !carriesIva(invoiceType);
  const bucket: LineTaxBucket = noIva || !TAX_BUCKET_INVOICE_TYPES.includes(invoiceType)
    ? 'gravada'
    : taxBucketOf(detail.taxCategory);
  const gross = roundMoney(quantity * unitPrice);
  const rawDiscount = supportsLineDiscounts(invoiceType) ? Number(detail.discount ?? 0) : 0;
  const discount = Number.isFinite(rawDiscount) && rawDiscount > 0 ? Math.min(rawDiscount, gross) : 0;
  const exclusive = bucket === 'gravada' && !noIva && isIvaExclusiveType(invoiceType);

  const precioUni = roundUnitPrice(exclusive ? unitPrice / TAX_FACTOR : unitPrice);
  // MH: 0 ≤ montoDescu ≤ cantidad × precioUni (iOS MHService clamps the same way).
  const montoDescu = roundUnitPrice(Math.min(exclusive ? discount / TAX_FACTOR : discount, quantity * precioUni));
  const venta = Math.max(0, roundMoney(quantity * precioUni - montoDescu));

  let iva = 0;
  let total = venta;
  if (bucket === 'gravada' && !noIva) {
    if (exclusive) {
      // IVA = what the line charges − its base, so Σ IVA = gross − base exactly
      // (iOS Invoice.tax, MHService.mapResumen).
      total = roundMoney(gross - discount);
      iva = Math.max(0, roundMoney(total - venta));
    } else {
      iva = roundMoney(venta - venta / TAX_FACTOR);
    }
  }
  const base = bucket === 'gravada' ? roundMoney(exclusive ? venta : venta - iva) : 0;

  return { bucket, cantidad: quantity, precioUni, montoDescu, venta, iva, total, base, discount };
}

/** Totals of already-computed lines (sums of rounded line values). */
export function sumLines(lines: ReadonlyArray<ComputedLine>) {
  const sum = (pick: (line: ComputedLine) => number) =>
    roundMoney(lines.reduce((acc, line) => acc + pick(line), 0));
  return {
    totalGravada: sum((l) => (l.bucket === 'gravada' ? l.venta : 0)),
    totalExenta: sum((l) => (l.bucket === 'exenta' ? l.venta : 0)),
    totalNoSuj: sum((l) => (l.bucket === 'noSuj' ? l.venta : 0)),
    totalIva: sum((l) => l.iva),
    totalAmount: sum((l) => l.total),
    totalBase: sum((l) => l.base),
    totalDescu: sum((l) => l.montoDescu),
    totalDiscount: sum((l) => l.discount),
  };
}

/**
 * Per-document withholding options of `computeTotals` (the 3rd argument keeps
 * the 1% IVA retention for backward compatibility).
 */
export interface ComputeTotalsOptions {
  /** Sujeto Excluido: withhold 10% renta. Absent = true. */
  applyRentaRetention?: boolean;
  /**
   * IVA percepción decision — the company is an agente de percepción, the
   * receptor is not a gran contribuyente and (NC/ND) the referenced CCF carried
   * percepción. See `ivaPerceptionApplies`. computeTotals applies the
   * document rules on top (type, CCF ≥ US$100 base).
   */
  applyIvaPerception?: boolean;
}

// Single source of truth for invoice totals — the editor (InvoiceTotals), the
// stored invoice, the annexes and the PDF all read these figures.
//   totalAmount     Monto total de la operación (IVA included, every bucket).
//   tax             IVA = Σ ivaItem (FE) / resumen.tributos (CCF, NC, ND, NR); 0 on FEX/FSE/CD.
//   subTotal        IVA-exclusive base of the GRAVADO lines (= totalWithoutTax).
//   totalGravada    Σ ventaGravada as the DTE reports it (IVA-incl. on FE, excl. on CCF/NC/ND/NR).
//   totalExenta / totalNoSuj  Σ ventaExenta / ventaNoSuj (no IVA).
//   ivaRete1        1% retention (FE/CCF only, base ≥ US$100).
//   ivaPerci1       1% percepción (CCF base ≥ US$100; NC/ND of such a CCF), when applyIvaPerception.
//   reteRenta       10% renta retention (FSE only, unless applyRentaRetention is false).
//   totalPagar      totalAmount + ivaPerci1 − ivaRete1 − reteRenta (= resumen.totalPagar).
export const computeTotals = (
  items: InvoiceDetail[],
  invoiceType: InvoiceType,
  hasRetention?: boolean,
  options: ComputeTotalsOptions = {},
): InvoiceCalculations => {
  const isCCF = invoiceType === InvoiceType.CCF;
  const lines = (items || []).map((item) => computeLine(item, invoiceType));
  const sums = sumLines(lines);
  const noIva = !carriesIva(invoiceType);

  const totalAmount = sums.totalAmount;
  const tax = noIva ? 0 : sums.totalIva;
  const totalWithoutTax = noIva ? totalAmount : sums.totalBase;
  const subTotal = totalWithoutTax;
  const reteRenta = invoiceType === InvoiceType.SujetoExcluido && options.applyRentaRetention !== false
    ? roundMoney(totalAmount * SUJETO_EXCLUIDO_RENTA_RATE)
    : 0;
  const ivaRete1 =
    hasRetention &&
    IVA_RETENTION_INVOICE_TYPES.includes(invoiceType) &&
    totalWithoutTax >= IVA_RETENTION_THRESHOLD
      ? roundMoney(totalWithoutTax * 0.01)
      : 0;
  const ivaPerci1 = perceptionOf(sums.totalBase, invoiceType, options.applyIvaPerception);
  const totalPagar = roundMoney(totalAmount + ivaPerci1 - ivaRete1 - reteRenta);

  return {
    totalAmount,
    tax,
    subTotal,
    reteRenta,
    ivaRete1,
    ivaPerci1,
    totalPagar,
    totalWithoutTax,
    isCCF,
    totalItems: lines.length,
    version: DTE_SCHEMA_VERSION_BY_INVOICE_TYPE[invoiceType] ?? 1,
    totalDiscount: sums.totalDiscount,
    totalGravada: noIva ? totalAmount : sums.totalGravada,
    totalExenta: noIva ? 0 : sums.totalExenta,
    totalNoSuj: noIva ? 0 : sums.totalNoSuj,
  };
};

/**
 * 1% percepción of a gravado base (IVA excluded), half-up to cents: CCF from
 * US$100.00 of base; NC/ND (proportional to the CCF they correct) on any base.
 */
function perceptionOf(gravadoBase: number, invoiceType: InvoiceType, apply?: boolean): number {
  if (!apply || !IVA_PERCEPTION_INVOICE_TYPES.includes(invoiceType) || !(gravadoBase > 0)) return 0;
  if (invoiceType === InvoiceType.CCF && gravadoBase < IVA_PERCEPTION_THRESHOLD) return 0;
  return roundMoney(gravadoBase * IVA_PERCEPTION_RATE);
}

/**
 * Whether a new / edited document takes the 1% IVA percepción — the decision
 * the invoice stores (`applyIvaPerception`) so its totals, DTE and PDF agree:
 * the company is an agente de percepción, the receptor is not a gran
 * contribuyente, and the document is a CCF or a NC/ND whose referenced CCF
 * carried percepción (its stored totals). The US$100 threshold is applied by
 * computeTotals.
 */
export function ivaPerceptionApplies(args: {
  invoiceType: InvoiceType | null | undefined;
  company?: { isPerceptionAgent?: boolean } | null;
  customer?: { isLargeTaxpayer?: boolean } | null;
  /** NC / ND: the referenced document. */
  parent?: {
    invoiceType: InvoiceType;
    applyIvaPerception?: boolean;
    totals?: Pick<InvoiceCalculations, 'ivaPerci1'> | null;
  } | null;
}): boolean {
  const { invoiceType, company, customer, parent } = args;
  if (invoiceType == null || !IVA_PERCEPTION_INVOICE_TYPES.includes(invoiceType)) return false;
  if (company?.isPerceptionAgent !== true || customer?.isLargeTaxpayer === true) return false;
  if (invoiceType === InvoiceType.CCF) return true;
  return parent?.invoiceType === InvoiceType.CCF && (parent.totals?.ivaPerci1 ?? 0) > 0;
}

/**
 * Splits `total` (money) over `weights` in whole cents (largest remainder):
 * the shares add up to `total` exactly. Used for the per-item ivaPerci of a
 * NC / ND so Σ items = resumen.ivaPerci.
 */
export function allocateCents(total: number, weights: ReadonlyArray<number>): number[] {
  const cents = Math.round(roundMoney(total) * 100);
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const sumW = w.reduce((a, b) => a + b, 0);
  if (cents <= 0 || sumW <= 0) return w.map(() => 0);
  const raw = w.map((x) => (x / sumW) * cents);
  const shares = raw.map((r) => Math.floor(r + 1e-9));
  let rest = cents - shares.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - shares[i] }))
    .filter(({ i }) => w[i] > 0)
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rest > 0 && order.length > 0; k = (k + 1) % order.length) {
    shares[order[k].i] += 1;
    rest -= 1;
  }
  return shares.map((c) => c / 100);
}

/** What `documentTotals` reads from a stored invoice to rebuild its withholdings. */
export interface StoredWithholdingSource {
  invoiceType: InvoiceType;
  totals?: Pick<InvoiceCalculations, 'ivaRete1'> &
    Partial<Pick<InvoiceCalculations, 'ivaPerci1' | 'reteRenta'>> | null;
  customer?: { hasContributorRetention?: boolean } | null;
  applyRentaRetention?: boolean;
  applyIvaPerception?: boolean;
}

/**
 * The withholding decisions of an existing invoice — ONE source for the DTE,
 * the PDF and the detail totals panel, and never the company / customer flags
 * at send time. Like the 1% retention, the STORED TOTALS decide (an invoice
 * synced from another device carries its totals even when it lacks the
 * Desktop decision flags): ivaRete1 > 0, ivaPerci1 > 0, reteRenta > 0. Without
 * stored figures: the customer's retention flag, the stored applyIvaPerception
 * and applyRentaRetention (absent = withheld).
 */
export function documentWithholdings(invoice: StoredWithholdingSource): {
  hasRetention: boolean;
  options: Required<ComputeTotalsOptions>;
} {
  const t = invoice.totals;
  const hasRetention = t
    ? (t.ivaRete1 ?? 0) > 0
    : Boolean(invoice.customer?.hasContributorRetention);
  return {
    hasRetention,
    options: {
      applyRentaRetention: t && typeof t.reteRenta === 'number'
        ? t.reteRenta > 0
        : invoice.applyRentaRetention !== false,
      applyIvaPerception: t && typeof t.ivaPerci1 === 'number'
        ? t.ivaPerci1 > 0
        : invoice.applyIvaPerception === true,
    },
  };
}

/**
 * Totals of an existing invoice as its DTE / PDF report them: amounts come
 * from the lines, the withholding decisions from the stored invoice
 * (`documentWithholdings` — the DTE used to read the customer's current flag
 * while taking the amount from the stored totals).
 */
export function documentTotals(invoice: StoredWithholdingSource & { items?: InvoiceDetail[] }): InvoiceCalculations {
  const { hasRetention, options } = documentWithholdings(invoice);
  return computeTotals(invoice.items || [], invoice.invoiceType, hasRetention, options);
}
