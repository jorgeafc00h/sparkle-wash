// "Crear producto" from the register when a scanned/typed code isn't in the
// catalog (POS Phase 2 design §5). Only offered to users who may manage
// products (admin or the `products` permission). The product is created with
// the regular `addProduct` action, so Device Sync and the activity log see it
// like any other product; the register then adds one unit (or the pending
// `N*` quantity) to the cart.

import React, { useEffect, useState } from 'react';
import { nanoid } from '@reduxjs/toolkit';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Select } from '@/components/common/Select';
import { Product, ProductStatus, TaxCategory, UnitOfMeasure } from '@/types/product';

interface QuickCreateProductModalProps {
  isOpen: boolean;
  /** The code that wasn't found — prefilled as the barcode. */
  code: string;
  /** Suggested unit (KG for a scale label miss). */
  suggestedUnit?: UnitOfMeasure;
  companyId: string;
  /** Barcodes/codes already in the catalog (duplicate guard). */
  existingCodes: Set<string>;
  onClose: () => void;
  onCreate: (product: Product) => void;
}

const UNIT_OPTIONS = [
  { value: UnitOfMeasure.UNIDAD, label: 'Unidad' },
  { value: UnitOfMeasure.KILOGRAMO, label: 'Kilogramo (se pesa)' },
  { value: UnitOfMeasure.GRAMO, label: 'Gramo (se pesa)' },
  { value: UnitOfMeasure.LITRO, label: 'Litro' },
  { value: UnitOfMeasure.METRO, label: 'Metro' },
  { value: UnitOfMeasure.CAJA, label: 'Caja' },
  { value: UnitOfMeasure.DOCENA, label: 'Docena' },
  { value: UnitOfMeasure.GALÓN, label: 'Galón' },
];

const TAX_OPTIONS = [
  { value: TaxCategory.GRAVADO, label: 'Gravado (IVA 13 %)' },
  { value: TaxCategory.EXENTO, label: 'Exento' },
  { value: TaxCategory.NO_GRAVADO, label: 'No sujeto' },
];

export function QuickCreateProductModal({
  isOpen,
  code,
  suggestedUnit,
  companyId,
  existingCodes,
  onClose,
  onCreate,
}: QuickCreateProductModalProps) {
  const [barcode, setBarcode] = useState(code);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [taxCategory, setTaxCategory] = useState<TaxCategory>(TaxCategory.GRAVADO);
  const [unit, setUnit] = useState<UnitOfMeasure>(suggestedUnit ?? UnitOfMeasure.UNIDAD);
  const [trackInventory, setTrackInventory] = useState(false);
  const [stock, setStock] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setBarcode(code);
    setName('');
    setPrice('');
    setTaxCategory(TaxCategory.GRAVADO);
    setUnit(suggestedUnit ?? UnitOfMeasure.UNIDAD);
    setTrackInventory(false);
    setStock('');
    setError(null);
  }, [isOpen, code, suggestedUnit]);

  const save = () => {
    const trimmedName = name.trim();
    const trimmedCode = barcode.trim();
    const unitPrice = Number(price.replace(',', '.'));
    if (!trimmedName) return setError('Escribe el nombre del producto.');
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) return setError('Escribe un precio mayor que $0.00 (IVA incluido).');
    if (trimmedCode && existingCodes.has(trimmedCode.toLowerCase())) {
      return setError('Ya existe un producto con ese código de barras.');
    }
    const initialStock = trackInventory ? Math.max(0, Number(stock.replace(',', '.')) || 0) : 0;
    const timestamp = new Date().toISOString();
    const product: Product = {
      id: `prod_${nanoid(8)}`,
      productName: trimmedName,
      barcode: trimmedCode || undefined,
      unitPrice: Math.round(unitPrice * 10000) / 10000,
      unitOfMeasure: unit,
      taxCategory,
      status: ProductStatus.Active,
      isActive: true,
      isService: false,
      trackInventory,
      hasInventory: trackInventory,
      stock: initialStock,
      stockQuantity: initialStock,
      lowStockThreshold: trackInventory ? 5 : undefined,
      minStock: trackInventory ? 5 : undefined,
      companyId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    onCreate(product);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Crear producto"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button data-testid="btn-quick-create-save" onClick={save}>Guardar y agregar</Button>
        </>
      }
    >
      <div className="space-y-3" data-testid="quick-create-product">
        <p className="text-xs text-slate-500">
          El código <span className="font-mono">{code}</span> no está en tu catálogo. Créalo y se agrega a la venta.
        </p>
        <Input
          data-testid="quick-create-barcode"
          label="Código de barras"
          value={barcode}
          onChange={(e) => setBarcode(e.target.value.slice(0, 40))}
        />
        <Input
          data-testid="quick-create-name"
          data-autofocus
          label="Nombre"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 120))}
        />
        <Input
          data-testid="quick-create-price"
          label="Precio (IVA incluido)"
          type="number"
          min={0}
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-2">
          <Select
            data-testid="quick-create-tax"
            label="Impuesto"
            value={taxCategory}
            options={TAX_OPTIONS}
            onChange={(e) => setTaxCategory(e.target.value as TaxCategory)}
          />
          <Select
            data-testid="quick-create-unit"
            label="Unidad"
            value={unit}
            options={UNIT_OPTIONS}
            onChange={(e) => setUnit(e.target.value as UnitOfMeasure)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-brand-700">
          <input
            type="checkbox"
            data-testid="quick-create-track"
            checked={trackInventory}
            onChange={(e) => setTrackInventory(e.target.checked)}
          />
          Controlar inventario
        </label>
        {trackInventory && (
          <Input
            data-testid="quick-create-stock"
            label="Existencia inicial"
            type="number"
            min={0}
            step="1"
            value={stock}
            onChange={(e) => setStock(e.target.value)}
          />
        )}
        {error && <p data-testid="quick-create-error" className="text-xs text-error">{error}</p>}
      </div>
    </Modal>
  );
}
