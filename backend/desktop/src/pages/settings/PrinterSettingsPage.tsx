// Settings → Impresora de tickets. Configures the thermal printer per
// company (network TCP 9100 or OS spooler raw), paper width, header/footer,
// runs a test print and a step-by-step connection diagnosis. TM-T20II preset
// note included.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, MinusCircle, Printer, RefreshCw, RotateCw, Stethoscope, Usb, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/common/Card';
import { Input } from '@/components/common/Input';
import { Select } from '@/components/common/Select';
import { Button } from '@/components/common/Button';
import { useToast } from '@/components/common/Toast';
import { useAppSelector } from '@/store';
import { selectCurrentCompany } from '@/store/selectors/companySelectors';
import { usePosSettings } from '@/hooks/useTickets';
import { DEFAULT_POS_SETTINGS, TM_T20II_PRESET, type PosSettings } from '@/services/tickets/PosSettingsStore';
import {
  thermalPrinterBridge,
  type PrinterDiagnostics,
  type PrinterDiagnosticStep,
} from '@/services/printing/ThermalPrinterBridge';
import { isUsablePrinterName, suggestThermalQueue } from '@/services/printing/printerQueues';
import { LocalLogger } from '@/services/logging/LocalLogger';
import { colsForWidth, renderReceiptText, type ReceiptPayload } from '@/services/printing/ReceiptDocument';
import { TelemetryService } from '@/services/telemetry/TelemetryService';
import { TelemetryEvent } from '@/config/telemetryConfig';

function testPayload(widthMm: 80 | 58, company: { nombreComercial?: string; nombre?: string; nit?: string }): ReceiptPayload {
  return {
    kind: 'TEST',
    companyId: 'test',
    companyName: company.nombreComercial || company.nombre || 'Mi Empresa',
    companyNit: company.nit,
    headerLines: [],
    footerLines: [],
    paper: { widthMm },
    cut: true,
  };
}

const EXAMPLE_HOST = '192.168.1.100';

const STEP_ICON: Record<PrinterDiagnosticStep['status'], React.ReactNode> = {
  ok: <CheckCircle2 size={16} className="text-green-600 shrink-0 mt-0.5" />,
  warn: <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />,
  error: <XCircle size={16} className="text-red-600 shrink-0 mt-0.5" />,
  skip: <MinusCircle size={16} className="text-slate-400 shrink-0 mt-0.5" />,
};

