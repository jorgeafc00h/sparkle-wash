/**
 * Compras "uso interno": a purchase that is not a valid national DTE is
 * recorded for internal control only. Flow: create it from /compras/add,
 * see the badge on list + detail, filter the list, and verify the export
 * page counts it as excluded (the MH CSV never carries it).
 */
import { test, expect } from '@playwright/test';
import { seedFinanceAppState, waitForAppReady } from '../../fixtures/seed-state';

test.describe('Compras — uso interno', () => {
  test('creates an internal-use purchase without DTE identifiers, badges it, filters it and excludes it from export', async ({ page }) => {
    await seedFinanceAppState(page);
    await page.goto('/#/compras/add');
    await waitForAppReady(page);

    await page.getByTestId('compra-mode-internal').click();
    await expect(page.getByTestId('compra-internal-hint')).toBeVisible();
    // No DTE identifiers are asked for in this mode.
    await expect(page.getByLabel('Código de Generación')).toHaveCount(0);

    await page.getByLabel('Nombre del proveedor').fill('Amazon Abroad LLC');
    await page.getByTestId('compra-document-reference').fill('ORDER-777');
    await page.getByTestId('compra-internal-reason').fill('Compra en el extranjero');
    await page.getByTestId('compra-venta-gravada-0').fill('50');
    await page.getByRole('button', { name: 'Guardar Compra' }).click();

    // List: badge + filter.
    await expect(page.getByTestId('compras-list')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Amazon Abroad LLC')).toBeVisible();
    await expect(page.locator('[data-testid^="compra-internal-chip-"]')).toHaveCount(1);
    await expect(page.getByText('Proveedor Demo S.A. de C.V.')).toBeVisible();

    await page.getByTestId('compras-uso-filter').selectOption('internal');
    await expect(page.getByText('Amazon Abroad LLC')).toBeVisible();
    await expect(page.getByText('Proveedor Demo S.A. de C.V.')).toBeHidden();
    await page.getByTestId('compras-uso-filter').selectOption('dte');
    await expect(page.getByText('Amazon Abroad LLC')).toBeHidden();
    await expect(page.getByText('Proveedor Demo S.A. de C.V.')).toBeVisible();

    // Detail: banner with reason/reference, no MH verification.
    await page.getByTestId('compras-uso-filter').selectOption('internal');
    await page.getByText('Amazon Abroad LLC').click();
    await expect(page.getByTestId('compra-internal-banner')).toContainText('Uso interno');
    await expect(page.getByTestId('compra-internal-banner')).toContainText('ORDER-777');
    await expect(page.getByTestId('compra-internal-banner')).toContainText('Compra en el extranjero');
    await expect(page.getByText('Verificación con Ministerio de Hacienda')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Verificar en Consulta Pública' })).toHaveCount(0);

    // Export: counted as excluded; the include toggle is Excel-only.
    await page.goto('/#/compras/export');
    await waitForAppReady(page);
    await expect(page.getByTestId('compras-export-internal-excluded')).toContainText('1 compra de uso interno excluida');
    await expect(page.getByTestId('compras-export-include-internal')).toBeDisabled();
  });
});
