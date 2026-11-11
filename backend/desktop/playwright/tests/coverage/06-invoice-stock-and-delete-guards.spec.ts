/**
 * Invoice lifecycle guards (mock Hacienda + mock signer, launchAs 'mhLiteSync'):
 *  - only FE/CCF/FEX/NR discharge stock — an NC accepted by MH moves nothing;
 *  - invalidating a sent Factura puts back exactly what it discharged;
 *  - deleting an "Error de envío" draft first asks MH by codigoGeneracion: a
 *    document MH already processed (or that can't be checked offline) is kept;
 *  - an NC can only reference a CCF; the new-DTE date is the El Salvador
 *    calendar date even at 19:30 on the last day of the month.
 */

import { test, expect, type Page } from '@playwright/test';
import { launchAs } from '../../fixtures/launch-modes';
import {
  SAMPLE_INVOICES,
  SAMPLE_PRODUCTS,
  captureMhSubmissions,
  completedToday,
  persistedInvoices,
  persistedProducts,
  productsState,
  seedStorage,
  subscriptionState,
} from './_support';

const LAPTOP = SAMPLE_PRODUCTS.find((p) => p.id === 'prod-002')!; // tracked stock: 10
const CCF_PARENT = completedToday(SAMPLE_INVOICES[1], { id: 'ccf-parent' }); // DTE 03
const FACTURA_DONE = completedToday(SAMPLE_INVOICES[0], { id: 'fe-done' }); // DTE 01

function laptopLine(invoiceId: string, quantity: number) {
  return { id: `${invoiceId}_d1`, invoiceId, productId: LAPTOP.id, productName: LAPTOP.productName, quantity, unitPrice: 850, obsItem: '' };
}

function draft(id: string, over: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id,
    invoiceNumber: `BORRADOR-${id}`,
    controlNumber: '',
    date: now.slice(0, 10),
    invoiceType: 0,
    documentType: '01',
    status: 0,
    companyId: '1',
    customerId: 'cust-001',
    customer: { id: 'cust-001', firstName: 'Maria', lastName: 'Gonzalez', nationalId: '01234567-8', customerType: 0 },
    items: [laptopLine(id, 2)],
    totals: { totalAmount: 1700, tax: 195.58, subTotal: 1504.42, totalWithoutTax: 1504.42, totalPagar: 1700, ivaRete1: 0, reteRenta: 170, isCCF: false, totalItems: 1, version: 1 },
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

async function launch(page: Page, invoices: unknown[], path: string, testId: string) {
  await launchAs(page, 'mhLiteSync', { invoices });
  await seedStorage(page, { 'persist:products': productsState(), 'persist:subscription': subscriptionState('pro') });
  await page.goto(path);
  await expect(page.getByTestId(testId)).toBeVisible({ timeout: 20_000 });
  await captureMhSubmissions(page);
}

async function laptopStock(page: Page): Promise<number> {
  const product = (await persistedProducts(page)).find((p) => p.id === LAPTOP.id);
  return product?.stockQuantity ?? product?.stock;
}

async function movementsFor(page: Page, invoiceId: string): Promise<any[]> {
  return page.evaluate((id) => {
    const raw = localStorage.getItem('persist:products');
    if (!raw) return [];
    const movements = JSON.parse(JSON.parse(raw).stockMovements ?? '[]') as Array<{ referenceId?: string }>;
    return movements.filter((m) => m.referenceId === id);
  }, invoiceId);
}

/** Replaces the mock MH /consultadte answer for the rest of the page's life. */
async function mockConsultaDte(page: Page, answers: Record<string, 'processed' | 'rejected' | 'offline'>) {
  await page.evaluate(async (map) => {
    const mod = await import('/src/services/api/MockMhClient.ts');
    const proto = mod.MockMhClient.prototype as unknown as Record<string, unknown>;
    proto.searchDTE = async (params: { codigoGeneracion: string }) => {
      const answer = map[params.codigoGeneracion] ?? 'rejected';
      if (answer === 'offline') throw new Error('net::ERR_INTERNET_DISCONNECTED');
      if (answer === 'processed') return { estado: 'PROCESADO', selloRecibido: 'SELLO-YA-PROCESADO', fhProcesamiento: '31/10/2026 10:00:00' };
      return { estado: 'RECHAZADO', selloRecibido: null };
    };
  }, answers);
}

const statusBadge = (page: Page, label: string) =>
  page.getByTestId('invoice-detail').getByText(label, { exact: true }).first();

test.describe('Stock follows the document type', () => {
  test('an NC accepted by MH moves no stock', async ({ page }) => {
    const nc = draft('nc-draft', {
      invoiceType: 2,
      documentType: '05',
      customerId: CCF_PARENT.customerId,
      customer: CCF_PARENT.customer,
      relatedId: CCF_PARENT.id,
      relatedInvoiceType: 1,
      relatedDocumentType: '03',
      relatedDocumentNumber: CCF_PARENT.generationCode,
      relatedGenerationCode: CCF_PARENT.generationCode,
      relatedControlNumber: CCF_PARENT.controlNumber,
      relatedDocumentDate: CCF_PARENT.date,
    });
    await launch(page, [CCF_PARENT, nc], '/#/invoices/nc-draft', 'invoice-detail');
    await page.getByTestId('btn-sync').click();
    await expect(page.getByText('DTE enviado correctamente al Ministerio de Hacienda.').first()).toBeVisible({ timeout: 15_000 });
    await expect(statusBadge(page, 'Completada')).toBeVisible();

    await page.waitForTimeout(500);
    expect(await laptopStock(page)).toBe(10);
    expect(await movementsFor(page, 'nc-draft')).toHaveLength(0);
  });

  test('invalidating a sent Factura puts back exactly what it discharged', async ({ page }) => {
    await launch(page, [draft('fe-send')], '/#/invoices/fe-send', 'invoice-detail');
    await page.getByTestId('btn-sync').click();
    await expect(statusBadge(page, 'Completada')).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => laptopStock(page)).toBe(8);

    await page.getByRole('button', { name: 'Evento de invalidación' }).click();
    await expect(page.getByTestId('invalidation')).toBeVisible({ timeout: 10_000 });
    await page.getByLabel('Motivo').selectOption('2');
    await page.getByLabel('Nombre del responsable').fill('Jorge Flores');
    await page.getByLabel('Documento del responsable').fill('061414049');
    await page.getByTestId('btn-invalidate').click();
    await expect(page.getByText('Evento de invalidación registrado correctamente.').first()).toBeVisible({ timeout: 15_000 });

    await expect.poll(() => laptopStock(page)).toBe(10);
    const movements = await movementsFor(page, 'fe-send');
    expect(movements.map((m) => m.type).sort()).toEqual(['IN', 'OUT']);
    expect(movements.find((m) => m.type === 'IN')).toMatchObject({ quantity: 2, createdBy: 'invalidation' });
  });
});

