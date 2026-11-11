import React, { useCallback, useEffect, useMemo } from 'react';
import { Select } from '@/components/common/Select';
import { useAppDispatch, useAppSelector } from '@/store';
import { selectCatalogs, syncCatalogs } from '@/store/slices/catalogSlice';
import { GovernmentCatalogId, Catalog, CatalogOption } from '@/types/catalog';
import { getDistritosForMunicipio } from '@/services/catalog/distritoCatalog';

export interface LocationDropdownsProps {
  departamentoCode: string;
  departamento: string;
  municipioCode: string;
  municipio: string;
  onDepartamentoChange: (code: string, name: string) => void;
  onMunicipioChange: (code: string, name: string) => void;
  // Distrito (CAT-008, Normativa 2.0). Optional and rendered ONLY when an
  // `onDistritoChange` handler is supplied, so pre-existing callers that only
  // needed departamento + municipio keep their exact previous layout/behavior.
  // MH's Normativa 2.0 `direccion` requires a `distrito` value; omitting it (or
  // sending a guessed one) is what produces the
  // `[receptor.direccion.distrito] VALOR NO ES PERMITIDO` rejection on CCF/v4.
  distritoCode?: string;
  distrito?: string;
  onDistritoChange?: (code: string, name: string) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
}

// Hardcoded fallback departments for El Salvador (CAT-012)
const FALLBACK_DEPARTMENTS = [
  { code: '01', name: 'Ahuachapán' },
  { code: '02', name: 'Santa Ana' },
  { code: '03', name: 'Sonsonate' },
  { code: '04', name: 'Chalatenango' },
  { code: '05', name: 'La Libertad' },
  { code: '06', name: 'San Salvador' },
  { code: '07', name: 'Cuscatlán' },
  { code: '08', name: 'La Paz' },
  { code: '09', name: 'Cabañas' },
  { code: '10', name: 'San Vicente' },
  { code: '11', name: 'Usulután' },
  { code: '12', name: 'San Miguel' },
  { code: '13', name: 'Morazán' },
  { code: '14', name: 'La Unión' },
];

const NORMATIVA2_MUNICIPIO_DEPARTMENT_BY_NAME: Record<string, string> = {
  'AHUACHAPAN NORTE': '01',
  'AHUACHAPAN CENTRO': '01',
  'AHUACHAPAN SUR': '01',
  'SANTA ANA NORTE': '02',
  'SANTA ANA CENTRO': '02',
  'SANTA ANA ESTE': '02',
  'SANTA ANA OESTE': '02',
  'SONSONATE NORTE': '03',
  'SONSONATE CENTRO': '03',
  'SONSONATE ESTE': '03',
  'SONSONATE OESTE': '03',
  'CHALATENANGO NORTE': '04',
  'CHALATENANGO CENTRO': '04',
  'CHALATENANGO SUR': '04',
  'LA LIBERTAD NORTE': '05',
  'LA LIBERTAD CENTRO': '05',
  'LA LIBERTAD OESTE': '05',
  'LA LIBERTAD ESTE': '05',
  'LA LIBERTAD COSTA': '05',
  'LA LIBERTAD SUR': '05',
  'SAN SALVADOR NORTE': '06',
  'SAN SALVADOR OESTE': '06',
  'SAN SALVADOR ESTE': '06',
  'SAN SALVADOR CENTRO': '06',
  'SAN SALVADOR SUR': '06',
  'CUSCATLAN NORTE': '07',
  'CUSCATLAN SUR': '07',
  'LA PAZ OESTE': '08',
  'LA PAZ CENTRO': '08',
  'LA PAZ ESTE': '08',
  'CABANAS OESTE': '09',
  'CABANAS ESTE': '09',
  'SAN VICENTE NORTE': '10',
  'SAN VICENTE SUR': '10',
  'USULUTAN NORTE': '11',
  'USULUTAN ESTE': '11',
  'USULUTAN OESTE': '11',
  'SAN MIGUEL NORTE': '12',
  'SAN MIGUEL CENTRO': '12',
  'SAN MIGUEL OESTE': '12',
  'MORAZAN NORTE': '13',
  'MORAZAN SUR': '13',
  'LA UNION NORTE': '14',
  'LA UNION SUR': '14',
};

function normalizeCatalogName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase();
}

