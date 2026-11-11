// Register quantities (POS Phase 2, design §4). Weighable units accept
// decimal quantities (3 decimals); everything else sells in whole units ≥ 1.
// `N*` typed in the search box before choosing/scanning a product adds N units.

/** Unit codes (and the UnitOfMeasure enum names) sold by weight / volume / length. */
const WEIGHABLE = new Set([
  'KG', 'GR', 'LB', 'LT', 'MT', 'GAL', 'M2', 'M3', 'TON',
  'KILOGRAMO', 'KILOGRAMOS', 'GRAMO', 'GRAMOS', 'LIBRA', 'LIBRAS', 'LITRO', 'LITROS',
  'METRO', 'METROS', 'GALON', 'GALONES', 'METRO_CUADRADO', 'METRO_CUBICO', 'TONELADA', 'TONELADAS',
]);

export function isWeighableUnit(unit: string | null | undefined): boolean {
  if (!unit) return false;
  const key = unit.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
  return WEIGHABLE.has(key);
}

export const QUANTITY_DECIMALS = 3;
/** Most units one line can carry (a typo / a barcode typed into the field). */
export const MAX_LINE_QUANTITY = 99_999;

export function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

export type QuantityParseResult =
  | { ok: true; quantity: number }
  | { ok: false; reason: 'empty' | 'invalid' | 'fraction' | 'non-positive' | 'too-large' };

/** Spanish message for a refused quantity (toast / inline hint). */
export function quantityErrorMessage(reason: Exclude<QuantityParseResult, { ok: true }>['reason']): string {
  switch (reason) {
    case 'fraction':
      return 'Este producto se vende por unidad: la cantidad debe ser un número entero.';
    case 'non-positive':
      return 'La cantidad debe ser mayor que cero.';
    case 'too-large':
      return `La cantidad no puede pasar de ${MAX_LINE_QUANTITY.toLocaleString('es-SV')}.`;
    default:
      return 'Cantidad no válida.';
  }
}

/** Accepts "1.25", "1,25", "3" — decimals only when the unit is weighable. */
export function parseQuantityInput(raw: string | number, weighable: boolean): QuantityParseResult {
  const text = String(raw ?? '').trim().replace(',', '.');
  if (!text) return { ok: false, reason: 'empty' };
  if (!/^\d*\.?\d*$/.test(text) || text === '.') return { ok: false, reason: 'invalid' };
  const value = Number(text);
  if (!Number.isFinite(value)) return { ok: false, reason: 'invalid' };
  if (value <= 0) return { ok: false, reason: 'non-positive' };
  if (value > MAX_LINE_QUANTITY) return { ok: false, reason: 'too-large' };
  if (weighable) {
    const quantity = roundQuantity(value);
    return quantity > 0 ? { ok: true, quantity } : { ok: false, reason: 'non-positive' };
  }
  if (!Number.isInteger(value)) return { ok: false, reason: 'fraction' };
  return { ok: true, quantity: value };
}

export interface SearchWithMultiplier {
  /** Units requested with the `N*` prefix (undefined = none typed). */
  multiplier?: number;
  /** The raw multiplier text ("1,5") for display. */
  multiplierText?: string;
  /** What remains after the prefix — the code or name being searched. */
  term: string;
}

const MULTIPLIER = /^\s*(\d+(?:[.,]\d+)?)\s*\*\s*(.*)$/;

/** Splits "3*7501234" → { multiplier: 3, term: "7501234" }; "café" → { term: "café" }. */
export function parseMultiplierPrefix(search: string): SearchWithMultiplier {
  const match = MULTIPLIER.exec(search ?? '');
  if (!match) return { term: search ?? '' };
  const multiplier = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(multiplier) || multiplier <= 0) return { term: search };
  return { multiplier, multiplierText: match[1], term: match[2] ?? '' };
}

/** Display a quantity without trailing zeros: 1.25 → "1.25", 3 → "3", 1.2 → "1.2". */
export function formatQuantity(quantity: number): string {
  const rounded = roundQuantity(quantity);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(QUANTITY_DECIMALS).replace(/0+$/, '');
}
