// Complete Invoice Service for Government DTE API Integration
// Based on SwiftUI InvoiceServiceClient implementation

import { logger } from '../../utils/logger';
import { HttpClient, ApiError, getHttpClient } from './HttpClient';
import { API_CONFIG, API_HEADERS, getApiConfig, getDTEEndpoint as getConfiguredDTEEndpoint } from '../../config/api';
import { DTEMappingService, NORMATIVA_2_SCHEMA_VERSIONS } from '../dte/DTEMappingService';
import { deepOmitUndefinedEnhanced } from '../../utils/dteMapper';
import {
  DTE_Base,
  DTEResponseWrapper,
  DTEErrorResponseWrapper,
  ServiceCredentials,
  ContingenciaRequest,
  DTE_InvalidationRequest
} from '../../types/dte';
import {
  PromoCodeRequest,
  PromoResponse,
  PromoStatus
} from '../../types/promo';
import { EmailAccount } from '../../types/email';
import { PurchaseResponse } from '../../types/purchase';
import { Invoice, InvoiceType } from '../../types/invoice';
import { Company } from '../../types/company';
import CloudSyncService, { getTableName } from '../sync/CloudSyncService';
import AuthProviderService from '../auth/AuthProviderService';
import { getSignerService } from '../signing/SignerService';
import { getMhClient } from './MhClient';
import { DTEEventSubmitParams, DTESubmitParams, DTEResponse } from './MhClient.types';
import { SyncLogger } from './SyncLogger';
import { TelemetryService } from '../telemetry/TelemetryService';
import { TelemetryEvent } from '../../config/telemetryConfig';
import { svDateOf } from '../../utils/svDate';

export class InvoiceService {
  private httpClient: HttpClient;
  private isProduction: boolean;

  constructor(isProduction: boolean = false) {
    this.httpClient = getHttpClient(isProduction);
    this.isProduction = isProduction;
  }

  private getPayloadDocumentOrEventType(dte: DTE_Base): string | undefined {
    const identificacion = dte.identificacion as unknown as Record<string, unknown>;
    const tipoEvento = identificacion.tipoEvento;
    const tipoDte = identificacion.tipoDte;

    if (typeof tipoEvento === 'string' && tipoEvento.trim()) return tipoEvento;
    if (typeof tipoDte === 'string' && tipoDte.trim()) return tipoDte;
    return undefined;
  }

  private getPayloadDTEEndpoint(dte: DTE_Base): string {
    const identificacion = dte.identificacion as unknown as Record<string, unknown>;
    const tipoDte = typeof identificacion.tipoDte === 'string' ? identificacion.tipoDte : undefined;
    const tipoEvento = typeof identificacion.tipoEvento === 'string' ? identificacion.tipoEvento : undefined;
    return this.getDTEEndpoint(tipoDte, tipoEvento);
  }

  /**
   * Query document status by control number via direct government API.
   */
  async queryDocumentStatus(controlNumber: string, nit: string, tipoDte: string = '01'): Promise<{ estado?: string; codigoGeneracion?: string; numeroControl?: string; selloRecibido?: string } | null> {
    try {
      const credentials = await this.getMhCredentials(nit);
      if (!credentials) {
        logger.warn('[InvoiceService] queryDocumentStatus: no credentials available');
        return null;
      }

      const nitSinGuiones = nit.replace(/-/g, '');
      const mhClient = getMhClient(this.isProduction);
      const response = await mhClient.searchDTE(
        { nitEmisor: nitSinGuiones, tdte: tipoDte, codigoGeneracion: controlNumber },
        { userName: credentials.user, password: credentials.password }
      );

      return {
        estado: response.estado,
        codigoGeneracion: response.codigoGeneracion,
        selloRecibido: response.selloRecibido || undefined,
      };
    } catch (error) {
      logger.warn('[InvoiceService] queryDocumentStatus failed:', error);
      return null;
    }
  }

