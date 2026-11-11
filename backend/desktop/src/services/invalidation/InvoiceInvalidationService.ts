// Invoice Invalidation Service
// Handles document invalidation (anulación) with El Salvador government API

import { InvoiceService } from '../api/InvoiceService';
import { DTEMappingService } from '../dte/DTEMappingService';
import { Invoice, InvoiceStatus } from '../../types/invoice';
import { Company, CompanyEnvironment } from '../../types/company';
import { SecureStorageService } from '../security/SecureStorageService';
import { DTE_InvalidationRequest, ServiceCredentials, Motivo } from '../../types/dte';

export interface InvalidationRequest {
  invoiceId: string;
  controlNumber: string;
  reason: InvalidationReason;
  customReason?: string;
  replacementGenerationCode?: string;
  responsibleName: string;
  responsibleDocument: string;
  timestamp: string;
}

export interface InvalidationResult {
  success: boolean;
  message: string;
  invalidationId?: string;
  invalidatedAt?: string;
  error?: string;
}

// Invalidation reasons matching El Salvador tax authority requirements
export enum InvalidationReason {
  ErrorInformation = '1',
  ProductReturn = '2',
  Other = '3'
}

export const INVALIDATION_REASON_DESCRIPTIONS: Record<InvalidationReason, string> = {
  [InvalidationReason.ErrorInformation]: 'Error en la Información del Documento Tributario Electrónico a invalidar.',
  [InvalidationReason.ProductReturn]: 'Rescindir de la operación realizada.',
  [InvalidationReason.Other]: 'Otro',
};

class InvoiceInvalidationService {
  private invoiceService: InvoiceService;

  constructor(isProduction: boolean = false) {
    this.invoiceService = new InvoiceService(isProduction);
  }

