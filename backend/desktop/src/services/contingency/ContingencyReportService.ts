/**
 * ContingencyReportService — user-facing "formal contingency incident" flow.
 *
 * Mirrors the iOS `ContingencyRequestView.swift` + `ContingencyRequestViewModel`:
 * the user picks a date range and a set of invoices, fills in the responsible
 * person + motive, then submits:
 *   1. one signed Evento de Contingencia to MH (/fesv/contingencia),
 *   2. then each listed DTE, transmitted with the SAME codigoGeneracion the
 *      event listed (Modelo 2 / Transmisión 2 / tipoContingencia).
 *
 * Both steps run on the same LOCAL path as a normal send (DTESubmissionModal):
 * the payload is built and signed on this machine with the company's own
 * environment certificate (production companies sign with their production
 * .crt — SecureStorageService per-environment keys) and posted straight to
 * MH. The old route through the backend (`InvoiceService.submitInvoice` →
 * `/document/send`) signed with a certificate blob the Desktop never uploads,
 * and on "YA EXISTE … codigoGeneracion" minted a new codigoGeneracion / random
 * numeroControl / new fecEmi and re-sent — a SECOND fiscal document for the
 * same sale that the contingency event never listed. Now a "ya existe" answer
 * consults MH (/fesv/recepcion/consultadte) and finishes with MH's sello;
 * identifiers are never regenerated here.
 *
 * (The old backend auto-retry queue `ContingencyService` — never wired to a
 * screen, still sending through the backend path — was removed 2026-10-31.)
 */

import { Invoice, InvoiceStatus } from '@/types/invoice';
import { Company } from '@/types/company';
import { ContingenciaRequest } from '@/types/dte';
import { SecureStorageService } from '../security/SecureStorageService';
import { CONTINGENCY_DTE_TYPES, DTEMappingService } from '../dte/DTEMappingService';
import { InvoiceGenerationService } from '../invoiceGeneration/InvoiceGenerationService';
import { getSignerService } from '../signing/SignerService';
import { getMhClient } from '../api/MhClient';
import type { DTEResponse } from '../api/MhClient.types';
import { getApiConfig } from '../../config/api';
import { deepOmitUndefinedEnhanced } from '../../utils/dteMapper';
import { svDateOf, svInstant } from '../../utils/svDate';
import { CompanyEnvironment } from '@/types/company';

export interface ContingencyFormData {
  company: Company;
  invoices: Invoice[];
  /** User-selected ambiente code — defaults to the company's environment. */
  tipoContingencia: number;
  motivoContingencia: string;
  nombreResponsable: string;
  duiResponsable: string;
  /** ISO-8601 local dates (yyyy-mm-dd). */
  fInicio: string;
  fFin: string;
  /** HH:mm strings. */
  hInicio: string;
  hFin: string;
}

export interface PerInvoiceResult {
  invoiceId: string;
  invoiceNumber: string;
  success: boolean;
  selloRecibido?: string;
  codigoGeneracion?: string;
  numeroControl?: string;
  fechaTransmision?: string;
  /** True when MH already had this codigoGeneracion processed (consultadte). */
  alreadyProcessed?: boolean;
  error?: string;
  /**
   * The invoice as reported/transmitted: final identifiers + `contingency`.
   * Persist it — a retry must re-send the SAME codigoGeneracion the event listed.
   */
  invoice?: Invoice;
}

/** MH caps an Evento de Contingencia at 1,000 documents (contingencia-v4 detalleDTE). */
export const MAX_CONTINGENCY_DOCUMENTS = 1000;

export interface ContingencyReportResult {
  reportSubmitted: boolean;
  reportError?: string;
  invoices: PerInvoiceResult[];
}

export type ProgressHandler = (progress: {
  phase: 'report' | 'syncing';
  current: number;
  total: number;
  invoice?: Invoice;
  lastResult?: PerInvoiceResult;
}) => void;

