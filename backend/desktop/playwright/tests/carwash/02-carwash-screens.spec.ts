/**
 * Visual record of the SparkleWash Desktop screens (rebrand + carwash module), against the REAL API.
 *
 * Captures full-page screenshots into $CARWASH_SCREENSHOT_DIR (default test-results/carwash-screens):
 * welcome/onboarding (rebrand), dashboard + sidebar, carwash settings with the work-ticket preview,
 * the Lavado board with jobs in every column, the "Nuevo servicio" modal, an offline job waiting
 * in the outbox, and the POS "Lavados por cobrar" flow. Each screen is also asserted, so a missing
 * element fails the spec instead of producing a blank picture.
 */

import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { seedEmptyAppState, seedPopulatedAppState, waitForAppReady } from '../../fixtures/seed-state';
import {
  apiHeaders, connectDesktop, createWalkIn, hasDotnet, navigate, startDevHost, type DevHost,
} from '../../fixtures/carwash-devhost';

const OUT = process.env.CARWASH_SCREENSHOT_DIR ?? path.join('test-results', 'carwash-screens');

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  // Let fonts, images and the reveal transitions settle.
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}

test.describe('SparkleWash Desktop screens', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('welcome and onboarding use the SparkleWash brand', async ({ page }) => {
    await page.goto('/#/welcome');
    await waitForAppReady(page);
    await expect(page.getByTestId('welcome')).toBeVisible();
    await expect(page.getByTestId('welcome')).toContainText('Sparkle');
    await expect(page.getByText('Facturas Simples', { exact: false })).toHaveCount(0);
    await shot(page, '01-welcome');

    await page.goto('/#/onboarding');
    await expect(page.getByTestId('onboarding')).toBeVisible();
    await shot(page, '02-onboarding');
  });

  test('dashboard and sidebar', async ({ page }) => {
    await seedEmptyAppState(page, 'pro');
    await expect(page.getByTestId('sidebar-inicio')).toBeVisible();
    await expect(page.getByRole('link', { name: /Lavado/ }).first()).toBeVisible();
    await shot(page, '03-dashboard');
  });

  test.describe('carwash module against the real API', () => {
    test.skip(!hasDotnet, 'needs the .NET SDK to run the API dev host');
    test.setTimeout(240_000);
    let api: DevHost;

    test.beforeAll(async () => {
      test.setTimeout(240_000);
      api = await startDevHost();
    });
    test.afterAll(() => api?.stop());

    test('settings, board, new service, offline job, POS charge', async ({ page, request }) => {
      await seedPopulatedAppState(page);
      await connectDesktop(page, api.url);
      await page.getByTestId('carwash-print-test').click();
      await expect(page.getByTestId('carwash-test-preview')).toContainText('ORDEN DE TRABAJO');
      await shot(page, '04-carwash-settings');
      const preview = page.getByTestId('carwash-test-preview');
      await preview.scrollIntoViewIfNeeded();
      await preview.screenshot({ path: path.join(OUT, '04b-work-ticket-preview.png') });

      // Three walk-ins from the counter, moved along by "another device" (iOS/web) through the API.
      await navigate(page, '#/carwash');
      await expect(page.getByTestId('carwash-board')).toBeVisible();
      for (const [plate, cls, pkg] of [['P123456', 'suv', 'essential'], ['M554433', 'car', 'quick'], ['C778899', 'pickup', 'supreme']]) {
        await createWalkIn(page, plate, cls, pkg);
        await expect(page.getByTestId('carwash-job-card').filter({ hasText: plate })).toBeVisible();
      }
      const headers = await apiHeaders(request, api.url);
      const jobs: Array<{ id: string; plate: string }> = await (await request.get(`${api.url}/api/jobs`, { headers })).json();
      const move = async (plate: string, statuses: string[]) => {
        const job = jobs.find((j) => j.plate === plate)!;
        for (const status of statuses) {
          const res = await request.post(`${api.url}/api/jobs/${job.id}/transition`, {
            headers: { ...headers, 'Idempotency-Key': `shot-${status}-${job.id}` }, data: { status },
          });
          expect(res.ok()).toBeTruthy();
        }
      };
      await move('M554433', ['queued']);
      await move('C778899', ['queued', 'in_progress', 'completed']);
      await expect(page.getByTestId('carwash-col-completed').getByTestId('carwash-job-card').filter({ hasText: 'C778899' }))
        .toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('carwash-col-queued').getByTestId('carwash-job-card').filter({ hasText: 'M554433' }))
        .toBeVisible();
      await shot(page, '05-carwash-board');

      await page.getByTestId('carwash-new-service').click();
      await page.getByTestId('carwash-plate-input').fill('P900100');
      await page.getByTestId('carwash-class-xl').click();
      await page.getByTestId('carwash-package-renew').click();
      await shot(page, '06-carwash-new-service');
      await page.getByTestId('carwash-cancel').click();

      // Offline: printed at once, waiting in the outbox.
      await page.route(`${api.url}/**`, (route) => route.abort('internetdisconnected'));
      await createWalkIn(page, 'N1CO42', 'car', 'quick');
      const offline = page.getByTestId('carwash-job-card').filter({ hasText: 'N1CO42' });
      await expect(offline.getByTestId('carwash-pending-badge')).toBeVisible();
      await shot(page, '07-carwash-offline-pending');
      await page.unroute(`${api.url}/**`);
      await page.getByTestId('carwash-sync').click();
      await expect(offline.getByTestId('carwash-pending-badge')).toHaveCount(0, { timeout: 20_000 });

      // POS: charge the finished job.
      await navigate(page, '#/pos');
      await expect(page.getByTestId('pos-register')).toBeVisible();
      await page.getByTestId('pos-carwash-pending').click();
      await expect(page.getByTestId('pos-carwash-list')).toBeVisible();
      await shot(page, '08-pos-lavados-por-cobrar');
      const finished = jobs.find((j) => j.plate === 'C778899')!;
      await page.getByTestId(`pos-carwash-job-${finished.id}`).click();
      await expect(page.getByTestId('pos-total')).toContainText('50.00');
      await shot(page, '09-pos-cart-with-carwash-line');
      await page.getByTestId('btn-charge').click();
      await page.getByTestId('pay-cash-tendered').fill('50');
      await shot(page, '10-pos-payment');
      await page.getByTestId('btn-confirm-payment').click();
      await expect(page.getByText(/Ticket #\d+ guardado/)).toBeVisible({ timeout: 10_000 });

      await navigate(page, '#/carwash');
      await expect(page.getByTestId('carwash-col-completed').getByTestId('carwash-job-card').filter({ hasText: 'C778899' })
        .getByTestId('carwash-pay-chip')).toBeVisible({ timeout: 15_000 });
      await shot(page, '11-carwash-board-after-payment');
    });
  });
});
