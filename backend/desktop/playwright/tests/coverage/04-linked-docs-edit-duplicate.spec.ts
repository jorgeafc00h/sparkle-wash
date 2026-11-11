/**
 * Gaps from the 2026-10-10 E2E coverage review that only had navigation-level
 * coverage before:
 *  - NC / ND created from a CCF are SAVED and SENT, and the DTE that reaches
 *    (mock) Hacienda carries the CCF in documentoRelacionado.
 *  - Editing a draft recomputes and persists its totals; an issued DTE is not editable.
 *  - Duplicating a document saves a NEW draft without the original's identifiers.
 */

import { test, expect, type Page } from '@playwright/test';
import { launchAs } from '../../fixtures/launch-modes';
import {
  SAMPLE_INVOICES,
  captureMhSubmissions,
  completedToday,
  mhSubmissions,
  persistedInvoices,
  productsState,
  seedStorage,
  subscriptionState,
} from './_support';

const CCF = completedToday(SAMPLE_INVOICES[1], { id: 'ccf-parent' }); // DTE 03, Completada, sello
const DRAFT = SAMPLE_INVOICES[2]; // inv-003, Factura Nueva

async function open(page: Page, path: string) {
  await launchAs(page, 'mhLiteSync', { invoices: [CCF, DRAFT] });
  await seedStorage(page, { 'persist:products': productsState(), 'persist:subscription': subscriptionState('pro') });
  await page.goto(`/#${path}`);
}

async function newInvoiceSince(page: Page, before: Set<string>): Promise<any> {
  let created: any = null;
  await expect
    .poll(async () => {
      created = (await persistedInvoices(page)).find((i) => !before.has(i.id)) ?? null;
      return created?.id ?? null;
    }, { timeout: 8_000 })
    .not.toBeNull();
  return created;
}

const statusBadge = (page: Page, label: string) =>
  page.getByTestId('invoice-detail').getByText(label, { exact: true }).first();

test.describe('Linked documents from a CCF — saved and sent', () => {
  for (const kind of [
    { action: 'action-create-nc', heading: 'Crear Nota de Crédito', tipoDte: '05' },
    { action: 'action-create-nd', heading: 'Crear Nota de Débito', tipoDte: '06' },
  ]) {
    test(`${kind.tipoDte}: the ${kind.heading.replace('Crear ', '')} reaches MH with the CCF in documentoRelacionado`, async ({ page }) => {
      await open(page, `/invoices/${CCF.id}`);
      await expect(page.getByTestId('invoice-detail')).toBeVisible({ timeout: 20_000 });
      const before = new Set((await persistedInvoices(page)).map((i) => i.id));

      await page.getByTestId('btn-actions-menu').click();
      await page.getByTestId(kind.action).click();
      await expect(page.getByRole('heading', { name: kind.heading })).toBeVisible();
      await page.getByRole('button', { name: 'Crear', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`parentId=${CCF.id}`), { timeout: 5_000 });

      await page.getByTestId('btn-save').click();
      await expect(page).toHaveURL(/#\/invoices$/, { timeout: 8_000 });
      const linked = await newInvoiceSince(page, before);
      expect(linked.documentType).toBe(kind.tipoDte);

      await page.goto(`/#/invoices/${linked.id}`);
      await expect(page.getByTestId('invoice-detail')).toBeVisible({ timeout: 10_000 });
      await captureMhSubmissions(page);
      await page.getByTestId('btn-sync').click();
      await expect(statusBadge(page, 'Completada')).toBeVisible({ timeout: 15_000 });

      const sent = await mhSubmissions(page);
      expect(sent).toHaveLength(1);
      const dte = sent[0].dte;
      expect(dte.identificacion.tipoDte).toBe(kind.tipoDte);
      expect(dte.documentoRelacionado).toEqual([
        expect.objectContaining({
          tipoDocumento: '03',
          tipoGeneracion: 2,
          numeroDocumento: CCF.generationCode,
          fechaEmision: CCF.date,
        }),
      ]);
      // The receptor is the CCF's customer (NC/ND v4: tipoDocumento 36 = NIT + numDocumento).
      expect(dte.receptor).toMatchObject({
        tipoDocumento: '36',
        numDocumento: String(CCF.customer.nit).replace(/-/g, ''),
      });

      // The parent CCF stays Completada and untouched.
      const parent = (await persistedInvoices(page)).find((i) => i.id === CCF.id);
      expect(parent.status).toBe(2);
      expect(parent.generationCode).toBe(CCF.generationCode);
    });
  }
});

test.describe('Editing', () => {
  test('changing a draft line quantity recomputes and persists its totals', async ({ page }) => {
    await open(page, `/invoices/${DRAFT.id}/edit`);
    await expect(page.getByTestId('edit-invoice')).toBeVisible({ timeout: 20_000 });

    const line = DRAFT.items[0];
    const qty = page.getByTestId(`inv-line-qty-${line.id}`);
    await qty.fill('3');
    await page.getByTestId('btn-update').click();
    await expect(page).toHaveURL(new RegExp(`#/invoices/${DRAFT.id}$`), { timeout: 8_000 });

    await expect
      .poll(async () => (await persistedInvoices(page)).find((i) => i.id === DRAFT.id)?.items?.[0]?.quantity)
      .toBe(3);
    const saved = (await persistedInvoices(page)).find((i) => i.id === DRAFT.id);
    const expectedTotal = Math.round(3 * line.unitPrice * 100) / 100;
    expect(saved.totals.totalAmount).toBeCloseTo(expectedTotal, 2);
    expect(saved.totalAmount).toBeCloseTo(expectedTotal, 2);
    expect(saved.status).toBe(0);
  });

  test('an issued DTE (Completada) is not editable', async ({ page }) => {
    await open(page, `/invoices/${CCF.id}/edit`);
    await expect(page.getByText('No editable')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('btn-update')).toHaveCount(0);
  });
});

test.describe('Duplicating', () => {
  test('saving a duplicate creates a new draft with the same items and customer and no identifiers', async ({ page }) => {
    await open(page, `/invoices/${CCF.id}`);
    await expect(page.getByTestId('invoice-detail')).toBeVisible({ timeout: 20_000 });
    const before = new Set((await persistedInvoices(page)).map((i) => i.id));

    await page.getByTestId('btn-actions-menu').click();
    await page.getByTestId('action-duplicate').click();
    await expect(page).toHaveURL(new RegExp(`duplicateFrom=${CCF.id}`), { timeout: 5_000 });
    await page.getByTestId('btn-save').click();
    await expect(page).toHaveURL(/#\/invoices$/, { timeout: 8_000 });

    const copy = await newInvoiceSince(page, before);
    expect(copy.status).toBe(0);
    expect(copy.invoiceType).toBe(CCF.invoiceType);
    expect(copy.customerId).toBe(CCF.customerId);
    expect(copy.items.map((i: any) => [i.productId, i.quantity, i.unitPrice])).toEqual(
      CCF.items.map((i: any) => [i.productId, i.quantity, i.unitPrice]),
    );
    expect(copy.generationCode ?? '').not.toBe(CCF.generationCode);
    expect(copy.controlNumber ?? '').not.toBe(CCF.controlNumber);
    expect(copy.receptionSeal ?? '').toBe('');

    const original = (await persistedInvoices(page)).find((i) => i.id === CCF.id);
    expect(original).toMatchObject({ status: 2, generationCode: CCF.generationCode, receptionSeal: CCF.receptionSeal });
  });
});
