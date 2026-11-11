/**
 * Evento de invalidación — submitting it (mock Hacienda + mock signer).
 *
 * invoices/03 only covers the explanatory UI and the motivo-1 guard; nothing
 * ever registered an invalidation. These specs submit the event end to end and
 * assert: the signed event that reaches MH copies the DTE's identifiers and the
 * motivo, the document becomes Anulada (and stays out of further actions),
 * an MH failure leaves it Completada, required fields are enforced, and a CCF
 * past its window (10th business day of the next month) cannot be invalidated at all.
 */

import { test, expect, type Page } from '@playwright/test';
import { launchAs } from '../../fixtures/launch-modes';
import {
  SAMPLE_INVOICES,
  captureMhSubmissions,
  completedToday,
  mhSubmissions,
  persistedInvoices,
} from './_support';

const FACTURA = completedToday(SAMPLE_INVOICES[0], { id: 'inv-anular' }); // DTE 01, transmitted now
const OLD_CCF = SAMPLE_INVOICES[1]; // DTE 03 transmitted 2026-03-10 → window closed 2026-04-20

async function openInvalidation(page: Page, invoiceId: string, scenario?: 'server-error') {
  await launchAs(page, 'mhLiteSync', { invoices: [FACTURA, OLD_CCF], mockScenario: scenario });
  await page.goto(`/#/invoices/${invoiceId}/invalidate`);
  await expect(page.getByTestId('invalidation')).toBeVisible({ timeout: 20_000 });
  await captureMhSubmissions(page);
}

const toastAlert = (page: Page) => page.locator('[role="alert"]').first();

