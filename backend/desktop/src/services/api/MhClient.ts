// Direct Government API Client
// Replaces the .NET MHServiceClient - communicates directly with api.dtes.mh.gob.sv
// Handles authentication, DTE submission, invalidation, contingency, and search

import axios, { AxiosInstance } from 'axios';
import {
  MhAuthResponse,
  MhCredentials,
  DTESubmitParams,
  DTEEventSubmitParams,
  DTEInvalidateParams,
  DTESearchParams,
  DTEResponse,
  MhApiConfig,
} from './MhClient.types';
import { SyncLogger } from './SyncLogger';
import { TelemetryService } from '../telemetry/TelemetryService';
import { TelemetryEvent } from '../../config/telemetryConfig';

// Government API base URLs
const MH_API_URLS = {
  test: 'https://apitest.dtes.mh.gob.sv',
  production: 'https://api.dtes.mh.gob.sv',
};

// Government API endpoints — exact paths from the Manual Técnico v2.0 §6.2
// ("sin barra final"). recepcionevento (events 17/18) is not in the manual;
// it keeps the path MH has accepted so far.
const MH_ENDPOINTS = {
  auth: '/seguridad/auth',
  submitDTE: '/fesv/recepciondte',
  submitEvent: '/fesv/recepcionevento/',
  invalidateDTE: '/fesv/anulardte',
  contingency: '/fesv/contingencia',
  searchDTE: '/fesv/recepcion/consultadte',
};

interface MhBridgeHttpError extends Error {
  status: number;
  responseData?: unknown;
  /** Main-process classification of a transport failure (status 0). */
  errorKind?: string;
  errorCode?: string;
}

/**
 * What the main-process MH proxy (electron/mhProxy.cjs) answers. A transport
 * failure (status 0) carries `errorKind` (timeout | dns | refused | reset |
 * connect-timeout | unreachable | tls | redirect | network | blocked |
 * invalid) and `errorCode`; its `error` text never contains the request body
 * or headers.
 */
type MhProxyResult = Awaited<ReturnType<NonNullable<NonNullable<Window['electronAPI']>['mhFetch']>>> & {
  errorKind?: string;
  errorCode?: string;
};

/** Non-sensitive transport details for telemetry (never NIT, password or token). */
interface AuthTransportFailure {
  errorKind?: string;
  errorCode?: string;
  error?: string;
}

function bridgeFailureOf(error: MhBridgeHttpError): AuthTransportFailure | undefined {
  if (error.status !== 0) return undefined;
  return { errorKind: error.errorKind ?? 'network', errorCode: error.errorCode, error: error.message };
}

function isMhBridgeHttpError(error: unknown): error is MhBridgeHttpError {
  return error instanceof Error && error.name === 'MhBridgeHttpError';
}

/**
 * The MH user for /seguridad/auth is the emisor's NIT digits — the same value the
 * DTE carries in emisor.nit, which is why DTE submission authenticated fine. The
 * stored credential user is free text, though ("0614-140494-134-2"), so the
 * invalidation, contingency and credential-check paths authenticated as a
 * different user. Only NIT/DUI-shaped values are normalized; anything else
 * passes through trimmed.
 */
export const normalizeMhUser = (userName: string): string => {
  const trimmed = (userName || '').trim();
  return /^[\d\s-]+$/.test(trimmed) ? trimmed.replace(/\D/g, '') : trimmed;
};

/** Hacienda rejected the user/password (HTTP 200 + status ERROR). */
class MhAuthRejectedError extends Error {
  constructor() {
    super('Error al autenticar usuario, verifique sus credenciales de hacienda');
    this.name = 'MhAuthRejectedError';
  }
}

export class MhClient {
  private httpClient: AxiosInstance;
  private config: MhApiConfig;

  // Token cache (mirrors .NET CacheService with 23-hour expiry)
  private cachedTokens = new Map<string, { token: string; expiresAt: number }>();
  private static readonly TOKEN_DURATION_MS = 23 * 60 * 60 * 1000; // 23 hours

