import React, { useState, useRef, useEffect, useMemo, useId } from 'react';
import { Plus, Trash2, ChevronDown, X } from 'lucide-react';
import { InvoiceDetail, InvoiceType } from '../../types/invoice';
import { Product, TaxCategory } from '../../types/product';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { DISCOUNT_PRESETS } from '@/config/discountPresets';
import { nanoid } from '@reduxjs/toolkit';
import {
  DISCOUNTABLE_INVOICE_TYPES,
  TAX_BUCKET_INVOICE_TYPES,
  TAX_BUCKET_LABEL,
  computeLine,
  roundMoney,
  supportsLineDiscounts,
  taxBucketOf,
  taxCategoryBlockedMessage,
} from '@/utils/invoiceTotals';

// The discountable-type list lives with the totals (computeTotals ignores
// discounts on every other type, like the DTE mappers); re-exported for the
// existing importers.
export { DISCOUNTABLE_INVOICE_TYPES, supportsLineDiscounts };

export interface InvoiceLineItemsProps {
  items: InvoiceDetail[];
  onChange: (items: InvoiceDetail[]) => void;
  readOnly?: boolean;
  products?: Product[];
  /** Show the per-line discount column (DTE types that map montoDescu). */
  supportDiscount?: boolean;
  /**
   * DTE type being edited. Exento / no sujeto products can only go on the
   * types whose DTE splits sale buckets (FE, CCF, NC, ND, NR) or carries no
   * IVA (FEX, FSE, CD); on any other type the product is refused with a
   * Spanish message. When omitted, `supportDiscount` stands in for it
   * (the discountable types are exactly the bucket-splitting ones).
   */
  invoiceType?: InvoiceType | null;
}

interface ProductDropdownProps {
  products: Product[];
  value: string;
  productName: string;
  onChange: (productId: string, productName: string, unitPrice: number, taxCategory?: TaxCategory) => void;
  /** Spanish reason the product can't go on this document, or null when allowed. */
  blockReason?: (product: Product) => string | null;
  disabled?: boolean;
  testId?: string;
}

/** Whether a tax category may be added, given the props (invoiceType or the supportDiscount fallback). */
function blockReasonFor(
  invoiceType: InvoiceType | null | undefined,
  supportDiscount: boolean,
  category?: TaxCategory | string | null,
): string | null {
  if (invoiceType != null) return taxCategoryBlockedMessage(invoiceType, category);
  if (taxBucketOf(category) === 'gravada' || supportDiscount) return null;
  // No type known and the editor is not on a bucket-splitting type: refuse
  // rather than let an exempt line be reported as a 13% gravada sale.
  return taxCategoryBlockedMessage(InvoiceType.ComprobanteRetencion, category);
}