export class ContingencyReportService {
  /**
   * Validate the form. Returns a list of Spanish error strings; empty = valid.
   */
  static validate(form: ContingencyFormData): string[] {
    const errors: string[] = [];
    if (!form.company.nit) errors.push('La empresa no tiene NIT configurado.');
    if (form.invoices.length === 0) errors.push('Selecciona al menos una factura.');
    if (form.invoices.length > MAX_CONTINGENCY_DOCUMENTS) {
      errors.push(`Un evento de contingencia admite como máximo ${MAX_CONTINGENCY_DOCUMENTS} documentos; divide la selección.`);
    }
    const notAllowed = form.invoices.filter((inv) => !CONTINGENCY_DTE_TYPES.has(inv.documentType));
    if (notAllowed.length > 0) {
      errors.push(
        `Hacienda no permite emitir en contingencia estos tipos de DTE (${Array.from(new Set(notAllowed.map((i) => i.documentType))).join(', ')}): ` +
          'solo Factura, CCF, Nota de Remisión, Nota de Crédito, Nota de Débito, Comprobante de Retención, Exportación y Sujeto Excluido.',
      );
    }
    if (!form.nombreResponsable.trim()) errors.push('Ingresa el nombre del responsable.');
    if (!/^\d{9}$/.test(form.duiResponsable)) {
      errors.push('El DUI del responsable debe tener exactamente 9 dígitos.');
    }
    if (!form.motivoContingencia.trim()) {
      errors.push('Describe el motivo de la contingencia.');
    }
    if (!form.tipoContingencia || form.tipoContingencia < 1 || form.tipoContingencia > 5) {
      errors.push('Selecciona el tipo de contingencia (CAT-005).');
    }
    if (svInstant(form.fInicio, form.hInicio || '00:00') > svInstant(form.fFin, form.hFin || '23:59')) {
      errors.push('La fecha/hora de inicio debe ser anterior o igual a la de fin.');
    }
    return errors;
  }

  /**
   * Pull MH + certificate secrets from SecureStorage for this NIT, in the
   * company's OWN environment (a production company uses its production
   * credentials/certificate, falling back to the test ones until it saves its
   * own — SecureStorageService). Returns a diagnostic message if anything is
   * missing.
   */
  static async loadCredentials(
    company: Company,
  ): Promise<{ credentials: { user: string; password: string; certPassword: string } } | { error: string }> {
    const nit = company.nit;
    if (!nit) {
      return { error: 'La empresa no tiene NIT configurado.' };
    }
    const isProduction = company.environment === CompanyEnvironment.Production;
    const stored = await SecureStorageService.getCredentials(nit, isProduction);
    if (!stored?.password) {
      return { error: 'Credenciales MH no configuradas. Ve a Editar Configuración → Credenciales API.' };
    }
    const certPassword = await SecureStorageService.getCertificatePassword(nit, isProduction);
    if (!certPassword) {
      return {
        error:
          'Contraseña del certificado no configurada. Ve a Editar Configuración → Contraseña del Certificado.',
      };
    }
    return {
      credentials: {
        user: stored.user || nit.replace(/\D/g, ''),
        password: stored.password,
        certPassword,
      },
    };
  }

  /**
   * Sign the Evento de Contingencia locally and post it to MH
   * (/fesv/contingencia). Same request shape the homologation batch uses
   * against real MH (useRequestProductionAccess.submitContingencyBatch).
   */
  static async sendContingencyEvent(
    request: ContingenciaRequest,
    company: Company,
    credentials: { user: string; password: string; certPassword: string },
  ): Promise<DTEResponse> {
    const isProduction = company.environment === CompanyEnvironment.Production;
    const sanitized = deepOmitUndefinedEnhanced(request) as ContingenciaRequest;
    const signed = await getSignerService().signAsync({
      // Certificate secrets are keyed by the company's NIT as stored
      // (InvoiceGenerationService.signDTE does the same).
      nit: company.nit ?? '',
      passwordPri: credentials.certPassword,
      dteJson: JSON.stringify(sanitized),
      isProduction,
    });
    if (signed.status !== 'OK' || !signed.body) {
      throw new Error('Error al firmar el evento de contingencia.');
    }
    const response = await getMhClient(isProduction).submitContingency(
      {
        ambiente: request.identificacion.ambiente,
        idEnvio: 1,
        version: request.identificacion.version,
        tipoDte: 'contingencia',
        codigoGeneracion: null,
        documento: signed.body,
      },
      { userName: credentials.user, password: credentials.password },
    );
    if (response?.estado === 'PROCESADO' || response?.estado === 'RECIBIDO') {
      return response;
    }
    throw new Error(`Hacienda rechazó el evento de contingencia: ${describeMhRejection(response)}`);
  }

