/**
 * telemetryConfig.ts
 * Azure Application Insights configuration for Facturas Simples.
 *
 * Two resources:
 *   Dev  — South Central US (tracks dev/test environment events)
 *   Prod — Mexico Central (tracks production environment events)
 *
 * CRITICAL: Never log sensitive data — certificate passwords, API credentials,
 * customer PII (national IDs, emails), or raw DTE payloads.
 */

// ─── Connection Strings ───────────────────────────────────────────────────────

// Verified 2026-09-28 against the live k-insights-dev component (az monitor
// app-insights component show). The previous value pointed at a deleted
// resource (ikey 4addfe85… @ southcentralus-0) — dev telemetry was silently
// dropped. Keep in sync if the dev component is ever recreated.
export const TELEMETRY_CONNECTION_STRING_DEV =
  'InstrumentationKey=07782d35-2b23-496a-8a58-f4c743cd2d6e;' +
  'IngestionEndpoint=https://southcentralus-3.in.applicationinsights.azure.com/;' +
  'LiveEndpoint=https://southcentralus.livediagnostics.monitor.azure.com/;' +
  'ApplicationId=8deba66e-5ab3-4f27-b905-4cf0dd37058e';

export const TELEMETRY_CONNECTION_STRING_PROD =
  'InstrumentationKey=522a1c8d-c5a2-42a6-8d34-b76292e98daa;' +
  'IngestionEndpoint=https://mexicocentral-0.in.applicationinsights.azure.com/;' +
  'LiveEndpoint=https://mexicocentral.livediagnostics.monitor.azure.com/;' +
  'ApplicationId=e5c55a43-0c55-46c3-89c4-e6d7d82781a3';

// ─── Event Names ──────────────────────────────────────────────────────────────

export enum TelemetryEvent {
  // Sync lifecycle
  SyncStarted        = 'SyncStarted',
  SyncCompleted      = 'SyncCompleted',
  SyncFailed         = 'SyncFailed',
  SyncRetried        = 'SyncRetried',

  // Auth & certificate errors
  CertificateError   = 'CertificateError',
  AuthError          = 'AuthError',

  // DTE response states
  DTERejected        = 'DTERejected',
  DuplicateControl   = 'DuplicateControl',

  // Contingency mode
  ContingencyQueued    = 'ContingencyQueued',
  ContingencyRetried   = 'ContingencyRetried',
  ContingencySubmitted = 'ContingencySubmitted',
  ContingencyMarked    = 'ContingencyMarked',

  // Ad gate
  AdShown            = 'AdShown',
  AdFailed           = 'AdFailed',
  AdSkipped          = 'AdSkipped',

  // Export
  ExportCompleted    = 'ExportCompleted',

  // App lifecycle
  AppInitialized     = 'AppInitialized',
  CompanyLoaded      = 'CompanyLoaded',

  // POS ticket printing (thermal printers)
  TicketPrintCompleted    = 'TicketPrintCompleted',
  TicketPrintFailed       = 'TicketPrintFailed',
  TicketPrinterStatusCheck = 'TicketPrinterStatusCheck',
  TicketPrinterDiagnostics = 'TicketPrinterDiagnostics',

  // Diagnostics / support tickets (chat.api)
  LogsUploaded         = 'LogsUploaded',
  SupportTicketCreated = 'SupportTicketCreated',
  SupportTicketFailed  = 'SupportTicketFailed',
}

// ─── Azure Portal deep-link metadata ─────────────────────────────────────────
// Used to build Links-blade URLs so a support ticket can point reviewers
// straight at the telemetry around the reported problem.

export interface AppInsightsResourceInfo {
  subscriptionId: string;
  resourceGroup: string;
  componentName: string;
  tenantDomain: string;
}

export const APP_INSIGHTS_RESOURCES: Record<'dev' | 'prod', AppInsightsResourceInfo> = {
  dev: {
    subscriptionId: 'dc9411bc-29ff-469e-83a3-86c117170e2e',
    resourceGroup: 'invoice-manager-dev',
    componentName: 'k-insights-dev',
    tenantDomain: 'jflorescalles.onmicrosoft.com',
  },
  prod: {
    subscriptionId: 'dc9411bc-29ff-469e-83a3-86c117170e2e',
    resourceGroup: 'invoice-manager-prod',
    componentName: 'k-insights',
    tenantDomain: 'jflorescalles.onmicrosoft.com',
  },
};

// ─── Property Schemas ─────────────────────────────────────────────────────────

export interface SyncEventProperties {
  invoiceType?: string;
  environment?: string;
  durationMs?: number;
  tier?: string;
}

export interface SyncFailedProperties extends SyncEventProperties {
  errorCode?: string;
  statusCode?: number;
  step?: string;
}

export interface DTERejectedProperties extends SyncEventProperties {
  rejectCode?: string;
  observacionCount?: number;
}

export interface AdEventProperties {
  adType?: string;
  retryCount?: number;
  invoiceType?: string;
}

export interface ContingencyProperties {
  invoiceType?: string;
  retryAttempt?: number;
  maxRetries?: number;
}

export interface CertificateErrorProperties {
  errorType?: string;
  environment?: string;
}
