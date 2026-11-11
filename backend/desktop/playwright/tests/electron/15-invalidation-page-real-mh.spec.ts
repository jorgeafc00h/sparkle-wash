/**
 * Evento de Invalidación from the user-facing screen (/invoices/:id/invalidate)
 * against the real MH test environment.
 *
 * The invalidation event already reaches MH through the homologation batch
 * (05 / 05b, useRequestProductionAccess), but no spec drove the screen a user
 * actually uses. This one does the whole user flow in the Electron shell:
 *   1. a draft Factura is sent with "Sincronizar" on its detail page (local
 *      signing → /fesv/recepciondte) and becomes Completada with a sello;
 *   2. "Evento de invalidación" opens the screen, motivo 2 (rescindir) is
 *      filled in and submitted (local signing → /fesv/anulardte);
 *   3. MH accepts the event: the success toast shows, the detail page reads
 *      Anulada and the persisted invoice carries invalidatedViaApi.
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

test.describe('Evento de Invalidación screen — real MH', () => {
  test('a Factura sent with Sincronizar is invalidated from its screen (motivo 2) and MH accepts the event', async ({ electronFor }) => {
    test.setTimeout(6 * 60_000);
    const { target } = buildInvoicesFor('Factura');
    const { window } = await electronFor({ real: REAL, invoices: [target] });
    window.on('console', (msg) => {
      const t = msg.text();
      if (msg.type() === 'error' || t.includes('[MhClient]') || t.includes('[InvoiceService]') || t.toLowerCase().includes('invalid')) {
        console.log(`[browser ${msg.type()}] ${t.slice(0, 600)}`);
      }
    });

    // ── 1. Send the draft from its detail page ────────────────────────────
    await expect(async () => {
      await window.evaluate((id) => {
        location.hash = `#/invoices/${id}`;
      }, target.id);
      await expect(window.getByTestId('invoice-detail')).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 120_000, intervals: [1_000] });
    // currentCompany must be rehydrated before Sincronizar (handleSync aborts without it).
    await expect(window.getByText('Sin empresa')).toBeHidden({ timeout: 30_000 });

    await window.getByTestId('btn-sync').click();
    await expect(window.getByTestId('invoice-detail').getByText(/completada/i).first()).toBeVisible({ timeout: 120_000 });
    await expect
      .poll(async () => (await persistedInvoice(window, target.id))?.status, { timeout: 30_000, intervals: [1_000] })
      .toBe(2); // Completada
    const sent = await persistedInvoice(window, target.id);
    console.log(`[sent] control=${sent.controlNumber} codigo=${sent.generationCode} sello=${sent.receptionSeal}`);
    expect(sent.generationCode).toMatch(/^[0-9A-F-]{36}$/);
    if (REAL) expect(sent.receptionSeal).toBeTruthy();

    // ── 2. Invalidate it from the screen ──────────────────────────────────
    await window.getByRole('button', { name: 'Evento de invalidación' }).click();
    await expect(window.getByTestId('invalidation')).toBeVisible({ timeout: 10_000 });
    expect(window.url()).toContain(`#/invoices/${target.id}/invalidate`);
    await expect(window.getByTestId('invalidation-identifiers-summary')).toContainText(sent.generationCode);

    await window.getByLabel('Motivo').selectOption('2'); // Rescindir de la operación realizada
    await window.getByLabel('Nombre del responsable').fill('Jorge Flores');
    await window.getByLabel('Documento del responsable').fill('061414049');
    await window.getByTestId('btn-invalidate').click();

    // ── 3. MH accepted the event ──────────────────────────────────────────
    await expect(window.getByText('Evento de invalidación registrado correctamente.').first()).toBeVisible({ timeout: 120_000 });
    await expect(window.getByTestId('invoice-detail')).toBeVisible();
    await expect(window.getByTestId('invoice-detail').getByText('Anulada', { exact: true }).first()).toBeVisible();
    await expect(window.getByRole('button', { name: 'Evento de invalidación' })).toHaveCount(0);

    await expect
      .poll(async () => (await persistedInvoice(window, target.id))?.status, { timeout: 30_000, intervals: [1_000] })
      .toBe(3); // Anulada
    const voided = await persistedInvoice(window, target.id);
    expect(voided.invalidatedViaApi).toBe(true);
    expect(voided.invalidatedAt).toBeTruthy();
    expect(voided.invalidationReason).toBe('Rescindir de la operación realizada.');
    expect(voided.generationCode).toBe(sent.generationCode);
    expect(voided.receptionSeal).toBe(sent.receptionSeal);
  });
});