export function LocationDropdowns({
  departamentoCode,
  departamento,
  municipioCode,
  distritoCode,
  onDepartamentoChange,
  onMunicipioChange,
  onDistritoChange,
  disabled = false,
  required = true,
  className = '',
}: LocationDropdownsProps) {
  const dispatch = useAppDispatch();
  const catalogs = useAppSelector(selectCatalogs);
  const catalogsLoading = useAppSelector((s) => s.catalogs.loading);

  // Find departments catalog (CAT-012)
  const deptCatalog = useMemo(
    () => catalogs.find((c: Catalog) => c.id === GovernmentCatalogId.DEPARTMENTS),
    [catalogs]
  );

  // Find municipalities catalog (CAT-013)
  const muniCatalog = useMemo(
    () => catalogs.find((c: Catalog) => c.id === GovernmentCatalogId.MUNICIPALITIES),
    [catalogs]
  );

  // Auto-load catalogs if missing (bundled JSON fallback ensures this always succeeds)
  useEffect(() => {
    if (!muniCatalog && !catalogsLoading) {
      dispatch(syncCatalogs({ force: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muniCatalog]);

  // Build department options from catalog or fallback
  const departmentOptions = useMemo(() => {
    if (deptCatalog && deptCatalog.options.length > 0) {
      return deptCatalog.options.map((opt: CatalogOption) => ({
        value: opt.code,
        label: opt.description,
      }));
    }
    return FALLBACK_DEPARTMENTS.map((d) => ({ value: d.code, label: d.name }));
  }, [deptCatalog]);

  // Build municipality options filtered by selected department
  const municipioOptions = useMemo(() => {
    if (!departamentoCode) return [];
    if (muniCatalog && muniCatalog.options.length > 0) {
      const hasDepartmentMetadata = muniCatalog.options.some((opt: CatalogOption) => opt.departamento);
      const options = hasDepartmentMetadata
        ? muniCatalog.options.filter((opt: CatalogOption) => opt.departamento === departamentoCode)
        : muniCatalog.options.filter((opt: CatalogOption) => {
          const inferredDepartment = NORMATIVA2_MUNICIPIO_DEPARTMENT_BY_NAME[normalizeCatalogName(opt.description)];
          return !inferredDepartment || inferredDepartment === departamentoCode;
        });
      return options.map((opt: CatalogOption) => ({ value: opt.code, label: opt.description }));
    }
    return [];
  }, [muniCatalog, departamentoCode]);

  // Build district options (CAT-008), scoped to the selected departamento +
  // municipio via the verified `distritosScoped.json` table. Both codes are
  // required because CAT-008/CAT-013 codes reset per departamento (a municipio
  // code alone is ambiguous across departamentos). Sending a distrito that is
  // not valid for the municipio is exactly what MH rejects with
  // `[receptor.direccion.distrito] VALOR NO ES PERMITIDO`.
  const distritoOptions = useMemo(
    () =>
      getDistritosForMunicipio(departamentoCode, municipioCode).map((d) => ({
        value: d.code,
        label: d.description,
      })),
    [departamentoCode, municipioCode]
  );

  const handleDepartamentoChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const code = e.target.value;
      const name =
        departmentOptions.find((o: { value: string; label: string }) => o.value === code)?.label ?? '';
      onDepartamentoChange(code, name);
      // Reset municipio and distrito when department changes
      onMunicipioChange('', '');
      onDistritoChange?.('', '');
    },
    [departmentOptions, onDepartamentoChange, onMunicipioChange, onDistritoChange]
  );

  const handleMunicipioChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const code = e.target.value;
      const name = municipioOptions.find((o: { value: string; label: string }) => o.value === code)?.label ?? '';
      onMunicipioChange(code, name);
      // Reset distrito when municipio changes — a distrito only makes sense
      // within a municipio.
      onDistritoChange?.('', '');
    },
    [municipioOptions, onMunicipioChange, onDistritoChange]
  );

  const handleDistritoChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const code = e.target.value;
      const name = distritoOptions.find((o: { value: string; label: string }) => o.value === code)?.label ?? '';
      onDistritoChange?.(code, name);
    },
    [distritoOptions, onDistritoChange]
  );

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="grid grid-cols-2 gap-4">
        <Select
          label="Departamento"
          placeholder="Seleccione Departamento"
          value={departamentoCode}
          options={departmentOptions}
          onChange={handleDepartamentoChange}
          disabled={disabled}
          required={required}
        />

        <Select
          label="Municipio"
          placeholder={
            departamentoCode
              ? municipioOptions.length > 0
                ? 'Seleccione Municipio'
                : 'Cargando municipios...'
              : 'Seleccione un departamento primero'
          }
          value={municipioCode}
          options={municipioOptions}
          onChange={handleMunicipioChange}
          disabled={disabled || !departamentoCode}
          required={required}
        />
      </div>

      {onDistritoChange && (
        <div>
          <Select
            label="Distrito"
            placeholder={
              municipioCode
                ? distritoOptions.length > 0
                  ? 'Seleccione Distrito'
                  : 'Cargando distritos...'
                : 'Seleccione un municipio primero'
            }
            value={distritoCode ?? ''}
            options={distritoOptions}
            onChange={handleDistritoChange}
            disabled={disabled || !municipioCode}
            required={required}
          />
          <p className="mt-1 text-xs text-brand-400">
            Distrito (Normativa 2.0) — requerido por Hacienda para el CCF y demás
            documentos v4. Seleccione el distrito que corresponde al municipio.
          </p>
        </div>
      )}
    </div>
  );
}

export default LocationDropdowns;
