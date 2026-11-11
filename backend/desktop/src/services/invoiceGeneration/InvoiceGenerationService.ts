// InvoiceGenerationService — Desktop DTE lifecycle orchestrator
// Orchestrates: build → sign → submit → track for all DTE types.
// Mirrors the RN sync flow but runs fully local (local signing, direct MH API).

import { Invoice, InvoiceType, InvoiceStatus } from '@/types/invoice';
import { Company, CompanyEnvironment } from '@/types/company';
import { DTEMappingService, NORMATIVA_2_SCHEMA_VERSIONS } from '@/services/dte/DTEMappingService';
import {
  sanitizeCompanyForEmisor,
  sanitizeCustomerForReceptor,
} from '@/services/dte/CompanyEmisorSanitizer';
import { getSignerService } from '@/services/signing/SignerService';
import { getMhClient } from '@/services/api/MhClient';
import { SecureStorageService } from '@/services/security/SecureStorageService';
import { SyncLogger } from '@/services/api/SyncLogger';
import { InvoiceStatusTracker, TrackingStatus } from '@/services/tracking/InvoiceStatusTracker';
import type { DTEEventSubmitParams, DTESubmitParams } from '@/services/api/MhClient.types';
import { deepOmitUndefinedEnhanced } from '@/utils/dteMapper';

// ─── Result & payload types ───────────────────────────────────────────────────

export interface GenerationResult {
  success: boolean;
  /** Updated invoice with controlNumber, generationCode, receptionSeal, status */
  invoice?: Invoice;
  error?: string;
  mhResponse?: unknown;
}

export interface DTEPayload {
  identificacion: Record<string, unknown>;
  emisor: Record<string, unknown>;
  receptor: Record<string, unknown> | null;
  cuerpoDocumento: Record<string, unknown>[];
  resumen: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SignedDTE {
  payload: DTEPayload;
  signature: string;
  /** Full JWS RS512 compact token ready for MH submission */
  signedJson: string;
}

// ─── DTE version map (mirrors .NET VersionMapper) ────────────────────────────

const DTE_VERSION: Record<string, number> = {
  '01': NORMATIVA_2_SCHEMA_VERSIONS['01'],
  '03': NORMATIVA_2_SCHEMA_VERSIONS['03'],
  '04': NORMATIVA_2_SCHEMA_VERSIONS['04'],
  '05': NORMATIVA_2_SCHEMA_VERSIONS['05'],
  '06': NORMATIVA_2_SCHEMA_VERSIONS['06'],
  '07': NORMATIVA_2_SCHEMA_VERSIONS['07'],
  '08': NORMATIVA_2_SCHEMA_VERSIONS['08'],
  '09': NORMATIVA_2_SCHEMA_VERSIONS['09'],
  '11': NORMATIVA_2_SCHEMA_VERSIONS['11'],
  '14': NORMATIVA_2_SCHEMA_VERSIONS['14'],
  '15': NORMATIVA_2_SCHEMA_VERSIONS['15'],
  '17': NORMATIVA_2_SCHEMA_VERSIONS['17'],
  '18': NORMATIVA_2_SCHEMA_VERSIONS['18'],
};

// ─── Environment code helper ──────────────────────────────────────────────────

function resolveEnvironmentCode(
  environment: 'development' | 'production' | 'contingency',
  company: Company
): string {
  if (environment === 'production') return '01';
  if (environment === 'contingency') return '00'; // contingency still uses test channel
  // 'development' — honour company flag
  return company.environment === CompanyEnvironment.Production ? '01' : '00';
}

// ─── Control number format: DTE-{tipo}-{establecimiento}{puntoVenta}-{seq15} ──

export class InvoiceGenerationService {
  /**
   * Generate a UUID v4 codigo de generacion.
   */
  static generateCodigoGeneracion(): string {
    return crypto.randomUUID().toUpperCase();
  }

  /**
   * Generate a control number matching MH format:
   * DTE-{tipoDTE}-{codEstableMH}{codPuntoVentaMH}-{sequence15digits}
   */
  static generateControlNumber(
    invoiceType: InvoiceType,
    sequence: number,
    company?: Company
  ): string {
    const tipoMap: Record<number, string> = {
      [InvoiceType.Factura]: '01',
      [InvoiceType.CCF]: '03',
      [InvoiceType.NotaRemision]: '04',
      [InvoiceType.NotaCredito]: '05',
      [InvoiceType.NotaDebito]: '06',
      [InvoiceType.ComprobanteRetencion]: '07',
      [InvoiceType.ComprobanteLiquidacion]: '08',
      [InvoiceType.DocumentoContableLiquidacion]: '09',
      [InvoiceType.FacturaExportacion]: '11',
      [InvoiceType.SujetoExcluido]: '14',
      [InvoiceType.ComprobanteDonacion]: '15',
      [InvoiceType.EventoOperacionesEspeciales]: '17',
      [InvoiceType.EventoRetorno]: '18',
    };

    const tipo = tipoMap[invoiceType] ?? '01';
    const estable = company?.codEstableMH ?? 'M001';
    const puntoVenta = company?.codPuntoVentaMH ?? 'P001';
    const seq = String(sequence).padStart(15, '0');

    return `DTE-${tipo}-${estable}${puntoVenta}-${seq}`;
  }

