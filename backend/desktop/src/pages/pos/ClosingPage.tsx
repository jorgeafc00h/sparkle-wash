// Cierre de caja — X-report (read-only range) and Z-report (close since the
// previous Z up to NOW, persists a snapshot with the ticket ids, optional
// thermal print). A Z used to close up to 23:59:59 of a chosen day, so sales
// made after an intraday/evening Z fell in no closing at all.
//
// After a Z, "Facturar este cierre" opens the consolidation wizard with that
// closing's sales preselected (/pos/consolidate?closingId=…).
//
// POS Phase 2 (design §6–8): the Z covers THIS register only (the X can show
// every register), shows per-cashier / per-product / discount / partial-return
// breakdowns and the arqueo de efectivo (float + cash sales − cash refunds +
// entradas − salidas = esperado; contado − esperado = faltante/sobrante),
// stored in the closing and printed on the Z. The Z closes the open cash session.

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Printer, Receipt } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/common/Card';
import { Input } from '@/components/common/Input';
import { Select } from '@/components/common/Select';
import { Button } from '@/components/common/Button';
import { EmptyState } from '@/components/common/EmptyState';
import { useToast } from '@/components/common/Toast';
import { CashDrawerPanel, useCashSession, useThisRegisterId } from '@/components/pos/CashDrawerPanel';
import { useAppDispatch, useAppSelector } from '@/store';
import { selectCurrentCompany } from '@/store/selectors/companySelectors';
import { selectAuditActor } from '@/store/selectors/localUsersSelectors';
import { recordAuditEvents } from '@/store/slices/auditSlice';
import { useTickets, usePosSettings } from '@/hooks/useTickets';
import { useCan } from '@/hooks/useLocalUsers';
import { TicketDatabase } from '@/services/tickets/TicketDatabase';
import { CashDrawerStore } from '@/services/tickets/CashDrawerStore';
import {
  buildCashClosing,
  cashDifferenceLabel,
  closingsForRegister,
  computeCashSummary,
  computeXReport,
  computeZReport,
  hasClosingActivity,
} from '@/services/tickets/ClosingService';
import { registerSettingsOf } from '@/services/tickets/PosSettingsStore';
import { buildZReceipt, METHOD_LABELS, printReceipt } from '@/services/printing/PosPrinting';
import type { CashClosing, CashClosingSummary, ClosingTotals, PaymentMethod } from '@/types/ticket';

