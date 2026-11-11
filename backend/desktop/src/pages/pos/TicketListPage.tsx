// Ticket history — filters, detail, reprint, void (while allowed) and partial
// returns ("Devolución", POS Phase 2 design §8): pick lines and units, refund
// method and reason; units go back to stock once (per return id), a non-fiscal
// return slip prints, the refund lands in the Z of the day and consolidation
// invoices only what was kept. Returns are refused on tickets that are on a
// draft or already invoiced (credit-note territory).

import React, { useMemo, useState } from 'react';
import { Ban, Printer, Undo2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/common/Card';
import { Input } from '@/components/common/Input';
import { Select } from '@/components/common/Select';
import { StickyToolbar } from '@/components/common/StickyToolbar';
import { Button } from '@/components/common/Button';
import { EmptyState } from '@/components/common/EmptyState';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Modal } from '@/components/common/Modal';
import { useToast } from '@/components/common/Toast';
import { useThisRegisterId } from '@/components/pos/CashDrawerPanel';
import { useAppDispatch, useAppSelector } from '@/store';
import { selectCurrentCompany } from '@/store/selectors/companySelectors';
import { selectActiveLocalUser, selectAuditActor } from '@/store/selectors/localUsersSelectors';
import { restoreTicketReturnStock, restoreTicketStock } from '@/store/slices/productSlice';
import { recordAuditEvents } from '@/store/slices/auditSlice';
import { useCan } from '@/hooks/useLocalUsers';
import { useTickets, usePosSettings } from '@/hooks/useTickets';
import { TICKET_PENDING_VOID_MESSAGE, TicketDatabase } from '@/services/tickets/TicketDatabase';
import {
  buildTicketReturn,
  computeReturnRefund,
  hasReturns,
  keptLines,
  returnBlockedReason,
  returnedItemsByProduct,
  returnedQuantities,
  ticketKeptAmount,
  ticketRefundTotal,
  validateReturnRequest,
} from '@/services/tickets/TicketReturns';
import { isWeighableUnit } from '@/services/tickets/posQuantity';
import { formatTicketNumber, ticketShortLabel } from '@/services/tickets/ticketNumber';
import { buildReturnReceipt, buildTicketReceipt, METHOD_LABELS, printReceipt } from '@/services/printing/PosPrinting';
import type { PaymentMethod, Ticket, TicketReturn, TicketStatus } from '@/types/ticket';

const STATUS_BADGES: Record<TicketStatus, { label: string; cls: string }> = {
  OPEN: { label: 'Abierto', cls: 'bg-slate-100 text-slate-700' },
  COMPLETED: { label: 'Completado', cls: 'bg-emerald-100 text-emerald-800' },
  VOID: { label: 'Anulado', cls: 'bg-red-100 text-red-700' },
  CONSOLIDATED: { label: 'Facturado', cls: 'bg-accent-100 text-accent-800' },
};

const money = (value: number) => `$${value.toFixed(2)}`;

/** Why the void action is unavailable for a ticket (null = it can be voided). */
function voidBlockedReason(ticket: Ticket, canVoid: boolean): string | null {
  if (ticket.status !== 'COMPLETED') return null; // the button isn't shown at all
  if (!canVoid) return 'Sin permiso para anular tickets';
  if (ticket.pendingInvoiceId) return TICKET_PENDING_VOID_MESSAGE;
  return null;
}

/** Why a partial return is unavailable (null = allowed). */
function returnBlocked(ticket: Ticket, canReturn: boolean): { reason: string; lock: string } | null {
  const reason = returnBlockedReason(ticket);
  if (reason) {
    const lock = ticket.status === 'CONSOLIDATED' || ticket.invoiceId
      ? 'invoiced'
      : ticket.pendingInvoiceId
        ? 'pending-invoice'
        : 'fully-returned';
    return { reason, lock };
  }
  if (!canReturn) return { reason: 'Sin permiso para devoluciones', lock: 'permission' };
  return null;
}

