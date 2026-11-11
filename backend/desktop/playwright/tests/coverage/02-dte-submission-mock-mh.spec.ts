/**
 * Sending a draft DTE to Hacienda from the invoice detail ("Enviar"), web build
 * with the in-app MockMhClient + mock signer (launchAs 'mhLiteSync').
 *
 * Until now this path (DTESubmissionModal → InvoiceGenerationService build →
 * sign → submit → handleSubmissionComplete) only ran in the Electron real-MH
 * suite. These specs pin the user-visible outcomes hermetically: success
 * (Completada + sello + stock discharge + actions switch), MH rejection
 * (ErrorEnvio, code + observaciones, still editable, no stock movement),
 * a 500 from MH, a duplicate número de control (Regenerar y Reintentar mints a
 * new one) and a company without a certificate (stopped before signing).
 */

import { test, expect, type Page } from '@playwright/test';
import { launchAs } from '../../fixtures/launch-modes';
import {
  SAMPLE_PRODUCTS,
  captureMhSubmissions,
  mhSubmissions,
  persistedInvoices,
  persistedProducts,
  productsState,
  seedStorage,
  subscriptionState,
} from './_support';

type Scenario = 'success' | 'dte-rejected' | 'server-error' | 'duplicate-control';

const DRAFT_ID = 'inv-draft-send';
const LAPTOP = SAMPLE_PRODUCTS.find((p) => p.id === 'prod-002')!; // tracked stock: 10

function draftFactura() {
  const now = new Date().toISOString();
  return {
    id: DRAFT_ID,
    invoiceNumber: 'BORRADOR-001',
    controlNumber: '',
    date: now.slice(0, 10),
    invoiceType: 0,
    documentType: '01',
    status: 0,
    companyId: '1',
    customerId: 'cust-001',
    customer: { id: 'cust-001', firstName: 'Maria', lastName: 'Gonzalez', nationalId: '01234567-8', customerType: 0 },
    items: [
      { id: `${DRAFT_ID}_detail_1`, invoiceId: DRAFT_ID, productId: LAPTOP.id, productName: LAPTOP.productName, quantity: 2, unitPrice: 850, obsItem: '' },
    ],
    totals: { totalAmount: 1700, tax: 195.58, subTotal: 1504.42, totalWithoutTax: 1504.42, totalPagar: 1700, ivaRete1: 0, reteRenta: 170, isCCF: false, totalItems: 1, version: 1 },
    createdAt: now,
    updatedAt: now,
  };
}

async function openDraft(page: Page, mode: 'mhLiteSync' | 'seedCompany', scenario?: Scenario) {
  await launchAs(page, mode, { invoices: [draftFactura()], mockScenario: scenario });
  // launchAs seeds neither products nor a tier: add both after its reset.
  await seedStorage(page, { 'persist:products': productsState(), 'persist:subscription': subscriptionState('pro') });
  await page.goto(`/#/invoices/${DRAFT_ID}`);
  await expect(page.getByTestId('invoice-detail')).toBeVisible({ timeout: 20_000 });
  if (mode === 'mhLiteSync') await captureMhSubmissions(page);
}

/** The modal footer's "Cerrar" (the header X shares the accessible name). */
const closeModal = (page: Page) => page.getByText('Cerrar', { exact: true }).click();

async function stockMovementsFor(page: Page, invoiceId: string): Promise<any[]> {
  return page.evaluate((id) => {
    const raw = localStorage.getItem('persist:products');
    if (!raw) return [];
    const movements = JSON.parse(JSON.parse(raw).stockMovements ?? '[]') as Array<{ referenceId?: string }>;
    return movements.filter((m) => m.referenceId === id);
  }, invoiceId);
}

const statusBadge = (page: Page, label: string) =>
  page.getByTestId('invoice-detail').getByText(label, { exact: true }).first();

async function laptopStock(page: Page): Promise<number> {
  const product = (await persistedProducts(page)).find((p) => p.id === LAPTOP.id);
  return product?.stockQuantity ?? product?.stock;
}

