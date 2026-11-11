/**
 * Step 5c — Request Production Access: sending NEW batches in the same session
 * (real MH test environment).
 *
 * Regression for "if I select to send a new batch it doesn't work":
 *  - every run must generate and submit a fresh batch for each selected type
 *    (never short-circuit because enough documents were accepted before);
 *  - CCF-dependent documents (NC / CR / CL) must not reuse a parent CCF that an
 *    earlier run already referenced — MH rejects that with "[204] No puede
 *    ingresar el mismo numero documento con el mismo estado".
 *
 * Three consecutive runs of CCF + NC + CR + CL (5 per type), each of which must
 * end with every batch accepted by Hacienda.
 */

import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/electron-launch';

const REAL = process.env.MH_MOCK !== '1';
const KEYS = ['ccf', 'notaCredito', 'comprobanteRetencion', 'comprobanteLiquidacion'];

async function openRequestProduction(window: Page) {
  window.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) {
      console.log(`[browser error] ${msg.text().slice(0, 400)}`);
    }
  });
  await expect(async () => {
    await window.evaluate(() => {
      location.hash = '#/companies/1/request-production';
    });
    await expect(window.getByTestId('request-production')).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 120_000, intervals: [1_000] });
  await expect(window.getByText('Sin empresa')).toBeHidden({ timeout: 30_000 });
  await expect(window.getByTestId('req-creds')).toHaveText(/Verificadas/, { timeout: 90_000 });
}

test('a new session on a company that already has accepted documents still sends a fresh batch', async ({ electronFor }) => {
  test.setTimeout(6 * 60_000);
  // Five facturas accepted by MH in an earlier session (e.g. yesterday's run).
  const earlier = new Date(Date.now() - 86_400_000).toISOString();
  const invoices = Array.from({ length: 5 }, (_, i) => ({
    id: `earlier-${i}`,
    companyId: '1',
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
  const { window } = await electronFor({ real: REAL, invoices });
  await openRequestProduction(window);
  await window.getByRole('button', { name: '5 por tipo', exact: true }).click();
  await window.getByTestId('btn-clear-types').click();
  await window.getByTestId('chk-type-factura').check();
  await window.getByTestId('btn-start-full-process').click();

  const dialog = window.getByTestId('production-summary-dialog');
  await expect(dialog).toBeVisible({ timeout: 4 * 60_000 });
  console.log(`[summary]\n${await dialog.innerText()}`);
  await expect(dialog.getByTestId('summary-batch-factura')).toContainText('5 de 5 aceptados por Hacienda');
});

test('three consecutive runs of CCF-dependent batches are all generated, sent and accepted', async ({ electronFor }) => {
  test.setTimeout(12 * 60_000);
  const { window } = await electronFor({ real: REAL });
  await openRequestProduction(window);
  await window.getByRole('button', { name: '5 por tipo', exact: true }).click();

  for (let run = 1; run <= 3; run++) {
    await window.getByTestId('btn-clear-types').click();
    for (const key of KEYS) await window.getByTestId(`chk-type-${key}`).check();
    const start = window.getByTestId('btn-start-full-process');
    await expect(start).toBeEnabled({ timeout: 30_000 });
    await start.click();

    const dialog = window.getByTestId('production-summary-dialog');
    await expect(dialog).toBeVisible({ timeout: 8 * 60_000 });
    console.log(`[run ${run} summary]\n${await dialog.innerText()}`);
    for (const key of KEYS) {
      const batch = dialog.getByTestId(`summary-batch-${key}`);
      await expect(batch, `run ${run}: ${key} must be accepted`).toContainText('Aceptado');
      await expect(batch, `run ${run}: ${key} must send a fresh batch`).toContainText('5 de 5 aceptados por Hacienda');
    }
    await window.getByTestId('btn-close-summary').click();
    await expect(dialog).toBeHidden();
  }
});
