// CAT-008 Distrito lookup, scoped to (departamento, municipio).
//
// MH's flat CAT-008 catalog (bundled in `catalogs.json`) has no column linking
// a distrito to its municipio, and its codes are NOT globally unique — both the
// municipio (CAT-013) and distrito (CAT-008) codes reset per departamento. That
// is exactly what caused the `[receptor.direccion.distrito] VALOR NO ES PERMITIDO`
// rejections: a distrito that is valid in one municipio is a different (or
// invalid) value in another.
//
// `distritosScoped.json` is a trimmed copy of a fully-verified
// departamento -> municipio -> distrito table (MH CATÁLOGOS V1.1, grouping
// cross-checked against Decreto Legislativo 762 Art. 1, zero mismatches). It is
// shaped like `catalogs.json` (a catalog collection whose options carry
// `departamento` + `municipality` parent codes) so it loads the same way.

// Interop-safe JSON import: works under both the Vite/esbuild build (synthetic
// default export) and ts-jest's CommonJS transform (no default), since this
// project does not enable `esModuleInterop`.
import * as scopedCatalogModule from '../../data/distritosScoped.json';
const scopedCatalog = (scopedCatalogModule as { default?: unknown }).default ?? scopedCatalogModule;

export interface ScopedDistrito {
  /** MH CAT-008 code (2-digit, scoped to its departamento). */
  code: string;
  /** MH CAT-008 official distrito name. */
  description: string;
}

interface ScopedDistritoOption extends ScopedDistrito {
  departamento: string;
  municipality: string;
}

const DISTRITO_OPTIONS: ScopedDistritoOption[] =
  ((scopedCatalog as { catalogs?: { options?: ScopedDistritoOption[] }[] }).catalogs?.[0]?.options) ?? [];

/**
 * Districts (CAT-008) valid for a given departamento + municipio.
 *
 * BOTH codes are required: because municipio and distrito codes reset per
 * departamento, filtering by municipio alone would mix districts from
 * different departamentos that happen to share a municipio code.
 */
export function getDistritosForMunicipio(
  departamentoCode?: string,
  municipioCode?: string,
): ScopedDistrito[] {
  if (!departamentoCode || !municipioCode) return [];
  return DISTRITO_OPTIONS.filter(
    (o) => o.departamento === departamentoCode && o.municipality === municipioCode,
  ).map((o) => ({ code: o.code, description: o.description }));
}

/** True when `distritoCode` is a valid CAT-008 district for the departamento+municipio. */
export function isDistritoValidForMunicipio(
  departamentoCode?: string,
  municipioCode?: string,
  distritoCode?: string,
): boolean {
  if (!distritoCode) return false;
  return getDistritosForMunicipio(departamentoCode, municipioCode).some(
    (d) => d.code === distritoCode,
  );
}

/** All scoped distrito options — primarily for integrity checks/tests. */
export function getAllScopedDistritos(): ReadonlyArray<ScopedDistritoOption> {
  return DISTRITO_OPTIONS;
}
