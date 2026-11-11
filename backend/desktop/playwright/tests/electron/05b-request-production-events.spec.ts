/**
 * Step 5b — Request Production Access: the two homologation EVENT batches,
 * run on their own against the real MH test environment.
 *
 *  - Contingencia: 5 fresh facturas, each reported as its own signed event to
 *    /fesv/contingencia/ (iOS `processContingencyRequestsWithProgress`).
 *  - Evento de Invalidación: 5 fresh facturas submitted to MH, then each one
 *    invalidated through /fesv/anulardte (iOS `processInvalidationsWithProgress`).
 *
 * Each batch is selected ALONE ("Limpiar" → tick one row) so a failure points
 * at that batch, and the end-of-run summary dialog must report 5 de 5 accepted.
 * The second test re-runs contingencia in the same session to prove that a new
 * batch is actually generated and sent again (not skipped as "already done").
 *
 * Mock mode (offline): MH_MOCK=1 npm run test:e2e:electron -- <this file>
 */

import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/electron-launch';

const REAL = process.env.MH_MOCK !== '1';

async function openRequestProduction(window: Page) {
  window.on('console', (msg) => {
    const t = msg.text();
    if (msg.type() === 'error' || t.includes('[MhClient]') || t.includes('contingen') || t.includes('nvalid')) {
      console.log(`[browser ${msg.type()}] ${t.slice(0, 600)}`);
    }
  });
  await expect(async () => {
    await window.evaluate(() => {
      location.hash = '#/companies/1/request-production';
    });
    await expect(window.getByTestId('request-production')).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 120_000, intervals: [1_000] });
  await expect(window.getByText('Sin empresa')).toBeHidden({ timeout: 30_000 });
  // Pre-flight (certificate probe signature + MH /seguridad/auth) must pass
  // before the start button unlocks.
  await expect(window.getByTestId('req-creds')).toHaveText(/Verificadas/, { timeout: 90_000 });
}

/** Select exactly `keys`, start the run, and return the summary dialog. */
async function runOnly(window: Page, keys: string[]) {
  await window.getByTestId('btn-clear-types').click();
  for (const key of keys) await window.getByTestId(`chk-type-${key}`).check();
  const start = window.getByTestId('btn-start-full-process');
  await expect(start).toBeEnabled({ timeout: 30_000 });
  await start.click();
  const dialog = window.getByTestId('production-summary-dialog');
  await expect(dialog).toBeVisible({ timeout: 6 * 60_000 });
  console.log(`[summary]\n${await dialog.innerText()}`);
  return dialog;
}

async function closeSummary(window: Page) {
  await window.getByTestId('btn-close-summary').click();
  await expect(window.getByTestId('production-summary-dialog')).toBeHidden();
}

test.describe('Step 5b — Request Production Access event batches (real MH)', () => {
  test('Contingencia: 5 contingency events accepted, and a second batch is really sent again', async ({ electronFor }) => {
    test.setTimeout(8 * 60_000);
    const { window } = await electronFor({ real: REAL });
    await openRequestProduction(window);

    await runOnly(window, ['contingencia']);
    const batch = window.getByTestId('summary-batch-contingencia');
    await expect(batch).toContainText('Aceptado');
    await expect(batch).toContainText('5 de 5 aceptados por Hacienda');
    await expect(window.getByTestId('row-status-contingencia')).toHaveText('Enviado');
    await closeSummary(window);

    // "Send a new batch" — must hit MH again with 5 NEW events, not be
    // short-circuited because the first batch already succeeded.
    const sentBefore = await window.getByTestId('row-sent-contingencia').innerText();
    await runOnly(window, ['contingencia']);
    await expect(window.getByTestId('summary-batch-contingencia')).toContainText('5 de 5 aceptados por Hacienda');
    const sentAfter = await window.getByTestId('row-sent-contingencia').innerText();
    expect(Number(sentAfter.replace(/\D/g, ''))).toBe(Number(sentBefore.replace(/\D/g, '')) + 5);
  });

  test('Evento de Invalidación: 5 facturas accepted then invalidated', async ({ electronFor }) => {
    test.setTimeout(8 * 60_000);
    const { window } = await electronFor({ real: REAL });
    await openRequestProduction(window);

    await runOnly(window, ['invalidacion']);
    const batch = window.getByTestId('summary-batch-invalidacion');
    await expect(batch).toContainText('Aceptado');
    await expect(batch).toContainText('5 de 5 aceptados por Hacienda');
    await expect(window.getByTestId('row-status-invalidacion')).toHaveText('Enviado');
  });
});
