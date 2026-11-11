import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, RefreshCw, Edit, FileText, Ban, Mail, Eye,
  MinusCircle, PlusCircle, Truck, Layers, Copy, ChevronDown, Trash2,
  AlertTriangle, AlertCircle,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { Badge } from '@/components/common/Badge';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { InvoiceTypeBadge } from '@/components/invoices/InvoiceTypeBadge';
import { InvoiceStatusBadge } from '@/components/invoices/InvoiceStatusBadge';
import { InvoiceLineItems, supportsLineDiscounts } from '@/components/invoices/InvoiceLineItems';
import { InvoiceTotals } from '@/components/invoices/InvoiceTotals';
import { documentWithholdings } from '@/utils/invoiceTotals';
import { useToast } from '@/components/common/Toast';
import { useAppDispatch, useAppSelector } from '@/store';
import { selectAllInvoices } from '@/store/selectors/invoiceSelectors';
import { selectAllCustomers } from '@/store/selectors/customerSelectors';
import { selectCurrentCompany } from '@/store/selectors/companySelectors';
import { deleteInvoice, setInvoiceStatus, updateInvoice, markAsContingency } from '@/store/slices/invoiceSlice';
import { loadCompras, initComprasDatabase } from '@/store/slices/comprasSlice';
import { comprasLinkedToInvoice, linkedMaterialsTotal } from '@/services/compras/compraLinks';
import { TicketDatabase } from '@/services/tickets/TicketDatabase';
import { checkConsolidatedInvoice } from '@/services/tickets/ConsolidationService';
import { formatTicketNumber } from '@/services/tickets/ticketNumber';
import { hasReturns, ticketKeptAmount, ticketRefundTotal } from '@/services/tickets/TicketReturns';
import { guardDraftDeletion } from '@/services/api/MhDocumentLookup';
import type { Ticket } from '@/types/ticket';
import { InvoiceStatus, InvoiceType } from '@/types/invoice';
import { InvoicePDFGenerator } from '@/services/pdf/InvoicePDFGenerator';
import { EmailService } from '@/services/email/EmailService';
import { DTESubmissionModal, DTESubmissionResult } from '@/components/modals/DTESubmissionModal';
import { InvoicePDFPreview } from '@/components/invoices/InvoicePDFPreview';
import { SubscriptionModal } from '@/components/modals/SubscriptionModal';
import { selectCurrentTier } from '@/store/selectors/subscriptionSelectors';
import { canSendEmail, requiresPdfWatermark } from '@/services/subscription/FeatureGate';
import { SubscriptionTier } from '@/services/subscription/SubscriptionTypes';
import { TelemetryService } from '@/services/telemetry/TelemetryService';
import { TelemetryEvent } from '@/config/telemetryConfig';
import { applyInvoiceStockDeduction } from '@/store/slices/productSlice';
import { invoiceStockDeductionPayload } from '@/services/inventory/invoiceStockRules';
import { usePermissionCheck } from '@/hooks/useLocalUsers';
import { AuditInfo } from '@/components/localUsers/AuditInfo';

