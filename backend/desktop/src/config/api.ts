// API configuration matching Swift implementation

import { getViteEnv } from '@/config/viteEnv';

const configuredProductionApiBaseUrl = getViteEnv().VITE_API_BASE_URL?.replace(/\/+$/, '');

export const API_CONFIG = {
  production: {
    baseUrl: configuredProductionApiBaseUrl ?? 'https://k-invoices-api-prod.orangesand-e6d7151a.southcentralus.azurecontainerapps.io/api',
    environmentCode: '01', // Matches Swift exactly
    qrUrlBase: 'https://admin.factura.gob.sv/consultaPublica',
  },
  development: {
    baseUrl: 'https://k-invoices-api-prod.orangesand-e6d7151a.southcentralus.azurecontainerapps.io/api',
    environmentCode: '00', // Matches Swift exactly
    // Manual Técnico v2.0 §5: same host for ambiente 00; the ambiente is a query parameter.
    qrUrlBase: 'https://admin.factura.gob.sv/consultaPublica',
  },
  // Direct government API URLs (for local signing flow - bypasses Azure)
  governmentApi: {
    test: 'https://apitest.dtes.mh.gob.sv',
    production: 'https://api.dtes.mh.gob.sv',
  },
  // Consulta Publica — public DTE lookup (no auth required)
  consultaPublica: {
    test: 'https://admin.factura.gob.sv/test/consultas/publica/simple',
    production: 'https://admin.factura.gob.sv/prod/consultas/publica/simple',
  },
  timeout: 300000, // 5 minutes — MH API can be slow under load
  apiKey: 'eyJhbGciOiJFUzI1NiIsImtpZCI6IlVSS0VZSUQwMDEifQ', // Matches Swift exactly
  includedTax: 1.13, // Matches Swift exactly
  roundingScale: 2, // Matches Swift exactly
};

// API Header constants (matching Swift implementation exactly)
export const API_HEADERS = {
  API_KEY: 'apiKey', // ApiKeyHeaderName
  MH_USER: 'MH_USER', // Matches Swift constant exactly
  MH_KEY: 'MH_KEY', // Matches Swift constant exactly  
  CERTIFICATE_KEY: 'key', // CertificateKey - matches Swift exactly
  INVOICE_NUMBER: 'reference', // InvoiceNumber - matches Swift exactly
  USER_ID: 'userId',
  AUTHORIZATION: 'Authorization',
  CONTENT_TYPE: 'Content-Type'
};


// Environment helper
export const getApiConfig = (isProduction: boolean) => {
  return isProduction ? API_CONFIG.production : API_CONFIG.development;
};

// API endpoints
export const API_ENDPOINTS = {
  // Health check endpoint (at root domain, not under /api)
  HEALTH_CHECK: '',

  // Catalog endpoints
  CATALOG: '/catalog',

  // Document/DTE endpoints
  DOCUMENT_UPLOAD: '/document/upload',
  DOCUMENT_DTE_SYNC: '/document/dte/v2/sync',
  DOCUMENT_DTE_EVENT_SYNC: '/document/dte/event/sync',
  DOCUMENT_DTE_RETORNO_SYNC: '/document/dte/retorno/sync',
  DOCUMENT_DTE_OPERACIONES_ESPECIALES_SYNC: '/document/dte/operaciones-especiales/sync',
  DOCUMENT_DTE_SE_SYNC: '/document/dte/v2/sync',  // Sujeto Excluido
  DOCUMENT_DTE_FE_SYNC: '/document/dte/v2/sync',  // Factura de exportación
  DOCUMENT_DTE_CL_SYNC: '/document/dte/v2/sync',  // Comprobante Liquidación
  DOCUMENT_DTE_INVALIDATE: '/document/dte/invalidate/v3',
  DOCUMENT_PDF_UPLOAD: '/document/pdf/upload',
  DOCUMENT_JSON_UPLOAD: '/document/json/upload',
  DOCUMENT_CONTINGENCY: '/document/contingencia/report',
  DOCUMENT_STORAGE: (path: string) => path, // Full URL path
  
  // Account endpoints
  AUTH_LOGIN: '/auth/login',
  AUTH_PROVIDER_LINK: '/auth/providers/link',
  // Re-mints the ≤ 24 h internal JWT while it is still valid.
  AUTH_REFRESH: '/auth/refresh',
  // Proves NIT ownership with the company's MH credentials and links co{NIT} to
  // the account (what the device-sync relay authorizes on).
  AUTH_COMPANIES_CLAIM: '/auth/companies/claim',
  ACCOUNT_VALIDATE: '/account/validate',
  ACCOUNT_DEACTIVATE: '/account/deactivate',
  ACCOUNT_DELETE: '/account/delete',
  
  // Certificate endpoints
  CERTIFICATE_VALIDATE: '/settings/certificate/validate',
  
  // Promo code endpoints
  PROMO: '/promo',
  PROMO_STATUS: '/promo/status',
  
  // Email settings endpoints
  EMAIL_SETTINGS: '/email-settings',
  EMAIL_SETTINGS_BY_NIT: (nit: string) => `/email-settings/${nit}`,
  EMAIL_SETTINGS_DEACTIVATE: (nit: string) => `/email-settings/${nit}/deactivate`,
  
  // Purchase endpoints
  PURCHASES: (nit: string) => `/purchases/${nit}`,

  // IMAP proxy endpoints (Azure Function)
  IMAP_TEST_CONNECTION: '/imap/test-connection',
  IMAP_FETCH_ATTACHMENTS: '/imap/fetch-attachments',
};