  private async getMhCredentials(nit: string): Promise<{ user: string; password: string } | null> {
    try {
      const { SecureStorageService } = await import('../security/SecureStorageService');
      const creds = await SecureStorageService.getCredentials(nit, this.isProduction);
      if (creds) {
        return { user: creds.user, password: creds.password };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Sync a DTE directly with the government API using local signing.
   * 1. Sign the DTE JSON locally using RSA RS512 JWS (SignerService)
   * 2. Submit the signed JWS token directly to api.dtes.mh.gob.sv (MhClient)
   */
  async SyncLocal(
    dte: DTE_Base,
    credentials: ServiceCredentials,
    retryCount: number = 0
  ): Promise<DTEResponseWrapper> {
    const MAX_RETRIES = 3;
    const syncStartMs = Date.now();

    try {
      logger.log(`[InvoiceService] SyncLocal: Submitting DTE directly to government API${retryCount > 0 ? ` (retry ${retryCount}/${MAX_RETRIES})` : ''}`);

      const formattedDTE = this.formatDTEDates(dte);
      const sanitizedDTE = deepOmitUndefinedEnhanced(formattedDTE);

      if (sanitizedDTE.identificacion?.tipoDte === '01' && (sanitizedDTE as unknown as Record<string, unknown>).documentoRelacionado === undefined) {
        (sanitizedDTE as unknown as Record<string, unknown>).documentoRelacionado = null;
      }

      const dteJson = JSON.stringify(sanitizedDTE);
      const documentOrEventType =
        this.getPayloadDocumentOrEventType(sanitizedDTE) ?? dte.identificacion.tipoDte;

      logger.log(`[InvoiceService] SyncLocal: Document Type: ${documentOrEventType}`);
      logger.log(`[InvoiceService] SyncLocal: Control Number: ${dte.identificacion.numeroControl}`);
      logger.log(`[InvoiceService] SyncLocal: Generation Code: ${dte.identificacion.codigoGeneracion}`);

      const signerService = getSignerService();
      const signatureResponse = await signerService.signAsync({
        nit: dte.emisor.nit,
        passwordPri: credentials.key,
        isProduction: this.isProduction,
        dteJson,
      });

      if (signatureResponse.status !== 'OK') {
        throw new Error('Error al firmar el documento');
      }

      logger.log('[InvoiceService] SyncLocal: DTE signed successfully');

      const mhClient = getMhClient(this.isProduction);
      const digits = credentials.invoiceNumber.replace(/\D/g, '');
      const parsed = digits ? parseInt(digits, 10) : 0;
      const numericIdEnvio = parsed > 0
        ? parsed
        : Math.max(1, Math.floor(Date.now() / 1000) % 1_000_000);
      const identificacion = sanitizedDTE.identificacion as unknown as Record<string, unknown>;
      const tipoEvento = typeof identificacion.tipoEvento === 'string' && identificacion.tipoEvento.trim()
        ? identificacion.tipoEvento
        : undefined;
      const submitParams: DTESubmitParams | DTEEventSubmitParams = tipoEvento
        ? {
            ambiente: dte.identificacion.ambiente,
            idEnvio: numericIdEnvio,
            version: dte.identificacion.version,
            tipoEvento,
            codigoGeneracion: typeof identificacion.codigoGeneracion === 'string'
              ? identificacion.codigoGeneracion
              : '',
            documento: signatureResponse.body,
          }
        : {
            ambiente: dte.identificacion.ambiente,
            idEnvio: numericIdEnvio,
            version: dte.identificacion.version,
            tipoDte: documentOrEventType,
            codigoGeneracion: null,
            documento: signatureResponse.body,
          };

      SyncLogger.logSyncRequest(documentOrEventType, {
        ambiente: submitParams.ambiente,
        ...(tipoEvento ? { tipoEvento } : { tipoDte: (submitParams as DTESubmitParams).tipoDte }),
        version: submitParams.version,
        idEnvio: submitParams.idEnvio,
        dteIdentificacion: sanitizedDTE.identificacion,
      });

      const apiHost = this.isProduction ? 'api.dtes.mh.gob.sv' : 'apitest.dtes.mh.gob.sv';
      const depStartMs = Date.now();
      const mhCredentials = {
        userName: dte.emisor.nit,
        password: credentials.credential,
      };
      const mhResponse: DTEResponse = tipoEvento
        ? await mhClient.submitEvent(submitParams as DTEEventSubmitParams, mhCredentials)
        : await mhClient.submitDTE(submitParams as DTESubmitParams, mhCredentials);
      const depDuration = Date.now() - depStartMs;

      TelemetryService.trackDependency(
        tipoEvento ? 'MhClient.submitEvent' : 'MhClient.submitDTE',
        apiHost,
        depDuration,
        mhResponse.estado === 'PROCESADO',
        mhResponse.estado === 'PROCESADO' ? 200 : 400
      );

      logger.log(`[InvoiceService] SyncLocal: Government response: ${mhResponse.estado}`);

      if (mhResponse.estado === 'PROCESADO') {
        TelemetryService.trackEvent(TelemetryEvent.SyncCompleted, {
          invoiceType: documentOrEventType,
          environment: this.isProduction ? 'PRODUCTION' : 'DEVELOPMENT',
          durationMs: Date.now() - syncStartMs,
        });
      } else if (mhResponse.estado === 'RECHAZADO') {
        TelemetryService.trackEvent(TelemetryEvent.DTERejected, {
          invoiceType: documentOrEventType,
          environment: this.isProduction ? 'PRODUCTION' : 'DEVELOPMENT',
          rejectCode: mhResponse.codigoMsg,
          observacionCount: mhResponse.observaciones?.length ?? 0,
        });
      }

      SyncLogger.logSyncResponse(documentOrEventType, 200, {
        estado: mhResponse.estado,
        codigoGeneracion: mhResponse.codigoGeneracion,
        selloRecibido: mhResponse.selloRecibido,
        fhProcesamiento: mhResponse.fhProcesamiento,
        codigoMsg: mhResponse.codigoMsg,
        descripcionMsg: mhResponse.descripcionMsg,
        observaciones: mhResponse.observaciones,
      });

      const response: DTEResponseWrapper = {
        version: mhResponse.version,
        ambiente: mhResponse.ambiente,
        versionApp: mhResponse.versionApp,
        estado: mhResponse.estado,
        codigoGeneracion: mhResponse.codigoGeneracion,
        selloRecibido: mhResponse.selloRecibido || '',
        fhProcesamiento: mhResponse.fhProcesamiento,
        fechaTransmision: mhResponse.fechaTransmision,
        horaTransmision: mhResponse.horaTransmision,
        clasificaMsg: mhResponse.clasificaMsg,
        codigoMsg: mhResponse.codigoMsg,
        descripcionMsg: mhResponse.descripcionMsg,
        observaciones: mhResponse.observaciones || [],
      };

      if (mhResponse.estado === 'PROCESADO') {
        const storageReference =
          dte.identificacion.numeroControl || dte.identificacion.codigoGeneracion || documentOrEventType;
        this.uploadDTEJson(dteJson, storageReference, dte.emisor.nit)
          .catch(err => logger.warn('uploadDTEJson failed', err));
      }

      this.mirrorToCloud(sanitizedDTE);

      return response;
    } catch (error) {
      console.error('[InvoiceService] SyncLocal failed:', error);
      const documentOrEventType =
        this.getPayloadDocumentOrEventType(dte) ?? dte.identificacion.tipoDte;

      SyncLogger.logSyncError(documentOrEventType, error);

      TelemetryService.trackException(error, {
        invoiceType: documentOrEventType,
        environment: this.isProduction ? 'PRODUCTION' : 'DEVELOPMENT',
        durationMs: Date.now() - syncStartMs,
        step: 'SyncLocal',
      });
      TelemetryService.trackEvent(TelemetryEvent.SyncFailed, {
        invoiceType: documentOrEventType,
        environment: this.isProduction ? 'PRODUCTION' : 'DEVELOPMENT',
        durationMs: Date.now() - syncStartMs,
      });

      // "YA EXISTE UN REGISTRO" is NOT retried with new identifiers: MH may
      // already hold this codigoGeneracion (a lost response), and a fresh
      // codigoGeneracion/numeroControl/fecEmi would issue a second fiscal
      // document for the same sale. Callers consult MH
      // (InvoiceGenerationService.findProcessedOnMH) instead.
      throw error;
    }
  }

  /**
   * Invalidate a document using local signing + direct government API.
   */
  async invalidateDocumentLocal(
    dte: DTE_InvalidationRequest,
    credentials: ServiceCredentials
  ): Promise<boolean> {
    try {
      logger.log('[InvoiceService] invalidateDocumentLocal: Signing and submitting invalidation');

      const dteJson = JSON.stringify(dte);

      const signerService = getSignerService();
      const signatureResponse = await signerService.signAsync({
        nit: credentials.user,
        passwordPri: credentials.key,
        isProduction: this.isProduction,
        dteJson,
      });

      if (signatureResponse.status !== 'OK') {
        throw new Error('Error al firmar el documento de anulacion');
      }

      const mhClient = getMhClient(this.isProduction);
      const mhResponse = await mhClient.invalidateDTE(
        {
          ambiente: this.getEnvironmentCode(),
          idEnvio: (() => {
            const d = credentials.invoiceNumber.replace(/\D/g, '');
            const p = d ? parseInt(d, 10) : 0;
            return p > 0 ? p % 1_000_000 : Math.max(1, Math.floor(Date.now() / 1000) % 1_000_000);
          })(),
          version: NORMATIVA_2_SCHEMA_VERSIONS.invalidacion,
          tipoDte: dte.documento.tipoDte,
          documento: signatureResponse.body,
        },
        {
          userName: credentials.user,
          password: credentials.credential,
        }
      );

      if (
        mhResponse.estado === 'RECHAZADO' ||
        mhResponse.estado === 'ERROR'
      ) {
        const detail = mhResponse.observaciones?.join(' · ') || mhResponse.descripcionMsg || mhResponse.estado;
        throw new Error(`MH rechazó la anulación: ${detail}`);
      }

      logger.log('[InvoiceService] invalidateDocumentLocal: Document invalidated successfully');
      return true;
    } catch (error) {
      console.error('[InvoiceService] invalidateDocumentLocal failed:', error);
      throw error;
    }
  }

  private mirrorToCloud(sanitizedDTE: DTE_Base): void {
    (async () => {
      try {
        const appToken = await AuthProviderService.getFreshToken();
        if (!appToken) return;

        const tableName = getTableName(sanitizedDTE.emisor.nit);
        const cloudDoc = {
          id: sanitizedDTE.identificacion?.numeroControl || sanitizedDTE.identificacion?.codigoGeneracion || this.generateUUID(),
          ...sanitizedDTE,
        };
        await CloudSyncService.syncInvoice(cloudDoc, tableName);
        logger.log('[InvoiceService] DTE mirrored to Azure cloud');
      } catch (err) {
        // TODO: surface mirror failures to Redux/telemetry instead of only logging locally.
        logger.warn('[InvoiceService] Azure cloud mirror failed', err);
      }
    })();
  }

  createDTEFromInvoice(invoice: Invoice, company: Company): DTE_Base {
    logger.log(`[InvoiceService] Creating DTE for invoice type ${invoice.invoiceType}`);
    const environmentCode = this.getEnvironmentCode();
    const dte = DTEMappingService.mapInvoice(invoice, company, environmentCode);
    logger.log(`[InvoiceService] DTE created successfully for ${invoice.invoiceType}`);
    return dte;
  }

  validateCompanyData(company: Company): { isValid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!company.nit || company.nit.trim() === '') {
      errors.push('Company NIT is required');
    }
    if (!company.nrc || company.nrc.trim() === '') {
      errors.push('Company NRC is required');
    }
    if (!company.nombre || company.nombre.trim() === '') {
      errors.push('Company name is required');
    }

    const testPatterns = [/^1+$/, /^12345/, /^0+$/, /test/i, /demo/i, /fake/i];

    if (company.nrc && testPatterns.some(pattern => pattern.test(company.nrc!))) {
      if (this.isProduction) {
        errors.push(`Company NRC "${company.nrc}" appears to be test data.`);
      } else {
        warnings.push(`Development Mode: Company NRC "${company.nrc}" appears to be test data.`);
      }
    }

    if (company.nit && testPatterns.some(pattern => pattern.test(company.nit!))) {
      if (this.isProduction) {
        errors.push(`Company NIT "${company.nit}" appears to be test data.`);
      } else {
        warnings.push(`Development Mode: Company NIT "${company.nit}" appears to be test data.`);
      }
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  async submitInvoice(
    invoice: Invoice,
    company: Company,
    credentials: ServiceCredentials
  ): Promise<DTEResponseWrapper> {
    const validation = this.validateCompanyData(company);
    if (!validation.isValid) {
      throw new ApiError(`Company Validation Failed:\n${validation.errors.join('\n')}`, 400);
    }

    if (validation.warnings.length > 0) {
      logger.warn('[InvoiceService] Company validation warnings:', validation.warnings.join('\n'));
    }

    logger.log('[InvoiceService] Invoice Type:', invoice.invoiceType);
    logger.log('[InvoiceService] Invoice Type name:', InvoiceType[invoice.invoiceType as unknown as number]);

    const dte = this.createDTEFromInvoice(invoice, company);
    return this.Sync(dte, credentials);
  }

  async Sync(
    dte: DTE_Base,
    credentials: ServiceCredentials,
    retryCount: number = 0
  ): Promise<DTEResponseWrapper> {
    const MAX_RETRIES = 3;

    try {
      logger.log(`[InvoiceService] Submitting DTE to government API${retryCount > 0 ? ` (retry ${retryCount}/${MAX_RETRIES})` : ''}`);

      const formattedDTE = this.formatDTEDates(dte);
      const sanitizedDTE = deepOmitUndefinedEnhanced(formattedDTE);

      if (sanitizedDTE.identificacion?.tipoDte === '01' && (sanitizedDTE as unknown as Record<string, unknown>).documentoRelacionado === undefined) {
        (sanitizedDTE as unknown as Record<string, unknown>).documentoRelacionado = null;
      }

      const endpoint = this.getPayloadDTEEndpoint(sanitizedDTE);

      const headers = {
        [API_HEADERS.API_KEY]: API_CONFIG.apiKey,
        [API_HEADERS.CERTIFICATE_KEY]: credentials.key,
        [API_HEADERS.MH_USER]: credentials.user,
        [API_HEADERS.MH_KEY]: credentials.credential,
        [API_HEADERS.INVOICE_NUMBER]: credentials.invoiceNumber,
        [API_HEADERS.CONTENT_TYPE]: 'application/json'
      };

      const response = await this.httpClient.post<DTEResponseWrapper>(
        endpoint,
        sanitizedDTE,
        { headers }
      );

      // Mirror to Azure cloud for signed-in users (non-blocking)
      this.mirrorToCloud(sanitizedDTE);

      return response;
    } catch (error) {
      console.error('[InvoiceService] DTE SYNC FAILED:', error);

      // A "YA EXISTE UN REGISTRO" rejection is surfaced as-is — never retried
      // under a regenerated codigoGeneracion/numeroControl (that issued a
      // second fiscal document for the same sale). See SyncLocal.
      if (error instanceof ApiError) {
        if (error.details) {
          try {
            const dteError: DTEErrorResponseWrapper = error.details as DTEErrorResponseWrapper;

            if (dteError.observaciones && Array.isArray(dteError.observaciones)) {
              const errors = [...dteError.observaciones];
              if (dteError.descripcionMsg) {
                errors.push(dteError.descripcionMsg);
              }
              const customErrorMessage = errors.join('\n');

              if (customErrorMessage.includes('NO CORRESPONDE A CONTRIBUYENTE')) {
                const enhancedMessage = `Validation Error: The company's NRC doesn't match a valid taxpayer.\n\n` +
                  `Current NRC: ${dte.emisor?.nrc || 'Not provided'}\n` +
                  `Current NIT: ${dte.emisor?.nit || 'Not provided'}\n\n` +
                  `Original error: ${customErrorMessage}`;
                throw new ApiError(enhancedMessage, error.statusCode);
              }

              throw new ApiError(customErrorMessage, error.statusCode);
            }
          } catch (parseError) {
            if (parseError instanceof ApiError) {
              throw parseError;
            }
          }
        }
      }
      throw error;
    }
  }

  private generateUUID(): string {
    return crypto.randomUUID().toUpperCase();
  }

  private getDTEEndpoint(tipoDte?: string, tipoEvento?: string): string {
    return getConfiguredDTEEndpoint(tipoDte, tipoEvento);
  }

  private formatDTEDates(dte: DTE_Base): DTE_Base {
    // fecEmi is an El Salvador calendar date. `toISOString()` gave the UTC date
    // (tomorrow from 18:00 SV) and `new Date('YYYY-MM-DD')` reads UTC midnight.
    const fecEmi = svDateOf(dte.identificacion.fecEmi as unknown as Date | string) ||
      dte.identificacion.fecEmi;
    return {
      ...dte,
      identificacion: {
        ...dte.identificacion,
        fecEmi,
      }
    };
  }

  async uploadCertificate(certificateData: string, nit: string): Promise<boolean> {
    try {
      logger.log('[InvoiceService] Uploading certificate');
      const headers = {
        [API_HEADERS.API_KEY]: API_CONFIG.apiKey,
        [API_HEADERS.MH_USER]: nit,
        [API_HEADERS.CONTENT_TYPE]: 'application/json'
      };
      await this.httpClient.post('/document/upload', certificateData, { headers });
      return true;
    } catch (error) {
      console.error('[InvoiceService] Certificate upload failed', error);
      throw error;
    }
  }

  async validateCertificate(nit: string, certificateKey: string): Promise<boolean> {
    try {
      if (!certificateKey || certificateKey.trim() === '') return false;
      if (!nit || nit.trim() === '') return false;

      const headers = {
        [API_HEADERS.API_KEY]: API_CONFIG.apiKey,
        [API_HEADERS.CERTIFICATE_KEY]: certificateKey.trim(),
        [API_HEADERS.MH_USER]: nit.trim()
      };

      const response = await this.httpClient.post<unknown>('/settings/certificate/validate', {}, { headers });
      return response === 'true' || response === true;
    } catch {
      return false;
    }
  }

  async validateCredentials(nit: string, password: string, forceRefresh: boolean = false): Promise<boolean> {
    try {
      if (!nit || nit.trim() === '') return false;
      if (!password || password.trim() === '') return false;

      const headers = {
        [API_HEADERS.API_KEY]: API_CONFIG.apiKey,
        [API_HEADERS.MH_USER]: nit.trim(),
        [API_HEADERS.MH_KEY]: password,
        [API_HEADERS.CONTENT_TYPE]: 'application/json'
      };

      await this.httpClient.get(`/account/validate?forceRefresh=${forceRefresh}`, { headers });
      return true;
    } catch {
      return false;
    }
  }

  async uploadPDF(pdfData: string, controlNumber: string, nit: string): Promise<void> {
    try {
      await this.httpClient.post('/document/pdf/upload', pdfData, {
        headers: {
          [API_HEADERS.API_KEY]: API_CONFIG.apiKey,
          [API_HEADERS.MH_USER]: nit,
          [API_HEADERS.INVOICE_NUMBER]: controlNumber,
          [API_HEADERS.CONTENT_TYPE]: 'application/json',
        },
      });
    } catch (error) {
      console.error('[InvoiceService] PDF upload failed:', error);
      throw error;
    }
  }

  async uploadDTEJson(dteJson: string, controlNumber: string, nit: string): Promise<void> {
    try {
      await this.httpClient.post('/document/json/upload', dteJson, {
        headers: {
          [API_HEADERS.API_KEY]: API_CONFIG.apiKey,
          [API_HEADERS.MH_USER]: nit,
          [API_HEADERS.INVOICE_NUMBER]: controlNumber,
          [API_HEADERS.CONTENT_TYPE]: 'application/json',
        },
      });
    } catch (error) {
      // Non-fatal: backup failure should not block the sync result
      console.error('[InvoiceService] DTE JSON backup failed (non-fatal):', error);
    }
  }

  async invalidateDocument(dte: DTE_InvalidationRequest, credentials: ServiceCredentials): Promise<boolean> {
    try {
      const headers = {
        [API_HEADERS.API_KEY]: API_CONFIG.apiKey,
        [API_HEADERS.CERTIFICATE_KEY]: credentials.key,
        [API_HEADERS.MH_USER]: credentials.user,
        [API_HEADERS.MH_KEY]: credentials.credential,
        [API_HEADERS.INVOICE_NUMBER]: credentials.invoiceNumber,
        [API_HEADERS.CONTENT_TYPE]: 'application/json'
      };

      await this.httpClient.post('/document/dte/invalidate/v3', dte, { headers });
      return true;
    } catch (error) {
      console.error('[InvoiceService] Document invalidation failed', error);

      if (error instanceof ApiError && error.details) {
        try {
          const dteError: DTEErrorResponseWrapper = error.details as DTEErrorResponseWrapper;
          if (dteError.observaciones && Array.isArray(dteError.observaciones)) {
            const errors = [...dteError.observaciones];
            if (dteError.descripcionMsg) errors.push(dteError.descripcionMsg);
            throw new ApiError(errors.join('\n'), error.statusCode);
          }
        } catch (parseError) {
          if (parseError instanceof ApiError) throw parseError;
        }
      }
      throw error;
    }
  }

  async sendContingencyRequest(contingencyRequest: ContingenciaRequest, credentials: ServiceCredentials): Promise<boolean> {
    try {
      logger.log(`[InvoiceService] Sending contingency request for ${contingencyRequest.detalleDTE.length} invoices`);
      const headers = {
        [API_HEADERS.API_KEY]: API_CONFIG.apiKey,
        [API_HEADERS.CERTIFICATE_KEY]: credentials.key,
        [API_HEADERS.MH_USER]: credentials.user,
        [API_HEADERS.MH_KEY]: credentials.credential,
        [API_HEADERS.INVOICE_NUMBER]: credentials.invoiceNumber,
        [API_HEADERS.CONTENT_TYPE]: 'application/json'
      };

      const formattedRequest = {
        ...contingencyRequest,
        detalleDTE: contingencyRequest.detalleDTE.map(item => ({
          ...item,
          fechaEmi: item.fechaEmi ? svDateOf(item.fechaEmi) || item.fechaEmi : undefined
        }))
      };

      await this.httpClient.post('/document/contingencia/report', formattedRequest, { headers });
      return true;
    } catch (error) {
      console.error('[InvoiceService] Contingency request failed', error);
      throw error;
    }
  }

  async getDocumentFromStorage(path: string): Promise<DTE_Base> {
    return this.httpClient.get<DTE_Base>(path);
  }

  async deactivateAccount(email: string, userId: string): Promise<void> {
    const headers = {
      [API_HEADERS.API_KEY]: API_CONFIG.apiKey,
      [API_HEADERS.USER_ID]: userId,
      [API_HEADERS.MH_USER]: email,
      [API_HEADERS.CONTENT_TYPE]: 'application/json'
    };
    await this.httpClient.post('/account/deactivate', {}, { headers });
  }

  async deleteAccount(email: string, userId: string): Promise<void> {
    const headers = {
      [API_HEADERS.API_KEY]: API_CONFIG.apiKey,
      [API_HEADERS.USER_ID]: userId,
      [API_HEADERS.MH_USER]: email,
      [API_HEADERS.CONTENT_TYPE]: 'application/json'
    };
    await this.httpClient.post('/account/delete', {}, { headers });
  }

  async requestPromoCode(userId: string, email: string, nit?: string, promoCodeRequest?: string): Promise<PromoResponse> {
    const requestModel: PromoCodeRequest = { userId, email, nit, promoCodeRequest };
    const headers = { [API_HEADERS.API_KEY]: API_CONFIG.apiKey, [API_HEADERS.CONTENT_TYPE]: 'application/json' };
    return this.httpClient.post<PromoResponse>('/promo', requestModel, { headers });
  }

  async checkPromoStatus(orderReference: string): Promise<PromoStatus> {
    const headers = { [API_HEADERS.API_KEY]: API_CONFIG.apiKey };
    return this.httpClient.get<PromoStatus>(`/promo/status?orderReference=${orderReference}`, { headers });
  }

  async getAllEmailAccounts(): Promise<EmailAccount[]> {
    return this.httpClient.get<EmailAccount[]>('/email-settings', { headers: { [API_HEADERS.AUTHORIZATION]: API_CONFIG.apiKey } });
  }

  async getEmailAccount(nit: string): Promise<EmailAccount | null> {
    try {
      return await this.httpClient.get<EmailAccount>(`/email-settings/${nit}`, { headers: { [API_HEADERS.AUTHORIZATION]: API_CONFIG.apiKey } });
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 404) return null;
      throw error;
    }
  }

  async saveEmailSettings(emailAccount: EmailAccount, nit: string): Promise<EmailAccount> {
    const existingAccount = await this.getEmailAccount(nit);
    if (existingAccount) {
      return this.httpClient.put<EmailAccount>(`/email-settings/${nit}`, emailAccount, { headers: { [API_HEADERS.AUTHORIZATION]: API_CONFIG.apiKey, [API_HEADERS.CONTENT_TYPE]: 'application/json' } });
    } else {
      return this.httpClient.post<EmailAccount>(`/email-settings/${nit}`, emailAccount, { headers: { [API_HEADERS.AUTHORIZATION]: API_CONFIG.apiKey, [API_HEADERS.CONTENT_TYPE]: 'application/json' } });
    }
  }

  async deleteEmailAccount(nit: string): Promise<void> {
    await this.httpClient.delete(`/email-settings/${nit}`, { headers: { [API_HEADERS.AUTHORIZATION]: API_CONFIG.apiKey } });
  }

  async deactivateEmailAccount(nit: string): Promise<void> {
    await this.httpClient.patch(`/email-settings/${nit}/deactivate`, {}, { headers: { [API_HEADERS.AUTHORIZATION]: API_CONFIG.apiKey } });
  }

  async fetchPurchases(nit: string): Promise<PurchaseResponse> {
    return this.httpClient.get<PurchaseResponse>(`/purchases/${nit}`, { headers: { [API_HEADERS.API_KEY]: API_CONFIG.apiKey } });
  }

  setEnvironment(isProduction: boolean): void {
    this.isProduction = isProduction;
    this.httpClient = getHttpClient(isProduction);
  }

  getEnvironmentCode(): string {
    return getApiConfig(this.isProduction).environmentCode;
  }

  getProductionEnvornmentCode(): string {
    return '01';
  }
}

// Singleton instance
let invoiceServiceInstance: InvoiceService | null = null;

export const getInvoiceService = (isProduction?: boolean): InvoiceService => {
  if (!invoiceServiceInstance || (isProduction !== undefined)) {
    invoiceServiceInstance = new InvoiceService(isProduction);
  }
  return invoiceServiceInstance;
};

export default InvoiceService;
