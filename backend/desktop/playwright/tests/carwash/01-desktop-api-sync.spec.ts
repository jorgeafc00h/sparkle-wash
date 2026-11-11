/**
 * SparkleWash Desktop ↔ carwash API, end to end, against the REAL API.
 *
 * Starts `src/carwash-api.DevHost` (the production `Program.BuildApp` with a dev-only
 * token verifier, isolated temp data) and drives the desktop web build:
 *   1. sign in with a dev token, create a walk-in → a work ticket (OT-C1-…) that reaches the API
 *      as the job iOS lists (source "desktop-pos");
 *   2. a status change made elsewhere (iOS/web, simulated with direct API calls) reaches the
 *      desktop board through /api/events;
 *   3. the desktop advances the job, the POS charges it, and the API records the payment;
 *   4. a walk-in created while the API is unreachable prints locally, waits in the outbox and
 *      syncs once the API is back.
 *
 * Needs the .NET 10 SDK. Skipped when `dotnet` is not on PATH.
 */

import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedPopulatedAppState } from '../../fixtures/seed-state';

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const DEV_HOST_PROJECT = path.join(BACKEND_ROOT, 'src/carwash-api.DevHost');
const DEV_TOKEN = 'dev:1001:op@example.com';
const hasDotnet = spawnSync('dotnet', ['--version'], { stdio: 'ignore' }).status === 0;

let api: ChildProcess | null = null;
let apiUrl = '';
let dataDir = '';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))));
    });
  });
}