// DTE endpoint selector based on document/event type.
// Event payloads identify themselves with identificacion.tipoEvento instead of
// identificacion.tipoDte, so callers should pass both when routing a payload.
export const getDTEEndpoint = (tipoDte?: string, tipoEvento?: string): string => {
  const documentOrEventType = tipoEvento || tipoDte;

  switch (documentOrEventType) {
    case '17':
      return API_ENDPOINTS.DOCUMENT_DTE_OPERACIONES_ESPECIALES_SYNC;
    case '18':
      return API_ENDPOINTS.DOCUMENT_DTE_RETORNO_SYNC;
    default:
      return API_ENDPOINTS.DOCUMENT_DTE_SYNC;
  }
};

// HTTP status codes
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
};

// Error codes
export const API_ERROR_CODES = {
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  SERVER_ERROR: 'SERVER_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
  CERTIFICATE_ERROR: 'CERTIFICATE_ERROR',
  DTE_ERROR: 'DTE_ERROR',
};

// Request retry configuration
export const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
  retryOn: [
    HTTP_STATUS.BAD_GATEWAY,
    HTTP_STATUS.SERVICE_UNAVAILABLE,
    HTTP_STATUS.GATEWAY_TIMEOUT,
  ],
};

// Cache configuration
export const CACHE_CONFIG = {
  // Catalog cache duration (24 hours)
  catalogTTL: 24 * 60 * 60 * 1000,
  // Default cache duration (1 hour)
  defaultTTL: 60 * 60 * 1000,
  // Maximum cache size
  maxCacheSize: 50 * 1024 * 1024, // 50MB
};

// Validation rules for API data
export const VALIDATION_RULES = {
  nit: {
    minLength: 14,
    maxLength: 17,
    pattern: /^\d{4}-\d{6}-\d{3}-\d$/,
  },
  dui: {
    minLength: 10,
    maxLength: 10,
    pattern: /^\d{8}-\d$/,
  },
  email: {
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  },
  phone: {
    minLength: 8,
    maxLength: 12,
    pattern: /^[0-9\-\+\(\)\s]+$/,
  },
  invoiceNumber: {
    maxLength: 15,
  },
  controlNumber: {
    maxLength: 31,
  },
};

// Content types
export const CONTENT_TYPES = {
  JSON: 'application/json',
  FORM_DATA: 'multipart/form-data',
  URL_ENCODED: 'application/x-www-form-urlencoded',
  PDF: 'application/pdf',
  XML: 'application/xml',
};

// Default headers
export const DEFAULT_HEADERS = {
  [API_HEADERS.CONTENT_TYPE]: CONTENT_TYPES.JSON,
  [API_HEADERS.API_KEY]: API_CONFIG.apiKey,
  'Accept': CONTENT_TYPES.JSON,
  'Cache-Control': 'no-cache',
};
