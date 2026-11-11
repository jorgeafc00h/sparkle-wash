import { test, expect } from '@playwright/test';
import { seedPopulatedAppState } from '../../fixtures/seed-state';
import { navigateToTab } from '../../utils/helpers';

test.describe('Invoices — Create', () => {
  test('add invoice page shows DTE type cards on step 1', async ({ page }) => {
    await seedPopulatedAppState(page);
    await navigateToTab(page, 'facturas');

    await page.getByTestId('btn-new-invoice').click();
    await expect(page.getByTestId('add-invoice')).toBeVisible({ timeout: 10000 });

    // Step 1 should show type cards
    await expect(page.getByText('Factura CF')).toBeVisible();
    // CCF appears in card label AND in "Corrección sobre CCF anterior" description — use exact match
    await expect(page.getByText('CCF', { exact: true })).toBeVisible();
    await expect(page.getByText('Nota de Crédito', { exact: true })).toBeVisible();
    await expect(page.getByTestId('eventos-mh-dte-group')).toBeVisible();
    await expect(page.getByText('Eventos MH/DTE')).toBeVisible();
    await expect(page.getByText('Evento Operaciones Especiales (17)')).toBeVisible();
    await expect(page.getByText('Evento de Retorno (18)')).toHaveCount(0);
    await expect(page.getByText(/No reemplazan la emisión de una factura/i)).toBeVisible();

    await page.getByText('Evento Operaciones Especiales (17)').click();
    await expect(page.getByText('Operación especial CAT-023')).toBeVisible();
    const operationType = page.getByLabel('Tipo de operación');
    await expect(operationType.locator('option[value="97"]')).toHaveText('97 — Comprobantes de Control Interno');
  });

  test('select invoice type advances to step 2', async ({ page }) => {
    await seedPopulatedAppState(page);
    await navigateToTab(page, 'facturas');

    await page.getByTestId('btn-new-invoice').click();
    await expect(page.getByTestId('add-invoice')).toBeVisible({ timeout: 10000 });

    // Click Factura CF type card
    await page.getByText('Factura CF').click();

    // Step 2 should be visible
    await expect(page.getByText('Paso 2 — Completa los datos del documento')).toBeVisible({ timeout: 5000 });
  });

  test('Evento de Retorno blocks save without an eligible source DTE', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/invoices/add?type=18&parentId=inv-002');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByText('Nuevo Evento de Retorno (18)')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('DTE de origen para Retorno')).toBeVisible();

    await page.getByRole('button', { name: /Agregar ítem/i }).click();
    const nameInputs = page.locator('input[placeholder="Descripción del producto..."]');
    if (await nameInputs.count() > 0) {
      await nameInputs.first().fill('Retorno de prueba');
    }
    const priceInputs = page.locator('input[type="number"]');
    if (await priceInputs.count() >= 2) {
      await priceInputs.nth(1).fill('100');
    }

    await page.getByTestId('btn-save').click();

    await expect(page.getByTestId('retorno-source-error')).toContainText('Selecciona un DTE origen válido');
    await expect(page.getByRole('alert').filter({ hasText: 'Selecciona un DTE origen válido' }).first()).toBeVisible();
    await expect(page).toHaveURL(/\/invoices\/add\?type=18&parentId=inv-002/);
  });

  test('fill invoice with line item and save navigates to list', async ({ page }) => {
    await seedPopulatedAppState(page);
    await navigateToTab(page, 'facturas');

    await page.getByTestId('btn-new-invoice').click();
    await expect(page.getByTestId('add-invoice')).toBeVisible({ timeout: 10000 });

    // Select Factura
    await page.getByText('Factura CF').click();
    await expect(page.getByText('Paso 2')).toBeVisible({ timeout: 5000 });

    // Add an item
    await page.getByRole('button', { name: /Agregar ítem/i }).click();

    // Fill product name in the text input (no products-based dropdown when using text input)
    const nameInputs = page.locator('input[placeholder="Descripción del producto..."]');
    if (await nameInputs.count() > 0) {
      await nameInputs.first().fill('Servicio de prueba');
    } else {
      // Try the product search input
      const productSearch = page.locator('input[placeholder*="producto"]').first();
      if (await productSearch.isVisible()) {
        await productSearch.fill('Servicio');
        await page.getByText('Servicio de Consultoría').first().click();
      }
    }

    // Fill price
    const priceInputs = page.locator('input[type="number"]');
    if (await priceInputs.count() >= 2) {
      await priceInputs.nth(1).fill('100');
    }

    // Save
    await page.getByTestId('btn-save').click();

    // Should navigate to invoices list
    await expect(page.getByTestId('sidebar-facturas')).toBeVisible({ timeout: 10000 });
  });
});
