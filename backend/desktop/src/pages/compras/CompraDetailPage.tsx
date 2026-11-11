import { useNavigate, useParams, Link } from 'react-router-dom';
import { useState } from 'react';
import { ExternalLink, Trash2, Link2, Unlink } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { Card } from '@/components/common/Card';
import { DataTable, ColumnDef } from '@/components/common/DataTable';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { AuditInfo } from '@/components/localUsers/AuditInfo';
import { useToast } from '@/components/common/Toast';
import { useAppSelector, useAppDispatch } from '@/store';
import { selectCurrentCompany } from '@/store';
import { selectAllInvoices } from '@/store/selectors/invoiceSelectors';
import { selectAllCustomers } from '@/store/selectors/customerSelectors';
import { deleteCompra, updateCompraLink } from '@/store/slices/comprasSlice';
import { isCompraLinked } from '@/services/compras/compraLinks';
import { LinkCompraModal } from '@/components/modals/LinkCompraModal';
import { CompraItem } from '@/types/compras';

type ItemRow = Record<string, unknown> & {
  id: string;
  numItem: number;
  descripcion: string;
  cantidad: number;
  precioUni: number;
  ventaGravada: number;
  ivaItem?: number;
};

function toItemRow(item: CompraItem): ItemRow {
  return { ...item };
}

const CONSULTA_PUBLICA_URL = 'https://admin.factura.gob.sv/consultaPublica';

