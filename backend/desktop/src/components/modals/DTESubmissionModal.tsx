// DTESubmissionModal — muestra el progreso paso a paso del envío DTE al MH.
// Desktop (Vite + React 19 + Tailwind 4). Basado en el flujo RN DTESubmissionModal.

import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Circle,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { Invoice, InvoiceStatus } from '@/types/invoice';
import { Company, CompanyEnvironment } from '@/types/company';
import { CertificateService } from '@/services/security/CertificateService';
import {
  InvoiceGenerationService,
  GenerationResult,
} from '@/services/invoiceGeneration/InvoiceGenerationService';
import { useAppSelector, useAppDispatch } from '@/store';
import { selectCurrentTier } from '@/store/selectors/subscriptionSelectors';
import { requiresDesktopAdWait } from '@/services/subscription/FeatureGate';
import { AD_CONFIG } from '@/config/subscriptionConfig';
import { consumeNextSequence, seedSequenceFloor } from '@/store/slices/companySlice';
import { selectSyncCorrelativoMaxima } from '@/store/selectors/syncV2Selectors';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface DTESubmissionResult {
  success: boolean;
  invoice?: Invoice;
  error?: string;
}

export interface DTESubmissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (result: DTESubmissionResult) => void;
  invoice: Invoice;
  company: Company;
  environment: 'development' | 'production' | 'contingency';
}

// ─── Step model ───────────────────────────────────────────────────────────────

type StepState = 'pending' | 'running' | 'done' | 'error';

interface SubmissionStep {
  id: string;
  label: string;
  state: StepState;
  durationMs?: number;
}

