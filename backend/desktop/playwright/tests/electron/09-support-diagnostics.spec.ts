/**
 * Support diagnostics flow — Electron integration.
 *
 * Validates the full "troubleshooting" loop introduced for ticket-printing
 * support:
 *
 *   Settings → "Crear ticket de soporte" → collects the REAL local JSONL
 *   session logs from {userData}/logs, POSTs them to chat.api
 *   /api/SupportRequests together with an App Insights deep link, tracks a
 *   cross-link SupportTicketCreated event to App Insights, and shows the
 *   returned ticket id + portal link in the UI.
 *
 * HERMETIC YET REAL:
 *   - chat.api and App Insights ingestion are intercepted with page.route —
 *     the app's real axios pipeline, serializer and SDK run; only the socket
 *     destination is swapped for a stub.
 *   - This spec launches with { telemetry: true } so the REAL App Insights
 *     web SDK initializes (like production) — the /v2/track interception both
 *     keeps data out of Azure and lets us assert the exact envelope content.
 *   - LocalLogger writes the actual fs-*.log file asserted from disk.
 *
 * Run: npx playwright test --config playwright.electron.config.ts \
 *        playwright/tests/electron/09-support-diagnostics.spec.ts
 */

import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { closeElectron, launchElectron, type ElectronAppHandle } from '../../fixtures/electron-launch';

interface CapturedTicketRequest {
  url: string;
  body: {
    summary?: string;
    channel?: string;
    source?: string;
    category?: string;
    nit?: string;
    companyName?: string;
    appVersion?: string;
    platform?: string;
    environment?: string;
    logFileName?: string;
    logContent?: string;
    appInsightsUrl?: string;
    appInsightsQuery?: string;
    appInsightsTimeUtc?: string;
  };
}

let handle: ElectronAppHandle | null = null;

test.afterAll(async () => {
  if (handle) await closeElectron(handle);
  handle = null;
});