  /**
   * Transmit one already-reported DTE with its final identifiers. Never mints
   * new ones: on "ya existe" MH is consulted and the existing record wins.
   */
  static async transmitReportedInvoice(
    invoice: Invoice,
    company: Company,
  ): Promise<Omit<PerInvoiceResult, 'invoiceId' | 'invoiceNumber' | 'invoice'>> {
    const isProduction = company.environment === CompanyEnvironment.Production;
    const environment = isProduction ? 'production' : 'development';
    const environmentCode = isProduction ? '01' : '00';
    const identifiers = {
      codigoGeneracion: invoice.generationCode,
      numeroControl: invoice.controlNumber,
    };

    const consultExisting = async (rejection: string) => {
      const processed = await InvoiceGenerationService.findProcessedOnMH(invoice, environment, company);
      if (processed) {
        return {
          ...identifiers,
          success: true,
          alreadyProcessed: true,
          selloRecibido: processed.selloRecibido,
          fechaTransmision: processed.fechaTransmision,
        };
      }
      return {
        ...identifiers,
        success: false,
        error:
          `${rejection} — Hacienda indica que el documento ya existe pero no se pudo confirmar su sello ` +
          '(consulta /consultadte). No se generó un nuevo código; reintenta más tarde o verifica en el portal de Hacienda.',
      };
    };

    let response: DTEResponse;
    try {
      const payload = await InvoiceGenerationService.buildDTEPayload(invoice, company, environmentCode);
      const signed = await InvoiceGenerationService.signDTE(payload, company);
      response = await InvoiceGenerationService.submitToMH(signed, invoice, environment, company);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al enviar DTE.';
      if (isAlreadyExistsMessage(message)) return consultExisting(message);
      return { ...identifiers, success: false, error: message };
    }

    if (response.estado === 'PROCESADO' || response.estado === 'RECIBIDO') {
      return {
        ...identifiers,
        success: true,
        selloRecibido: response.selloRecibido ?? undefined,
        fechaTransmision: response.fechaTransmision ?? response.fhProcesamiento ?? new Date().toISOString(),
      };
    }
    const rejection = describeMhRejection(response);
    if (isAlreadyExistsMessage(rejection)) return consultExisting(rejection);
    return { ...identifiers, success: false, error: rejection };
  }

