import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Minus, Package, Save, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { Badge } from '@/components/common/Badge';
import { SearchBar } from '@/components/common/SearchBar';
import { StickyToolbar } from '@/components/common/StickyToolbar';
import { useAppSelector, useAppDispatch } from '@/store';
import { selectAllProducts } from '@/store/selectors/productSelectors';
import { selectAuditActor } from '@/store/selectors/localUsersSelectors';
import { updateProduct, recordStockMovement } from '@/store/slices/productSlice';
import { useToast } from '@/components/common/Toast';
import { Product } from '@/types/product';

const REASON_OPTIONS = [
  { value: 'Compra', label: 'Compra' },
  { value: 'Venta Manual', label: 'Venta Manual' },
  { value: 'Ajuste de Inventario', label: 'Ajuste de Inventario' },
  { value: 'Merma/Pérdida', label: 'Merma/Pérdida' },
  { value: 'Devolución', label: 'Devolución' },
];

interface AdjustmentRow {
  adjustment: number;
  adjustmentInput: string;
  reason: string;
}

type AdjustmentMap = Record<string, AdjustmentRow>;

function getStock(product: Product): number {
  return product.stock ?? product.stockQuantity ?? 0;
}

export default function StockAdjustmentPage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const toast = useToast();

  const products = useAppSelector(selectAllProducts);
  const auditActor = useAppSelector(selectAuditActor);
  const managedCategories = useAppSelector((state) => state.products.categories);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [adjustments, setAdjustments] = useState<AdjustmentMap>({});
  const [saving, setSaving] = useState(false);

  // Only show products that have inventory (non-services)
  const inventoryProducts = useMemo(() => {
    return products.filter((p) => !p.isService && (p.trackInventory ?? p.hasInventory ?? true));
  }, [products]);

  const categoryOptions = useMemo(() => {
    const inUse = new Set(inventoryProducts.map((p) => p.category).filter(Boolean) as string[]);
    return Array.from(new Set([...inUse, ...managedCategories])).sort((a, b) =>
      a.localeCompare(b, 'es'),
    );
  }, [inventoryProducts, managedCategories]);

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return inventoryProducts
      .filter((p) => (categoryFilter === 'ALL' ? true : p.category === categoryFilter))
      .filter(
        (p) =>
          !term ||
          p.productName.toLowerCase().includes(term) ||
          p.productCode?.toLowerCase().includes(term),
      );
  }, [inventoryProducts, searchTerm, categoryFilter]);

  function getRow(productId: string): AdjustmentRow {
    return adjustments[productId] ?? { adjustment: 0, adjustmentInput: '', reason: 'Ajuste de Inventario' };
  }

  function setAdjustmentValue(productId: string, rawValue: string) {
    const parsed = parseInt(rawValue, 10);
    const adjustment = isNaN(parsed) ? 0 : parsed;
    setAdjustments((prev) => ({
      ...prev,
      [productId]: {
        ...getRow(productId),
        adjustment,
        adjustmentInput: rawValue,
      },
    }));
  }

  function incrementAdjustment(productId: string) {
    const row = getRow(productId);
    const next = row.adjustment + 1;
    setAdjustments((prev) => ({
      ...prev,
      [productId]: { ...row, adjustment: next, adjustmentInput: String(next) },
    }));
  }

  function decrementAdjustment(productId: string) {
    const row = getRow(productId);
    const next = row.adjustment - 1;
    setAdjustments((prev) => ({
      ...prev,
      [productId]: { ...row, adjustment: next, adjustmentInput: String(next) },
    }));
  }

  function setReason(productId: string, reason: string) {
    setAdjustments((prev) => ({
      ...prev,
      [productId]: { ...getRow(productId), reason },
    }));
  }

  // Rows that have a non-zero adjustment
  const modifiedProducts = inventoryProducts.filter((p) => {
    const row = adjustments[p.id];
    return row && row.adjustment !== 0;
  });

  const totalAdded = modifiedProducts.reduce((sum, p) => {
    const adj = adjustments[p.id]?.adjustment ?? 0;
    return adj > 0 ? sum + adj : sum;
  }, 0);

  const totalRemoved = modifiedProducts.reduce((sum, p) => {
    const adj = adjustments[p.id]?.adjustment ?? 0;
    return adj < 0 ? sum + Math.abs(adj) : sum;
  }, 0);

  async function handleSave() {
    if (modifiedProducts.length === 0) {
      toast.warning('No hay cambios para guardar.');
      return;
    }

    setSaving(true);
    try {
      for (const product of modifiedProducts) {
        const adj = adjustments[product.id]?.adjustment ?? 0;
        const reason = adjustments[product.id]?.reason ?? 'Ajuste de Inventario';
        if (adj === 0) continue;
        const currentStock = getStock(product);
        const newStock = Math.max(0, currentStock + adj);
        const type = adj > 0 ? 'IN' : 'OUT';
        dispatch(
          updateProduct({
            ...product,
            stock: newStock,
            stockQuantity: newStock,
            updatedAt: new Date().toISOString(),
          })
        );
        dispatch(
          recordStockMovement({
            id: `adj_${product.id}_${Date.now()}_${Math.abs(adj)}`,
            productId: product.id,
            type,
            quantity: Math.abs(adj),
            previousStock: currentStock,
            newStock,
            reason,
            createdAt: new Date().toISOString(),
            createdBy: auditActor.name,
          })
        );
      }
      toast.success(
        `Se actualizaron ${modifiedProducts.length} producto${modifiedProducts.length !== 1 ? 's' : ''} correctamente.`
      );
      // Clear adjustments after save
      setAdjustments({});
    } catch {
      toast.error('Ocurrió un error al guardar los cambios.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-testid="stock-adjustment-page">
      <PageHeader
        title="Ajuste de Inventario"
        subtitle="Ajustar cantidades de productos en stock"
        actions={
          <div className="flex gap-2">
            <Button
              variant="ghost"
              icon={<ArrowLeft size={16} />}
              onClick={() => navigate('/products')}
            >
              Volver
            </Button>
            <Button
              variant="primary"
              icon={<Save size={16} />}
              onClick={handleSave}
              disabled={saving || modifiedProducts.length === 0}
              data-testid="save-stock-btn"
            >
              {saving ? 'Guardando…' : 'Guardar Cambios'}
            </Button>
          </div>
        }
      />

      <StickyToolbar data-testid="stock-sticky-toolbar">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBar
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Buscar por nombre o código..."
            data-testid="stock-search"
          />
          <div className="ml-auto flex items-center gap-2">
            <label htmlFor="stock-category-filter" className="text-xs text-brand-500 whitespace-nowrap">
              Categoría
            </label>
            <select
              id="stock-category-filter"
              data-testid="stock-category-filter"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-lg border border-brand-300 bg-white px-2.5 py-1.5 text-sm text-brand-800 focus:border-accent-500 focus:outline-none"
            >
              <option value="ALL">Todas las categorías</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

      </StickyToolbar>

      {inventoryProducts.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Package size={36} className="text-brand-300" />
            <p className="text-brand-500 text-sm">
              No hay productos con inventario registrados.
            </p>
            <Button variant="ghost" onClick={() => navigate('/products/add')}>
              Agregar Producto
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <Card className="mb-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-brand-200">
                    <th className="text-left py-3 px-3 font-medium text-brand-600 w-[30%]">
                      Producto
                    </th>
                    <th className="text-center py-3 px-3 font-medium text-brand-600 w-[15%]">
                      Stock Actual
                    </th>
                    <th className="text-center py-3 px-3 font-medium text-brand-600 w-[22%]">
                      Ajuste
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-brand-600 w-[20%]">
                      Razón
                    </th>
                    <th className="text-center py-3 px-3 font-medium text-brand-600 w-[13%]">
                      Nuevo Stock
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-brand-400 text-sm">
                        No se encontraron productos con ese criterio.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((product) => {
                      const row = getRow(product.id);
                      const currentStock = getStock(product);
                      const newStock = Math.max(0, currentStock + row.adjustment);
                      const lowThreshold = product.lowStockThreshold ?? product.minStock;
                      const isBelowMin =
                        lowThreshold != null && currentStock < lowThreshold;
                      const hasChange = row.adjustment !== 0;
                      const isPositive = row.adjustment > 0;

                      return (
                        <tr
                          key={product.id}
                          className="border-b border-brand-100 hover:bg-brand-50 transition-colors"
                        >
                          {/* Producto */}
                          <td className="py-3 px-3">
                            <div>
                              <span className="font-medium text-brand-900">
                                {product.productName}
                              </span>
                              {product.productCode && (
                                <span className="ml-2 text-xs font-mono text-brand-400">
                                  {product.productCode}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Stock Actual */}
                          <td className="py-3 px-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <span className="font-medium text-brand-900">
                                {currentStock}
                              </span>
                              {isBelowMin && (
                                <span title={`Mínimo: ${lowThreshold}`}>
                                  <AlertTriangle
                                    size={14}
                                    className="text-amber-500"
                                  />
                                </span>
                              )}
                            </div>
                            {isBelowMin && (
                              <div className="mt-0.5">
                                <Badge variant="warning" >
                                  Bajo mínimo
                                </Badge>
                              </div>
                            )}
                          </td>

                          {/* Ajuste */}
                          <td className="py-3 px-3">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => decrementAdjustment(product.id)}
                                className="w-7 h-7 rounded border border-brand-300 flex items-center justify-center text-brand-600 hover:bg-brand-100 transition-colors"
                                aria-label="Disminuir"
                              >
                                <Minus size={12} />
                              </button>
                              <input
                                type="number"
                                value={row.adjustmentInput}
                                onChange={(e) =>
                                  setAdjustmentValue(product.id, e.target.value)
                                }
                                onFocus={(e) => e.target.select()}
                                placeholder="0"
                                className={[
                                  'w-16 text-center rounded-lg border px-2 py-1 text-sm',
                                  'focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500',
                                  hasChange
                                    ? 'border-accent-400 bg-accent-50'
                                    : 'border-brand-300',
                                ].join(' ')}
                                aria-label={`Ajuste para ${product.productName}`}
                              />
                              <button
                                type="button"
                                onClick={() => incrementAdjustment(product.id)}
                                className="w-7 h-7 rounded border border-brand-300 flex items-center justify-center text-brand-600 hover:bg-brand-100 transition-colors"
                                aria-label="Aumentar"
                              >
                                <Plus size={12} />
                              </button>
                            </div>
                          </td>

                          {/* Razón */}
                          <td className="py-3 px-3">
                            <select
                              value={row.reason}
                              onChange={(e) => setReason(product.id, e.target.value)}
                              className={[
                                'w-full rounded-lg border px-2 py-1.5 text-sm text-brand-900 bg-white',
                                'focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500',
                                'border-brand-300 hover:border-brand-400 appearance-none',
                              ].join(' ')}
                              aria-label={`Razón para ${product.productName}`}
                            >
                              {REASON_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </td>

                          {/* Nuevo Stock */}
                          <td className="py-3 px-3 text-center">
                            {hasChange ? (
                              <span
                                className={[
                                  'font-semibold',
                                  isPositive ? 'text-green-600' : 'text-red-600',
                                ].join(' ')}
                              >
                                {newStock}
                              </span>
                            ) : (
                              <span className="text-brand-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Summary bar */}
          <Card>
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-2">
                <span className="text-sm text-brand-500">Productos modificados:</span>
                <span className="font-semibold text-brand-900">
                  {modifiedProducts.length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-brand-500">Unidades agregadas:</span>
                <span className="font-semibold text-green-600">+{totalAdded}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-brand-500">Unidades removidas:</span>
                <span className="font-semibold text-red-600">-{totalRemoved}</span>
              </div>
              <div className="ml-auto">
                <Button
                  variant="primary"
                  icon={<Save size={16} />}
                  onClick={handleSave}
                  disabled={saving || modifiedProducts.length === 0}
                >
                  {saving ? 'Guardando…' : 'Guardar Cambios'}
                </Button>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