  constructor(isProduction: boolean = false) {
    this.config = {
      baseUrl: isProduction ? MH_API_URLS.production : MH_API_URLS.test,
      isProduction,
    };

    this.httpClient = axios.create({
      baseURL: this.config.baseUrl,
      timeout: 300000, // 5 minutes — MH API can be slow under load
    });
  }

  /**
   * Authenticate with the government API.
   * Equivalent to .NET MHServiceClient.AuthenticateAsync()
   */
  async authenticate(credentials: MhCredentials): Promise<string> {
    const authStartMs = Date.now();
    try {
      const params = new URLSearchParams({
        user: normalizeMhUser(credentials.userName),
        pwd: credentials.password,
      });

      const response = await this.postAuth(params.toString());

      if (!response.data || response.data.status === 'ERROR') {
        this.trackAuthFailure('authenticate', response.status, response.data?.body);
        throw new MhAuthRejectedError();
      }

      const token = response.data.body.token;
      if (!token) {
        throw new Error('Error al autenticar usuario');
      }

      // Cache the token
      this.cachedTokens.set(normalizeMhUser(credentials.userName), {
        token,
        expiresAt: Date.now() + MhClient.TOKEN_DURATION_MS,
      });

      TelemetryService.trackDependency(
        'MhClient.authenticate',
        this.config.baseUrl.replace('https://', ''),
        Date.now() - authStartMs,
        true,
        200
      );

      return token;
    } catch (error) {
      if (error instanceof MhAuthRejectedError) {
        SyncLogger.logSyncError('AUTH', error);
        throw error;
      }
      if (axios.isAxiosError(error)) {
        console.error(
          '[MhClient] Auth failed:',
          error.response?.status,
          error.response?.data
        );
        SyncLogger.logSyncError('AUTH', error, error.response?.status);
        TelemetryService.trackDependency(
          'MhClient.authenticate',
          this.config.baseUrl.replace('https://', ''),
          Date.now() - authStartMs,
          false,
          error.response?.status ?? 0
        );
        TelemetryService.trackEvent(TelemetryEvent.AuthError, {
          statusCode: error.response?.status,
          step: 'authenticate',
        });
      } else if (isMhBridgeHttpError(error)) {
        const authResponse = error.responseData as MhAuthResponse | undefined;
        this.trackAuthFailure('authenticate', error.status, authResponse?.body, bridgeFailureOf(error));
        SyncLogger.logSyncError('AUTH', error, error.status);
      } else {
        SyncLogger.logSyncError('AUTH', error);
        TelemetryService.trackException(error, { step: 'authenticate' });
        TelemetryService.trackEvent(TelemetryEvent.AuthError, { step: 'authenticate' });
      }
      throw new Error(
        'Error al autenticar usuario, verifique sus credenciales de hacienda'
      );
    }
  }

