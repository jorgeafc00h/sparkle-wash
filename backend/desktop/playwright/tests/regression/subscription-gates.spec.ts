/**
 * Regression tests for tier gating on paid features (2026-09-23 review).
 *
 *  - Gate 1: company-count limit per tier (Lite=1, Pro=3, Business=∞) is
 *            enforced on the create-company wizard. Previously the limit was
 *            defined in FeatureGate but never wired into the UI — a Lite user
 *            could create unlimited companies.
 *  - Gate 2: InvoiceExportPage paid formats (JSON, batch PDF) and the Google
 *            Drive upload require a paid tier. Excel stays free for everyone.
 *            The gate surfaces the subscription modal instead of exporting.
 */

import { test, expect, type Page } from '@playwright/test';
import {
  seedEmptyAppState,
  seedPopulatedAppState,
  waitForAppReady,
} from '../../fixtures/seed-state';

/**
 * Downgrade (or upgrade) the subscription tier AFTER a seed helper ran, so a
 * populated Pro state can be reused to test the Lite gates with real data.
 * The seed helpers register their own addInitScript, and init scripts run in
 * registration order on every NEW document — so registering this override
 * after the seed and then reloading rewrites the tier before the app boots.
 * (A plain page.evaluate rewrite gets clobbered: the still-booted store holds
 * the old tier and redux-persist flushes it back before the reload lands.)
 */
async function overrideTierAndReload(
  page: Page,
  tier: 'lite' | 'adfree' | 'pro',
  path: string,
) {
  await page.addInitScript((t) => {
    const raw = window.localStorage.getItem('persist:subscription');
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const inner: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed)) {
      inner[k] = typeof v === 'string' ? JSON.parse(v) : v;
    }
    inner.tier = t;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(inner)) out[k] = JSON.stringify(v);
    window.localStorage.setItem('persist:subscription', JSON.stringify(out));
  }, tier);
  await page.goto(path);
  // Hash-router navigation from the seeded page is same-document — init
  // scripts never re-ran. Force a fresh document so the override applies.
  await page.reload();
  await waitForAppReady(page);
}

test.describe('Company-count limit per tier', () => {
  test('Lite with 1 company blocks the wizard and offers plans', async ({ page }) => {
    await seedEmptyAppState(page); // Lite + exactly 1 seeded company
    await page.goto('/#/companies/add');
    await waitForAppReady(page);

    await expect(page.getByTestId('company-limit-reached')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('create-company')).toHaveCount(0);
    await expect(page.getByText(/Límite de empresas de tu plan alcanzado/i)).toBeVisible();

    // "Ver planes" opens the subscription modal.
    await page.getByRole('button', { name: /Ver planes/i }).click();
    await expect(page.getByText('Planes de suscripción')).toBeVisible({ timeout: 5_000 });
  });

  test('Pro tier keeps the create-company wizard open', async ({ page }) => {
    await seedPopulatedAppState(page); // Pro tier
    await page.goto('/#/companies/add');
    await waitForAppReady(page);

    await expect(page.getByTestId('create-company')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('company-limit-reached')).toHaveCount(0);
  });
});

test.describe('Invoice export — paid format gates', () => {
  test('Lite tier: paid formats are labelled and blocked with the upgrade modal', async ({ page }) => {
    await seedPopulatedAppState(page); // has invoices so the buttons enable
    await overrideTierAndReload(page, 'lite', '/#/invoices/export');

    await expect(page.getByTestId('invoice-export')).toBeVisible({ timeout: 10_000 });

    // Paid affordances are visible in the UI copy.
    await expect(page.getByRole('option', { name: /JSON — plan de pago/i })).toHaveCount(1);
    await expect(page.getByRole('option', { name: /PDF \(individual\) — plan de pago/i })).toHaveCount(1);
    await expect(page.getByTestId('btn-send-to-drive')).toContainText(/plan de pago/i);

    // Widen the date filter — seeded sample invoices predate the current month.
    await page.getByLabel(/Desde/i).fill('2024-01-01');

    // Selecting JSON and exporting opens the subscription modal instead.
    // The format select is the third combobox on the page (tipo, estado, formato).
    const formatSelect = page.getByRole('combobox').nth(2);
    await expect(formatSelect).toContainText(/Excel \(\.xlsx\)/i);
    await formatSelect.selectOption('json');

    const downloadBtn = page.getByRole('button', { name: /Descargar/i });
    await expect(downloadBtn).toBeEnabled();
    await downloadBtn.click();

    await expect(page.getByText('Planes de suscripción')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/La exportación JSON es un plan de pago/i)).toBeVisible();
  });

  test('Pro tier: all export formats and Drive stay open', async ({ page }) => {
    await seedPopulatedAppState(page); // Pro tier
    await page.goto('/#/invoices/export');
    await waitForAppReady(page);

    await expect(page.getByTestId('invoice-export')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('btn-send-to-drive')).not.toContainText(/plan de pago/i);
  });
});
