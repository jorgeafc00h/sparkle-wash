/**
 * AppInsightsLinks — portal deep-link builder tests.
 *
 * The links end up inside support tickets handled by humans, so the URL
 * shape must stay stable: tenant-scoped portal URL, encoded resource id,
 * encoded KQL query, ISO-8601 timespan interval.
 */

import {
  buildAppInsightsDeepLink,
  buildAppInsightsResourceUrl,
  buildDiagnosticsQuery,
} from '@/services/telemetry/AppInsightsLinks';

const EVENT_TIME = new Date('2026-09-28T12:00:00.000Z');

describe('buildDiagnosticsQuery', () => {
  it('scopes the window to ±contextMinutes around the event', () => {
    const q = buildDiagnosticsQuery({ eventTime: EVENT_TIME, contextMinutes: 15 });
    expect(q).toContain('union AppEvents, AppExceptions');
    expect(q).toContain('datetime(2026-09-28T11:45:00.000Z)');
    expect(q).toContain('datetime(2026-09-28T12:15:00.000Z)');
    expect(q).toContain('order by TimeGenerated desc');
  });

  it('filters by event name and anchor when provided', () => {
    const q = buildDiagnosticsQuery({
      eventTime: EVENT_TIME,
      eventName: 'TicketPrintFailed',
      anchor: 'TKT-ABC123',
    });
    expect(q).toContain('Name == "TicketPrintFailed"');
    expect(q).toContain('tostring(Properties) contains "TKT-ABC123"');
  });

  it('defaults to a 30 minute window', () => {
    const q = buildDiagnosticsQuery({ eventTime: EVENT_TIME });
    expect(q).toContain('datetime(2026-09-28T11:30:00.000Z)');
    expect(q).toContain('datetime(2026-09-28T12:30:00.000Z)');
  });
});

describe('buildAppInsightsDeepLink', () => {
  it('targets the prod component with tenant, resource id, query and timespan', () => {
    const url = buildAppInsightsDeepLink('prod', { eventTime: EVENT_TIME });
    expect(url).toContain('https://portal.azure.com/#@jflorescalles.onmicrosoft.com');
    expect(url).toContain('SearchBlade');
    expect(url).toContain(encodeURIComponent('microsoft.insights/components/k-insights'));
    // Query is URL-encoded KQL over the workspace tables
    expect(url).toContain(encodeURIComponent('union AppEvents, AppExceptions'));
    // Timespan is an encoded ISO interval anchored on the event
    expect(url).toContain(encodeURIComponent('2026-09-28T11:30:00Z/2026-09-28T12:30:00Z'));
  });

  it('switches to the dev component for the dev environment', () => {
    const url = buildAppInsightsDeepLink('dev', { eventTime: EVENT_TIME });
    expect(url).toContain(encodeURIComponent('microsoft.insights/components/k-insights-dev'));
    expect(url).toContain('invoice-manager-dev');
  });
});

describe('buildAppInsightsResourceUrl', () => {
  it('builds the portal overview URL for the resource', () => {
    const url = buildAppInsightsResourceUrl('prod');
    expect(url).toBe(
      'https://portal.azure.com/#@jflorescalles.onmicrosoft.com' +
      '/resource/subscriptions/dc9411bc-29ff-469e-83a3-86c117170e2e' +
      '/resourceGroups/invoice-manager-prod' +
      '/providers/microsoft.insights/components/k-insights/overview'
    );
  });
});