function todayISO(): string {
  // LOCAL date (not toISOString — that is UTC and drifts a day after 18:00).
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const METHOD_OPTIONS: Array<{ label: string; value: PaymentMethod }> = [
  { label: 'Efectivo', value: 'EFECTIVO' },
  { label: 'Tarjeta (reverso en el datáfono)', value: 'TARJETA_POS' },
  { label: 'Otro', value: 'OTRO' },
];

export default function TicketListPage() {
  const dispatch = useAppDispatch();
  const toast = useToast();
  const company = useAppSelector(selectCurrentCompany);
  const localUser = useAppSelector(selectActiveLocalUser);
  const auditActor = useAppSelector(selectAuditActor);
  const products = useAppSelector((state) => state.products.products);
  const { settings } = usePosSettings(company?.id);
  const registerId = useThisRegisterId();
  // Voiding / returns are action permissions — opening Tickets doesn't grant them.
  const canVoid = useCan('pos.void');
  const canReturn = useCan('pos.return');

  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [status, setStatus] = useState<'ALL' | TicketStatus>('ALL');
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [returning, setReturning] = useState<Ticket | null>(null);
  const [returnQty, setReturnQty] = useState<Record<string, string>>({});
  const [returnMethod, setReturnMethod] = useState<PaymentMethod>('EFECTIVO');
  const [returnReason, setReturnReason] = useState('');
  const [savingReturn, setSavingReturn] = useState(false);

  const { tickets } = useTickets({
    companyId: company?.id ?? '',
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
    status: status === 'ALL' ? undefined : status,
  });

  // Keep the open detail in step with the database (returns, prints, peers).
  const selectedLive = useMemo(
    () => (selected ? tickets.find((t) => t.id === selected.id) ?? selected : null),
    [selected, tickets],
  );

  const totals = useMemo(
    () => tickets.reduce((sum, t) => (t.status === 'COMPLETED' || t.status === 'CONSOLIDATED' ? sum + ticketKeptAmount(t) : sum), 0),
    [tickets],
  );

  const weighableProducts = useMemo(
    () => new Set(products.filter((p) => isWeighableUnit(p.unitOfMeasure as unknown as string)).map((p) => p.id)),
    [products],
  );

  const returnRequest = useMemo(
    () => (returning
      ? returning.items.map((l) => ({ lineId: l.id, quantity: Number((returnQty[l.id] ?? '').replace(',', '.')) || 0 }))
      : []),
    [returning, returnQty],
  );
  const returnPreview = useMemo(
    () => (returning ? computeReturnRefund(returning, returnRequest) : { lines: [], amount: 0 }),
    [returning, returnRequest],
  );
  const returnProblem = useMemo(() => {
    if (!returning) return null;
    for (const line of returning.items) {
      const raw = (returnQty[line.id] ?? '').trim();
      if (!raw) continue;
      const qty = Number(raw.replace(',', '.'));
      const decimals = !Number.isInteger(line.quantity) || (!!line.productId && weighableProducts.has(line.productId));
      if (!Number.isFinite(qty) || qty < 0) return 'Cantidad inválida.';
      if (!decimals && !Number.isInteger(qty)) return `"${line.productName}" se devuelve en unidades enteras.`;
    }
    return validateReturnRequest(returning, returnRequest);
  }, [returning, returnQty, returnRequest, weighableProducts]);

  if (!company) return null;

  // Every reprint is stamped "REIMPRESIÓN / COPIA" (VOID ones also
  // "*** ANULADO ***") and goes to the local activity log.
  const reprint = async (ticket: Ticket) => {
    const label = ticketShortLabel(ticket);
    const result = await printReceipt(buildTicketReceipt(ticket, company, settings, { purpose: 'reprint' }), settings);
    if (!result.ok) {
      toast.error(`No se pudo reimprimir: ${result.error}`);
      return;
    }
    toast.success(`Ticket ${label} reimpreso`);
    dispatch(recordAuditEvents([{
      actor: auditActor,
      action: 'update',
      entityType: 'ticket',
      entityId: ticket.id,
      companyId: company.id,
      entityLabel: `Ticket ${label}`,
      summary: `Reimprimió el ticket ${label}${ticket.status === 'VOID' ? ' (anulado)' : ''} — copia`,
    }]));
    try {
      await TicketDatabase.incrementPrinted(company.id, ticket.id);
    } catch (error) {
      console.warn('TicketList: no se pudo registrar la reimpresión', error);
    }
  };

  const reprintReturn = async (ticket: Ticket, ret: TicketReturn) => {
    const result = await printReceipt(buildReturnReceipt(ticket, ret, company, settings, { copy: true }), settings);
    if (!result.ok) toast.error(`No se pudo imprimir: ${result.error}`);
    else toast.success('Comprobante de devolución reimpreso');
  };

  const confirmVoid = async () => {
    if (!selected || !voidReason.trim()) return;
    // Fresh copy: returns registered meanwhile change what the void restores.
    const target = (await TicketDatabase.getTicket(company.id, selected.id)) ?? selected;
    const blocked = voidBlockedReason(target, canVoid);
    if (blocked) {
      toast.error(blocked);
      return;
    }
    const label = ticketShortLabel(target);
    try {
      await TicketDatabase.void(company.id, target.id, voidReason.trim());
      dispatch(restoreTicketStock({
        ticketId: target.id,
        ticketSequential: target.sequential,
        items: target.items
          .filter((l) => !!l.productId)
          .map((l) => ({ productId: l.productId!, quantity: l.quantity, productName: l.productName })),
        // Units its partial returns already put back stay out of the restock.
        returnedItems: returnedItemsByProduct(target),
        createdAt: new Date().toISOString(),
        createdBy: localUser ? auditActor.name : 'POS',
      }));
      toast.success(
        hasReturns(target)
          ? `Ticket ${label} anulado — reembolso de ${money(ticketKeptAmount(target))} (lo que quedaba) y stock restaurado`
          : `Ticket ${label} anulado — stock restaurado`,
      );
      setVoiding(false);
      setSelected(null);
      setVoidReason('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo anular');
    }
  };

  const openReturn = (ticket: Ticket) => {
    const blocked = returnBlocked(ticket, canReturn);
    if (blocked) {
      toast.error(blocked.reason);
      return;
    }
    const methods = [...new Set(ticket.payments.map((p) => p.method))];
    setReturnMethod(methods.length === 1 ? methods[0] : 'EFECTIVO');
    setReturnQty({});
    setReturnReason('');
    setReturning(ticket);
  };

  const returnAll = () => {
    if (!returning) return;
    const next: Record<string, string> = {};
    for (const kept of keptLines(returning)) {
      if (kept.keptQuantity > 0) next[kept.lineId] = String(kept.keptQuantity);
    }
    setReturnQty(next);
  };

  const confirmReturn = async () => {
    if (!returning || savingReturn) return;
    if (returnProblem) {
      toast.error(returnProblem);
      return;
    }
    if (!returnReason.trim()) {
      toast.error('Indica el motivo de la devolución');
      return;
    }
    setSavingReturn(true);
    try {
      const fresh = (await TicketDatabase.getTicket(company.id, returning.id)) ?? returning;
      const ret = buildTicketReturn(fresh, {
        requested: returnRequest,
        method: returnMethod,
        reason: returnReason,
        createdBy: auditActor.name,
        registerId: registerId ?? undefined,
      });
      const updated = await TicketDatabase.addReturn(company.id, fresh.id, ret);
      const label = ticketShortLabel(updated);
      const lineById = new Map(updated.items.map((l) => [l.id, l]));
      dispatch(restoreTicketReturnStock({
        ticketId: updated.id,
        returnId: ret.id,
        ticketSequential: updated.sequential,
        ticketLabel: label,
        items: ret.lines
          .map((l) => ({ line: lineById.get(l.lineId), quantity: l.quantity }))
          .filter((x) => !!x.line?.productId)
          .map((x) => ({ productId: x.line!.productId!, quantity: x.quantity, productName: x.line!.productName })),
        createdAt: ret.createdAt,
        createdBy: localUser ? auditActor.name : 'POS',
      }));
      const units = ret.lines.reduce((s, l) => s + l.quantity, 0);
      dispatch(recordAuditEvents([{
        actor: auditActor,
        action: 'update',
        entityType: 'ticket',
        entityId: updated.id,
        companyId: company.id,
        entityLabel: `Ticket ${label}`,
        summary: `Registró una devolución del ticket ${label}: ${units} unidad(es), reembolso ${money(ret.refund.amount)} (${METHOD_LABELS[ret.refund.method]}) — ${ret.reason}`,
      }]));
      setReturning(null);
      setSelected(updated);
      if (settings.printer) {
        toast.success(`Devolución registrada — reembolso ${money(ret.refund.amount)}; imprimiendo comprobante…`);
        const result = await printReceipt(buildReturnReceipt(updated, ret, company, settings), settings);
        if (!result.ok) toast.error(`Devolución guardada — el comprobante no se imprimió: ${result.error}`);
      } else {
        toast.success(`Devolución registrada — reembolso ${money(ret.refund.amount)}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo registrar la devolución');
    } finally {
      setSavingReturn(false);
    }
  };

  const detail = selectedLive;
  const detailReturned = detail ? returnedQuantities(detail) : new Map<string, number>();
  const detailReturnBlocked = detail && (detail.status === 'COMPLETED' || detail.status === 'CONSOLIDATED')
    ? returnBlocked(detail, canReturn)
    : null;

  return (
    <div data-testid="pos-ticket-list" className="space-y-4">
      <PageHeader
        title="Tickets"
        subtitle={`${tickets.length} tickets · $${totals.toFixed(2)} vendidos en el rango`}
      />

      <StickyToolbar data-testid="ticket-sticky-toolbar">
        <div className="flex flex-wrap items-end gap-3">
          <Input data-testid="ticket-filter-from" label="Desde" type="date" className="!w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input data-testid="ticket-filter-to" label="Hasta" type="date" className="!w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          <Select
            data-testid="ticket-filter-status"
            label="Estado"
            className="!w-44"
            value={status}
            options={[
              { label: 'Todos', value: 'ALL' },
              { label: 'Completados', value: 'COMPLETED' },
              { label: 'Facturados', value: 'CONSOLIDATED' },
              { label: 'Anulados', value: 'VOID' },
              { label: 'Abiertos', value: 'OPEN' },
            ]}
            onChange={(e) => setStatus(e.target.value as 'ALL' | TicketStatus)}
          />
        </div>
      </StickyToolbar>
      {tickets.length === 0 ? (
        <EmptyState icon={<Printer size={32} />} title="Sin tickets" message="No hay tickets en el rango seleccionado." />
      ) : (
        <Card className="divide-y divide-brand-100 p-0" data-testid="ticket-rows">
          {tickets.map((t) => {
            const badge = STATUS_BADGES[t.status];
            const refunded = ticketRefundTotal(t);
            return (
              <div key={t.id} data-testid={`ticket-row-${t.sequential}`} className="p-3 flex items-center gap-3 hover:bg-brand-50/50">
                <button className="flex-1 text-left min-w-0" onClick={() => setSelected(t)}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-brand-900">{formatTicketNumber(t)}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${badge.cls}`}>{badge.label}</span>
                    {refunded > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700" data-testid={`ticket-returned-badge-${t.sequential}`}>
                        devolución -{money(refunded)}
                      </span>
                    )}
                    {t.excludeFromLibrosIVA && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800" title="Excluido de Libros IVA">fuera de libros</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 truncate">
                    {new Date(t.createdAt).toLocaleString('es-SV')} · {t.items.length} líneas ·{' '}
                    {t.payments.map((p) => METHOD_LABELS[p.method] ?? p.method).join(', ')}
                    {t.invoiceControlNumber ? ` · ${t.invoiceControlNumber}` : ''}
                    {t.cashierName && <span data-testid={`ticket-cashier-${t.sequential}`}> · Cajero: {t.cashierName}</span>}
                  </p>
                </button>
                <span className="text-sm font-bold text-brand-900 w-20 text-right">${t.totalAmount.toFixed(2)}</span>
                <Button variant="ghost" size="sm" data-testid={`btn-reprint-${t.sequential}`} onClick={() => reprint(t)} title="Reimprimir">
                  <Printer size={15} />
                </Button>
                {(t.status === 'COMPLETED' || t.status === 'CONSOLIDATED') && (() => {
                  const blocked = returnBlocked(t, canReturn);
                  return (
                    <span title={blocked?.reason ?? 'Devolución'} data-testid={`return-ticket-hint-${t.sequential}`}>
                      <Button
                        variant="ghost"
                        size="sm"
                        data-testid={`btn-return-ticket-${t.sequential}`}
                        disabled={!!blocked}
                        aria-disabled={!!blocked}
                        aria-label={blocked ? `Devolución (no disponible: ${blocked.reason})` : 'Devolución'}
                        data-locked={blocked?.lock}
                        onClick={() => openReturn(t)}
                      >
                        <Undo2 size={15} className="text-amber-700" />
                      </Button>
                    </span>
                  );
                })()}
                {t.status === 'COMPLETED' && (() => {
                  const blocked = voidBlockedReason(t, canVoid);
                  // Disabled buttons swallow hover in some engines: the hint lives on a wrapper.
                  return (
                    <span title={blocked ?? 'Anular'} data-testid={`void-ticket-hint-${t.sequential}`}>
                      <Button
                        variant="ghost"
                        size="sm"
                        data-testid={`btn-void-ticket-${t.sequential}`}
                        disabled={!!blocked}
                        aria-disabled={!!blocked}
                        aria-label={blocked ? `Anular (no disponible: ${blocked})` : 'Anular'}
                        data-locked={blocked ? (canVoid ? 'pending-invoice' : 'permission') : undefined}
                        onClick={() => { setSelected(t); setVoiding(true); }}
                      >
                        <Ban size={15} className="text-error" />
                      </Button>
                    </span>
                  );
                })()}
              </div>
            );
          })}
        </Card>
      )}

      {/* Detail modal */}
      {detail && !returning && !voiding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-xl max-w-md w-full p-5 space-y-3 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} data-testid={`ticket-detail-${detail.sequential}`}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-brand-900">Ticket {formatTicketNumber(detail)}</h3>
              <span className={`text-[10px] px-2 py-0.5 rounded ${STATUS_BADGES[detail.status].cls}`}>{STATUS_BADGES[detail.status].label}</span>
            </div>
            <p className="text-xs text-slate-500">
              {new Date(detail.createdAt).toLocaleString('es-SV')}
              {detail.customerName ? ` · Cliente: ${detail.customerName}` : ''}
              {detail.cashierName ? ` · Cajero: ${detail.cashierName}` : ''}
              {detail.voidedAt ? ` · Anulado: ${detail.voidReason ?? ''}` : ''}
            </p>
            <div className="border border-brand-100 rounded-lg divide-y divide-brand-50">
              {detail.items.map((l) => {
                const back = detailReturned.get(l.id) ?? 0;
                return (
                  <div key={l.id} className="flex justify-between text-sm px-3 py-1.5" data-testid={`ticket-detail-line-${l.id}`}>
                    <span className="truncate">
                      {l.quantity} × {l.productName}
                      {back > 0 && <span className="text-xs text-red-700"> (devueltas {back})</span>}
                    </span>
                    <span className="font-medium">${l.lineTotal.toFixed(2)}</span>
                  </div>
                );
              })}
            </div>
            <div className="space-y-1 text-sm">
              {(detail.discountTotal ?? 0) > 0 && (
                <div className="flex justify-between text-slate-600"><span>Descuento</span><span>−${detail.discountTotal!.toFixed(2)}</span></div>
              )}
              {(detail.roundingAdjustment ?? 0) !== 0 && (
                <div className="flex justify-between text-slate-600"><span>Redondeo</span><span>${detail.roundingAdjustment!.toFixed(2)}</span></div>
              )}
              <div className="flex justify-between text-slate-600"><span>IVA incluido</span><span>${detail.taxIncluded.toFixed(2)}</span></div>
              <div className="flex justify-between font-bold text-base"><span>TOTAL</span><span>${detail.totalAmount.toFixed(2)}</span></div>
              {hasReturns(detail) && (
                <>
                  <div className="flex justify-between text-red-700" data-testid="ticket-detail-refunds"><span>Devoluciones</span><span>-{money(ticketRefundTotal(detail))}</span></div>
                  <div className="flex justify-between font-semibold" data-testid="ticket-detail-kept"><span>NETO</span><span>{money(ticketKeptAmount(detail))}</span></div>
                </>
              )}
            </div>
            <div className="text-xs text-slate-600 space-y-0.5">
              {detail.payments.map((p) => (
                <p key={p.id}>
                  {METHOD_LABELS[p.method] ?? p.method}: ${p.amount.toFixed(2)}
                  {p.change !== undefined ? ` (vuelto $${p.change.toFixed(2)})` : ''}
                  {p.posAuthCode ? ` · Auth ${p.posAuthCode}` : ''}
                  {p.posReference ? ` · Ref ${p.posReference}` : ''}
                </p>
              ))}
              {detail.invoiceControlNumber && <p className="text-accent-700">Consolidado en {detail.invoiceControlNumber}</p>}
              {detail.status === 'COMPLETED' && detail.pendingInvoiceId && (
                <p data-testid="ticket-pending-invoice-hint" className="text-amber-700">{TICKET_PENDING_VOID_MESSAGE}</p>
              )}
            </div>
            {hasReturns(detail) && (
              <div className="border border-red-100 rounded-lg divide-y divide-red-50" data-testid="ticket-returns">
                {detail.returns!.map((ret) => (
                  <div key={ret.id} className="px-3 py-2 text-xs space-y-0.5" data-testid={`ticket-return-${ret.id}`}>
                    <div className="flex justify-between font-medium text-brand-900">
                      <span>Devolución {new Date(ret.createdAt).toLocaleString('es-SV')}</span>
                      <span className="text-red-700">-{money(ret.refund.amount)} {METHOD_LABELS[ret.refund.method]}</span>
                    </div>
                    <p className="text-slate-600">
                      {ret.lines.map((l) => `${l.quantity} × ${detail.items.find((i) => i.id === l.lineId)?.productName ?? 'Producto'}`).join(', ')}
                      {' · '}Motivo: {ret.reason}{ret.createdBy ? ` · ${ret.createdBy}` : ''}
                    </p>
                    <button className="text-accent-700 underline" data-testid={`btn-reprint-return-${ret.id}`} onClick={() => void reprintReturn(detail, ret)}>
                      Reimprimir comprobante
                    </button>
                  </div>
                ))}
              </div>
            )}
            {detailReturnBlocked && detailReturnBlocked.lock !== 'permission' && (
              <p className="text-xs text-amber-700" data-testid="ticket-return-blocked">{detailReturnBlocked.reason}</p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              {(detail.status === 'COMPLETED' || detail.status === 'CONSOLIDATED') && (
                <span title={detailReturnBlocked?.reason ?? 'Devolución'}>
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="btn-return-from-detail"
                    disabled={!!detailReturnBlocked}
                    data-locked={detailReturnBlocked?.lock}
                    onClick={() => openReturn(detail)}
                  >
                    <Undo2 size={14} /> Devolución
                  </Button>
                </span>
              )}
              <Button variant="secondary" size="sm" onClick={() => reprint(detail)}><Printer size={14} /> Reimprimir</Button>
            </div>
          </div>
        </div>
      )}

      {/* Return dialog */}
      <Modal
        isOpen={!!returning}
        onClose={() => { if (!savingReturn) setReturning(null); }}
        title={returning ? `Devolución — Ticket ${formatTicketNumber(returning)}` : 'Devolución'}
        size="lg"
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setReturning(null)} disabled={savingReturn}>Cancelar</Button>
            <Button
              data-testid="btn-confirm-return"
              variant="danger"
              loading={savingReturn}
              disabled={!!returnProblem || !returnReason.trim()}
              onClick={() => void confirmReturn()}
            >
              Registrar devolución {returnPreview.amount > 0 ? money(returnPreview.amount) : ''}
            </Button>
          </div>
        )}
      >
        {returning && (
          <div className="space-y-3" data-testid="return-dialog">
            <p className="text-sm text-slate-600">
              Indica cuántas unidades devuelve el cliente. Se reembolsa el valor cobrado (con su parte del descuento) y las unidades vuelven al inventario.
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-100 text-left text-xs uppercase text-slate-500">
                  <th className="py-1.5">Producto</th>
                  <th className="py-1.5 text-right">Vendido</th>
                  <th className="py-1.5 text-right">Devuelto</th>
                  <th className="py-1.5 text-right">A devolver</th>
                  <th className="py-1.5 text-right">Reembolso</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-50">
                {keptLines(returning).map((kept, i) => {
                  const line = returning.items[kept.index];
                  const decimals = !Number.isInteger(line.quantity) || (!!line.productId && weighableProducts.has(line.productId));
                  const preview = returnPreview.lines.find((l) => l.lineId === line.id);
                  return (
                    <tr key={line.id} data-testid={`return-line-${i}`}>
                      <td className="py-1.5 pr-2">{line.productName}</td>
                      <td className="py-1.5 text-right">{kept.soldQuantity}</td>
                      <td className="py-1.5 text-right">{kept.returnedQuantity || '—'}</td>
                      <td className="py-1.5 text-right">
                        <input
                          data-testid={`return-qty-${i}`}
                          aria-label={`Unidades a devolver de ${line.productName}`}
                          type="number"
                          min="0"
                          max={kept.keptQuantity}
                          step={decimals ? '0.001' : '1'}
                          disabled={kept.keptQuantity <= 0}
                          className="w-20 rounded border border-brand-200 px-2 py-1 text-right"
                          value={returnQty[line.id] ?? ''}
                          placeholder="0"
                          onChange={(e) => setReturnQty((prev) => ({ ...prev, [line.id]: e.target.value }))}
                        />
                      </td>
                      <td className="py-1.5 text-right" data-testid={`return-line-refund-${i}`}>{preview ? money(preview.amount) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex justify-between items-center">
              <Button variant="ghost" size="sm" data-testid="btn-return-all" onClick={returnAll}>Devolver todo lo que queda</Button>
              <span className="text-base font-bold text-brand-900" data-testid="return-refund-total">Reembolso {money(returnPreview.amount)}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Select
                data-testid="return-method"
                label="Reembolsar con"
                value={returnMethod}
                options={METHOD_OPTIONS}
                onChange={(e) => setReturnMethod(e.target.value as PaymentMethod)}
              />
              <Input
                data-testid="return-reason"
                label="Motivo"
                placeholder="Ej.: producto dañado, talla equivocada"
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
              />
            </div>
            {returnProblem && returnRequest.some((r) => r.quantity > 0) && (
              <p className="text-xs text-red-700" data-testid="return-problem">{returnProblem}</p>
            )}
          </div>
        )}
      </Modal>

      {/* Void dialog */}
      <ConfirmDialog
        isOpen={voiding}
        title={`Anular ticket ${selected ? formatTicketNumber(selected) : ''}`}
        message={selectedLive && hasReturns(selectedLive)
          ? `Ya tiene devoluciones: se reembolsa lo que queda (${money(ticketKeptAmount(selectedLive))}) y vuelve al inventario solo lo no devuelto. Esta acción no se puede deshacer.`
          : 'El stock de sus productos será restaurado. Esta acción no se puede deshacer.'}
        confirmLabel="Anular ticket"
        variant="danger"
        onConfirm={() => {
          if (!voidReason.trim()) {
            toast.error('Indica el motivo de la anulación');
            return;
          }
          void confirmVoid();
        }}
        onClose={() => setVoiding(false)}
      >
        <Input
          data-testid="void-reason-input"
          label="Motivo"
          placeholder="Ej.: error de cobro, devolución del cliente…"
          value={voidReason}
          onChange={(e) => setVoidReason(e.target.value)}
        />
      </ConfirmDialog>
    </div>
  );
}