const INITIAL_STEPS: SubmissionStep[] = [
  { id: 'cert',     label: 'Validando certificado...',               state: 'pending' },
  { id: 'build',    label: 'Preparando DTE...',                      state: 'pending' },
  { id: 'sign',     label: 'Firmando documento...',                  state: 'pending' },
  { id: 'submit',   label: 'Enviando al Ministerio de Hacienda...', state: 'pending' },
  { id: 'process',  label: 'Procesando respuesta...',                state: 'pending' },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function DTESubmissionModal({
  isOpen,
  onClose,
  onComplete,
  invoice,
  company,
  environment,
}: DTESubmissionModalProps) {
  const tier = useAppSelector(selectCurrentTier);
  const isUITesting = useAppSelector((s) => (s as { app: { isUITesting: boolean } }).app.isUITesting);
  const latestCompany = useAppSelector(
    (s) => s.companies.companies.find((c) => c.id === company.id) ?? company,
  );
  const syncCorrelativoMaxima = useAppSelector((s) => selectSyncCorrelativoMaxima(s, company.id));
  // Ad wait keys off the COMPANY environment (production build + live company),
  // matching the RN/iOS ad gates: a pruebas/test company never waits, even in
  // a shipped build. Build env alone would have charged MH-test usage.
  const isLiveCompany =
    latestCompany.environment === CompanyEnvironment.Production &&
    latestCompany.isTestAccount !== true;
  const env = import.meta.env.PROD && isLiveCompany ? 'production' : 'development';
  const needsAdWait = requiresDesktopAdWait(tier, env, isUITesting);
  const dispatch = useAppDispatch();
  // Identifiers of the last attempt actually built for MH (see retry()).
  const lastAttemptRef = useRef<Invoice | null>(null);

  /**
   * Build the enrichment options for a single submission attempt.
   * - When `company.useSequentialControlNumbers` is enabled and the invoice
   *   has no controlNumber yet (or `forceRegenerate=true`), atomically claim
   *   the next sequence number for the controlNumber's 15-digit suffix.
   * - Otherwise enrichment falls back to the time-derived sequence.
   */
  function nextSubmitOptions(forceRegenerate = false): {
    forceRegenerate?: boolean;
    explicitSequence?: number;
  } {
    const opts: { forceRegenerate?: boolean; explicitSequence?: number } = {};
    if (forceRegenerate) opts.forceRegenerate = true;

    if (latestCompany.useSequentialControlNumbers) {
      // Device Sync v2 correlativo seeding: start above what the owner's other devices
      // already issued for this DTE type (relay max-only maxima).
      const floor = syncCorrelativoMaxima[invoice.documentType] ?? 0;
      const seq = Math.max(latestCompany.nextSequenceNumber ?? 1, floor + 1);
      opts.explicitSequence = seq;
      // Bump the counter so the next document gets the next number even if
      // this submission fails midway. Gaps in the sequence on rejected docs
      // are normal — MH only enforces uniqueness, not contiguity.
      dispatch(seq > (latestCompany.nextSequenceNumber ?? 1)
        ? seedSequenceFloor({ companyId: company.id, floor: seq })
        : consumeNextSequence({ companyId: company.id }));
    }
    return opts;
  }

  const buildSteps = (): SubmissionStep[] => [
    ...(needsAdWait ? [{ id: 'ad', label: 'Procesando solicitud...', state: 'pending' as StepState }] : []),
    ...INITIAL_STEPS,
  ];

  const [steps, setSteps] = useState<SubmissionStep[]>(buildSteps);
  const [finalState, setFinalState] = useState<'idle' | 'success' | 'error'>('idle');
  const [selloRecibido, setSelloRecibido] = useState<string | undefined>();
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [errorCode, setErrorCode] = useState<string | undefined>();
  const [errorObservaciones, setErrorObservaciones] = useState<string[]>([]);
  const ranRef = useRef(false);
  // True from the moment an open is initialized until the modal closes. StrictMode
  // (dev builds — which the real-MH Electron suites load) replays effects: the
  // reset below used to clear ranRef on the replay, so ONE click on "Enviar"
  // submitted TWO DTEs with different números de control.
  const openInitializedRef = useRef(false);

  // Reset every time the modal is opened
  useEffect(() => {
    if (!isOpen) {
      openInitializedRef.current = false;
      return;
    }
    if (openInitializedRef.current) return;
    openInitializedRef.current = true;
    ranRef.current = false;
    setSteps(buildSteps().map(s => ({ ...s, state: 'pending' })));
    setFinalState('idle');
    setSelloRecibido(undefined);
    setErrorMessage(undefined);
    setErrorCode(undefined);
    setErrorObservaciones([]);
    lastAttemptRef.current = null;
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Run the submission pipeline once per open
  useEffect(() => {
    if (!isOpen || ranRef.current) return;
    ranRef.current = true;
    // Re-sending an ErrorEnvio invoice that already carries identifiers: they
    // may have reached MH on the failed attempt — consult MH first.
    const priorAttempt =
      invoice.status === InvoiceStatus.ErrorEnvio && invoice.generationCode ? invoice : undefined;
    runSubmission(priorAttempt ? {} : nextSubmitOptions(false), priorAttempt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function setStepState(id: string, state: StepState, durationMs?: number) {
    setSteps(prev =>
      prev.map(s => (s.id === id ? { ...s, state, durationMs } : s))
    );
  }

  async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
    const start = Date.now();
    const result = await fn();
    return { result, ms: Date.now() - start };
  }

  // ── Main pipeline ────────────────────────────────────────────────────────────

  async function runSubmission(submitOptions?: {
    forceRegenerate?: boolean;
    explicitSequence?: number;
  }, retryOf?: Invoice) {
    // Step 0 — ad wait (Free tier only, when flag is enabled)
    if (needsAdWait) {
      setStepState('ad', 'running');
      await new Promise<void>((resolve) =>
        setTimeout(resolve, AD_CONFIG.desktop.DESKTOP_REWARDED_DURATION_MS)
      );
      setStepState('ad', 'done', AD_CONFIG.desktop.DESKTOP_REWARDED_DURATION_MS);
    }

    // Step 1 — validate certificate
    setStepState('cert', 'running');
    try {
      await timed(async () => {
        const certResult = await CertificateService.getCertificateForCompany(
          company.nit ?? '',
          company.environment === CompanyEnvironment.Production,
        );
        if (!certResult) {
          throw new Error(
            'Certificado no configurado. Vaya a Configuración > Empresa y cargue el certificado.'
          );
        }
      }).then(({ ms }) => setStepState('cert', 'done', ms));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al validar el certificado';
      setStepState('cert', 'error');
      fail(msg);
      return;
    }

    // Steps 2-5 are handled by InvoiceGenerationService.generateAndSubmitDTE.
    // We intercept by wrapping with a status-aware observer using step callbacks.

    // Pre-build: enrich identifiers ONCE so the saved invoice (success or
    // failure) carries the controlNumber + generationCode actually sent to
    // MH. buildDTEPayload's internal enrich call is idempotent for the
    // second pass below (the enriched invoice already has valid IDs).
    // Retry after a failure: if MH already processed the identifiers we sent
    // (the response was lost, or MH says "YA EXISTE"), finish with MH's sello
    // instead of submitting again — a regenerated codigoGeneracion would be a
    // second fiscal document for the same sale.
    if (retryOf?.generationCode) {
      setStepState('submit', 'running');
      const processed = await InvoiceGenerationService.findProcessedOnMH(retryOf, environment, company);
      if (processed) {
        setStepState('build', 'done');
        setStepState('sign', 'done');
        setStepState('submit', 'done');
        setStepState('process', 'done');
        const completedInvoice: Invoice = {
          ...retryOf,
          receptionSeal: processed.selloRecibido,
          fechaTransmision: processed.fechaTransmision ?? new Date().toISOString(),
          status: InvoiceStatus.Completada,
          updatedAt: new Date().toISOString(),
        };
        setSelloRecibido(processed.selloRecibido);
        setFinalState('success');
        onComplete({ success: true, invoice: completedInvoice });
        return;
      }
      setStepState('submit', 'pending');
    }

    // A plain retry re-sends the SAME identifiers (MH answers with the existing
    // record or processes it once); only "Regenerar" mints new ones.
    const enrichedInvoice = InvoiceGenerationService.enrichForSubmission(
      retryOf && !submitOptions?.forceRegenerate ? retryOf : invoice,
      company,
      submitOptions,
    );
    lastAttemptRef.current = enrichedInvoice;

    // Step 2 — build payload (mark running before call)
    setStepState('build', 'running');

    let buildDoneMs = 0;
    const buildStart = Date.now();

    // Step 3 — sign (will be set running mid-flight via a minimal async trick)
    // We orchestrate manually to show per-step feedback.
    let generationResult: GenerationResult;
    try {
      // Build
      const environmentCode =
        environment === 'production'
          ? '01'
          : environment === 'contingency'
          ? '00'
          : company.environment === 'PRODUCTION'
          ? '01'
          : '00';

      const dtePayload = await InvoiceGenerationService.buildDTEPayload(
        enrichedInvoice,
        company,
        environmentCode,
      );
      buildDoneMs = Date.now() - buildStart;
      setStepState('build', 'done', buildDoneMs);

      // Step 3 — sign
      setStepState('sign', 'running');
      const signStart = Date.now();
      const signedDte = await InvoiceGenerationService.signDTE(dtePayload, company);
      setStepState('sign', 'done', Date.now() - signStart);

      // Step 4 — submit
      setStepState('submit', 'running');
      const submitStart = Date.now();
      const mhResponse = await InvoiceGenerationService.submitToMH(
        signedDte,
        enrichedInvoice,
        environment,
        company
      );
      setStepState('submit', 'done', Date.now() - submitStart);

      // Step 5 — process response
      setStepState('process', 'running');
      const processStart = Date.now();

      const accepted =
        mhResponse.estado === 'PROCESADO' || mhResponse.estado === 'RECIBIDO';

      if (!accepted) {
        const mh = mhResponse as { descripcionMsg?: string; codigoMsg?: string; observaciones?: string[] };
        const errorMsg = mh.descripcionMsg || 'Hacienda rechazó el documento';
        setErrorCode(mh.codigoMsg);
        setErrorObservaciones(mh.observaciones ?? []);
        setStepState('process', 'error');
        // Persist the rejected controlNumber so the user can see what was
        // tried — the regenerate-and-retry path will mint a fresh one.
        const failedInvoice: Invoice = { ...enrichedInvoice, status: InvoiceStatus.ErrorEnvio };
        generationResult = { success: false, error: errorMsg, invoice: failedInvoice };
      } else {
        setStepState('process', 'done', Date.now() - processStart);
        const sello = (mhResponse as { selloRecibido?: string }).selloRecibido ?? undefined;
        const completedInvoice: Invoice = {
          ...enrichedInvoice,
          receptionSeal: sello,
          fechaTransmision: (mhResponse as { fechaTransmision?: string; fhProcesamiento?: string }).fechaTransmision
            ?? (mhResponse as { fechaTransmision?: string; fhProcesamiento?: string }).fhProcesamiento
            ?? new Date().toISOString(),
          status: InvoiceStatus.Completada,
          updatedAt: new Date().toISOString(),
        };
        generationResult = { success: true, invoice: completedInvoice, mhResponse };
        setSelloRecibido(sello);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error inesperado durante el envío';
      // Mark whatever step was running as error
      setSteps(prev =>
        prev.map(s => (s.state === 'running' ? { ...s, state: 'error' } : s))
      );
      // Hand back the identifiers that may have reached MH so the caller saves
      // them on the ErrorEnvio invoice (a later retry/consulta needs them).
      fail(msg, { ...enrichedInvoice, status: InvoiceStatus.ErrorEnvio });
      return;
    }

    if (generationResult.success) {
      setFinalState('success');
    } else {
      fail(generationResult.error ?? 'Error desconocido');
    }

    onComplete(generationResult);
  }

  function fail(msg: string, failedInvoice?: Invoice) {
    setErrorMessage(msg);
    setFinalState('error');
    onComplete({ success: false, error: msg, invoice: failedInvoice });
  }

  // ── Render helpers ───────────────────────────────────────────────────────────

  function formatDuration(ms: number) {
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  }

  function StepIcon({ state }: { state: StepState }) {
    switch (state) {
      case 'done':
        return <CheckCircle2 size={20} className="text-green-500 shrink-0" />;
      case 'running':
        return (
          <Loader2 size={20} className="text-blue-500 animate-spin shrink-0" />
        );
      case 'error':
        return <XCircle size={20} className="text-red-500 shrink-0" />;
      default:
        return <Circle size={20} className="text-brand-300 shrink-0" />;
    }
  }

  const isRunning = finalState === 'idle';

  // MH response code 004 means "numeroControl YA EXISTE UN REGISTRO" —
  // re-submitting the same controlNumber will always fail. Detect this and
  // surface a regenerate-and-retry button as the primary action; a normal
  // Reintentar would loop forever.
  const isNumeroControlExists =
    errorCode === '004' ||
    /YA EXISTE/i.test(errorMessage ?? '') ||
    errorObservaciones.some((o) => /YA EXISTE|numeroControl/i.test(o));

  function retry(forceRegenerate: boolean) {
    ranRef.current = false;
    setSteps(buildSteps().map((s) => ({ ...s, state: 'pending' })));
    setFinalState('idle');
    setErrorMessage(undefined);
    setErrorCode(undefined);
    setErrorObservaciones([]);
    const retryOf = lastAttemptRef.current ?? undefined;
    // Re-sending the same identifiers must not claim a new correlativo.
    const opts = forceRegenerate || !retryOf ? nextSubmitOptions(forceRegenerate) : {};
    setTimeout(() => {
      ranRef.current = true;
      runSubmission(opts, retryOf);
    }, 0);
  }

  const footer = finalState !== 'idle' ? (
    <div className="flex gap-2">
      {finalState === 'error' && isNumeroControlExists && (
        <Button
          variant="primary"
          icon={<RefreshCw size={14} />}
          onClick={() => retry(true)}
          data-testid="btn-regenerate-retry"
        >
          Regenerar y Reintentar
        </Button>
      )}
      {finalState === 'error' && !isNumeroControlExists && (
        <Button variant="primary" onClick={() => retry(false)}>
          Reintentar
        </Button>
      )}
      <Button variant="secondary" onClick={onClose}>
        Cerrar
      </Button>
    </div>
  ) : undefined;

  return (
    <Modal
      isOpen={isOpen}
      onClose={isRunning ? undefined! : onClose}
      title="Enviando DTE al Ministerio de Hacienda"
      size="md"
      footer={footer}
    >
      <div className="space-y-4" data-testid="dte-submission-modal">
        {/* Steps list */}
        <ul className="space-y-3">
          {steps.map(step => (
            <li key={step.id} className="flex items-center gap-3">
              <StepIcon state={step.state} />
              <span
                className={[
                  'text-sm flex-1',
                  step.state === 'done'
                    ? 'text-brand-700'
                    : step.state === 'error'
                    ? 'text-red-600'
                    : step.state === 'running'
                    ? 'text-blue-600 font-medium'
                    : 'text-brand-400',
                ].join(' ')}
              >
                {step.label}
              </span>
              {step.state === 'done' && step.durationMs !== undefined && (
                <span className="text-xs text-brand-400">
                  {formatDuration(step.durationMs)}
                </span>
              )}
            </li>
          ))}
        </ul>

        {/* Success state */}
        {finalState === 'success' && (
          <div className="mt-4 rounded-lg bg-green-50 border border-green-200 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={22} className="text-green-600" />
              <span className="font-semibold text-green-800">
                Documento enviado correctamente
              </span>
            </div>
            {selloRecibido && (
              <div>
                <p className="text-xs text-green-700 font-medium mb-1">
                  Sello de recepción:
                </p>
                <p className="text-xs font-mono text-green-800 break-all bg-green-100 rounded px-2 py-1">
                  {selloRecibido}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Error state */}
        {finalState === 'error' && errorMessage && (
          <div className="mt-4 rounded-lg bg-red-50 border border-red-200 p-4 space-y-2">
            <div className="flex items-start gap-2">
              <XCircle size={20} className="text-red-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-red-800 text-sm">
                    Error al enviar el documento
                  </p>
                  {errorCode && (
                    <span className="text-xs font-mono bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                      #{errorCode}
                    </span>
                  )}
                </div>
                <p className="text-sm text-red-700 mt-1">{errorMessage}</p>
              </div>
            </div>
            {errorObservaciones.length > 0 && (
              <div className="ml-7 space-y-1">
                <p className="text-xs font-medium text-red-700">Detalle:</p>
                <ul className="space-y-1">
                  {errorObservaciones.map((obs, i) => (
                    <li key={i} className="text-xs text-red-600 flex items-start gap-1.5">
                      <span className="text-red-400 shrink-0 mt-0.5">•</span>
                      <span>{obs}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

export default DTESubmissionModal;
