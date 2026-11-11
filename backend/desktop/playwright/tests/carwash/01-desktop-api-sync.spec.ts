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

import { test, expect, type APIRequestContext } from '@playwright/test';
import { seedPopulatedAppState } from '../../fixtures/seed-state';
import {
  apiHeaders, connectDesktop, createWalkIn, hasDotnet, navigate, startDevHost, type DevHost,
} from '../../fixtures/carwash-devhost';

let api: DevHost;
let apiUrl = '';

async function apiJobs(request: APIRequestContext): Promise<Array<Record<string, any>>> {
  const res = await request.get(`${apiUrl}/api/jobs`, { headers: await apiHeaders(request, apiUrl) });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

test.describe.serial('SparkleWash desktop ↔ API', () => {
  test.skip(!hasDotnet, 'needs the .NET SDK to run the API dev host');
  test.setTimeout(180_000);

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    api = await startDevHost();
    apiUrl = api.url;
  });

  test.afterAll(() => api?.stop());

  test('work ticket → API → status from another device → POS payment → offline outbox', async ({ page, request }) => {
    await seedPopulatedAppState(page);

    // ── Connect and sign in (dev token; production uses the desktop Google sign-in) ──
    await connectDesktop(page, apiUrl);

    // ── 1. Walk-in = one printed work ticket, sent to the API ──
    await navigate(page, '#/carwash');
    await expect(page.getByTestId('carwash-board')).toBeVisible();
    // Live updates over /api/events, not the polling fallback.
    await expect(page.getByTestId('carwash-sync-status')).toContainText('En vivo', { timeout: 10_000 });
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
    const headers = await apiHeaders(request, apiUrl);
    for (const status of ['queued', 'in_progress']) {
      const res = await request.post(`${apiUrl}/api/jobs/${jobId}/transition`, {
        headers: { ...headers, 'Idempotency-Key': `e2e-ios-${status}-${jobId}` },
        data: { status },
      });
      expect(res.ok()).toBeTruthy();
    }
    const inProgress = page.getByTestId('carwash-col-in_progress').getByTestId('carwash-job-card').filter({ hasText: 'P123456' });
    // Pushed by the event stream: well inside the 15 s polling interval.
    await expect(inProgress).toBeVisible({ timeout: 5_000 });

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
