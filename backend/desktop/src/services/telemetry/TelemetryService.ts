/**
 * TelemetryService.ts
 * Azure Application Insights telemetry singleton for Facturas Simples (Desktop).
 *
 * CRITICAL PRIVACY RULES:
 *   - NEVER log certificate passwords, API credentials, or customer PII
 *   - NEVER log NIT/NRC values as user identifiers in event properties
 *   - NEVER log raw DTE JSON payloads
 *   - NIT may be used ONLY as the opaque accountId in user context (setUser)
 */

import {
  ApplicationInsights,
  SeverityLevel,
  IExceptionTelemetry,
  IEventTelemetry,
  IPageViewTelemetry,
  IDependencyTelemetry,
} from '@microsoft/applicationinsights-web';
import {
  TELEMETRY_CONNECTION_STRING_DEV,
  TELEMETRY_CONNECTION_STRING_PROD,
  TelemetryEvent,
} from '../../config/telemetryConfig';
import { LocalLogger } from '../logging/LocalLogger';

class TelemetryServiceClass {
  private client: ApplicationInsights | null = null;
  private isInitialized = false;
  private isDisabled = false;

  /**
   * Initialize App Insights. Must be called once at app startup.
   * Skipped automatically in UITesting mode.
   */
  initialize(isProduction: boolean, isUITesting: boolean): void {
    if (isUITesting) {
      this.isDisabled = true;
      return;
    }

    if (this.isInitialized) return;

    const connectionString = isProduction
      ? TELEMETRY_CONNECTION_STRING_PROD
      : TELEMETRY_CONNECTION_STRING_DEV;

    try {
      this.client = new ApplicationInsights({
        config: {
          connectionString,
          enableAutoRouteTracking: false,
          disableAjaxTracking: true,
          disableFetchTracking: true,
          enableCorsCorrelation: false,
          maxBatchInterval: 5000,
          disableTelemetry: false,
        },
      });

      this.client.loadAppInsights();
      this.isInitialized = true;

      this.trackEvent(TelemetryEvent.AppInitialized, {
        environment: isProduction ? 'PRODUCTION' : 'DEVELOPMENT',
        platform: 'web',
      });
    } catch (err) {
      console.warn('[TelemetryService] Failed to initialize App Insights:', err);
    }
  }

  trackEvent(name: TelemetryEvent | string, properties?: Record<string, string | number | boolean | undefined>): void {
    // Mirror to local file log regardless of App Insights state
    LocalLogger.event('telemetry', name, properties as Record<string, unknown> | undefined);

    if (this.isDisabled || !this.isInitialized || !this.client) return;
    try {
      const telemetry: IEventTelemetry = { name };
      this.client.trackEvent(telemetry, properties as Record<string, string>);
    } catch {
      // Silently swallow
    }
  }

  trackException(
    error: Error | unknown,
    properties?: Record<string, string | number | boolean | undefined>
  ): void {
    // Mirror to local file log regardless of App Insights state
    LocalLogger.error('telemetry', 'Exception tracked', error, properties as Record<string, unknown> | undefined);

    if (this.isDisabled || !this.isInitialized || !this.client) return;
    try {
      const exception = error instanceof Error ? error : new Error(String(error));
      const telemetry: IExceptionTelemetry = {
        exception,
        severityLevel: SeverityLevel.Error,
      };
      this.client.trackException(telemetry, properties as Record<string, string>);
    } catch {
      // Silently swallow
    }
  }

  trackDependency(
    name: string,
    target: string,
    durationMs: number,
    success: boolean,
    resultCode: number | string
  ): void {
    // Mirror to local file log
    LocalLogger.info('dependency', name, { target, durationMs, success, resultCode });

    if (this.isDisabled || !this.isInitialized || !this.client) return;
    try {
      const telemetry: IDependencyTelemetry = {
        id: `dep-${Date.now()}`,
        name,
        target,
        duration: durationMs,
        success,
        responseCode: typeof resultCode === 'number' ? resultCode : 0,
        type: 'HTTP',
      };
      this.client.trackDependencyData(telemetry);
    } catch {
      // Silently swallow
    }
  }

  trackPageView(name: string): void {
    if (this.isDisabled || !this.isInitialized || !this.client) return;
    try {
      const telemetry: IPageViewTelemetry = { name };
      this.client.trackPageView(telemetry);
    } catch {
      // Silently swallow
    }
  }

  setUser(userId: string, accountId: string): void {
    if (this.isDisabled || !this.isInitialized || !this.client) return;
    try {
      this.client.setAuthenticatedUserContext(userId, accountId, true);
    } catch {
      // Silently swallow
    }
  }

  clearUser(): void {
    if (this.isDisabled || !this.isInitialized || !this.client) return;
    try {
      this.client.clearAuthenticatedUserContext();
    } catch {
      // Silently swallow
    }
  }

  flush(): void {
    if (this.isDisabled || !this.isInitialized || !this.client) return;
    try {
      this.client.flush();
    } catch {
      // Silently swallow
    }
  }

  get isActive(): boolean {
    return this.isInitialized && !this.isDisabled;
  }
}

// Singleton export
export const TelemetryService = new TelemetryServiceClass();
