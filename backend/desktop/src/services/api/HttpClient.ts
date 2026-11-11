// HTTP Client implementation matching Swift functionality

import { logger } from '../../utils/logger';
import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  AxiosError,
  InternalAxiosRequestConfig
} from 'axios';

// Extended request config for custom properties
interface ExtendedAxiosRequestConfig extends InternalAxiosRequestConfig {
  skipAuth?: boolean;
  retries?: number;
}

// Error response data interface
interface ErrorResponseData {
  observaciones?: string[];
  descripcionMsg?: string;
  message?: string;
  error?: string;
}

import {
  API_CONFIG,
  API_HEADERS,
  DEFAULT_HEADERS,
  HTTP_STATUS,
  API_ERROR_CODES,
  RETRY_CONFIG,
  getApiConfig
} from '../../config/api';

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: string = API_ERROR_CODES.UNKNOWN_ERROR,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static isNetworkError(error: ApiError): boolean {
    return error.code === API_ERROR_CODES.NETWORK_ERROR;
  }

  static isUnauthorized(error: ApiError): boolean {
    return error.statusCode === HTTP_STATUS.UNAUTHORIZED;
  }

  static isServerError(error: ApiError): boolean {
    return error.statusCode >= HTTP_STATUS.INTERNAL_SERVER_ERROR;
  }

  static isRetryable(error: ApiError): boolean {
    return RETRY_CONFIG.retryOn.includes(error.statusCode) ||
           error.code === API_ERROR_CODES.NETWORK_ERROR ||
           error.code === API_ERROR_CODES.TIMEOUT;
  }
}

export interface RequestConfig extends AxiosRequestConfig {
  skipAuth?: boolean;
  retries?: number;
  timeout?: number;
}

export class HttpClient {
  private client: AxiosInstance;
  private isProduction: boolean;
  private baseURL: string;

  constructor(isProduction: boolean = false) {
    this.isProduction = isProduction;
    const config = getApiConfig(isProduction);
    this.baseURL = config.baseUrl;

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: API_CONFIG.timeout,
      headers: DEFAULT_HEADERS,
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // Request interceptor
    this.client.interceptors.request.use(
      async (config: ExtendedAxiosRequestConfig) => {
        if (!config.skipAuth) {
          await this.addAuthHeaders(config);
        }

        if (import.meta.env.DEV) {
          logger.log(`${config.method?.toUpperCase()} ${config.baseURL}${config.url}`);
          if (config.data) {
            logger.log('Request Data:', config.data);
          }
        }

        return config;
      },
      (error) => {
        console.error('Request Error:', error);
        return Promise.reject(this.createApiError(error));
      }
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => {
        if (import.meta.env.DEV) {
          logger.log(`${response.status} ${response.config.method?.toUpperCase()} ${response.config.url}`);
          logger.log('Response Data:', JSON.stringify(response.data, null, 2));
        }
        return response;
      },
      async (error) => {
        const apiError = this.createApiError(error);

        if (import.meta.env.DEV) {
          console.error(`${error.response?.status || 'Network'} ${error.config?.method?.toUpperCase()} ${error.config?.url}`);
          console.error('Error:', apiError.message);
        }

        if (apiError.statusCode === HTTP_STATUS.UNAUTHORIZED) {
          await this.handleUnauthorized();
        }

        if (this.shouldRetry(error)) {
          return this.retryRequest(error);
        }

        return Promise.reject(apiError);
      }
    );
  }

  private async addAuthHeaders(config: ExtendedAxiosRequestConfig): Promise<void> {
    try {
      const credentials = await this.getCurrentCredentials();

      if (credentials) {
        config.headers = config.headers ?? {};
        (config.headers as Record<string, string>)[API_HEADERS.MH_USER] = credentials.user;
        (config.headers as Record<string, string>)[API_HEADERS.MH_KEY] = credentials.password;

        if (credentials.certificateKey) {
          (config.headers as Record<string, string>)[API_HEADERS.CERTIFICATE_KEY] = credentials.certificateKey;
        }

        if (credentials.invoiceNumber) {
          (config.headers as Record<string, string>)[API_HEADERS.INVOICE_NUMBER] = credentials.invoiceNumber;
        }
      }

      const authToken = await this.getAuthToken();
      if (authToken) {
        config.headers = config.headers ?? {};
        (config.headers as Record<string, string>)[API_HEADERS.AUTHORIZATION] = `Bearer ${authToken}`;
      }
    } catch (error) {
      logger.warn('Failed to add auth headers:', error);
    }
  }

  private async getCurrentCredentials(): Promise<{ user: string; password: string; certificateKey?: string; invoiceNumber?: string } | null> {
    try {
      const { SecureStorageService } = await import('../security/SecureStorageService');
      const nit = await SecureStorageService.getCurrentCompanyNit();
      if (!nit) return null;
      return await SecureStorageService.getCredentials(nit);
    } catch {
      return null;
    }
  }

  private async getAuthToken(): Promise<string | null> {
    try {
      const { SecureStorageService } = await import('../security/SecureStorageService');
      return await SecureStorageService.getAuthToken();
    } catch {
      return null;
    }
  }