test.describe('Deleting "Error de envío" drafts asks Hacienda first', () => {
  const PROCESSED = 'AAAAAAAA-1111-4111-8111-AAAAAAAAAAAA';
  const REJECTED = 'BBBBBBBB-2222-4222-8222-BBBBBBBBBBBB';
  const errDraft = (id: string, generationCode: string) =>
    draft(id, { status: 5, generationCode, controlNumber: `DTE-01-M001P001-00000000000${id.length}${id.length}` });

  test('a draft MH already processed is kept; one MH does not hold is deleted', async ({ page }) => {
    await launch(page, [errDraft('err-done', PROCESSED), errDraft('err-gone', REJECTED), draft('nueva-1')], '/#/invoices', 'invoice-list');
    await mockConsultaDte(page, { [PROCESSED]: 'processed', [REJECTED]: 'rejected' });

    for (const id of ['err-done', 'err-gone', 'nueva-1']) await page.getByTestId(`checkbox-${id}`).check();
    await page.getByTestId('btn-bulk-delete').click();
    await expect(page.getByText(/se consultará a Hacienda/)).toBeVisible();
    await page.getByRole('button', { name: 'Eliminar', exact: true }).click();

    await expect(page.getByText(/Hacienda ya procesó/).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('checkbox-err-done')).toBeVisible();
    await expect(page.getByTestId('checkbox-err-gone')).toHaveCount(0);
    await expect(page.getByTestId('checkbox-nueva-1')).toHaveCount(0);
    await expect.poll(async () => (await persistedInvoices(page)).map((i) => i.id).sort())
      .toEqual(['err-done']);
  });

  test('when Hacienda cannot be reached nothing that may be processed is deleted', async ({ page }) => {
    await launch(page, [errDraft('err-offline', PROCESSED)], '/#/invoices', 'invoice-list');
    await mockConsultaDte(page, { [PROCESSED]: 'offline' });

    await page.getByTestId('checkbox-err-offline').check();
    await page.getByTestId('btn-bulk-delete').click();
    await page.getByRole('button', { name: 'Eliminar', exact: true }).click();

    await expect(page.getByText(/no se pudo confirmar con Hacienda/).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('checkbox-err-offline')).toBeVisible();
  });
});

test.describe('New DTE form', () => {
  test('an NC can only reference a CCF', async ({ page }) => {
    await launch(page, [CCF_PARENT, FACTURA_DONE], '/#/invoices/add?type=2', 'add-invoice');
    const select = page.getByLabel('Selecciona la factura relacionada');
    await expect(select).toBeVisible();
    const options = await select.locator('option').allTextContents();
    expect(options.some((o) => o.includes(CCF_PARENT.controlNumber as string))).toBe(true);
    expect(options.some((o) => o.includes(FACTURA_DONE.controlNumber as string))).toBe(false);
  });

  test.describe('at 19:30 on Oct 31 in El Salvador', () => {
    // Worst case for the old bug: the browser clock is UTC, where it is already Nov 1.
    test.use({ timezoneId: 'UTC' });

    test('the date defaults to the El Salvador calendar date (MH 007 otherwise)', async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-11-01T01:30:00Z'));
      await launch(page, [], '/#/invoices/add?type=0', 'add-invoice');
      await expect(page.locator('input[type="date"]').first()).toHaveValue('2026-10-31');
    });
  });
});
