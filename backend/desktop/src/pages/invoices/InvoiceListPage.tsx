import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, FileText, AlertTriangle, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/common/Button';
import { DataTable, ColumnDef } from '@/components/common/DataTable';
import { SearchBar } from '@/components/common/SearchBar';
import { StickyToolbar } from '@/components/common/StickyToolbar';
import { Select } from '@/components/common/Select';
import { EmptyState } from '@/components/common/EmptyState';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { InvoiceTypeBadge } from '@/components/invoices/InvoiceTypeBadge';
import { InvoiceStatusBadge } from '@/components/invoices/InvoiceStatusBadge';
import { useAppDispatch, useAppSelector } from '@/store';
import {
  selectCurrentCompanyInvoices,
  selectFilteredInvoices,
  selectInvoicesSearchTerm,
  selectInvoiceTypeFilter,
  selectInvoiceStatusFilter,
} from '@/store/selectors/invoiceSelectors';
import { setSearchTerm, setInvoiceFilters, deleteInvoice } from '@/store/slices/invoiceSlice';
import { Invoice, InvoiceType, InvoiceStatus } from '@/types/invoice';
import { CompanyEnvironment } from '@/types/company';
import { selectAllCustomers } from '@/store/selectors/customerSelectors';
import { selectCurrentTier } from '@/store/selectors/subscriptionSelectors';
import { selectCurrentCompany } from '@/store/selectors/companySelectors';
import { canCreateInvoice, getMaxInvoicesPerMonth } from '@/services/subscription/FeatureGate';
import { SubscriptionModal } from '@/components/modals/SubscriptionModal';
import { SubscriptionTier } from '@/services/subscription/SubscriptionTypes';
import { useToast } from '@/components/common/Toast';
import { usePermissionCheck } from '@/hooks/useLocalUsers';
import { selectAuditStamps, selectLocalUsers, selectLocalUsersEnabled } from '@/store/selectors/localUsersSelectors';
import { auditKey } from '@/store/slices/auditSlice';
import { guardDraftDeletion, needsMhCheckBeforeDelete } from '@/services/api/MhDocumentLookup';

const ALL_TYPES: { label: string; value: string }[] = [
  { label: 'Todos los tipos', value: '' },
  { label: 'Factura', value: String(InvoiceType.Factura) },
  { label: 'CCF', value: String(InvoiceType.CCF) },
  { label: 'Nota de Crédito', value: String(InvoiceType.NotaCredito) },
  { label: 'Sujeto Excluido', value: String(InvoiceType.SujetoExcluido) },
  { label: 'Nota de Débito', value: String(InvoiceType.NotaDebito) },
  { label: 'Nota de Remisión', value: String(InvoiceType.NotaRemision) },
  { label: 'Comp. Liquidación', value: String(InvoiceType.ComprobanteLiquidacion) },
  { label: 'Factura Exportación', value: String(InvoiceType.FacturaExportacion) },
  { label: 'Comp. Retención', value: String(InvoiceType.ComprobanteRetencion) },
  { label: 'Doc. Contable Liq.', value: String(InvoiceType.DocumentoContableLiquidacion) },
  { label: 'Comp. Donación', value: String(InvoiceType.ComprobanteDonacion) },
  { label: 'Evento Operaciones Especiales (17)', value: String(InvoiceType.EventoOperacionesEspeciales) },
  { label: 'Evento de Retorno (18)', value: String(InvoiceType.EventoRetorno) },
];

const ALL_STATUSES: { label: string; value: string }[] = [
  { label: 'Todos los estados', value: '' },
  { label: 'Nueva', value: String(InvoiceStatus.Nueva) },
  { label: 'Sincronizando', value: String(InvoiceStatus.Sincronizando) },
  { label: 'Completada', value: String(InvoiceStatus.Completada) },
  { label: 'Anulada', value: String(InvoiceStatus.Anulada) },
  { label: 'Modificada', value: String(InvoiceStatus.Modificada) },
  { label: 'Error envío', value: String(InvoiceStatus.ErrorEnvio) },
  { label: 'Contingencia', value: String(InvoiceStatus.Contingencia) },
];

