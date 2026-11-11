/**
 * AppInsightsLinks — builds Azure Portal URLs that deep-link into the Logs
 * blade of the k-insights App Insights resource, pre-filtered to the telemetry
 * around a reported problem.
 *
 * Support tickets embed these links so a reviewer can jump from the ticket
 * straight to the matching App Insights events without hand-writing KQL.
 *
 * URL format (portal SearchBlade deep link, stable since the classic portal):
 *   https://portal.azure.com/#@{tenant}/blade/Microsoft_Azure_Monitoring/DeepDive/BladeName/SearchBlade/resourceId/{encoded}/Source/SearchBlade/Query/{encoded kql}/Timespan/{encoded interval}
 *
 * The resource-centric table names (AppEvents / AppExceptions) are what the
 * portal uses for workspace-based App Insights components — the same names
 * used when querying managed-k-insights-ws directly.
 */

import {
  APP_INSIGHTS_RESOURCES,
  type AppInsightsResourceInfo,
} from '../../config/telemetryConfig';

export interface TelemetryWindow {
  /** ISO timestamp of the reported event (or now). */
  eventTime: Date;
  /** Minutes of context before/after the event captured by the link. Default 30. */
  contextMinutes?: number;
  /** Optional anchor (e.g. ticket id) matched against event properties. */
  anchor?: string;
  /** Restrict to a named telemetry event, e.g. TicketPrintFailed. */
  eventName?: string;
}

function resourceId(info: AppInsightsResourceInfo): string {
  return `/subscriptions/${info.subscriptionId}/resourceGroups/${info.resourceGroup}/providers/microsoft.insights/components/${info.componentName}`;
}

function isoInterval(eventTime: Date, contextMinutes: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
  const from = new Date(eventTime.getTime() - contextMinutes * 60_000);
  const to = new Date(eventTime.getTime() + contextMinutes * 60_000);
  return `${fmt(from)}/${fmt(to)}`;
}

/** KQL the Logs blade runs — filters events/exceptions to the window + anchor. */
export function buildDiagnosticsQuery(win: TelemetryWindow): string {
  const contextMinutes = win.contextMinutes ?? 30;
  const from = new Date(win.eventTime.getTime() - contextMinutes * 60_000);
  const to = new Date(win.eventTime.getTime() + contextMinutes * 60_000);
  const clauses: string[] = [
    `TimeGenerated between (datetime(${from.toISOString()}) .. datetime(${to.toISOString()}))`,
  ];
  if (win.eventName) clauses.push(`Name == "${win.eventName}"`);
  if (win.anchor) clauses.push(`tostring(Properties) contains "${win.anchor}"`);
  return `union AppEvents, AppExceptions | where ${clauses.join(' and ')} | order by TimeGenerated desc`;
}

/** Deep link that opens the portal Logs blade with the query pre-filled. */
export function buildAppInsightsDeepLink(
  environment: 'dev' | 'prod',
  win: TelemetryWindow,
): string {
  const info = APP_INSIGHTS_RESOURCES[environment];
  const query = encodeURIComponent(buildDiagnosticsQuery(win));
  const timespan = encodeURIComponent(isoInterval(win.eventTime, win.contextMinutes ?? 30));
  const rid = encodeURIComponent(resourceId(info));
  return (
    `https://portal.azure.com/#@${info.tenantDomain}` +
    `/blade/Microsoft_Azure_Monitoring/DeepDive/BladeName/SearchBlade/resourceId/${rid}` +
    `/Source/SearchBlade/Query/${query}/Timespan/${timespan}`
  );
}

/** Plain resource URL (portal overview) — stable fallback link for tickets. */
export function buildAppInsightsResourceUrl(environment: 'dev' | 'prod'): string {
  const info = APP_INSIGHTS_RESOURCES[environment];
  return `https://portal.azure.com/#@${info.tenantDomain}/resource${resourceId(info)}/overview`;
}
