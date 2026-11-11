import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Tags, Plus, Pencil, Trash2, X, Check } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { useToast } from '@/components/common/Toast';
import { useAppSelector, useAppDispatch } from '@/store';
import { selectCurrentCompanyProducts } from '@/store/selectors/productSelectors';
import {
  addCategory,
  deleteCategory,
  renameCategory,
  updateProduct,
} from '@/store/slices/productSlice';

/**
 * Categorías de productos — the managed list behind the product-form dropdown
 * and the products-page filter. Categories live as a plain string on each
 * product (`product.category`), so they sync with the product payload; this
 * list is the local picker of names and is rebuilt from synced products.
 */
export default function ProductCategoriesPage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const toast = useToast();
  const categories = useAppSelector((state) => state.products.categories);
  const products = useAppSelector(selectCurrentCompanyProducts);

  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const usageByCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of products) {
      if (p.category) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    }
    return counts;
  }, [products]);

  // Categories seen on products but missing from the managed list (e.g. relay
  // writes) still show here so the counts are complete.
  const allCategories = useMemo(() => {
    const set = new Set(categories);
    for (const c of usageByCategory.keys()) set.add(c);
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
  }, [categories, usageByCategory]);

  function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    if (categories.includes(name)) {
      toast.error(`La categoría «${name}» ya existe.`);
      return;
    }
    dispatch(addCategory(name));
    setNewName('');
    toast.success('Categoría agregada.');
  }

  function handleRename(category: string) {
    const target = renameValue.trim();
    if (!target || target === category) {
      setRenaming(null);
      return;
    }
    if (allCategories.includes(target)) {
      toast.error(`Ya existe una categoría «${target}».`);
      return;
    }
    // Rename the managed list entry, then rewrite each affected product via
    // updateProduct — bulk edits inside one custom action would never reach
    // the Device-Sync outbox, but per-product updates do.
    const affected = products.filter((p) => p.category === category);
    dispatch(renameCategory({ from: category, to: target }));
    for (const p of affected) {
      dispatch(updateProduct({ ...p, category: target }));
    }
    setRenaming(null);
    toast.success(
      affected.length
        ? `Categoría renombrada — ${affected.length} producto(s) actualizado(s).`
        : 'Categoría renombrada.',
    );
  }

  function handleDelete(category: string) {
    const count = usageByCategory.get(category) ?? 0;
    if (count > 0) {
      toast.error(`No se puede eliminar: ${count} producto(s) usan «${category}».`);
      return;
    }
    dispatch(deleteCategory(category));
    toast.success('Categoría eliminada.');
  }

  return (
    <div data-testid="product-categories" className="space-y-4 max-w-3xl">
      <PageHeader
        title="Categorías de Productos"
        subtitle="Organiza tu catálogo y filtra la lista de productos"
        actions={
          <Button
            variant="ghost"
            icon={<ArrowLeft size={16} />}
            onClick={() => navigate('/settings')}
          >
            Volver
          </Button>
        }
      />

      <Card>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="Nombre de la categoría (ej. Bebidas, Repuestos…)"
            data-testid="new-category-name"
            className="flex-1 rounded-lg border border-brand-300 px-3 py-2 text-sm text-brand-800 focus:border-accent-500 focus:outline-none"
          />
          <Button
            variant="primary"
            icon={<Plus size={16} />}
            onClick={handleAdd}
            disabled={!newName.trim()}
            data-testid="add-category-btn"
          >
            Agregar
          </Button>
        </div>
        <p className="mt-2 text-xs text-brand-400">
          Las categorías se sincronizan con cada producto: al renombrar aquí, los
          productos de la categoría se actualizan en todos tus dispositivos.
        </p>
      </Card>

      <Card className="p-0">
        {allCategories.length === 0 ? (
          <div className="py-10 text-center" data-testid="categories-empty">
            <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-brand-50 text-brand-400 flex items-center justify-center">
              <Tags size={22} />
            </div>
            <p className="text-sm font-medium text-brand-700">Sin categorías todavía</p>
            <p className="text-xs text-brand-400 mt-1">
              Agrega una arriba o crea una directamente desde el formulario de producto.
            </p>
          </div>
        ) : (
          <ul data-testid="categories-list" className="divide-y divide-brand-100">
            {allCategories.map((category) => {
              const count = usageByCategory.get(category) ?? 0;
              const inList = categories.includes(category);
              const isRenaming = renaming === category;
              return (
                <li
                  key={category}
                  data-testid={`category-row-${category}`}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  {isRenaming ? (
                    <>
                      <input
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRename(category);
                          if (e.key === 'Escape') setRenaming(null);
                        }}
                        autoFocus
                        data-testid={`rename-input-${category}`}
                        className="flex-1 rounded-lg border border-accent-400 px-3 py-1.5 text-sm text-brand-800 focus:outline-none"
                      />
                      <Button
                        variant="primary"
                        size="sm"
                        icon={<Check size={14} />}
                        onClick={() => handleRename(category)}
                        data-testid={`rename-confirm-${category}`}
                      >
                        Guardar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<X size={14} />}
                        onClick={() => setRenaming(null)}
                      />
                    </>
                  ) : (
                    <>
                      <Tags size={16} className="text-brand-400 shrink-0" />
                      <span className="flex-1 text-sm text-brand-800">{category}</span>
                      <Badge variant={count > 0 ? 'info' : 'neutral'} data-testid={`category-count-${category}`}>
                        {count} producto{count === 1 ? '' : 's'}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Pencil size={14} />}
                        title="Renombrar"
                        onClick={() => {
                          setRenaming(category);
                          setRenameValue(category);
                        }}
                        data-testid={`rename-btn-${category}`}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Trash2 size={14} />}
                        title={count > 0 ? 'No se puede eliminar: tiene productos' : 'Eliminar'}
                        disabled={count > 0}
                        onClick={() => handleDelete(category)}
                        data-testid={`delete-btn-${category}`}
                      >
                        <span className="sr-only">Eliminar</span>
                      </Button>
                      {!inList && (
                        <span className="text-[10px] text-brand-300" title="Agregada automáticamente desde un producto sincronizado">
                          auto
                        </span>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
