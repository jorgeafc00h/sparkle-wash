// Scale (weight / price-embedded) EAN-13 labels — POS Phase 2, design §4.
//
// Shop scales print restricted-circulation EAN-13 codes (GS1 prefix 2x):
//
//   [prefix][flag digits…][PLU][value][check]
//
// The value (grams or cents) sits right before the check digit and the PLU
// right before the value; whatever lies between the configured prefix and the
// PLU (the scale's format/flag digit, e.g. the "0" of "20") is ignored. So
// prefix "2" + PLU 5 + weight 5 reads both "2 0 00123 01250 K" and
// "21 00123 01250 K" style labels. The EAN-13 check digit is always validated:
// a mis-read label never adds the wrong weight.

import { roundQuantity } from './posQuantity';

export interface ScaleBarcodeSettings {
  enabled: boolean;
  /** Leading digits that mark a scale label (1–2 digits, default "2"). */
  prefix: string;
  /** PLU digits (product code on the scale), default 5. */
  pluLength: number;
  /** What the value encodes: weight in grams or price in cents. */
  valueKind: 'weight' | 'price';
  /** Value digits, default 5. */
  valueLength: number;
}

export const DEFAULT_SCALE_BARCODES: ScaleBarcodeSettings = {
  enabled: false,
  prefix: '2',
  pluLength: 5,
  valueKind: 'weight',
  valueLength: 5,
};

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

/** Stored settings may be partial or hand-edited: every bad field falls back to the default. */
export function normalizeScaleBarcodeSettings(raw: unknown): ScaleBarcodeSettings {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const prefix = typeof r.prefix === 'string' && /^\d{1,2}$/.test(r.prefix) ? r.prefix : DEFAULT_SCALE_BARCODES.prefix;
  let pluLength = clampInt(r.pluLength, 4, 6, DEFAULT_SCALE_BARCODES.pluLength);
  let valueLength = clampInt(r.valueLength, 4, 6, DEFAULT_SCALE_BARCODES.valueLength);
  // prefix + PLU + value + check digit must fit in 13 digits.
  if (prefix.length + pluLength + valueLength > 12) {
    pluLength = DEFAULT_SCALE_BARCODES.pluLength;
    valueLength = DEFAULT_SCALE_BARCODES.valueLength;
  }
  return {
    enabled: r.enabled === true,
    prefix,
    pluLength,
    valueKind: r.valueKind === 'price' ? 'price' : 'weight',
    valueLength,
  };
}

/** Why a settings form can't be saved (null = valid). */
export function validateScaleBarcodeSettings(s: ScaleBarcodeSettings): string | null {
  if (!/^\d{1,2}$/.test(s.prefix)) return 'El prefijo debe tener 1 o 2 dígitos (normalmente 2).';
  if (!Number.isInteger(s.pluLength) || s.pluLength < 4 || s.pluLength > 6) return 'El PLU debe tener entre 4 y 6 dígitos.';
  if (!Number.isInteger(s.valueLength) || s.valueLength < 4 || s.valueLength > 6) return 'El valor debe tener entre 4 y 6 dígitos.';
  if (s.prefix.length + s.pluLength + s.valueLength > 12) {
    return 'Prefijo + PLU + valor no caben en un EAN-13 (máximo 12 dígitos más el verificador).';
  }
  return null;
}

/** EAN-13 check digit of the first 12 digits. */
export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new Error('EAN-13: se esperan 12 dígitos');
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

export interface ParsedScaleBarcode {
  plu: string;
  kind: 'weight' | 'price';
  /** Grams (weight) or cents (price). */
  value: number;
}

/** Parses a scanned code as a scale label; null when it isn't one (or fails the check digit). */
export function parseScaleBarcode(code: string, settings: ScaleBarcodeSettings): ParsedScaleBarcode | null {
  if (!settings.enabled) return null;
  const trimmed = (code ?? '').trim();
  if (!/^\d{13}$/.test(trimmed) || !trimmed.startsWith(settings.prefix)) return null;
  if (settings.prefix.length + settings.pluLength + settings.valueLength > 12) return null;
  if (!isValidEan13(trimmed)) return null;
  const valueStart = 12 - settings.valueLength;
  const pluStart = valueStart - settings.pluLength;
  const plu = trimmed.slice(pluStart, valueStart);
  const value = Number(trimmed.slice(valueStart, 12));
  if (!Number.isFinite(value) || value <= 0) return null;
  return { plu, kind: settings.valueKind, value };
}

const stripLeadingZeros = (value: string): string => value.replace(/^0+(?=.)/, '');

/** PLU match against a product's barcode or code: exact, leading zeros ignored. */
export function productMatchesPlu(product: { barcode?: string; productCode?: string }, plu: string): boolean {
  const wanted = stripLeadingZeros(plu.trim());
  if (!wanted) return false;
  return [product.barcode, product.productCode].some(
    (candidate) => typeof candidate === 'string' && candidate.trim() !== '' && stripLeadingZeros(candidate.trim()) === wanted,
  );
}

const GRAMS_PER_POUND = 453.59237;

/**
 * Quantity a label adds for a product: weight → kg (grams for GR products,
 * pounds for LB products); price → price / unit price, 3 decimals.
 * Null when it can't be derived (a price label on a $0 product).
 */
export function scaleLabelQuantity(
  parsed: ParsedScaleBarcode,
  product: { unitPrice: number; unitOfMeasure?: string },
): number | null {
  if (parsed.kind === 'weight') {
    const unit = (product.unitOfMeasure ?? '').toUpperCase();
    if (unit === 'GR' || unit === 'GRAMO' || unit === 'GRAMOS') return parsed.value;
    if (unit === 'LB' || unit === 'LIBRA' || unit === 'LIBRAS') return roundQuantity(parsed.value / GRAMS_PER_POUND);
    return roundQuantity(parsed.value / 1000);
  }
  if (!(product.unitPrice > 0)) return null;
  const quantity = roundQuantity(parsed.value / 100 / product.unitPrice);
  return quantity > 0 ? quantity : null;
}

/** Builds a valid label (tests, docs, the settings preview). Flag digits are zeros. */
export function buildScaleBarcode(settings: ScaleBarcodeSettings, plu: string | number, value: number): string {
  const pluDigits = String(plu).padStart(settings.pluLength, '0').slice(-settings.pluLength);
  const valueDigits = String(Math.round(value)).padStart(settings.valueLength, '0').slice(-settings.valueLength);
  const filler = '0'.repeat(12 - settings.prefix.length - settings.pluLength - settings.valueLength);
  const first12 = `${settings.prefix}${filler}${pluDigits}${valueDigits}`;
  return `${first12}${ean13CheckDigit(first12)}`;
}
