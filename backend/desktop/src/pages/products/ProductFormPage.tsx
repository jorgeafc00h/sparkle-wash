import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { ArrowLeft, Building2, Camera, X } from 'lucide-react';
import { nanoid } from '@reduxjs/toolkit';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { FormField } from '@/components/forms/FormField';
import { useToast } from '@/components/common/Toast';
import { useAppSelector, useAppDispatch } from '@/store';
import { selectAllProducts } from '@/store/selectors/productSelectors';
import { selectSelectedCompanyId } from '@/store/selectors/companySelectors';
import { addProduct, updateProduct } from '@/store/slices/productSlice';
import { Product, UnitOfMeasure, TaxCategory, ProductStatus } from '@/types/product';
import {
  PRODUCT_PHOTO_MAX_DATA_URL_CHARS,
  PRODUCT_PHOTO_RESIZE_OPTIONS,
  resizeImageToDataUrl,
} from '@/services/images/resizeImage';

const NEW_CATEGORY = '__new__';

interface ProductFormValues {
  productName: string;
  description: string;
  productCode: string;
  barcode: string;
  unitPrice: string;
  unitOfMeasure: string;
  taxCategory: string;
  category: string;
  stock: string;
  lowStockThreshold: string;
  isService: boolean;
  trackInventory: boolean;
}

const unitOfMeasureOptions = [
  { value: UnitOfMeasure.UNIDAD, label: 'Unidad' },
  { value: UnitOfMeasure.METRO, label: 'Metro' },
  { value: UnitOfMeasure.KILOGRAMO, label: 'Kilogramo' },
  { value: UnitOfMeasure.LITRO, label: 'Litro' },
  { value: UnitOfMeasure.CAJA, label: 'Caja' },
  { value: UnitOfMeasure.DOCENA, label: 'Docena' },
  { value: UnitOfMeasure.HORA, label: 'Hora' },
  { value: UnitOfMeasure.SERVICIO, label: 'Servicio' },
  { value: UnitOfMeasure.METRO_CUADRADO, label: 'Metro Cuadrado' },
  { value: UnitOfMeasure.METRO_CUBICO, label: 'Metro Cúbico' },
  { value: UnitOfMeasure.GRAMO, label: 'Gramo' },
  { value: UnitOfMeasure.TONELADA, label: 'Tonelada' },
  { value: UnitOfMeasure.GALÓN, label: 'Galón' },
  { value: UnitOfMeasure.PULGADA, label: 'Pulgada' },
  { value: UnitOfMeasure.PIE, label: 'Pie' },
  { value: UnitOfMeasure.YARDA, label: 'Yarda' },
];

const taxCategoryOptions = [
  { value: TaxCategory.GRAVADO, label: 'Gravado' },
  { value: TaxCategory.EXENTO, label: 'Exento' },
  { value: TaxCategory.NO_GRAVADO, label: 'No Gravado' },
  { value: TaxCategory.EXPORTACION, label: 'Exportación' },
];

const now = () => new Date().toISOString();