function isDTEEventType(type: InvoiceType): boolean {
  return type === InvoiceType.EventoOperacionesEspeciales || type === InvoiceType.EventoRetorno;
}

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const toast = useToast();

  const invoices = useAppSelector(selectAllInvoices);
  const customers = useAppSelector(selectAllCustomers);
  const company = useAppSelector(selectCurrentCompany);
  const comprasLedger = useAppSelector((s) => s.compras.ledgerCompras);
  // Local user permissions: issuing (edit/send/duplicate/linked docs) and
  // invalidating are separate grants; viewing the document is the screen itself.
  const { can } = usePermissionCheck();
  const mayIssue = can('invoices.create');
  const mayInvalidate = can('invoices.invalidate');

  const invoice = invoices.find(inv => inv.id === id) || null;
  const customer = invoice?.customerId
    ? customers.find(c => c.id === invoice.customerId) || null
    : null;
  const invoiceWithCustomer = invoice
    ? customer && invoice.customer?.id !== customer.id
      ? { ...invoice, customer }
      : invoice
    : null;

  // Compras (purchases) linked to this invoice — "materials" bought for the
  // job/sale this invoice bills. Purely additive/read-only: never mutates
  // invoice state, only reads from the compras ledger.
  const linkedMaterials = useMemo(
    () => (invoice ? comprasLinkedToInvoice(comprasLedger, invoice.id, invoice.companyId) : []),
    [comprasLedger, invoice],
  );
  const materialsTotal = useMemo(() => linkedMaterialsTotal(linkedMaterials), [linkedMaterials]);

  // POS tickets consolidated into (or pending on) this invoice, plus the
  // invoice's own sourceTicketIds (so a lost reservation, a void or a ticket
  // taken by another draft is visible — and blocks sending).
  const [sourceTickets, setSourceTickets] = useState<Ticket[]>([]);
  const [sourceTicketsVersion, setSourceTicketsVersion] = useState(0);
  const sourceTicketKey = invoice?.sourceTicketIds?.join(',') ?? '';
  useEffect(() => {
    if (!invoice?.companyId) {
      setSourceTickets([]);
      return;
    }
    let cancelled = false;
    const companyId = invoice.companyId;
    const ids = invoice.sourceTicketIds ?? [];
    Promise.all([
      TicketDatabase.getByInvoiceId(companyId, invoice.id),
      ids.length ? TicketDatabase.getTicketsByIds(companyId, ids) : Promise.resolve([] as Ticket[]),
    ])
      .then(([linked, sources]) => {
        if (cancelled) return;
        const merged = new Map<string, Ticket>();
        for (const t of [...sources, ...linked]) merged.set(t.id, t);
        setSourceTickets([...merged.values()].sort((a, b) => a.sequential - b.sequential));
      })
      .catch(() => {});
    const unsubscribe = TicketDatabase.setUiListener(() => setSourceTicketsVersion((v) => v + 1));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [invoice?.id, invoice?.companyId, invoice?.status, sourceTicketKey, sourceTicketsVersion]);

  const consolidationCheck = useMemo(
    () => (invoice?.sourceTicketIds?.length ? checkConsolidatedInvoice(invoice, sourceTickets) : null),
    [invoice, sourceTickets],
  );

  const [syncing, setSyncing] = useState(false);
  const [exportingPDF, setExportingPDF] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [showSubmissionModal, setShowSubmissionModal] = useState(false);
  const [showPDFPreview, setShowPDFPreview] = useState(false);
  const [pdfPreviewMode, setPdfPreviewMode] = useState<'invoice' | 'quote'>('invoice');
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmContingency, setConfirmContingency] = useState(false);
  const [confirmLinked, setConfirmLinked] = useState<{
    type: InvoiceType;
    label: string;
  } | null>(null);

  const tier = useAppSelector(selectCurrentTier);
  const watermark = requiresPdfWatermark(tier);
  const emailAllowed = canSendEmail(tier);

  useEffect(() => {
    if (!showActionsMenu) return;
    function handleOutside(e: MouseEvent) {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target as Node)) {
        setShowActionsMenu(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowActionsMenu(false);
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showActionsMenu]);

  // Compras are only loaded by the compras/accounts pages today — load them
  // here too so "Materiales / Compras vinculadas" has data even when the
  // user navigates straight to an invoice without visiting Compras first.
  useEffect(() => {
    if (company && comprasLedger.length === 0) {
      dispatch(initComprasDatabase()).then(() => {
        dispatch(loadCompras(company.id));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company?.id]);

  if (!invoice) {
    return (
      <div data-testid="invoice-detail">
        <PageHeader title="Factura no encontrada" />
        <Card>
          <p className="text-brand-500">La factura solicitada no existe.</p>
        </Card>
      </div>
    );
  }

  const totals = invoice.totals;
  const totalAmount = totals?.totalPagar ?? invoice.totalAmountIncludingTax ?? invoice.totalAmount ?? 0;

  async function handleSync() {
    if (!company) {
      toast.error('No hay empresa seleccionada.');
      return;
    }
    // A POS consolidation must still match its tickets when it goes to MH
    // (re-read: the list on screen may be a moment old).
    if (invoice!.sourceTicketIds?.length && invoice!.status !== InvoiceStatus.Completada) {
      const fresh = await TicketDatabase.getTicketsByIds(invoice!.companyId, invoice!.sourceTicketIds);
      const check = checkConsolidatedInvoice(invoice!, fresh);
      if (!check.ok) {
        toast.error(check.problems[0]);
        return;
      }
    }
    setShowSubmissionModal(true);
  }

  function openInvoicePreview() {
    setPdfPreviewMode('invoice');
    setShowPDFPreview(true);
  }

  function openQuotePreview() {
    if (!company) {
      toast.error('No hay empresa seleccionada.');
      return;
    }
    setPdfPreviewMode('quote');
    setShowPDFPreview(true);
  }

  function handleSubmissionComplete(result: DTESubmissionResult) {
    if (result.success && result.invoice) {
      setShowSubmissionModal(false);
      const previouslyCompleted = invoice!.status === InvoiceStatus.Completada;
      dispatch(updateInvoice({
        id: invoice!.id,
        status: InvoiceStatus.Completada,
        receptionSeal: result.invoice.receptionSeal,
        generationCode: result.invoice.generationCode,
        controlNumber: result.invoice.controlNumber,
        // The número de control MH holds is the document's number (the PDF
        // used to print the creation-time number next to the sent one).
        ...(result.invoice.controlNumber ? { invoiceNumber: result.invoice.controlNumber } : {}),
        fechaTransmision: result.invoice.fechaTransmision,
        customer: result.invoice.customer ?? customer ?? undefined,
      }));
      // Only FE/CCF/FEX/NR discharge stock (not NC/ND/FSE/CR/CL/DCL/CD/events,
      // not a Factura billing a remission, not a POS consolidation whose
      // tickets already did) — invoiceStockRules is the single rule.
      const stockPayload = previouslyCompleted ? null : invoiceStockDeductionPayload(invoice!, 'sync-dte');
      if (stockPayload) {
        dispatch(applyInvoiceStockDeduction(stockPayload));
      }
      toast.success(`${isDTEEventType(invoice!.invoiceType) ? 'Evento' : 'DTE'} enviado correctamente al Ministerio de Hacienda.`);
    } else if (!result.success) {
      // Leave the modal open so the user can read the error and retry.
      // Status update happens immediately so the list reflects ErrorEnvio.
      if (result.invoice) {
        dispatch(updateInvoice({
          id: invoice!.id,
          status: InvoiceStatus.ErrorEnvio,
          generationCode: result.invoice.generationCode,
          controlNumber: result.invoice.controlNumber,
          ...(result.invoice.controlNumber ? { invoiceNumber: result.invoice.controlNumber } : {}),
          customer: result.invoice.customer ?? customer ?? undefined,
        }));
      } else {
        dispatch(setInvoiceStatus({ id: invoice!.id, status: InvoiceStatus.ErrorEnvio }));
      }
    }
  }

  async function handleExportPDF() {
    if (!company) {
      toast.error('No hay empresa seleccionada.');
      return;
    }
    setExportingPDF(true);
    try {
      const saved = await InvoicePDFGenerator.generateAndSavePDF(invoiceWithCustomer!, company, { watermark, tier });
      if (saved) {
        toast.success('PDF exportado correctamente.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al exportar el PDF.');
    } finally {
      setExportingPDF(false);
    }
  }

  async function handleSendEmail() {
    if (!company) {
      toast.error('No hay empresa seleccionada.');
      return;
    }
    if (!emailAllowed) {
      setShowUpgrade(true);
      return;
    }
    setSendingEmail(true);
    try {
      const result = await EmailService.sendInvoiceByEmail(invoiceWithCustomer!, company, undefined, { watermark, tier });
      if (result.success) {
        const pathMsg = result.savedPath ? ` Archivo guardado en: ${result.savedPath}` : '';
        toast.success(`Cliente de correo abierto.${pathMsg ? ' Adjunte el PDF manualmente.' : ''}`);
      } else {
        toast.error(result.error || 'Error al enviar por email.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al enviar por email.');
    } finally {
      setSendingEmail(false);
    }
  }

  const isDraft =
    invoice.status === InvoiceStatus.Nueva ||
    invoice.status === InvoiceStatus.ErrorEnvio;
  const canEdit = isDraft && mayIssue;
  const canSync = canEdit;
  const canQuote = isDraft;
  const canExport = invoice.status === InvoiceStatus.Completada;
  const canInvalidate = invoice.status === InvoiceStatus.Completada && mayInvalidate;
  // Borrado local permitido solo antes de que MH haya firmado el DTE.
  // Completada/Modificada/Anulada ya viven en los registros de Hacienda
  // y Sincronizando está en vuelo — no se pueden eliminar localmente.
  const canDelete = isDraft && mayIssue;

  // Mirrors iOS canRequestContingency predicate: Nueva or ErrorEnvio qualify.
  // Completada, Anulada, Sincronizando, and already-marked Contingencia do not.
  const canMarkContingency = isDraft && mayInvalidate;

  function handleMarkContingency() {
    dispatch(markAsContingency(invoice!.id));
    toast.success('DTE marcado como emitido bajo contingencia.');
    TelemetryService.trackEvent(TelemetryEvent.ContingencyMarked, {
      dteType: String(invoice!.invoiceType),
      status: String(invoice!.status),
    });
    setConfirmContingency(false);
    setShowActionsMenu(false);
    navigate(`/invoices/contingency?fromInvoice=${invoice!.id}`);
  }

  async function handleDelete() {
    // An ErrorEnvio draft may already be PROCESSED at MH (timeout after
    // acceptance): consult MH by codigoGeneracion before deleting it.
    const guard = await guardDraftDeletion([invoice!], company);
    if (guard.processed.length > 0) {
      toast.error('Hacienda ya procesó este documento: no se eliminó. Reenvíalo para completarlo con el sello de Hacienda.');
      return;
    }
    if (guard.unverified.length > 0) {
      toast.error(`No se eliminó: no se pudo confirmar con Hacienda si ya fue procesado (${guard.unverified[0].reason}).`);
      return;
    }
    dispatch(deleteInvoice(invoice!.id));
    toast.success(`${isDTEEventType(invoice!.invoiceType) ? 'Evento' : 'DTE'} eliminado.`);
    navigate('/invoices');
  }

  // Linked-document actions — mirrors iOS InvoiceDetailView.swift L247-332.
  // Only shown when the parent is Completada (or Modificada).
  const isCompleted =
    (invoice.status === InvoiceStatus.Completada ||
      invoice.status === InvoiceStatus.Modificada) &&
    mayIssue;
  const isCCF = invoice.invoiceType === InvoiceType.CCF;
  const isFactura = invoice.invoiceType === InvoiceType.Factura;
  const canCreateNC = isCompleted && isCCF;
  const canCreateND = isCompleted && isCCF;
  const canCreateNR = isCompleted && (isCCF || isFactura);
  const canCreateCL = isCompleted && (isCCF || isFactura);
  const canRegisterRetorno =
    isCompleted &&
    ['01', '11', '14'].includes(invoice.documentType) &&
    !!invoice.generationCode &&
    !!(invoice.receptionSeal || invoice.fechaTransmision);
  const hasLinkedActions = canCreateNC || canCreateND || canCreateNR || canCreateCL || canRegisterRetorno;

  function handleCreateLinked(type: InvoiceType) {
    const params = new URLSearchParams({
      type: String(type),
      parentId: invoice!.id,
    });
    navigate(`/invoices/add?${params.toString()}`);
    setConfirmLinked(null);
    setShowActionsMenu(false);
  }

  function handleDuplicate() {
    const params = new URLSearchParams({
      type: String(invoice!.invoiceType),
      duplicateFrom: invoice!.id,
    });
    navigate(`/invoices/add?${params.toString()}`);
    setShowActionsMenu(false);
  }

  const customerName = customer
    ? customer.businessName || `${customer.firstName} ${customer.lastName}`.trim()
    : '—';
  const customerDoc = customer ? customer.nit || customer.nationalId : '—';
  const customerAddress = customer?.address || '—';
  const recordLabel = isDTEEventType(invoice.invoiceType) ? 'Evento' : 'DTE';
  const recordLabelSentence = recordLabel === 'DTE' ? 'DTE' : 'evento';

  return (
    <div data-testid="invoice-detail" className="space-y-6">
      {/* Header */}
      <div>
        <button
          onClick={() => navigate('/invoices')}
          className="flex items-center gap-2 text-sm text-brand-500 hover:text-brand-700 mb-4"
        >
          <ArrowLeft size={16} /> Volver a DTE y Eventos
        </button>
        <PageHeader
          title={`${recordLabel} ${invoice.controlNumber || invoice.invoiceNumber}`}
          subtitle={`Código: ${invoice.generationCode || '—'}`}
          actions={
            <div className="flex items-center gap-2">
              <InvoiceTypeBadge type={invoice.invoiceType} />
              <InvoiceStatusBadge status={invoice.status} />
            </div>
          }
        />
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 flex-wrap">
        {canQuote && (
          <Button
            variant="secondary"
            icon={<FileText size={16} />}
            onClick={openQuotePreview}
            data-testid="btn-quote-preview"
          >
            Generar cotización
          </Button>
        )}
        {canSync && (
          <Button
            variant="primary"
            icon={<RefreshCw size={16} />}
            loading={syncing}
            onClick={handleSync}
            data-testid="btn-sync"
          >
            Sincronizar con MH
          </Button>
        )}
        {canEdit && (
          <Button
            variant="secondary"
            icon={<Edit size={16} />}
            onClick={() => navigate(`/invoices/${invoice.id}/edit`)}
          >
            Editar
          </Button>
        )}
        {canExport && (
          <Button
            variant="secondary"
            icon={<Eye size={16} />}
            onClick={openInvoicePreview}
            data-testid="btn-preview-pdf"
          >
            Vista Previa
          </Button>
        )}
        {canExport && (
          <Button
            variant="secondary"
            icon={<FileText size={16} />}
            loading={exportingPDF}
            onClick={handleExportPDF}
            data-testid="btn-export-pdf"
          >
            Exportar PDF
          </Button>
        )}
        {canExport && (
          <Button
            variant="secondary"
            icon={<Mail size={16} />}
            loading={sendingEmail}
            onClick={handleSendEmail}
            data-testid="btn-send-email"
          >
            Enviar por Email
          </Button>
        )}
        {canInvalidate && (
          <Button
            variant="danger"
            icon={<Ban size={16} />}
            onClick={() => navigate(`/invoices/${invoice.id}/invalidate`)}
          >
            Evento de invalidación
          </Button>
        )}
        {canDelete && (
          <Button
            variant="danger"
            icon={<Trash2 size={16} />}
            onClick={() => setConfirmDelete(true)}
            data-testid="btn-delete-invoice"
          >
            Eliminar
          </Button>
        )}

        {/* Actions dropdown — linked docs + duplicate + contingency */}
        {(hasLinkedActions || isCompleted || canMarkContingency) && (
          <div className="relative" data-testid="actions-menu-container" ref={actionsMenuRef}>

            <Button
              variant="secondary"
              icon={<ChevronDown size={16} />}
              onClick={() => setShowActionsMenu(!showActionsMenu)}
              data-testid="btn-actions-menu"
            >
              Más acciones
            </Button>
            {showActionsMenu && (
              <div className="absolute right-0 top-full mt-1 z-50 w-72 bg-white border border-brand-200 rounded-xl shadow-lg py-1 animate-in fade-in slide-in-from-top-2"
                   data-testid="actions-dropdown">
                {canCreateNC && (
                  <button
                    onClick={() => setConfirmLinked({ type: InvoiceType.NotaCredito, label: 'Nota de Crédito' })}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-brand-700 hover:bg-brand-50"
                    data-testid="action-create-nc"
                  >
                    <MinusCircle size={18} className="text-orange-500" />
                    <div className="text-left">
                      <div className="font-medium">Generar Nota de Crédito</div>
                      <div className="text-xs text-brand-400">Corrección o devolución sobre este CCF</div>
                    </div>
                  </button>
                )}
                {canCreateND && (
                  <button
                    onClick={() => setConfirmLinked({ type: InvoiceType.NotaDebito, label: 'Nota de Débito' })}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-brand-700 hover:bg-brand-50"
                    data-testid="action-create-nd"
                  >
                    <PlusCircle size={18} className="text-red-500" />
                    <div className="text-left">
                      <div className="font-medium">Generar Nota de Débito</div>
                      <div className="text-xs text-brand-400">Incremento o cargo adicional sobre este CCF</div>
                    </div>
                  </button>
                )}
                {canCreateNR && (
                  <button
                    onClick={() => setConfirmLinked({ type: InvoiceType.NotaRemision, label: 'Nota de Remisión' })}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-brand-700 hover:bg-brand-50"
                    data-testid="action-create-nr"
                  >
                    <Truck size={18} className="text-blue-500" />
                    <div className="text-left">
                      <div className="font-medium">Generar Nota de Remisión</div>
                      <div className="text-xs text-brand-400">Traslado de mercancías vinculado</div>
                    </div>
                  </button>
                )}
                {canCreateCL && (
                  <button
                    onClick={() => setConfirmLinked({ type: InvoiceType.ComprobanteLiquidacion, label: 'Comprobante de Liquidación' })}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-brand-700 hover:bg-brand-50"
                    data-testid="action-create-cl"
                  >
                    <Layers size={18} className="text-purple-500" />
                    <div className="text-left">
                      <div className="font-medium">Generar Comp. Liquidación</div>
                      <div className="text-xs text-brand-400">Liquidación sobre esta operación</div>
                    </div>
                  </button>
                )}
                {canRegisterRetorno && (
                  <button
                    onClick={() => setConfirmLinked({ type: InvoiceType.EventoRetorno, label: 'Evento de Retorno' })}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-brand-700 hover:bg-brand-50"
                    data-testid="action-create-retorno"
                  >
                    <RefreshCw size={18} className="text-emerald-500" />
                    <div className="text-left">
                      <div className="font-medium">Registrar Evento de Retorno</div>
                      <div className="text-xs text-brand-400">Evento MH vinculado a este DTE recibido</div>
                    </div>
                  </button>
                )}
                <div className="border-t border-brand-100 my-1" />
                {canMarkContingency && (
                  <button
                    onClick={() => setConfirmContingency(true)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-brand-700 hover:bg-brand-50"
                    data-testid="btn-mark-contingency"
                  >
                    <AlertTriangle size={18} className="text-orange-500" />
                    <div className="text-left">
                      <div className="font-medium">Marcar como contingencia</div>
                      <div className="text-xs text-brand-400">Emitida sin conexión — reportar al MH</div>
                    </div>
                  </button>
                )}
                {mayIssue && <div className="border-t border-brand-100 my-1" />}
                {mayIssue && <button
                  onClick={handleDuplicate}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-brand-700 hover:bg-brand-50"
                  data-testid="action-duplicate"
                >
                  <Copy size={18} className="text-brand-400" />
                  <div className="text-left">
                    <div className="font-medium">Duplicar factura</div>
                    <div className="text-xs text-brand-400">Crear una nueva factura con los mismos datos</div>
                  </div>
                </button>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confirmation dialog for linked-document creation */}
      {confirmLinked && (
        <ConfirmDialog
          isOpen={!!confirmLinked}
          title={`Crear ${confirmLinked.label}`}
          message={`Se creará una ${confirmLinked.label} vinculada a "${invoice.controlNumber || invoice.invoiceNumber}" con el mismo cliente y los mismos ítems. ¿Desea continuar?`}
          confirmLabel="Crear"
          onConfirm={() => handleCreateLinked(confirmLinked.type)}
          onClose={() => setConfirmLinked(null)}
        />
      )}

      {/* Confirmation dialog for delete */}
      {confirmDelete && (
        <ConfirmDialog
          isOpen={confirmDelete}
          title={`Eliminar ${recordLabelSentence}`}
          message={`Se eliminará localmente el ${recordLabelSentence} "${invoice.controlNumber || invoice.invoiceNumber}". Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          variant="danger"
          onConfirm={handleDelete}
          onClose={() => setConfirmDelete(false)}
        />
      )}

      {/* Confirmation dialog for mark-as-contingency */}
      {confirmContingency && (
        <ConfirmDialog
          isOpen={confirmContingency}
          title="Marcar como contingencia"
          message="Este DTE quedará marcado como emitido bajo contingencia. Deberás completar el reporte al Ministerio de Hacienda desde la pantalla de Contingencia. ¿Continuar?"
          confirmLabel="Marcar"
          onConfirm={handleMarkContingency}
          onClose={() => setConfirmContingency(false)}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Invoice Health Check - Warning for Modified invoices */}
          {invoice.status === InvoiceStatus.Modificada && (
            <Card className="bg-amber-50 border-amber-200">
              <div className="flex items-start gap-3">
                <AlertCircle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h2 className="text-base font-semibold text-amber-800 mb-1">
                    Factura Modificada
                  </h2>
                  <p className="text-sm text-amber-700 mb-3">
                    Esta factura ha sido modificada después de su creación. Verifique que todos los datos estén actualizados antes de enviarla al Ministerio de Hacienda.
                  </p>
                  <div className="flex items-center gap-2 text-xs text-amber-600">
                    <AlertTriangle size={14} />
                    <span>Recomendado: Revisar todos los campos antes de sincronizar.</span>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* Customer Info */}
          <Card>
            <h2 className="text-base font-semibold text-brand-800 mb-3">Receptor</h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-brand-500">Nombre</dt>
              <dd className="text-brand-900 font-medium">{customerName}</dd>
              <dt className="text-brand-500">NIT / Documento</dt>
              <dd className="text-brand-900">{customerDoc}</dd>
              <dt className="text-brand-500">Dirección</dt>
              <dd className="text-brand-900">{customerAddress}</dd>
            </dl>
          </Card>

          {/* Line Items */}
          <Card>
            <h2 className="text-base font-semibold text-brand-800 mb-3">Ítems</h2>
            <InvoiceLineItems
              items={invoice.items}
              onChange={() => {}}
              readOnly
              supportDiscount={supportsLineDiscounts(invoice.invoiceType)}
            />
          </Card>

          {/* Reception Seal */}
          {invoice.status === InvoiceStatus.Completada && invoice.receptionSeal && (
            <Card>
              <h2 className="text-base font-semibold text-brand-800 mb-3">Sello de Recepción MH</h2>
              <dl className="text-sm space-y-2">
                <div className="flex gap-2">
                  <dt className="text-brand-500 shrink-0">Sello:</dt>
                  <dd className="text-brand-900 font-mono break-all">{invoice.receptionSeal}</dd>
                </div>
              </dl>
            </Card>
          )}

          {/* Invalidation info */}
          {invoice.status === InvoiceStatus.Anulada && (
            <Card>
              <h2 className="text-base font-semibold text-red-600 mb-3">Documento Anulado</h2>
              <dl className="text-sm space-y-2">
                {invoice.invalidatedAt && (
                  <div className="flex gap-2">
                    <dt className="text-brand-500 shrink-0">Anulado el:</dt>
                    <dd className="text-brand-900">{invoice.invalidatedAt.substring(0, 10)}</dd>
                  </div>
                )}
                {invoice.invalidationReason && (
                  <div className="flex gap-2">
                    <dt className="text-brand-500 shrink-0">Motivo:</dt>
                    <dd className="text-brand-900">{invoice.invalidationReason}</dd>
                  </div>
                )}
              </dl>
            </Card>
          )}
        </div>

        {/* Sidebar — Totals */}
        <div className="space-y-4">
          <Card>
            <h2 className="text-base font-semibold text-brand-800 mb-3">Totales</h2>
            <InvoiceTotals
              items={invoice.items}
              invoiceType={invoice.invoiceType}
              // The DTE takes retention / percepción / FSE renta from the stored
              // invoice (not the customer's or company's current flags) — show
              // the same figures here.
              customerHasRetention={documentWithholdings(invoice).hasRetention}
              {...documentWithholdings(invoice).options}
            />
          </Card>
          <Card>
            <h2 className="text-base font-semibold text-brand-800 mb-3">Información General</h2>
            <dl className="text-sm space-y-2">
              <div className="flex justify-between">
                <dt className="text-brand-500">Fecha</dt>
                <dd className="text-brand-900">{invoice.date.substring(0, 10)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-brand-500">Nº Documento</dt>
                <dd className="text-brand-900 font-mono text-xs">{invoice.invoiceNumber}</dd>
              </div>
              {invoice.controlNumber && (
                <div className="flex justify-between">
                  <dt className="text-brand-500">Nº Control</dt>
                  <dd className="text-brand-900 font-mono text-xs">{invoice.controlNumber}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-brand-500">Total</dt>
                <dd className="text-brand-900 font-semibold">${totalAmount.toFixed(2)}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>

      {/* Materiales / Compras vinculadas — only rendered when there's at
          least one compra linked to this invoice (zero visual regression
          on invoices with no linked purchases). */}
      {linkedMaterials.length > 0 && (
        <Card data-testid="invoice-materials-section">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-brand-800">Materiales / Compras vinculadas</h2>
            <Badge variant="info">{linkedMaterials.length}</Badge>
          </div>
          <div className="divide-y divide-brand-100">
            {linkedMaterials.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => navigate(`/compras/${c.id}`)}
                data-testid={`invoice-materials-item-${c.id}`}
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
            <span className="text-base font-semibold text-accent-600" data-testid="invoice-materials-total">
              ${materialsTotal.toFixed(2)}
            </span>
          </div>
        </Card>
      )}

      {/* POS tickets consolidated into this invoice (audit link). Read from
          the ticket DB: pending (draft not yet sent) + consolidated (linked). */}
      {sourceTickets.length > 0 && (
        <Card data-testid="invoice-tickets-section">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-brand-800">Tickets POS incluidos</h2>
            <Badge variant={invoice.status === InvoiceStatus.Completada ? 'success' : 'warning'}>
              {invoice.status === InvoiceStatus.Completada ? 'consolidados' : 'en espera de envío'}
            </Badge>
          </div>
          <div className="divide-y divide-brand-100">
            {sourceTickets.map((t) => (
              <div key={t.id} data-testid={`invoice-ticket-${t.sequential}`} className="flex items-center justify-between gap-4 py-2.5 px-2 -mx-2">
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-brand-800">
                    {formatTicketNumber(t)}
                    {t.excludeFromLibrosIVA && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">fuera de libros</span>}
                  </span>
                  <span className="block text-xs text-brand-400">
                    {new Date(t.completedAt ?? t.createdAt).toLocaleString('es-SV')} ·{' '}
                    {t.payments.map((p) => p.method).join(', ')}
                  </span>
                </span>
                <span className="text-right shrink-0">
                  <span className="block text-sm font-semibold text-brand-900">${ticketKeptAmount(t).toFixed(2)}</span>
                  {hasReturns(t) && (
                    <span className="block text-[11px] text-red-700" data-testid={`invoice-ticket-returned-${t.sequential}`}>
                      vendido ${t.totalAmount.toFixed(2)} · devolución -${ticketRefundTotal(t).toFixed(2)}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
          {consolidationCheck ? (
            <div className="border-t border-brand-200 mt-3 pt-3 space-y-1 text-sm" data-testid="invoice-tickets-reconciliation">
              <div className="flex justify-between text-brand-700">
                <span>Venta de tickets ({sourceTickets.filter((t) => t.status !== 'VOID' && (invoice.sourceTicketIds ?? []).includes(t.id)).length})</span>
                <span data-testid="invoice-tickets-total">${consolidationCheck.grossTotal.toFixed(2)}</span>
              </div>
              {consolidationCheck.refundTotal !== 0 && (
                <div className="flex justify-between text-brand-500" data-testid="invoice-tickets-refunds">
                  <span>Devoluciones parciales (no se facturan)</span>
                  <span>-${consolidationCheck.refundTotal.toFixed(2)}</span>
                </div>
              )}
              {consolidationCheck.roundingTotal !== 0 && (
                <div className="flex justify-between text-brand-500" data-testid="invoice-tickets-rounding">
                  <span>Redondeo de efectivo (no se factura)</span>
                  <span>{consolidationCheck.roundingTotal > 0 ? '-' : '+'}${Math.abs(consolidationCheck.roundingTotal).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-brand-700 font-medium">
                <span>Total facturable de los tickets</span>
                <span data-testid="invoice-tickets-expected">${consolidationCheck.expectedTotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-brand-700">
                <span>Total de la factura</span>
                <span>${consolidationCheck.invoiceTotal.toFixed(2)}</span>
              </div>
              <div
                data-testid="invoice-tickets-difference"
                data-balanced={consolidationCheck.ok ? 'true' : 'false'}
                className={`flex justify-between font-semibold ${consolidationCheck.ok ? 'text-emerald-700' : 'text-red-700'}`}
              >
                <span>{consolidationCheck.ok ? 'Cuadra con las ventas de los tickets' : 'No cuadra con los tickets'}</span>
                <span>${consolidationCheck.difference.toFixed(2)}</span>
              </div>
              {(consolidationCheck.perception !== 0 || consolidationCheck.retention !== 0) && (
                <div className="pt-2 mt-1 border-t border-brand-100 space-y-1" data-testid="invoice-tickets-withholdings">
                  {consolidationCheck.perception !== 0 && (
                    <div className="flex justify-between text-brand-500">
                      <span>IVA percepción 1% (no es venta)</span>
                      <span>+${consolidationCheck.perception.toFixed(2)}</span>
                    </div>
                  )}
                  {consolidationCheck.retention !== 0 && (
                    <div className="flex justify-between text-brand-500">
                      <span>Retención (no es venta)</span>
                      <span>-${consolidationCheck.retention.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-brand-700 font-medium">
                    <span>Total a pagar por el cliente</span>
                    <span data-testid="invoice-tickets-payable">${consolidationCheck.payableTotal.toFixed(2)}</span>
                  </div>
                </div>
              )}
              {!consolidationCheck.ok && invoice.status !== InvoiceStatus.Completada && (
                <ul className="list-disc pl-5 text-red-700 text-xs" data-testid="invoice-tickets-problems">
                  {consolidationCheck.problems.map((p) => <li key={p}>{p}</li>)}
                </ul>
              )}
            </div>
          ) : (
            <div className="flex justify-between items-center border-t border-brand-200 mt-3 pt-3">
              <span className="text-sm font-medium text-brand-700">Venta de tickets</span>
              <span className="text-base font-semibold text-accent-600" data-testid="invoice-tickets-total">
                ${sourceTickets.filter((t) => t.status !== 'VOID').reduce((s, t) => s + ticketKeptAmount(t), 0).toFixed(2)}
              </span>
            </div>
          )}
        </Card>
      )}

      {/* Local audit: who created / last modified this document */}
      <AuditInfo entityType="invoice" entityId={invoice.id} />

      {/* DTE Submission Modal */}
      {showSubmissionModal && company && (
        <DTESubmissionModal
          isOpen={showSubmissionModal}
          onClose={() => setShowSubmissionModal(false)}
          onComplete={handleSubmissionComplete}
          invoice={invoiceWithCustomer!}
          company={company}
          environment={
            company.environment === 'PRODUCTION' ? 'production' : 'development'
          }
        />
      )}

      {/* PDF Preview Modal */}
      {showPDFPreview && company && (
        <InvoicePDFPreview
          isOpen={showPDFPreview}
          onClose={() => setShowPDFPreview(false)}
          invoice={invoiceWithCustomer!}
          company={company}
          documentMode={pdfPreviewMode}
        />
      )}

      <SubscriptionModal
        isOpen={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        requiredTier={SubscriptionTier.AdFree}
        featureName="Envío de DTE por correo"
      />
    </div>
  );
}
