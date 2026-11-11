import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, BookOpen } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { EmptyState } from '@/components/common/EmptyState';
import { SearchBar } from '@/components/common/SearchBar';
import { StickyToolbar } from '@/components/common/StickyToolbar';
import { useToast } from '@/components/common/Toast';
import { useAppSelector, useAppDispatch } from '@/store';
import { syncCatalogs } from '@/store/slices/catalogSlice';

export default function CatalogsPage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const toast = useToast();
  const { catalogs, loading, lastFullSync } = useAppSelector((s) => s.catalogs);
  const [search, setSearch] = useState('');

  // Auto-sync on first visit when catalogs are empty (matches iOS app behavior)
  useEffect(() => {
    if (catalogs.length === 0 && !loading) {
      dispatch(syncCatalogs({ force: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSync() {
    try {
      await dispatch(syncCatalogs({ force: true })).unwrap();
      toast.success('Catálogos sincronizados correctamente.');
    } catch {
      toast.error('Error al sincronizar los catálogos. Verifica tu conexión.');
    }
  }

  const filteredCatalogs = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return catalogs;
    return catalogs.filter(
      (c) =>
        c.id.toLowerCase().includes(term) ||
        c.name.toLowerCase().includes(term) ||
        c.description?.toLowerCase().includes(term) ||
        c.options.some((option) =>
          option.code.toLowerCase().includes(term) ||
          option.description.toLowerCase().includes(term)
        ),
    );
  }, [catalogs, search]);

  return (
    <div data-testid="catalogs" className="space-y-4">
      <PageHeader
        title="Catálogos"
        subtitle="Catálogos del Ministerio de Hacienda"
        actions={
          <div className="flex items-center gap-3">
            {lastFullSync && (
              <span className="text-xs text-brand-400">
                Última sync: {new Date(lastFullSync).toLocaleString('es-SV')}
              </span>
            )}
            <Button
              variant="primary"
              icon={<RefreshCw size={16} className={loading ? 'animate-spin' : ''} />}
              onClick={handleSync}
              loading={loading}
            >
              Sincronizar Catálogos
            </Button>
          </div>
        }
      />

      {catalogs.length > 0 && (
        <StickyToolbar>
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Buscar por código, nombre u opción del catálogo…"
          />
        </StickyToolbar>
      )}

      {catalogs.length === 0 ? (
        <EmptyState
          icon={<BookOpen size={28} />}
          title="No hay catálogos cargados"
          message="Sincroniza los catálogos del Ministerio de Hacienda para comenzar."
          action={{ label: 'Sincronizar ahora', onClick: handleSync }}
        />
      ) : filteredCatalogs.length === 0 ? (
        <p className="text-center text-brand-400 py-10 text-sm">
          No hay catálogos que coincidan con "{search}".
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCatalogs.map((catalog) => (
            <button
              key={catalog.id}
              onClick={() => navigate(`/settings/catalogs/${catalog.id}`)}
              className="text-left p-4 bg-white rounded-lg border border-brand-100 shadow-sm hover:shadow-md hover:border-brand-200 transition-all"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-mono text-brand-400 mb-0.5">{catalog.id}</p>
                  <p className="font-semibold text-brand-800 text-sm leading-snug">{catalog.name}</p>
                </div>
                <Badge variant={catalog.isActive ? 'success' : 'neutral'} size="sm">
                  {catalog.isActive ? 'Activo' : 'Inactivo'}
                </Badge>
              </div>
              {catalog.description && (
                <p className="text-xs text-brand-400 mb-2 line-clamp-2">{catalog.description}</p>
              )}
              <div className="flex items-center justify-between text-xs text-brand-500">
                <span>{catalog.totalOptions} opciones</span>
                {catalog.lastUpdated && (
                  <span>{new Date(catalog.lastUpdated).toLocaleDateString('es-SV')}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