export default function CompraDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const toast = useToast();

  const currentCompany = useAppSelector(selectCurrentCompany);
  const compras = useAppSelector((s) => s.compras.compras);
  const compra = compras.find((c) => c.id === id) ?? null;
  const invoices = useAppSelector(selectAllInvoices);
  const customers = useAppSelector(selectAllCustomers);

  const [showDelete, setShowDelete] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkModalTab, setLinkModalTab] = useState<'invoices' | 'customers'>('invoices');

  if (!compra) {
    return (
      <div data-testid="compra-detail" className="py-16 text-center text-brand-400">
        Compra no encontrada.
      </div>
    );
  }

  const linked = isCompraLinked(compra);
  const linkedInvoice = compra.linkedInvoiceId
    ? invoices.find((inv) => inv.id === compra.linkedInvoiceId) ?? null
    : null;
  const linkedCustomer = compra.linkedCustomerId
    ? customers.find((c) => c.id === compra.linkedCustomerId) ?? null
    : null;

  async function handleDelete() {
    if (!currentCompany) return;
    await dispatch(deleteCompra({ id: compra!.id, companyId: currentCompany.id }));
    toast.success('Compra eliminada correctamente.');
    navigate('/compras');
  }

  function handleConsultaPublica() {
    const url = `${CONSULTA_PUBLICA_URL}?codigoGeneracion=${compra!.codigoGeneracion}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function openLinkModal(tab: 'invoices' | 'customers') {
    setLinkModalTab(tab);
    setShowLinkModal(true);
  }

  async function handleUnlink() {
    if (!currentCompany) return;
    await dispatch(
      updateCompraLink({
        id: compra!.id,
        companyId: currentCompany.id,
        link: { linkedInvoiceId: null, linkedCustomerId: null, linkNote: null },
      }),
    );
    toast.success('Vinculación eliminada.');
  }

  const columns: ColumnDef<ItemRow>[] = [
    { key: 'numItem', label: '#', sortable: false },
    { key: 'descripcion', label: 'Descripción' },
    { key: 'cantidad', label: 'Cant.' },
    {
      key: 'precioUni',
      label: 'Precio Unit.',
      render: (val) => `$${Number(val).toFixed(2)}`,
    },
    {
      key: 'ventaGravada',
      label: 'Venta Gravada',
      render: (val) => `$${Number(val).toFixed(2)}`,
    },
    {
      key: 'ivaItem',
      label: 'IVA',
      render: (val) => (val != null ? `$${Number(val).toFixed(2)}` : '—'),
    },
  ];

  return (
    <div data-testid="compra-detail" className="space-y-6">
      <PageHeader
        title={compra.internalUse === true ? 'Compra de uso interno' : `Compra — ${compra.tipoDte}`}
        subtitle={compra.fecha}
        onBack={() => navigate(-1)}
        actions={
          <div className="flex gap-2">
            {compra.internalUse !== true && (
              <Button
                variant="secondary"
                icon={<ExternalLink size={16} />}
                onClick={handleConsultaPublica}
              >
                Verificar en Consulta Pública
              </Button>
            )}
            <Button
              variant="danger"
              icon={<Trash2 size={16} />}
              onClick={() => setShowDelete(true)}
            >
              Eliminar
            </Button>
          </div>
        }
      />

      {compra.internalUse === true && (
        <Card data-testid="compra-internal-banner">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="warning">Uso interno</Badge>
            <span className="text-sm text-brand-600">
              Registro de control interno: no es un DTE válido, no se exporta a Hacienda ni se verifica.
            </span>
          </div>
          {(compra.internalReason || compra.documentReference) && (
            <dl className="mt-3 space-y-1 text-sm">
              {compra.internalReason && (
                <div className="flex justify-between gap-4">
                  <dt className="text-brand-500">Motivo</dt>
                  <dd className="text-brand-800 text-right">{compra.internalReason}</dd>
                </div>
              )}
              {compra.documentReference && (
                <div className="flex justify-between gap-4">
                  <dt className="text-brand-500">Referencia del documento</dt>
                  <dd className="text-brand-800 text-right">{compra.documentReference}</dd>
                </div>
              )}
            </dl>
          )}
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Emisor */}
        <Card>
          <h2 className="font-semibold text-brand-800 mb-4">Emisor</h2>
          <dl className="space-y-2 text-sm">
            {[
              { label: 'NIT', value: compra.emisorNit },
              { label: 'NRC', value: compra.emisorNrc ?? '—' },
              { label: 'Nombre', value: compra.emisorNombre },
              { label: 'Nombre Comercial', value: compra.emisorNombreComercial ?? '—' },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between">
                <dt className="text-brand-500">{label}</dt>
                <dd className="text-brand-800 font-medium text-right">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        {/* DTE Info (not applicable to internal-use records) */}
        {compra.internalUse !== true && (
        <Card>
          <h2 className="font-semibold text-brand-800 mb-4">Información DTE</h2>
          <dl className="space-y-2 text-sm">
            {[
              { label: 'Tipo DTE', value: compra.tipoDte },
              { label: 'Código Generación', value: compra.codigoGeneracion },
              { label: 'Número Control', value: compra.numeroControl },
              { label: 'Sello Recibido', value: compra.selloRecibido ?? '—' },
              { label: 'Fecha', value: compra.fecha },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-brand-500 shrink-0">{label}</dt>
                <dd className="text-brand-800 font-mono text-xs text-right break-all">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
        )}
      </div>

      {/* Line items */}
      <Card padding="none">
        <div className="px-5 py-4 border-b border-brand-100">
          <h2 className="font-semibold text-brand-800">Líneas de Detalle</h2>
        </div>
        <div className="p-4">
          <DataTable<ItemRow>
            columns={columns}
            data={compra.items.map(toItemRow)}
            emptyMessage="Sin líneas de detalle."
          />
        </div>
      </Card>

      {/* Totals */}
      <Card>
        <h2 className="font-semibold text-brand-800 mb-4">Totales</h2>
        <dl className="space-y-2 text-sm max-w-xs ml-auto">
          {[
            { label: 'Total Gravada', value: `$${compra.totalGravada.toFixed(2)}` },
            { label: 'Total IVA', value: `$${compra.totalIva.toFixed(2)}` },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between">
              <dt className="text-brand-500">{label}</dt>
              <dd className="text-brand-800">{value}</dd>
            </div>
          ))}
          <div className="flex justify-between border-t border-brand-200 pt-2 font-semibold">
            <dt className="text-brand-800">Total a Pagar</dt>
            <dd className="text-accent-600">${compra.totalPagar.toFixed(2)}</dd>
          </div>
        </dl>
      </Card>

      {/* Vinculación — link this compra to a sales invoice or customer */}
      <Card data-testid="compra-link-section">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-brand-800">Vinculación</h2>
          {linked && <Badge variant="info">Vinculada</Badge>}
        </div>

        {!linked ? (
          <p className="text-sm text-brand-400 mb-4">Sin vinculación</p>
        ) : (
          <dl className="space-y-2 text-sm mb-4">
            {compra.linkedInvoiceId && (
              <div className="flex justify-between items-center gap-4">
                <dt className="text-brand-500 shrink-0">Factura</dt>
                <dd data-testid="compra-linked-invoice" className="text-right">
                  {linkedInvoice ? (
                    <Link
                      to={`/invoices/${linkedInvoice.id}`}
                      className="text-accent-600 hover:text-accent-700 font-medium"
                    >
                      {linkedInvoice.controlNumber || linkedInvoice.invoiceNumber}
                    </Link>
                  ) : (
                    <span className="text-brand-400 italic">Factura no encontrada</span>
                  )}
                </dd>
              </div>
            )}
            {compra.linkedCustomerId && (
              <div className="flex justify-between items-center gap-4">
                <dt className="text-brand-500 shrink-0">Cliente</dt>
                <dd data-testid="compra-linked-customer" className="text-right">
                  {linkedCustomer ? (
                    <Link
                      to={`/customers/${linkedCustomer.id}`}
                      className="text-accent-600 hover:text-accent-700 font-medium"
                    >
                      {linkedCustomer.businessName || `${linkedCustomer.firstName} ${linkedCustomer.lastName}`.trim()}
                    </Link>
                  ) : (
                    <span className="text-brand-400 italic">Cliente no encontrado</span>
                  )}
                </dd>
              </div>
            )}
            {compra.linkNote && (
              <div className="flex justify-between items-start gap-4">
                <dt className="text-brand-500 shrink-0">Nota</dt>
                <dd data-testid="compra-link-note" className="text-brand-800 text-right">
                  {compra.linkNote}
                </dd>
              </div>
            )}
          </dl>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            icon={<Link2 size={16} />}
            onClick={() => openLinkModal('invoices')}
            data-testid="compra-link-invoice-btn"
          >
            Vincular a factura
          </Button>
          <Button
            variant="secondary"
            icon={<Link2 size={16} />}
            onClick={() => openLinkModal('customers')}
            data-testid="compra-link-customer-btn"
          >
            Vincular a cliente
          </Button>
          {linked && (
            <Button
              variant="ghost"
              icon={<Unlink size={16} />}
              onClick={handleUnlink}
              data-testid="compra-unlink-btn"
            >
              Desvincular
            </Button>
          )}
        </div>
      </Card>

      {/* Verification */}
      {compra.internalUse !== true && (
      <Card>
        <h2 className="font-semibold text-brand-800 mb-3">Verificación con Ministerio de Hacienda</h2>
        <div className="flex items-center gap-3 flex-wrap">
          {compra.verified === true && <Badge variant="success">Verificado por MH</Badge>}
          {compra.verified === false && compra.verifiedEstado && /invalidad/i.test(compra.verifiedEstado) && (
            <Badge variant="error">Invalidado por emisor</Badge>
          )}
          {compra.verified === false && !(compra.verifiedEstado && /invalidad/i.test(compra.verifiedEstado)) && (
            <Badge variant="error">No confirmado por MH</Badge>
          )}
          {compra.verified == null && <Badge variant="neutral">Sin verificar</Badge>}
          {compra.verifiedAt && (
            <span className="text-xs text-brand-400">
              Última verificación: {new Date(compra.verifiedAt).toLocaleString('es-SV')}
            </span>
          )}
          {compra.verifiedEstado && (
            <Badge variant="info">{compra.verifiedEstado}</Badge>
          )}
        </div>

        {/* Descripción del estado — texto largo del MH. Para invalidaciones
            incluye el motivo + fecha que reportó el emisor. */}
        {(compra.verifiedDescripcion || compra.invalidationReason || compra.invalidatedAt) && (
          <div className="mt-3 rounded-md border border-brand-100 bg-brand-50/40 p-3 space-y-1 text-sm">
            {compra.verifiedDescripcion && (
              <p className="text-brand-800">{compra.verifiedDescripcion}</p>
            )}
            {compra.invalidatedAt && (
              <p className="text-xs text-brand-500">
                <span className="font-medium">Invalidado el:</span>{' '}
                {new Date(compra.invalidatedAt).toLocaleString('es-SV')}
              </p>
            )}
            {compra.invalidationReason && (
              <p className="text-xs text-brand-500">
                <span className="font-medium">Motivo:</span> {compra.invalidationReason}
              </p>
            )}
          </div>
        )}

        {/* Comparación de montos vs MH — sólo cuando tenemos datos del MH.
            Permite detectar tampering del JSON local manteniendo la
            verificación principal basada en estadoDoc. */}
        {(compra.mhTotalPagar != null || compra.mhMontoTotalOperacion != null) && (() => {
          const localTotal = compra.totalPagar;
          const mhTP = compra.mhTotalPagar;
          const mhOp = compra.mhMontoTotalOperacion;
          const tpMatch = mhTP == null || Math.abs(mhTP - localTotal) < 0.01;
          const opMatch = mhOp == null || Math.abs(mhOp - localTotal) < 0.01;
          const anyMismatch = !tpMatch || !opMatch;
          return (
            <div className="mt-4 border-t border-brand-100 pt-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-medium text-brand-700">Comparación de montos</span>
                {anyMismatch ? (
                  <Badge variant="warning">Diferencias detectadas</Badge>
                ) : (
                  <Badge variant="success">Montos coinciden</Badge>
                )}
              </div>
              <dl className="text-sm grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-md border border-brand-100 p-3">
                  <dt className="text-xs text-brand-500 mb-1">Total local (app)</dt>
                  <dd className="font-semibold text-brand-900">${localTotal.toFixed(2)}</dd>
                </div>
                {mhTP != null && (
                  <div
                    className={`rounded-md border p-3 ${tpMatch ? 'border-brand-100' : 'border-amber-300 bg-amber-50'}`}
                  >
                    <dt className="text-xs text-brand-500 mb-1">MH · totalPagar</dt>
                    <dd className={`font-semibold ${tpMatch ? 'text-brand-900' : 'text-amber-700'}`}>
                      ${mhTP.toFixed(2)}
                      {!tpMatch && <span className="ml-2 text-xs">({(mhTP - localTotal).toFixed(2)})</span>}
                    </dd>
                  </div>
                )}
                {mhOp != null && (
                  <div
                    className={`rounded-md border p-3 ${opMatch ? 'border-brand-100' : 'border-amber-300 bg-amber-50'}`}
                  >
                    <dt className="text-xs text-brand-500 mb-1">MH · montoTotalOperacion</dt>
                    <dd className={`font-semibold ${opMatch ? 'text-brand-900' : 'text-amber-700'}`}>
                      ${mhOp.toFixed(2)}
                      {!opMatch && <span className="ml-2 text-xs">({(mhOp - localTotal).toFixed(2)})</span>}
                    </dd>
                  </div>
                )}
              </dl>
              {anyMismatch && (
                <p className="mt-2 text-xs text-brand-500">
                  Las diferencias pueden deberse a retenciones de IVA o renta aplicadas.
                  El documento se considera válido si el estado del MH lo confirma.
                </p>
              )}
            </div>
          );
        })()}
      </Card>
      )}

      <AuditInfo entityType="compra" entityId={compra.id} />

      <ConfirmDialog
        isOpen={showDelete}
        onClose={() => setShowDelete(false)}
        onConfirm={handleDelete}
        title="Eliminar Compra"
        message="¿Estás seguro de que deseas eliminar esta compra? Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        variant="danger"
      />

      <LinkCompraModal
        isOpen={showLinkModal}
        onClose={() => setShowLinkModal(false)}
        compra={compra}
        initialTab={linkModalTab}
      />
    </div>
  );
}
