import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Search, PackagePlus, Package, ChevronDown, X, AlertTriangle } from 'lucide-react';
import { useAppSelector } from '@/store';
import { selectAllProducts } from '@/store/selectors/productSelectors';
import { Product, ProductStatus } from '@/types/product';

export interface ProductSelectorProps {
  value?: string;
  onChange: (productId: string, product: Product) => void;
  companyId: string;
  placeholder?: string;
  disabled?: boolean;
  excludeIds?: string[];
  onAddProduct?: () => void;
}

function isLowStock(product: Product): boolean {
  const trackInventory = product.trackInventory ?? product.hasInventory ?? !product.isService;
  if (!trackInventory || product.isService) return false;
  const stock = product.stock ?? product.stockQuantity ?? 0;
  const min = product.lowStockThreshold ?? product.minStock ?? 0;
  return min > 0 && stock > 0 && stock <= min;
}

function isOutOfStock(product: Product): boolean {
  const trackInventory = product.trackInventory ?? product.hasInventory ?? !product.isService;
  if (!trackInventory || product.isService) return false;
  const stock = product.stock ?? product.stockQuantity ?? 0;
  return stock <= 0;
}

function formatPrice(price: number): string {
  return new Intl.NumberFormat('es-SV', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(price);
}

export function ProductSelector({
  value,
  onChange,
  companyId,
  placeholder = 'Buscar producto...',
  disabled = false,
  excludeIds = [],
  onAddProduct,
}: ProductSelectorProps) {
  const allProducts = useAppSelector(selectAllProducts);
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const companyProducts = allProducts.filter(
    (p) =>
      p.companyId === companyId &&
      p.isActive &&
      p.status === ProductStatus.Active &&
      !excludeIds.includes(p.id)
  );

  const filtered = search.trim()
    ? companyProducts.filter((p) => {
        const term = search.toLowerCase();
        return (
          p.productName.toLowerCase().includes(term) ||
          p.productCode?.toLowerCase().includes(term) ||
          p.description?.toLowerCase().includes(term)
        );
      })
    : companyProducts;

  const selectedProduct = value
    ? allProducts.find((p) => p.id === value) ?? null
    : null;

  const open = useCallback(() => {
    if (disabled) return;
    setIsOpen(true);
    setSearch('');
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [disabled]);

  const close = useCallback(() => {
    setIsOpen(false);
    setSearch('');
  }, []);

  const handleSelect = useCallback(
    (product: Product) => {
      onChange(product.id, product);
      close();
    },
    [onChange, close]
  );

  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onChange('', {} as Product);
      close();
    },
    [onChange, close]
  );

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isOpen, close]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    if (isOpen) document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, close]);

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Trigger */}
      <button
        type="button"
        onClick={open}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={[
          'w-full flex items-center gap-2 rounded-lg border px-3 py-2 text-sm bg-white transition-colors text-left',
          'focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500',
          disabled
            ? 'opacity-50 cursor-not-allowed border-brand-300 bg-brand-50'
            : 'border-brand-300 hover:border-brand-400 cursor-pointer',
        ].join(' ')}
      >
        <Package size={15} className="shrink-0 text-brand-400" />
        <span className={['flex-1 truncate', !selectedProduct ? 'text-brand-400' : 'text-brand-900'].join(' ')}>
          {selectedProduct ? selectedProduct.productName : placeholder}
        </span>
        {selectedProduct && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="shrink-0 text-brand-400 hover:text-brand-600 transition-colors"
            aria-label="Limpiar selección"
          >
            <X size={14} />
          </button>
        )}
        <ChevronDown
          size={15}
          className={['shrink-0 text-brand-400 transition-transform', isOpen ? 'rotate-180' : ''].join(' ')}
        />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          role="listbox"
          className={[
            'absolute z-20 top-full left-0 right-0 mt-1',
            'bg-white rounded-lg border border-brand-200 shadow-lg',
            'flex flex-col max-h-72 overflow-hidden',
          ].join(' ')}
        >
          {/* Search input */}
          <div className="px-3 py-2 border-b border-brand-100 flex items-center gap-2">
            <Search size={14} className="shrink-0 text-brand-400" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nombre o código..."
              className="flex-1 text-sm text-brand-900 placeholder:text-brand-400 focus:outline-none bg-transparent"
            />
          </div>

          {/* Options list */}
          <ul className="flex-1 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-sm text-brand-400 text-center">
                No se encontraron productos
              </li>
            ) : (
              filtered.map((product) => {
                const lowStock = isLowStock(product);
                const outOfStock = isOutOfStock(product);
                const stock = product.stock ?? product.stockQuantity;
                return (
                  <li key={product.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={product.id === value}
                      onClick={() => handleSelect(product)}
                      className={[
                        'w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-brand-50 transition-colors',
                        product.id === value ? 'bg-accent-50' : '',
                      ].join(' ')}
                    >
                      <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center shrink-0 mt-0.5">
                        <Package size={14} className="text-brand-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium text-brand-900 truncate">
                            {product.productName}
                          </p>
                          {outOfStock && (
                            <span className="shrink-0 inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full font-medium bg-red-100 text-red-700">
                              <AlertTriangle size={10} />
                              Sin stock
                            </span>
                          )}
                          {!outOfStock && lowStock && (
                            <span className="shrink-0 inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">
                              <AlertTriangle size={10} />
                              Stock bajo
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {product.productCode && (
                            <span className="text-xs text-brand-400">{product.productCode}</span>
                          )}
                          {stock !== undefined && (
                            <span className="text-xs text-brand-400">Stock: {stock}</span>
                          )}
                        </div>
                      </div>
                      <span className="shrink-0 text-sm font-semibold text-brand-700">
                        {formatPrice(product.unitPrice)}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>

          {/* Add product footer */}
          {onAddProduct && (
            <div className="border-t border-brand-100 p-1">
              <button
                type="button"
                onClick={() => {
                  close();
                  onAddProduct();
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-accent-600 hover:bg-accent-50 rounded-md transition-colors"
              >
                <PackagePlus size={14} />
                Agregar Producto
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ProductSelector;