const EVENT_TYPES = new Set<InvoiceType>([
  InvoiceType.EventoOperacionesEspeciales,
  InvoiceType.EventoRetorno,
]);

const DOCUMENT_GROUPS: { label: string; value: 'all' | 'documents' | 'events' }[] = [
  { label: 'Todos', value: 'all' },
  { label: 'Documentos', value: 'documents' },
  { label: 'Eventos', value: 'events' },
];

type InvoiceRow = Record<string, unknown> & {
  id: string;
  date: string;
  controlNumber: string;
  invoiceType: InvoiceType;
  customerName: string;
  totalAmount: number;
  status: InvoiceStatus;
  createdBy: string;
  createdById: string;
};

export default function InvoiceListPage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const invoices = useAppSelector(selectFilteredInvoices);
  const allInvoices = useAppSelector(selectCurrentCompanyInvoices);
  const customers = useAppSelector(selectAllCustomers);
  const searchTerm = useAppSelector(selectInvoicesSearchTerm);
  const tier = useAppSelector(selectCurrentTier);
  const currentCompany = useAppSelector(selectCurrentCompany);
  const typeFilter = useAppSelector(selectInvoiceTypeFilter);
  const statusFilter = useAppSelector(selectInvoiceStatusFilter);
  const toast = useToast();
  // Local users: who created each document (local audit) + what this user may do.
  const auditStamps = useAppSelector(selectAuditStamps);
  const localUsersEnabled = useAppSelector(selectLocalUsersEnabled);
  const localUsers = useAppSelector(selectLocalUsers);
  const { can } = usePermissionCheck();
  const mayIssue = can('invoices.create');
  const mayInvalidate = can('invoices.invalidate');
  const [creatorFilter, setCreatorFilter] = useState('');

  const [showUpgrade, setShowUpgrade] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [checkingMhBeforeDelete, setCheckingMhBeforeDelete] = useState(false);
  const [documentGroupFilter, setDocumentGroupFilter] = useState<'all' | 'documents' | 'events'>('all');

  function resolveCustomerName(invoice: Invoice): string {
    if (invoice.customer) {
      return invoice.customer.businessName ||
        `${invoice.customer.firstName} ${invoice.customer.lastName}`.trim();
    }
    if (invoice.customerId) {
      const c = customers.find(cu => cu.id === invoice.customerId);
      if (c) return c.businessName || `${c.firstName} ${c.lastName}`.trim();
    }
    return '—';
  }

  // Free-tier gating: count invoices created in the current calendar month.
  const invoicesThisMonth = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    return allInvoices.filter((inv) => {
      const d = new Date(inv.createdAt ?? inv.date);
      return d.getFullYear() === y && d.getMonth() === m;
    }).length;
  }, [allInvoices]);

  // Test (Pruebas) companies are exempt from the Free-tier cap — see getMaxInvoicesPerMonth.
  const isLiveCompany =
    currentCompany?.environment === CompanyEnvironment.Production && currentCompany?.isTestAccount !== true;
  const canCreate = canCreateInvoice(tier, invoicesThisMonth, isLiveCompany);
  const maxPerMonth = getMaxInvoicesPerMonth(tier, isLiveCompany);

  const handleNew = () => {
    if (!mayIssue) {
      toast.warning('Tu usuario no tiene permiso para emitir documentos.');
      return;
    }
    if (!currentCompany) {
      toast.warning('Selecciona o crea una empresa antes de emitir un DTE.');
      navigate('/companies');
      return;
    }
    if (!canCreate) {
      setShowUpgrade(true);
      return;
    }
    navigate('/invoices/add');
  };

  // Only drafts may be deleted — same rule as the detail page (canDelete = isDraft).
  // A DTE Hacienda already accepted (or an invalidated one) is the company's only
  // local copy of a fiscal document; "Seleccionar todas" + Eliminar used to wipe them.
  const deletableIds = useMemo(() => {
    const byId = new Map(invoices.map(inv => [inv.id, inv]));
    return selectedIds.filter(id => {
      const status = byId.get(id)?.status;
      return status === InvoiceStatus.Nueva || status === InvoiceStatus.ErrorEnvio;
    });
  }, [invoices, selectedIds]);
  const keptCount = selectedIds.length - deletableIds.length;

  // Bulk delete handler — opens the styled ConfirmDialog
  const handleBulkDelete = () => {
    // Ctrl+D reaches here too — the button alone was the only permission check.
    if (!mayIssue || deletableIds.length === 0) return;
    setConfirmBulkDelete(true);
  };

  // An "Error de envío" draft may already be PROCESADO at MH (the failure can
  // happen after Hacienda accepted it): ask MH by codigoGeneracion before
  // deleting, and keep the draft when MH holds it or can't be consulted.
  const performBulkDelete = async () => {
    if (checkingMhBeforeDelete) return;
    const byId = new Map(invoices.map(inv => [inv.id, inv]));
    const candidates = deletableIds.map(id => byId.get(id)).filter((inv): inv is Invoice => !!inv);
    const needsCheck = candidates.some(needsMhCheckBeforeDelete);
    if (needsCheck) setCheckingMhBeforeDelete(true);
    let guard;
    try {
      guard = await guardDraftDeletion(candidates, currentCompany);
    } finally {
      if (needsCheck) setCheckingMhBeforeDelete(false);
    }
    const count = guard.deletable.length;
    guard.deletable.forEach(inv => dispatch(deleteInvoice(inv.id)));
    setSelectedIds([]);
    setConfirmBulkDelete(false);
    const label = (inv: Invoice) => inv.controlNumber || inv.invoiceNumber;
    if (guard.processed.length > 0) {
      toast.error(
        `Hacienda ya procesó ${guard.processed.map(label).join(', ')}: no se eliminó. ` +
        'Ábrelo y reenvíalo para completarlo con el sello de Hacienda.',
      );
    }
    if (guard.unverified.length > 0) {
      toast.error(
        `No se eliminó ${guard.unverified.map(u => label(u.invoice)).join(', ')}: no se pudo confirmar con Hacienda ` +
        `si ya fue procesado (${guard.unverified[0].reason}). Inténtalo de nuevo con conexión.`,
      );
    }
    if (count > 0) {
      toast.success(`Se eliminaron ${count} elemento${count === 1 ? '' : 's'}.`);
    }
  };

  const bulkDeleteCount = deletableIds.length;
  const bulkDeleteTitle = `¿Eliminar ${bulkDeleteCount} elemento${bulkDeleteCount === 1 ? '' : 's'} seleccionado${bulkDeleteCount === 1 ? '' : 's'}?`;
  const mhCheckCount = useMemo(() => {
    const byId = new Map(invoices.map(inv => [inv.id, inv]));
    return deletableIds.filter(id => {
      const inv = byId.get(id);
      return !!inv && needsMhCheckBeforeDelete(inv);
    }).length;
  }, [invoices, deletableIds]);
  const bulkDeleteMhNote = mhCheckCount > 0
    ? ` Antes de eliminar ${mhCheckCount === 1 ? 'el documento con error de envío' : `los ${mhCheckCount} documentos con error de envío`} se consultará a Hacienda; si ya fue procesado no se elimina.`
    : '';
  const bulkDeleteMessage = (keptCount > 0
    ? `Solo se eliminan borradores (Nueva o Error de envío). ${keptCount} documento${keptCount === 1 ? '' : 's'} ya emitido${keptCount === 1 ? '' : 's'} se conservará${keptCount === 1 ? '' : 'n'}. Esta acción no se puede deshacer.`
    : 'Esta acción no se puede deshacer.') + bulkDeleteMhNote;

  const toggleSelect = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id)
        ? prev.filter(i => i !== id)
        : [...prev, id]
    );
  };

  const visibleInvoices = useMemo(() => {
    let list = invoices;
    if (documentGroupFilter === 'events') {
      list = list.filter(inv => EVENT_TYPES.has(inv.invoiceType));
    } else if (documentGroupFilter === 'documents') {
      list = list.filter(inv => !EVENT_TYPES.has(inv.invoiceType));
    }
    if (localUsersEnabled && creatorFilter) {
      list = list.filter(inv => auditStamps[auditKey('invoice', inv.id)]?.createdBy?.id === creatorFilter);
    }
    return list;
  }, [documentGroupFilter, invoices, localUsersEnabled, creatorFilter, auditStamps]);

  const rows: InvoiceRow[] = visibleInvoices
    .map(inv => {
      const createdBy = auditStamps[auditKey('invoice', inv.id)]?.createdBy;
      return {
      id: inv.id,
      date: inv.date,
      controlNumber: inv.controlNumber || inv.invoiceNumber,
      invoiceType: inv.invoiceType,
      customerName: resolveCustomerName(inv),
      totalAmount: inv.totals?.totalPagar ?? inv.totalAmountIncludingTax ?? inv.totalAmount ?? 0,
      status: inv.status,
      createdBy: createdBy?.name ?? '—',
      createdById: createdBy?.id ?? '',
    };
    });

  const allSelected = rows.length > 0 && selectedIds.length === rows.length;
  const selectAll = () => {
    setSelectedIds(allSelected ? [] : rows.map(r => r.id));
  };

  // Clear selection when underlying invoice list changes (e.g. company switch).
  useEffect(() => {
    setSelectedIds([]);
  }, [allInvoices]);

  // Keyboard shortcuts: Ctrl+N (new invoice), Ctrl+K (focus search), Ctrl+D (bulk delete)
  useEffect(() => {
    const handleShortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        handleNew();
        e.preventDefault();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        const input = document.querySelector('[data-testid="search-bar"] input') as HTMLInputElement | null;
        input?.focus();
        e.preventDefault();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        if (selectedIds.length > 0) {
          handleBulkDelete();
        }
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, currentCompany, canCreate]);

  const allColumns: ColumnDef<InvoiceRow>[] = [
    {
      key: 'select',
      label: '',
      sortable: false,
      render: (_val, row) => (
        <input
          type="checkbox"
          checked={selectedIds.includes(row.id)}
          onChange={() => toggleSelect(row.id)}
          onClick={(e) => e.stopPropagation()}
          className="w-4 h-4 rounded border-brand-300"
          data-testid={`checkbox-${row.id}`}
        />
      ),
    },
    {
      key: 'controlNumber',
      label: 'Nº Control',
      sortable: true,
      render: (v) => (
        <span className="font-mono text-xs text-brand-700">{String(v || '—')}</span>
      ),
    },
    {
      key: 'date',
      label: 'Fecha',
      sortable: true,
      render: (v) => {
        const d = new Date(v as string);
        return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-SV');
      },
    },
    {
      key: 'invoiceType',
      label: 'Tipo',
      render: (v) => <InvoiceTypeBadge type={v as InvoiceType} />,
    },
    {
      key: 'customerName',
      label: 'Cliente',
      sortable: true,
    },
    {
      key: 'totalAmount',
      label: 'Total ($)',
      sortable: true,
      render: (v) => `$${(v as number).toFixed(2)}`,
    },
    {
      key: 'status',
      label: 'Estado',
      render: (v) => <InvoiceStatusBadge status={v as InvoiceStatus} />,
    },
    {
      key: 'createdBy',
      label: 'Creado por',
      sortable: true,
      render: (v) => <span className="text-brand-600" data-testid="invoice-created-by">{String(v)}</span>,
    },
  ];
  // Selection only drives bulk delete (an issuing action); "Creado por" only
  // means something once local users are on.
  const columns = allColumns.filter(column =>
    (column.key !== 'select' || mayIssue) && (column.key !== 'createdBy' || localUsersEnabled),
  );

  return (
    <div data-testid="invoice-list">
      <PageHeader
        title="DTE y Eventos"
        subtitle="Documentos tributarios electrónicos, eventos de Retorno y Operaciones Especiales"
        actions={
          <div className="flex gap-2">
            {deletableIds.length > 0 && mayIssue && (
              <Button
                variant="danger"
                onClick={handleBulkDelete}
                icon={<Trash2 size={16} />}
                loading={checkingMhBeforeDelete}
                data-testid="btn-bulk-delete"
              >
                Eliminar ({deletableIds.length})
              </Button>
            )}
            {mayInvalidate && (
              <Button
                variant="secondary"
                icon={<AlertTriangle size={16} />}
                onClick={() => navigate('/invoices/contingency')}
                data-testid="btn-contingency-list"
              >
                Contingencia
              </Button>
            )}
            {mayIssue && (
              <Button
                variant="primary"
                icon={<Plus size={16} />}
                onClick={handleNew}
                data-testid="btn-new-invoice"
              >
                Nuevo DTE o Evento
              </Button>
            )}
          </div>
        }
      />

      {tier === SubscriptionTier.Lite && Number.isFinite(maxPerMonth) && (
        <div
          data-testid="free-tier-counter"
          className="mb-3 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
        >
          <span>
            Has creado <strong>{invoicesThisMonth}</strong> de {maxPerMonth} documentos o eventos este mes (plan Free).
          </span>
          <button
            type="button"
            onClick={() => setShowUpgrade(true)}
            className="font-semibold text-amber-900 underline hover:no-underline"
          >
            Mejorar a Pro
          </button>
        </div>
      )}

      <SubscriptionModal
        isOpen={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        requiredTier={SubscriptionTier.AdFree}
        featureName="DTE y eventos ilimitados"
      />

      <ConfirmDialog
        isOpen={confirmBulkDelete}
        onClose={() => setConfirmBulkDelete(false)}
        onConfirm={() => { void performBulkDelete(); }}
        title={bulkDeleteTitle}
        message={bulkDeleteMessage}
        confirmLabel={checkingMhBeforeDelete ? 'Consultando a Hacienda…' : 'Eliminar'}
        variant="danger"
      />

      {/* Search + Filters — pinned to the top while the list scrolls */}
      <StickyToolbar data-testid="dte-sticky-toolbar">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex-1">
            <SearchBar
              value={searchTerm}
              onChange={v => dispatch(setSearchTerm(v))}
              placeholder="Buscar por control, cliente, tipo, código de generación, sello o DTE origen..."
            />
          </div>
          <div className="flex gap-2">
            <Select
              options={DOCUMENT_GROUPS}
              value={documentGroupFilter}
              onChange={e => setDocumentGroupFilter(e.target.value as 'all' | 'documents' | 'events')}
            />
            <Select
              options={ALL_TYPES}
              value={typeFilter}
              onChange={e => {
                const v = e.target.value;
                dispatch(setInvoiceFilters({
                  invoiceType: v !== '' ? [parseInt(v) as InvoiceType] : undefined,
                }));
              }}
            />
            {localUsersEnabled && (
              <Select
                options={[
                  { label: 'Creado por: todos', value: '' },
                  ...localUsers.map(user => ({ label: user.displayName, value: user.id })),
                ]}
                value={creatorFilter}
                onChange={e => setCreatorFilter(e.target.value)}
                data-testid="invoice-filter-creator"
              />
            )}
            <Select
              options={ALL_STATUSES}
              value={statusFilter}
              onChange={e => {
                const v = e.target.value;
                dispatch(setInvoiceFilters({
                  status: v !== '' ? [parseInt(v) as InvoiceStatus] : undefined,
                }));
              }}
            />
          </div>
        </div>
      </StickyToolbar>

      {rows.length === 0 ? (
        <EmptyState
          icon={<FileText size={28} />}
          title="No hay DTE ni eventos"
          message="Crea tu primer DTE o evento electrónico."
          action={mayIssue ? { label: 'Nuevo DTE o Evento', onClick: handleNew } : undefined}
        />
      ) : (
        <>
          <div className="flex items-center justify-between text-xs text-brand-500 mb-2 px-1">
            {mayIssue ? <button
              type="button"
              onClick={selectAll}
              className="hover:text-brand-700 underline-offset-2 hover:underline"
              data-testid="btn-select-all"
            >
              {allSelected ? 'Deseleccionar todas' : 'Seleccionar todas'}
            </button> : <span />}
            {selectedIds.length > 0 && (
              <span data-testid="selected-count">{selectedIds.length} seleccionada(s)</span>
            )}
          </div>
          <DataTable
            columns={columns}
            data={rows}
            onRowClick={row => navigate(`/invoices/${row.id}`)}
          />
        </>
      )}
    </div>
  );
}
