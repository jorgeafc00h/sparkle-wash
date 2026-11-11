/**
 * Solicitud de Contingencia — the event and the DTEs it lists go out on the
 * LOCAL path (mock signer → MockMhClient), never through the backend:
 *  - the DTE is transmitted with the SAME codigoGeneracion the event listed,
 *    Modelo 2 / Transmisión 2, and the stored number is the transmitted one;
 *  - MH answering "YA EXISTE" is resolved by consulting MH (consultadte) —
 *    the invoice completes with MH's sello and NO second document is minted;
 *  - stock is discharged once, by the shared FE/CCF/FEX/NR rule.
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

const LAPTOP = SAMPLE_PRODUCTS.find((p) => p.id === 'prod-002')!; // tracked stock: 10
const DRAFT_ID = 'inv-contingencia';

const svToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/El_Salvador', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());

function draftFactura() {
  const now = new Date().toISOString();
  return {
    id: DRAFT_ID,
    invoiceNumber: 'BORRADOR-CONT',
    controlNumber: '',
    date: svToday(),
    invoiceType: 0,
    documentType: '01',
    status: 0,
    companyId: '1',
    customerId: 'cust-001',
    customer: { id: 'cust-001', firstName: 'Maria', lastName: 'Gonzalez', nationalId: '01234567-8', customerType: 0 },
    items: [{ id: `${DRAFT_ID}_d1`, invoiceId: DRAFT_ID, productId: LAPTOP.id, productName: LAPTOP.productName, quantity: 2, unitPrice: 850, obsItem: '' }],
    totals: { totalAmount: 1700, tax: 195.58, subTotal: 1504.42, totalWithoutTax: 1504.42, totalPagar: 1700, ivaRete1: 0, reteRenta: 170, isCCF: false, totalItems: 1, version: 1 },
    createdAt: now,
    updatedAt: now,
  };
}

async function openContingency(page: Page, scenario?: 'duplicate-control') {
  await launchAs(page, 'mhLiteSync', { invoices: [draftFactura()], mockScenario: scenario });
  await seedStorage(page, { 'persist:products': productsState(), 'persist:subscription': subscriptionState('pro') });
  await page.goto(`/#/invoices/contingency?fromInvoice=${DRAFT_ID}`);
  await expect(page.getByTestId('contingency')).toBeVisible({ timeout: 20_000 });
  await captureMhSubmissions(page);
  // Record the contingency events too (captureMhSubmissions covers DTEs/events/invalidations).
  await page.evaluate(async () => {
    const w = window as unknown as { __mhEvents?: unknown[] };
    w.__mhEvents = [];
    const mod = await import('/src/services/api/MockMhClient.ts');
    const proto = mod.MockMhClient.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
    const original = proto.submitContingency;
    proto.submitContingency = function patched(this: unknown, params: unknown, credentials: unknown) {
      w.__mhEvents!.push(params);
      return original.call(this, params, credentials);
    };
  });
}

async function contingencyEvents(page: Page): Promise<any[]> {
  const raw = await page.evaluate(() => (window as unknown as { __mhEvents?: unknown[] }).__mhEvents ?? []);
  return (raw as Array<{ documento: string }>).map((p) =>
    JSON.parse(Buffer.from(p.documento.split('.')[1], 'base64url').toString('utf8')));
}

async function fillAndSubmit(page: Page) {
  await page.getByLabel('Nombre del responsable').fill('Jorge Flores');
  await page.getByLabel('DUI del responsable').fill('061414049');
  await page.getByPlaceholder(/Describe detalladamente el motivo/).fill('Corte de internet en el local');
  await page.getByTestId('contingency-submit').click();
}

async function laptopStock(page: Page): Promise<number> {
  const product = (await persistedProducts(page)).find((p) => p.id === LAPTOP.id);
  return product?.stockQuantity ?? product?.stock;
}

test.describe('Solicitud de Contingencia — local submission', () => {
  test('the DTE goes out with the codigoGeneracion the event listed, Modelo 2, and discharges stock once', async ({ page }) => {
    await openContingency(page);
    await fillAndSubmit(page);
    await expect(page.getByText(/Reporte de contingencia enviado y 1 factura/).first()).toBeVisible({ timeout: 15_000 });

    const [event] = await contingencyEvents(page);
    const listed = event.detalleDTE[0].codigoGeneracion;
    expect(event.detalleDTE[0].tipoDoc).toBe('01');

    const sent = (await mhSubmissions(page)).filter((s) => s.method === 'submitDTE');
    expect(sent).toHaveLength(1);
    expect(sent[0].dte.identificacion).toMatchObject({ codigoGeneracion: listed, tipoModelo: 2, tipoOperacion: 2, tipoContingencia: 5 });

    await expect.poll(async () => (await persistedInvoices(page)).find((i) => i.id === DRAFT_ID)?.status).toBe(2);
    const saved = (await persistedInvoices(page)).find((i) => i.id === DRAFT_ID);
    expect(saved.generationCode).toBe(listed);
    expect(saved.controlNumber).toBe(sent[0].dte.identificacion.numeroControl);
    expect(saved.invoiceNumber).toBe(saved.controlNumber); // one authoritative number
    expect(saved.receptionSeal).toBeTruthy();
    expect(saved.contingency).toMatchObject({ tipoContingencia: 5 });
    await expect.poll(() => laptopStock(page)).toBe(8);
  });

  test('"YA EXISTE" is resolved by consulting MH — completed with MH\'s sello, no second document', async ({ page }) => {
    await openContingency(page, 'duplicate-control');
    await page.evaluate(async () => {
      const mod = await import('/src/services/api/MockMhClient.ts');
      const proto = mod.MockMhClient.prototype as unknown as Record<string, unknown>;
      proto.searchDTE = async () => ({ estado: 'PROCESADO', selloRecibido: 'SELLO-DE-HACIENDA', fhProcesamiento: '31/10/2026 10:00:00' });
    });
    await fillAndSubmit(page);
    await expect(page.getByText(/Reporte de contingencia enviado y 1 factura/).first()).toBeVisible({ timeout: 15_000 });

    const [event] = await contingencyEvents(page);
    const listed = event.detalleDTE[0].codigoGeneracion;
    const sent = (await mhSubmissions(page)).filter((s) => s.method === 'submitDTE');
    expect(sent).toHaveLength(1); // never re-sent under new identifiers
    expect(sent[0].dte.identificacion.codigoGeneracion).toBe(listed);

    await expect.poll(async () => (await persistedInvoices(page)).find((i) => i.id === DRAFT_ID)?.status).toBe(2);
    const saved = (await persistedInvoices(page)).find((i) => i.id === DRAFT_ID);
    expect(saved.generationCode).toBe(listed);
    expect(saved.receptionSeal).toBe('SELLO-DE-HACIENDA');
  });
});
