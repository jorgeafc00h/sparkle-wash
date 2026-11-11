/**
 * DTE withholding options on the web build (openspec add-dte-withholding-options).
 *
 *  1. Factura de Sujeto Excluido — "Aplicar retención de renta (10%)" is ON by
 *     default; turning it off (purchase of goods) drops the 10% from the editor
 *     totals, the stored invoice and the detail page; re-enabling it on edit
 *     brings it back.
 *  2. IVA percepción 1% — an agente de percepción company (Configuración de
 *     Facturas toggle) issuing a CCF to a customer that is not a gran
 *     contribuyente adds 1% of the gravado base to Total a Pagar in the editor
 *     and on the detail page. Marking the customer "Gran contribuyente", or a
 *     company that is not an agent, means no percepción. A CCF already saved
 *     keeps its stored percepción after the customer flag changes.
 */

import { test, expect, Page } from '@playwright/test';
import { seedPopulatedAppState, waitForAppReady } from '../../fixtures/seed-state';

interface StoredInvoice {
  id: string;
  invoiceType: number;
  applyRentaRetention?: boolean;
  applyIvaPerception?: boolean;
  totals?: { reteRenta: number; ivaPerci1?: number; ivaRete1: number; totalPagar: number; totalAmount: number };
}

async function storedInvoices(page: Page): Promise<StoredInvoice[]> {
  return page.evaluate(() => {
    const slice = JSON.parse(window.localStorage.getItem('persist:invoices') ?? '{}') as { invoices?: string };
    return JSON.parse(slice.invoices ?? '[]') as StoredInvoice[];
  });
}

/** Waits until redux-persist has written an invoice matching `predicate` and returns it. */
async function waitForStoredInvoice(page: Page, predicate: (inv: StoredInvoice) => boolean): Promise<StoredInvoice> {
  let found: StoredInvoice | undefined;
  await expect
    .poll(async () => {
      found = (await storedInvoices(page)).find(predicate);
      return !!found;
    }, { timeout: 5_000 })
    .toBe(true);
  return found!;
}

async function openNewDte(page: Page, cardLabel: string) {
  await page.goto('/#/invoices/add');
  await waitForAppReady(page);
  await expect(page.getByTestId('add-invoice')).toBeVisible({ timeout: 8_000 });
  await page.getByText(cardLabel, { exact: true }).first().click();
  await expect(page.getByText('Información General')).toBeVisible({ timeout: 5_000 });
}

async function pickCustomer(page: Page, search: string, name: string) {
  await page.locator('input[placeholder="Buscar cliente..."]').fill(search);
  await page.locator(`text=${name}`).first().click();
}

async function addProductLine(page: Page, search: string, productName: string) {
  await page.getByTestId('btn-add-invoice-item').click();
  const row = page.locator('tbody tr[data-testid^="inv-line-row-"]').last();
  await row.locator('input[data-testid^="inv-line-product-"]').fill(search);
  await page.getByText(productName).first().click();
  await page.waitForTimeout(300);
}

/** Saves the editor and returns the invoice it persisted. */
async function saveNewDte(page: Page): Promise<StoredInvoice> {
  const before = new Set((await storedInvoices(page)).map((inv) => inv.id));
  await page.getByTestId('btn-save').click();
  await expect(page.getByText('DTE creado correctamente.').last()).toBeVisible({ timeout: 5_000 });
  return waitForStoredInvoice(page, (inv) => !before.has(inv.id));
}

async function setCompanyPerceptionAgent(page: Page, on: boolean) {
  await page.goto('/#/companies/1/config?section=settings');
  await waitForAppReady(page);
  const toggle = page.getByTestId('company-perception-agent');
  await expect(toggle).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText('Agente de percepción de IVA (1%)')).toBeVisible();
  await toggle.setChecked(on);
  await page.getByRole('button', { name: 'Guardar Configuración' }).click();
  await expect(page.getByText('Configuración guardada.').last()).toBeVisible({ timeout: 5_000 });
}

