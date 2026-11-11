import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Send,
  FileText,
  ChevronRight,
  MessageSquare,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { Input } from '@/components/common/Input';
import { Select } from '@/components/common/Select';
import { Badge } from '@/components/common/Badge';
import { InvoiceStatusBadge } from '@/components/invoices/InvoiceStatusBadge';
import { InvoiceTypeBadge } from '@/components/invoices/InvoiceTypeBadge';
import { useToast } from '@/components/common/Toast';
import { useAppDispatch, useAppSelector } from '@/store';
import { selectAllInvoices } from '@/store/selectors/invoiceSelectors';
import { selectCurrentCompany } from '@/store/selectors/companySelectors';
import { updateInvoice } from '@/store/slices/invoiceSlice';
import { applyInvoiceStockDeduction } from '@/store/slices/productSlice';
import { invoiceStockDeductionPayload } from '@/services/inventory/invoiceStockRules';
import { svDateOf, svInstant, todaySV } from '@/utils/svDate';
import { InvoiceStatus } from '@/types/invoice';
import {
  ContingencyReportService,
  CONTINGENCY_TYPES,
  type ContingencyFormData,
  type PerInvoiceResult,
} from '@/services/contingency/ContingencyReportService';

/** Today's El Salvador calendar date (the machine's clock may not be on SV time). */
function todayIsoDate(): string {
  return todaySV();
}

