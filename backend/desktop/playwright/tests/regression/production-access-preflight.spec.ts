/**
 * Production-access wizard — pre-flight verification, per-batch selection and
 * the end-of-run summary (2026-09-23).
 *
 *  1. The signing certificate is verified first, then the Hacienda credentials
 *     directly against MH (MockMhClient here) — before anything is generated.
 *  2. A failed check blocks the run and the start button stays disabled.
 *  3. Contingencia / Invalidación are selectable on their own: sending ONLY the
 *     invalidation events runs just that batch.
 *  4. Every run ends in a summary dialog that says which batch each error came
 *     from, with the document number and MH's message.
 */

import { test, expect } from '@playwright/test';
import { launchAs, TEST_COMPANY } from '../../fixtures/launch-modes';
import { waitForAppReady } from '../../fixtures/seed-state';

const PAGE = `/#/companies/${TEST_COMPANY.id}/request-production`;

async function openWizard(page: import('@playwright/test').Page) {
  await page.goto(PAGE);
  await waitForAppReady(page);
  await expect(page.getByTestId('request-production')).toBeVisible({ timeout: 15000 });
}

async function selectOnly(page: import('@playwright/test').Page, key: string) {
  await page.getByTestId('btn-clear-types').click();
  await page.getByTestId(`chk-type-${key}`).check();
}

test.describe('Production access — pre-flight verification', () => {
  test('certificate and MH credentials are verified before anything is sent', async ({ page }) => {
    await launchAs(page, 'mhLiteSync');
    await openWizard(page);

    await expect(page.getByTestId('req-cert')).toHaveText('Verificado', { timeout: 15000 });
    await expect(page.getByTestId('req-cert-message')).toContainText('firma de prueba');
    await expect(page.getByTestId('req-creds')).toHaveText('Verificadas', { timeout: 15000 });
    await expect(page.getByTestId('btn-start-full-process')).toBeEnabled();
  });

  test('rejected MH credentials block the run and explain why', async ({ page }) => {
    await launchAs(page, 'mhLiteSync', { mockScenario: 'auth-failure' });
    await openWizard(page);

    await expect(page.getByTestId('req-cert')).toHaveText('Verificado', { timeout: 15000 });
    await expect(page.getByTestId('req-creds')).toHaveText('Inválido', { timeout: 15000 });
    await expect(page.getByTestId('req-creds-message')).toContainText('Hacienda rechazó');
    await expect(page.getByTestId('btn-start-full-process')).toBeDisabled();
    await expect(page.getByTestId('btn-go-config')).toBeVisible();
  });
});

test.describe('Production access — batch selection + summary', () => {
  test('both event batches are selectable rows', async ({ page }) => {
    await launchAs(page, 'mhLiteSync');
    await openWizard(page);

    await expect(page.getByTestId('chk-type-contingencia')).toBeChecked();
    await expect(page.getByTestId('chk-type-invalidacion')).toBeChecked();
    await expect(page.getByText('Evento de Invalidación (5)')).toBeVisible();
    await page.getByTestId('chk-type-invalidacion').uncheck();
    await expect(page.getByTestId('chk-type-invalidacion')).not.toBeChecked();
  });

  test('sending ONLY the invalidation events runs just that batch and ends in a summary', async ({ page }) => {
    test.setTimeout(120000);
    await launchAs(page, 'mhLiteSync');
    await openWizard(page);
    await expect(page.getByTestId('req-creds')).toHaveText('Verificadas', { timeout: 15000 });

    await selectOnly(page, 'invalidacion');
    await page.getByTestId('btn-start-full-process').click();

    const dialog = page.getByTestId('production-summary-dialog');
    await expect(dialog).toBeVisible({ timeout: 90000 });
    await expect(dialog.getByTestId('summary-batch-invalidacion')).toBeVisible();
    await expect(dialog.getByTestId('summary-batch-factura')).toHaveCount(0);
    await expect(dialog.getByTestId('summary-batch-invalidacion')).toContainText('Aceptado');
    await page.screenshot({ path: 'test-results/prod-access-invalidation-only-summary.png' });
    await page.getByTestId('btn-close-summary').click();
    await expect(dialog).toBeHidden();
  });

  test('a rejected DTE is reported under its batch with the document number and MH detail', async ({ page }) => {
    test.setTimeout(120000);
    await launchAs(page, 'mhLiteSync', { mockScenario: 'dte-rejected' });
    await openWizard(page);
    await expect(page.getByTestId('req-creds')).toHaveText('Verificadas', { timeout: 15000 });

    await page.getByRole('button', { name: '5 por tipo', exact: true }).click();
    await selectOnly(page, 'factura');
    await page.getByTestId('btn-start-full-process').click();

    const dialog = page.getByTestId('production-summary-dialog');
    await expect(dialog).toBeVisible({ timeout: 90000 });
    await expect(page.getByRole('heading', { name: 'Proceso completado con errores' })).toBeVisible();
    const batch = dialog.getByTestId('summary-batch-factura');
    await expect(batch).toContainText('Con errores');
    await expect(batch.getByTestId('summary-issue').first()).toContainText('Documento #');
    await expect(batch.getByTestId('summary-issue').first()).toContainText('DTE_REJECTED');
    await page.screenshot({ path: 'test-results/prod-access-rejected-summary.png' });

    await page.getByTestId('btn-close-summary').click();
    // The row links back to the detail.
    await expect(page.getByTestId('row-errors-factura')).toBeVisible();
  });
});