  // ─── Pre-step: enrich identifiers ──────────────────────────────────────────

  /**
   * Stamp a freshly generated `codigoGeneracion` (UUID) and `controlNumber`
   * (`DTE-XX-…-NNNN…`) onto the invoice if it doesn't already have ones in
   * the MH-required formats. Both single-invoice (`DTESubmissionModal`) and
   * batch (`useRequestProductionAccess`) paths must share this enrichment —
   * MH validates `numeroControl` against `^DTE-\d{2}-[A-Z0-9]{8}-\d{15}$` and
   * `codigoGeneracion` as a UUID, so user-form values like "INV-1234…" or a
   * raw 5-digit sequence fail schema validation.
   *
   * Idempotent: if the invoice already has a valid-looking controlNumber +
   * UUID generationCode, it's returned unchanged.
   */
  static enrichForSubmission(
    invoice: Invoice,
    company: Company,
    options?: { forceRegenerate?: boolean; explicitSequence?: number },
  ): Invoice {
    const force = options?.forceRegenerate ?? false;
    const VALID_CN = /^DTE-\d{2}-[A-Z0-9]{8}-\d{15}$/;
    const VALID_UUID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;

    const hasValidControlNumber =
      !force && !!invoice.controlNumber && VALID_CN.test(invoice.controlNumber);
    const hasValidGenerationCode =
      !force && !!invoice.generationCode && VALID_UUID.test(invoice.generationCode);

    // Preserve existing valid identifiers — critical for parent-dependent
    // chains in the production-access batch. Each helper CCF is created with
    // its own UUID generationCode by `generateSingleInvoice`, and the
    // dependent NC/ND/CR's `relatedDocumentNumber` is stamped with that UUID.
    // Regenerating the helper's UUID at submission time breaks the link and
    // MH rejects "[documentoRelacionado.numeroDocumento] NO EXISTE UN
    // REGISTRO CON ESTE DATO" because the dependent points at a UUID MH
    // never received.
    // `forceRegenerate` skips this short-circuit — used by the modal's
    // 004-retry path to mint a brand-new numeroControl after MH rejected
    // the prior one with "YA EXISTE UN REGISTRO".
    if (hasValidControlNumber && hasValidGenerationCode) {
      return invoice.invoiceNumber === invoice.controlNumber
        ? invoice
        : { ...invoice, invoiceNumber: invoice.controlNumber! };
    }

    // No valid identifiers (typical for a user-created invoice from
    // AddInvoicePage). Stamp fresh ones.
    const codigoGeneracion = hasValidGenerationCode
      ? invoice.generationCode!
      : InvoiceGenerationService.generateCodigoGeneracion();

    let controlNumber: string;
    if (hasValidControlNumber) {
      controlNumber = invoice.controlNumber!;
    } else {
      // Sequence priority:
      //   1. `options.explicitSequence` — caller-supplied (e.g. user-readable
      //      sequential number from `company.nextSequenceNumber`).
      //   2. Time-derived 15-digit fallback — guarantees uniqueness across
      //      concurrent and cross-run submissions when no counter is provided.
      let sequence: number;
      if (options?.explicitSequence !== undefined) {
        sequence = options.explicitSequence;
      } else {
        const timePart = Date.now() % 10_000_000_000; // 10 digits
        const randBytes = new Uint8Array(3);
        crypto.getRandomValues(randBytes);
        const randPart = ((randBytes[0] * 65536 + randBytes[1] * 256 + randBytes[2]) % 100_000); // 5 digits
        sequence = timePart * 100_000 + randPart;
      }
      controlNumber = InvoiceGenerationService.generateControlNumber(
        invoice.invoiceType,
        sequence,
        company,
      );
    }

    return {
      ...invoice,
      invoiceNumber: controlNumber,
      generationCode: codigoGeneracion,
      controlNumber,
    };
  }

  // ─── Step 1: Build DTE payload ──────────────────────────────────────────────