export default function ProductFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const toast = useToast();

  const isEdit = !!id;
  const products = useAppSelector(selectAllProducts);
  const categories = useAppSelector((state) => state.products.categories);
  const selectedCompanyId = useAppSelector(selectSelectedCompanyId);
  const [newCategoryName, setNewCategoryName] = useState('');
  // Product photo as a budgeted JPEG data-URI — kept out of ProductFormValues
  // because it is file-driven state, not a text field.
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);
  const [photoProcessing, setPhotoProcessing] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const product = isEdit ? products.find((p) => p.id === id) : undefined;

  const {
    control,
    handleSubmit,
    reset,
    register,
    watch,
    formState: { isSubmitting },
  } = useForm<ProductFormValues>({
    defaultValues: {
      productName: '',
      description: '',
      productCode: '',
      barcode: '',
      unitPrice: '',
      unitOfMeasure: UnitOfMeasure.UNIDAD,
      taxCategory: TaxCategory.GRAVADO,
      category: '',
      stock: '',
      lowStockThreshold: '5',
      isService: false,
      trackInventory: true,
    },
  });

  const isService = watch('isService');
  const trackInventory = watch('trackInventory');
  const selectedCategory = watch('category');

  useEffect(() => {
    if (product) {
      reset({
        productName: product.productName ?? '',
        description: product.description ?? '',
        productCode: product.productCode ?? '',
        barcode: product.barcode ?? '',
        unitPrice: String(product.unitPrice ?? ''),
        unitOfMeasure: product.unitOfMeasure ?? UnitOfMeasure.UNIDAD,
        taxCategory: product.taxCategory ?? TaxCategory.GRAVADO,
        category: product.category ?? '',
        stock: String(product.stockQuantity ?? product.stock ?? 0),
        lowStockThreshold: String(product.lowStockThreshold ?? product.minStock ?? 5),
        isService: product.isService ?? false,
        trackInventory: product.trackInventory ?? product.hasInventory ?? !(product.isService ?? false),
      });
      setPhotoUrl(product.photoUrl);
    }
  }, [product, reset]);

  async function handlePhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Allow re-picking the same file after an error.
    if (photoInputRef.current) photoInputRef.current.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Selecciona un archivo de imagen (PNG, JPG).');
      return;
    }
    setPhotoProcessing(true);
    try {
      const { dataUrl } = await resizeImageToDataUrl(file, PRODUCT_PHOTO_RESIZE_OPTIONS);
      setPhotoUrl(dataUrl);
    } catch (err) {
      toast.error((err as Error)?.message ?? 'No se pudo procesar la imagen.');
    } finally {
      setPhotoProcessing(false);
    }
  }

  function onSubmit(values: ProductFormValues) {
    const unitPrice = parseFloat(values.unitPrice);
    const parsedStock = values.stock !== '' ? parseInt(values.stock, 10) : 0;
    const stock = Math.max(0, isNaN(parsedStock) ? 0 : parsedStock);
    const parsedThreshold = values.lowStockThreshold !== '' ? parseInt(values.lowStockThreshold, 10) : 5;
    const lowStockThreshold = Math.max(1, isNaN(parsedThreshold) ? 5 : parsedThreshold);
    const productIsService = values.isService;
    const shouldTrackInventory = !productIsService && values.trackInventory;
    const timestamp = now();
    // "__new__" means the user typed a category inline — the slice auto-adds
    // it to the managed list when the product is saved.
    const category =
      values.category === NEW_CATEGORY
        ? newCategoryName.trim() || undefined
        : values.category || undefined;

    if (isEdit && product) {
      const updated: Product = {
        ...product,
        productName: values.productName.trim(),
        description: values.description?.trim() || undefined,
        productCode: values.productCode?.trim() || undefined,
        // Feeds the POS scanner (exact match) and scale-label PLUs.
        barcode: values.barcode?.replace(/\s+/g, '') || undefined,
        unitPrice,
        unitOfMeasure: values.unitOfMeasure as UnitOfMeasure,
        taxCategory: values.taxCategory as TaxCategory,
        category,
        stock: shouldTrackInventory ? stock : 0,
        stockQuantity: shouldTrackInventory ? stock : 0,
        minStock: shouldTrackInventory ? lowStockThreshold : undefined,
        lowStockThreshold: shouldTrackInventory ? lowStockThreshold : undefined,
        trackInventory: shouldTrackInventory,
        hasInventory: shouldTrackInventory,
        isService: productIsService,
        // undefined removes the key — the photo-less update syncs as a whole-product
        // replacement, so peers drop their copy of the photo too.
        photoUrl: photoUrl || undefined,
        updatedAt: timestamp,
      };
      dispatch(updateProduct(updated));
      toast.success('Producto actualizado correctamente.');
    } else {
      const newProduct: Product = {
        id: `prod_${nanoid(8)}`,
        productName: values.productName.trim(),
        description: values.description?.trim() || undefined,
        productCode: values.productCode?.trim() || undefined,
        // Feeds the POS scanner (exact match) and scale-label PLUs.
        barcode: values.barcode?.replace(/\s+/g, '') || undefined,
        unitPrice,
        unitOfMeasure: values.unitOfMeasure as UnitOfMeasure,
        taxCategory: values.taxCategory as TaxCategory,
        category,
        stock: shouldTrackInventory ? stock : 0,
        stockQuantity: shouldTrackInventory ? stock : 0,
        minStock: shouldTrackInventory ? lowStockThreshold : undefined,
        lowStockThreshold: shouldTrackInventory ? lowStockThreshold : undefined,
        trackInventory: shouldTrackInventory,
        hasInventory: shouldTrackInventory,
        isService: productIsService,
        status: ProductStatus.Active,
        isActive: true,
        photoUrl: photoUrl || undefined,
        companyId: selectedCompanyId!,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      dispatch(addProduct(newProduct));
      toast.success('Producto creado correctamente.');
    }

    navigate('/products');
  }

  if (!selectedCompanyId) {
    return (
      <div data-testid="product-form-no-company" className="max-w-md mx-auto mt-12">
        <Card>
          <div className="flex flex-col items-center text-center gap-3 py-6">
            <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
              <Building2 size={22} />
            </div>
            <h2 className="text-lg font-semibold text-brand-900">
              Selecciona o crea una empresa
            </h2>
            <p className="text-sm text-brand-500">
              Necesitas tener una empresa seleccionada para gestionar productos.
            </p>
            <div className="flex gap-2 mt-2">
              <Button variant="primary" onClick={() => navigate('/companies/add')} data-testid="btn-go-create-company">
                Crear empresa
              </Button>
              <Button variant="secondary" onClick={() => navigate('/companies')}>
                Ver empresas
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div data-testid="product-form">
      <PageHeader
        title={isEdit ? 'Editar Producto' : 'Nuevo Producto'}
        subtitle={isEdit ? 'Actualizar información del producto' : 'Registrar un nuevo producto o servicio'}
        actions={
          <Button
            variant="ghost"
            icon={<ArrowLeft size={16} />}
            onClick={() => navigate(isEdit ? `/products/${id}` : '/products')}
          >
            Volver
          </Button>
        }
      />

      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4">
        {/* Main info */}
        <Card>
          <h3 className="text-sm font-semibold text-brand-700 mb-4">Información del Producto</h3>

          {/* Photo picker — a budgeted JPEG data-URI so the product envelope stays
              under the Device Sync 16 KB payload cap. */}
          <div className="mb-4 flex items-center gap-4" data-testid="product-photo-field">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt="Foto del producto"
                data-testid="product-photo-preview"
                className="w-20 h-20 rounded-xl object-cover border border-brand-200 flex-shrink-0"
              />
            ) : (
              <div className="w-20 h-20 rounded-xl border border-dashed border-brand-300 bg-brand-50 flex items-center justify-center text-brand-300 flex-shrink-0">
                <Camera size={24} />
              </div>
            )}
            <div className="flex flex-col items-start gap-2">
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                data-testid="product-photo-input"
                className="hidden"
                onChange={handlePhotoSelected}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={photoProcessing}
                onClick={() => photoInputRef.current?.click()}
                data-testid="product-photo-add"
              >
                {photoProcessing ? 'Procesando…' : photoUrl ? 'Cambiar foto' : 'Agregar foto'}
              </Button>
              {photoUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  icon={<X size={14} />}
                  onClick={() => setPhotoUrl(undefined)}
                  data-testid="product-photo-remove"
                >
                  Quitar foto
                </Button>
              )}
              <p className="text-[11px] text-brand-400">
                JPG/PNG. Se reduce automáticamente (máx. {Math.round(PRODUCT_PHOTO_MAX_DATA_URL_CHARS / 1000)} KB)
                para sincronizar entre dispositivos.
              </p>
            </div>
          </div>

          <div className="mb-4">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                {...register('isService')}
                className="w-4 h-4 rounded border-brand-300 text-accent-600 focus:ring-accent-500"
              />
              <span className="text-sm text-brand-700">Es un servicio (no lleva inventario)</span>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              name="productName"
              control={control}
              label="Nombre del Producto"
              required
              rules={{ required: 'El nombre del producto es requerido.' }}
              placeholder="Nombre"
            />
            <FormField
              name="productCode"
              control={control}
              label="Código / SKU"
              placeholder="Código interno"
            />
            <FormField
              name="barcode"
              control={control}
              label="Código de barras"
              placeholder="Escanea o escribe el código (EAN/UPC)"
            />
            <div className="md:col-span-2">
              <FormField
                name="description"
                control={control}
                label="Descripción"
                placeholder="Descripción del producto o servicio"
              />
            </div>
            <div className="md:col-span-2">
              <FormField
                name="category"
                control={control}
                label="Categoría"
                type="select"
                placeholder="Sin categoría"
                options={[
                  { value: '', label: 'Sin categoría' },
                  ...categories.map((c) => ({ value: c, label: c })),
                  { value: NEW_CATEGORY, label: '+ Nueva categoría…' },
                ]}
              />
              {selectedCategory === NEW_CATEGORY && (
                <div className="mt-2">
                  <input
                    type="text"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    placeholder="Nombre de la nueva categoría"
                    data-testid="new-category-input"
                    className="w-full rounded-lg border border-brand-300 px-3 py-2 text-sm text-brand-800 focus:border-accent-500 focus:outline-none"
                  />
                  {newCategoryName.trim() && categories.includes(newCategoryName.trim()) && (
                    <p className="mt-1 text-xs text-amber-600">
                      «{newCategoryName.trim()}» ya existe — se usará la existente.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Pricing & tax */}
        <Card>
          <h3 className="text-sm font-semibold text-brand-700 mb-4">Precio y Categoría Fiscal</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <FormField
              name="unitPrice"
              control={control}
              label="Precio Unitario ($)"
              type="number"
              required
              placeholder="0.00"
              rules={{
                required: 'El precio unitario es requerido.',
                min: { value: 0, message: 'El precio no puede ser negativo.' },
                validate: (v) =>
                  !isNaN(parseFloat(String(v))) || 'Ingrese un precio válido.',
              }}
            />
            <FormField
              name="unitOfMeasure"
              control={control}
              label="Unidad de Medida"
              type="select"
              options={unitOfMeasureOptions}
              required
            />
            <FormField
              name="taxCategory"
              control={control}
              label="Categoría Fiscal"
              type="select"
              options={taxCategoryOptions}
              required
            />
          </div>
        </Card>

        {/* Inventory */}
        <Card>
          <h3 className="text-sm font-semibold text-brand-700 mb-4">Inventario</h3>
          {isService ? (
            <p className="text-sm text-brand-500">
              Los servicios no manejan inventario.
            </p>
          ) : (
            <div className="space-y-4">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  {...register('trackInventory')}
                  className="w-4 h-4 rounded border-brand-300 text-accent-600 focus:ring-accent-500"
                />
                <span className="text-sm text-brand-700">Controlar inventario</span>
              </label>

              {trackInventory && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField
                    name="stock"
                    control={control}
                    label="Cantidad en Stock"
                    type="number"
                    placeholder="0"
                    rules={{
                      min: { value: 0, message: 'El stock no puede ser negativo.' },
                    }}
                  />
                  <FormField
                    name="lowStockThreshold"
                    control={control}
                    label="Umbral Stock Bajo"
                    type="number"
                    placeholder="5"
                    rules={{
                      min: { value: 1, message: 'El umbral mínimo es 1.' },
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate(isEdit ? `/products/${id}` : '/products')}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={isSubmitting}
            // A photo still being resized must not be lost to a fast save — RN
            // disables save the same way while the picker is busy.
            disabled={photoProcessing}
            data-testid="submit-product-btn"
          >
            {isEdit ? 'Guardar Cambios' : 'Crear Producto'}
          </Button>
        </div>
      </form>
    </div>
  );
}
