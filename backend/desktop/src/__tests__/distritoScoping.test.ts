import {
  getDistritosForMunicipio,
  isDistritoValidForMunicipio,
  getAllScopedDistritos,
} from '../services/catalog/distritoCatalog';

// These lock in real municipio-level distrito scoping (the follow-up to the
// initial fix, which could only offer the full unscoped CAT-008 list). The
// authority is the verified departamento -> municipio -> distrito table bundled
// as src/data/distritosScoped.json.

describe('distrito scoping (CAT-008, departamento + municipio)', () => {
  it('returns only the districts that belong to the selected municipio', () => {
    // AHUACHAPAN NORTE (dep 01 / muni 13)
    const codes = getDistritosForMunicipio('01', '13').map((d) => d.code);
    expect(codes.sort()).toEqual(['03', '05', '09', '12']);
  });

  it('a sibling municipio in the same departamento yields a disjoint set', () => {
    const norte = getDistritosForMunicipio('01', '13'); // AHUACHAPAN NORTE
    const centro = getDistritosForMunicipio('01', '14'); // AHUACHAPAN CENTRO
    const norteCodes = norte.map((d) => d.code);
    const centroCodes = centro.map((d) => d.code);

    // ATIQUIZAYA (03) belongs to NORTE and must NOT appear under CENTRO...
    expect(norteCodes).toContain('03');
    expect(centroCodes).not.toContain('03');
    // ...and AHUACHAPÁN (01) belongs to CENTRO and must NOT appear under NORTE.
    expect(centroCodes).toContain('01');
    expect(norteCodes).not.toContain('01');

    // No district is shared between the two sibling municipios.
    const overlap = norteCodes.filter((c) => centroCodes.includes(c));
    expect(overlap).toHaveLength(0);
  });

  it('is scoped by departamento (same municipio code, different departamento => different districts)', () => {
    // Municipio code "14" exists in dep 01 (AHUACHAPAN CENTRO) AND dep 02
    // (SANTA ANA NORTE). Filtering by municipio alone would wrongly merge them.
    const ahuachapan = getDistritosForMunicipio('01', '14').map((d) => d.description).sort();
    const santaAna = getDistritosForMunicipio('02', '14').map((d) => d.description).sort();
    expect(ahuachapan).not.toEqual(santaAna);
    expect(ahuachapan).toContain('AHUACHAPÁN');
    expect(santaAna).not.toContain('AHUACHAPÁN');
  });

  it('validates a distrito against its municipio', () => {
    expect(isDistritoValidForMunicipio('01', '13', '03')).toBe(true); // ATIQUIZAYA in AHUACHAPAN NORTE
    expect(isDistritoValidForMunicipio('01', '14', '03')).toBe(false); // ...not in AHUACHAPAN CENTRO
    expect(isDistritoValidForMunicipio('01', '13', '99')).toBe(false); // unknown code
    expect(isDistritoValidForMunicipio('01', '13', undefined)).toBe(false);
  });

  it('returns an empty list for missing or foreign (00) selections', () => {
    expect(getDistritosForMunicipio(undefined, undefined)).toHaveLength(0);
    expect(getDistritosForMunicipio('06', undefined)).toHaveLength(0);
    // The "00 Otro (Para extranjeros)" catch-all is intentionally excluded.
    expect(getDistritosForMunicipio('00', '00')).toHaveLength(0);
  });

  it('bundles the complete verified hierarchy (14 departamentos / 44 municipios / 262 distritos)', () => {
    const all = getAllScopedDistritos();
    expect(all).toHaveLength(262);
    const departamentos = new Set(all.map((o) => o.departamento));
    const municipios = new Set(all.map((o) => `${o.departamento}:${o.municipality}`));
    expect(departamentos.size).toBe(14);
    expect(municipios.size).toBe(44);
    // Every entry has a non-empty code + name.
    expect(all.every((o) => o.code && o.description)).toBe(true);
  });
});