  static async buildDTEPayload(
    invoice: Invoice,
    company: Company,
    environmentCode: string,
    options?: { forceRegenerate?: boolean; explicitSequence?: number },
  ): Promise<DTEPayload> {
    // Self-heal: callers that pass a raw invoice (e.g. DTESubmissionModal)
    // would otherwise produce an invalid `numeroControl` and trip MH's
    // schema validator. Re-running enrichment here is idempotent for callers
    // that already enriched (`generateAndSubmitDTE`).
    const enriched = InvoiceGenerationService.enrichForSubmission(invoice, company, options);

    // Sanitize emisor + receptor against MH's schema before mapping. Empty or
    // malformed company.descActividad / tipoEstablecimiento / direccion fields
    // (and customer phone/email/DUI/direccion) get replaced with safe MH-valid
    // defaults so the request doesn't hit MH and bounce with [096] errors.
    // Warnings are logged so the user can spot what was substituted; the
    // underlying records are NOT mutated (sanitizers return copies).
    const { company: sanitizedCompany, warnings: emisorWarnings } =
      sanitizeCompanyForEmisor(company);
    if (emisorWarnings.length > 0) {
      console.warn(
        '[InvoiceGenerationService] Emisor sanitized for MH submission:',
        emisorWarnings,
      );
    }

    // Always run the receptor sanitizer — when invoice.customer is missing
    // entirely it returns a complete MH-valid placeholder; when present it
    // back-fills any missing/invalid fields. Either way the mapper sees a
    // populated customer and never emits undefined for required receptor
    // keys.
    const { customer: sanitizedCustomer, warnings: receptorWarnings } =
      sanitizeCustomerForReceptor(enriched.customer);
    if (receptorWarnings.length > 0) {
      console.warn(
        '[InvoiceGenerationService] Receptor sanitized for MH submission:',
        receptorWarnings,
      );
    }
    const invoiceForMapping: Invoice =
      sanitizedCustomer && sanitizedCustomer !== enriched.customer
        ? { ...enriched, customer: sanitizedCustomer }
        : enriched;

    const dteBase = DTEMappingService.mapInvoice(
      invoiceForMapping,
      sanitizedCompany,
      environmentCode,
    );
    // DTEMappingService returns a DTE_Base which matches DTEPayload structure
    return dteBase as unknown as DTEPayload;
  }

  // ─── Step 2: Sign the DTE ───────────────────────────────────────────────────

  static async signDTE(
    dtePayload: DTEPayload,
    company: Company
  ): Promise<SignedDTE> {
    const nit = company.nit ?? '';
    const isProduction = company.environment === CompanyEnvironment.Production;

    // Retrieve the certificate password from secure storage
    const passwordPri = await SecureStorageService.getCertificatePassword(nit, isProduction);
    if (!passwordPri) {
      throw new Error(
        'No se encontró contraseña de certificado. Configure el certificado antes de firmar.'
      );
    }

    // Mirror InvoiceService.SyncLocal sanitization: MH rejects (400) any payload
    // that carries undefined-valued keys after JWS signing, and Facturas (tipoDte
    // 01) require `documentoRelacionado: null` to be explicitly present. Apply
    // the same transforms before stringifying for the signature.
    const sanitized = deepOmitUndefinedEnhanced(dtePayload) as DTEPayload;
    if (
      (sanitized.identificacion as Record<string, unknown> | undefined)?.tipoDte === '01' &&
      (sanitized as unknown as Record<string, unknown>).documentoRelacionado === undefined
    ) {
      (sanitized as unknown as Record<string, unknown>).documentoRelacionado = null;
    }

    const dteJson = JSON.stringify(sanitized);

    const signerService = getSignerService();
    const response = await signerService.signAsync({
      nit,
      passwordPri,
      dteJson,
      isProduction,
    });

    if (response.status !== 'OK' || !response.body) {
      throw new Error('Error al firmar el documento DTE.');
    }

    return {
      payload: sanitized,
      signature: response.body,
      signedJson: response.body,
    };
  }

  // ─── Step 3: Submit to MH ───────────────────────────────────────────────────

