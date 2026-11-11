/**
 * SupportTicketService — diagnostics ticket flow tests.
 *
 * Validates the contract chat.api's POST /api/SupportRequests receives:
 * local logs attached, App Insights deep link + query around "now",
 * environment/version metadata, and the cross-link event tracked after a
 * successful creation.
 */

jest.mock('axios');
jest.mock('@/services/telemetry/TelemetryService', () => ({
  TelemetryService: {
    trackEvent: jest.fn(),
    trackException: jest.fn(),
    flush: jest.fn(),
  },
}));
jest.mock('@/services/logging/LogExportService', () => ({
  collectLogs: jest.fn(),
}));
// LocalLogger (and TelemetryService, mocked above) carry import.meta.env —
// not representable in ts-jest's CJS output.
jest.mock('@/services/logging/LocalLogger', () => ({
  LocalLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    event: jest.fn(),
  },
}));
// ts-jest has no JSON-module interop for the package.json import inside appVersion.
jest.mock('@/config/appVersion', () => ({ APP_VERSION: '1.2.0-test' }));

import axios from 'axios';
import { SupportTicketService } from '@/services/support/SupportTicketService';
import { TelemetryService } from '@/services/telemetry/TelemetryService';
import { collectLogs } from '@/services/logging/LogExportService';
import { TelemetryEvent } from '@/config/telemetryConfig';

const axiosPost = axios.post as jest.MockedFunction<typeof axios.post>;
const collectLogsMock = collectLogs as jest.MockedFunction<typeof collectLogs>;
const trackEventMock = TelemetryService.trackEvent as jest.Mock;

describe('SupportTicketService.createDiagnosticsTicket', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    collectLogsMock.mockResolvedValue('# fs-2026-09-28.log\n{"ts":"2026-09-28T12:00:00Z","level":"error","cat":"printing","msg":"Receipt print failed"}');
    axiosPost.mockResolvedValue({ data: { ticketId: 'TKT-240928-ABC' } });
  });

  it('POSTs logs + App Insights link + metadata to chat.api', async () => {
    const result = await SupportTicketService.createDiagnosticsTicket({
      summary: 'Impresora de tickets no imprime',
      category: 'printing',
      nit: '1234-5',
      companyName: 'Mi Empresa',
    });

    expect(result.success).toBe(true);
    expect(result.ticket?.ticketId).toBe('TKT-240928-ABC');

    expect(axiosPost).toHaveBeenCalledTimes(1);
    const [url, rawPayload, rawConfig] = axiosPost.mock.calls[0];
    const payload = rawPayload as Record<string, string>;
    const config = rawConfig as { headers: Record<string, string> };

    // Endpoint + auth
    expect(url).toMatch(/\/api\/SupportRequests$/);
    expect(config.headers['X-API-Key']).toBeTruthy();

    // Log attachment
    expect(payload.logContent).toContain('Receipt print failed');
    expect(payload.logFileName).toMatch(/^fs-logs-\d{4}-\d{2}-\d{2}-\d+\.log$/);

    // App Insights cross-link (jest runs with PROD=false → dev component)
    expect(payload.appInsightsUrl).toContain('portal.azure.com');
    expect(payload.appInsightsUrl).toContain('k-insights-dev');
    expect(payload.appInsightsQuery).toContain('union AppEvents, AppExceptions');
    expect(payload.appInsightsTimeUtc).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Environment metadata
    expect(payload.environment).toBe('development');
    expect(payload.platform).toBe('electron');
    expect(payload.appVersion).toBe('1.2.0-test');
    expect(payload.source).toBe('desktop-app');
    expect(payload.channel).toBe('desktop');
    expect(payload.category).toBe('printing');
    expect(payload.companyName).toBe('Mi Empresa');
  });

  it('tracks a cross-link telemetry event carrying the ticket id after creation', async () => {
    await SupportTicketService.createDiagnosticsTicket({ summary: 'x' });

    expect(trackEventMock).toHaveBeenCalledWith(
      TelemetryEvent.SupportTicketCreated,
      expect.objectContaining({ ticketId: 'TKT-240928-ABC' })
    );
    expect(TelemetryService.flush).toHaveBeenCalled();
  });

  it('returns failure without throwing when chat.api rejects', async () => {
    axiosPost.mockRejectedValue(new Error('Network down'));

    const result = await SupportTicketService.createDiagnosticsTicket({ summary: 'x' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Network down');
    expect(trackEventMock).toHaveBeenCalledWith(
      TelemetryEvent.SupportTicketFailed,
      expect.objectContaining({ error: 'Network down' })
    );
  });

  it('fails when the server response has no ticketId', async () => {
    axiosPost.mockResolvedValue({ data: {} });

    const result = await SupportTicketService.createDiagnosticsTicket({ summary: 'x' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('id de ticket');
  });
});