export default function ContingencyPage() {
  const dispatch = useAppDispatch();
  const toast = useToast();
  const invoices = useAppSelector(selectAllInvoices);
  const company = useAppSelector(selectCurrentCompany);
  const [searchParams] = useSearchParams();
  /** Invoice pre-selected via ?fromInvoice=<id> from InvoiceDetailPage. */
  const fromInvoiceId = searchParams.get('fromInvoice') ?? undefined;
  /** Ensures we auto-load only once per navigation. */
  const fromInvoiceHandled = useRef(false);

  // ── Form state ─────────────────────────────────────────────────────────────
  const [fInicio, setFInicio] = useState(todayIsoDate());
  const [fFin, setFFin] = useState(todayIsoDate());
  const [hInicio, setHInicio] = useState('00:00');
  const [hFin, setHFin] = useState('23:59');
  const [tipoContingencia, setTipoContingencia] = useState<number>(5);
  const [motivoContingencia, setMotivoContingencia] = useState('');
  const [nombreResponsable, setNombreResponsable] = useState('');
  const [duiResponsable, setDuiResponsable] = useState('');

  // ── Invoice loading + selection ────────────────────────────────────────────
  const [loadedInvoices, setLoadedInvoices] = useState<typeof invoices>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ── Submission progress ────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'report' | 'syncing' | 'done'>('idle');
  const [progressCurrent, setProgressCurrent] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [resultList, setResultList] = useState<PerInvoiceResult[]>([]);
  const [currentInvoiceNumber, setCurrentInvoiceNumber] = useState<string | null>(null);

  const isDateRangeValid = useMemo(() => {
    return (
      svInstant(fInicio, hInicio || '00:00') <=
      svInstant(fFin, hFin || '23:59')
    );
  }, [fInicio, fFin, hInicio, hFin]);

  const duiIsValid = /^\d{9}$/.test(duiResponsable);
  const duiIsTouched = duiResponsable.length > 0;

  useEffect(() => {
    // When the user changes the date range, clear the loaded list so they must
    // re-run the load. Keeps the UI explicit about which invoices are in scope.
    // Skip if a fromInvoice pre-selection has already been handled — the date
    // range was set by the pre-selection effect and should not trigger a clear.
    if (loadedInvoices.length > 0 && fromInvoiceHandled.current) return;
    if (loadedInvoices.length > 0) {
      setLoadedInvoices([]);
      setSelected(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fInicio, fFin]);

  // Auto-load and pre-select the invoice arriving via ?fromInvoice=<id>.
  // Runs after date-range effect, so we set handled=true before updating dates.
  useEffect(() => {
    if (!fromInvoiceId || fromInvoiceHandled.current || !company) return;
    const target = invoices.find((inv) => inv.id === fromInvoiceId && inv.companyId === company.id);
    if (!target) return;
    // Mark as handled BEFORE updating fInicio/fFin to prevent the date-range
    // clear effect from wiping the pre-selection we are about to set.
    fromInvoiceHandled.current = true;
    // Set date range to the invoice's own date so "Cargar Facturas" would also find it
    const invoiceDate = svDateOf(target.date) || todayIsoDate();
    setFInicio(invoiceDate);
    setFFin(invoiceDate);
    // Immediately put the invoice in the loaded list and pre-select it
    setLoadedInvoices([target]);
    setSelected(new Set([target.id]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromInvoiceId, company, invoices]);

  function handleLoadInvoices() {
    if (!company) {
      toast.error('No hay empresa seleccionada.');
      return;
    }
    if (!isDateRangeValid) {
      toast.error('La fecha de inicio debe ser anterior o igual a la fecha de fin.');
      return;
    }
    const candidates = ContingencyReportService.filterCandidates(
      invoices,
      company.id,
      fInicio,
      fFin,
    );
    setLoadedInvoices(candidates);
    setSelected(new Set(candidates.map((c) => c.id)));
    if (candidates.length === 0) {
      toast.info?.(
        'No se encontraron facturas en estado "Nueva" o "Error" dentro del rango seleccionado.',
      );
    } else {
      toast.success(`${candidates.length} factura(s) cargada(s).`);
    }
  }

  function toggleInvoice(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(loadedInvoices.map((i) => i.id)));
  }
  function deselectAll() {
    setSelected(new Set());
  }

  const canSubmit =
    !!company &&
    selected.size > 0 &&
    duiIsValid &&
    nombreResponsable.trim().length > 0 &&
    motivoContingencia.trim().length > 0 &&
    isDateRangeValid &&
    !submitting;

  async function handleSubmit() {
    if (!company) {
      toast.error('No hay empresa seleccionada.');
      return;
    }
    const invoicesToSubmit = loadedInvoices.filter((inv) => selected.has(inv.id));
    if (invoicesToSubmit.length === 0) {
      toast.error('Selecciona al menos una factura.');
      return;
    }

    const form: ContingencyFormData = {
      company,
      invoices: invoicesToSubmit,
      tipoContingencia,
      motivoContingencia: motivoContingencia.trim(),
      nombreResponsable: nombreResponsable.trim(),
      duiResponsable,
      fInicio,
      fFin,
      hInicio,
      hFin,
    };

    const errors = ContingencyReportService.validate(form);
    if (errors.length) {
      toast.error(errors[0]);
      return;
    }

    setSubmitting(true);
    setPhase('report');
    setProgressCurrent(0);
    setProgressTotal(invoicesToSubmit.length);
    setResultList([]);
    setCurrentInvoiceNumber(null);

    // Optimistically flip selected invoices to Sincronizando so the list
    // reflects the in-progress state.
    for (const inv of invoicesToSubmit) {
      dispatch(updateInvoice({ id: inv.id, status: InvoiceStatus.Sincronizando }));
    }

    const settledIds = new Set<string>();
    try {
      const result = await ContingencyReportService.submitReport(form, (p) => {
        if (p.phase === 'report') setPhase('report');
        else setPhase('syncing');
        setProgressCurrent(p.current);
        setProgressTotal(p.total);
        if (p.invoice) setCurrentInvoiceNumber(p.invoice.invoiceNumber);
        if (p.lastResult) {
          setResultList((prev) => [...prev, p.lastResult!]);
          // Persist status per invoice as we go
          const inv = invoicesToSubmit.find((i) => i.id === p.lastResult!.invoiceId);
          if (inv) {
            settledIds.add(inv.id);
            const r = p.lastResult!;
            const sent = r.invoice ?? inv;
            // The identifiers the event listed are the ONLY ones this document
            // ever carries (the service never regenerates them), so a retry
            // re-sends the same codigoGeneracion. invoiceNumber follows the
            // transmitted numeroControl so list, detail and PDF show one number.
            const controlNumber = sent.controlNumber ?? inv.controlNumber;
            dispatch(
              updateInvoice({
                id: inv.id,
                status: r.success ? InvoiceStatus.Completada : InvoiceStatus.ErrorEnvio,
                receptionSeal: r.selloRecibido ?? inv.receptionSeal,
                generationCode: sent.generationCode ?? inv.generationCode,
                controlNumber,
                ...(controlNumber ? { invoiceNumber: controlNumber } : {}),
                ...(r.success ? { fechaTransmision: r.fechaTransmision ?? new Date().toISOString() } : {}),
                // Reported in the event: later re-sends keep Modelo 2 / Transmisión 2.
                contingency: sent.contingency ?? inv.contingency,
              }),
            );
            // Same stock rule as a normal send (FE/CCF/FEX/NR only; never NC/ND/
            // FSE/…, a remission's Factura or a POS consolidation).
            const stockPayload = r.success ? invoiceStockDeductionPayload(inv, 'contingency-sync') : null;
            if (stockPayload) {
              dispatch(applyInvoiceStockDeduction(stockPayload));
            }
          }
        }
      });

      setPhase('done');

      if (!result.reportSubmitted) {
        // Nothing reached MH: restore each invoice's previous status.
        for (const inv of invoicesToSubmit) {
          dispatch(updateInvoice({ id: inv.id, status: inv.status }));
        }
        toast.error(result.reportError ?? 'No se pudo enviar el reporte de contingencia.');
        return;
      }

      const okCount = result.invoices.filter((r) => r.success).length;
      const failCount = result.invoices.length - okCount;

      if (failCount === 0) {
        toast.success(
          `Reporte de contingencia enviado y ${okCount} factura(s) sincronizada(s).`,
        );
        // Clear form state
        setLoadedInvoices([]);
        setSelected(new Set());
        setMotivoContingencia('');
      } else {
        toast.error(
          `${okCount}/${result.invoices.length} sincronizadas. ${failCount} fallaron — revisa la lista.`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al enviar contingencia.');
      // Revert the optimistic "Sincronizando" of the invoices that got no
      // result — never overwrite one that already completed.
      for (const inv of invoicesToSubmit) {
        if (!settledIds.has(inv.id)) dispatch(updateInvoice({ id: inv.id, status: inv.status }));
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (!company) {
    return (
      <div data-testid="contingency" className="max-w-3xl mx-auto">
        <PageHeader title="Contingencia" subtitle="Reporte de contingencia al Ministerio de Hacienda" />
        <Card>
          <p className="text-sm text-brand-600 text-center py-6">
            Selecciona una empresa para usar esta sección.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div data-testid="contingency" className="max-w-3xl mx-auto space-y-6">
      <PageHeader
        title="Solicitud de Contingencia"
        subtitle="Reporta al Ministerio de Hacienda los DTE emitidos cuando no había conectividad"
      />

      {/* Header explanation card */}
      <Card className="bg-gradient-to-r from-amber-50 to-white border border-amber-200">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-red-400 text-white flex items-center justify-center shrink-0">
            <AlertTriangle size={22} />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold text-brand-900">¿Cuándo usar esta sección?</h2>
            <p className="text-sm text-brand-700 mt-1">
              Cuando no pudiste transmitir uno o más DTE al Ministerio de Hacienda
              por problemas de conectividad, fallas del sistema, o cualquier otra
              causa de fuerza mayor. Selecciona el período, las facturas afectadas,
              y completa los datos del responsable — el reporte y las facturas se
              enviarán juntos.
            </p>
          </div>
        </div>
      </Card>

      {/* Date / time range */}
      <Card>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center shrink-0">
            <Calendar size={18} />
          </div>
          <h2 className="font-semibold text-brand-800">Período de Contingencia</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Fecha inicio"
            type="date"
            value={fInicio}
            onChange={(e) => setFInicio(e.target.value)}
            required
          />
          <Input
            label="Fecha fin"
            type="date"
            value={fFin}
            onChange={(e) => setFFin(e.target.value)}
            required
          />
          <Input
            label="Hora inicio"
            type="time"
            value={hInicio}
            onChange={(e) => setHInicio(e.target.value)}
          />
          <Input
            label="Hora fin"
            type="time"
            value={hFin}
            onChange={(e) => setHFin(e.target.value)}
          />
        </div>

        {!isDateRangeValid && (
          <p className="text-xs text-red-600 mt-3 flex items-center gap-1.5">
            <AlertTriangle size={14} /> La fecha/hora de inicio debe ser anterior o igual a la de fin.
          </p>
        )}

        <div className="mt-4">
          <Button
            variant="primary"
            icon={<RefreshCw size={16} />}
            onClick={handleLoadInvoices}
            disabled={!isDateRangeValid || submitting}
            data-testid="contingency-load-invoices"
          >
            Cargar Facturas
          </Button>
        </div>
      </Card>

      {/* Invoice list */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <FileText size={18} />
            </div>
            <div>
              <h2 className="font-semibold text-brand-800">Facturas Disponibles</h2>
              {loadedInvoices.length > 0 && (
                <p className="text-xs text-brand-500">
                  {selected.size} de {loadedInvoices.length} seleccionadas
                </p>
              )}
            </div>
          </div>
          {loadedInvoices.length > 0 && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={selectAll}
                disabled={submitting}
                className="text-xs font-medium text-accent-700 bg-accent-50 px-3 py-1.5 rounded-lg hover:bg-accent-100 transition-colors disabled:opacity-50"
              >
                Seleccionar todo
              </button>
              <button
                type="button"
                onClick={deselectAll}
                disabled={submitting}
                className="text-xs font-medium text-amber-700 bg-amber-50 px-3 py-1.5 rounded-lg hover:bg-amber-100 transition-colors disabled:opacity-50"
              >
                Deseleccionar todo
              </button>
            </div>
          )}
        </div>

        {loadedInvoices.length === 0 ? (
          <div className="text-center py-10">
            <FileText size={40} className="mx-auto text-brand-300 mb-3" />
            <p className="text-sm font-medium text-brand-700">No hay facturas cargadas</p>
            <p className="text-xs text-brand-400 mt-1 max-w-sm mx-auto">
              Selecciona un rango de fechas y presiona "Cargar Facturas" para ver los DTE
              en estado "Nueva" o "Error" disponibles.
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {loadedInvoices.map((inv) => {
              const isSelected = selected.has(inv.id);
              const needsControl = !inv.controlNumber || !inv.generationCode;
              return (
                <label
                  key={inv.id}
                  className={[
                    'flex items-center gap-4 p-3 rounded-lg border cursor-pointer transition-colors',
                    isSelected
                      ? 'border-accent-400 bg-accent-50'
                      : 'border-brand-200 hover:border-brand-300',
                    submitting ? 'opacity-70 cursor-not-allowed' : '',
                  ].join(' ')}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleInvoice(inv.id)}
                    disabled={submitting}
                    className="w-4 h-4 accent-accent-600"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-brand-700">
                        {inv.controlNumber || inv.invoiceNumber}
                      </span>
                      <InvoiceTypeBadge type={inv.invoiceType} />
                      <InvoiceStatusBadge status={inv.status} />
                      {needsControl && (
                        <Badge variant="warning" size="sm">
                          Sin código generación
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-brand-400 mt-0.5">{svDateOf(inv.date)}</p>
                  </div>
                  <p className="text-sm font-semibold text-brand-900 whitespace-nowrap">
                    ${(inv.totals?.totalPagar ?? inv.totalAmountIncludingTax ?? inv.totalAmount ?? 0).toFixed(2)}
                  </p>
                </label>
              );
            })}
          </div>
        )}
      </Card>

      {/* Details */}
      <Card>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
            <MessageSquare size={18} />
          </div>
          <h2 className="font-semibold text-brand-800">Detalles de la Contingencia</h2>
        </div>

        <div className="space-y-4">
          <Select
            label="Tipo de contingencia"
            value={String(tipoContingencia)}
            onChange={(e) => setTipoContingencia(Number(e.target.value))}
            options={CONTINGENCY_TYPES.map((t) => ({ value: String(t.value), label: t.label }))}
            required
          />

          <Input
            label="Nombre del responsable"
            placeholder="Ingresa el nombre completo del responsable"
            value={nombreResponsable}
            onChange={(e) => setNombreResponsable(e.target.value)}
            required
          />

          <Input
            label="DUI del responsable"
            placeholder="000000000"
            value={duiResponsable}
            onChange={(e) => {
              const filtered = e.target.value.replace(/\D/g, '').slice(0, 9);
              setDuiResponsable(filtered);
            }}
            required
            inputMode="numeric"
            error={
              duiIsTouched && !duiIsValid ? 'El DUI debe tener exactamente 9 dígitos.' : undefined
            }
          />

          <div>
            <label className="text-sm font-medium text-brand-700 block mb-1">
              Motivo de la contingencia <span className="text-red-500">*</span>
            </label>
            <textarea
              rows={4}
              placeholder="Describe detalladamente el motivo de la contingencia (incidente de conectividad, sistema MH caído, falla eléctrica, etc.)"
              value={motivoContingencia}
              onChange={(e) => setMotivoContingencia(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-brand-300 focus:border-accent-500 focus:ring-1 focus:ring-accent-300 outline-none resize-y"
            />
          </div>
        </div>
      </Card>

      {/* Progress */}
      {submitting && (
        <Card className="border border-accent-200 bg-accent-50/50">
          <div className="flex items-center gap-3 mb-3">
            <Loader2 size={20} className="text-accent-600 animate-spin" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-brand-800">
                {phase === 'report'
                  ? 'Enviando reporte de contingencia…'
                  : `Sincronizando factura ${Math.max(1, progressCurrent)} de ${progressTotal}${
                      currentInvoiceNumber ? ` — ${currentInvoiceNumber}` : ''
                    }`}
              </p>
              {progressTotal > 0 && (
                <div className="mt-2 h-1.5 rounded-full bg-brand-100 overflow-hidden">
                  <div
                    className="h-full bg-accent-600 transition-all duration-300"
                    style={{
                      width: `${Math.round((progressCurrent / progressTotal) * 100)}%`,
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Results */}
      {phase === 'done' && resultList.length > 0 && (
        <Card>
          <h2 className="font-semibold text-brand-800 mb-3">Resultados</h2>
          <ul className="space-y-2">
            {resultList.map((r) => (
              <li
                key={r.invoiceId}
                className="flex items-center gap-3 p-2 rounded-lg bg-brand-50"
              >
                {r.success ? (
                  <CheckCircle2 size={16} className="text-green-600 shrink-0" />
                ) : (
                  <XCircle size={16} className="text-red-500 shrink-0" />
                )}
                <span className="font-mono text-xs text-brand-700">{r.invoiceNumber}</span>
                <span className="text-xs text-brand-500 flex-1 truncate">
                  {r.success ? r.selloRecibido ?? 'Completada' : r.error ?? 'Error'}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Submit */}
      <div className="flex justify-end">
        <Button
          variant="primary"
          size="lg"
          icon={submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          onClick={handleSubmit}
          disabled={!canSubmit}
          loading={submitting}
          data-testid="contingency-submit"
        >
          {submitting ? 'Procesando…' : 'Enviar Solicitud y Sincronizar'}
          {!submitting && <ChevronRight size={16} className="ml-1" />}
        </Button>
      </div>
    </div>
  );
}
