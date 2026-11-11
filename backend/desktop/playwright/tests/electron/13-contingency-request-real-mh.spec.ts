/**
 * Solicitud de Contingencia (Facturas → Contingencia) against the real MH test
 * environment — the user-facing contingency flow, not the homologation batch.
 *
 * The event is signed locally with the company's certificate and posted to
 * /fesv/contingencia; the listed Factura is then transmitted (local signing,
 * /fesv/recepciondte) with the SAME codigoGeneracion and Modelo 2 /
 * Transmisión 2. Before 2026-10-31 this page went through the backend
 * (/document/send), which signs with a certificate blob the Desktop never
 * uploads and, on "YA EXISTE", re-sent under a NEW codigoGeneracion.
 *
 * Mock mode (offline): MH_MOCK=1 npm run test:e2e:electron -- <this file>
 */

import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/electron-launch';
import { buildInvoicesFor } from '../../fixtures/dte-types';

const REAL = process.env.MH_MOCK !== '1';

async function persistedInvoice(window: Page, id: string): Promise<any> {
  return window.evaluate(async (invoiceId) => {
    const storageMod = await import('/src/services/storage/ElectronStorage.ts');
    const raw = await storageMod.appStorage.getItem('persist:invoices');
    if (!raw) return null;
    const invoices = JSON.parse(JSON.parse(raw).invoices ?? '[]') as Array<{ id: string }>;
    return invoices.find((i) => i.id === invoiceId) ?? null;
  }, id);
}

test.describe('Solicitud de Contingencia — real MH', () => {
  test('event accepted, the Factura is transmitted with the listed codigoGeneracion and completes', async ({ electronFor }) => {
    test.setTimeout(5 * 60_000);
    const { target } = buildInvoicesFor('Factura');
    const { window } = await electronFor({ real: REAL, invoices: [target] });
    window.on('console', (msg) => {
      const t = msg.text();
      if (msg.type() === 'error' || t.includes('[MhClient]') || t.toLowerCase().includes('contingen')) {
        console.log(`[browser ${msg.type()}] ${t.slice(0, 600)}`);
      }
    });

    await expect(async () => {
      await window.evaluate((id) => {
        location.hash = `#/invoices/contingency?fromInvoice=${id}`;
      }, target.id);
      await expect(window.getByTestId('contingency')).toBeVisible({ timeout: 3_000 });
      await expect(window.getByTestId('contingency').getByText(/Sin código generación|TEST-0/).first()).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 120_000, intervals: [1_000] });

    await window.getByLabel('Tipo de contingencia').selectOption('2'); // sin conectividad con el MH
    await window.getByLabel('Nombre del responsable').fill('Jorge Flores');
    await window.getByLabel('DUI del responsable').fill('037216001');
    await window.getByPlaceholder(/Describe detalladamente el motivo/).fill('Prueba automatizada: sin conectividad con Hacienda');
    await window.getByTestId('contingency-submit').click();

    await expect
      .poll(async () => (await persistedInvoice(window, target.id))?.status, { timeout: 3 * 60_000, intervals: [2_000] })
      .not.toBe(1); // leaves "Sincronizando"
    const saved = await persistedInvoice(window, target.id);
    console.log(`[contingency] status=${saved?.status} control=${saved?.controlNumber} codigo=${saved?.generationCode} sello=${saved?.receptionSeal}`);
    const resultText = await window.getByTestId('contingency').innerText();
    console.log(`[contingency page]\n${resultText.slice(-800)}`);

    expect(saved.status).toBe(2); // Completada
    expect(saved.receptionSeal).toBeTruthy();
    expect(saved.generationCode).toMatch(/^[0-9A-F-]{36}$/);
    expect(saved.invoiceNumber).toBe(saved.controlNumber);
    expect(saved.contingency).toMatchObject({ tipoContingencia: 2 });
    expect(saved.contingency.reportedAt).toBeTruthy();
  });
});
