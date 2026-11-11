import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Search, RefreshCw } from 'lucide-react';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { useAppDispatch, useAppSelector } from '@/store';
import { selectCatalogs, syncCatalogs } from '@/store/slices/catalogSlice';
import type { Catalog, CatalogOption } from '@/types/catalog';

export interface CatalogPickerProps {
  catalogId: string;
  label: string;
  placeholder?: string;
  value: string; // currently selected code
  description: string; // currently selected description
  onChange: (code: string, description: string) => void;
  required?: boolean;
  disabled?: boolean;
  error?: string;
  filter?: (opt: CatalogOption) => boolean;
}

export function CatalogPicker({
  catalogId,
  label,
  placeholder = 'Seleccionar…',
  value,
  description,
  onChange,
  required,
  disabled,
  error,
  filter,
}: CatalogPickerProps) {
  const dispatch = useAppDispatch();
  const catalogs = useAppSelector(selectCatalogs);
  const catalogsLoading = useAppSelector((s) => s.catalogs.loading);

  const catalog = useMemo<Catalog | undefined>(
    () => (catalogs as Catalog[]).find((c) => c.id === catalogId),
    [catalogs, catalogId],
  );

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  // Auto-sync if catalog missing
  useEffect(() => {
    if (!catalog && !catalogsLoading) {
      dispatch(syncCatalogs({ force: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog?.id]);

  const options = useMemo(() => {
    const base = catalog?.options ?? [];
    const filtered = filter ? base.filter(filter) : base;
    const term = search.trim().toLowerCase();
    if (!term) return filtered;
    return filtered.filter(
      (o) =>
        o.code.toLowerCase().includes(term) ||
        o.description.toLowerCase().includes(term),
    );
  }, [catalog, filter, search]);

  const buttonLabel =
    value && description
      ? `${value} — ${description}`
      : value
        ? value
        : placeholder;

  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-brand-700">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>

      <button
        type="button"
        onClick={() => !disabled && setOpen(true)}
        disabled={disabled}
        className={[
          'w-full flex items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2 text-sm text-left transition-colors',
          error
            ? 'border-red-400 focus:border-red-500'
            : 'border-brand-300 hover:border-brand-400 focus:border-accent-500',
          disabled ? 'opacity-60 cursor-not-allowed bg-brand-50' : 'cursor-pointer',
          value ? 'text-brand-800' : 'text-brand-400',
        ].join(' ')}
      >
        <span className="truncate">{buttonLabel}</span>
        <ChevronDown size={16} className="text-brand-400 shrink-0" />
      </button>

      {error && <p className="text-xs text-red-600 mt-0.5">{error}</p>}

      <Modal
        isOpen={open}
        onClose={() => {
          setOpen(false);
          setSearch('');
        }}
        title={label}
        size="lg"
      >
        <div className="space-y-3">
          {/* Search */}
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-400"
            />
            <input
              type="text"
              data-autofocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por código o descripción…"
              className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg border border-brand-300 focus:border-accent-500 focus:ring-1 focus:ring-accent-300 outline-none"
            />
          </div>

          {/* Option list */}
          <div className="max-h-[55vh] overflow-y-auto -mx-1">
            {!catalog ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <p className="text-sm text-brand-500 mb-3">
                  {catalogsLoading
                    ? 'Cargando catálogo…'
                    : 'No se pudo cargar el catálogo.'}
                </p>
                {!catalogsLoading && (
                  <Button
                    variant="secondary"
                    icon={<RefreshCw size={14} />}
                    onClick={() => dispatch(syncCatalogs({ force: true }))}
                  >
                    Reintentar sincronización
                  </Button>
                )}
              </div>
            ) : options.length === 0 ? (
              <p className="text-center text-brand-400 py-10 text-sm">
                No hay resultados para "{search}".
              </p>
            ) : (
              <ul className="divide-y divide-brand-100">
                {options.map((opt) => {
                  const isSelected = opt.code === value;
                  return (
                    <li key={`${opt.catalogId}-${opt.code}-${opt.id}`}>
                      <button
                        type="button"
                        onClick={() => {
                          onChange(opt.code, opt.description);
                          setOpen(false);
                          setSearch('');
                        }}
                        className={[
                          'w-full text-left px-3 py-2.5 flex items-start gap-3 rounded-md transition-colors',
                          isSelected
                            ? 'bg-accent-50 text-accent-800'
                            : 'hover:bg-brand-50',
                        ].join(' ')}
                      >
                        <span
                          className={[
                            'font-mono text-xs rounded px-2 py-0.5 shrink-0 mt-0.5',
                            isSelected
                              ? 'bg-accent-600 text-white'
                              : 'bg-brand-100 text-brand-700',
                          ].join(' ')}
                        >
                          {opt.code}
                        </span>
                        <span className="text-sm flex-1">{opt.description}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {catalog && (
            <p className="text-xs text-brand-400 pt-1">
              {options.length} resultado{options.length === 1 ? '' : 's'}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}

export default CatalogPicker;
