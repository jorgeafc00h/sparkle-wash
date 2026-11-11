import { useEffect, useMemo, useState } from 'react';
import type { Company } from '@/types/company';
import { useNavigate, useParams } from 'react-router-dom';
import {
  CheckCircle2,
  Loader2,
  AlertCircle,
  ArrowLeft,
  Rocket,
  XCircle,
  ExternalLink,
  Info,
  RefreshCw,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { Badge } from '@/components/common/Badge';
import { Modal } from '@/components/common/Modal';
import { useToast } from '@/components/common/Toast';
import { useAppSelector } from '@/store';
import { selectAllCompanies } from '@/store';
import {
  useRequestProductionAccess,
  ProcessingStatus,
  type PreflightCheck,
  type RunSummary,
  type BatchIssue,
  type IssueStage,
} from '@/hooks/useRequestProductionAccess';
import { InvoiceType } from '@/types/invoice';
import { CompanyEnvironment } from '@/types/company';

function StatusIcon({ status }: { status: ProcessingStatus }) {
  switch (status) {
    case ProcessingStatus.Completed:
      return <CheckCircle2 size={18} className="text-green-600" />;
    case ProcessingStatus.Generating:
    case ProcessingStatus.Sending:
      return <Loader2 size={18} className="text-accent-600 animate-spin" />;
    case ProcessingStatus.Error:
      return <XCircle size={18} className="text-red-500" />;
    default:
      return <AlertCircle size={18} className="text-brand-300" />;
  }
}

function statusLabel(status: ProcessingStatus): string {
  switch (status) {
    case ProcessingStatus.Completed:
      return 'Enviado';
    case ProcessingStatus.Generating:
      return 'Generando…';
    case ProcessingStatus.Sending:
      return 'Enviando…';
    case ProcessingStatus.Error:
      return 'Error';
    default:
      return 'Pendiente';
  }
}

const STAGE_LABELS: Record<IssueStage, string> = {
  configuracion: 'Configuración de la empresa',
  certificado: 'Certificado de firma',
  credenciales: 'Credenciales de Hacienda (API MH)',
  generacion: 'Generación',
  envio: 'Envío a Hacienda',
  contingencia: 'Solicitud de contingencia',
  invalidacion: 'Evento de invalidación',
};

/** Badge for one pre-flight row: "Falta" only when nothing is stored at all. */
function CheckBadge({ check, okText, testId }: { check: PreflightCheck; okText: string; testId: string }) {
  let badge: React.ReactNode;
  if (check.status === 'ok') badge = <Badge variant="success">{okText}</Badge>;
  else if (check.status === 'checking' || check.status === 'idle') badge = <Badge variant="neutral">Verificando…</Badge>;
  else if (/no se encontr|no hay certificado/i.test(check.message ?? '')) badge = <Badge variant="error">Falta</Badge>;
  else if (/contactar|conexión|HTTP/i.test(check.message ?? '')) badge = <Badge variant="warning">Sin conexión</Badge>;
  else badge = <Badge variant="error">Inválido</Badge>;
  return <span data-testid={testId}>{badge}</span>;
}

function IssueItem({ issue }: { issue: BatchIssue }) {
  const isInfo = issue.severity === 'info';
  return (
    <li
      className={['border-l-2 pl-3 py-1', isInfo ? 'border-blue-400' : 'border-red-500'].join(' ')}
      data-testid="summary-issue"
    >
      <p className="text-xs font-semibold text-brand-500">
        {STAGE_LABELS[issue.stage]}
        {issue.documentNumber ? ` · Documento #${issue.documentNumber}` : ''}
      </p>
      {issue.controlNumber && <p className="text-[11px] text-brand-400 break-all">{issue.controlNumber}</p>}
      <p className="text-sm text-brand-800 break-words select-text">{issue.message}</p>
    </li>
  );
}

/** End-of-run report: which batch (or pre-flight check) each problem came from. */
function RunSummaryDialog({
  summary,
  onClose,
  onRetryFailed,
}: {
  summary: RunSummary;
  onClose: () => void;
  /** Present when some batches did not end accepted and can be resent. */
  onRetryFailed?: () => void;
}) {
  const preflightIssues = summary.issues.filter((i) => i.batch === 'preflight');
  const errorCount = summary.issues.filter((i) => i.severity !== 'info').length;
  const accepted = summary.batches.filter((b) => b.status === ProcessingStatus.Completed).length;
  const title = summary.preflightFailed
    ? 'Verificación previa fallida'
    : summary.ok
      ? 'Proceso completado'
      : 'Proceso completado con errores';
  return (
    <Modal
      isOpen
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          {onRetryFailed && (
            <Button
              variant="secondary"
              icon={<RefreshCw size={14} />}
              onClick={onRetryFailed}
              data-testid="btn-retry-failed"
            >
              Reintentar lotes con errores
            </Button>
          )}
          <Button variant="primary" onClick={onClose} data-testid="btn-close-summary">
            Cerrar
          </Button>
        </div>
      }
    >
      <div data-testid="production-summary-dialog" className="space-y-4">
        <p className="text-sm text-brand-600" data-testid="summary-subtitle">
          {summary.preflightFailed
            ? 'No se generó ni se envió ningún documento. Corrige lo siguiente y vuelve a intentar.'
            : `${accepted} de ${summary.batches.length} lote(s) aceptados${errorCount > 0 ? ` · ${errorCount} error(es)` : ''}`}
        </p>
        {preflightIssues.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-brand-800">Verificación previa</h3>
            <ul className="space-y-2">
              {preflightIssues.map((issue, i) => <IssueItem key={i} issue={issue} />)}
            </ul>
          </section>
        )}
        {summary.batches.map((batch) => {
          const issues = summary.issues.filter((i) => i.batch === batch.key);
          return (
            <section
              key={batch.key}
              className="rounded-lg border border-brand-100 p-3 space-y-2"
              data-testid={`summary-batch-${batch.key}`}
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-brand-800">{batch.label}</h3>
                {batch.status === ProcessingStatus.Completed ? (
                  <Badge variant="success">Aceptado</Badge>
                ) : batch.status === ProcessingStatus.Error ? (
                  <Badge variant="error">Con errores</Badge>
                ) : (
                  <Badge variant="neutral">No enviado</Badge>
                )}
              </div>
              {batch.total > 0 && (
                <p className="text-xs text-brand-500">
                  {batch.accepted} de {batch.total} aceptados por Hacienda
                  {batch.failed > 0 ? ` · ${batch.failed} rechazados` : ''}
                </p>
              )}
              {issues.length > 0 && (
                <ul className="space-y-2">
                  {issues.map((issue, i) => <IssueItem key={i} issue={issue} />)}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </Modal>
  );
}

export default function RequestProductionAccessPage() {
  const { id } = useParams<{ id: string }>();
  const companies = useAppSelector(selectAllCompanies);
  const company = useMemo(() => companies.find((c) => c.id === id) ?? null, [companies, id]);

  if (!company) {
    return (
      <div data-testid="request-production" className="py-16 text-center text-brand-400">
        Empresa no encontrada.
      </div>
    );
  }
  // Keyed by company so switching companies remounts with fresh hook state
  // (the hooks used to run after early returns — a rules-of-hooks violation).
  return <RequestProductionAccessContent key={company.id} company={company} />;
}

function RequestProductionAccessContent({ company }: { company: Company }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [summaryOpen, setSummaryOpen] = useState(false);

  const {
    batchOptions,
    batchSize,
    setBatchSize,
    isProcessing,
    isProcessingAll,
    hasCompleted,
    progress,
    status,
    KEY_ORDER,
    sendInvoices,
    pendingResend,
    processAllDocuments,
    failedKeys,
    acceptedThisSession,
    selectedKeys,
    toggleKey,
    selectAllKeys,
    clearSelectedKeys,
    preflight,
    runPreflight,
    runSummary,
  } = useRequestProductionAccess(company, {
    onMessage: (level, message) => {
      if (level === 'success') toast.success(message);
      else if (level === 'error') toast.error(message);
      else toast.info?.(message);
    },
  });

  const isProduction = company.environment === CompanyEnvironment.Production;

  // Pre-flight on arrival: certificate (validated + probe signature), then
  // the Hacienda credentials straight against MH — before anything is sent.
  useEffect(() => {
    if (!isProduction) void runPreflight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProduction]);

  // Every run ends in the summary dialog.
  useEffect(() => {
    if (runSummary) setSummaryOpen(true);
  }, [runSummary]);

  if (isProduction) {
    return (
      <div data-testid="request-production" className="max-w-lg mx-auto py-16 text-center space-y-4">
        <Rocket size={40} className="mx-auto text-brand-300" />
        <p className="font-semibold text-brand-800">Empresa en ambiente de producción</p>
        <p className="text-sm text-brand-500">
          Esta función solo está disponible para empresas configuradas en ambiente de{' '}
          <strong>desarrollo/pruebas</strong>. Cambia el ambiente de la empresa a{' '}
          <strong>Desarrollo</strong> para generar y enviar los documentos de prueba requeridos
          por Hacienda.
        </p>
        <Button variant="secondary" onClick={() => navigate(-1)}>
          Volver
        </Button>
      </div>
    );
  }

  const overall = Math.round(progress.overall);
  const allDone = KEY_ORDER.every((k) => status[k.key] === ProcessingStatus.Completed);

  const preflightChecking = [preflight.certificate, preflight.certificatePassword, preflight.credentials].some(
    (c) => c.status === 'checking',
  );
  const requirementsMet =
    preflight.certificate.status === 'ok' &&
    preflight.certificatePassword.status === 'ok' &&
    preflight.credentials.status === 'ok';
  const issueCount = (key: string) =>
    (runSummary?.issues ?? []).filter((i) => i.batch === key && i.severity !== 'info').length;

  return (
    <div data-testid="request-production" className="max-w-3xl mx-auto space-y-6">
      <PageHeader
        title="Solicitar acceso a producción"
        subtitle={`${company.nombreComercial} — proceso automatizado con el Ministerio de Hacienda`}
        actions={
          <Button
            variant="secondary"
            icon={<ArrowLeft size={16} />}
            onClick={() => navigate(`/companies/${company.id}`)}
          >
            Volver
          </Button>
        }
      />

      {isProduction && (
        <Card className="bg-green-50 border border-green-200">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="text-green-600" size={22} />
            <div>
              <p className="font-semibold text-green-800">
                Esta empresa ya está en producción.
              </p>
              <p className="text-sm text-green-700">
                No es necesario ejecutar el proceso nuevamente.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Upfront notice — many users don't realize that the test certificate +
          test API credentials they configured for homologation are NOT the
          same as the ones MH issues for production. Surface this before they
          start so they know what to expect at the end. */}
      {!isProduction && (
        <Card
          className="bg-blue-50 border border-blue-200"
          data-testid="production-portal-notice"
        >
          <div className="flex items-start gap-3">
            <Info className="text-blue-600 shrink-0 mt-0.5" size={20} />
            <div className="space-y-2 text-sm text-blue-900">
              <p className="font-semibold">¿Qué pasa al terminar la homologación?</p>
              <p>
                Crearemos automáticamente una nueva empresa en modo{' '}
                <strong>producción</strong> con la misma identidad fiscal (NIT,
                NRC, dirección, actividad). Para emitir DTEs reales necesitarás:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-1">
                <li>
                  Un <strong>certificado de producción</strong> distinto al de
                  pruebas (archivo <code>.crt</code> emitido por el Ministerio
                  de Hacienda).
                </li>
                <li>
                  <strong>Credenciales API de producción</strong> (usuario y
                  contraseña) distintas a las de pruebas.
                </li>
              </ul>
              <p>
                Ambos se gestionan en el portal de Hacienda. Después de que
                termine este proceso, descarga el nuevo certificado y crea las
                credenciales en el portal y configúralos en la nueva empresa
                creada.
              </p>
              <a
                href="https://admin.factura.gob.sv/login"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-blue-700 hover:text-blue-900 underline"
                data-testid="link-mh-portal"
              >
                Ir al portal de Hacienda
                <ExternalLink size={14} />
              </a>
            </div>
          </div>
        </Card>
      )}

      {/* Verificación previa — certificate first, then MH credentials. */}
      <div data-testid="production-requirements">
        <Card className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold text-brand-800">Verificación previa</h2>
            <div className="flex items-center gap-2">
              {preflightChecking ? (
                <Badge variant="neutral">Verificando…</Badge>
              ) : requirementsMet ? (
                <Badge variant="success">Listo</Badge>
              ) : (
                <Badge variant="warning">Incompleto</Badge>
              )}
              <Button
                variant="secondary"
                size="sm"
                icon={<RefreshCw size={14} />}
                onClick={() => { void runPreflight(); }}
                disabled={isProcessing || preflightChecking}
                data-testid="btn-rerun-preflight"
              >
                Verificar
              </Button>
            </div>
          </div>
          <ul className="divide-y divide-brand-100">
            <li className="py-2 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-brand-800">1. Certificado de firma</p>
                <p
                  className={['text-xs break-words', preflight.certificate.status === 'error' ? 'text-red-600' : 'text-brand-500'].join(' ')}
                  data-testid="req-cert-message"
                >
                  {preflight.certificate.message ?? 'Se valida el certificado y se firma un documento de prueba.'}
                </p>
              </div>
              <CheckBadge check={preflight.certificate} okText="Verificado" testId="req-cert" />
            </li>
            <li className="py-2 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-brand-800">Contraseña del certificado</p>
                <p className="text-xs text-brand-500 break-words">
                  {preflight.certificatePassword.message ?? 'Guárdala en el llavero para poder firmar DTEs.'}
                </p>
              </div>
              <CheckBadge check={preflight.certificatePassword} okText="Guardada" testId="req-cert-pwd" />
            </li>
            <li className="py-2 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-brand-800">2. Credenciales de Hacienda (API MH)</p>
                <p
                  className={['text-xs break-words', preflight.credentials.status === 'error' ? 'text-red-600' : 'text-brand-500'].join(' ')}
                  data-testid="req-creds-message"
                >
                  {preflight.credentials.message ?? 'Se validan directamente contra la API de Hacienda.'}
                </p>
              </div>
              <CheckBadge check={preflight.credentials} okText="Verificadas" testId="req-creds" />
            </li>
          </ul>
          {!requirementsMet && !preflightChecking && (
            <div className="pt-2">
              <Button
                variant="secondary"
                onClick={() => navigate(`/companies/${company.id}/config`)}
                data-testid="btn-go-config"
              >
                Ir a configuración
              </Button>
            </div>
          )}
        </Card>
      </div>

      {/* Batch selector */}
      <Card className="space-y-4">
        <div>
          <h2 className="font-semibold text-brand-800">Tamaño del lote</h2>
          <p className="text-sm text-brand-500 mt-1">
            Cada vez que inicias el proceso se genera un lote <strong>nuevo</strong> de
            este tamaño para cada tipo de DTE seleccionado y se envía al Ministerio de
            Hacienda como prueba de implementación. Los eventos de{' '}
            <strong>Contingencia</strong> e <strong>Invalidación</strong> procesan 5
            documentos fijos (requisito de Hacienda).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {batchOptions.map((n) => (
            <button
              key={n}
              onClick={() => setBatchSize(n)}
              disabled={isProcessing}
              className={[
                'px-4 py-2 rounded-lg text-sm font-medium border transition-colors',
                batchSize === n
                  ? 'bg-accent-600 text-white border-accent-600'
                  : 'bg-white text-brand-700 border-brand-300 hover:border-accent-400',
                isProcessing ? 'opacity-60 cursor-not-allowed' : '',
              ].join(' ')}
            >
              {n} por tipo
            </button>
          ))}
        </div>
      </Card>

      {/* Process status per DTE type */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-brand-800">Tipos de DTE</h2>
          {isProcessingAll ? (
            <Badge variant="info">Procesando…</Badge>
          ) : hasCompleted || allDone ? (
            <Badge variant="success">Completo</Badge>
          ) : (
            <Badge variant="neutral">En espera</Badge>
          )}
        </div>

        <div className="flex items-center justify-between mb-2 text-xs">
          <span className="text-brand-500">
            {selectedKeys.size}/{KEY_ORDER.length} seleccionados
          </span>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={selectAllKeys}
              disabled={isProcessing}
              className="text-accent-600 hover:underline disabled:opacity-50"
              data-testid="btn-select-all-types"
            >
              Seleccionar todos
            </button>
            <button
              type="button"
              onClick={clearSelectedKeys}
              disabled={isProcessing}
              className="text-brand-500 hover:underline disabled:opacity-50"
              data-testid="btn-clear-types"
            >
              Limpiar
            </button>
          </div>
        </div>

        <ul className="divide-y divide-brand-100">
          {KEY_ORDER.map((row) => {
            const st = status[row.key];
            const pct = Math.round(progress[row.key]);
            const checked = selectedKeys.has(row.key);
            return (
              <li key={row.key} className="py-3">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleKey(row.key)}
                    disabled={isProcessing}
                    aria-label={`Seleccionar ${row.label}`}
                    data-testid={`chk-type-${row.key}`}
                    className="h-4 w-4 rounded border-brand-300 text-accent-600 focus:ring-accent-500 disabled:opacity-50"
                  />
                  <StatusIcon status={st} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-3">
                      <label
                        htmlFor={`chk-type-${row.key}`}
                        className={[
                          'text-sm font-medium truncate cursor-pointer',
                          checked ? 'text-brand-800' : 'text-brand-400',
                        ].join(' ')}
                        onClick={(e) => {
                          if (isProcessing) return;
                          e.preventDefault();
                          toggleKey(row.key);
                        }}
                      >
                        {row.label}
                      </label>
                      <span className="flex items-center gap-2 shrink-0">
                        {(acceptedThisSession[row.key] ?? 0) > 0 && (
                          <span className="text-xs text-green-700" data-testid={`row-sent-${row.key}`}>
                            {acceptedThisSession[row.key]} aceptados
                          </span>
                        )}
                        <span className="text-xs text-brand-500" data-testid={`row-status-${row.key}`}>{statusLabel(st)}</span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-brand-100 overflow-hidden">
                      <div
                        className={[
                          'h-full rounded-full transition-all duration-300',
                          st === ProcessingStatus.Error
                            ? 'bg-red-500'
                            : st === ProcessingStatus.Completed
                              ? 'bg-green-500'
                              : 'bg-accent-500',
                        ].join(' ')}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {issueCount(row.key) > 0 && !isProcessing && (
                      <button
                        type="button"
                        onClick={() => setSummaryOpen(true)}
                        className="mt-1 text-xs font-medium text-red-600 hover:underline"
                        data-testid={`row-errors-${row.key}`}
                      >
                        {issueCount(row.key)} error(es) · Ver detalle
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {/* Overall progress */}
        {(isProcessing || overall > 0) && (
          <div className="mt-5 pt-4 border-t border-brand-100">
            <div className="flex justify-between text-sm mb-1.5">
              <span className="text-brand-600 font-medium">Envío general</span>
              <span className="text-brand-600">{overall}%</span>
            </div>
            <div className="h-2 rounded-full bg-brand-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-accent-600 transition-all duration-300"
                style={{ width: `${overall}%` }}
              />
            </div>
          </div>
        )}
      </Card>

      {/* Actions */}
      <div className="flex flex-wrap justify-end gap-2">
        {runSummary && (
          <Button variant="secondary" onClick={() => setSummaryOpen(true)} data-testid="btn-view-summary">
            Ver resumen del último envío
          </Button>
        )}
        {pendingResend > 0 && (
          <Button
            variant="secondary"
            onClick={() => { void sendInvoices(); }}
            disabled={isProcessing || isProduction || !requirementsMet}
            loading={isProcessing && !isProcessingAll}
            title="Reenvía a Hacienda los documentos de esta sesión que aún no fueron aceptados"
            data-testid="btn-send-generated"
          >
            Reenviar pendientes ({pendingResend})
          </Button>
        )}
        <Button
          variant="primary"
          icon={<Rocket size={16} />}
          onClick={() => { void processAllDocuments(); }}
          disabled={
            isProcessing || isProduction || !requirementsMet || selectedKeys.size === 0
          }
          loading={isProcessingAll}
          data-testid="btn-start-full-process"
        >
          {hasCompleted
            ? 'Procesar de nuevo'
            : selectedKeys.size === KEY_ORDER.length
              ? 'Iniciar proceso completo'
              : `Procesar seleccionados (${selectedKeys.size})`}
        </Button>
      </div>

      {hasCompleted && (
        <Card
          className="bg-green-50 border border-green-200"
          data-testid="production-completion-card"
        >
          <div className="flex items-start gap-3">
            <CheckCircle2 className="text-green-600 shrink-0 mt-0.5" size={22} />
            <div className="space-y-3 text-sm text-green-900">
              <p className="font-semibold text-green-800 text-base">
                Homologación completada
              </p>
              <p>
                Todos los DTEs de prueba fueron enviados al Ministerio de
                Hacienda y se creó automáticamente una nueva empresa en modo{' '}
                <strong>producción</strong> (con la misma identidad fiscal que
                la actual). Esta empresa de producción está lista, pero{' '}
                <strong>aún no puede emitir DTEs</strong> hasta que cargues los
                secretos correctos.
              </p>
              <div className="rounded-lg bg-white border border-green-200 p-3 space-y-2">
                <p className="font-semibold text-green-900">Pasos siguientes</p>
                <ol className="list-decimal list-inside space-y-1.5">
                  <li>
                    Inicia sesión en el{' '}
                    <a
                      href="https://admin.factura.gob.sv/login"
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-blue-700 hover:text-blue-900 underline inline-flex items-center gap-1"
                    >
                      portal de Hacienda
                      <ExternalLink size={12} />
                    </a>{' '}
                    con tus credenciales.
                  </li>
                  <li>
                    Descarga el <strong>certificado de producción</strong>{' '}
                    (archivo <code>.crt</code>) — es distinto al de pruebas.
                  </li>
                  <li>
                    Genera/copia las <strong>credenciales API de producción</strong>{' '}
                    (usuario y contraseña) — también son distintas a las de
                    pruebas.
                  </li>
                  <li>
                    Abre la nueva empresa en{' '}
                    <strong>Editar Configuración</strong> y carga el certificado
                    + las credenciales de producción.
                  </li>
                </ol>
              </div>
              <p className="text-xs text-green-700">
                MH revisará tu solicitud en las próximas horas. Hasta que apruebe
                la cuenta, las credenciales de producción no autenticarán
                correctamente.
              </p>
            </div>
          </div>
        </Card>
      )}
      {summaryOpen && runSummary && (
        <RunSummaryDialog
          summary={runSummary}
          onClose={() => setSummaryOpen(false)}
          onRetryFailed={
            !runSummary.preflightFailed && failedKeys.length > 0 && requirementsMet && !isProcessing
              ? () => {
                  setSummaryOpen(false);
                  void processAllDocuments(failedKeys);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

// Type export used above
export type { InvoiceType };
