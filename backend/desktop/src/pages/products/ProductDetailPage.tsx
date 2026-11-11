import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { Badge } from '@/components/common/Badge';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { AuditInfo } from '@/components/localUsers/AuditInfo';
import { useToast } from '@/components/common/Toast';
import { useAppSelector, useAppDispatch } from '@/store';
import { selectAllProducts } from '@/store/selectors/productSelectors';
import { deleteProduct } from '@/store/slices/productSlice';
import { TaxCategory, UnitOfMeasure, ProductStatus } from '@/types/product';

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

function InfoRow({ label, value }: { label: string; value?: string | number | null }) {
  const display = value == null || value === '' ? '—' : String(value);
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-brand-500 uppercase tracking-wide">{label}</span>
      <span className="text-sm text-brand-900">{display}</span>
    </div>
  );
}

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const toast = useToast();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const products = useAppSelector(selectAllProducts);
  const product = products.find((p) => p.id === id);

  if (!product) {
    return (
      <div data-testid="product-detail">
        <PageHeader title="Producto no encontrado" />
        <Card className="mt-4">
          <p className="text-brand-500 text-sm">El producto solicitado no existe.</p>
          <Button variant="ghost" onClick={() => navigate('/products')} className="mt-4">
            <ArrowLeft size={16} /> Volver
          </Button>
        </Card>
      </div>
    );
  }

  function handleDelete() {
    dispatch(deleteProduct(product!.id));
    toast.success('Producto eliminado correctamente.');
    navigate('/products');
  }

  const isActive =
    product.isActive &&
    product.status !== ProductStatus.Inactive &&
    product.status !== ProductStatus.Discontinued;
  const trackInventory = product.trackInventory ?? product.hasInventory ?? !product.isService;
  const stock = product.stockQuantity ?? product.stock ?? 0;
  const lowStockThreshold = product.lowStockThreshold ?? product.minStock ?? 5;
  const isOutOfStock = trackInventory && !product.isService && stock <= 0;
  const isLowStock = trackInventory && !product.isService && stock > 0 && stock <= lowStockThreshold;

  return (
    <div data-testid="product-detail">
      <PageHeader
        title={product.productName}
        subtitle="Detalle de producto"
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
              variant="secondary"
              icon={<Pencil size={16} />}
              onClick={() => navigate(`/products/${product.id}/edit`)}
              data-testid="edit-product-btn"
            >
              Editar
            </Button>
            <Button
              variant="danger"
              icon={<Trash2 size={16} />}
              onClick={() => setShowDeleteDialog(true)}
              data-testid="delete-product-btn"
            >
              Eliminar
            </Button>
          </div>
        }
      />

      <div className="grid gap-4">
        {/* Main info */}
        <Card>
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-start gap-4 min-w-0">
              {product.photoUrl && (
                <img
                  src={product.photoUrl}
                  alt={product.productName}
                  data-testid="product-detail-photo"
                  className="w-24 h-24 rounded-xl object-cover border border-brand-200 flex-shrink-0"
                />
              )}
              <div>
                <h2 className="text-lg font-semibold text-brand-900">{product.productName}</h2>
                {product.description && (
                  <p className="text-sm text-brand-500 mt-1">{product.description}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 ml-4">
              {product.isService ? (
                <Badge variant="purple">Servicio</Badge>
              ) : (
                <Badge variant="info">Producto</Badge>
              )}
              {isActive ? (
                <Badge variant="success">Activo</Badge>
              ) : (
                <Badge variant="error">Inactivo</Badge>
              )}
              <Badge variant={taxCategoryVariant[product.taxCategory]}>
                {taxCategoryLabel[product.taxCategory]}
              </Badge>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-3">
            <InfoRow label="Código" value={product.productCode} />
            <InfoRow label="Precio Unitario" value={`$${product.unitPrice.toFixed(2)}`} />
            <InfoRow label="Unidad de Medida" value={unitOfMeasureLabel[product.unitOfMeasure] ?? product.unitOfMeasure} />
            <InfoRow label="Categoría Fiscal" value={taxCategoryLabel[product.taxCategory]} />
            {!product.isService && <InfoRow label="Stock" value={stock} />}
            {product.cost != null && (
              <InfoRow label="Costo" value={`$${product.cost.toFixed(2)}`} />
            )}
          </div>
        </Card>

        {!product.isService && (
          <Card>
            <h3 className="text-sm font-semibold text-brand-700 mb-4">Inventario</h3>
            {!trackInventory ? (
              <p className="text-sm text-brand-500">Inventario no controlado para este producto.</p>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <InfoRow label="Stock Actual" value={stock} />
                <InfoRow label="Umbral Stock Bajo" value={lowStockThreshold} />
                <div className="flex items-end">
                  {isOutOfStock ? (
                    <Badge variant="error">Sin stock</Badge>
                  ) : isLowStock ? (
                    <Badge variant="warning">Stock bajo</Badge>
                  ) : (
                    <Badge variant="success">En stock</Badge>
                  )}
                </div>
              </div>
            )}
          </Card>
        )}

        {/* Government catalog refs */}
        {(product.tipoItem || product.codigoTributo || product.uniMedida || product.numeroTarifa) && (
          <Card>
            <h3 className="text-sm font-semibold text-brand-700 mb-4">Catálogo MH</h3>
            <div className="grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-4">
              <InfoRow label="Tipo de Ítem" value={product.tipoItem} />
              <InfoRow label="Código Tributo" value={product.codigoTributo} />
              <InfoRow label="Unidad MH" value={product.uniMedida} />
              <InfoRow label="Nro. Tarifa" value={product.numeroTarifa} />
            </div>
          </Card>
        )}
      </div>

      <AuditInfo entityType="product" entityId={product.id} className="mt-6" />

      <ConfirmDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={handleDelete}
        title="Eliminar Producto"
        message={`¿Está seguro de que desea eliminar "${product.productName}"? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        variant="danger"
      />
    </div>
  );
}