test.describe('Production access — new batches and recovery (2026-09-26)', () => {
  test('a company with documents accepted in an earlier session still gets a fresh batch sent', async ({ page }) => {
    test.setTimeout(120000);
    const earlier = new Date(Date.now() - 86_400_000).toISOString();
    const accepted = Array.from({ length: 5 }, (_, i) => ({
      id: `earlier-${i}`,
      companyId: TEST_COMPANY.id,
      invoiceType: 0, // InvoiceType.Factura
      status: 2, // InvoiceStatus.Completada
      invoiceNumber: `0000${i}`,
      controlNumber: `DTE-01-M001P001-${String(800000000000000 + i)}`,
      generationCode: `00000000-0000-4000-8000-00000000000${i}`,
      documentType: '01',
      date: earlier,
      createdAt: earlier,
      updatedAt: earlier,
      items: [],
      totalAmount: 10,
    }));
    await launchAs(page, 'mhLiteSync', { invoices: accepted });
    await openWizard(page);
    await expect(page.getByTestId('req-creds')).toHaveText('Verificadas', { timeout: 15000 });

    await page.getByRole('button', { name: '5 por tipo', exact: true }).click();
    await selectOnly(page, 'factura');
    await page.getByTestId('btn-start-full-process').click();

    const dialog = page.getByTestId('production-summary-dialog');
    await expect(dialog).toBeVisible({ timeout: 90000 });
    // Used to be skipped ("Ya existen suficientes…") while still reading "Aceptado".
    await expect(dialog.getByTestId('summary-batch-factura')).toContainText('5 de 5 aceptados por Hacienda');
    await expect(dialog).not.toContainText('Ya existen suficientes');
    await page.getByTestId('btn-close-summary').click();
    await expect(page.getByTestId('row-sent-factura')).toHaveText('5 aceptados');

    // A second run sends another fresh batch.
    await page.getByTestId('btn-start-full-process').click();
    await expect(dialog.getByTestId('summary-batch-factura')).toContainText('5 de 5 aceptados por Hacienda', { timeout: 90000 });
    await page.getByTestId('btn-close-summary').click();
    await expect(page.getByTestId('row-sent-factura')).toHaveText('10 aceptados');
  });

  test('a run with rejected documents offers "Reintentar lotes con errores" and "Reenviar pendientes"', async ({ page }) => {
    test.setTimeout(120000);
    await launchAs(page, 'mhLiteSync', { mockScenario: 'dte-rejected' });
    await openWizard(page);
    await expect(page.getByTestId('req-creds')).toHaveText('Verificadas', { timeout: 15000 });
    await expect(page.getByTestId('btn-send-generated')).toHaveCount(0);

    await page.getByRole('button', { name: '5 por tipo', exact: true }).click();
    await selectOnly(page, 'factura');
    await page.getByTestId('chk-type-contingencia').check();
    await page.getByTestId('btn-start-full-process').click();

    const dialog = page.getByTestId('production-summary-dialog');
    await expect(dialog).toBeVisible({ timeout: 90000 });
    await expect(dialog.getByTestId('summary-batch-factura')).toContainText('Con errores');
    await expect(page.getByTestId('btn-retry-failed')).toBeVisible();
    await page.getByTestId('btn-close-summary').click();

    // The 5 rejected facturas can be resent without generating new ones.
    await expect(page.getByTestId('btn-send-generated')).toHaveText(/Reenviar pendientes \(5\)/);

    // Retry re-runs exactly the batches that failed (this mock scenario also
    // rejects contingency events) and the selection reflects the retry.
    await expect(page.getByTestId('chk-type-ccf')).not.toBeChecked();
    await page.getByTestId('btn-view-summary').click();
    await page.getByTestId('btn-retry-failed').click();
    await expect(dialog).toBeVisible({ timeout: 90000 });
    await expect(dialog.getByTestId('summary-batch-factura')).toBeVisible();
    await expect(dialog.getByTestId('summary-batch-contingencia')).toBeVisible();
    await expect(dialog.locator('[data-testid^="summary-batch-"]')).toHaveCount(2);
    await page.getByTestId('btn-close-summary').click();
    await expect(page.getByTestId('chk-type-factura')).toBeChecked();
    await expect(page.getByTestId('chk-type-contingencia')).toBeChecked();
    await expect(page.getByTestId('chk-type-ccf')).not.toBeChecked();
  });
});

test.describe('Production access — full run (mock MH + mock signer)', () => {
  test('all 13 batches are accepted, the run completes and the company is promoted', async ({ page }) => {
    test.setTimeout(180000);
    await launchAs(page, 'mhLiteSync');
    await openWizard(page);
    await expect(page.getByTestId('req-creds')).toHaveText('Verificadas', { timeout: 15000 });

    await page.getByRole('button', { name: '5 por tipo', exact: true }).click();
    await page.getByTestId('btn-start-full-process').click();

    const dialog = page.getByTestId('production-summary-dialog');
    await expect(dialog).toBeVisible({ timeout: 150000 });
    await expect(page.getByTestId('summary-subtitle')).toHaveText('13 de 13 lote(s) aceptados');
    // Contingencia signs a motivo with non-Latin-1 text ("—"); the mock signer
    // used to throw on it and every contingency event failed.
    await expect(dialog.getByTestId('summary-batch-contingencia')).toContainText('5 de 5 aceptados por Hacienda');
    await expect(page.getByRole('heading', { name: 'Proceso completado', exact: true })).toBeVisible();
    await page.getByTestId('btn-close-summary').click();

    await expect(page.getByText(/^Completo$/)).toBeVisible();
    await expect(page.getByTestId('production-completion-card')).toBeVisible();
    await expect(page.getByTestId('btn-start-full-process')).toHaveText(/Procesar de nuevo/);
  });
});
