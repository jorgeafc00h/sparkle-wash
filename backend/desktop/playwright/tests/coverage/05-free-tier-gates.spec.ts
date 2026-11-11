/**
 * Free (Lite) tier gates from the 2026-10-10 E2E coverage review:
 *  - 10 documents/month cap — only for a LIVE production company on Lite;
 *    test companies, paid tiers and corrections to an existing document
 *    (?parentId) are exempt.
 *  - "Enviar por Email" is a paid feature: Lite opens the plans modal.
 */

import { test, expect, type Page } from '@playwright/test';
import { launchAs } from '../../fixtures/launch-modes';
import { SAMPLE_INVOICES, blockExternalNetwork, completedToday, productsState, seedStorage, subscriptionState } from './_support';

const CAP = 10;

/** `count` issued Facturas created this month (+ one CCF to correct). */
function monthOfInvoices(count: number): any[] {
  const base = SAMPLE_INVOICES[0];
  const docs = Array.from({ length: count - 1 }, (_, i) =>
    completedToday(base, { id: `month-${i}`, generationCode: `AAAAAAAA-0000-4000-8000-${String(i).padStart(12, '0')}` }),
  );
  docs.push(completedToday(SAMPLE_INVOICES[1], { id: 'month-ccf' }));
  return docs;
}

async function launch(page: Page, opts: { tier: 'lite' | 'pro'; live: boolean; invoices: number }) {
  await launchAs(page, 'mhLiteSync', { invoices: monthOfInvoices(opts.invoices) });
  await seedStorage(page, { 'persist:products': productsState(), 'persist:subscription': subscriptionState(opts.tier) });
  if (opts.live) {
    // launchAs seeds a Pruebas company; promote it to a live production company.
    await page.addInitScript(() => {
      const raw = localStorage.getItem('persist:companies');
      if (!raw) return;
      const outer = JSON.parse(raw) as Record<string, string>;
      const live = (c: Record<string, unknown>) => ({ ...c, environment: 'PRODUCTION', isTestAccount: false, isProduction: true });
      outer.companies = JSON.stringify((JSON.parse(outer.companies) as Record<string, unknown>[]).map(live));
      if (outer.currentCompany && outer.currentCompany !== 'null') {
        outer.currentCompany = JSON.stringify(live(JSON.parse(outer.currentCompany)));
      }
      localStorage.setItem('persist:companies', JSON.stringify(outer));
    });
  }
  await blockExternalNetwork(page);
}

const limitScreen = (page: Page) => page.getByTestId('invoice-add-limit-reached');
const plansModal = (page: Page) => page.getByText('Planes de suscripción');

test.describe('Free tier — 10 documents per month', () => {
  test('Lite + live company at 10 documents this month: "Límite mensual alcanzado" and the plans modal', async ({ page }) => {
    await launch(page, { tier: 'lite', live: true, invoices: CAP });
    await page.goto('/#/invoices/add');
    await expect(limitScreen(page)).toBeVisible({ timeout: 20_000 });
    await expect(limitScreen(page)).toContainText('Límite mensual alcanzado');
    await expect(limitScreen(page)).toContainText(`${CAP} de ${CAP}`);
    await page.getByRole('button', { name: 'Ver planes' }).click();
    await expect(plansModal(page)).toBeVisible();
  });

  test('a correction to an existing document (?parentId) is still allowed at the cap', async ({ page }) => {
    await launch(page, { tier: 'lite', live: true, invoices: CAP });
    await page.goto('/#/invoices/add?type=2&parentId=month-ccf');
    await expect(page.getByTestId('add-invoice')).toBeVisible({ timeout: 20_000 });
    await expect(limitScreen(page)).toHaveCount(0);
  });

  test('one below the cap can still create', async ({ page }) => {
    await launch(page, { tier: 'lite', live: true, invoices: CAP - 1 });
    await page.goto('/#/invoices/add');
    await expect(page.getByTestId('add-invoice')).toBeVisible({ timeout: 20_000 });
    await expect(limitScreen(page)).toHaveCount(0);
  });

  test('a Pruebas (test) company is never capped', async ({ page }) => {
    await launch(page, { tier: 'lite', live: false, invoices: CAP + 2 });
    await page.goto('/#/invoices/add');
    await expect(page.getByTestId('add-invoice')).toBeVisible({ timeout: 20_000 });
    await expect(limitScreen(page)).toHaveCount(0);
  });

  test('a paid tier is never capped', async ({ page }) => {
    await launch(page, { tier: 'pro', live: true, invoices: CAP + 2 });
    await page.goto('/#/invoices/add');
    await expect(page.getByTestId('add-invoice')).toBeVisible({ timeout: 20_000 });
    await expect(limitScreen(page)).toHaveCount(0);
  });
});

test.describe('Free tier — email', () => {
  test('Lite: "Enviar por Email" on an issued DTE opens the plans modal instead of sending', async ({ page }) => {
    await launch(page, { tier: 'lite', live: false, invoices: 2 });
    let apiCalls = 0;
    page.on('request', (req) => {
      if (/email|send/i.test(req.url()) && !req.url().includes('127.0.0.1')) apiCalls += 1;
    });
    await page.goto('/#/invoices/month-0');
    await expect(page.getByTestId('invoice-detail')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('btn-send-email').click();
    await expect(plansModal(page)).toBeVisible();
    expect(apiCalls).toBe(0);
  });

  test('a paid tier does not get the plans modal', async ({ page }) => {
    await launch(page, { tier: 'pro', live: false, invoices: 2 });
    await page.goto('/#/invoices/month-0');
    await expect(page.getByTestId('invoice-detail')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('btn-send-email').click();
    await page.waitForTimeout(500);
    await expect(plansModal(page)).toHaveCount(0);
  });
});