  /**
   * Asks MH whether this invoice's codigoGeneracion was already received
   * (/fesv/recepcion/consultadte). A transport failure (timeout, dropped
   * connection) can happen AFTER MH processed the document — re-sending under a
   * NEW codigoGeneracion would then issue a second fiscal document for the same
   * sale. Returns the sello when MH has it processed, null otherwise (including
   * when MH can't be reached — callers then retry with the SAME identifiers).
   */
  static async findProcessedOnMH(
    invoice: Invoice,
    environment: string,
    company: Company,
  ): Promise<{ selloRecibido: string; fechaTransmision?: string } | null> {
    if (!invoice.generationCode || !company.nit) return null;
    try {
      const isProduction = environment === 'production';
      const credentials = await SecureStorageService.getCredentials(company.nit, isProduction);
      if (!credentials) return null;
      const mhClient = getMhClient(isProduction);
      const response = await mhClient.searchDTE(
        {
          nitEmisor: company.nit.replace(/-/g, ''),
          tdte: invoice.documentType,
          codigoGeneracion: invoice.generationCode,
        },
        { userName: credentials.user, password: credentials.password },
      );
      if (response?.estado === 'PROCESADO' && response.selloRecibido) {
        return { selloRecibido: response.selloRecibido, fechaTransmision: response.fhProcesamiento || undefined };
      }
      return null;
    } catch {
      return null;
    }
  }

  static async submitToMH(
    signedDte: SignedDTE,
    invoice: Invoice,
    environment: string,
    company: Company
  ): Promise<import('@/services/api/MhClient.types').DTEResponse> {
    const isProduction = environment === 'production';
    const mhClient = getMhClient(isProduction);

    // Load MH credentials
    const credentials = await SecureStorageService.getCredentials(company.nit, isProduction);
    if (!credentials) {
      throw new Error(
        'No se encontraron credenciales de Hacienda. Configure las credenciales de la empresa.'
      );
    }

    const ambiente = resolveEnvironmentCode(
      environment as 'development' | 'production' | 'contingency',
      company
    );
    const tipoDte = invoice.documentType;
    const payloadIdentificacion = signedDte.payload?.identificacion ?? {};
    const payloadTipoEvento = typeof payloadIdentificacion.tipoEvento === 'string'
      ? payloadIdentificacion.tipoEvento.trim()
      : '';
    const tipoEvento = payloadTipoEvento || (tipoDte === '17' || tipoDte === '18' ? tipoDte : undefined);
    const documentOrEventType = tipoEvento ?? tipoDte;
    const version = DTE_VERSION[documentOrEventType] ?? 1;

    // MH expects idEnvio as a *positive* integer. Strip non-digits, parse to
    // int, and fall back to a time-derived sequence if the result is 0 or
    // missing. (`"TEST-0".replace(/\D/g,'')` is "0", which is truthy in JS but
    // MH rejects with "PARAMETROS NO SON VALIDOS — Faltan datos en peticion".)
    // Use the trailing 6 digits of `invoiceNumber` as the idEnvio. MH expects
    // a positive integer; anything beyond Number.MAX_SAFE_INTEGER (or roughly
    // 16 digits) gets serialized in scientific notation by JSON.stringify and
    // MH's Spring layer rejects with a generic 400 Bad Request before the
    // DTE handler ever sees it. enrichForSubmission stamps the full DTE
    // numeroControl into `invoiceNumber` so naive parseInt() of the raw
    // string explodes into 1e21.
    const allDigits = (invoice.invoiceNumber || '').replace(/\D/g, '');
    const tail = allDigits.slice(-6); // keep ≤6 digits — well within int range
    const parsed = tail ? parseInt(tail, 10) : 0;
    const numericIdEnvio =
      parsed > 0 ? parsed : Math.max(1, Math.floor(Date.now() / 1000) % 1_000_000);

    if (tipoEvento) {
      const codigoGeneracion = typeof payloadIdentificacion.codigoGeneracion === 'string'
        ? payloadIdentificacion.codigoGeneracion.trim()
        : '';
      if (!codigoGeneracion) {
        throw new Error('El evento DTE requiere código de generación antes de enviarse a Hacienda.');
      }

      const submitParams: DTEEventSubmitParams = {
        ambiente,
        idEnvio: numericIdEnvio,
        version,
        tipoEvento,
        codigoGeneracion,
        documento: signedDte.signedJson,
      };

      await SyncLogger.logSyncRequest(tipoEvento, submitParams);

      const mhResponse = await mhClient.submitEvent(submitParams, {
        userName: credentials.user,
        password: credentials.password,
      });

      await SyncLogger.logSyncResponse(
        tipoEvento,
        mhResponse.estado === 'PROCESADO' ? 200 : 400,
        mhResponse
      );

      return mhResponse;
    }

    const submitParams: DTESubmitParams = {
      ambiente,
      idEnvio: numericIdEnvio,
      version,
      tipoDte,
      codigoGeneracion: null,
      documento: signedDte.signedJson,
    };

    // Log outgoing request
    await SyncLogger.logSyncRequest(tipoDte, submitParams);

    const mhResponse = await mhClient.submitDTE(submitParams, {
      userName: credentials.user,
      password: credentials.password,
    });

    // Log response
    await SyncLogger.logSyncResponse(
      tipoDte,
      mhResponse.estado === 'PROCESADO' ? 200 : 400,
      mhResponse
    );

    return mhResponse;
  }