async function waitForApi(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (api?.exitCode != null) throw new Error(`DevHost exited with ${api.exitCode}`);
    try {
      const res = await fetch(`${url}/healthz`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('DevHost did not become healthy');
}

async function apiSession(request: APIRequestContext): Promise<Record<string, string>> {
  const res = await request.post(`${apiUrl}/api/auth/google`, { data: { idToken: DEV_TOKEN } });
  expect(res.ok()).toBeTruthy();
  const { sessionToken } = await res.json();
  return { Authorization: `Bearer ${sessionToken}` };
}

async function apiJobs(request: APIRequestContext): Promise<Array<Record<string, any>>> {
  const res = await request.get(`${apiUrl}/api/jobs`, { headers: await apiSession(request) });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

/** In-app navigation: page.goto would re-run the seed init script and reset persisted state. */
async function navigate(page: Page, hash: string): Promise<void> {
  await page.evaluate((h) => { window.location.hash = h; }, hash);
}

async function createWalkIn(page: Page, plate: string, vehicleClass: string, packageId: string): Promise<void> {
  await page.getByTestId('carwash-new-service').click();
  await page.getByTestId('carwash-plate-input').fill(plate);
  await page.getByTestId(`carwash-class-${vehicleClass}`).click();
  await page.getByTestId(`carwash-package-${packageId}`).click();
  await page.getByTestId('carwash-create').click();
}

test.describe.serial('SparkleWash desktop ↔ API', () => {
  test.skip(!hasDotnet, 'needs the .NET SDK to run the API dev host');
  test.setTimeout(180_000);

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    dataDir = mkdtempSync(path.join(tmpdir(), 'sparklewash-e2e-'));
    const port = await freePort();
    apiUrl = `http://127.0.0.1:${port}`;
    api = spawn('dotnet', ['run', '--project', DEV_HOST_PROJECT, '--urls', apiUrl], {
      cwd: BACKEND_ROOT,
      env: {
        ...process.env,
        ASPNETCORE_ENVIRONMENT: 'Development',
        SPARKLEWASH_GOOGLE_CLIENT_ID: 'dev',
        SPARKLEWASH_STAFF_ROLES: '1001=operator',
        SPARKLEWASH_CORS_ORIGINS: 'http://127.0.0.1:5173',
        SPARKLEWASH_TENANTS_DIR: path.join(dataDir, 'tenants'),
        SPARKLEWASH_ARRIVALS_FILE: path.join(dataDir, 'arrivals.json'),
        SPARKLEWASH_JOBS_FILE: path.join(dataDir, 'jobs.json'),
        SPARKLEWASH_OPERATIONS_FILE: path.join(dataDir, 'operations.json'),
        SPARKLEWASH_DEVICES_FILE: path.join(dataDir, 'devices.json'),
        SPARKLEWASH_DATA_FILE: path.join(dataDir, 'stations.json'),
        SPARKLEWASH_PHOTO_DIR: path.join(dataDir, 'photos'),
        SPARKLEWASH_N1CO_WEBHOOK_FILE: path.join(dataDir, 'n1co.json'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    api.stdout?.on('data', (chunk) => { log += chunk; });
    api.stderr?.on('data', (chunk) => { log += chunk; });
    try {
      await waitForApi(apiUrl, 200_000);
    } catch (error) {
      throw new Error(`${(error as Error).message}\n${log.slice(-4000)}`);
    }
  });

  test.afterAll(async () => {
    api?.kill('SIGTERM');
    api = null;
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  test('work ticket → API → status from another device → POS payment → offline outbox', async ({ page, request }) => {
    await seedPopulatedAppState(page);

    // ── Connect and sign in (dev token; production uses the desktop Google sign-in) ──
    await navigate(page, '#/settings/carwash');
    await expect(page.getByTestId('carwash-settings')).toBeVisible();
    await page.getByTestId('carwash-api-url').fill(apiUrl);
    await page.getByTestId('carwash-save').click();
    await page.getByTestId('carwash-dev-token-input').fill(DEV_TOKEN);
    await page.getByTestId('carwash-dev-token-submit').click();
    await expect(page.getByTestId('carwash-session')).toBeVisible({ timeout: 15_000 });

    // ── 1. Walk-in = one printed work ticket, sent to the API ──
    await navigate(page, '#/carwash');
    await expect(page.getByTestId('carwash-board')).toBeVisible();
    await createWalkIn(page, 'P123456', 'suv', 'essential');

    const arrived = page.getByTestId('carwash-col-arrived').getByTestId('carwash-job-card').filter({ hasText: 'P123456' });
    await expect(arrived).toBeVisible();
    await expect(arrived.getByTestId('carwash-job-ticket')).toHaveText(/OT-C1-\d{6}/);
    const ticketNumber = (await arrived.getByTestId('carwash-job-ticket').innerText()).match(/OT-C1-\d{6}/)![0];
    await expect(arrived.getByTestId('carwash-pending-badge')).toHaveCount(0, { timeout: 15_000 });

    let job = (await apiJobs(request)).find((j) => j.plate === 'P123456');
    expect(job).toBeTruthy();
    expect(job).toMatchObject({
      source: 'desktop-pos', ticketNumber, status: 'arrived', packageId: 'essential', vehicleClass: 'suv',
      priceUsd: 18, paymentStatus: 'unpaid', payments: [],
    });
    const jobId: string = job!.id;

    // ── 2. iOS/web moves the job; the desktop board follows (live events) ──
    const headers = await apiSession(request);
    for (const status of ['queued', 'in_progress']) {
      const res = await request.post(`${apiUrl}/api/jobs/${jobId}/transition`, {
        headers: { ...headers, 'Idempotency-Key': `e2e-ios-${status}-${jobId}` },
        data: { status },
      });
      expect(res.ok()).toBeTruthy();
    }
    const inProgress = page.getByTestId('carwash-col-in_progress').getByTestId('carwash-job-card').filter({ hasText: 'P123456' });
    await expect(inProgress).toBeVisible({ timeout: 20_000 });

    // ── 3. Desktop finishes it, POS charges it ──
    await inProgress.getByTestId('carwash-advance').click();
    await expect(
      page.getByTestId('carwash-col-completed').getByTestId('carwash-job-card').filter({ hasText: 'P123456' }),
    ).toBeVisible();
    await expect.poll(async () => (await apiJobs(request)).find((j) => j.id === jobId)?.status, { timeout: 15_000 })
      .toBe('completed');

    await navigate(page, '#/pos');
    await expect(page.getByTestId('pos-register')).toBeVisible();
    await page.getByTestId('pos-carwash-pending').click();
    await page.getByTestId(`pos-carwash-job-${jobId}`).click();
    await expect(page.getByTestId('pos-total')).toContainText('18.00');
    await page.getByTestId('btn-charge').click();
    await expect(page.getByTestId('payment-modal')).toBeVisible();
    await page.getByTestId('pay-cash-tendered').fill('20');
    await page.getByTestId('btn-confirm-payment').click();
    await expect(page.getByText(/Ticket #\d+ guardado/)).toBeVisible({ timeout: 10_000 });

    await expect.poll(async () => (await apiJobs(request)).find((j) => j.id === jobId)?.paymentStatus, { timeout: 15_000 })
      .toBe('paid');
    job = (await apiJobs(request)).find((j) => j.id === jobId);
    expect(job!.paidUsd).toBe(18);
    expect(job!.payments).toHaveLength(1);
    expect(job!.payments[0]).toMatchObject({ method: 'cash', amountUsd: 18 });
    expect(job!.payments[0].ticketNumber).toMatch(/^\d{6}$|^[A-Z0-9]+-\d{6}$/);
    expect(job!.paidAt).toBeTruthy();

    // ── 4. Offline walk-in: printed now, queued, synced later ──
    await navigate(page, '#/carwash');
    await expect(page.getByTestId('carwash-board')).toBeVisible();
    await page.route(`${apiUrl}/**`, (route) => route.abort('internetdisconnected'));
    await createWalkIn(page, 'M987654', 'car', 'quick');
    const offline = page.getByTestId('carwash-col-arrived').getByTestId('carwash-job-card').filter({ hasText: 'M987654' });
    await expect(offline).toBeVisible();
    await expect(offline.getByTestId('carwash-job-ticket')).toHaveText(/OT-C1-\d{6}/);
    await expect(offline.getByTestId('carwash-pending-badge')).toBeVisible();
    const offlineTicket = (await offline.getByTestId('carwash-job-ticket').innerText()).match(/OT-C1-\d{6}/)![0];
    expect(offlineTicket).not.toBe(ticketNumber);
    expect((await apiJobs(request)).some((j) => j.plate === 'M987654')).toBe(false);

    await page.unroute(`${apiUrl}/**`);
    await page.getByTestId('carwash-sync').click();
    await expect(offline.getByTestId('carwash-pending-badge')).toHaveCount(0, { timeout: 20_000 });
    await expect.poll(async () => (await apiJobs(request)).find((j) => j.plate === 'M987654')?.ticketNumber, { timeout: 15_000 })
      .toBe(offlineTicket);
  });
});
