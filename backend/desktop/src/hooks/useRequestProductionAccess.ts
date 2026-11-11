/**
 * useRequestProductionAccess — orchestrates the Hacienda production-access
 * authorization flow: generates one test batch per DTE type, sends everything
 * to MH, and reports per-type status + progress.
 *
 * Mirrors the iOS `RequestProductionAccessViewModel`: after the per-type DTE
 * batches, two fixed-size event batches run — Contingencia (5 contingency
 * reports, one per invoice) and Evento de Invalidación (5 fresh facturas that
 * are submitted to MH and then invalidated). Both are user-selectable and
 * their failures are fatal for the homologation result.
 *
 * Ported from the React Native hook of the same name. Uses a toast callback
 * instead of Alert.alert so the page can surface messages via ToastProvider.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector, persistor } from '@/store';
import { addInvoices, updateInvoice } from '@/store/slices/invoiceSlice';
import { promoteToProduction } from '@/store/slices/companySlice';
import { selectAllInvoices } from '@/store';
import { Company, CompanyEnvironment } from '@/types/company';
import { Invoice, InvoiceType, InvoiceStatus } from '@/types/invoice';
import { Customer } from '@/types/customer';
import { Product } from '@/types/product';

import { TestDataGenerator } from '@/services/testData/TestDataGenerator';
import { InvoiceBatchGenerator } from '@/services/invoiceGeneration/InvoiceBatchGenerator';
import { InvoiceGenerationService } from '@/services/invoiceGeneration/InvoiceGenerationService';
import { SecureStorageService } from '@/services/security/SecureStorageService';
import { DTEMappingService } from '@/services/dte/DTEMappingService';
import { sanitizeCompanyForEmisor } from '@/services/dte/CompanyEmisorSanitizer';
import { getMhClient } from '@/services/api/MhClient';
import { getSignerService } from '@/services/signing/SignerService';
import { deepOmitUndefinedEnhanced } from '@/utils/dteMapper';
import { getApiConfig } from '@/config/api';
import { InvoiceInvalidationService, InvalidationReason } from '@/services/invalidation/InvoiceInvalidationService';
import { CertificateService } from '@/services/security/CertificateService';

export enum ProcessingStatus {
  NotStarted = 'notStarted',
  Generating = 'generating',
  Sending = 'sending',
  Completed = 'completed',
  Error = 'error',
}

type StatusKey =
  | 'factura'
  | 'ccf'
  | 'notaCredito'
  | 'sujetoExcluido'
  | 'notaDebito'
  | 'facturaExportacion'
  | 'notaRemision'
  | 'comprobanteLiquidacion'
  | 'comprobanteRetencion'
  | 'documentoContable'
  | 'comprobanteDonacion'
  | 'contingencia'
  | 'invalidacion';

export type ProcessingState = Record<StatusKey, ProcessingStatus>;
export type ProgressState = Record<StatusKey, number> & { overall: number };

const TYPE_TO_KEY: Record<InvoiceType, StatusKey | undefined> = {
  [InvoiceType.Factura]: 'factura',
  [InvoiceType.CCF]: 'ccf',
  [InvoiceType.NotaCredito]: 'notaCredito',
  [InvoiceType.SujetoExcluido]: 'sujetoExcluido',
  [InvoiceType.NotaDebito]: 'notaDebito',
  [InvoiceType.FacturaExportacion]: 'facturaExportacion',
  [InvoiceType.NotaRemision]: 'notaRemision',
  [InvoiceType.ComprobanteLiquidacion]: 'comprobanteLiquidacion',
  [InvoiceType.ComprobanteRetencion]: 'comprobanteRetencion',
  [InvoiceType.DocumentoContableLiquidacion]: 'documentoContable',
  [InvoiceType.ComprobanteDonacion]: 'comprobanteDonacion',
  [InvoiceType.EventoOperacionesEspeciales]: undefined,
  [InvoiceType.EventoRetorno]: undefined,
};

const KEY_ORDER: { key: StatusKey; type: InvoiceType; label: string }[] = [
  { key: 'factura', type: InvoiceType.Factura, label: 'Factura' },
  { key: 'ccf', type: InvoiceType.CCF, label: 'Crédito Fiscal (CCF)' },
  { key: 'sujetoExcluido', type: InvoiceType.SujetoExcluido, label: 'Sujeto Excluido' },
  { key: 'facturaExportacion', type: InvoiceType.FacturaExportacion, label: 'Factura de Exportación' },
  { key: 'notaCredito', type: InvoiceType.NotaCredito, label: 'Nota de Crédito' },
  { key: 'notaDebito', type: InvoiceType.NotaDebito, label: 'Nota de Débito' },
  { key: 'notaRemision', type: InvoiceType.NotaRemision, label: 'Nota de Remisión' },
  { key: 'comprobanteLiquidacion', type: InvoiceType.ComprobanteLiquidacion, label: 'Comprobante de Liquidación' },
  { key: 'comprobanteRetencion', type: InvoiceType.ComprobanteRetencion, label: 'Comprobante de Retención' },
  { key: 'documentoContable', type: InvoiceType.DocumentoContableLiquidacion, label: 'Documento Contable de Liquidación' },
  { key: 'comprobanteDonacion', type: InvoiceType.ComprobanteDonacion, label: 'Comprobante de Donación' },
  // Hacienda's homologation requires submitting 5 contingency-mode DTEs as
  // proof the seller can report a fallback when MH is unavailable. The `type`
  // field is just a sentinel — contingency reuses Facturas internally; each
  // accepted invoice is reported individually via /fesv/contingencia/.
  { key: 'contingencia', type: InvoiceType.Factura, label: 'Contingencia (5 solicitudes)' },
  // Invalidación is its own homologation batch (iOS `processInvalidations`):
  // 5 fresh facturas are submitted to MH, then each is invalidated with
  // tipoAnulacion=2 via /fesv/anulardte. Runs after contingencia.
  { key: 'invalidacion', type: InvoiceType.Factura, label: 'Evento de Invalidación (5)' },
];

// Fixed size for the two event batches — matches the iOS app, which always
// sends 5 contingency requests and 5 invalidations regardless of batch size.
const EVENT_BATCH_SIZE = 5;

/**
 * Homologación is a Hacienda TEST-environment process (ambiente 00): the
 * documents it generates are fictitious and must never reach production MH,
 * whatever the company's own environment. Every MH client, API config,
 * credential/certificate read and signature in this hook uses this value, and
 * the submitted copy of the company is forced to Development
 * (`homologationCompany`) so the shared DTE/invalidation services resolve the
 * test environment too. Guarded by src/__tests__/productionAccess/*.
 */
export const HOMOLOGATION_IS_PRODUCTION = false as const;

/**
 * Test-environment copy of the company used for every homologation
 * submission: the DTE builder (`ambiente`), signer, credential lookup and
 * invalidation service all key off `environment`.
 */
export function homologationCompany(company: Company): Company {
  return {
    ...company,
    environment: CompanyEnvironment.Development,
    isTestAccount: true,
    isProduction: HOMOLOGATION_IS_PRODUCTION,
  };
}

export type BatchKey = StatusKey;

/** `YYYY-MM` of an ISO timestamp on the El Salvador calendar. */
const svMonth = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/El_Salvador', year: 'numeric', month: '2-digit' })
    .format(new Date(iso));

/** The two non-DTE event batches (everything else is a DTE type). */
const isEventKey = (key: StatusKey) => key === 'contingencia' || key === 'invalidacion';

export type PreflightCheckStatus = 'idle' | 'checking' | 'ok' | 'error';
export interface PreflightCheck {
  status: PreflightCheckStatus;
  message?: string;
}
/**
 * Verified before ANY document is generated: the signing certificate first
 * (nothing can be signed without it — validated AND a probe payload signed),
 * then the Hacienda credentials straight against MH's /seguridad/auth (this
 * flow talks to MH directly, not to the cloud service).
 */
export interface PreflightState {
  configuration: PreflightCheck;
  certificate: PreflightCheck;
  certificatePassword: PreflightCheck;
  credentials: PreflightCheck;
}

export type IssueStage =
  | 'configuracion'
  | 'certificado'
  | 'credenciales'
  | 'generacion'
  | 'envio'
  | 'contingencia'
  | 'invalidacion';