function todayISO(): string {
  // LOCAL date (not toISOString — that is UTC and drifts a day after 18:00).
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const money = (value: number) => `$${value.toFixed(2)}`;
const signedMoney = (value: number) => (value < 0 ? `-${money(-value)}` : money(value));
const slug = (value: string) => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function parseCounted(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const value = Number(raw.replace(',', '.'));
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function CashDifference({ summary, testId }: { summary: CashClosingSummary; testId: string }) {
  if (summary.difference === undefined) {
    return <span data-testid={testId} data-kind="none" className="text-slate-500">Sin conteo</span>;
  }
  const label = cashDifferenceLabel(summary.difference);
  const cls = summary.difference < 0 ? 'text-red-700' : summary.difference > 0 ? 'text-amber-700' : 'text-emerald-700';
  return (
    <span data-testid={testId} data-kind={label.toLowerCase()} className={`font-semibold ${cls}`}>
      {label} {signedMoney(summary.difference)}
    </span>
  );
}

export default function ClosingPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const canConsolidate = useCan('pos.consolidate');
  const dispatch = useAppDispatch();
  const company = useAppSelector(selectCurrentCompany);
  const auditActor = useAppSelector(selectAuditActor);
  const { settings } = usePosSettings(company?.id);
  const registerId = useThisRegisterId();
  const register = registerSettingsOf(settings);
  const registerCode = register.code || undefined;
  const { session, movements } = useCashSession(company?.id, registerId);

  const [mode, setMode] = useState<'X' | 'Z'>('Z');
  const [scope, setScope] = useState<'register' | 'all'>('register');
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [closings, setClosings] = useState<CashClosing[]>([]);
  const [countedInput, setCountedInput] = useState('');
  const [printing, setPrinting] = useState(false);
  // Z closes up to "now": refresh the clock so late sales show up.
  const [nowISO, setNowISO] = useState(() => new Date().toISOString());
  useEffect(() => {
    const timer = window.setInterval(() => setNowISO(new Date().toISOString()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!company) return;
    void TicketDatabase.getClosings(company.id).then(setClosings);
  }, [company]);

  // This register's closings (legacy ones without a register are this device's).
  const registerClosings = useMemo(
    () => (registerId ? closingsForRegister(closings, registerId) : closings),
    [closings, registerId],
  );
  const lastClosing = registerClosings[0] ?? null;

  // The hot ticket store only holds the current and previous month (older
  // final tickets live in monthly archives). Read the archives too when the
  // range reaches before that window: the first Z ever, a last Z older than
  // the window, or an X over old dates.
  const hotWindowStart = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  }, []);
  const xFromISO = new Date(`${from}T00:00:00`).toISOString();
  const includeArchived = mode === 'X'
    ? xFromISO < hotWindowStart
    : !lastClosing || lastClosing.closedAt < hotWindowStart;
  const { tickets } = useTickets({ companyId: company?.id ?? '', includeArchived });

  const totals: ClosingTotals | null = useMemo(() => {
    if (!company || !registerId) return null;
    if (mode === 'X') {
      // X: whole local days; `from` exclusive bound → one ms before midnight.
      const fromISO = new Date(new Date(`${from}T00:00:00`).getTime() - 1).toISOString();
      const toISO = new Date(`${to}T23:59:59.999`).toISOString();
      return computeXReport(tickets, fromISO, toISO, { registerId: scope === 'all' ? undefined : registerId });
    }
    const now = new Date().toISOString();
    return computeZReport(tickets, lastClosing?.closedAt ?? null, now > nowISO ? now : nowISO, { registerId });
  }, [company, registerId, mode, scope, from, to, tickets, lastClosing, nowISO]);

  const cashPreview: CashClosingSummary | null = useMemo(() => {
    if (!totals || mode !== 'Z') return null;
    return computeCashSummary({
      totals,
      openingFloat: session?.openingFloat ?? 0,
      movements,
      counted: parseCounted(countedInput),
      sessionId: session?.id,
    });
  }, [totals, mode, session, movements, countedInput]);

  if (!company) return null;

  const methods = totals
    ? (Object.keys(totals.byMethod) as PaymentMethod[]).filter(
        (m) => totals!.byMethod[m].count > 0 || (totals!.byMethod[m].refundCount ?? 0) > 0,
      )
    : [];
  const cashiers = totals
    ? Object.entries(totals.byCashier ?? {}).sort((a, b) => b[1].amount - a[1].amount || a[0].localeCompare(b[0]))
    : [];
  const refunds = totals?.refunds;
  const canCloseZ = !!totals && (hasClosingActivity(totals) || !!session);

  const printZ = async () => {
    if (!totals || !company || !registerId) return;
    if (countedInput.trim() !== '' && parseCounted(countedInput) === undefined) {
      toast.error('Efectivo contado inválido');
      return;
    }
    // Close at the instant of the click, with totals recomputed for it.
    const toISO = new Date().toISOString();
    const fromISO = lastClosing?.closedAt ?? new Date(0).toISOString();
    const zTotals = computeZReport(tickets, fromISO, toISO, { registerId });
    const openSession = await CashDrawerStore.getOpenSession(company.id, registerId);
    const sessionMovements = openSession ? await CashDrawerStore.getMovements(company.id, openSession.id) : [];
    const cash = computeCashSummary({
      totals: zTotals,
      openingFloat: openSession?.openingFloat ?? 0,
      movements: sessionMovements,
      counted: parseCounted(countedInput),
      sessionId: openSession?.id,
    });
    const closing = buildCashClosing(company.id, tickets, fromISO, toISO, zTotals, { registerId, registerCode, cash });
    setPrinting(true);
    try {
      await TicketDatabase.saveClosing(closing);
      // Design §9: after a Z, final tickets older than the hot window move to
      // their monthly archive (best-effort; never blocks the closing).
      void TicketDatabase.archiveFinalTickets(company.id).catch(() => undefined);
      if (openSession) await CashDrawerStore.closeSession(company.id, openSession.id, closing.id, closing.closedAt);
      // Local audit: who closed the register (closings live outside Redux and emit no change events).
      const diffText = cash.difference !== undefined ? ` · arqueo: ${cashDifferenceLabel(cash.difference).toLowerCase()} ${signedMoney(cash.difference)}` : '';
      dispatch(recordAuditEvents([{
        actor: auditActor,
        action: 'create',
        entityType: 'closing',
        entityId: closing.id,
        companyId: company.id,
        entityLabel: 'Cierre Z',
        summary: `Registró el cierre Z: ${zTotals.ticketCount} ticket(s) por $${zTotals.netTotal.toFixed(2)}${diffText}`,
      }]));
      if (settings.printer) {
        const result = await printReceipt(buildZReceipt(closing, company, settings), settings);
        if (!result.ok) toast.error(`Cierre guardado — impresión falló: ${result.error}`);
        else toast.success('Cierre Z registrado e impreso');
      } else {
        toast.success('Cierre Z registrado');
      }
      setCountedInput('');
      setNowISO(new Date().toISOString());
      setClosings(await TicketDatabase.getClosings(company.id));
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div data-testid="pos-closing" className="space-y-4">
      <PageHeader
        title="Cierre de Caja"
        subtitle={`Arqueo X (lectura) y Z (cierre del período) · ${register.name}${registerCode ? ` (${registerCode})` : ''}`}
      />

      <CashDrawerPanel companyId={company.id} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex rounded-lg border border-brand-300 overflow-hidden" data-testid="closing-mode-toggle">
          <button
            data-testid="closing-mode-x"
            onClick={() => setMode('X')}
            className={`px-4 py-2 text-sm font-medium ${mode === 'X' ? 'bg-accent-600 text-white' : 'bg-white text-brand-700 hover:bg-brand-50'}`}
          >
            X — lectura
          </button>
          <button
            data-testid="closing-mode-z"
            onClick={() => setMode('Z')}
            className={`px-4 py-2 text-sm font-medium ${mode === 'Z' ? 'bg-accent-600 text-white' : 'bg-white text-brand-700 hover:bg-brand-50'}`}
          >
            Z — cierre
          </button>
        </div>
        {mode === 'X' && (
          <Input data-testid="closing-from" label="Desde" type="date" className="!w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
        )}
        {mode === 'X' && (
          <Input data-testid="closing-to" label="Hasta" type="date" className="!w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        )}
        {mode === 'X' && (
          <Select
            data-testid="closing-register-scope"
            label="Cajas"
            className="!w-44"
            value={scope}
            options={[
              { label: 'Esta caja', value: 'register' },
              { label: 'Todas las cajas', value: 'all' },
            ]}
            onChange={(e) => setScope(e.target.value as 'register' | 'all')}
          />
        )}
        {mode === 'Z' && (
          <p className="text-xs text-slate-500 self-center" data-testid="closing-z-range">
            {lastClosing
              ? `Incluye desde el último cierre de esta caja (${new Date(lastClosing.closedAt).toLocaleString('es-SV')}) hasta ahora`
              : 'Incluye todas las ventas de esta caja hasta ahora (primer cierre)'}
          </p>
        )}
      </div>

      {totals && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4" data-testid="closing-summary">
            <div className="flex justify-between text-sm text-slate-600"><span>Tickets</span><span>{totals.ticketCount}</span></div>
            <div className="flex justify-between text-sm text-slate-600"><span>Anulados</span><span>{totals.voidedCount}</span></div>
            {(totals.discountTotal ?? 0) > 0 && (
              <div className="flex justify-between text-sm text-slate-600" data-testid="closing-discount-total">
                <span>Descuentos otorgados</span><span>-{money(totals.discountTotal ?? 0)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm text-slate-600"><span>IVA incluido</span><span>${totals.ivaIncluded.toFixed(2)}</span></div>
            {totals.exemptTotal > 0 && (
              <div className="flex justify-between text-sm text-slate-600"><span>Exento / no gravado</span><span>${totals.exemptTotal.toFixed(2)}</span></div>
            )}
            {(totals.roundingTotal ?? 0) !== 0 && (
              <div className="flex justify-between text-sm text-slate-600" data-testid="closing-rounding"><span>Redondeo de efectivo</span><span>${(totals.roundingTotal ?? 0).toFixed(2)}</span></div>
            )}
            <div className="flex justify-between text-xl font-bold text-brand-900 mt-2 pt-2 border-t border-brand-100" data-testid="closing-total">
              <span>VENTA TOTAL</span><span>${totals.grossTotal.toFixed(2)}</span>
            </div>
            {(totals.priorVoidCount ?? 0) > 0 && (
              <div className="flex justify-between text-sm text-red-700" data-testid="closing-prior-voids">
                <span>Anulaciones de cierres anteriores ({totals.priorVoidCount})</span>
                <span>-${(totals.priorVoidAmount ?? 0).toFixed(2)}</span>
              </div>
            )}
            {(refunds?.count ?? 0) > 0 && (
              <div className="flex justify-between text-sm text-red-700" data-testid="closing-refunds">
                <span>Devoluciones ({refunds!.count})</span>
                <span>-{money(refunds!.amount)}</span>
              </div>
            )}
            {((totals.priorVoidCount ?? 0) > 0 || (refunds?.count ?? 0) > 0) && (
              <div className="flex justify-between text-base font-semibold text-brand-900" data-testid="closing-net">
                <span>NETO DEL CIERRE</span><span>{signedMoney(totals.netTotal)}</span>
              </div>
            )}

            {mode === 'Z' && cashPreview && (
              <div className="mt-4 pt-3 border-t border-brand-100 space-y-1 text-sm" data-testid="closing-cash">
                <h3 className="font-semibold text-brand-900">Arqueo de efectivo</h3>
                <div className="flex justify-between text-slate-600" data-testid="closing-cash-float"><span>Fondo inicial</span><span>{money(cashPreview.openingFloat)}</span></div>
                <div className="flex justify-between text-slate-600" data-testid="closing-cash-sales"><span>Ventas en efectivo</span><span>{money(cashPreview.cashSales)}</span></div>
                {cashPreview.cashRefunds > 0 && (
                  <div className="flex justify-between text-slate-600" data-testid="closing-cash-refunds"><span>Devoluciones en efectivo</span><span>-{money(cashPreview.cashRefunds)}</span></div>
                )}
                {cashPreview.cashIn > 0 && (
                  <div className="flex justify-between text-slate-600" data-testid="closing-cash-in"><span>Entradas</span><span>{money(cashPreview.cashIn)}</span></div>
                )}
                {cashPreview.cashOut > 0 && (
                  <div className="flex justify-between text-slate-600" data-testid="closing-cash-out"><span>Salidas</span><span>-{money(cashPreview.cashOut)}</span></div>
                )}
                <div className="flex justify-between font-semibold text-brand-900" data-testid="closing-cash-expected">
                  <span>Efectivo esperado</span><span>{money(cashPreview.expected)}</span>
                </div>
                <div className="flex items-end justify-between gap-3">
                  <Input
                    data-testid="closing-cash-counted"
                    label="Efectivo contado ($)"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    className="!w-40"
                    placeholder="Cuenta la caja"
                    value={countedInput}
                    onChange={(e) => setCountedInput(e.target.value)}
                  />
                  <CashDifference summary={cashPreview} testId="closing-cash-difference" />
                </div>
                {!session && (
                  <p className="text-xs text-amber-700" data-testid="closing-cash-no-session">Caja sin abrir: el arqueo parte de un fondo de $0.00.</p>
                )}
              </div>
            )}

            <Button
              data-testid="btn-close-z"
              className="w-full mt-4"
              variant={mode === 'Z' ? 'primary' : 'secondary'}
              loading={printing}
              disabled={mode !== 'Z' || !canCloseZ}
              onClick={printZ}
            >
              <Printer size={16} /> {mode === 'Z' ? 'Cerrar del día (Z)' + (settings.printer ? ' e imprimir' : '') : 'Solo lectura (X)'}
            </Button>
          </Card>

          <div className="space-y-4">
            <Card className="p-4" data-testid="closing-by-method">
              <h3 className="text-sm font-semibold text-brand-900 mb-2">Por método de pago</h3>
              {methods.length === 0 ? (
                <p className="text-sm text-slate-500">Sin pagos en el período.</p>
              ) : (
                <div className="space-y-2">
                  {methods.map((m) => {
                    const bucket = totals.byMethod[m];
                    return (
                      <div key={m} className="flex justify-between items-center border-b border-brand-50 pb-2">
                        <div>
                          <p className="text-sm font-medium text-brand-900">{METHOD_LABELS[m]}</p>
                          <p className="text-xs text-slate-500">{bucket.count} pagos</p>
                          {m === 'EFECTIVO' && bucket.cashTendered > 0 && (
                            <p className="text-xs text-slate-500">Recibido ${bucket.cashTendered.toFixed(2)} · Vuelto ${bucket.cashChange.toFixed(2)}</p>
                          )}
                          {(bucket.refundAmount ?? 0) > 0 && (
                            <p className="text-xs text-red-700" data-testid={`closing-refund-${m}`}>Devoluciones -${(bucket.refundAmount ?? 0).toFixed(2)}</p>
                          )}
                        </div>
                        <span className="font-semibold">${bucket.amount.toFixed(2)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card className="p-4" data-testid="closing-by-cashier">
              <h3 className="text-sm font-semibold text-brand-900 mb-2">Por cajero</h3>
              {cashiers.length === 0 ? (
                <p className="text-sm text-slate-500">Sin ventas en el período.</p>
              ) : (
                <div className="divide-y divide-brand-50">
                  {cashiers.map(([name, row]) => (
                    <div key={name} className="flex justify-between text-sm py-1.5" data-testid={`closing-cashier-${slug(name)}`}>
                      <span>{name} ({row.count})</span>
                      <span className="font-medium">{money(row.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {(totals.byProduct?.length ?? 0) > 0 && (
              <Card className="p-4" data-testid="closing-by-product">
                <h3 className="text-sm font-semibold text-brand-900 mb-2">Por producto</h3>
                <div className="divide-y divide-brand-50">
                  {totals.byProduct!.map((row) => (
                    <div key={row.key} className="flex justify-between text-sm py-1.5" data-testid={`closing-product-${slug(row.key)}`}>
                      <span className="truncate">{row.name} <span className="text-slate-500">× {row.quantity}</span></span>
                      <span className="font-medium">{money(row.amount)}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </div>
      )}

      <Card className="p-4">
        <h3 className="text-sm font-semibold text-brand-900 mb-2">Cierres anteriores</h3>
        {registerClosings.length === 0 ? (
          <EmptyState icon={<Receipt size={28} />} title="Sin cierres" message="Aún no has cerrado la caja." />
        ) : (
          <div className="divide-y divide-brand-50" data-testid="closing-history">
            {registerClosings.slice(0, 10).map((c) => (
              <div key={c.id} className="flex justify-between items-center py-2 text-sm" data-testid={`closing-row-${c.id}`}>
                <div>
                  <p className="font-medium text-brand-900">{new Date(c.closedAt).toLocaleString('es-SV')}</p>
                  <p className="text-xs text-slate-500">
                    {c.totals.ticketCount} tickets · {c.totals.voidedCount} anulados
                    {(c.totals.refunds?.count ?? 0) > 0 && ` · ${c.totals.refunds!.count} devoluciones`}
                  </p>
                  {c.cash && (
                    <p className="text-xs text-slate-500" data-testid={`closing-row-cash-${c.id}`}>
                      Esperado {money(c.cash.expected)}
                      {c.cash.counted !== undefined && <> · Contado {money(c.cash.counted)} · <CashDifference summary={c.cash} testId={`closing-row-diff-${c.id}`} /></>}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold">${c.totals.grossTotal.toFixed(2)}</span>
                  {canConsolidate && c.totals.ticketCount > 0 && (
                    <Button
                      size="sm"
                      variant="secondary"
                      data-testid={`btn-invoice-closing-${c.id}`}
                      onClick={() => navigate(`/pos/consolidate?closingId=${encodeURIComponent(c.id)}`)}
                    >
                      <FileText size={14} /> Facturar este cierre
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