test.describe('Enviar DTE — mock Hacienda', () => {
  test('accepted: the draft becomes Completada with the MH seal, stock is discharged and actions switch', async ({ page }) => {
    await openDraft(page, 'mhLiteSync');
    await expect(statusBadge(page, 'Nueva')).toBeVisible();
    expect(await laptopStock(page)).toBe(10);

    await page.getByTestId('btn-sync').click();
    const modal = page.getByTestId('dte-submission-modal');
    await expect(modal).toBeVisible();
    await expect(page.getByText('DTE enviado correctamente al Ministerio de Hacienda.').first()).toBeVisible({ timeout: 15_000 });

    // The modal closes on success; the detail now shows the accepted document.
    await expect(modal).toBeHidden();
    await expect(statusBadge(page, 'Completada')).toBeVisible();
    await expect(page.getByTestId('btn-sync')).toHaveCount(0);
    await expect(page.getByTestId('btn-delete-invoice')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Evento de invalidación' })).toBeVisible();

    // What reached MH is a DTE 01 in the test ambiente, and the persisted
    // identifiers are the ones MH accepted.
    const sent = await mhSubmissions(page);
    expect(sent.length).toBeGreaterThanOrEqual(1);
    for (const s of sent) {
      expect(s.method).toBe('submitDTE');
      expect(s.dte.identificacion.tipoDte).toBe('01');
      expect(s.dte.identificacion.ambiente).toBe('00');
    }

    await expect
      .poll(async () => (await persistedInvoices(page)).find((i) => i.id === DRAFT_ID)?.status)
      .toBe(2);
    const saved = (await persistedInvoices(page)).find((i) => i.id === DRAFT_ID);
    expect(saved.receptionSeal).toMatch(/^[0-9a-f]{64}$/);
    expect(saved.controlNumber).toMatch(/^DTE-01-[A-Z0-9]{8}-\d{15}$/);
    expect(sent.map((s) => s.dte.identificacion.numeroControl)).toContain(saved.controlNumber);
    expect(sent.map((s) => s.dte.identificacion.codigoGeneracion)).toContain(saved.generationCode);

    // Inventory: the laptops left stock, booked against this invoice.
    await expect.poll(() => laptopStock(page)).toBeLessThan(10);
    const movements = await stockMovementsFor(page, DRAFT_ID);
    expect(movements.length).toBeGreaterThanOrEqual(1);
    expect(movements[0]).toMatchObject({ productId: LAPTOP.id, type: 'OUT', quantity: 2, createdBy: 'sync-dte' });

    // (No reload here: launchAs' init script re-seeds storage on every navigation.)
  });

  test('one click on "Enviar" sends exactly ONE DTE and discharges stock exactly once', async ({ page }) => {
    // Regression (fixed 2026-10-10): under <StrictMode> (dev builds, and the
    // real-MH Electron suites that load the dev server) the modal's reset effect
    // cleared its run guard on the effect replay, so one click sent TWO DTEs and
    // discharged stock twice; applyInvoiceStockDeduction is now idempotent too.
    await openDraft(page, 'mhLiteSync');
    await page.getByTestId('btn-sync').click();
    await expect(statusBadge(page, 'Completada')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1_000); // let any second run land
    expect(await mhSubmissions(page)).toHaveLength(1);
    expect(await laptopStock(page)).toBe(8);
    expect(await stockMovementsFor(page, DRAFT_ID)).toHaveLength(1);
  });

  test('rejected by MH: code + observaciones shown, document marked Error, still editable, no stock movement', async ({ page }) => {
    await openDraft(page, 'mhLiteSync', 'dte-rejected');
    await page.getByTestId('btn-sync').click();

    const modal = page.getByTestId('dte-submission-modal');
    await expect(modal.getByText('Error al enviar el documento')).toBeVisible({ timeout: 15_000 });
    await expect(modal.getByText('#DTE_REJECTED')).toBeVisible();
    await expect(modal.getByText('El documento no cumple con las validaciones requeridas')).toBeVisible();
    await expect(modal.getByText('Verifique la integridad del documento')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible();

    await closeModal(page);
    await expect(modal).toBeHidden();
    await expect(statusBadge(page, 'Error')).toBeVisible();
    await expect(page.getByTestId('btn-sync')).toBeVisible();
    await expect(page.getByRole('button', { name: /Editar/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Evento de invalidación' })).toHaveCount(0);

    await expect
      .poll(async () => (await persistedInvoices(page)).find((i) => i.id === DRAFT_ID)?.status)
      .toBe(5);
    expect((await persistedInvoices(page)).find((i) => i.id === DRAFT_ID).receptionSeal).toBeFalsy();
    expect(await laptopStock(page)).toBe(10);
  });

  test('MH answers 500: the error is shown and the document stays unsent', async ({ page }) => {
    await openDraft(page, 'mhLiteSync', 'server-error');
    await page.getByTestId('btn-sync').click();
    const modal = page.getByTestId('dte-submission-modal');
    await expect(modal.getByText('Error al enviar el documento')).toBeVisible({ timeout: 15_000 });
    await expect(modal.getByText('Internal Server Error')).toBeVisible();
    await closeModal(page);
    await expect(statusBadge(page, 'Error')).toBeVisible();
    await expect(page.getByTestId('btn-sync')).toBeVisible();
    expect(await laptopStock(page)).toBe(10);
  });

  test('duplicate número de control: "Regenerar y Reintentar" sends a NEW número de control', async ({ page }) => {
    await openDraft(page, 'mhLiteSync', 'duplicate-control');
    await page.getByTestId('btn-sync').click();
    const modal = page.getByTestId('dte-submission-modal');
    await expect(modal.getByText('YA EXISTE UN REGISTRO CON ESE VALOR')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('btn-regenerate-retry')).toBeVisible();
    // A plain "Reintentar" would resend the same number forever — it is not offered.
    await expect(page.getByRole('button', { name: 'Reintentar', exact: true })).toHaveCount(0);

    const before = await mhSubmissions(page);
    expect(before.length).toBeGreaterThanOrEqual(1);
    const rejectedNumbers = before.map((b) => b.dte.identificacion.numeroControl);

    await page.getByTestId('btn-regenerate-retry').click();
    await expect.poll(async () => (await mhSubmissions(page)).length, { timeout: 15_000 }).toBeGreaterThan(before.length);
    const retried = (await mhSubmissions(page)).slice(before.length);
    for (const r of retried) {
      expect(r.dte.identificacion.tipoDte).toBe('01');
      expect(rejectedNumbers).not.toContain(r.dte.identificacion.numeroControl);
    }
  });

  test('no certificate configured: stopped at the first step, nothing is signed or sent', async ({ page }) => {
    await openDraft(page, 'seedCompany');
    await page.getByTestId('btn-sync').click();
    const modal = page.getByTestId('dte-submission-modal');
    await expect(modal.getByText(/Certificado no configurado/)).toBeVisible({ timeout: 15_000 });
    await closeModal(page);
    await expect(statusBadge(page, 'Error')).toBeVisible();
    expect(await laptopStock(page)).toBe(10);
  });
});