/** One problem found during a run, tagged with where it came from. */
export interface BatchIssue {
  batch: BatchKey | 'preflight';
  stage: IssueStage;
  severity?: 'error' | 'info';
  documentNumber?: string;
  controlNumber?: string;
  message: string;
}

export interface BatchResult {
  key: BatchKey;
  label: string;
  total: number;
  accepted: number;
  failed: number;
  status: ProcessingStatus;
}

export interface RunSummary {
  ok: boolean;
  preflightFailed: boolean;
  batches: BatchResult[];
  issues: BatchIssue[];
  finishedAt: string;
}

const idlePreflight = (): PreflightState => ({
  configuration: { status: 'idle' },
  certificate: { status: 'idle' },
  certificatePassword: { status: 'idle' },
  credentials: { status: 'idle' },
});

const zeroProgress = (): ProgressState => ({
  factura: 0,
  ccf: 0,
  notaCredito: 0,
  sujetoExcluido: 0,
  notaDebito: 0,
  facturaExportacion: 0,
  notaRemision: 0,
  comprobanteLiquidacion: 0,
  comprobanteRetencion: 0,
  documentoContable: 0,
  comprobanteDonacion: 0,
  contingencia: 0,
  invalidacion: 0,
  overall: 0,
});
const initialStatus = (): ProcessingState => ({
  factura: ProcessingStatus.NotStarted,
  ccf: ProcessingStatus.NotStarted,
  notaCredito: ProcessingStatus.NotStarted,
  sujetoExcluido: ProcessingStatus.NotStarted,
  notaDebito: ProcessingStatus.NotStarted,
  facturaExportacion: ProcessingStatus.NotStarted,
  notaRemision: ProcessingStatus.NotStarted,
  comprobanteLiquidacion: ProcessingStatus.NotStarted,
  comprobanteRetencion: ProcessingStatus.NotStarted,
  documentoContable: ProcessingStatus.NotStarted,
  comprobanteDonacion: ProcessingStatus.NotStarted,
  contingencia: ProcessingStatus.NotStarted,
  invalidacion: ProcessingStatus.NotStarted,
});

export interface UseRequestProductionAccessOptions {
  onMessage?: (level: 'info' | 'success' | 'error', message: string) => void;
}