  /**
   * Submit the full contingency incident:
   *  1. Post one ContingenciaRequest report to MH.
   *  2. Iterate invoices and submit each one.
   */
  static async submitReport(
    form: ContingencyFormData,
    onProgress?: ProgressHandler,
  ): Promise<ContingencyReportResult> {
    const credsOrError = await this.loadCredentials(form.company);
    if ('error' in credsOrError) {
      return {
        reportSubmitted: false,
        reportError: credsOrError.error,
        invoices: [],
      };
    }
    const credentials = credsOrError.credentials;

    const apiConfig = getApiConfig(form.company.environment === CompanyEnvironment.Production);
    const environmentCode = apiConfig.environmentCode;

    // Step 1 — build and send the contingency report.
    onProgress?.({ phase: 'report', current: 0, total: form.invoices.length });

    // The form's dates/hours are El Salvador wall-clock times.
    const startDate = svInstant(form.fInicio, form.hInicio || '00:00');
    const endDate = svInstant(form.fFin, form.hFin || '23:59');

    // Every reported document needs its final identifiers BEFORE the event (the
    // event lists each codigoGeneracion — invoices still "Nueva" used to go out
    // as "") and keeps them, plus the contingency data, on its final
    // transmission: Modelo 2 / Transmisión 2 / tipoContingencia, which MH
    // matches against this event (DTEMappingService.transmissionMode).
    const prepared: Invoice[] = form.invoices.map((invoice) => ({
      ...InvoiceGenerationService.enrichForSubmission(invoice, form.company),
      contingency: {
        tipoContingencia: form.tipoContingencia,
        motivoContin: form.tipoContingencia === 5 ? form.motivoContingencia.trim() : null,
      },
    }));

    const request: ContingenciaRequest = DTEMappingService.mapContingenciaRequest(
      prepared,
      form.company,
      environmentCode,
      startDate,
      endDate,
      form.tipoContingencia,
      form.motivoContingencia,
      form.nombreResponsable.trim(),
      form.duiResponsable,
    );

    try {
      await this.sendContingencyEvent(request, form.company, credentials);
    } catch (err) {
      return {
        reportSubmitted: false,
        reportError: err instanceof Error ? err.message : 'Error al enviar el reporte de contingencia.',
        invoices: [],
      };
    }

    const reportedAt = new Date().toISOString();
    for (const invoice of prepared) {
      invoice.contingency = { ...invoice.contingency!, reportedAt };
    }

    // Step 2 — transmit each listed DTE with the identifiers the event listed.
    const results: PerInvoiceResult[] = [];
    for (let i = 0; i < prepared.length; i++) {
      const invoice = prepared[i];
      onProgress?.({
        phase: 'syncing',
        current: i,
        total: prepared.length,
        invoice,
      });

      let outcome: Omit<PerInvoiceResult, 'invoiceId' | 'invoiceNumber' | 'invoice'>;
      try {
        outcome = await this.transmitReportedInvoice(invoice, form.company);
      } catch (err) {
        outcome = {
          success: false,
          codigoGeneracion: invoice.generationCode,
          numeroControl: invoice.controlNumber,
          error: err instanceof Error ? err.message : 'Error al enviar DTE.',
        };
      }
      const r: PerInvoiceResult = {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        ...outcome,
        invoice,
      };
      results.push(r);
      onProgress?.({
        phase: 'syncing',
        current: i + 1,
        total: prepared.length,
        lastResult: r,
      });
    }

    return {
      reportSubmitted: true,
      invoices: results,
    };
  }

  /**
   * Convenience filter for the form's "Cargar Facturas" button — mirrors the
   * iOS behavior of showing Nueva / ErrorEnvio invoices within the date range.
   */
  static filterCandidates(
    invoices: Invoice[],
    companyId: string,
    fInicio: string,
    fFin: string,
  ): Invoice[] {
    return invoices.filter((inv) => {
      if (inv.companyId !== companyId) return false;
      // CL, DCL and CD cannot be issued in contingency (Manual Funcional v2.0).
      if (!CONTINGENCY_DTE_TYPES.has(inv.documentType)) return false;
      if (
        inv.status !== InvoiceStatus.Nueva &&
        inv.status !== InvoiceStatus.ErrorEnvio &&
        inv.status !== InvoiceStatus.Contingencia
      ) {
        return false;
      }
      // El Salvador calendar dates: `new Date('2026-10-01')` is UTC midnight
      // (Sept 30 in SV), which dropped documents dated on the range start.
      const date = svDateOf(inv.date);
      return !!date && date >= fInicio && date <= fFin;
    });
  }
}

/** MH's "the identifier was already received" answer (codigoGeneracion / numeroControl). */
export function isAlreadyExistsMessage(message: string | undefined | null): boolean {
  return /YA EXISTE/i.test(message ?? '');
}

function describeMhRejection(response: DTEResponse | null | undefined): string {
  if (!response) return 'Hacienda no respondió.';
  const observaciones = Array.isArray(response.observaciones) ? response.observaciones.filter(Boolean) : [];
  const detail =
    [response.descripcionMsg, ...observaciones].filter(Boolean).join(' · ') ||
    (response as { mensaje?: string }).mensaje ||
    response.estado ||
    'Hacienda rechazó el documento';
  return response.codigoMsg ? `[${response.codigoMsg}] ${detail}` : detail;
}

/** CAT-005 — Tipo de Contingencia (per MH spec). */
export const CONTINGENCY_TYPES: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: '1 — No disponibilidad del sistema del MH' },
  { value: 2, label: '2 — No hay conectividad con el servicio del MH' },
  { value: 3, label: '3 — Falla en el suministro de energía eléctrica' },
  { value: 4, label: '4 — Falla en las comunicaciones del emisor' },
  { value: 5, label: '5 — Otros motivos (fuerza mayor / caso fortuito)' },
];

export default ContingencyReportService;
