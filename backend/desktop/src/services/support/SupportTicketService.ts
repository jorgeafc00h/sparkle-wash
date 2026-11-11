/**
 * SupportTicketService — creates a support ticket in chat.api with the local
 * session logs attached and an App Insights deep link to the telemetry around
 * the reported problem.
 *
 * Flow (settings → "Enviar a soporte"):
 *   1. Collect local logs (LocalLogger JSONL files, tail-capped).
 *   2. POST /api/SupportRequests to chat.api with logs + diagnostics metadata.
 *   3. Track a SupportTicketCreated event to App Insights carrying the ticket
 *      id, then flush — so the event is queryable and cross-linked with the
 *      ticket (the ticket embeds the portal URL, the event embeds the ticketId).
 *
 * PRIVACY: logs are already scrubbed upstream (LocalLogger rules). Never add
 * credentials or raw DTE payloads here.
 */

import axios from 'axios';
import { collectLogs } from '../logging/LogExportService';
import { CHAT_API_CONFIG } from '../../config/chatApi';
import { APP_VERSION } from '../../config/appVersion';
import { isViteProduction } from '@/config/viteEnv';
import { TelemetryService } from '../telemetry/TelemetryService';
import {
  buildAppInsightsDeepLink,
  buildAppInsightsResourceUrl,
  buildDiagnosticsQuery,
} from '../telemetry/AppInsightsLinks';
import { TelemetryEvent } from '../../config/telemetryConfig';
import { LocalLogger } from '../logging/LocalLogger';

/** Azure Table string-property headroom — content is trimmed to this size. */
const MAX_LOG_BYTES = 60_000;

export type SupportCategory = 'printing' | 'sync' | 'platform' | 'account' | 'other';
export type SupportSeverity = 'low' | 'normal' | 'high' | 'critical';

export interface CreateDiagnosticsTicketInput {
  summary: string;
  description?: string;
  category?: SupportCategory;
  severity?: SupportSeverity;
  /** Route/page the user was on — attached for triage. */
  screenContext?: string;
  /** Known error code/title/message to surface at the top of the ticket. */
  errorCode?: string;
  errorTitle?: string;
  errorMessage?: string;
  /** Company context (NIT used as accountId upstream — never as free text). */
  nit?: string;
  companyName?: string;
  email?: string;
}

export interface CreatedTicket {
  ticketId: string;
  appInsightsUrl: string;
  logBytes: number;
}

export interface CreateTicketResult {
  success: boolean;
  ticket?: CreatedTicket;
  error?: string;
}

export const SupportTicketService = {
  /**
   * Collect diagnostics and open a support ticket in chat.api. The returned
   * ticket id links to both the stored logs and the App Insights window.
   */
  async createDiagnosticsTicket(input: CreateDiagnosticsTicketInput): Promise<CreateTicketResult> {
    const isProduction = isViteProduction();
    const environment: 'dev' | 'prod' = isProduction ? 'prod' : 'dev';
    const eventTime = new Date();

    const logContent = await collectLogs({ maxBytes: MAX_LOG_BYTES });
    const logFileName = `fs-logs-${eventTime.toISOString().slice(0, 10)}-${Date.now()}.log`;

    const appInsightsUrl = buildAppInsightsDeepLink(environment, { eventTime });
    const appInsightsQuery = buildDiagnosticsQuery({ eventTime });

    try {
      const response = await axios.post<{ ticketId: string }>(
        `${CHAT_API_CONFIG.baseUrl}/api/SupportRequests`,
        {
          channel: 'desktop',
          source: 'desktop-app',
          category: input.category ?? 'other',
          severity: input.severity ?? 'normal',
          summary: input.summary,
          description: input.description ?? '',
          nit: input.nit ?? '',
          companyName: input.companyName ?? '',
          email: input.email ?? '',
          errorCode: input.errorCode ?? '',
          errorTitle: input.errorTitle ?? '',
          errorMessage: input.errorMessage ?? '',
          screenContext: input.screenContext ?? '',
          appVersion: APP_VERSION,
          platform: 'electron',
          environment: isProduction ? 'production' : 'development',
          logFileName,
          logContent,
          appInsightsUrl,
          appInsightsQuery,
          appInsightsTimeUtc: eventTime.toISOString(),
        },
        {
          headers: {
            'X-API-Key': CHAT_API_CONFIG.apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 30_000,
        },
      );

      const ticketId = response.data?.ticketId ?? '';
      if (!ticketId) {
        throw new Error('El servidor no devolvió un id de ticket');
      }

      // Cross-link: the App Insights event carries the ticketId so the portal
      // query in the ticket (and any later search) finds this exact event.
      TelemetryService.trackEvent(TelemetryEvent.SupportTicketCreated, {
        ticketId,
        category: input.category ?? 'other',
        severity: input.severity ?? 'normal',
        logBytes: logContent.length,
        environment: isProduction ? 'production' : 'development',
      });
      TelemetryService.flush();

      LocalLogger.event('support', 'Support ticket created', {
        ticketId,
        logBytes: logContent.length,
      });

      return {
        success: true,
        ticket: { ticketId, appInsightsUrl, logBytes: logContent.length },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      LocalLogger.error('support', 'Support ticket creation failed', err, { summary: input.summary });
      TelemetryService.trackEvent(TelemetryEvent.SupportTicketFailed, {
        error: msg.slice(0, 200),
        environment: isProduction ? 'production' : 'development',
      });
      TelemetryService.flush();
      return { success: false, error: msg };
    }
  },

  /** Fallback portal link used in error toasts when no ticket could be created. */
  appInsightsResourceUrl(): string {
    return buildAppInsightsResourceUrl(isViteProduction() ? 'prod' : 'dev');
  },
};