  async invalidateInvoice(
    invoice: Invoice,
    company: Company,
    request: Omit<InvalidationRequest, 'invoiceId' | 'controlNumber' | 'timestamp'>
  ): Promise<InvalidationResult> {
    try {
      console.log(`[InvoiceInvalidationService] Starting invalidation for invoice ${invoice.invoiceNumber}`);

      const validation = this.validateInvalidationRequest(invoice, company, request);
      if (!validation.isValid) {
        return {
          success: false,
          message: validation.error || 'Datos de invalidación inválidos',
        };
      }

      const isProduction = company.environment === CompanyEnvironment.Production;
      const credentials = await SecureStorageService.getCredentials(company.nit, isProduction);
      if (!credentials) {
        return {
          success: false,
          message: 'Credenciales de la empresa no encontradas. Configure las credenciales en Perfil > Empresas.',
        };
      }

      const certificatePassword = await SecureStorageService.getCertificatePassword(company.nit, isProduction);
      if (!certificatePassword) {
        return {
          success: false,
          message: 'Contraseña del certificado no encontrada. Configure el certificado en Perfil > Empresas.',
        };
      }

      const motivo: Motivo = {
        tipoAnulacion: parseInt(this.getInvalidationReasonCode(request.reason)) as unknown as Motivo['tipoAnulacion'],
        motivoAnulacion: request.reason === InvalidationReason.Other
          ? request.customReason || ''
          : INVALIDATION_REASON_DESCRIPTIONS[request.reason],
        nombreResponsable: request.responsibleName,
        tipDocResponsable: '13',
        numDocResponsable: request.responsibleDocument,
        nombreSolicita: request.responsibleName,
        tipDocSolicita: '13',
        numDocSolicita: request.responsibleDocument,
      } as unknown as Motivo;

      const environmentCode = this.invoiceService.getEnvironmentCode();
      // CAT-024: only código 1 (anula y sustituye) carries the replacement
      // DTE; códigos 2 and 3 always send codigoGeneracionR = null.
      const replacementGenerationCode =
        request.reason === InvalidationReason.ErrorInformation
          ? request.replacementGenerationCode?.trim().toUpperCase() || null
          : null;

      const dteInvalidationRequest: DTE_InvalidationRequest = DTEMappingService.mapInvalidationModel(
        invoice,
        company,
        motivo,
        company.nombreComercial || company.nombre,
        environmentCode,
        replacementGenerationCode
      );

      const serviceCredentials: ServiceCredentials = {
        user: (company.nit || '').replace(/\D/g, ''),
        credential: credentials.password,
        key: certificatePassword,
        invoiceNumber: invoice.invoiceNumber
      };

      console.log('[InvoiceInvalidationService] Sending invalidation request to government API');

      const apiResult = await this.invoiceService.invalidateDocumentLocal(
        dteInvalidationRequest,
        serviceCredentials
      );

      if (apiResult) {
        const invalidationId = `invalidation_${Date.now()}`;
        console.log(`[InvoiceInvalidationService] Invoice ${invoice.invoiceNumber} invalidated successfully`);

        return {
          success: true,
          message: 'Evento de invalidación registrado correctamente en el Ministerio de Hacienda',
          invalidationId,
          invalidatedAt: new Date().toISOString(),
        };
      } else {
        const errorMessage = 'Error en el evento de invalidación del documento';
        return {
          success: false,
          message: `Error al registrar evento de invalidación: ${errorMessage}`,
          error: errorMessage,
        };
      }
    } catch (error) {
      console.error('[InvoiceInvalidationService] Exception during invalidation:', error);
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
      return {
        success: false,
        message: `Error al procesar evento de invalidación: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  canInvalidateInvoice(invoice: Invoice): { canInvalidate: boolean; reason?: string } {
    if (invoice.status !== InvoiceStatus.Completada) {
      return { canInvalidate: false, reason: 'Solo se pueden invalidar documentos completados' };
    }

    if (!invoice.controlNumber || !invoice.generationCode) {
      return { canInvalidate: false, reason: 'El documento no tiene código de generación o número de control' };
    }

    // The event echoes MH's selloRecibido (required by the invalidación
    // schema); without it MH rejects the event (Swift guards the same).
    if (!invoice.receptionSeal) {
      return { canInvalidate: false, reason: 'El documento no tiene sello de recepción de Hacienda' };
    }

    if (invoice.invalidatedViaApi) {
      return { canInvalidate: false, reason: 'El documento ya tiene evento de invalidación registrado' };
    }

    const deadline = this.getDeadline(invoice);
    const extendedDeadlineTypes = ['01', '11', '14'];
    const tipoDte = invoice.documentType || '';

    if (Date.now() > deadline.getTime()) {
      const limitMsg = extendedDeadlineTypes.includes(tipoDte)
        ? 'Este documento solo puede invalidarse dentro de los 3 meses posteriores a su transmisión'
        : 'Este documento solo puede invalidarse hasta el décimo día hábil del mes siguiente al de su transmisión';
      return { canInvalidate: false, reason: limitMsg };
    }

    return { canInvalidate: true };
  }

  getDeadline(invoice: Invoice): Date {
    const transmissionDate = this.getTransmissionDate(invoice);
    const extendedDeadlineTypes = ['01', '11', '14'];
    const tipoDte = invoice.documentType || '';

    if (extendedDeadlineTypes.includes(tipoDte)) {
      const deadline = new Date(transmissionDate);
      deadline.setMonth(deadline.getMonth() + 3);
      return this.endOfDay(deadline);
    }

    // CCF, NR, NC, ND, CR, CL, DCL, CD and events 17/18: up to 23:59:59 of the
    // 10th business day of the month after the period in which the document got
    // its sello (Manual Funcional v2.0 — e.g. sello 19-03-2026 → 20-04-2026).
    // The app used to stop at the NEXT business day, blocking invalidations MH accepts.
    return this.tenthBusinessDayOfNextMonth(transmissionDate);
  }

  isWithinDeadline(invoice: Invoice): boolean {
    return Date.now() <= this.getDeadline(invoice).getTime();
  }

  getRemainingTime(invoice: Invoice): { days: number; hours: number } {
    const remaining = this.getDeadline(invoice).getTime() - Date.now();
    if (remaining <= 0) return { days: 0, hours: 0 };
    const totalHours = Math.floor(remaining / (1000 * 60 * 60));
    return {
      days: Math.floor(totalHours / 24),
      hours: totalHours % 24,
    };
  }

  private getTransmissionDate(invoice: Invoice): Date {
    const date = new Date(invoice.fechaTransmision || invoice.date);
    return Number.isNaN(date.getTime()) ? new Date(invoice.date) : date;
  }

  private tenthBusinessDayOfNextMonth(date: Date): Date {
    const current = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    let count = 0;
    while (true) {
      if (this.isBusinessDay(current) && ++count === 10) {
        return this.endOfDay(current);
      }
      current.setDate(current.getDate() + 1);
    }
  }

  /**
   * Weekdays that are not El Salvador national / public-sector holidays. When in
   * doubt a day counts as a holiday — a later local deadline only lets MH (the
   * authority) answer; an earlier one blocks invalidations MH would accept. The
   * Holy Week + Easter Monday set reproduces the Manual Funcional's own
   * examples (sello 19-03-2026 → 20-04-2026; 25-04-2026 → 15-05-2026).
   */
  private isBusinessDay(date: Date): boolean {
    const weekday = date.getDay();
    if (weekday === 0 || weekday === 6) return false;

    const month = date.getMonth() + 1;
    const day = date.getDate();
    const fixedHolidays: Array<[number, number]> = [
      [1, 1], [5, 1], [5, 10], [6, 17], [8, 3], [8, 4], [8, 5], [8, 6], [9, 15], [11, 2], [12, 25],
    ];
    if (fixedHolidays.some(([m, d]) => m === month && d === day)) return false;

    const easter = easterSunday(date.getFullYear());
    const daysFromEaster = Math.round(
      (Date.UTC(date.getFullYear(), month - 1, day) -
        Date.UTC(easter.getFullYear(), easter.getMonth(), easter.getDate())) / 86_400_000,
    );
    // Holy Week Monday–Friday (−6…−2) and Easter Monday (+1).
    return !((daysFromEaster >= -6 && daysFromEaster <= -2) || daysFromEaster === 1);
  }

  private endOfDay(date: Date): Date {
    const deadline = new Date(date);
    deadline.setHours(23, 59, 59, 999);
    return deadline;
  }

  async getInvalidationStatus(
    controlNumber: string,
    _company: Company
  ): Promise<{ isInvalidated: boolean; invalidationDate?: string; invalidationReason?: string; error?: string }> {
    console.log(`[InvoiceInvalidationService] Checking invalidation status for control number ${controlNumber}`);
    return { isInvalidated: false, error: 'Status query not yet implemented' };
  }

  private validateInvalidationRequest(
    invoice: Invoice,
    company: Company,
    request: Omit<InvalidationRequest, 'invoiceId' | 'controlNumber' | 'timestamp'>
  ): { isValid: boolean; error?: string } {
    const canInvalidate = this.canInvalidateInvoice(invoice);
    if (!canInvalidate.canInvalidate) {
      return { isValid: false, error: canInvalidate.reason };
    }

    if (!company.nit || !company.nombre) {
      return { isValid: false, error: 'Datos de empresa incompletos' };
    }

    if (!Object.values(InvalidationReason).includes(request.reason)) {
      return { isValid: false, error: 'Motivo de invalidación inválido' };
    }

    if (request.reason === InvalidationReason.Other) {
      if (!request.customReason || request.customReason.trim().length < 5) {
        return { isValid: false, error: 'Debe especificar un motivo personalizado de al menos 5 caracteres' };
      }
    }

    if (request.reason === InvalidationReason.Other && request.customReason && request.customReason.trim().length > 200) {
      return { isValid: false, error: 'El motivo no debe superar 200 caracteres' };
    }

    // CAT-024 código 1 (anula y sustituye): MH requires the generation code of
    // the DTE that replaces the invalidated one (mirrors Swift DeactivateValidation).
    const replacementGenerationCode = request.replacementGenerationCode?.trim().toUpperCase();
    if (request.reason === InvalidationReason.ErrorInformation && !replacementGenerationCode) {
      return {
        isValid: false,
        error: 'CAT-024 código 1 requiere el código de generación del DTE que lo sustituye',
      };
    }
    if (replacementGenerationCode && !/^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/.test(replacementGenerationCode)) {
      return { isValid: false, error: 'El código de generación del DTE correcto debe ser UUID v4' };
    }

    if (!request.responsibleName || request.responsibleName.trim().length < 3) {
      return { isValid: false, error: 'Nombre del responsable debe tener al menos 3 caracteres' };
    }

    if (!request.responsibleDocument || request.responsibleDocument.trim().length < 8) {
      return { isValid: false, error: 'Documento del responsable debe ser válido' };
    }

    return { isValid: true };
  }

  private getInvalidationReasonCode(reason: InvalidationReason): string {
    return reason;
  }

  getReasonDescription(reason: InvalidationReason): string {
    return INVALIDATION_REASON_DESCRIPTIONS[reason];
  }

  getAvailableReasons(): Array<{ code: InvalidationReason; description: string }> {
    return Object.entries(INVALIDATION_REASON_DESCRIPTIONS).map(([code, description]) => ({
      code: code as InvalidationReason,
      description,
    }));
  }

  setEnvironment(isProduction: boolean): void {
    this.invoiceService.setEnvironment(isProduction);
  }

  async testInvalidationApi(): Promise<{ available: boolean; message: string }> {
    return { available: true, message: 'API de anulación disponible (sin verificación)' };
  }
}

let invalidationServiceInstance: InvoiceInvalidationService | null = null;

export const createInvalidationService = (isProduction: boolean = false): InvoiceInvalidationService => {
  if (!invalidationServiceInstance) {
    invalidationServiceInstance = new InvoiceInvalidationService(isProduction);
  } else {
    invalidationServiceInstance.setEnvironment(isProduction);
  }
  return invalidationServiceInstance;
};

export const getInvalidationService = (): InvoiceInvalidationService | null => {
  return invalidationServiceInstance;
};

export { InvoiceInvalidationService };

/** Gregorian Easter Sunday (anonymous / Meeus–Jones–Butcher algorithm). */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}