export function useRequestProductionAccess(
  company: Company,
  opts: UseRequestProductionAccessOptions = {},
) {
  const dispatch = useAppDispatch();
  const allInvoices = useAppSelector(selectAllInvoices);
  // Scoped to THIS company: the store holds every company's documents, and an
  // unscoped "ya existen suficientes" count (or CCF-parent lookup) let another
  // company's accepted invoices skip this company's batch or become the
  // parent of its notes.
  const invoices = useMemo(
    () => allInvoices.filter((inv) => inv.companyId === company.id),
    [allInvoices, company.id],
  );
  // Always-current view of the store for code running inside a long batch:
  // the callbacks are created in an earlier render, so reading `invoices`
  // there would see the store as it was when the run STARTED.
  const invoicesRef = useRef(invoices);
  invoicesRef.current = invoices;
  const notify = opts.onMessage ?? (() => undefined);

  const batchOptions = [5, 50, 75, 100];
  const [batchSize, setBatchSize] = useState<number>(75);

  // Per-type selection — defaults to all selected (preserves prior behaviour).
  // Dependent types (NC/ND/NR/CL/CR/DCL) require their parent to also be
  // selected; the page warns when a selection makes a generator unrunnable.
  // `contingencia` + `invalidacion` are event batches with a fixed size of 5
  // (Hacienda homologation requirement) — selectable like every other row.
  const SELECTABLE_KEYS = KEY_ORDER.map((r) => r.key);
  const [selectedKeys, setSelectedKeys] = useState<Set<StatusKey>>(
    () => new Set(SELECTABLE_KEYS),
  );
  const toggleKey = useCallback((key: StatusKey) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const selectAllKeys = useCallback(() => {
    setSelectedKeys(new Set(SELECTABLE_KEYS));
  }, [SELECTABLE_KEYS]);
  const clearSelectedKeys = useCallback(() => {
    setSelectedKeys(new Set());
  }, []);

  const customersRef = useRef<Customer[]>([]);
  const productsRef = useRef<Product[]>([]);
  const generatedRef = useRef<Invoice[]>([]);
  // When MH makes us re-mint a parent's identifiers (004 retry, or a rejected
  // helper CCF resent), dependents still point at the OLD codigoGeneracion
  // (NC/ND/DCL) or numeroControl (CL/CR) in `relatedDocumentNumber`; they are
  // patched from these maps right before submission. Reset per run.
  const identifierRemapRef = useRef({
    uuid: new Map<string, string>(),
    controlNumber: new Map<string, string>(),
  });
  // Time-derived counter start at ms-resolution + 3-digit random tail —
  // every generated controlNumber suffix is unique across test runs (and
  // across concurrent batches running within the same second). Seconds-
  // granularity collided when the suite retries a test or runs back-to-back.
  const counterRef = useRef(
    Math.max(
      1,
      (Date.now() % 100_000_000_000) * 1000 + Math.floor(Math.random() * 1000),
    ),
  );

  const [isProcessing, setIsProcessing] = useState(false);
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const [hasCompleted, setHasCompleted] = useState(false);
  const [status, setStatus] = useState<ProcessingState>(initialStatus());
  const [progress, setProgress] = useState<ProgressState>(zeroProgress());
  const [processedTypes, setProcessedTypes] = useState<Set<InvoiceType>>(new Set());
  const [preflight, setPreflight] = useState<PreflightState>(idlePreflight());
  const [runSummary, setRunSummary] = useState<RunSummary | null>(null);
  // Documents accepted per row across this page session ("N aceptados").
  const [acceptedThisSession, setAcceptedThisSession] = useState<Partial<Record<StatusKey, number>>>({});
  // This session's generated documents MH has not accepted yet.
  const [pendingResend, setPendingResend] = useState(0);

  // Non-null only while a managed run is active: problems are collected for
  // the end-of-run summary dialog — with WHERE each came from — instead of a
  // trail of transient toasts that only ever reported the first failure.
  const issuesRef = useRef<BatchIssue[] | null>(null);
  const record = (issue: BatchIssue) => {
    if (issuesRef.current) {
      issuesRef.current.push(issue);
      return;
    }
    notify(issue.severity === 'info' ? 'info' : 'error', issue.message);
  };

  const updateStatus = useCallback((type: InvoiceType, newStatus: ProcessingStatus) => {
    const key = TYPE_TO_KEY[type];
    if (!key) return;
    setStatus((prev) => ({ ...prev, [key]: newStatus }));
  }, []);

  const updateProgress = useCallback((type: InvoiceType, percentage: number) => {
    const key = TYPE_TO_KEY[type];
    if (!key) return;
    setProgress((prev) => ({ ...prev, [key]: percentage }));
  }, []);

  const prepareTestData = useCallback((): [Customer[], Product[]] => {
    if (customersRef.current.length === 0) {
      // Desktop TDG signature: (companyId, count)
      customersRef.current = TestDataGenerator.generateCustomers(company.id, 10);
    }
    if (productsRef.current.length === 0) {
      productsRef.current = TestDataGenerator.generateProducts(company.id, 5);
    }
    return [customersRef.current, productsRef.current];
  }, [company.id]);

  // Each generator numbers its documents `start + i` (dependents use two
  // numbers per note: helper parent + note), so a call must reserve a whole
  // block. Handing out consecutive single numbers made same-type batches
  // overlap (Factura batch vs. the facturas of the event batches, helper CCFs
  // vs. the CCF batch) and every overlap cost an MH "[004] YA EXISTE" rejection
  // plus a retry with fresh identifiers.
  const SEQUENCE_BLOCK = 1_000;
  const nextNumber = useCallback(() => {
    const n = counterRef.current;
    counterRef.current += SEQUENCE_BLOCK;
    return n;
  }, []);

  // ── Generators ────────────────────────────────────────────────────────────
  // Every selected batch generates and submits a FRESH set of documents. The
  // old "ya existen suficientes" short-circuit skipped any type whose accepted
  // count already reached the batch size — on a company homologated in an
  // earlier session that meant nothing was sent at all, while the row still
  // turned green ("Enviado") and the summary said "Aceptado".

  /**
   * Accepted documents of `types` that may be the parent of a new `dependent`
   * document: this run's documents first (fresh, just accepted), then earlier
   * ones from the store emitted in the current month. Excludes invalidated
   * documents and parents an earlier `dependent` already references — MH
   * rejects a second CR/CL for the same parent with "[204] No puede ingresar
   * el mismo numero documento con el mismo estado".
   */
  function parentCandidates(types: InvoiceType[], dependent: InvoiceType): Invoice[] {
    const pool = [...generatedRef.current, ...invoicesRef.current];
    const referenced = new Set(
      pool
        .filter((inv) => inv.invoiceType === dependent)
        .map((inv) => inv.relatedDocumentNumber)
        .filter((ref): ref is string => !!ref),
    );
    const thisRun = new Set(generatedRef.current.map((inv) => inv.id));
    const month = svMonth(new Date().toISOString());
    const seen = new Set<string>();
    return pool.filter((inv) => {
      if (seen.has(inv.id)) return false;
      seen.add(inv.id);
      if (!types.includes(inv.invoiceType)) return false;
      if (inv.status !== InvoiceStatus.Completada || inv.invalidatedViaApi) return false;
      if (referenced.has(inv.generationCode ?? '') || referenced.has(inv.controlNumber ?? '')) return false;
      return thisRun.has(inv.id) || (!!inv.date && svMonth(inv.date) === month);
    });
  }

  async function runSimpleBatch(
    type: InvoiceType,
    call: (
      n: number,
      c: Customer[],
      p: Product[],
      company: Company,
      start: number,
      onP: (p: { percentage: number }) => void,
    ) => Promise<Invoice[]>,
    typeLabel: string,
  ): Promise<boolean> {
    const [customers, products] = prepareTestData();
    updateStatus(type, ProcessingStatus.Generating);
    try {
      const start = nextNumber();
      // Generation phase = 0-50% of the per-type progress bar; submission
      // (handled later by submitTypeBatch) covers 50-100%.
      const newInvoices = await call(batchSize, customers, products, company, start, (prog) =>
        updateProgress(type, prog.percentage * 0.5),
      );
      dispatch(addInvoices(newInvoices));
      generatedRef.current.push(...newInvoices);
      updateProgress(type, 50);
      // Status stays Generating; submitTypeBatch will transition to Sending then Completed/Error.
      return true;
    } catch (err) {
      console.error(`Error generating ${typeLabel}:`, err);
      updateStatus(type, ProcessingStatus.Error);
      record({
        batch: TYPE_TO_KEY[type] ?? 'factura',
        stage: 'generacion',
        message: `Error al generar ${typeLabel}: ${(err as Error)?.message ?? err}`,
      });
      return false;
    }
  }

  async function runDependentBatch(
    type: InvoiceType,
    typeLabel: string,
    runner: () => Promise<{ helpers: Invoice[]; notes: Invoice[] }>,
  ): Promise<boolean> {
    updateStatus(type, ProcessingStatus.Generating);
    try {
      const { helpers, notes } = await runner();
      dispatch(addInvoices([...helpers, ...notes]));
      generatedRef.current.push(...helpers, ...notes);
      updateProgress(type, 50);
      // Status stays Generating; submitTypeBatch will transition to Sending then Completed/Error.
      return true;
    } catch (err) {
      console.error(`Error generating ${typeLabel}:`, err);
      updateStatus(type, ProcessingStatus.Error);
      record({
        batch: TYPE_TO_KEY[type] ?? 'factura',
        stage: 'generacion',
        message: `Error al generar ${typeLabel}: ${(err as Error)?.message ?? err}`,
      });
      return false;
    }
  }

  const generateFacturas = () =>
    runSimpleBatch(InvoiceType.Factura, InvoiceBatchGenerator.generateFacturas, 'Facturas');
  const generateCreditosFiscales = () =>
    runSimpleBatch(InvoiceType.CCF, InvoiceBatchGenerator.generateCreditosFiscales, 'Créditos Fiscales');
  const generateSujetoExcluido = () =>
    runSimpleBatch(InvoiceType.SujetoExcluido, InvoiceBatchGenerator.generateSujetoExcluido, 'Sujetos Excluidos');
  const generateFacturaExportacion = () =>
    runSimpleBatch(
      InvoiceType.FacturaExportacion,
      InvoiceBatchGenerator.generateFacturaExportacion,
      'Facturas de Exportación',
    );
  const generateComprobanteDonacion = () =>
    runSimpleBatch(
      InvoiceType.ComprobanteDonacion,
      InvoiceBatchGenerator.generateComprobanteDonacion,
      'Comprobantes de Donación',
    );

  /** A CCF-dependent batch: NC / ND / CL / CR / DCL. */
  const generateCcfDependent = (
    type: InvoiceType,
    typeLabel: string,
    generate: (
      n: number,
      ccf: Invoice[],
      c: Customer[],
      p: Product[],
      company: Company,
      start: number,
      onP: (p: { percentage: number }) => void,
    ) => Promise<{ helpers: Invoice[]; notes: Invoice[] }>,
  ) =>
    runDependentBatch(type, typeLabel, () => {
      const [customers, products] = prepareTestData();
      return generate(
        batchSize,
        parentCandidates([InvoiceType.CCF], type),
        customers,
        products,
        company,
        nextNumber(),
        (p) => updateProgress(type, p.percentage * 0.5),
      );
    });

  const generateCreditNotes = () =>
    generateCcfDependent(InvoiceType.NotaCredito, 'Notas de Crédito', async (...args) => {
      const res = await InvoiceBatchGenerator.generateCreditNotes(...args);
      return { helpers: res.helperCCF, notes: res.creditNotes };
    });
  const generateDebitNotes = () =>
    generateCcfDependent(InvoiceType.NotaDebito, 'Notas de Débito', async (...args) => {
      const res = await InvoiceBatchGenerator.generateDebitNotes(...args);
      return { helpers: res.helperCCF, notes: res.debitNotes };
    });
  const generateComprobanteLiquidacion = () =>
    generateCcfDependent(InvoiceType.ComprobanteLiquidacion, 'Comprobantes de Liquidación', async (...args) => {
      const res = await InvoiceBatchGenerator.generateComprobanteLiquidacion(...args);
      return { helpers: res.helperCCF, notes: res.comprobantes };
    });
  const generateComprobanteRetencion = () =>
    generateCcfDependent(InvoiceType.ComprobanteRetencion, 'Comprobantes de Retención', async (...args) => {
      const res = await InvoiceBatchGenerator.generateComprobanteRetencion(...args);
      return { helpers: res.helperCCF, notes: res.comprobantes };
    });
  const generateDocumentoContable = () =>
    generateCcfDependent(
      InvoiceType.DocumentoContableLiquidacion,
      'Documentos Contables de Liquidación',
      async (...args) => {
        const res = await InvoiceBatchGenerator.generateDocumentoContableLiquidacion(...args);
        return { helpers: res.helperCCF, notes: res.documentos };
      },
    );

  const generateNotaRemision = () =>
    runDependentBatch(InvoiceType.NotaRemision, 'Notas de Remisión', async () => {
      const [customers, products] = prepareTestData();
      const res = await InvoiceBatchGenerator.generateNotaRemision(
        batchSize,
        parentCandidates([InvoiceType.Factura, InvoiceType.CCF], InvoiceType.NotaRemision),
        customers,
        products,
        company,
        nextNumber(),
        (p) => updateProgress(InvoiceType.NotaRemision, p.percentage * 0.5),
      );
      return { helpers: res.helperInvoices, notes: res.remissionNotes };
    });

  // ── Send a single type's batch to MH ─────────────────────────────────────
  // Submits a freshly-generated batch for a single DTE type, updating per-type
  // progress (50→100%) and final status. Helpers (parent CCFs for dependents)
  // share the dependent's status row since they are part of the same logical
  // batch — if any helper or note fails, the type is marked Error.
  // Returns counters so the caller can build a final summary.
  type SubmitOutcome = {
    sent: number;
    failed: number;
    firstFailure: { invoiceNumber: string; reason: string } | null;
  };

  type MhResponse = {
    descripcionMsg?: string;
    /** /fesv/contingencia/ reports its outcome here instead of descripcionMsg. */
    mensaje?: string;
    codigoMsg?: string;
    observaciones?: string[];
  };

  // Detect "[004] numeroControl YA EXISTE UN REGISTRO" — fires when MH has
  // previously seen the same numeroControl (from a prior failed attempt or
  // a parallel session). The remedy is to mint fresh identifiers and resend.
  // NOTE: keep the phrase match very specific. A broad "NUMEROCONTROL"
  // substring check false-positives on schema errors that just happen to
  // mention the field, causing pointless regenerate-retries.
  function is004NumeroControlExists(mh: MhResponse | undefined): boolean {
    if (!mh) return false;
    if (mh.codigoMsg === '004') return true;
    const haystack = [mh.descripcionMsg ?? '', ...(mh.observaciones ?? [])]
      .join(' ')
      .toUpperCase();
    return haystack.includes('YA EXISTE UN REGISTRO');
  }

  // Strip controlNumber/generationCode/invoiceNumber so
  // `InvoiceGenerationService.enrichForSubmission` stamps fresh ones derived
  // from a time+random sequence (won't collide with the old ones MH recorded).
  function withFreshIdentifiers(invoice: Invoice): Invoice {
    return {
      ...invoice,
      controlNumber: '',
      generationCode: '',
      invoiceNumber: '',
    };
  }

  async function submitTypeBatch(
    type: InvoiceType,
    batchInvoices: Invoice[],
    testCompany: Company,
    // Override for event batches (invalidación): report submission progress
    // under the event's own status row instead of the DTE type's row, and
    // within a progress sub-range so the event's bar can cover its phases.
    opts?: { statusKey?: StatusKey; progressFrom?: number; progressTo?: number },
  ): Promise<SubmitOutcome> {
    const total = batchInvoices.length;
    if (total === 0) return { sent: 0, failed: 0, firstFailure: null };

    const statusKey = opts?.statusKey ?? TYPE_TO_KEY[type];
    const progressFrom = opts?.progressFrom ?? 50;
    const progressTo = opts?.progressTo ?? 100;
    const span = progressTo - progressFrom;
    const setStatusForKey = (st: ProcessingStatus) => {
      if (statusKey) setStatus((prev) => ({ ...prev, [statusKey]: st }));
    };
    const setProgressForKey = (pct: number) => {
      if (statusKey) setProgress((prev) => ({ ...prev, [statusKey]: pct }));
    };

    setStatusForKey(ProcessingStatus.Sending);
    setProgressForKey(progressFrom);

    let sent = 0;
    let failed = 0;
    let firstFailure: { invoiceNumber: string; reason: string } | null = null;

    // Parent identifier rotations (see `identifierRemapRef`) — shared by the
    // whole run because "Enviar lo generado" submits helper parents and their
    // notes in different per-type groups.
    const uuidRemap = identifierRemapRef.current.uuid;
    const controlNumberRemap = identifierRemapRef.current.controlNumber;

    // Serial submission — MH's test endpoint returns generic 400s when bursts
    // arrive within the same millisecond (rate-limit / DoS guard).
    for (let i = 0; i < batchInvoices.length; i++) {
      let invoice = batchInvoices[i];

      // Skip if already accepted by MH — re-sending would trip
      // "[004] identificacion.numeroControl YA EXISTE UN REGISTRO".
      if (invoice.status === InvoiceStatus.Completada) {
        sent += 1;
        setProgressForKey(progressFrom + ((i + 1) / total) * span);
        continue;
      }

      // Patch dependent's parent reference if its parent was regenerated
      // earlier in this batch (helper CCFs precede their notes in batchInvoices).
      const ext = invoice as Invoice & { relatedDocumentNumber?: string };
      if (ext.relatedDocumentNumber) {
        const remappedUuid = uuidRemap.get(ext.relatedDocumentNumber);
        const remappedCn = controlNumberRemap.get(ext.relatedDocumentNumber);
        if (remappedUuid || remappedCn) {
          invoice = {
            ...invoice,
            relatedDocumentNumber: remappedUuid ?? remappedCn,
          } as Invoice;
        }
      }

      // Submit — strip identifiers if this invoice was previously rejected so
      // a fresh controlNumber is minted (avoids the 004 the prior numeroControl
      // would otherwise hit).
      const initialPayload =
        invoice.status === InvoiceStatus.ErrorEnvio
          ? withFreshIdentifiers(invoice)
          : invoice;

      let result = await InvoiceGenerationService.generateAndSubmitDTE(
        initialPayload,
        testCompany,
        'development',
      );

      // 004 retry: MH already recorded this numeroControl. Mint fresh
      // identifiers and try once more (dependents are remapped below).
      const initialMh = result.mhResponse as MhResponse | undefined;
      if (!result.success && is004NumeroControlExists(initialMh)) {
        console.warn(
          `Retry ${invoice.invoiceNumber} with fresh identifiers (MH said numeroControl exists)`,
        );
        result = await InvoiceGenerationService.generateAndSubmitDTE(
          withFreshIdentifiers(invoice),
          testCompany,
          'development',
        );
      }

      if (result.success && result.invoice) {
        // Any identifier change (004 retry above, or a previously rejected
        // document resent with fresh identifiers) must reach its dependents.
        if (invoice.generationCode && result.invoice.generationCode &&
            invoice.generationCode !== result.invoice.generationCode) {
          uuidRemap.set(invoice.generationCode, result.invoice.generationCode);
        }
        if (invoice.controlNumber && result.invoice.controlNumber &&
            invoice.controlNumber !== result.invoice.controlNumber) {
          controlNumberRemap.set(invoice.controlNumber, result.invoice.controlNumber);
        }
        dispatch(updateInvoice(result.invoice));
        // Update buffer in place so dependent generators that filter by
        // status === Completada find this CCF/Factura immediately.
        const idx = generatedRef.current.findIndex((inv) => inv.id === invoice.id);
        if (idx >= 0) generatedRef.current[idx] = result.invoice;
        sent += 1;
      } else {
        const mh = result.mhResponse as MhResponse | undefined;
        const detail = mh?.observaciones?.length
          ? mh.observaciones.slice(0, 3).join(' · ')
          : mh?.descripcionMsg || mh?.mensaje || result.error || 'Error desconocido';
        const reason = mh?.codigoMsg ? `[${mh.codigoMsg}] ${detail}` : detail;
        console.error(`Submit error ${invoice.invoiceNumber}:`, reason, mh);
        if (!firstFailure) firstFailure = { invoiceNumber: invoice.invoiceNumber, reason };
        record({
          batch: statusKey ?? 'factura',
          stage: 'envio',
          documentNumber: invoice.invoiceNumber,
          controlNumber: invoice.controlNumber,
          // Helper parents (CCF/Factura generated for dependent notes) are
          // attributed to the batch that needed them, labelled as such.
          message: invoice.isHelperForCreditNote ? `Documento base de respaldo: ${reason}` : reason,
        });
        const updated = { ...invoice, status: InvoiceStatus.ErrorEnvio };
        dispatch(updateInvoice(updated));
        const idx = generatedRef.current.findIndex((inv) => inv.id === invoice.id);
        if (idx >= 0) generatedRef.current[idx] = updated;
        failed += 1;
      }

      setProgressForKey(progressFrom + ((i + 1) / total) * span);
    }

    if (failed === 0 && sent > 0) {
      setStatusForKey(ProcessingStatus.Completed);
      setProgressForKey(progressTo);
      // Event batches manage their own completion after all phases finish.
      if (!opts?.statusKey) setProcessedTypes((prev) => new Set([...prev, type]));
    } else if (failed > 0) {
      setStatusForKey(ProcessingStatus.Error);
    }

    return { sent, failed, firstFailure };
  }

  // ── Contingency test batch (homologation) ────────────────────────────────
  // Hacienda's homologation requires 5 contingency events as proof the seller
  // can fall back when MH is down. Port of iOS
  // `processContingencyRequestsWithProgress`: generate 5 brand-new facturas
  // (documents "issued while MH was down" — never previously transmitted) and
  // POST one signed ContingenciaRequest per factura to /fesv/contingencia/.
  // The facturas themselves are not transmitted, exactly like the Swift app.
  const setContingencyStatus = useCallback((s: ProcessingStatus) => {
    setStatus((prev) => ({ ...prev, contingencia: s }));
  }, []);
  const setContingencyProgress = useCallback((pct: number) => {
    setProgress((prev) => ({ ...prev, contingencia: pct }));
  }, []);

  async function submitContingencyBatch(testCompany: Company): Promise<SubmitOutcome> {
    // Mirror iOS `processContingencyRequestsWithProgress`: ALWAYS generate 5
    // brand-new Facturas (never reuse previously-accepted DTEs) and report
    // each one individually to MH's /fesv/contingencia/. A contingency event
    // describes documents issued while MH was down — fresh facturas are
    // exactly what the homologación checklist expects to see.
    let candidates: Invoice[] = [];
    try {
      const [customers, products] = prepareTestData();
      setContingencyStatus(ProcessingStatus.Generating);
      candidates = await InvoiceBatchGenerator.generateFacturas(
        EVENT_BATCH_SIZE,
        customers,
        products,
        testCompany,
        nextNumber(),
        (p) => {
          // Generator-side progress 0→35% (leave room for the send phase).
          setContingencyProgress(Math.round(5 + Math.min(30, p.percentage * 0.3)));
        },
      );
    } catch (err) {
      setContingencyStatus(ProcessingStatus.Error);
      const reason = `Error al generar facturas para contingencia: ${(err as Error)?.message ?? err}`;
      record({ batch: 'contingencia', stage: 'generacion', message: reason });
      return { sent: 0, failed: EVENT_BATCH_SIZE, firstFailure: { invoiceNumber: 'contingencia', reason } };
    }

    // Pre-flight credentials — same pattern as sendInvoices. Test secrets:
    // homologation never uses the production certificate or password.
    const stored = await SecureStorageService.getCredentials(testCompany.nit, HOMOLOGATION_IS_PRODUCTION);
    const certPassword = await SecureStorageService.getCertificatePassword(testCompany.nit, HOMOLOGATION_IS_PRODUCTION);
    if (!stored?.password || !certPassword) {
      setContingencyStatus(ProcessingStatus.Error);
      record({ batch: 'contingencia', stage: 'credenciales', message: 'Credenciales o contraseña del certificado no configuradas.' });
      return {
        sent: 0,
        failed: EVENT_BATCH_SIZE,
        firstFailure: {
          invoiceNumber: 'contingencia',
          reason: 'Credenciales o contraseña del certificado no configuradas.',
        },
      };
    }

    // Homologation always targets MH test (ambiente=00).
    const apiConfig = getApiConfig(HOMOLOGATION_IS_PRODUCTION);
    const environmentCode = apiConfig.environmentCode;

    // Lite-mode parity: sign locally + POST directly to MH's /fesv/contingencia/
    // instead of routing through the .NET backend's /document/contingencia/report.
    // This mirrors `MHDirectClient.sendContingencyRequest` from the iOS Swift app.
    const mhClient = getMhClient(HOMOLOGATION_IS_PRODUCTION);
    const signerService = getSignerService();
    const nitDigits = (testCompany.nit ?? '').replace(/\D/g, '');

    setContingencyStatus(ProcessingStatus.Sending);
    setContingencyProgress(35);

    // Send one contingency report per invoice (MH homologation requires each
    // invoice to be reported individually as a separate contingency event).
    let sent = 0;
    let failed = 0;
    let firstFailure: { invoiceNumber: string; reason: string } | null = null;

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 60 * 60 * 1000);
      // CAT-005 type 1 = "No disponibilidad del sistema del MH".
      const request = DTEMappingService.mapContingenciaRequest(
        [candidate],
        testCompany,
        environmentCode,
        startDate,
        endDate,
        1,
        'Prueba de homologación — Sistema de MH no disponible durante el período.',
        testCompany.nombreComercial || testCompany.nombre || 'Responsable',
        // MH expects 9 digits (no dash). We use a placeholder since the
        // responsible person's DUI is not known at homologation time.
        '000000000',
      );

      try {
        // Sanitize undefined keys (matches DTE-submission flow), serialize,
        // sign with the company's RSA key, then POST to MH directly.
        const sanitized = deepOmitUndefinedEnhanced(request) as typeof request;
        const dteJson = JSON.stringify(sanitized);
        const signed = await signerService.signAsync({
          nit: nitDigits,
          passwordPri: certPassword,
          dteJson,
          isProduction: HOMOLOGATION_IS_PRODUCTION,
        });
        if (signed.status !== 'OK' || !signed.body) {
          throw new Error('Error al firmar la solicitud de contingencia.');
        }

        const mhResponse = await mhClient.submitContingency(
          {
            ambiente: request.identificacion.ambiente,
            // MH accepts any positive integer here. The iOS Lite client
            // uses idEnvio="1" verbatim — we send 1 to match.
            idEnvio: 1,
            version: request.identificacion.version,
            tipoDte: 'contingencia',
            codigoGeneracion: null,
            documento: signed.body,
          },
          {
            userName: stored.user || nitDigits,
            password: stored.password,
          },
        );

        if (mhResponse.estado === 'PROCESADO' || mhResponse.estado === 'RECIBIDO') {
          console.info(
            `[prod-access] contingencia ${i + 1}/${candidates.length} ${mhResponse.estado} sello=${mhResponse.selloRecibido ?? '—'}`,
          );
          sent++;
        } else {
          const detail = mhResponse.observaciones?.length
            ? mhResponse.observaciones.slice(0, 3).join(' · ')
            : mhResponse.descripcionMsg || (mhResponse as MhResponse).mensaje || 'Error desconocido';
          // Idempotency guard: reruns may hit "codigo generacion ya existe"
          // for contingency reports that MH already accepted previously.
          if (/ya existe/i.test(detail) && /codigo generacion/i.test(detail)) {
            sent++;
          } else {
            const reason = mhResponse.codigoMsg ? `[${mhResponse.codigoMsg}] ${detail}` : detail;
            throw new Error(reason);
          }
        }
      } catch (err) {
        console.error(`submitContingencyBatch: invoice ${candidate.invoiceNumber} failed:`, err);
        failed++;
        const reason = err instanceof Error ? err.message : 'Error desconocido';
        record({
          batch: 'contingencia',
          stage: 'contingencia',
          documentNumber: candidate.invoiceNumber,
          controlNumber: candidate.controlNumber,
          message: `Solicitud ${i + 1}/${candidates.length}: ${reason}`,
        });
        if (!firstFailure) firstFailure = { invoiceNumber: candidate.invoiceNumber || 'contingencia', reason };
      }

      setContingencyProgress(35 + ((i + 1) / candidates.length) * 65);
    }

    if (failed > 0) {
      setContingencyStatus(ProcessingStatus.Error);
      return { sent, failed, firstFailure };
    }

    setContingencyProgress(100);
    setContingencyStatus(ProcessingStatus.Completed);
    return { sent, failed, firstFailure: null };
  }

  // ── Invalidation test batch (homologation) ───────────────────────────────
  // Port of iOS `processInvalidationsWithProgress`: generate 5 fresh Facturas,
  // submit them to MH so each receives a selloRecibido (invalidation requires
  // an accepted DTE), then invalidate each one via /fesv/anulardte with
  // tipoAnulacion=2 ("Rescindir de la operación realizada"). Unlike the old
  // best-effort invalidation that used to ride along with contingencia,
  // failures here are fatal for the homologation — matching the Swift app.
  const setInvalidacionStatus = useCallback((s: ProcessingStatus) => {
    setStatus((prev) => ({ ...prev, invalidacion: s }));
  }, []);
  const setInvalidacionProgress = useCallback((pct: number) => {
    setProgress((prev) => ({ ...prev, invalidacion: pct }));
  }, []);

  async function submitInvalidationBatch(testCompany: Company): Promise<SubmitOutcome> {
    setInvalidacionStatus(ProcessingStatus.Generating);
    setInvalidacionProgress(2);

    // Pre-flight credentials — same pattern as submitContingencyBatch.
    const stored = await SecureStorageService.getCredentials(testCompany.nit, HOMOLOGATION_IS_PRODUCTION);
    const certPassword = await SecureStorageService.getCertificatePassword(testCompany.nit, HOMOLOGATION_IS_PRODUCTION);
    if (!stored?.password || !certPassword) {
      setInvalidacionStatus(ProcessingStatus.Error);
      record({ batch: 'invalidacion', stage: 'credenciales', message: 'Credenciales o contraseña del certificado no configuradas.' });
      return {
        sent: 0,
        failed: EVENT_BATCH_SIZE,
        firstFailure: {
          invoiceNumber: 'invalidacion',
          reason: 'Credenciales o contraseña del certificado no configuradas.',
        },
      };
    }

    // Phase 1 — generate 5 fresh facturas (0→25%).
    const [customers, products] = prepareTestData();
    let facturas: Invoice[];
    try {
      facturas = await InvoiceBatchGenerator.generateFacturas(
        EVENT_BATCH_SIZE,
        customers,
        products,
        testCompany,
        nextNumber(),
        (p) => setInvalidacionProgress(2 + p.percentage * 0.23),
      );
      dispatch(addInvoices(facturas));
      generatedRef.current.push(...facturas);
    } catch (err) {
      console.error('Error generating invalidación batch facturas:', err);
      setInvalidacionStatus(ProcessingStatus.Error);
      record({
        batch: 'invalidacion',
        stage: 'generacion',
        message: `Error al generar facturas para invalidación: ${(err as Error)?.message ?? err}`,
      });
      return {
        sent: 0,
        failed: EVENT_BATCH_SIZE,
        firstFailure: { invoiceNumber: 'invalidacion', reason: (err as Error)?.message ?? String(err) },
      };
    }

    // Phase 2 — submit them to MH under this row's status (25→60%). Each
    // accepted factura receives a selloRecibido, which the invalidation
    // event must echo back.
    const submitResult = await submitTypeBatch(InvoiceType.Factura, facturas, testCompany, {
      statusKey: 'invalidacion',
      progressFrom: 25,
      progressTo: 60,
    });
    if (submitResult.failed > 0) {
      // The rejected facturas were recorded by submitTypeBatch under this row.
      setInvalidacionStatus(ProcessingStatus.Error);
      record({
        batch: 'invalidacion',
        stage: 'invalidacion',
        message: 'Las facturas a invalidar no fueron aceptadas por Hacienda; la fase de invalidación se canceló.',
      });
      // Nothing was invalidated — report the whole event batch as failed.
      return { sent: 0, failed: EVENT_BATCH_SIZE, firstFailure: submitResult.firstFailure };
    }

    // Phase 3 — invalidate each accepted factura (60→100%). Fatal on failure.
    setInvalidacionStatus(ProcessingStatus.Sending);
    const invalidationService = new InvoiceInvalidationService(HOMOLOGATION_IS_PRODUCTION);
    const accepted = generatedRef.current.filter(
      (inv) => facturas.some((f) => f.id === inv.id) && inv.status === InvoiceStatus.Completada,
    );
    let failed = 0;
    let firstFailure: { invoiceNumber: string; reason: string } | null = null;

    for (let i = 0; i < accepted.length; i++) {
      const invoice = accepted[i];
      try {
        const result = await invalidationService.invalidateInvoice(invoice, testCompany, {
          // tipoAnulacion=2 — "Rescindir de la operación realizada"; schema v3
          // accepts it without a replacement codigoGeneracionR.
          reason: InvalidationReason.ProductReturn,
          responsibleName: testCompany.nombreComercial || testCompany.nombre || 'Responsable',
          // Placeholder responsable DUI in MH-required NNNNNNNN-N format.
          // 9 digits without the hyphen (e.g. "000000000") fails MH's
          // tipDocResponsable=13 regex.
          responsibleDocument: '00000000-0',
        });
        if (!result.success) {
          throw new Error(result.message || 'Error desconocido al invalidar');
        }
        // Mark locally so re-runs skip invoices MH already invalidated
        // (canInvalidateInvoice rejects invalidatedViaApi).
        const updated = { ...invoice, invalidatedViaApi: true };
        dispatch(updateInvoice(updated));
        const idx = generatedRef.current.findIndex((inv) => inv.id === invoice.id);
        if (idx >= 0) generatedRef.current[idx] = updated;
      } catch (err) {
        console.error(`submitInvalidationBatch: invoice ${invoice.invoiceNumber} failed:`, err);
        failed += 1;
        const reason = err instanceof Error ? err.message : 'Error desconocido';
        record({
          batch: 'invalidacion',
          stage: 'invalidacion',
          documentNumber: invoice.invoiceNumber,
          controlNumber: invoice.controlNumber,
          message: `Invalidación ${i + 1}/${accepted.length}: ${reason}`,
        });
        if (!firstFailure) {
          firstFailure = { invoiceNumber: invoice.invoiceNumber || 'invalidacion', reason };
        }
      }
      setInvalidacionProgress(60 + ((i + 1) / accepted.length) * 40);
    }

    if (failed > 0) {
      setInvalidacionStatus(ProcessingStatus.Error);
      return { sent: accepted.length - failed, failed, firstFailure };
    }

    setInvalidacionProgress(100);
    setInvalidacionStatus(ProcessingStatus.Completed);
    return { sent: EVENT_BATCH_SIZE, failed: 0, firstFailure: null };
  }

  // ── Send all generated invoices to Hacienda ───────────────────────────────
  // Bulk re-send for the "Enviar lo generado" button. Groups generatedRef by
  // type so each type's progress bar reflects its actual MH submission status.

  // ── Pre-flight verification ─────────────────────────────────────────────
  // Runs before a single document is generated. Every check runs so the user
  // sees all problems at once; returns true when the batch may proceed.
  const runPreflight = useCallback(async (): Promise<boolean> => {
    // Everything here is checked against the TEST environment — the one the
    // run submits to (see HOMOLOGATION_IS_PRODUCTION).
    const nit = company.nit ?? '';
    const nitDigits = nit.replace(/\D/g, '');
    setPreflight({
      configuration: { status: 'ok' },
      certificate: { status: 'checking' },
      certificatePassword: { status: 'checking' },
      credentials: { status: 'checking' },
    });

    // 1. Certificate password (stored hash used for signing).
    const certPassword = await SecureStorageService.getCertificatePassword(nit, HOMOLOGATION_IS_PRODUCTION);
    const certificatePassword: PreflightCheck = certPassword
      ? { status: 'ok', message: 'Contraseña guardada en el llavero.' }
      : { status: 'error', message: 'No se encontró la contraseña del certificado. Guárdala en Editar Configuración.' };

    // 2. Signing certificate — validated, then a probe payload signed through
    //    the same SignerService path real DTEs use (digits-only NIT).
    let certificate: PreflightCheck;
    // Same test escape hatch SignerService honours: E2E seeds a placeholder
    // certificate and mocks signing, so only its presence is checked here.
    const mockSigner = (() => {
      try {
        return typeof localStorage !== 'undefined' && localStorage.getItem('__mock_signer') === 'true';
      } catch {
        return false;
      }
    })();
    try {
      const validation = mockSigner
        ? (await SecureStorageService.getCertificateData(nit, HOMOLOGATION_IS_PRODUCTION))
          ? { valid: true as const }
          : { valid: false as const, error: 'No hay certificado almacenado para esta empresa.' }
        : await CertificateService.validateCertificate(nit, HOMOLOGATION_IS_PRODUCTION);
      if (!validation.valid) {
        certificate = { status: 'error', message: validation.error ?? 'El certificado no es válido.' };
      } else if (!certPassword) {
        certificate = { status: 'error', message: 'Sin la contraseña del certificado no se puede firmar.' };
      } else {
        if (!mockSigner) await CertificateService.restoreCertificate(nit, HOMOLOGATION_IS_PRODUCTION);
        const probe = await getSignerService().signAsync({
          nit: nitDigits,
          passwordPri: certPassword,
          dteJson: JSON.stringify({ verificacion: 'firma-previa', nit: nitDigits, fecha: new Date().toISOString() }),
          isProduction: HOMOLOGATION_IS_PRODUCTION,
        });
        certificate = probe.status === 'OK' && probe.body
          ? { status: 'ok', message: 'Certificado válido: firma de prueba generada correctamente.' }
          : { status: 'error', message: 'El certificado no pudo firmar un documento de prueba.' };
      }
    } catch (err) {
      certificate = {
        status: 'error',
        message: `No se pudo firmar con el certificado: ${(err as Error)?.message ?? err}`,
      };
    }
    setPreflight((prev) => ({ ...prev, certificate, certificatePassword }));

    // 3. Hacienda credentials, validated DIRECTLY against MH (homologation
    //    always targets the test environment), with the same user the DTE
    //    submissions authenticate with.
    let credentials: PreflightCheck;
    try {
      const stored = await SecureStorageService.getCredentials(nit, HOMOLOGATION_IS_PRODUCTION);
      if (!stored?.password) {
        credentials = {
          status: 'error',
          message: 'No se encontraron las credenciales de Hacienda. Configúralas en Credenciales API.',
        };
      } else {
        const outcome = await getMhClient(HOMOLOGATION_IS_PRODUCTION).validateCredentials({
          userName: stored.user || nitDigits,
          password: stored.password,
        });
        const code = outcome.statusCode;
        if (outcome.valid) {
          credentials = { status: 'ok', message: `Hacienda aceptó las credenciales (usuario ${stored.user || nitDigits}).` };
        } else if (code === 400 || code === 401 || code === 403 || (code !== undefined && code >= 200 && code < 300)) {
          credentials = {
            status: 'error',
            message: 'Hacienda rechazó el usuario o la contraseña. Verifícalos en el portal de Hacienda.',
          };
        } else {
          credentials = {
            status: 'error',
            message: `No se pudo contactar la API de Hacienda${code && code > 0 ? ` (HTTP ${code})` : ''}. Revisa tu conexión e intenta de nuevo.`,
          };
        }
      }
    } catch (err) {
      credentials = { status: 'error', message: `No se pudo validar con Hacienda: ${(err as Error)?.message ?? err}` };
    }
    setPreflight((prev) => ({ ...prev, credentials }));

    const checks: Array<[IssueStage, PreflightCheck]> = [
      ['certificado', certificate],
      ['certificado', certificatePassword],
      ['credenciales', credentials],
    ];
    if (issuesRef.current) {
      for (const [stage, check] of checks) {
        if (check.status === 'error') {
          issuesRef.current.push({ batch: 'preflight', stage, message: check.message ?? 'Error' });
        }
      }
    }
    return checks.every(([, check]) => check.status === 'ok');
  }, [company]);

  /** Test-environment copy of the company with the emisor sanitized for MH. */
  const buildTestCompany = (): Company => {
    // Homologation submissions always target MH test (ambiente=00), whatever
    // the company's own environment. Empty or invalid descActividad /
    // tipoEstablecimiento / direccion fields are substituted with known-good
    // defaults so homologation isn't blocked.
    const sanitized = sanitizeCompanyForEmisor(company);
    if (sanitized.warnings.length > 0) {
      console.warn('[ProductionAccess] Emisor sanitized for homologation:', sanitized.warnings);
      record({
        batch: 'preflight',
        stage: 'configuracion',
        severity: 'info',
        message: `Algunos campos del emisor se sustituyeron con valores válidos para homologación: ${sanitized.warnings.length} ajuste(s). Revisa la configuración de la empresa para usarla en producción.`,
      });
    }
    return homologationCompany(sanitized.company);
  };

  const labelOf = (key: StatusKey) => KEY_ORDER.find((r) => r.key === key)?.label ?? key;

  /** Build + publish the end-of-run summary from what was collected. */
  const finishRun = (
    requested: StatusKey[],
    preflightOk: boolean,
    counts: Partial<Record<StatusKey, { total: number; accepted: number }>>,
  ): RunSummary => {
    const issues = issuesRef.current ?? [];
    issuesRef.current = null;
    const batches: BatchResult[] = requested.map((key) => {
      const ran = counts[key];
      const total = ran?.total ?? 0;
      const accepted = ran?.accepted ?? 0;
      const failed = Math.max(0, total - accepted);
      const hasError = issues.some((i) => i.batch === key && i.severity !== 'info');
      let batchStatus: ProcessingStatus;
      if (!preflightOk) batchStatus = ProcessingStatus.NotStarted;
      else if (failed > 0 || hasError) batchStatus = ProcessingStatus.Error;
      // A requested batch that never produced documents (the run aborted
      // before reaching it) was NOT sent — never report it as accepted.
      else if (!ran || total === 0) batchStatus = ProcessingStatus.NotStarted;
      else batchStatus = ProcessingStatus.Completed;
      return { key, label: labelOf(key), total, accepted, failed, status: batchStatus };
    });
    const summary: RunSummary = {
      ok:
        preflightOk &&
        batches.length > 0 &&
        issues.every((i) => i.severity === 'info') &&
        batches.every((b) => b.status === ProcessingStatus.Completed),
      preflightFailed: !preflightOk,
      batches,
      issues,
      finishedAt: new Date().toISOString(),
    };
    setAcceptedThisSession((prev) => {
      const next = { ...prev };
      for (const b of batches) next[b.key] = (next[b.key] ?? 0) + b.accepted;
      return next;
    });
    setPendingResend(generatedRef.current.filter((inv) => inv.status !== InvoiceStatus.Completada).length);
    setRunSummary(summary);
    return summary;
  };

  /** Accepted / total among the given invoice ids (as of this run). */
  const countAccepted = (ids: string[]) => ({
    total: ids.length,
    accepted: ids.filter(
      (id) => generatedRef.current.find((inv) => inv.id === id)?.status === InvoiceStatus.Completada,
    ).length,
  });

  const eventCounts = (outcome: SubmitOutcome | undefined) =>
    outcome ? { total: EVENT_BATCH_SIZE, accepted: Math.min(EVENT_BATCH_SIZE, outcome.sent) } : undefined;

  /** The documents a batch is judged by: its own type, never helper parents. */
  const ownDocumentIds = (docs: Invoice[], type: InvoiceType) =>
    docs.filter((inv) => inv.invoiceType === type && !inv.isHelperForCreditNote).map((inv) => inv.id);

  const startRun = () => {
    issuesRef.current = [];
    identifierRemapRef.current = { uuid: new Map(), controlNumber: new Map() };
    setRunSummary(null);
    setHasCompleted(false);
  };

  // ── Resend what the last run could not get accepted ───────────────────────
  // "Reenviar pendientes": resubmits this session's generated documents that
  // MH has not accepted yet (already-accepted ones are skipped inside
  // submitTypeBatch), grouped by type so parents go before dependents.

  const sendInvoices = async (): Promise<boolean> => {
    if (!generatedRef.current.some((inv) => inv.status !== InvoiceStatus.Completada)) {
      notify('info', 'No hay documentos pendientes de envío en esta sesión.');
      return false;
    }
    startRun();
    setIsProcessing(true);
    const submissionOrder: InvoiceType[] = [
      InvoiceType.Factura,
      InvoiceType.CCF,
      InvoiceType.SujetoExcluido,
      InvoiceType.FacturaExportacion,
      InvoiceType.ComprobanteDonacion,
      InvoiceType.NotaCredito,
      InvoiceType.NotaDebito,
      InvoiceType.NotaRemision,
      InvoiceType.ComprobanteLiquidacion,
      InvoiceType.ComprobanteRetencion,
      InvoiceType.DocumentoContableLiquidacion,
    ];
    const requested: StatusKey[] = [];
    const idsByKey: Partial<Record<StatusKey, string[]>> = {};
    let preflightOk = false;
    try {
      preflightOk = await runPreflight();
      if (!preflightOk) return false;
      const testCompany = buildTestCompany();
      const pending = generatedRef.current.filter((inv) => inv.status !== InvoiceStatus.Completada);
      let totalSent = 0;
      for (const t of submissionOrder) {
        const batchForType = pending.filter((inv) => inv.invoiceType === t);
        if (batchForType.length === 0) continue;
        const key = TYPE_TO_KEY[t];
        if (key) {
          if (!requested.includes(key)) requested.push(key);
          idsByKey[key] = [...(idsByKey[key] ?? []), ...batchForType.map((inv) => inv.id)];
        }
        const r = await submitTypeBatch(t, batchForType, testCompany);
        totalSent += r.sent;
        setProgress((prev) => ({ ...prev, overall: (totalSent / pending.length) * 100 }));
      }
      return true;
    } catch (err) {
      console.error('sendInvoices error:', err);
      issuesRef.current?.push({
        batch: 'preflight',
        stage: 'envio',
        message: `Error al enviar: ${(err as Error)?.message ?? err}`,
      });
      return false;
    } finally {
      const counts: Partial<Record<StatusKey, { total: number; accepted: number }>> = {};
      for (const key of requested) counts[key] = countAccepted(idsByKey[key] ?? []);
      finishRun(requested, preflightOk, counts);
      setIsProcessing(false);
    }
  };

  // ── Orchestration ─────────────────────────────────────────────────────────

  /**
   * Generate + submit a fresh batch for every selected row (or for `keys`,
   * e.g. "Reintentar lotes con errores"), then the selected event batches.
   */
  const processAllDocuments = async (keys?: StatusKey[]) => {
    const selection = new Set(keys ?? selectedKeys);
    // Per-type generator + invoice type. Order matters: independents first
    // (Factura, CCF, SE, FE, Donación) so dependents (NC/ND/NR/CL/CR/DCL)
    // can reference parents that are already MH-Completada.
    const generators: Array<{ key: StatusKey; type: InvoiceType; run: () => Promise<boolean> }> = [
      { key: 'factura', type: InvoiceType.Factura, run: generateFacturas },
      { key: 'ccf', type: InvoiceType.CCF, run: generateCreditosFiscales },
      { key: 'sujetoExcluido', type: InvoiceType.SujetoExcluido, run: generateSujetoExcluido },
      { key: 'facturaExportacion', type: InvoiceType.FacturaExportacion, run: generateFacturaExportacion },
      { key: 'comprobanteDonacion', type: InvoiceType.ComprobanteDonacion, run: generateComprobanteDonacion },
      { key: 'notaCredito', type: InvoiceType.NotaCredito, run: generateCreditNotes },
      { key: 'notaDebito', type: InvoiceType.NotaDebito, run: generateDebitNotes },
      { key: 'notaRemision', type: InvoiceType.NotaRemision, run: generateNotaRemision },
      { key: 'comprobanteLiquidacion', type: InvoiceType.ComprobanteLiquidacion, run: generateComprobanteLiquidacion },
      { key: 'comprobanteRetencion', type: InvoiceType.ComprobanteRetencion, run: generateComprobanteRetencion },
      { key: 'documentoContable', type: InvoiceType.DocumentoContableLiquidacion, run: generateDocumentoContable },
    ];

    const toRun = generators.filter((g) => selection.has(g.key));
    const runContingencia = selection.has('contingencia');
    const runInvalidacion = selection.has('invalidacion');
    if (toRun.length === 0 && !runContingencia && !runInvalidacion) {
      notify('error', 'Selecciona al menos un lote para enviar.');
      return;
    }
    if (keys) setSelectedKeys(selection);
    const requested: StatusKey[] = [
      ...toRun.map((g) => g.key),
      ...(runContingencia ? (['contingencia'] as StatusKey[]) : []),
      ...(runInvalidacion ? (['invalidacion'] as StatusKey[]) : []),
    ];

    startRun();
    // A new run starts from a clean slate: the previous run's documents are
    // either accepted or can be resent with "Reenviar pendientes" first.
    generatedRef.current = [];
    setIsProcessingAll(true);
    setIsProcessing(true);
    setStatus((prev) => {
      const next = { ...prev };
      for (const key of requested) next[key] = ProcessingStatus.NotStarted;
      return next;
    });
    setProgress((prev) => {
      const next = { ...prev, overall: 0 };
      for (const key of requested) next[key] = 0;
      return next;
    });

    const idsByKey: Partial<Record<StatusKey, string[]>> = {};
    const events: Partial<Record<StatusKey, SubmitOutcome>> = {};
    let preflightOk = false;

    try {
      // 1 + 2: certificate, then MH credentials — nothing is generated when
      // either fails.
      preflightOk = await runPreflight();
      if (preflightOk) {
        const testCompany = buildTestCompany();

        // Pause redux-persist for the duration of the batch — every dispatch
        // would otherwise force a full-state IPC write to Electron's
        // appStorage, which compounds to multi-minute hangs once the store
        // grows past ~30 invoices. Flushed once in `finally`.
        persistor.pause();

        let totalSent = 0;
        for (const g of toRun) {
          // Phase 1: generate this type's batch (per-type progress 0→50%)
          const beforeLen = generatedRef.current.length;
          const ok = await g.run();
          if (!ok) continue;
          const newInvoices = generatedRef.current.slice(beforeLen);
          idsByKey[g.key] = ownDocumentIds(newInvoices, g.type);

          // Phase 2: submit this type's batch (50→100% + final status).
          // Helpers come first so MH sees parents before dependents.
          const r = await submitTypeBatch(g.type, newInvoices, testCompany);
          totalSent += r.sent;
          const totalDocs = generatedRef.current.length;
          if (totalDocs > 0) {
            setProgress((prev) => ({ ...prev, overall: (totalSent / totalDocs) * 100 }));
          }
        }

        // Event batches (iOS priorities 9 and 10). They generate their own
        // facturas, so a selected event batch runs even when a DTE batch
        // failed — the user may be sending ONLY the invalidation events.
        if (runContingencia) events.contingencia = await submitContingencyBatch(testCompany);
        if (runInvalidacion) events.invalidacion = await submitInvalidationBatch(testCompany);
      }
    } catch (err) {
      console.error('processAllDocuments error:', err);
      issuesRef.current?.push({
        batch: 'preflight',
        stage: 'envio',
        message: `Error al procesar documentos: ${(err as Error)?.message ?? err}`,
      });
    } finally {
      if (preflightOk) {
        persistor.persist();
        try {
          await persistor.flush();
        } catch (e) {
          console.warn('persistor.flush failed:', e);
        }
      }
    }

    const counts: Partial<Record<StatusKey, { total: number; accepted: number }>> = {};
    for (const key of requested) {
      const c = isEventKey(key)
        ? eventCounts(events[key])
        : idsByKey[key]
          ? countAccepted(idsByKey[key]!)
          : undefined;
      if (c) counts[key] = c;
    }
    const summary = finishRun(requested, preflightOk, counts);
    setIsProcessingAll(false);
    setIsProcessing(false);

    if (summary.ok) {
      setHasCompleted(true);
      // Mirrors iOS `validateProductionAccount` — after homologation
      // succeeds, clone the test company into a fresh Production-mode
      // company. The thunk handles dedup (reuses an existing prod company
      // for the same NIT) and selects it. Certificate + credentials are
      // intentionally cleared so the user sets prod secrets explicitly.
      try {
        const result = await dispatch(promoteToProduction(company.id)).unwrap();
        if (result.kind === 'created') {
          notify(
            'success',
            `Empresa de producción creada (${result.company.nombreComercial || result.company.nombre}). Configura el certificado + credenciales de producción para empezar a emitir DTEs.`,
          );
        } else {
          notify('info', 'Ya existía una empresa de producción para este NIT — fue seleccionada como activa.');
        }
      } catch (err) {
        console.warn('promoteToProduction after homologation failed:', err);
        notify(
          'error',
          `Homologación completada pero no pudimos crear la empresa de producción automáticamente: ${(err as Error)?.message ?? err}. Promueve manualmente desde Editar Configuración.`,
        );
      }
    }
  };

  /** Batches of the last run that did not end accepted. */
  const failedKeys = (runSummary?.batches ?? [])
    .filter((b) => b.status !== ProcessingStatus.Completed)
    .map((b) => b.key);

  const clearRunSummary = useCallback(() => setRunSummary(null), []);

  return {
    batchOptions,
    batchSize,
    setBatchSize,
    isProcessing,
    isProcessingAll,
    hasCompleted,
    progress,
    status,
    processedTypes,
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
    clearRunSummary,
  };
}

export default useRequestProductionAccess;
