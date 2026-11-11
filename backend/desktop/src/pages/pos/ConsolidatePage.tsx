// Consolidation wizard — select tickets (a Z closing, all, some or a date
// range), aggregate lines per product + price, reconcile against the period's
// sales and generate a draft Factura (Consumidor Final) or CCF through the
// normal invoice pipeline. The ticket↔invoice link finalizes automatically
// when the invoice reaches Completada (middleware).
//
// "Facturar este cierre": /pos/consolidate?closingId=<id> preselects every
// sale of that Z still available; the operator may untick tickets, sees which
// sales stay out and confirms a summary whose draft total is computed with the
// same computeTotals the invoice will store (must equal the tickets' sales
// minus cash rounding).
//
// Paid-tier gate: Free users see the locked panel + upgrade modal.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, FileText, Lock } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/common/Card';
import { Input } from '@/components/common/Input';
import { Button } from '@/components/common/Button';
import { Select } from '@/components/common/Select';
import { Badge } from '@/components/common/Badge';
import { Modal } from '@/components/common/Modal';
import { EmptyState } from '@/components/common/EmptyState';
import { SubscriptionModal } from '@/components/modals/SubscriptionModal';
import { useToast } from '@/components/common/Toast';
import { useAppDispatch, useAppSelector } from '@/store';
import { selectCurrentCompany } from '@/store/selectors/companySelectors';
import { selectCustomersByCompanyId } from '@/store/selectors/customerSelectors';
import { selectCurrentTier } from '@/store/selectors/subscriptionSelectors';
import { FreeTrialOffer } from '@/components/modals/FreeTrialOffer';
import { canUsePosConsolidation } from '@/services/subscription/FeatureGate';
import { addInvoice, deleteInvoice } from '@/store/slices/invoiceSlice';
import { InvoiceType, type InvoiceDetail } from '@/types/invoice';
import { TaxCategory } from '@/types/product';
import { useTickets } from '@/hooks/useTickets';
import { TicketDatabase } from '@/services/tickets/TicketDatabase';
import { closingSaleIds } from '@/services/tickets/ClosingService';
import { hasReturns, isFullyReturned, ticketKeptAmount, ticketRefundTotal } from '@/services/tickets/TicketReturns';
import { formatTicketNumber } from '@/services/tickets/ticketNumber';
import {
  aggregateTickets,
  reconcileSelection,
  splitByLibrosExclusion,
  svDateStamp,
  ticketSaleTime,
  toInvoiceItems,
  type ConsolidationPreview,
} from '@/services/tickets/ConsolidationService';
import { computeTotals, ivaPerceptionApplies } from '@/utils/invoiceTotals';
import type { CashClosing, Ticket } from '@/types/ticket';
import { round2 } from '@/types/ticket';

const ADVISORY_KEY = 'pos_consolidation_advisory_dismissed';

function monthBounds(offset = 0): { from: string; to: string } {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return {
    from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`,
    to: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`,
  };
}

const money = (value: number) => `$${value.toFixed(2)}`;
const ticketNo = (t: Ticket) => formatTicketNumber(t);

/** Draft total exactly as the invoice will store it (computeTotals). */
function draftTotalOf(preview: ConsolidationPreview, invoiceType: InvoiceType): number {
  const items = toInvoiceItems(preview).map((item, i) => ({
    ...item,
    id: `preview_${i}`,
    createdAt: '',
    updatedAt: '',
  })) as InvoiceDetail[];
  return computeTotals(items, invoiceType).totalAmount;
}

type Batch = { tickets: Ticket[]; excluded: boolean; preview: ConsolidationPreview };