  // ─── Main entry point ───────────────────────────────────────────────────────

  /**
   * Full DTE lifecycle: build → sign → submit → return updated invoice.
   */
  static async generateAndSubmitDTE(
    invoice: Invoice,
    company: Company,
    environment: 'development' | 'production' | 'contingency' = 'development'
  ): Promise<GenerationResult> {
    const invoiceId = invoice.id;

    // Start tracking
    InvoiceStatusTracker.startTracking(invoiceId);

    try {
      // ── Resolve environment ──────────────────────────────────────────────
      const environmentCode = resolveEnvironmentCode(environment, company);

      // ── Stamp identifiers via shared helper (also runs in buildDTEPayload,
      //    so this is idempotent — but doing it here lets us mark the invoice
      //    as Sincronizando and surface the codes in InvoiceStatusTracker).
      const enrichedInvoice: Invoice = {
        ...InvoiceGenerationService.enrichForSubmission(invoice, company),
        status: InvoiceStatus.Sincronizando,
      };

      // ── Step 1: Build DTE payload ────────────────────────────────────────
      InvoiceStatusTracker.updateStatus(invoiceId, TrackingStatus.Signing);

      let dtePayload: DTEPayload;
      try {
        dtePayload = await InvoiceGenerationService.buildDTEPayload(
          enrichedInvoice,
          company,
          environmentCode
        );
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Error al construir el payload DTE';
        InvoiceStatusTracker.updateStatus(invoiceId, TrackingStatus.Failed, { error: msg });
        await SyncLogger.logSyncError(invoice.documentType, err);
        return { success: false, error: msg };
      }

      // ── Step 2: Sign ─────────────────────────────────────────────────────
      let signedDte: SignedDTE;
      try {
        signedDte = await InvoiceGenerationService.signDTE(dtePayload, company);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Error al firmar el documento';
        InvoiceStatusTracker.updateStatus(invoiceId, TrackingStatus.Failed, { error: msg });
        await SyncLogger.logSyncError(invoice.documentType, err);
        return { success: false, error: msg };
      }

      // ── Step 3: Submit ───────────────────────────────────────────────────
      InvoiceStatusTracker.updateStatus(invoiceId, TrackingStatus.Submitting);

      let mhResponse: import('@/services/api/MhClient.types').DTEResponse;
      try {
        mhResponse = await InvoiceGenerationService.submitToMH(
          signedDte,
          enrichedInvoice,
          environment,
          company
        );
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Error al enviar a Hacienda';
        InvoiceStatusTracker.updateStatus(invoiceId, TrackingStatus.Failed, { error: msg });
        await SyncLogger.logSyncError(invoice.documentType, err);
        return { success: false, error: msg, mhResponse: undefined };
      }

      // ── Evaluate MH response ─────────────────────────────────────────────
      const accepted =
        mhResponse.estado === 'PROCESADO' ||
        mhResponse.estado === 'RECIBIDO';

      if (!accepted) {
        const errorMsg =
          mhResponse.descripcionMsg ||
          mhResponse.observaciones?.join('; ') ||
          'Hacienda rechazó el documento';
        InvoiceStatusTracker.updateStatus(invoiceId, TrackingStatus.Failed, {
          error: errorMsg,
          mhResponse,
        });
        const failedInvoice: Invoice = {
          ...enrichedInvoice,
          status: InvoiceStatus.ErrorEnvio,
        };
        return { success: false, error: errorMsg, mhResponse, invoice: failedInvoice };
      }

      // ── Success ──────────────────────────────────────────────────────────
      InvoiceStatusTracker.updateStatus(invoiceId, TrackingStatus.Completed, { mhResponse });

      const completedInvoice: Invoice = {
        ...enrichedInvoice,
        receptionSeal: mhResponse.selloRecibido ?? undefined,
        status: InvoiceStatus.Completada,
        updatedAt: new Date().toISOString(),
      };

      return {
        success: true,
        invoice: completedInvoice,
        mhResponse,
      };
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Error inesperado al generar DTE';
      InvoiceStatusTracker.updateStatus(invoiceId, TrackingStatus.Failed, { error: msg });
      await SyncLogger.logSyncError(invoice.documentType, err);
      return { success: false, error: msg };
    }
  }
}

export default InvoiceGenerationService;
