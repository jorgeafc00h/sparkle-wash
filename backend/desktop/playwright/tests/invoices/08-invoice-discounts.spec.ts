/**
 * Invoice (DTE) creation — percentage discounts end-to-end on the web build.
 *
 * Discounts are entered as PERCENTAGES: a per-line % input plus the default
 * quick chips (5/10/15/20) that apply one percentage to every line. Covers
 * discount-aware totals (IVA computed on the net, per-item /1.13 base for
 * CCF), saving, and the persisted invoice on the detail page.
 */

import { test, expect, Page } from '@playwright/test';
import {
  seedPopulatedAppState,
  waitForAppReady,
} from '../../fixtures/seed-state';

/** Newest invoice id straight from the persisted redux state. */
async function newestInvoiceId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem('persist:invoices') ?? '{}';
    const slice = JSON.parse(raw) as { invoices?: string };
    const invoices = JSON.parse(slice.invoices ?? '[]') as Array<{ id: string }>;
    return invoices[0]?.id ?? '';
  });
}

test.describe('Invoice percentage discounts — Factura CF', () => {
  test.beforeEach(async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/invoices/add');
    await waitForAppReady(page);
    await expect(page.getByTestId('add-invoice')).toBeVisible({ timeout: 8_000 });
  });

  test('line % + apply-to-all chips net the total, IVA on the net, persists', async ({ page }) => {
    await page.getByText('Factura CF').first().click();
    await expect(page.getByText('Información General')).toBeVisible({ timeout: 5_000 });

    // Papel Bond A4 ($5.50 IVA-inclusive) with a 50% line discount → $2.75 net.
    await page.getByTestId('btn-add-invoice-item').click();
    const row = page.locator('tbody tr[data-testid^="inv-line-row-"]').first();
    await row.locator('input[data-testid^="inv-line-product-"]').fill('Papel');
    await page.getByText('Papel Bond A4').first().click();
    await page.waitForTimeout(300);

    await row.locator('input[data-testid^="inv-line-discount-"]').fill('50');
    await expect(row.locator('[data-testid^="inv-line-total-"]')).toContainText('$2.75');
    // Factura CF keeps IVA-inclusive totals: IVA = 2.75 − 2.75/1.13 = $0.32.
    await expect(page.getByTestId('inv-totals-iva')).toContainText('$0.32');
    await expect(page.getByTestId('inv-totals-total')).toContainText('$2.75');

    // Add Silla de Oficina ($120.00) and apply the 10% quick chip to ALL lines:
    // Papel 5.50 − 0.55 = 4.95; Silla 120 − 12.00 = 108.00; TOTAL $112.95.
    await page.getByTestId('btn-add-invoice-item').click();
    const row2 = page.locator('tbody tr[data-testid^="inv-line-row-"]').nth(1);
    await row2.locator('input[data-testid^="inv-line-product-"]').fill('Silla');
    await page.getByText('Silla de Oficina').first().click();
    await page.waitForTimeout(300);

    await page.getByTestId('inv-disc-chip-10').click();
    await expect(row.locator('[data-testid^="inv-line-total-"]')).toContainText('$4.95');
    await expect(row2.locator('[data-testid^="inv-line-total-"]')).toContainText('$108.00');
    await expect(page.getByTestId('inv-totals-discount')).toContainText('$12.55');
    // IVA = 112.95 − 112.95/1.13 = $12.99.
    await expect(page.getByTestId('inv-totals-iva')).toContainText('$12.99');
    await expect(page.getByTestId('inv-totals-total')).toContainText('$112.95');

    // The % inputs show the applied 10 (canonical, after chip cleared drafts).
    await expect(row.locator('input[data-testid^="inv-line-discount-"]')).toHaveValue('10');
    await expect(row2.locator('input[data-testid^="inv-line-discount-"]')).toHaveValue('10');

    await page.getByTestId('btn-save').click();
    await expect(page.getByText('DTE creado correctamente.')).toBeVisible({ timeout: 5_000 });

    // Detail page renders the persisted discounted invoice.
    const id = await newestInvoiceId(page);
    await page.goto(`/#/invoices/${id}`);
    await waitForAppReady(page);
    await expect(page.locator('table').first()).toContainText('Descuento');
    await expect(page.getByTestId('inv-totals-discount')).toContainText('$12.55');
    await expect(page.getByTestId('inv-totals-total')).toContainText('$112.95');
  });

  test('discount column stays hidden for a DTE type that does not map discounts', async ({ page }) => {
    await page.getByText('Sujeto Excluido').first().click();
    await expect(page.getByText('Información General')).toBeVisible({ timeout: 5_000 });

    await page.getByTestId('btn-add-invoice-item').click();
    await expect(page.locator('thead').getByText('Descuento')).toHaveCount(0);
    await expect(page.getByTestId('inv-discount-quick')).toHaveCount(0);
  });
});

test.describe('Invoice percentage discounts — CCF', () => {
  test.beforeEach(async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/invoices/add');
    await waitForAppReady(page);
    await expect(page.getByTestId('add-invoice')).toBeVisible({ timeout: 8_000 });
  });

  test('CCF computes the base and IVA on the discounted amount (per-item /1.13)', async ({ page }) => {
    await page.getByText('CCF').first().click();
    await expect(page.getByText('Información General')).toBeVisible({ timeout: 5_000 });

    // Business customer with retention (Empresa XYZ).
    const customerInput = page.locator('input[placeholder="Buscar cliente..."]');
    await customerInput.fill('Empresa XYZ');
    await page.locator('text=Empresa XYZ').first().click();

    // Laptop Dell Inspiron $850.00 IVA-inclusive with a 20% discount →
    // $170.00 off → net $680.00.
    await page.getByTestId('btn-add-invoice-item').click();
    const row = page.locator('tbody tr[data-testid^="inv-line-row-"]').first();
    await row.locator('input[data-testid^="inv-line-product-"]').fill('Laptop');
    await page.getByText('Laptop Dell Inspiron').first().click();
    await page.waitForTimeout(300);

    await row.locator('input[data-testid^="inv-line-discount-"]').fill('20');
    await expect(row.locator('[data-testid^="inv-line-total-"]')).toContainText('$680.00');

    // Base = round(680 / 1.13) = $601.77; IVA = round(601.77 × 0.13) = $78.23;
    // Retención IVA 1% = $6.02; Total a Pagar = 680.00 − 6.02 = $673.98 (the DTE's
    // resumen.totalPagar nets the withheld 1%).
    await expect(page.getByTestId('inv-totals-subtotal')).toContainText('$601.77');
    await expect(page.getByTestId('inv-totals-iva')).toContainText('$78.23');
    await expect(page.getByTestId('inv-totals-retencion-iva')).toContainText('$6.02');
    await expect(page.getByTestId('inv-totals-total')).toContainText('$673.98');
  });
});