function DiagnosticsResult({ result }: { result: PrinterDiagnostics }) {
  const firstError = result.steps.find((s) => s.status === 'error');
  return (
    <div data-testid="printer-diagnostics" data-ok={result.ok ? 'true' : 'false'} className="space-y-2">
      {result.error ? (
        <p className="text-sm text-red-700">{result.error}</p>
      ) : (
        <p
          data-testid="printer-diagnostics-summary"
          className={`text-sm font-medium ${result.ok ? 'text-green-700' : 'text-red-700'}`}
        >
          {result.ok
            ? 'Todo listo: la impresora aceptó la conexión.'
            : `El ticket se detiene en: ${firstError?.label ?? 'un paso con error'}.`}
        </p>
      )}
      <ul className="divide-y divide-brand-100 rounded-lg border border-brand-100">
        {result.steps.map((s) => (
          <li key={s.id} data-testid={`diag-step-${s.id}`} data-status={s.status} className="flex gap-2 p-2.5">
            {STEP_ICON[s.status]}
            <div className="min-w-0 flex-1">
              <p className="text-sm text-brand-900">
                <span className="font-medium">{s.label}</span>
                {typeof s.ms === 'number' && <span className="text-xs text-slate-400"> · {s.ms} ms</span>}
              </p>
              <p className="text-xs text-brand-600 break-words">{s.detail}</p>
              {s.hint && s.status !== 'ok' && <p className="text-xs text-amber-800 mt-0.5">{s.hint}</p>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function PrinterSettingsPage() {
  const toast = useToast();
  const company = useAppSelector(selectCurrentCompany);
  const { settings, save } = usePosSettings(company?.id);

  const [draft, setDraft] = useState<PosSettings>(settings);
  const [printers, setPrinters] = useState<string[]>([]);
  const [loadingQueues, setLoadingQueues] = useState(false);
  const [testing, setTesting] = useState(false);
  const [preview, setPreview] = useState('');
  const [diagnostics, setDiagnostics] = useState<PrinterDiagnostics | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [networkFailed, setNetworkFailed] = useState(false);

  useEffect(() => setDraft(settings), [settings]);

  const loadQueues = useCallback(async () => {
    if (!thermalPrinterBridge.isAvailable()) return;
    setLoadingQueues(true);
    try {
      setPrinters(await thermalPrinterBridge.listPrinters());
    } catch {
      setPrinters([]);
    } finally {
      setLoadingQueues(false);
    }
  }, []);

  useEffect(() => {
    void loadQueues();
  }, [loadQueues]);

  const usbQueue = useMemo(() => suggestThermalQueue(printers), [printers]);

  useEffect(() => {
    if (!company) return;
    const payload = testPayload(draft.printer?.paper.widthMm ?? 80, company);
    setPreview(renderReceiptText(payload));
  }, [company, draft.printer?.paper.widthMm]);

  // A queue name the main process would refuse ("Nombre de impresora
  // inválido"): say so here instead of failing every print.
  const queueNameInvalid = !!draft.printer
    && draft.printer.transport === 'spooler'
    && !!draft.printer.spooler.printerName
    && !isUsablePrinterName(draft.printer.spooler.printerName);

  const canTest = useMemo(() => {
    if (!draft.printer) return false;
    if (draft.printer.transport === 'network') return !!draft.printer.network.host;
    return !!draft.printer.spooler.printerName && isUsablePrinterName(draft.printer.spooler.printerName);
  }, [draft.printer]);

  if (!company) return null;

  const patchPrinter = (patch: Partial<NonNullable<PosSettings['printer']>>) => {
    setDraft((d) => (d.printer ? { ...d, printer: { ...d.printer, ...patch } } : d));
    // Results describe the previous connection.
    setDiagnostics(null);
    setNetworkFailed(false);
  };

  const runDiagnostics = async (trigger: 'manual' | 'after-failed-test') => {
    if (!draft.printer) return;
    setDiagnosing(true);
    try {
      const result = await thermalPrinterBridge.diagnose(draft.printer);
      setDiagnostics(result);
      if (draft.printer.transport === 'network' && !result.ok) setNetworkFailed(true);
      const failed = result.steps.filter((s) => s.status === 'error').map((s) => s.id);
      TelemetryService.trackEvent(TelemetryEvent.TicketPrinterDiagnostics, {
        trigger,
        transport: draft.printer.transport,
        platform: result.platform,
        ok: result.ok,
        failedSteps: failed.join(',') || undefined,
        warnSteps: result.steps.filter((s) => s.status === 'warn').map((s) => s.id).join(',') || undefined,
        usbQueueDetected: !!usbQueue,
        durationMs: result.ms,
      });
      // Full result in the local log — attached to support tickets.
      LocalLogger.event('printing', 'Printer diagnostics', { trigger, ...result });
    } finally {
      setDiagnosing(false);
    }
  };

  const runTest = async () => {
    if (!draft.printer) return;
    setTesting(true);
    try {
      const startedAt = Date.now();
      const result = await thermalPrinterBridge.print(
        draft.printer,
        testPayload(draft.printer.paper.widthMm, company),
      );
      // Test prints are the main troubleshooting path for ticket printing —
      // track every outcome so App Insights shows what users actually hit.
      TelemetryService.trackEvent(TelemetryEvent.TicketPrinterStatusCheck, {
        transport: draft.printer.transport,
        ok: result.ok,
        durationMs: Date.now() - startedAt,
        error: result.error?.slice(0, 200),
        stage: result.stage,
        code: result.code,
      });
      if (result.ok) {
        toast.success('Página de prueba enviada — revisa la impresora');
      } else {
        toast.error(result.error ?? 'No se pudo imprimir');
        if (draft.printer.transport === 'network') setNetworkFailed(true);
        // Show where it stops without asking the user for another click.
        await runDiagnostics('after-failed-test');
      }
    } finally {
      setTesting(false);
    }
  };

  const switchToUsb = () => {
    if (!usbQueue) return;
    patchPrinter({ transport: 'spooler', spooler: { printerName: usbQueue } });
    toast.info(`Conexión cambiada a USB («${usbQueue}»). Guarda y vuelve a probar.`);
  };

  return (
    <div data-testid="printer-settings" className="space-y-4 max-w-3xl">
      <PageHeader title="Impresora de Tickets" subtitle="Impresión térmica ESC/POS para el punto de venta" />

      {!thermalPrinterBridge.isAvailable() && (
        <Card className="p-3 text-sm text-amber-800 bg-amber-50 border border-amber-200">
          La impresión térmica está disponible en la app de escritorio (Electron). En el navegador solo puedes previsualizar.
        </Card>
      )}

      <Card className="p-4 space-y-4">
        <label className="flex items-center gap-2 text-sm font-medium text-brand-900">
          <input
            type="checkbox"
            data-testid="chk-enable-printer"
            checked={!!draft.printer}
            onChange={(e) => {
              setDiagnostics(null);
              setNetworkFailed(false);
              setDraft((d) => ({
                ...d,
                printer: !e.target.checked
                  ? null
                  : usbQueue
                    // A USB ticket printer is installed — start there instead of the network preset.
                    ? { ...TM_T20II_PRESET, transport: 'spooler', spooler: { printerName: usbQueue } }
                    : { ...TM_T20II_PRESET },
              }));
            }}
          />
          Habilitar impresora de tickets
        </label>

        {draft.printer && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Select
                data-testid="printer-transport"
                label="Conexión"
                value={draft.printer.transport}
                options={[
                  { label: 'USB — cola de impresión del sistema', value: 'spooler' },
                  { label: 'Red (Ethernet / Wi-Fi) — IP, puerto 9100', value: 'network' },
                ]}
                onChange={(e) => patchPrinter({ transport: e.target.value as 'network' | 'spooler' })}
              />
              <Select
                data-testid="printer-paper"
                label="Ancho de papel"
                value={String(draft.printer.paper.widthMm)}
                options={[
                  { label: '80 mm — 48 columnas (Epson TM-T20II)', value: '80' },
                  { label: '58 mm — 32 columnas', value: '58' },
                ]}
                onChange={(e) => patchPrinter({ paper: { ...draft.printer!.paper, widthMm: Number(e.target.value) as 80 | 58 } })}
              />
            </div>

            {draft.printer.transport === 'network' && networkFailed && usbQueue && (
              <div
                data-testid="usb-suggestion"
                className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
              >
                <Usb size={16} className="shrink-0" />
                <span className="flex-1 min-w-[12rem]">
                  La impresora no respondió por red, pero este equipo tiene instalada la impresora USB
                  <strong> «{usbQueue}»</strong>. Si está conectada por cable USB, usa esa conexión.
                </span>
                <Button size="sm" variant="secondary" data-testid="btn-switch-to-usb" onClick={switchToUsb}>
                  Usar USB
                </Button>
              </div>
            )}

            {draft.printer.transport === 'network' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Input
                  data-testid="printer-host"
                  label="IP / host"
                  value={draft.printer.network.host}
                  onChange={(e) => patchPrinter({ network: { ...draft.printer!.network, host: e.target.value } })}
                  placeholder="Ej. 192.168.192.168"
                  error={draft.printer.network.host.trim() === EXAMPLE_HOST
                    ? 'Es la IP de ejemplo: escribe la IP real de la impresora (o usa USB).'
                    : undefined}
                />
                <Input
                  data-testid="printer-port"
                  label="Puerto"
                  type="number"
                  value={draft.printer.network.port}
                  onChange={(e) => patchPrinter({ network: { ...draft.printer!.network, port: Number(e.target.value) || 9100 } })}
                />
                <Input
                  data-testid="printer-timeout"
                  label="Timeout (ms)"
                  type="number"
                  value={draft.printer.network.timeoutMs}
                  onChange={(e) => patchPrinter({ network: { ...draft.printer!.network, timeoutMs: Number(e.target.value) || 4000 } })}
                />
              </div>
            )}

            {draft.printer.transport === 'spooler' && (
              <div className="space-y-2">
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Select
                      data-testid="printer-queue"
                      label="Cola de impresión"
                      value={draft.printer.spooler.printerName}
                      placeholder={printers.length ? 'Selecciona la impresora' : 'Escribe el nombre exacto de la cola'}
                      options={printers.map((p) => ({
                        label: isUsablePrinterName(p) ? p : `${p} (nombre no compatible)`,
                        value: p,
                      }))}
                      onChange={(e) => patchPrinter({ spooler: { printerName: e.target.value } })}
                      error={queueNameInvalid
                        ? 'El nombre de esta cola tiene caracteres que no se pueden usar para imprimir. Renómbrala en Windows (letras, números, espacios y - _ . # ( )) y pulsa «Actualizar».'
                        : undefined}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    data-testid="btn-refresh-queues"
                    loading={loadingQueues}
                    disabled={!thermalPrinterBridge.isAvailable()}
                    onClick={() => void loadQueues()}
                    title="Volver a buscar impresoras (después de instalar el driver o conectar el cable)"
                  >
                    <RefreshCw size={14} /> Actualizar
                  </Button>
                </div>
                <p className="text-xs text-slate-500" data-testid="printer-queue-help">
                  {printers.length > 0
                    ? `${printers.length} colas detectadas en este equipo${usbQueue ? ` — la de tickets parece ser «${usbQueue}»` : ''}.`
                    : 'No se detectaron colas — conecta la impresora por USB, instala su driver (Epson APD en Windows) y pulsa «Actualizar».'}
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                data-testid="printer-header"
                label="Encabezado extra (una línea)"
                value={draft.printer.headerLines[0] ?? ''}
                onChange={(e) => patchPrinter({ headerLines: e.target.value ? [e.target.value] : [] })}
                placeholder="¡Gracias por su compra!"
              />
              <Input
                data-testid="printer-footer"
                label="Pie de página (una línea)"
                value={draft.printer.footerLines[0] ?? ''}
                onChange={(e) => patchPrinter({ footerLines: e.target.value ? [e.target.value] : [] })}
                placeholder="Factura disponible a solicitud."
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <Input
                data-testid="printer-copies"
                label="Copias"
                type="number"
                min={1}
                max={3}
                value={draft.printer.paper.copies}
                onChange={(e) => patchPrinter({ paper: { ...draft.printer!.paper, copies: Math.min(3, Math.max(1, Number(e.target.value) || 1)) } })}
              />
              <label className="flex items-center gap-2 text-sm text-brand-700">
                <input
                  type="checkbox"
                  data-testid="printer-cut"
                  checked={draft.printer.paper.cut}
                  onChange={(e) => patchPrinter({ paper: { ...draft.printer!.paper, cut: e.target.checked } })}
                />
                Cortar papel
              </label>
              <label className="flex items-center gap-2 text-sm text-brand-700" title="La TM-T20II no tiene puerto de caja; solo para impresoras que sí lo tengan">
                <input
                  type="checkbox"
                  data-testid="printer-drawer"
                  checked={draft.printer.cashDrawerKick}
                  onChange={(e) => patchPrinter({ cashDrawerKick: e.target.checked })}
                />
                Abrir caja registradora
              </label>
            </div>
          </>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
          <Select
            data-testid="pos-rounding"
            label="Redondeo de efectivo"
            value={draft.roundingMode}
            options={[
              { label: 'Exacto (sin redondeo)', value: 'NONE' },
              { label: 'Al múltiplo de $0.05 más cercano', value: 'NEAREST_0.05' },
            ]}
            onChange={(e) => setDraft((d) => ({ ...d, roundingMode: e.target.value as 'NONE' | 'NEAREST_0.05' }))}
          />
          <Select
            data-testid="pos-oversell"
            label="Venta sin stock"
            value={draft.oversell}
            options={[
              { label: 'Bloquear (recomendado)', value: 'BLOCK' },
              { label: 'Permitir y registrar faltante', value: 'ALLOW' },
            ]}
            onChange={(e) => setDraft((d) => ({ ...d, oversell: e.target.value as 'BLOCK' | 'ALLOW' }))}
          />
        </div>

        <div className="flex flex-wrap gap-2 pt-2 border-t border-brand-100">
          <Button
            data-testid="btn-save-printer"
            onClick={async () => {
              await save(draft);
              toast.success('Configuración guardada');
            }}
          >
            Guardar
          </Button>
          <Button
            variant="secondary"
            data-testid="btn-test-print"
            disabled={!canTest || !thermalPrinterBridge.isAvailable()}
            loading={testing}
            onClick={runTest}
          >
            <Printer size={16} /> Imprimir página de prueba
          </Button>
          <Button variant="ghost" onClick={() => setDraft(settings)}>Descartar cambios</Button>
        </div>
      </Card>

      {draft.printer && (
        <Card className="p-4 space-y-3" data-testid="printer-diagnostics-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-brand-900 flex items-center gap-2">
                <Stethoscope size={14} /> Diagnóstico de conexión
              </h3>
              <p className="text-xs text-slate-500">
                {draft.printer.transport === 'spooler'
                  ? 'Revisa paso a paso la cola USB: servicio de impresión, cola, puerto, estado, trabajos atascados y driver. No imprime nada.'
                  : 'Revisa si la impresora responde en esa IP y puerto, y por qué no. No imprime nada.'}
              </p>
            </div>
            <Button
              variant="secondary"
              data-testid="btn-printer-diagnose"
              disabled={!canTest || !thermalPrinterBridge.isAvailable()}
              loading={diagnosing}
              onClick={() => void runDiagnostics('manual')}
            >
              <Stethoscope size={16} /> Diagnosticar
            </Button>
          </div>
          {diagnostics && <DiagnosticsResult result={diagnostics} />}
        </Card>
      )}

      <Card className="p-4">
        <h3 className="text-sm font-semibold text-brand-900 mb-2 flex items-center gap-2">
          <RotateCw size={14} /> Vista previa ({colsForWidth(draft.printer?.paper.widthMm ?? 80)} columnas)
        </h3>
        <pre data-testid="printer-preview" className="text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg p-3 whitespace-pre overflow-x-auto">
{preview || '…'}
        </pre>
        <p className="text-xs text-slate-500 mt-2">
          Perfil probado: <strong>Epson TM-T20II</strong> (80 mm, ESC/POS). También compatible con impresoras genéricas ESC/POS de 58/80 mm (Star, Bixolon, Xprinter…).
        </p>
      </Card>
    </div>
  );
}