// Product autocomplete combobox.
//
// Behaviour upgrade over the previous filtered-list dropdown:
//   - Arrow Down / Up navigate suggestions; Enter commits the highlighted
//     row; Escape closes the panel; Tab also commits highlighted (otherwise
//     yields focus normally).
//   - Hover updates highlight to match keyboard for consistent feedback.
//   - Free-text typing is preserved on blur — users can describe a one-off
//     service that isn't in the catalog without the input snapping back.
//   - A chevron toggles the panel; an X clears the selection (re-enabling
//     the unit-price column for manual entry).
//   - ARIA combobox roles + aria-activedescendant for keyboard a11y.
function ProductDropdown({
  products,
  value,
  productName,
  onChange,
  blockReason,
  disabled,
  testId,
}: ProductDropdownProps) {
  const [query, setQuery] = useState(value ? productName : '');
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [blockedMsg, setBlockedMsg] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();
  const optionId = (i: number) => `${listboxId}-opt-${i}`;

  // Keep query mirrored to the parent's productName when the row is
  // edit-loaded with an existing selection (lifecycle: parent loads
  // existing items → passes value/productName → we reflect into query).
  useEffect(() => {
    if (value) setQuery(productName);
  }, [value, productName]);

  // Close panel on outside click.
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  // Filter products by name OR code, case-insensitive. Empty query shows
  // the first 8 (acts like a passive dropdown until the user starts typing).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? products.filter(
          (p) =>
            p.productName.toLowerCase().includes(q) ||
            (p.productCode ?? '').toLowerCase().includes(q),
        )
      : products;
    return list.slice(0, 8);
  }, [products, query]);

  // Reset highlight when the filter result changes — otherwise an out-of-
  // range index can highlight a row that no longer exists.
  useEffect(() => {
    setHighlighted(0);
  }, [filtered.length]);

  // Scroll the highlighted row into view when navigating by keyboard.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const node = listRef.current.querySelector<HTMLLIElement>(
      `[data-idx="${highlighted}"]`,
    );
    node?.scrollIntoView({ block: 'nearest' });
  }, [highlighted, open]);

  function commit(p: Product) {
    const reason = blockReason?.(p) ?? null;
    if (reason) {
      // Refuse the product: keep the row as it was and explain why.
      setBlockedMsg(reason);
      setQuery(value ? productName : '');
      setOpen(false);
      return;
    }
    setBlockedMsg(null);
    onChange(p.id, p.productName, p.unitPrice, p.taxCategory ?? TaxCategory.GRAVADO);
    setQuery(p.productName);
    setOpen(false);
  }

  function clearSelection() {
    setBlockedMsg(null);
    onChange('', '', 0);
    setQuery('');
    setOpen(true);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (filtered.length === 0) return;
      setHighlighted((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return;
      if (filtered.length === 0) return;
      setHighlighted((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      if (open && filtered[highlighted]) {
        e.preventDefault();
        commit(filtered[highlighted]);
      }
      // No match — Enter falls through and lets the form submit (or the
      // parent row's onBlur preserves the typed text).
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    } else if (e.key === 'Tab') {
      // Tab with an open panel + highlighted row commits the suggestion
      // before focus moves on. Without this, tabbing away after typing a
      // partial match would lose the catalog price.
      if (open && filtered[highlighted] && query.trim().length > 0) {
        commit(filtered[highlighted]);
      }
    }
  }

  const hasSelection = !!value;

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open && filtered[highlighted] ? optionId(highlighted) : undefined}
          data-testid={testId}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setBlockedMsg(null);
            // Typing a different name clears the bound product so unit
            // price becomes editable again — matches users' expectation
            // when they pivot from "Refresco" to a custom description.
            if (hasSelection && e.target.value !== productName) {
              onChange('', e.target.value, 0);
            } else if (!e.target.value) {
              onChange('', '', 0);
            }
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder="Buscar producto o describir manualmente..."
          className="w-full rounded-lg border border-brand-300 pr-16 pl-3 py-2 text-sm text-brand-900 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {hasSelection && !disabled && (
            <button
              type="button"
              aria-label="Quitar selección"
              onClick={clearSelection}
              className="p-1 rounded text-brand-400 hover:text-brand-600 hover:bg-brand-50"
            >
              <X size={14} />
            </button>
          )}
          <button
            type="button"
            aria-label={open ? 'Cerrar lista' : 'Abrir lista'}
            tabIndex={-1}
            onMouseDown={(e) => {
              e.preventDefault();
              setOpen((v) => !v);
              inputRef.current?.focus();
            }}
            disabled={disabled}
            className="p-1 rounded text-brand-400 hover:text-brand-600 hover:bg-brand-50"
          >
            <ChevronDown
              size={16}
              className={`transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      </div>
      {open && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          className="absolute z-20 top-full left-0 w-full mt-1 bg-white border border-brand-200 rounded-lg shadow-lg max-h-56 overflow-y-auto py-1"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-brand-400 italic">
              Sin coincidencias — la descripción se enviará tal cual.
            </li>
          ) : (
            filtered.map((p, i) => {
              const bucket = taxBucketOf(p.taxCategory);
              const unavailable = !!blockReason?.(p);
              return (
                <li
                  key={p.id}
                  id={optionId(i)}
                  data-idx={i}
                  role="option"
                  aria-selected={i === highlighted}
                  aria-disabled={unavailable || undefined}
                  className={`px-3 py-2 text-sm cursor-pointer flex items-center gap-2 ${
                    i === highlighted ? 'bg-accent-50 text-brand-900' : 'text-brand-800 hover:bg-brand-50'
                  } ${unavailable ? 'opacity-60' : ''}`}
                  onMouseEnter={() => setHighlighted(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(p);
                  }}
                >
                  <span className="font-medium flex-1 min-w-0 truncate">{p.productName}</span>
                  {bucket !== 'gravada' && (
                    <span
                      className="text-[10px] uppercase tracking-wide text-amber-700 bg-amber-50 rounded px-1 shrink-0"
                      title={unavailable ? 'No disponible en este tipo de documento' : undefined}
                    >
                      {TAX_BUCKET_LABEL[bucket]}
                    </span>
                  )}
                  {p.productCode && (
                    <span className="text-brand-400 text-xs shrink-0">{p.productCode}</span>
                  )}
                  <span className="text-brand-500 shrink-0">${p.unitPrice.toFixed(2)}</span>
                </li>
              );
            })
          )}
        </ul>
      )}
      {blockedMsg && (
        <p role="alert" data-testid={testId ? `${testId}-blocked` : undefined} className="mt-1 text-xs text-red-600">
          {blockedMsg}
        </p>
      )}
    </div>
  );
}

/** Small badge for exento / no sujeto lines (gravado lines show nothing). */
function TaxBucketBadge({ category, testId }: { category?: TaxCategory | string | null; testId?: string }) {
  const bucket = taxBucketOf(category);
  if (bucket === 'gravada') return null;
  return (
    <span
      data-testid={testId}
      className="ml-2 text-[10px] uppercase tracking-wide text-amber-700 bg-amber-50 rounded px-1 align-middle"
    >
      {TAX_BUCKET_LABEL[bucket]}
    </span>
  );
}

const stamp = () => new Date().toISOString();

export function InvoiceLineItems({
  items,
  onChange,
  readOnly = false,
  products = [],
  supportDiscount = false,
  invoiceType,
}: InvoiceLineItemsProps) {
  const blockReason = (category?: TaxCategory | string | null) =>
    blockReasonFor(invoiceType, supportDiscount, category);
  // Exento / no sujeto lines are priced without IVA on every document; the
  // badge only matters where the DTE actually splits the buckets.
  const showsBuckets = invoiceType != null
    ? TAX_BUCKET_INVOICE_TYPES.includes(invoiceType)
    : supportDiscount;

  function addItem() {
    const id = `detail_${nanoid(6)}`;
    onChange([
      ...items,
      {
        id,
        productId: '',
        productName: '',
        quantity: 1,
        unitPrice: 0,
        obsItem: '',
        createdAt: stamp(),
        updatedAt: stamp(),
      },
    ]);
  }

  function removeItem(id: string) {
    onChange(items.filter(i => i.id !== id));
  }

  function updateItem(id: string, patch: Partial<InvoiceDetail>) {
    onChange(items.map(i => i.id === id ? { ...i, ...patch, updatedAt: stamp() } : i));
  }

  // Line discount, entered as a PERCENTAGE of the line gross. The derived
  // amount (same IVA treatment as unitPrice) is what persists — the DTE
  // mappers, totals and PDF all consume the amount. Raw keystrokes live in
  // pctDrafts until blur so typing "15" isn't clobbered by the canonical
  // back-computed value (e.g. "14.99" after rounding).
  const [pctDrafts, setPctDrafts] = useState<Record<string, string>>({});

  function updateDiscountPct(id: string, pct: number) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    const clamped = Math.min(Math.max(0, pct || 0), 100);
    const gross = item.quantity * item.unitPrice;
    const discount = Math.round(((gross * clamped) / 100) * 100) / 100;
    updateItem(id, { discount: clamped > 0 ? discount : undefined });
  }

  // Quick-percentage chips: apply one percentage to every line at once.
  function applyDiscountPctToAll(pct: number) {
    setPctDrafts({});
    onChange(items.map(i => {
      const gross = i.quantity * i.unitPrice;
      const discount = Math.round(((gross * pct) / 100) * 100) / 100;
      return { ...i, discount: pct > 0 ? discount : undefined, updatedAt: stamp() };
    }));
  }

  // Discounts only exist on the types whose DTE maps montoDescu — totals and
  // mappers ignore a leftover discount anywhere else, so the line total does too.
  const discountsApply = invoiceType != null ? supportsLineDiscounts(invoiceType) : supportDiscount;
  const clampDiscount = (item: InvoiceDetail) =>
    discountsApply ? Math.min(Math.max(item.discount ?? 0, 0), item.quantity * item.unitPrice) : 0;

  // Same per-line figure the stored totals / DTE use (utils/invoiceTotals.computeLine).
  const lineTotal = (item: InvoiceDetail) =>
    invoiceType != null
      ? computeLine(item, invoiceType).total
      : roundMoney(item.quantity * item.unitPrice - clampDiscount(item));

  if (readOnly) {
    const hasDiscounts = discountsApply && items.some(i => (i.discount ?? 0) > 0);
    return (
      <div className="overflow-auto rounded-lg border border-brand-100">
        <table className="w-full text-sm">
          <thead className="bg-brand-50">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-brand-600">#</th>
              <th className="px-4 py-3 text-left font-semibold text-brand-600">Descripción</th>
              <th className="px-4 py-3 text-right font-semibold text-brand-600">Cant.</th>
              <th className="px-4 py-3 text-right font-semibold text-brand-600">P. Unit.</th>
              {(supportDiscount || hasDiscounts) && (
                <th className="px-4 py-3 text-right font-semibold text-brand-600">Descuento</th>
              )}
              <th className="px-4 py-3 text-right font-semibold text-brand-600">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={item.id} data-testid={`inv-line-row-${item.id}`} className="border-t border-brand-100">
                <td className="px-4 py-3 text-brand-500">{idx + 1}</td>
                <td className="px-4 py-3 text-brand-800">
                  {item.productName}
                  {showsBuckets && <TaxBucketBadge category={item.taxCategory} testId={`inv-line-tax-${item.id}`} />}
                </td>
                <td className="px-4 py-3 text-right text-brand-800">{item.quantity}</td>
                <td className="px-4 py-3 text-right text-brand-800">${item.unitPrice.toFixed(2)}</td>
                {(supportDiscount || hasDiscounts) && (
                  <td className="px-4 py-3 text-right text-brand-800">
                    {clampDiscount(item) > 0 ? `-$${clampDiscount(item).toFixed(2)}` : '—'}
                  </td>
                )}
                <td className="px-4 py-3 text-right font-medium text-brand-900" data-testid={`inv-line-total-${item.id}`}>
                  ${lineTotal(item).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {supportDiscount && items.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap" data-testid="inv-discount-quick">
          <span className="text-xs text-brand-500">Descuento % a todas las líneas:</span>
          {DISCOUNT_PRESETS.map(pct => (
            <button
              key={pct}
              type="button"
              data-testid={`inv-disc-chip-${pct}`}
              onClick={() => applyDiscountPctToAll(pct)}
              className="px-2.5 py-1 rounded-full text-xs border whitespace-nowrap bg-white text-brand-700 border-brand-300 hover:bg-brand-50"
            >
              {pct}%
            </button>
          ))}
          <button
            type="button"
            data-testid="inv-disc-chip-clear"
            onClick={() => applyDiscountPctToAll(0)}
            className="px-2.5 py-1 rounded-full text-xs border whitespace-nowrap bg-white text-slate-500 border-brand-200 hover:bg-brand-50"
          >
            Quitar
          </button>
        </div>
      )}
      <div className="overflow-auto rounded-lg border border-brand-100">
        <table className="w-full text-sm">
          <thead className="bg-brand-50">
            <tr>
              <th className="px-3 py-3 text-left font-semibold text-brand-600 w-8">#</th>
              <th className="px-3 py-3 text-left font-semibold text-brand-600">Producto / Descripción</th>
              <th className="px-3 py-3 text-right font-semibold text-brand-600 w-24">Cantidad</th>
              <th className="px-3 py-3 text-right font-semibold text-brand-600 w-28">P. Unitario</th>
              {supportDiscount && (
                <th className="px-3 py-3 text-right font-semibold text-brand-600 w-24">Descuento %</th>
              )}
              <th className="px-3 py-3 text-right font-semibold text-brand-600 w-24">Total</th>
              <th className="px-3 py-3 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={supportDiscount ? 7 : 6} className="px-4 py-8 text-center text-brand-400">
                  No hay ítems. Haga clic en "Agregar ítem" para comenzar.
                </td>
              </tr>
            )}
            {items.map((item, idx) => (
              <tr key={item.id} data-testid={`inv-line-row-${item.id}`} className="border-t border-brand-100">
                <td className="px-3 py-2 text-brand-400">{idx + 1}</td>
                <td className="px-3 py-2">
                  {products.length > 0 ? (
                    <ProductDropdown
                      products={products}
                      value={item.productId}
                      productName={item.productName}
                      testId={`inv-line-product-${item.id}`}
                      blockReason={(p) => blockReason(p.taxCategory)}
                      onChange={(productId, productName, unitPrice, taxCategory) =>
                        // Free text / cleared selection → gravado (the default).
                        updateItem(item.id, { productId, productName, unitPrice, taxCategory: taxCategory ?? TaxCategory.GRAVADO })
                      }
                    />
                  ) : (
                    <Input
                      value={item.productName}
                      onChange={e => updateItem(item.id, { productName: e.target.value })}
                      placeholder="Descripción del producto..."
                    />
                  )}
                  {showsBuckets && taxBucketOf(item.taxCategory) !== 'gravada' && (
                    <p className="mt-1 text-xs text-amber-700" data-testid={`inv-line-tax-${item.id}`}>
                      {TAX_BUCKET_LABEL[taxBucketOf(item.taxCategory)]} de IVA — precio sin IVA
                    </p>
                  )}
                  {blockReason(item.taxCategory) && (
                    // Line added on another document type (or before the type changed).
                    <p role="alert" className="mt-1 text-xs text-red-600" data-testid={`inv-line-tax-blocked-${item.id}`}>
                      {blockReason(item.taxCategory)} Quite esta línea o cambie el tipo de documento.
                    </p>
                  )}
                </td>
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    data-testid={`inv-line-qty-${item.id}`}
                    value={String(item.quantity)}
                    onChange={e => updateItem(item.id, { quantity: parseFloat(e.target.value) || 0 })}
                    className="text-right"
                    min="0"
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    data-testid={`inv-line-price-${item.id}`}
                    value={String(item.unitPrice)}
                    onChange={e => updateItem(item.id, { unitPrice: parseFloat(e.target.value) || 0 })}
                    className="text-right"
                    min="0"
                    step="0.01"
                  />
                </td>
                {supportDiscount && (
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      data-testid={`inv-line-discount-${item.id}`}
                      title="Descuento de la línea (%) — 30 equivale a 30% del subtotal de la línea"
                      value={pctDrafts[item.id] !== undefined
                        ? pctDrafts[item.id]
                        : item.discount && item.quantity * item.unitPrice > 0
                          ? String(Math.round((item.discount / (item.quantity * item.unitPrice)) * 10000) / 100)
                          : ''}
                      onChange={e => {
                        setPctDrafts(prev => ({ ...prev, [item.id]: e.target.value }));
                        updateDiscountPct(item.id, parseFloat(e.target.value) || 0);
                      }}
                      onBlur={() => setPctDrafts(prev => {
                        const next = { ...prev };
                        delete next[item.id];
                        return next;
                      })}
                      className="text-right"
                      min="0"
                      max="100"
                      step="1"
                      placeholder="%"
                    />
                  </td>
                )}
                <td className="px-3 py-2 text-right font-medium text-brand-900" data-testid={`inv-line-total-${item.id}`}>
                  ${lineTotal(item).toFixed(2)}
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    data-testid={`inv-line-remove-${item.id}`}
                    onClick={() => removeItem(item.id)}
                    className="p-1 rounded text-brand-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    aria-label="Eliminar ítem"
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        icon={<Plus size={14} />}
        onClick={addItem}
        data-testid="btn-add-invoice-item"
      >
        Agregar ítem
      </Button>
    </div>
  );
}

export default InvoiceLineItems;
