import { useState, useEffect, useMemo } from 'react';
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
import { selectAllCustomers } from '@/store/selectors/customerSelectors';
import { selectCurrentCompany } from '@/store/selectors/companySelectors';
import { deleteCustomerAsync } from '@/store/slices/customerSlice';
import { loadCompras, initComprasDatabase } from '@/store/slices/comprasSlice';
import { comprasLinkedToCustomer, linkedMaterialsTotal } from '@/services/compras/compraLinks';
import { CustomerType } from '@/types/customer';

const customerTypeLabel: Record<CustomerType, string> = {
  [CustomerType.Individual]: 'Individual',
  [CustomerType.Business]: 'Empresa',
  [CustomerType.Government]: 'Gobierno',
};

const customerTypeVariant: Record<CustomerType, 'info' | 'purple' | 'neutral'> = {
  [CustomerType.Individual]: 'info',
  [CustomerType.Business]: 'purple',
  [CustomerType.Government]: 'neutral',
};

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-brand-500 uppercase tracking-wide">{label}</span>
      <span className="text-sm text-brand-900">{value || '—'}</span>
    </div>
  );
}

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const toast = useToast();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const customers = useAppSelector(selectAllCustomers);
  const customer = customers.find((c) => c.id === id);
  const company = useAppSelector(selectCurrentCompany);
  const comprasLedger = useAppSelector((s) => s.compras.ledgerCompras);

  // Compras linked to this customer — "materials" the customer's purchases
  // that were tied to them directly (or via an invoice's auto-filled link).
  const linkedMaterials = useMemo(
    () => (customer ? comprasLinkedToCustomer(comprasLedger, customer.id, customer.companyId) : []),
    [comprasLedger, customer],
  );
  const materialsTotal = useMemo(() => linkedMaterialsTotal(linkedMaterials), [linkedMaterials]);

  // Compras are only loaded by the compras/accounts pages today — load them
  // here too so "Compras / Materiales del cliente" has data even when the
  // user navigates straight to a customer without visiting Compras first.
  useEffect(() => {
    if (company && comprasLedger.length === 0) {
      dispatch(initComprasDatabase()).then(() => {
        dispatch(loadCompras(company.id));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company?.id]);

  if (!customer) {
    return (
      <div data-testid="customer-detail">
        <PageHeader title="Cliente no encontrado" />
        <Card className="mt-4">
          <p className="text-brand-500 text-sm">El cliente solicitado no existe.</p>
          <Button variant="ghost" onClick={() => navigate('/customers')} className="mt-4">
            <ArrowLeft size={16} /> Volver
          </Button>
        </Card>
      </div>
    );
  }

  async function handleDelete() {
    await dispatch(deleteCustomerAsync(customer!.id));
    toast.success('Cliente eliminado correctamente.');
    navigate('/customers');
  }

  const displayName = customer.businessName || `${customer.firstName} ${customer.lastName}`;

  return (
    <div data-testid="customer-detail">
      <PageHeader
        title={displayName}
        subtitle="Detalle de cliente"
        actions={
          <div className="flex gap-2">
            <Button
              variant="ghost"
              icon={<ArrowLeft size={16} />}
              onClick={() => navigate('/customers')}
            >
              Volver
            </Button>
            <Button
              variant="secondary"
              icon={<Pencil size={16} />}
              onClick={() => navigate(`/customers/${customer.id}/edit`)}
              data-testid="edit-customer-btn"
            >
              Editar
            </Button>
            <Button
              variant="danger"
              icon={<Trash2 size={16} />}
              onClick={() => setShowDeleteDialog(true)}
              data-testid="delete-customer-btn"
            >
              Eliminar
            </Button>
          </div>
        }
      />

      <div className="grid gap-4">
        {/* Main info */}
        <Card>
          <div className="flex items-center gap-3 mb-6">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-accent-100 text-accent-700 font-bold text-lg">
              {(customer.businessName?.[0] ?? customer.firstName?.[0] ?? '?').toUpperCase()}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-brand-900">{displayName}</h2>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant={customerTypeVariant[customer.customerType]}>
                  {customerTypeLabel[customer.customerType]}
                </Badge>
                {customer.isActive ? (
                  <Badge variant="success">Activo</Badge>
                ) : (
                  <Badge variant="error">Inactivo</Badge>
                )}
                {customer.hasContributorRetention && (
                  <Badge variant="warning">Retención</Badge>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-3">
            <InfoRow label="Nombre" value={`${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim() || undefined} />
            <InfoRow label="Razón Social" value={customer.businessName} />
            <InfoRow label="NIT" value={customer.nit} />
            <InfoRow label="DUI / Número de documento" value={customer.nationalId} />
            <InfoRow label="Tipo de documento" value={customer.documentType} />
            <InfoRow label="NRC" value={customer.nrc} />
          </div>
        </Card>

        {/* Contact */}
        <Card>
          <h3 className="text-sm font-semibold text-brand-700 mb-4">Información de Contacto</h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-3">
            <InfoRow label="Email" value={customer.email} />
            <InfoRow label="Teléfono" value={customer.phone} />
            <InfoRow label="Dirección" value={customer.address} />
            <InfoRow label="Municipio" value={customer.municipality} />
            <InfoRow label="Departamento" value={customer.department} />
            <InfoRow label="País" value={customer.country} />
          </div>
        </Card>

        {/* Export info (if any) */}
        {(customer.codPais || customer.tipoPersona || customer.tipoDocumento) && (
          <Card>
            <h3 className="text-sm font-semibold text-brand-700 mb-4">Información de Exportación</h3>
            <div className="grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-3">
              <InfoRow label="Código de País" value={customer.codPais} />
              <InfoRow label="Nombre de País" value={customer.nombrePais} />
              <InfoRow label="Tipo de Persona" value={customer.tipoPersona} />
              <InfoRow label="Tipo de Documento" value={customer.tipoDocumento} />
            </div>
          </Card>
        )}

        {/* Compras / Materiales del cliente — only rendered when there's at
            least one compra linked to this customer (zero visual regression
            for customers with no linked purchases). */}
        {linkedMaterials.length > 0 && (
          <Card data-testid="customer-materials-section">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-brand-700">Compras / Materiales del cliente</h3>
              <Badge variant="info">{linkedMaterials.length}</Badge>
            </div>
            <div className="divide-y divide-brand-100">
              {linkedMaterials.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => navigate(`/compras/${c.id}`)}
                  data-testid={`customer-materials-item-${c.id}`}
                  className="w-full flex items-center justify-between gap-4 py-2.5 px-2 -mx-2 rounded-md text-left transition-colors hover:bg-brand-50"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-brand-800 truncate">{c.emisorNombre}</span>
                    <span className="block text-xs text-brand-400">{c.tipoDte} · {c.fecha}</span>
                  </span>
                  <span className="text-sm font-semibold text-brand-900 shrink-0">${c.totalPagar.toFixed(2)}</span>
                </button>
              ))}
            </div>
            <div className="flex justify-between items-center border-t border-brand-200 mt-3 pt-3">
              <span className="text-sm font-medium text-brand-700">Costo de materiales</span>
              <span className="text-base font-semibold text-accent-600" data-testid="customer-materials-total">
                ${materialsTotal.toFixed(2)}
              </span>
            </div>
          </Card>
        )}
      </div>

      <AuditInfo entityType="customer" entityId={customer.id} className="mt-6" />

      <ConfirmDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={handleDelete}
        title="Eliminar Cliente"
        message={`¿Está seguro de que desea eliminar a "${displayName}"? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        variant="danger"
      />
    </div>
  );
}
