// Regression test for the $0.02 IVA discrepancy in CCF invoices (2026-05-21).
//
// Root cause: round(ΣIVAInclusivePrices / 1.13) ≠ Σround(price / 1.13)
// Fixed in: invoiceSlice.computeTotals + InvoiceTotals component.

import { test, expect } from '@playwright/test';
import {
  seedPopulatedAppState,
  waitForAppReady,
} from '../../fixtures/seed-state';

test.describe('CCF IVA Rounding — regression', () => {
  test.beforeEach(async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/invoices/add');
    await waitForAppReady(page);
    await expect(page.getByTestId('add-invoice')).toBeVisible({ timeout: 8_000 });
  });

  // Laptop Dell Inspiron ($850.00) + Silla de Oficina ($120.00) as CCF items:
  //   per-item base: round(850/1.13)=$752.21  round(120/1.13)=$106.19  sum=$858.40
  //   old divide-after-sum: round(970/1.13)=$858.41
  //   drift = $0.01 in Subtotal (sin IVA)
  test('Subtotal (sin IVA) uses per-item base sum for CCF, not divide-after-sum', async ({ page }) => {
    // Step 1: Select CCF type
    await page.getByText('CCF').first().click();
    await expect(page.getByText('Información General')).toBeVisible({ timeout: 5_000 });

    // Step 2: Select business customer with retention (Empresa XYZ, hasContributorRetention: true)
    const customerInput = page.locator('input[placeholder="Buscar cliente..."]');
    await customerInput.fill('Empresa XYZ');
    await page.locator('text=Empresa XYZ').first().click();

    // Step 3: Add Laptop Dell Inspiron ($850.00 IVA-inclusive)
    //   per-item base = round(850 / 1.13) = $752.21
    await page.getByRole('button', { name: /Agregar/i }).click();
    const productInputs = page.locator('input[placeholder^="Buscar producto"]');
    await productInputs.last().fill('Laptop');
    await page.locator('text=Laptop Dell Inspiron').first().click();
    await page.waitForTimeout(300);

    // Step 4: Add Silla de Oficina ($120.00 IVA-inclusive)
    //   per-item base = round(120 / 1.13) = $106.19
    await page.getByRole('button', { name: /Agregar/i }).click();
    await productInputs.last().fill('Silla');
    await page.locator('text=Silla de Oficina').first().click();
    await page.waitForTimeout(300);

    // Step 5: Verify Subtotal (sin IVA) = $858.40 (per-item sum, correct)
    //         NOT $858.41 (old divide-after-sum)
    const subTotalRow = page.locator('text=Subtotal (sin IVA)').locator('..');
    await expect(subTotalRow).toBeVisible({ timeout: 5_000 });
    const subTotalText = await subTotalRow.textContent();
    expect(subTotalText).toContain('858.40');
    expect(subTotalText).not.toContain('858.41');

    // Step 6: IVA = gross − base = 970.00 − 858.40 = $111.60 — the sum of the per-item
    //         IVA the DTE reports in resumen.tributos (97.79 + 13.81), so the editor,
    //         the stored invoice and the F07 annex match what Hacienda holds.
    const ivaRow = page.locator('text=IVA (13%)').locator('..');
    await expect(ivaRow).toBeVisible({ timeout: 5_000 });
    const ivaText = await ivaRow.textContent();
    expect(ivaText).toContain('111.60');

    // Step 7: Retención IVA (1%) = round(858.40 × 0.01) = $8.58
    const retRow = page.locator('text=Retención IVA (1%)').locator('..');
    await expect(retRow).toBeVisible({ timeout: 5_000 });
    const retText = await retRow.textContent();
    expect(retText).toContain('8.58');

    // Step 8: Total a Pagar nets the 1% retention, like the DTE's resumen.totalPagar
    const totalRow = page.getByTestId('inv-totals-total');
    await expect(totalRow).toContainText('961.42');
  });
});