test.describe('Evento de invalidación — submission', () => {
  test('motivo 2: the signed event carries the DTE identifiers and the document becomes Anulada', async ({ page }) => {
    await openInvalidation(page, FACTURA.id);
    await page.getByLabel('Motivo').selectOption('2');
    await page.getByLabel('Nombre del responsable').fill('Jorge Flores');
    await page.getByLabel('Documento del responsable').fill('061414049');
    await page.getByTestId('btn-invalidate').click();

    await expect(page.getByText('Evento de invalidación registrado correctamente.').first()).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(new RegExp(`#/invoices/${FACTURA.id}$`));
    await expect(page.getByTestId('invoice-detail').getByText('Anulada', { exact: true }).first()).toBeVisible();
    // An invalidated DTE offers no further invalidation / linked documents / deletion.
    await expect(page.getByRole('button', { name: 'Evento de invalidación' })).toHaveCount(0);
    await expect(page.getByTestId('btn-delete-invoice')).toHaveCount(0);
    await expect(page.getByTestId('btn-sync')).toHaveCount(0);

    const events = (await mhSubmissions(page)).filter((s) => s.method === 'invalidateDTE');
    expect(events.length).toBeGreaterThanOrEqual(1);
    const { dte } = events[events.length - 1];
    expect(dte.identificacion.ambiente).toBe('00');
    expect(dte.identificacion.codigoGeneracion).toMatch(/^[0-9A-F-]{36}$/);
    expect(dte.documento).toMatchObject({
      tipoDte: '01',
      codigoGeneracion: FACTURA.generationCode,
      selloRecibido: FACTURA.receptionSeal,
      numeroControl: FACTURA.controlNumber,
      codigoGeneracionR: null,
    });
    expect(dte.motivo).toMatchObject({
      tipoAnulacion: 2,
      motivoAnulacion: 'Rescindir de la operación realizada.',
      nombreResponsable: 'Jorge Flores',
      numDocResponsable: '061414049',
    });
    expect(dte.emisor.nit).toBe('06141404941342');

    await expect
      .poll(async () => (await persistedInvoices(page)).find((i) => i.id === FACTURA.id)?.status)
      .toBe(3);
    const saved = (await persistedInvoices(page)).find((i) => i.id === FACTURA.id);
    expect(saved.invalidatedViaApi).toBe(true);
    expect(saved.invalidationReason).toBe('Rescindir de la operación realizada.');

    // The list reflects it too.
    await page.goto('/#/invoices');
    await expect(page.getByTestId('invoice-list')).toBeVisible();
    const row = page.locator('table tbody tr', { hasText: FACTURA.controlNumber });
    await expect(row.getByText('Anulada', { exact: true })).toBeVisible();
  });

  test('motivo 1 with the replacement DTE code sends codigoGeneracionR', async ({ page }) => {
    const replacement = '9B2E7C1A-4D3F-4A5B-8C6D-1E2F3A4B5C6D';
    await openInvalidation(page, FACTURA.id);
    await page.getByLabel('Motivo').selectOption('1');
    await page.getByLabel('Código de generación del DTE correcto').fill(replacement.toLowerCase());
    await page.getByLabel('Nombre del responsable').fill('Jorge Flores');
    await page.getByLabel('Documento del responsable').fill('061414049');
    await page.getByTestId('btn-invalidate').click();
    await expect(page.getByText('Evento de invalidación registrado correctamente.').first()).toBeVisible({ timeout: 15_000 });

    const events = (await mhSubmissions(page)).filter((s) => s.method === 'invalidateDTE');
    const { dte } = events[events.length - 1];
    expect(dte.motivo.tipoAnulacion).toBe(1);
    expect(dte.documento.codigoGeneracionR).toBe(replacement); // upper-cased
  });

  test('MH failure: the error is shown, the user stays on the form and the DTE remains Completada', async ({ page }) => {
    await openInvalidation(page, FACTURA.id, 'server-error');
    await page.getByLabel('Motivo').selectOption('2');
    await page.getByLabel('Nombre del responsable').fill('Jorge Flores');
    await page.getByLabel('Documento del responsable').fill('061414049');
    await page.getByTestId('btn-invalidate').click();

    await expect(toastAlert(page)).toContainText('Error al procesar evento de invalidación', { timeout: 15_000 });
    await expect(page).toHaveURL(new RegExp(`#/invoices/${FACTURA.id}/invalidate$`));
    await expect(page.getByTestId('btn-invalidate')).toBeEnabled();
    const saved = (await persistedInvoices(page)).find((i) => i.id === FACTURA.id);
    expect(saved.status).toBe(2);
    expect(saved.invalidatedViaApi).toBeFalsy();
  });

  test('required fields are enforced before anything is signed', async ({ page }) => {
    await openInvalidation(page, FACTURA.id);

    await page.getByTestId('btn-invalidate').click();
    await expect(toastAlert(page)).toContainText('Selecciona un motivo del evento de invalidación.');

    await page.getByLabel('Motivo').selectOption('2');
    await page.getByTestId('btn-invalidate').click();
    await expect(page.getByText('Ingresa el nombre del responsable.').first()).toBeVisible();

    await page.getByLabel('Nombre del responsable').fill('Jorge Flores');
    await page.getByTestId('btn-invalidate').click();
    await expect(page.getByText('Ingresa el documento del responsable.').first()).toBeVisible();

    // Motivo 3 "Otro" needs a description of at least 5 characters.
    await page.getByLabel('Documento del responsable').fill('061414049');
    await page.getByLabel('Motivo').selectOption('3');
    await page.getByLabel('Especifica el motivo').fill('abc');
    await page.getByTestId('btn-invalidate').click();
    await expect(page.getByText('El motivo personalizado debe tener al menos 5 caracteres.').first()).toBeVisible();

    expect(await mhSubmissions(page)).toHaveLength(0);
    expect((await persistedInvoices(page)).find((i) => i.id === FACTURA.id).status).toBe(2);
  });

  test('a CCF past its 10th-business-day-of-next-month window cannot be invalidated', async ({ page }) => {
    await openInvalidation(page, OLD_CCF.id);
    await expect(page.getByText('No se puede registrar')).toBeVisible();
    await expect(page.getByText(/solo puede invalidarse hasta el décimo día hábil del mes siguiente/)).toBeVisible();
    await expect(page.getByTestId('btn-invalidate')).toHaveCount(0);
    await expect(page.getByLabel('Motivo')).toHaveCount(0);
  });
});
