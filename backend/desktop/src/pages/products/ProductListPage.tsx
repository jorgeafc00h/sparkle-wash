import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCan } from '@/hooks/useLocalUsers';
import { Package } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/common/Button';
import { SearchBar } from '@/components/common/SearchBar';
import { StickyToolbar } from '@/components/common/StickyToolbar';
import { DataTable, ColumnDef } from '@/components/common/DataTable';
import { Badge } from '@/components/common/Badge';
import { EmptyState } from '@/components/common/EmptyState';
import { useAppSelector, useAppDispatch } from '@/store';
import { selectCurrentCompanyProducts } from '@/store/selectors/productSelectors';
import { setSearchTerm } from '@/store/slices/productSlice';
import { Product, TaxCategory, UnitOfMeasure, ProductStatus } from '@/types/product';

const taxCategoryLabel: Record<TaxCategory, string> = {
  [TaxCategory.GRAVADO]: 'Gravado',
  [TaxCategory.EXENTO]: 'Exento',
  [TaxCategory.NO_GRAVADO]: 'No Gravado',
  [TaxCategory.EXPORTACION]: 'Exportación',
};

const taxCategoryVariant: Record<TaxCategory, 'success' | 'neutral' | 'warning' | 'info'> = {
  [TaxCategory.GRAVADO]: 'success',
  [TaxCategory.EXENTO]: 'neutral',
  [TaxCategory.NO_GRAVADO]: 'warning',
  [TaxCategory.EXPORTACION]: 'info',
};

const unitOfMeasureLabel: Record<UnitOfMeasure, string> = {
  [UnitOfMeasure.UNIDAD]: 'Unidad',
  [UnitOfMeasure.METRO]: 'Metro',
  [UnitOfMeasure.KILOGRAMO]: 'Kilogramo',
  [UnitOfMeasure.LITRO]: 'Litro',
  [UnitOfMeasure.CAJA]: 'Caja',
  [UnitOfMeasure.DOCENA]: 'Docena',
  [UnitOfMeasure.HORA]: 'Hora',
  [UnitOfMeasure.SERVICIO]: 'Servicio',
  [UnitOfMeasure.METRO_CUADRADO]: 'Metro Cuadrado',
  [UnitOfMeasure.METRO_CUBICO]: 'Metro Cúbico',
  [UnitOfMeasure.GRAMO]: 'Gramo',
  [UnitOfMeasure.TONELADA]: 'Tonelada',
  [UnitOfMeasure.GALÓN]: 'Galón',
  [UnitOfMeasure.PULGADA]: 'Pulgada',
  [UnitOfMeasure.PIE]: 'Pie',
  [UnitOfMeasure.YARDA]: 'Yarda',
};

const columns: ColumnDef<Record<string, unknown>>[] = [
  {
    key: 'productName',
    label: 'Nombre',
    sortable: true,
    render: (_val, row) => {
      const p = row as unknown as Product;
      return (
        <div className="flex items-center gap-3">
          {p.photoUrl ? (
            <img
              src={p.photoUrl}
              alt={p.productName}
              data-testid="product-row-photo"
              className="w-10 h-10 rounded-lg object-cover border border-brand-100 flex-shrink-0"
            />
          ) : null}
          <div className="min-w-0">
            <span className="font-medium text-brand-900">{p.productName}</span>
            {p.isService && (
              <span className="ml-2 text-xs text-brand-400">(Servicio)</span>
            )}
            {p.category && (
              <span className="block text-[11px] text-brand-400">{p.category}</span>
            )}
          </div>
        </div>
      );
    },
  },
  {
    key: 'productCode',
    label: 'Código',
    render: (_val, row) => {
      const p = row as unknown as Product;
      return (
        <div>
          <span className="text-xs font-mono text-brand-600">{p.productCode || '—'}</span>
          {p.barcode && (
            <span className="block text-[10px] font-mono text-brand-400" title="Código de barras (escaneable en el POS)">
              ▎{p.barcode}
            </span>
          )}
        </div>
      );
    },
  },
  {
    key: 'unitPrice',
    label: 'Precio',
    sortable: true,
    render: (_val, row) => {
      const p = row as unknown as Product;
      return (
        <span className="font-medium text-brand-900">
          ${p.unitPrice.toFixed(2)}
        </span>
      );
    },
  },
  {
    key: 'unitOfMeasure',
    label: 'Unidad',
    render: (_val, row) => {
      const p = row as unknown as Product;
      return <span>{unitOfMeasureLabel[p.unitOfMeasure] ?? p.unitOfMeasure}</span>;
    },
  },
  {
    key: 'taxCategory',
    label: 'Cat. Fiscal',
    render: (_val, row) => {
      const p = row as unknown as Product;
      return (
        <Badge variant={taxCategoryVariant[p.taxCategory]}>
          {taxCategoryLabel[p.taxCategory]}
        </Badge>
      );
    },
  },
  {
    key: 'stock',
    label: 'Stock',
    sortable: true,
    render: (_val, row) => {
      const p = row as unknown as Product;
      if (p.isService) return <span className="text-brand-400">—</span>;
      const track = p.trackInventory ?? p.hasInventory ?? true;
      if (!track) return <span className="text-brand-400">No controlado</span>;
      const stock = p.stock ?? p.stockQuantity ?? 0;
      const threshold = p.lowStockThreshold ?? p.minStock ?? 5;
      if (stock <= 0) {
        return (
          <div className="flex items-center gap-2">
            <span>{stock}</span>
            <Badge variant="error">Sin stock</Badge>
          </div>
        );
      }
      if (stock <= threshold) {
        return (
          <div className="flex items-center gap-2">
            <span>{stock}</span>
            <Badge variant="warning">Stock bajo</Badge>
          </div>
        );
      }
      return (
        <div className="flex items-center gap-2">
          <span>{stock}</span>
          <Badge variant="success">En stock</Badge>
        </div>
      );
    },
  },
  {
    key: 'isActive',
    label: 'Estado',
    render: (_val, row) => {
      const p = row as unknown as Product;
      // Legacy/seeded products may not carry isActive — default active.
      const isActive = p.isActive !== false && p.status !== ProductStatus.Inactive && p.status !== ProductStatus.Discontinued;
      return isActive ? (
        <Badge variant="success">Activo</Badge>
      ) : (
        <Badge variant="error">Inactivo</Badge>
      );
    },
  },
];