/** Edit Empresa XYZ (cust-002) through the customer form. */
async function editEmpresaXyz(page: Page, flags: { retention?: boolean; largeTaxpayer?: boolean }) {
  await page.goto('/#/customers/cust-002/edit');
  await waitForAppReady(page);
  await expect(page.getByTestId('customer-form')).toBeVisible({ timeout: 8_000 });
  if (flags.retention !== undefined) await page.getByTestId('customer-has-retention').setChecked(flags.retention);
  if (flags.largeTaxpayer !== undefined) await page.getByTestId('customer-large-taxpayer').setChecked(flags.largeTaxpayer);
  await page.getByTestId('submit-customer-btn').click();
  await expect(page.getByText('Cliente actualizado correctamente.').last()).toBeVisible({ timeout: 5_000 });
}

test.describe('Sujeto Excluido — Aplicar retención de renta (10%)', () => {
  test.beforeEach(async ({ page }) => {
    await seedPopulatedAppState(page);
  });

  test('turning the option off drops the 10% in the editor, the stored invoice and the detail; edit re-enables it', async ({ page }) => {
    await openNewDte(page, 'Sujeto Excluido');
    await pickCustomer(page, 'Maria', 'Maria Gonzalez');
    // Servicio de Consultoría $150.00 — FSE carries no IVA.
    await addProductLine(page, 'Consultor', 'Servicio de Consultoría');

    const option = page.getByTestId('fse-apply-renta');
    await expect(option).toBeChecked();
    await expect(page.getByText('La retención del 10% aplica a servicios; desactívala para compras de bienes.')).toBeVisible();
    await expect(page.getByTestId('inv-totals-retencion-renta')).toContainText('$15.00');
    await expect(page.getByTestId('inv-totals-total')).toContainText('$135.00');

    await option.uncheck();
    await expect(page.getByTestId('inv-totals-retencion-renta')).toHaveCount(0);
    await expect(page.getByTestId('inv-totals-total')).toContainText('$150.00');

    const saved = await saveNewDte(page);
    expect(saved.invoiceType).toBe(3);
    expect(saved.applyRentaRetention).toBe(false);
    expect(saved.totals).toMatchObject({ reteRenta: 0, totalPagar: 150, totalAmount: 150 });

    await page.goto(`/#/invoices/${saved.id}`);
    await waitForAppReady(page);
    await expect(page.getByTestId('inv-totals-total')).toContainText('$150.00');
    await expect(page.getByTestId('inv-totals-retencion-renta')).toHaveCount(0);

    // Edit: the stored choice is shown; re-enabling it brings the 10% back.
    await page.goto(`/#/invoices/${saved.id}/edit`);
    await waitForAppReady(page);
    await expect(page.getByTestId('edit-invoice')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId('fse-apply-renta')).not.toBeChecked();
    await page.getByTestId('fse-apply-renta').check();
    await expect(page.getByTestId('inv-totals-retencion-renta')).toContainText('$15.00');
    await expect(page.getByTestId('inv-totals-total')).toContainText('$135.00');
    await page.getByTestId('btn-update').click();
    await expect(page.getByText('Factura actualizada correctamente.')).toBeVisible({ timeout: 5_000 });

    await expect(page.getByTestId('inv-totals-retencion-renta')).toContainText('$15.00');
    await expect(page.getByTestId('inv-totals-total')).toContainText('$135.00');
    const updated = await waitForStoredInvoice(page, (inv) => inv.id === saved.id && inv.applyRentaRetention === true);
    expect(updated.totals).toMatchObject({ reteRenta: 15, totalPagar: 135 });
  });

  test('the option is only offered on a Sujeto Excluido', async ({ page }) => {
    await openNewDte(page, 'Factura CF');
    await expect(page.getByTestId('fse-apply-renta')).toHaveCount(0);
  });
});