test.describe('Settings → support ticket with logs + App Insights link', () => {
  const ticketRequests: CapturedTicketRequest[] = [];
  const aiEnvelopes: string[] = [];

  test.beforeAll(async () => {
    handle = await launchElectron({
      mock: true,
      telemetry: true, // real SDK init — ingestion is intercepted below
    });
    const { window } = handle;

    // chat.api stub: capture the ticket payload, answer like the real API.
    await window.route('**/api/SupportRequests*', async (route) => {
      ticketRequests.push({
        url: route.request().url(),
        body: route.request().postDataJSON(),
      });
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          ticketId: 'TKT-E2E-4242',
          status: 'open',
          category: 'printing',
          severity: 'normal',
        }),
      });
    });

    // App Insights ingestion stub: swallow envelopes (keep the run hermetic)
    // and record them so the spec can assert what the SDK really sent.
    await window.route('**/v2/track*', async (route) => {
      // The SDK can send the batch gzipped (seen from 2026-10-12 with no app
      // change) — decode before asserting.
      const raw = route.request().postDataBuffer() ?? Buffer.alloc(0);
      const gzipped = raw.length > 1 && raw[0] === 0x1f && raw[1] === 0x8b;
      aiEnvelopes.push((gzipped ? gunzipSync(raw) : raw).toString('utf8'));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ itemsReceived: 1, itemsAccepted: 1, errors: [] }),
      });
    });
  });

  test('creates a ticket carrying local logs, metadata and an App Insights deep link', async () => {
    const { window, userDataDir } = handle!;

    // ── Drive the real UI ────────────────────────────────────────────────
    await window.evaluate(() => { window.location.hash = '#/settings'; });
    await expect(window.getByTestId('settings')).toBeVisible({ timeout: 30_000 });

    await window.getByTestId('btn-open-support-ticket').click();
    await window.getByTestId('input-support-summary').fill('La impresora de tickets no imprime al cobrar');
    await window.getByTestId('input-support-detail').fill('Ocurre con la TM-T20II por red al imprimir el ticket #1.');
    await window.getByTestId('btn-send-support-ticket').click();

    // Success state surfaces the server-generated ticket id.
    await expect(window.getByTestId('support-ticket-id')).toHaveText('TKT-E2E-4242', { timeout: 30_000 });

    // The UI links reviewers straight into the portal Logs blade.
    const aiLink = window.getByTestId('support-ticket-ai-link');
    await expect(aiLink).toHaveAttribute('href', /portal\.azure\.com/);
    await expect(aiLink).toHaveAttribute('href', /k-insights-dev/);

    // ── What chat.api received ───────────────────────────────────────────
    expect(ticketRequests).toHaveLength(1);
    const payload = ticketRequests[0].body;
    expect(ticketRequests[0].url).toMatch(/\/api\/SupportRequests$/);
    expect(payload.summary).toBe('La impresora de tickets no imprime al cobrar');
    expect(payload.channel).toBe('desktop');
    expect(payload.source).toBe('desktop-app');
    expect(payload.category).toBe('printing');
    expect(payload.platform).toBe('electron');
    expect(payload.environment).toBe('development');
    expect(payload.appVersion).toMatch(/^\d+\.\d+\.\d+/);

    // Local JSONL session logs are attached — including this session's
    // startup entry, proving the file pipeline (not a stub) produced them.
    expect(payload.logFileName).toMatch(/^fs-logs-\d{4}-\d{2}-\d{2}-\d+\.log$/);
    expect(payload.logContent).toContain('Session started');
    expect(payload.logContent).toContain('"cat"');

    // App Insights cross-link: portal deep link + runnable KQL + timestamp.
    expect(payload.appInsightsUrl).toContain('portal.azure.com');
    expect(payload.appInsightsUrl).toContain(encodeURIComponent('components/k-insights-dev'));
    expect(payload.appInsightsQuery).toContain('union AppEvents, AppExceptions');
    expect(payload.appInsightsTimeUtc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

    // ── What App Insights really received (cross-link event) ────────────
    // The SDK batches with maxBatchInterval 5s; poll for the envelope.
    await expect
      .poll(() => aiEnvelopes.join('\n'), { timeout: 30_000 })
      .toContain('SupportTicketCreated');
    const envelope = aiEnvelopes.join('\n');
    expect(envelope).toContain('TKT-E2E-4242');

    // ── The local log file exists on disk and mirrors telemetry ──────────
    const logsDir = join(userDataDir, 'logs');
    const logFiles = readdirSync(logsDir).filter((f) => /^fs-.*\.log$/.test(f));
    expect(logFiles.length).toBeGreaterThanOrEqual(1);
    const readAllLogs = () =>
      logFiles.map((f) => readFileSync(join(logsDir, f), 'utf8')).join('\n');
    expect(readAllLogs()).toContain('Session started');
    // The post-creation mirror entry flushes on the 5s timer — poll for it.
    await expect
      .poll(readAllLogs, { timeout: 20_000 })
      .toContain('Support ticket created');

    // Close the success modal so the next test starts from the plain page.
    await window.getByTestId('btn-close-support-ticket').click();
    await expect(window.getByTestId('support-ticket-result')).toHaveCount(0);
  });

  test('a failed submission surfaces the error and tracks SupportTicketFailed', async () => {
    const { window } = handle!;

    // Flip chat.api into a 500 for this test — only the ticket route is
    // swapped; the /v2/track interception stays so no envelope leaks to Azure.
    await window.unroute('**/api/SupportRequests*');
    await window.route('**/api/SupportRequests*', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' });
    });

    await window.getByTestId('btn-open-support-ticket').click();
    await window.getByTestId('input-support-summary').fill('Reintento tras fallo del servidor');
    await window.getByTestId('btn-send-support-ticket').click();

    // Modal stays in form mode (no ticket id shown) — the toast carries the error.
    await expect(window.getByTestId('support-ticket-id')).toHaveCount(0, { timeout: 10_000 });
    await expect
      .poll(() => aiEnvelopes.join('\n'), { timeout: 30_000 })
      .toContain('SupportTicketFailed');
  });
});