export default function ProductListPage() {
  const navigate = useNavigate();
  const canAdjustStock = useCan('products.stock');
  const dispatch = useAppDispatch();
  const products = useAppSelector(selectCurrentCompanyProducts);
  const searchTerm = useAppSelector((state) => state.products.searchTerm);
  const managedCategories = useAppSelector((state) => state.products.categories);
  const [stockFilter, setStockFilter] = useState<'ALL' | 'LOW' | 'OUT' | 'SERVICES'>('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');

  function handleSearch(value: string) {
    dispatch(setSearchTerm(value));
  }

  // Dropdown options: categories with products in this company plus the
  // managed list (categories created in Configuración may not be in use yet).
  const categoryOptions = useMemo(() => {
    const inUse = new Set(products.map((p) => p.category).filter(Boolean) as string[]);
    return Array.from(new Set([...inUse, ...managedCategories])).sort((a, b) =>
      a.localeCompare(b, 'es'),
    );
  }, [products, managedCategories]);

  // Inventory pulse — the owner's at-a-glance health check before opening
  // the POS or ordering supplies.
  const stats = useMemo(() => {
    const goods = products.filter((p) => !p.isService && (p.trackInventory ?? p.hasInventory ?? true));
    const low = goods.filter((p) => {
      const stock = p.stock ?? p.stockQuantity ?? 0;
      return stock > 0 && stock <= (p.lowStockThreshold ?? p.minStock ?? 5);
    }).length;
    const out = goods.filter((p) => (p.stock ?? p.stockQuantity ?? 0) <= 0).length;
    const value = goods.reduce(
      (sum, p) => sum + (p.stock ?? p.stockQuantity ?? 0) * (p.cost ?? 0),
      0,
    );
    return { total: products.length, goods: goods.length, low, out, value };
  }, [products]);

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return products
      .filter((p) => {
        if (stockFilter === 'SERVICES') return !!p.isService;
        if (stockFilter === 'LOW' || stockFilter === 'OUT') {
          if (p.isService || !(p.trackInventory ?? p.hasInventory ?? true)) return false;
          const stock = p.stock ?? p.stockQuantity ?? 0;
          return stockFilter === 'OUT' ? stock <= 0 : stock > 0 && stock <= (p.lowStockThreshold ?? p.minStock ?? 5);
        }
        return true;
      })
      .filter((p) => (categoryFilter === 'ALL' ? true : p.category === categoryFilter))
      .filter((p) =>
        term
          ? p.productName.toLowerCase().includes(term) ||
            p.productCode?.toLowerCase().includes(term) ||
            // Barcode matters now that the POS scans it.
            (p.barcode ?? '').includes(term) ||
            p.description?.toLowerCase().includes(term)
          : true,
      );
  }, [products, searchTerm, stockFilter, categoryFilter]);

  const tableData = filtered as unknown as Record<string, unknown>[];

  function handleRowClick(row: Record<string, unknown>) {
    const p = row as unknown as Product;
    navigate(`/products/${p.id}`);
  }

  return (
    <div data-testid="product-list">
      <PageHeader
        title="Productos"
        subtitle="Catálogo de productos y servicios"
        actions={
          <div className="flex gap-2">
            {canAdjustStock && (
              <Button
                variant="secondary"
                icon={<Package size={16} />}
                onClick={() => navigate('/products/stock-adjustment')}
                data-testid="stock-adjustment-btn"
              >
                Ajuste de Inventario
              </Button>
            )}
            <Button
              variant="primary"
              onClick={() => navigate('/products/add')}
              data-testid="add-product-btn"
            >
              Agregar Producto
            </Button>
          </div>
        }
      />

      {/* Inventory health summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4" data-testid="product-inventory-summary">
        <div
          data-testid="stat-total-products"
          className="rounded-lg border border-brand-100 bg-white p-3 cursor-pointer hover:border-accent-400"
          onClick={() => setStockFilter('ALL')}
        >
          <p className="text-xs text-brand-500">Productos</p>
          <p className="text-xl font-bold text-brand-900">{stats.total}</p>
          <p className="text-[11px] text-brand-400">{stats.goods} con inventario</p>
        </div>
        <button
          data-testid="stat-low-stock"
          onClick={() => setStockFilter(stockFilter === 'LOW' ? 'ALL' : 'LOW')}
          className={`text-left rounded-lg border p-3 transition-colors ${stockFilter === 'LOW' ? 'border-amber-400 bg-amber-50' : 'border-amber-200 bg-white hover:border-amber-400'}`}
        >
          <p className="text-xs text-amber-600">Stock bajo</p>
          <p className="text-xl font-bold text-amber-800">{stats.low}</p>
          <p className="text-[11px] text-amber-500">al nivel mínimo</p>
        </button>
        <button
          data-testid="stat-out-of-stock"
          onClick={() => setStockFilter(stockFilter === 'OUT' ? 'ALL' : 'OUT')}
          className={`text-left rounded-lg border p-3 transition-colors ${stockFilter === 'OUT' ? 'border-red-400 bg-red-50' : 'border-red-200 bg-white hover:border-red-400'}`}
        >
          <p className="text-xs text-red-500">Agotados</p>
          <p className="text-xl font-bold text-red-700">{stats.out}</p>
          <p className="text-[11px] text-red-400">sin existencia</p>
        </button>
        <div className="rounded-lg border border-brand-100 bg-white p-3">
          <p className="text-xs text-brand-500">Valor inventario (costo)</p>
          <p className="text-xl font-bold text-brand-900">${stats.value.toFixed(2)}</p>
          <p className="text-[11px] text-brand-400">{stats.value > 0 ? 'según costo registrado' : 'define costos para verlo'}</p>
        </div>
      </div>

      <StickyToolbar data-testid="product-sticky-toolbar">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBar
            value={searchTerm}
            onChange={handleSearch}
            placeholder="Buscar por nombre, código o código de barras..."
            data-testid="product-search"
          />
          {(['ALL', 'LOW', 'OUT', 'SERVICES'] as const).map((f) => (
            <button
              key={f}
              data-testid={`filter-chip-${f}`}
              onClick={() => setStockFilter(f)}
              className={`px-2.5 py-1.5 rounded-full text-xs border whitespace-nowrap ${
                stockFilter === f
                  ? 'bg-accent-600 text-white border-accent-600'
                  : 'bg-white text-brand-700 border-brand-300 hover:bg-brand-50'
              }`}
            >
              {f === 'ALL' ? 'Todos' : f === 'LOW' ? 'Stock bajo' : f === 'OUT' ? 'Agotados' : 'Servicios'}
            </button>
          ))}

          <div className="ml-auto flex items-center gap-2">
            <label htmlFor="category-filter" className="text-xs text-brand-500 whitespace-nowrap">
              Categoría
            </label>
            <select
              id="category-filter"
              data-testid="category-filter"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-lg border border-brand-300 bg-white px-2.5 py-1.5 text-sm text-brand-800 focus:border-accent-500 focus:outline-none"
            >
              <option value="ALL">Todas las categorías</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c} data-testid={`category-option-${c}`}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

      </StickyToolbar>

      {products.length === 0 && !searchTerm ? (
        <EmptyState
          icon={<Package size={28} />}
          title="No hay productos"
          message="Comience agregando su primer producto o servicio."
          action={{ label: 'Agregar Producto', onClick: () => navigate('/products/add') }}
        />
      ) : (
        <DataTable
          columns={columns}
          data={tableData}
          onRowClick={handleRowClick}
          emptyMessage="No se encontraron productos con ese criterio."
        />
      )}
    </div>
  );
}