  /**
   * Validate NIT/password against /seguridad/auth WITHOUT touching the token
   * cache. Returns the HTTP status so callers can tell "rejected by MH" (4xx,
   * or a 2xx whose body says ERROR) apart from "MH unreachable" (0 / 5xx).
   * Parity with the RN client and SwiftUI's MHDirectClient.validateCredentials.
   */
  async validateCredentials(
    credentials: MhCredentials
  ): Promise<{ valid: boolean; statusCode?: number }> {
    try {
      const params = new URLSearchParams({
        user: normalizeMhUser(credentials.userName),
        pwd: credentials.password,
      });
      const response = await this.postAuth(params.toString());
      const valid =
        !!response.data && response.data.status !== 'ERROR' && !!response.data.body?.token;
      if (!valid) {
        this.trackAuthFailure('validate-credentials', response.status, response.data?.body);
      }
      return { valid, statusCode: response.status };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        SyncLogger.logSyncError('AUTH-VALIDATE', error, error.response?.status);
        this.trackAuthFailure(
          'validate-credentials',
          error.response?.status ?? 0,
          (error.response?.data as MhAuthResponse | undefined)?.body,
          error.response ? undefined : { errorKind: error.code === 'ECONNABORTED' ? 'timeout' : 'network', errorCode: error.code },
        );
        return { valid: false, statusCode: error.response?.status ?? 0 };
      }
      if (isMhBridgeHttpError(error)) {
        const authResponse = error.responseData as MhAuthResponse | undefined;
        SyncLogger.logSyncError('AUTH-VALIDATE', error, error.status);
        this.trackAuthFailure('validate-credentials', error.status, authResponse?.body, bridgeFailureOf(error));
        return { valid: false, statusCode: error.status };
      }
      return { valid: false, statusCode: -1 };
    }
  }

  /**
   * Authenticate through Electron's restricted main-process proxy when it is
   * available. MH production and test hosts do not always expose identical
   * browser CORS behavior; using the same transport for both avoids a renderer
   * CORS failure being reported as invalid production credentials.
   */
  private async postAuth(body: string): Promise<{ status: number; data: MhAuthResponse }> {
    const electronMhFetch =
      typeof window !== 'undefined' ? window.electronAPI?.mhFetch : undefined;

    if (electronMhFetch) {
      const response: MhProxyResult = await electronMhFetch({
        url: `${this.config.baseUrl}${MH_ENDPOINTS.auth}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body,
      });
      let parsed: MhAuthResponse | undefined;
      try {
        parsed = response.body ? JSON.parse(response.body) as MhAuthResponse : undefined;
      } catch {
        parsed = undefined;
      }
      if (response.ok && parsed) return { status: response.status, data: parsed };

      const error = new Error(response.error || response.body || `Error MH HTTP ${response.status}`) as MhBridgeHttpError;
      error.name = 'MhBridgeHttpError';
      error.status = response.status;
      error.responseData = parsed;
      error.errorKind = response.errorKind;
      error.errorCode = response.errorCode;
      throw error;
    }

    // Browser fallback for non-Electron contexts (for example web previews).
    return axios.post<MhAuthResponse>(
      `${this.config.baseUrl}${MH_ENDPOINTS.auth}`,
      body,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        timeout: 30000,
      },
    );
  }

  /**
   * Hacienda answers a bad user/password with HTTP 200 + status ERROR. Records
   * the host and what MH said — never the credentials — so a rejected password
   * can be told apart from a wrong environment or an unreachable host.
   */
  private trackAuthFailure(
    step: string,
    statusCode: number,
    body?: MhAuthResponse['body'],
    transport?: AuthTransportFailure,
  ): void {
    TelemetryService.trackEvent(TelemetryEvent.AuthError, {
      step,
      host: this.config.baseUrl.replace('https://', ''),
      statusCode,
      mhCode: body?.codigoMsg,
      mhMessage: body?.descripcionMsg?.slice(0, 200),
      // Status 0 = Hacienda never answered: say why (timeout, DNS, TLS…).
      // The proxy's text is built from error codes only, never the request.
      ...(transport
        ? {
            errorKind: transport.errorKind,
            errorCode: transport.errorCode,
            error: transport.error?.slice(0, 200),
          }
        : {}),
    });
  }

  /**
   * Get a valid token, using cache or refreshing if needed.
   */
  async getToken(
    credentials: MhCredentials,
    forceRefresh: boolean = false
  ): Promise<string> {
    if (!forceRefresh) {
      const cached = this.cachedTokens.get(normalizeMhUser(credentials.userName));
      if (cached && cached.expiresAt > Date.now()) {
        return cached.token;
      }
    }

    return this.authenticate(credentials);
  }

  /**
   * Submit a signed DTE to the government API.
   */
  async submitDTE(
    params: DTESubmitParams,
    credentials: MhCredentials
  ): Promise<DTEResponse> {
    return this.executeWithAuth(MH_ENDPOINTS.submitDTE, params, credentials);
  }

  /**
   * Submit a signed DTE event to the government API.
   */
  async submitEvent(
    params: DTEEventSubmitParams,
    credentials: MhCredentials
  ): Promise<DTEResponse> {
    return this.executeWithAuth(MH_ENDPOINTS.submitEvent, params, credentials);
  }

  /**
   * Invalidate/annul a DTE.
   */
  async invalidateDTE(
    params: DTEInvalidateParams,
    credentials: MhCredentials
  ): Promise<DTEResponse> {
    return this.executeWithAuth(MH_ENDPOINTS.invalidateDTE, params, credentials);
  }

  /**
   * Submit contingency batch.
   */
  async submitContingency(
    params: DTESubmitParams,
    credentials: MhCredentials
  ): Promise<DTEResponse> {
    return this.executeWithAuth(MH_ENDPOINTS.contingency, params, credentials);
  }

  /**
   * Search/query a DTE.
   */
  async searchDTE(
    params: DTESearchParams,
    credentials: MhCredentials
  ): Promise<DTEResponse> {
    return this.executeWithAuth(MH_ENDPOINTS.searchDTE, params, credentials);
  }

  /**
   * Execute an authenticated request with automatic token refresh on 401.
   */
  private async executeWithAuth(
    endpoint: string,
    payload: unknown,
    credentials: MhCredentials
  ): Promise<DTEResponse> {
    const token = await this.getToken(credentials);

    try {
      return await this.postWithToken(endpoint, payload, token);
    } catch (error) {
      if (axios.isAxiosError(error) || isMhBridgeHttpError(error)) {
        const status = axios.isAxiosError(error) ? error.response?.status : error.status;
        const responseData = axios.isAxiosError(error)
          ? error.response?.data
          : error.responseData;

        console.error(
          `[MhClient] ${endpoint} failed:`,
          status,
          responseData
        );

        // Retry on 401 Unauthorized with fresh token
        if (status === 401 || (axios.isAxiosError(error) && !error.response)) {
          console.log('[MhClient] Retrying with fresh token...');
          const freshToken = await this.getToken(credentials, true);

          try {
            return await this.postWithToken(endpoint, payload, freshToken);
          } catch (retryError) {
            const retryStatus = axios.isAxiosError(retryError)
              ? retryError.response?.status
              : isMhBridgeHttpError(retryError)
                ? retryError.status
                : undefined;
            if (retryStatus === 401) {
              return {
                version: 0,
                ambiente: '',
                versionApp: 0,
                estado: 'ERROR',
                codigoGeneracion: '',
                selloRecibido: null,
                fhProcesamiento: '',
                clasificaMsg: '',
                codigoMsg: '',
                descripcionMsg: '',
                observaciones: [
                  'Error al enviar documento a hacienda, verifique sus credenciales',
                ],
              };
            }
            throw retryError;
          }
        }

        // Return error response if available
        if (responseData) {
          return responseData as DTEResponse;
        }
      }

      throw error;
    }
  }

  private async postWithToken(
    endpoint: string,
    payload: unknown,
    token: string,
  ): Promise<DTEResponse> {
    const headers = {
      Authorization: `Bearer ${token.replace('Bearer ', '')}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    const electronMhFetch =
      typeof window !== 'undefined' && endpoint.startsWith('/fesv/')
        ? window.electronAPI?.mhFetch
        : undefined;

    if (electronMhFetch) {
      const response = await electronMhFetch({
        url: `${this.config.baseUrl}${endpoint}`,
        method: 'POST',
        headers,
        body: payload,
      });

      const body = response.body ?? response.error ?? '';
      let parsed: unknown = null;
      if (body) {
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = null;
        }
      }

      if (response.ok && parsed) {
        return parsed as DTEResponse;
      }

      const message =
        response.error ||
        body ||
        `Error MH sin respuesta HTTP (${response.status})`;
      const error = new Error(message) as MhBridgeHttpError;
      error.name = 'MhBridgeHttpError';
      error.status = response.status;
      error.responseData = parsed as DTEResponse | undefined;
      throw error;
    }

    const response = await this.httpClient.post<DTEResponse>(
      endpoint,
      payload,
      { headers },
    );

    return response.data;
  }

  /**
   * Switch environment (test/production).
   */
  setEnvironment(isProduction: boolean): void {
    this.config = {
      baseUrl: isProduction ? MH_API_URLS.production : MH_API_URLS.test,
      isProduction,
    };
    this.httpClient.defaults.baseURL = this.config.baseUrl;
    this.cachedTokens.clear();
  }

  getConfig(): MhApiConfig {
    return { ...this.config };
  }
}

// Singleton instance
// Static import of MockMhClient so getMhClient() can synchronously return it
// when the E2E flag is active. See the getMhClient() implementation below.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- used below
import { MockMhClient as MockMhClientStatic } from './MockMhClient';

let mhClientInstance: MhClient | null = null;

// Mock mode — activated via localStorage key __mock_mh_api=true (Playwright E2E tests)
let useMockMhClient = false;
let mockClientInstance: MockMhClientInstance | null = null;

interface MockMhClientInstance {
  getConfig(): MhApiConfig;
  authenticate(c: MhCredentials): Promise<string>;
  getToken(c: MhCredentials, force?: boolean): Promise<string>;
  submitDTE(p: DTESubmitParams, c: MhCredentials): Promise<DTEResponse>;
  submitEvent(p: DTEEventSubmitParams, c: MhCredentials): Promise<DTEResponse>;
  invalidateDTE(p: DTEInvalidateParams, c: MhCredentials): Promise<DTEResponse>;
  submitContingency(p: DTESubmitParams, c: MhCredentials): Promise<DTEResponse>;
  searchDTE(p: DTESearchParams, c: MhCredentials): Promise<DTEResponse>;
}

export const enableMockMhClient = async (): Promise<void> => {
  useMockMhClient = true;
  const mod = await import('./MockMhClient');
  mockClientInstance = new mod.MockMhClient() as unknown as MockMhClientInstance;
  try {
    if (typeof localStorage !== 'undefined') {
      const scenario = localStorage.getItem('__mock_mh_scenario');
      if (scenario) {
        mod.MockMhClient.setScenario(scenario as any);
      }
    }
  } catch { /* ignore */ }
  console.log('[MhClient] Mock mode ENABLED — using MockMhClient');
};

export const isMockMhClientEnabled = (): boolean => useMockMhClient;

export const getMhClient = (isProduction?: boolean): MhClient => {
  // Auto-enable mock mode if localStorage flag is set (Playwright E2E tests).
  // Synchronous construction so the first getMhClient() call doesn't race the
  // dynamic import. MockMhClient is imported statically at the top of this
  // file in dev/test builds; production builds can tree-shake if the flag is
  // dead code (practically the extra ~2 KB is acceptable for this utility).
  if (!useMockMhClient) {
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('__mock_mh_api') === 'true') {
        mockClientInstance = new MockMhClientStatic() as unknown as MockMhClientInstance;
        useMockMhClient = true;
        try {
          const scenario = localStorage.getItem('__mock_mh_scenario');
          if (scenario) MockMhClientStatic.setScenario(scenario as any);
        } catch { /* ignore */ }
      }
    } catch { /* SSR/node safety */ }
  }

  if (useMockMhClient && mockClientInstance) {
    return mockClientInstance as unknown as MhClient;
  }

  if (
    !mhClientInstance ||
    (isProduction !== undefined &&
      mhClientInstance.getConfig().isProduction !== isProduction)
  ) {
    mhClientInstance = new MhClient(isProduction);
  }
  return mhClientInstance;
};

export default MhClient;