test.describe('CCF — IVA percepción 1%', () => {
  test.beforeEach(async ({ page }) => {
    await seedPopulatedAppState(page);
  });

  test('agent company + regular customer: percepción in the editor and the detail; gran contribuyente: none', async ({ page }) => {
    await setCompanyPerceptionAgent(page, true);
    // Empresa XYZ is seeded with the 1% retention — drop it to isolate the percepción.
    await editEmpresaXyz(page, { retention: false, largeTaxpayer: false });

    await openNewDte(page, 'CCF');
    await pickCustomer(page, 'Empresa XYZ', 'Empresa XYZ');
    // Servicio de Consultoría $150.00 IVA-incl. → base 132.74, IVA 17.26,
    // percepción 1% = 1.33, Total a Pagar 151.33.
    await addProductLine(page, 'Consultor', 'Servicio de Consultoría');
    await expect(page.getByTestId('inv-totals-subtotal')).toContainText('$132.74');
    await expect(page.getByTestId('inv-totals-iva')).toContainText('$17.26');
    await expect(page.getByTestId('inv-totals-percepcion-iva')).toContainText('+$1.33');
    await expect(page.getByTestId('inv-totals-retencion-iva')).toHaveCount(0);
    await expect(page.getByTestId('inv-totals-total')).toContainText('$151.33');
    await expect(page.getByTestId('perception-note')).toContainText('agente de percepción');

    const ccf = await saveNewDte(page);
    expect(ccf.applyIvaPerception).toBe(true);
    expect(ccf.totals).toMatchObject({ ivaPerci1: 1.33, ivaRete1: 0, totalAmount: 150, totalPagar: 151.33 });

    await page.goto(`/#/invoices/${ccf.id}`);
    await waitForAppReady(page);
    await expect(page.getByTestId('inv-totals-percepcion-iva')).toContainText('+$1.33');
    await expect(page.getByTestId('inv-totals-total')).toContainText('$151.33');

    // The customer becomes a gran contribuyente: new CCFs carry no percepción…
    await editEmpresaXyz(page, { largeTaxpayer: true });
    await openNewDte(page, 'CCF');
    await pickCustomer(page, 'Empresa XYZ', 'Empresa XYZ');
    await addProductLine(page, 'Consultor', 'Servicio de Consultoría');
    await expect(page.getByTestId('inv-totals-percepcion-iva')).toHaveCount(0);
    await expect(page.getByTestId('inv-totals-total')).toContainText('$150.00');
    await expect(page.getByTestId('perception-note')).toContainText('no lleva percepción');

    // …while the CCF already saved keeps the percepción it was issued with.
    await page.goto(`/#/invoices/${ccf.id}`);
    await waitForAppReady(page);
    await expect(page.getByTestId('inv-totals-percepcion-iva')).toContainText('+$1.33');
    await expect(page.getByTestId('inv-totals-total')).toContainText('$151.33');
  });

  test('below US$100.00 of gravado base there is no percepción', async ({ page }) => {
    await setCompanyPerceptionAgent(page, true);
    await editEmpresaXyz(page, { retention: false });
    await openNewDte(page, 'CCF');
    await pickCustomer(page, 'Empresa XYZ', 'Empresa XYZ');
    // Papel Bond A4 $5.50 → base 4.87.
    await addProductLine(page, 'Papel', 'Papel Bond A4');
    await expect(page.getByTestId('inv-totals-percepcion-iva')).toHaveCount(0);
    await expect(page.getByTestId('inv-totals-total')).toContainText('$5.50');
  });

  test('a company that is not an agente de percepción never adds it', async ({ page }) => {
    await editEmpresaXyz(page, { retention: false });
    await openNewDte(page, 'CCF');
    await pickCustomer(page, 'Empresa XYZ', 'Empresa XYZ');
    await addProductLine(page, 'Consultor', 'Servicio de Consultoría');
    await expect(page.getByTestId('inv-totals-percepcion-iva')).toHaveCount(0);
    await expect(page.getByTestId('perception-note')).toHaveCount(0);
    await expect(page.getByTestId('inv-totals-total')).toContainText('$150.00');

    const ccf = await saveNewDte(page);
    expect(ccf.applyIvaPerception).toBe(false);
    expect(ccf.totals).toMatchObject({ ivaPerci1: 0, totalPagar: 150 });
  });
});