export default function ConsolidatePage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const closingId = searchParams.get('closingId');
  const company = useAppSelector(selectCurrentCompany);
  const tier = useAppSelector(selectCurrentTier);
  const customers = useAppSelector((s) => selectCustomersByCompanyId(company?.id ?? '')(s));
  const allowed = canUsePosConsolidation(tier);

  const bounds = monthBounds();
  const [from, setFrom] = useState(bounds.from);
  const [to, setTo] = useState(bounds.to);
  const [closing, setClosing] = useState<CashClosing | null>(null);
  const [closingMissing, setClosingMissing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<1 | 2>(1);
  const [invoiceKind, setInvoiceKind] = useState<'factura' | 'ccf'>('factura');
  const [customerId, setCustomerId] = useState('');
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [differenceAcknowledged, setDifferenceAcknowledged] = useState(false);
  const [generating, setGenerating] = useState(false);
  const generatingRef = useRef(false);
  const preselectedFor = useRef<string | null>(null);
  const [created, setCreated] = useState<Array<{ id: string; number: string; count: number; excluded: boolean }>>([]);
  const [advisoryDismissed, setAdvisoryDismissed] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem(ADVISORY_KEY) === '1',
  );

  // Closing mode: load the Z the operator came from.
  useEffect(() => {
    if (!company || !closingId) {
      setClosing(null);
      setClosingMissing(false);
      return;
    }
    let cancelled = false;
    void TicketDatabase.getClosings(company.id).then((list) => {
      if (cancelled) return;
      const found = list.find((c) => c.id === closingId) ?? null;
      setClosing(found);
      setClosingMissing(!found);
    });
    return () => {
      cancelled = true;
    };
  }, [company, closingId]);

  // One read for the whole period (any status): the pool and the
  // reconciliation both derive from it. Closing mode filters by the Z's ids.
  const { tickets: rangeTickets } = useTickets({
    companyId: company?.id ?? '',
    from: closingId ? undefined : from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: closingId ? undefined : to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
  });

  const periodTickets = useMemo(() => {
    if (!closingId) return rangeTickets;
    if (!closing) return [];
    // The Z's own register (legacy Zs without one: every ticket held here).
    const saleIds = new Set(closingSaleIds(rangeTickets, closing.from, closing.to, closing.registerId));
    return rangeTickets.filter((t) => saleIds.has(t.id));
  }, [rangeTickets, closingId, closing]);

  // Fully returned tickets kept nothing to invoice: never offered.
  const pool = useMemo(
    () => periodTickets.filter((t) => t.status === 'COMPLETED' && !t.invoiceId && !t.pendingInvoiceId && !isFullyReturned(t)),
    [periodTickets],
  );

  // "Facturar este cierre": start with every available sale of the Z ticked.
  useEffect(() => {
    if (!closing || preselectedFor.current === closing.id || pool.length === 0) return;
    preselectedFor.current = closing.id;
    setSelectedIds(new Set(pool.map((t) => t.id)));
  }, [closing, pool]);

  const selected = useMemo(
    () => pool.filter((t) => selectedIds.has(t.id)),
    [pool, selectedIds],
  );
  const preview: ConsolidationPreview | null = useMemo(
    () => (selected.length ? aggregateTickets(selected) : null),
    [selected],
  );
  const totalDiscount = useMemo(
    () => (preview ? round2(preview.lines.reduce((s, l) => s + l.discount, 0)) : 0),
    [preview],
  );
  const invoiceType = invoiceKind === 'ccf' ? InvoiceType.CCF : InvoiceType.Factura;

  const batches: Batch[] = useMemo(() => {
    if (!preview) return [];
    const groups = preview.needsLibrosSplit
      ? splitByLibrosExclusion(selected)
      : { included: selected, excluded: [] as Ticket[] };
    const raw = preview.needsLibrosSplit
      ? [
          { tickets: groups.included, excluded: false },
          { tickets: groups.excluded, excluded: true },
        ].filter((b) => b.tickets.length > 0)
      : [{ tickets: selected, excluded: !!selected[0]?.excludeFromLibrosIVA }];
    return raw.map((b) => ({ ...b, preview: aggregateTickets(b.tickets) }));
  }, [preview, selected]);

  // The reconciliation: what the drafts will store vs what the tickets sold.
  const draftTotal = useMemo(
    () => round2(batches.reduce((s, b) => s + draftTotalOf(b.preview, invoiceType), 0)),
    [batches, invoiceType],
  );
  const expectedTotal = preview?.expectedInvoiceTotal ?? 0;
  const difference = round2(draftTotal - expectedTotal);
  const reconciliation = useMemo(() => {
    // A Z keeps the sales voided after it closed (shown apart); a date range
    // only counts standing sales (a ticket voided inside it never was one).
    const periodSales = closingId
      ? periodTickets
      : periodTickets.filter((t) => t.status === 'COMPLETED' || t.status === 'CONSOLIDATED');
    return reconcileSelection(periodSales, new Set(selected.map((t) => t.id)));
  }, [periodTickets, selected, closingId]);

  const selectedCustomer = customers.find((c) => c.id === customerId);
  const ccfCustomerInvalid = invoiceKind === 'ccf' && (!selectedCustomer || !selectedCustomer.nrc);

  // Sales of a previous month: the DTE is dated today, so they're declared now.
  const currentMonth = svDateStamp().slice(0, 6);
  const priorMonthSales = preview ? svDateStamp(new Date(preview.dateFrom)).slice(0, 6) !== currentMonth : false;

  useEffect(() => {
    setDifferenceAcknowledged(false);
  }, [difference, selectedIds, invoiceKind]);

  if (!company) return null;

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(pool.map((t) => t.id)));

  // Exempt / no-sujeto POS lines travel with their tax category: Factura and
  // CCF map them to ventaExenta / ventaNoSuj (no IVA), so they no longer
  // block the consolidation.
  const canGenerate =
    !!preview &&
    selected.length > 0 &&
    !ccfCustomerInvalid &&
    !generating;

  const generateDrafts = async () => {
    // Synchronous re-entry guard: a double click must not draft the same
    // tickets twice (both drafts could then be sent → sales declared twice).
    if (!canGenerate || generatingRef.current) return;
    if (difference !== 0 && !differenceAcknowledged) return;
    generatingRef.current = true;
    setGenerating(true);
    const createdHere: Array<{ id: string; number: string; count: number; excluded: boolean }> = [];
    try {
      for (const [index, batch] of batches.entries()) {
        const number = `POS-${svDateStamp()}-${Date.now().toString(36).slice(-4).toUpperCase()}${batches.length > 1 ? `-${index + 1}` : ''}`;
        const action = dispatch(addInvoice({
          invoiceNumber: number,
          date: new Date().toISOString(),
          invoiceType,
          companyId: company.id,
          customerId: invoiceKind === 'ccf' && customerId ? customerId : undefined,
          customer: invoiceKind === 'ccf' ? selectedCustomer : undefined,
          customerHasRetention: invoiceKind === 'ccf' ? Boolean(selectedCustomer?.hasContributorRetention) : undefined,
          // IVA percepción 1% follows the same rule as a CCF typed by hand
          // (company is an agent, receptor not a gran contribuyente, base ≥ $100).
          applyIvaPerception: invoiceKind === 'ccf'
            ? ivaPerceptionApplies({ invoiceType: InvoiceType.CCF, company, customer: selectedCustomer })
            : undefined,
          items: toInvoiceItems(batch.preview),
          observaciones: `Consolidación de ${batch.tickets.length} tickets POS (${batch.preview.dateFrom.slice(0, 10)} — ${batch.preview.dateTo.slice(0, 10)})`,
          receptor: invoiceKind === 'factura' ? 'Consumidor Final' : undefined,
          excludeFromLibrosIVA: batch.excluded || undefined,
          sourceTicketIds: batch.tickets.map((t) => t.id),
        }));
        const invoice = action.payload;
        const ticketIds = batch.tickets.map((t) => t.id);
        const reserved = await TicketDatabase.markPendingConsolidation(company.id, ticketIds, invoice.id);
        if (reserved !== ticketIds.length) {
          // Someone else (another tab/device, an earlier click) reserved part of
          // the batch: roll this draft back (the delete releases what it got).
          dispatch(deleteInvoice(invoice.id));
          toast.error('Algunos tickets ya están en otro borrador de factura. Revisa la selección e intenta de nuevo.');
          break;
        }
        createdHere.push({ id: invoice.id, number: invoice.invoiceNumber, count: batch.tickets.length, excluded: batch.excluded });
      }
    } finally {
      generatingRef.current = false;
      setGenerating(false);
      setConfirmOpen(false);
    }

    if (createdHere.length === 0) return;
    setCreated(createdHere);
    setSelectedIds(new Set());
    setStep(1);
    toast.success(
      createdHere.length === 1
        ? `Borrador creado — ${createdHere[0].count} tickets en espera de la factura`
        : `Se crearon ${createdHere.length} borradores (separación de Libros IVA)`,
    );
  };

  // ── Locked (Free tier) ──
  if (!allowed) {
    return (
      <div data-testid="pos-consolidate-locked" className="space-y-4">
        <PageHeader title="Consolidar Tickets" subtitle="Genera una factura a partir de tus tickets POS" />
        <Card className="p-8 text-center space-y-3">
          <Lock size={36} className="mx-auto text-slate-400" />
          <h2 className="text-lg font-semibold text-brand-900">Función de plan de pago</h2>
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            La consolidación de tickets en facturas está disponible en los planes Pro y Business.
            Vender e imprimir tickets es gratis.
          </p>
          <FreeTrialOffer />
          <Button data-testid="btn-consolidate-upgrade" onClick={() => setShowUpgrade(true)}>Ver planes</Button>
        </Card>
        <SubscriptionModal isOpen={showUpgrade} onClose={() => setShowUpgrade(false)} />
      </div>
    );
  }

  const kindLabel = invoiceKind === 'ccf' ? 'Crédito Fiscal (CCF)' : 'Factura Consumidor Final';

  return (
    <div data-testid="pos-consolidate" className="space-y-4">
      <PageHeader title="Consolidar Tickets" subtitle="Muchos tickets → una factura (DTE)" />

      {!advisoryDismissed && (
        <div data-testid="consolidation-advisory" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p><strong>Aviso:</strong> la factura llevará la fecha de emisión (los DTE no se pueden fechar atrás); el rango de tickets queda en observaciones. Valida con tu contador la periodicidad de consolidación de ventas a consumidor final.</p>
            <button className="text-xs underline mt-1" onClick={() => { localStorage.setItem(ADVISORY_KEY, '1'); setAdvisoryDismissed(true); }}>
              No mostrar de nuevo
            </button>
          </div>
        </div>
      )}

      {created.length > 0 && (
        <div data-testid="consolidation-created" className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 space-y-2">
          <p className="text-sm font-semibold text-emerald-900 flex items-center gap-2">
            <CheckCircle2 size={16} /> Borradores creados — firma y envía la factura para completar el vínculo
          </p>
          {created.map((c) => (
            <div key={c.id} className="flex items-center justify-between text-sm">
              <span>
                {c.number} · {c.count} tickets
                {c.excluded && <Badge variant="warning" size="sm" className="ml-2">fuera de libros</Badge>}
              </span>
              <Link to={`/invoices/${c.id}`} className="text-accent-600 hover:underline" data-testid={`link-invoice-${c.id}`}>Abrir factura</Link>
            </div>
          ))}
        </div>
      )}

      {closingId && (
        <div data-testid="consolidate-closing-banner" className="rounded-lg border border-accent-200 bg-accent-50 p-3 text-sm text-brand-900 flex items-center justify-between gap-3">
          {closing ? (
            <span>
              Facturando el <strong>cierre Z del {new Date(closing.closedAt).toLocaleString('es-SV')}</strong> —{' '}
              {reconciliation.period.count} ventas por {money(reconciliation.period.amount)}
            </span>
          ) : (
            <span>{closingMissing ? 'No se encontró ese cierre de caja.' : 'Cargando cierre…'}</span>
          )}
          <button className="text-xs underline" data-testid="btn-clear-closing" onClick={() => { preselectedFor.current = null; setSelectedIds(new Set()); navigate('/pos/consolidate'); }}>
            Elegir tickets por fecha
          </button>
        </div>
      )}

      {step === 1 && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            {!closingId && (
              <>
                <Input data-testid="consolidate-from" label="Desde" type="date" className="!w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
                <Input data-testid="consolidate-to" label="Hasta" type="date" className="!w-40" value={to} onChange={(e) => setTo(e.target.value)} />
              </>
            )}
            <Button variant="secondary" size="sm" data-testid="btn-select-all" onClick={selectAll} disabled={pool.length === 0}>
              Seleccionar todos ({pool.length})
            </Button>
            <Button
              data-testid="btn-review-selection"
              disabled={selected.length === 0}
              onClick={() => setStep(2)}
            >
              Revisar {selected.length} tickets
            </Button>
          </div>

          {pool.length === 0 ? (
            <EmptyState
              icon={<FileText size={32} />}
              title="Nada por consolidar"
              message={closingId ? 'Todas las ventas de este cierre ya están facturadas o en un borrador.' : `Sin tickets completados pendientes entre ${from} y ${to}.`}
            />
          ) : (
            <Card className="divide-y divide-brand-100 p-0 max-h-96 overflow-y-auto" data-testid="consolidate-ticket-rows">
              {pool.map((t) => (
                <label key={t.id} className="flex items-center gap-3 p-3 hover:bg-brand-50/50 cursor-pointer">
                  <input
                    type="checkbox"
                    data-testid={`chk-ticket-${t.sequential}`}
                    checked={selectedIds.has(t.id)}
                    onChange={() => toggle(t.id)}
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-brand-900">
                      {ticketNo(t)}
                      {t.excludeFromLibrosIVA && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">fuera de libros</span>}
                    </p>
                    <p className="text-xs text-slate-500">
                      {new Date(ticketSaleTime(t)).toLocaleString('es-SV')} · {t.items.length} líneas
                      {hasReturns(t) && (
                        <span className="text-red-700" data-testid={`consolidate-ticket-returned-${t.sequential}`}>
                          {' '}· devolución -{money(ticketRefundTotal(t))} (se factura lo que quedó)
                        </span>
                      )}
                    </p>
                  </div>
                  <span className="text-sm font-semibold">{money(ticketKeptAmount(t))}</span>
                </label>
              ))}
            </Card>
          )}
        </>
      )}

      {step === 2 && preview && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <Button variant="ghost" size="sm" onClick={() => setStep(1)} data-testid="btn-change-selection">← Cambiar selección</Button>
            <Select
              data-testid="consolidate-invoice-kind"
              label="Tipo de DTE"
              className="!w-56"
              value={invoiceKind}
              options={[
                { label: 'Factura — Consumidor Final (IVA incluido)', value: 'factura' },
                { label: 'CCF — Crédito Fiscal (desglosa IVA)', value: 'ccf' },
              ]}
              onChange={(e) => setInvoiceKind(e.target.value as 'factura' | 'ccf')}
            />
            {invoiceKind === 'ccf' && (
              <Select
                data-testid="consolidate-customer"
                label="Cliente (CCF)"
                className="!w-56"
                value={customerId}
                placeholder="Selecciona un cliente"
                options={customers.map((c) => ({ label: c.name ?? c.id, value: c.id }))}
                onChange={(e) => setCustomerId(e.target.value)}
              />
            )}
          </div>

          {invoiceKind === 'ccf' && selectedCustomer && !selectedCustomer.nrc && (
            <div data-testid="consolidate-ccf-nrc-warning" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              El cliente no tiene NRC registrado — un Crédito Fiscal lo requiere. Complétalo en Clientes o genera una Factura.
            </div>
          )}

          {preview.needsLibrosSplit && (
            <div data-testid="consolidation-split-warning" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              La selección mezcla tickets normales y excluidos de Libros IVA — se generarán <strong>dos borradores</strong> (uno por grupo).
            </div>
          )}

          {priorMonthSales && (
            <div data-testid="consolidate-period-warning" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              Incluye ventas de un mes anterior. La factura saldrá con la fecha de hoy y se declarará en el período actual.
            </div>
          )}

          <Card className="p-0" data-testid="consolidate-preview">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-100 text-left text-xs uppercase text-slate-500">
                  <th className="px-3 py-2">Producto</th>
                  <th className="px-3 py-2 text-right">Cant.</th>
                  <th className="px-3 py-2 text-right">Precio unit.</th>
                  <th className="px-3 py-2 text-right">Descuento</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-50">
                {preview.lines.map((l) => (
                  <tr key={l.key} data-testid={`preview-line-${l.key}`}>
                    <td className="px-3 py-2">
                      {l.productName}
                      {l.taxCategory !== TaxCategory.GRAVADO && <span className="ml-2 text-[10px] text-slate-500">{l.taxCategory}</span>}
                    </td>
                    <td className="px-3 py-2 text-right">{l.quantity}</td>
                    <td className="px-3 py-2 text-right">{money(l.unitPrice)}</td>
                    <td className="px-3 py-2 text-right text-slate-600" data-testid={`preview-discount-${l.key}`}>
                      {l.discount > 0 ? `-${money(l.discount)}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">{money(l.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-brand-100 px-3 py-2 space-y-1 text-sm">
              {totalDiscount > 0 && (
                <div className="flex justify-between text-slate-600" data-testid="consolidate-preview-discount">
                  <span>Descuentos</span>
                  <span>-{money(totalDiscount)}</span>
                </div>
              )}
              <div className="flex justify-between text-slate-600"><span>IVA incluido (gravado)</span><span>{money(preview.taxIncluded)}</span></div>
              {preview.exemptTotal > 0 && (
                <div className="flex justify-between text-slate-600"><span>No gravado / exento</span><span>{money(preview.exemptTotal)}</span></div>
              )}
              <div className="flex justify-between text-lg font-bold text-brand-900" data-testid="consolidate-preview-total">
                <span>TOTAL ({preview.ticketCount} tickets)</span><span>{money(draftTotal)}</span>
              </div>
            </div>
          </Card>

          <Card className="p-4 space-y-1 text-sm" data-testid="consolidate-reconciliation">
            <h3 className="text-sm font-semibold text-brand-900 mb-2">Cuadre con las ventas {closing ? 'del cierre' : 'del período'}</h3>
            <div className="flex justify-between" data-testid="recon-period">
              <span>Ventas {closing ? 'del cierre' : 'del período'} ({reconciliation.period.count})</span>
              <span className="font-medium">{money(reconciliation.period.amount)}</span>
            </div>
            {reconciliation.alreadyInvoiced.count > 0 && (
              <div className="flex justify-between text-slate-600" data-testid="recon-invoiced">
                <span>Ya facturadas o en otro borrador ({reconciliation.alreadyInvoiced.count})</span>
                <span>-{money(reconciliation.alreadyInvoiced.amount)}</span>
              </div>
            )}
            {reconciliation.returned.count > 0 && (
              <div className="flex justify-between text-slate-600" data-testid="recon-returned">
                <span>Devoluciones parciales ({reconciliation.returned.count})</span>
                <span>-{money(reconciliation.returned.amount)}</span>
              </div>
            )}
            {reconciliation.voidedLater.count > 0 && (
              <div className="flex justify-between text-slate-600" data-testid="recon-voided-later">
                <span>Anuladas después del cierre ({reconciliation.voidedLater.count})</span>
                <span>-{money(reconciliation.voidedLater.amount)}</span>
              </div>
            )}
            {reconciliation.removed.count > 0 && (
              <div data-testid="recon-removed">
                <div className="flex justify-between text-amber-800">
                  <span>Quitadas de esta factura ({reconciliation.removed.count})</span>
                  <span>-{money(reconciliation.removed.amount)}</span>
                </div>
                <p className="text-xs text-slate-500 pl-3">
                  {reconciliation.removed.tickets.map((t) => `${ticketNo(t)} ${money(ticketKeptAmount(t))}`).join(' · ')} — quedan pendientes de facturar
                </p>
              </div>
            )}
            <div className="flex justify-between border-t border-brand-100 pt-1" data-testid="recon-included">
              <span>Incluidas en esta factura ({reconciliation.included.count})</span>
              <span className="font-medium">{money(reconciliation.included.amount)}</span>
            </div>
            {preview.roundingTotal !== 0 && (
              <div className="flex justify-between text-slate-600" data-testid="recon-rounding">
                <span>Redondeo de efectivo (no se factura)</span>
                <span>{preview.roundingTotal > 0 ? '-' : '+'}{money(Math.abs(preview.roundingTotal))}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold text-brand-900" data-testid="recon-draft-total">
              <span>Total del borrador ({kindLabel})</span>
              <span>{money(draftTotal)}</span>
            </div>
            <div
              data-testid="recon-difference"
              data-balanced={difference === 0 ? 'true' : 'false'}
              className={`flex justify-between font-semibold ${difference === 0 ? 'text-emerald-700' : 'text-red-700'}`}
            >
              <span className="flex items-center gap-1">
                {difference === 0 ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                {difference === 0 ? 'La factura cuadra con las ventas incluidas' : 'Diferencia entre factura y ventas'}
              </span>
              <span>{money(difference)}</span>
            </div>
          </Card>

          <Button
            data-testid="btn-generate-draft"
            onClick={() => setConfirmOpen(true)}
            disabled={!canGenerate}
          >
            Generar borrador de factura
          </Button>
        </>
      )}

      <Modal
        isOpen={confirmOpen}
        onClose={() => { if (!generating) setConfirmOpen(false); }}
        title="Confirmar consolidación"
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={generating}>Cancelar</Button>
            <Button
              data-testid="btn-confirm-consolidation"
              onClick={() => void generateDrafts()}
              loading={generating}
              disabled={!canGenerate || (difference !== 0 && !differenceAcknowledged)}
            >
              Crear borrador
            </Button>
          </div>
        )}
      >
        <div className="space-y-2 text-sm" data-testid="consolidate-confirm">
          <p>
            Se {batches.length === 1 ? 'creará un borrador' : `crearán ${batches.length} borradores`} de <strong>{kindLabel}</strong>
            {selectedCustomer && invoiceKind === 'ccf' ? <> para <strong>{selectedCustomer.name}</strong></> : null} con{' '}
            <strong>{selected.length} tickets</strong> por <strong data-testid="confirm-draft-total">{money(draftTotal)}</strong>.
          </p>
          <p className="text-slate-600">
            Ventas incluidas {money(reconciliation.included.amount)}
            {preview && preview.roundingTotal !== 0 ? ` (redondeo de efectivo ${money(preview.roundingTotal)} fuera de la factura)` : ''}.
          </p>
          {reconciliation.removed.count > 0 && (
            <p className="text-amber-800" data-testid="confirm-removed">
              Quedan fuera {reconciliation.removed.count} ticket(s) por {money(reconciliation.removed.amount)}:{' '}
              {reconciliation.removed.tickets.map(ticketNo).join(', ')}. Seguirán pendientes de facturar.
            </p>
          )}
          {difference !== 0 && (
            <label className="flex items-start gap-2 text-red-700" data-testid="confirm-difference">
              <input
                type="checkbox"
                data-testid="chk-ack-difference"
                checked={differenceAcknowledged}
                onChange={(e) => setDifferenceAcknowledged(e.target.checked)}
              />
              <span>
                El borrador ({money(draftTotal)}) no cuadra con las ventas ({money(expectedTotal)}): diferencia {money(difference)}.
                Entiendo la diferencia y quiero continuar.
              </span>
            </label>
          )}
        </div>
      </Modal>
    </div>
  );
}
