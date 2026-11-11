import { useNavigate, useParams } from 'react-router-dom';
import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/common/Button';
import { SearchBar } from '@/components/common/SearchBar';
import { StickyToolbar } from '@/components/common/StickyToolbar';
import { DataTable, ColumnDef } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { useAppSelector } from '@/store';
import { CatalogOption } from '@/types/catalog';

type OptionRow = Record<string, unknown> & {
  id: string;
  code: string;
  description: string;
  departamento?: string;
};

function toRow(o: CatalogOption): OptionRow {
  return {
    id: o.id,
    code: o.code,
    description: o.description,
    departamento: o.departamento,
  };
}

export default function CatalogDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const catalogs = useAppSelector((s) => s.catalogs.catalogs);
  const catalog = catalogs.find((c) => c.id === id) ?? null;

  const [search, setSearch] = useState('');

  if (!catalog) {
    return (
      <div data-testid="catalog-detail" className="py-16 text-center text-brand-400">
        Catálogo no encontrado.
      </div>
    );
  }

  const filtered = catalog.options.filter(
    (o) =>
      o.code.toLowerCase().includes(search.toLowerCase()) ||
      o.description.toLowerCase().includes(search.toLowerCase())
  );

  const columns: ColumnDef<OptionRow>[] = [
    {
      key: 'code',
      label: 'Código',
      sortable: true,
      render: (val) => <span className="font-mono text-xs">{String(val)}</span>,
    },
    {
      key: 'description',
      label: 'Descripción',
      sortable: true,
    },
    {
      key: 'departamento',
      label: 'Departamento',
      render: (val) => (val ? String(val) : <span className="text-brand-300">—</span>),
    },
  ];

  return (
    <div data-testid="catalog-detail" className="space-y-4">
      <PageHeader
        title={catalog.name}
        subtitle={`${catalog.totalOptions} opciones${catalog.version ? ` — v${catalog.version}` : ''}`}
        actions={
          <Button
            variant="secondary"
            icon={<ArrowLeft size={16} />}
            onClick={() => navigate('/settings/catalogs')}
          >
            Volver
          </Button>
        }
      />

      <StickyToolbar data-testid="catalog-detail-sticky-toolbar">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Filtrar por código o descripción..."
        />
      </StickyToolbar>
      {filtered.length === 0 ? (
        <EmptyState title="Sin resultados" message="No hay opciones que coincidan con la búsqueda." />
      ) : (
        <DataTable<OptionRow>
          columns={columns}
          data={filtered.map(toRow)}
          emptyMessage="Sin opciones en este catálogo."
        />
      )}
    </div>
  );
}