  private createApiError(error: AxiosError): ApiError {
    if (error.response) {
      const { status, data } = error.response;
      let message = 'An error occurred';
      let code = API_ERROR_CODES.UNKNOWN_ERROR;

      if (import.meta.env.DEV) {
        logger.log(`Network diagnostic info:`);
        logger.log(`   Request URL: ${error.config?.baseURL}${error.config?.url}`);
        logger.log(`   Status: ${status}`);
        logger.log(`   Request method: ${error.config?.method?.toUpperCase()}`);
      }

      if (typeof data === 'string') {
        message = data;
      } else if (data && typeof data === 'object') {
        const errorData = data as ErrorResponseData;
        if (errorData.observaciones && Array.isArray(errorData.observaciones)) {
          const errors = [...errorData.observaciones];
          if (errorData.descripcionMsg) {
            errors.push(errorData.descripcionMsg);
          }
          message = errors.join('\n');
          code = API_ERROR_CODES.DTE_ERROR;
        } else if (errorData.message) {
          message = errorData.message;
        } else if (errorData.error) {
          message = errorData.error;
        } else if (errorData.descripcionMsg) {
          message = errorData.descripcionMsg;
        }
      }

      switch (status) {
        case HTTP_STATUS.UNAUTHORIZED:
          code = API_ERROR_CODES.UNAUTHORIZED;
          break;
        case HTTP_STATUS.FORBIDDEN:
          code = API_ERROR_CODES.FORBIDDEN;
          break;
        case HTTP_STATUS.NOT_FOUND:
          code = API_ERROR_CODES.NOT_FOUND;
          break;
        case HTTP_STATUS.UNPROCESSABLE_ENTITY:
          code = API_ERROR_CODES.VALIDATION_ERROR;
          break;
        case HTTP_STATUS.INTERNAL_SERVER_ERROR:
        case HTTP_STATUS.BAD_GATEWAY:
        case HTTP_STATUS.SERVICE_UNAVAILABLE:
        case HTTP_STATUS.GATEWAY_TIMEOUT:
          code = API_ERROR_CODES.SERVER_ERROR;
          break;
      }

      return new ApiError(message, status, code, data);
    } else if (error.request) {
      if (import.meta.env.DEV) {
        logger.log(`Network error diagnostic info:`);
        logger.log(`   Error code: ${error.code}`);
        logger.log(`   Request timeout: ${error.config?.timeout}ms`);
        logger.log(`   Base URL: ${error.config?.baseURL}`);
      }

      let message = 'Network error - please check your internet connection';
      if (error.code === 'ECONNABORTED') {
        message = 'Request timeout - server took too long to respond';
      } else if (error.code === 'ENOTFOUND') {
        message = 'DNS resolution failed - cannot reach server';
      } else if (error.code === 'ECONNREFUSED') {
        message = 'Connection refused - server is not accepting connections';
      }

      return new ApiError(message, 0, API_ERROR_CODES.NETWORK_ERROR);
    } else {
      return new ApiError(
        error.message || 'Unknown error occurred',
        -1,
        API_ERROR_CODES.UNKNOWN_ERROR
      );
    }
  }

  private async handleUnauthorized(): Promise<void> {
    logger.log('Handling unauthorized access');
  }

  private shouldRetry(error: AxiosError): boolean {
    const config = error.config as ExtendedAxiosRequestConfig;
    const retries = config?.retries || 0;
    return retries < RETRY_CONFIG.maxRetries &&
           RETRY_CONFIG.retryOn.includes(error.response?.status || 0);
  }

  private async retryRequest(error: AxiosError): Promise<AxiosResponse> {
    const config = error.config as ExtendedAxiosRequestConfig;
    const retries = (config.retries || 0) + 1;
    const delay = Math.min(
      RETRY_CONFIG.baseDelay * Math.pow(2, retries - 1),
      RETRY_CONFIG.maxDelay
    );

    logger.log(`Retrying request (${retries}/${RETRY_CONFIG.maxRetries}) in ${delay}ms`);

    await new Promise(resolve => setTimeout(resolve, delay));

    config.retries = retries;
    return this.client(config);
  }

  // HTTP Methods
  async get<T>(url: string, config?: RequestConfig): Promise<T> {
    const response = await this.client.get<T>(url, config);
    return response.data;
  }

  async post<T>(url: string, data?: unknown, config?: RequestConfig): Promise<T> {
    const response = await this.client.post<T>(url, data, config);
    return response.data;
  }

  async put<T>(url: string, data?: unknown, config?: RequestConfig): Promise<T> {
    const response = await this.client.put<T>(url, data, config);
    return response.data;
  }

  async patch<T>(url: string, data?: unknown, config?: RequestConfig): Promise<T> {
    const response = await this.client.patch<T>(url, data, config);
    return response.data;
  }

  async delete<T>(url: string, config?: RequestConfig): Promise<T> {
    const response = await this.client.delete<T>(url, config);
    return response.data;
  }

  getBaseURL(): string {
    return this.baseURL;
  }

  isProductionEnvironment(): boolean {
    return this.isProduction;
  }

  setEnvironment(isProduction: boolean): void {
    this.isProduction = isProduction;
    const config = getApiConfig(isProduction);
    this.baseURL = config.baseUrl;
    this.client.defaults.baseURL = this.baseURL;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.get('/health', { skipAuth: true, timeout: 5000 });
      return true;
    } catch (error) {
      logger.warn('Health check failed:', error);
      return false;
    }
  }
}

// Singleton instance
let httpClientInstance: HttpClient | null = null;

export const getHttpClient = (isProduction?: boolean): HttpClient => {
  if (!httpClientInstance || (isProduction !== undefined && httpClientInstance.isProductionEnvironment() !== isProduction)) {
    httpClientInstance = new HttpClient(isProduction);
  }
  return httpClientInstance;
};

export default HttpClient;
