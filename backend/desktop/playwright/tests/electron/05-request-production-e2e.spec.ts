/**
 * Step 5 — Request Production Access end-to-end UI test.
 *
 * Launches Electron with real MH test credentials, navigates to the
 * RequestProductionAccessPage, selects 5 documents per type, starts
 * the full generation + submission process, and asserts every DTE type
 * reaches "Completado" status.
 *
 * Requirements:
 *  - Certificate: playwright/fixtures/certificates/06141404941342.crt
 *  - Internet connection to apitest.dtes.mh.gob.sv
 *  - Run: npx playwright test tests/electron/05-request-production-e2e.spec.ts
 *  - Mock mode (CI / offline): MH_MOCK=1 npx playwright test ...
 */

import { test, expect } from '../../fixtures/electron-launch';

// Real MH is the default for the electron suite; opt out with MH_MOCK=1.
const MOCK = process.env.MH_MOCK === '1';
const REAL = !MOCK;

test.describe('Step 5 — Request Production Access (real MH, 5 per type)', () => {
  test('generates 5 invoices per DTE type and submits all to MH test environment', async ({ electronFor }) => {
    // Cold boot + 5 docs × 11 types × ~10s/doc ≈ 10 min budget.
    test.setTimeout(10 * 60 * 1000);

    const { window } = await electronFor({ real: REAL });

    window.on('console', (msg) => {
      const t = msg.text();
      if (
        t.includes('[prod-access]') ||
        t.includes('[MhClient]') ||
        t.includes('sendInvoices') ||
        t.includes('Submit error') ||
        t.includes('factur') ||
        msg.type() === 'error' ||
        msg.type() === 'warn'
      ) {
        console.log(`[browser ${msg.type()}] ${t}`);
      }
    });
    window.on('pageerror', (err) => console.log('[pageerror]', err.message));

    // ── Navigate to the production access page ────────────────────────────────
    // Electron HashRouter: manipulate location.hash directly, then poll for
    // the requirements card (same pattern as mh-real-sync.spec.ts).
    await expect(async () => {
      await window.evaluate(() => {
        location.hash = '#/companies/1/request-production';
      });
      await expect(window.getByTestId('request-production')).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 120_000, intervals: [1_000] });

    // Wait for redux-persist rehydration — sidebar "Sin empresa" disappears once done.
    await expect(window.getByText('Sin empresa')).toBeHidden({ timeout: 30_000 });

    // ── Requirements gate ─────────────────────────────────────────────────────
    // The Electron fixture seeds cert + cert password + MH credentials, so all
    // three badges must NOT show "Falta".
    const reqCard = window.getByTestId('production-requirements');
    await expect(reqCard).toBeVisible({ timeout: 10_000 });
    await expect(window.getByTestId('req-cert')).not.toHaveText(/Falta/, { timeout: 5_000 });
    await expect(window.getByTestId('req-cert-pwd')).not.toHaveText(/Falta/);
    await expect(window.getByTestId('req-creds')).not.toHaveText(/Falta/);

    await window.screenshot({ path: 'test-results/req-prod-01-requirements-ok.png' });

    // ── Select batch size = 5 ─────────────────────────────────────────────────
    const batchBtn5 = window.getByRole('button', { name: '5 por tipo', exact: true });
    await expect(batchBtn5).toBeVisible({ timeout: 5_000 });
    await batchBtn5.click();
    await expect(batchBtn5).toHaveClass(/bg-accent/, { timeout: 2_000 });

    // ── Batch rows: 11 DTE types + Contingencia + Evento de Invalidación ─────
    // Both event batches are first-class selectable rows now (iOS parity);
    // assert they render and toggle before starting.
    const contingenciaChk = window.getByTestId('chk-type-contingencia');
    await expect(contingenciaChk).toBeVisible({ timeout: 5_000 });
    await expect(contingenciaChk).toBeChecked();
    const invalidacionChk = window.getByTestId('chk-type-invalidacion');
    await expect(invalidacionChk).toBeVisible();
    await expect(invalidacionChk).toBeChecked();
    await expect(window.getByText('Evento de Invalidación (5)')).toBeVisible();
    // Toggle invalidación off then back on to prove it's user-selectable.
    await invalidacionChk.click();
    await expect(invalidacionChk).not.toBeChecked();
    await invalidacionChk.click();
    await expect(invalidacionChk).toBeChecked();

    await window.screenshot({ path: 'test-results/req-prod-02-batch-5.png' });

    // ── Start the full process ────────────────────────────────────────────────
    const startBtn = window.getByTestId('btn-start-full-process');
    await expect(startBtn).toBeEnabled({ timeout: 5_000 });
    // A lost click on a cold Electron boot once left every batch "Pendiente"
    // and the spec idled for the full 9-minute summary wait. Confirm the run
    // actually started (the button disables while processing, or the summary
    // is already up) and click again if it didn't.
    const confirmBtn = window.getByRole('button', { name: /Confirmar|Aceptar|Sí/i });
    await expect(async () => {
      if (await startBtn.isEnabled()) {
        await startBtn.click();
        // Accept any confirmation dialog.
        if (await confirmBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
          await confirmBtn.click();
        }
      }
      const started =
        (await startBtn.isDisabled()) ||
        (await window.getByTestId('production-summary-dialog').isVisible());
      expect(started, 'the full production-access run must start').toBe(true);
    }).toPass({ timeout: 60_000, intervals: [2_000] });

    await window.screenshot({ path: 'test-results/req-prod-03-processing.png' });

    // ── Wait for the end-of-run summary ──────────────────────────────────────
    // Every run ends in the summary dialog; it is the source of truth for what
    // Hacienda accepted. (The old assertion counted "Enviado" badges ≥ 11 and
    // passed while MH was rejecting whole batches.)
    const dialog = window.getByTestId('production-summary-dialog');
    await expect(dialog).toBeVisible({ timeout: 9 * 60 * 1000 });
    console.log(`[summary]\n${await dialog.innerText()}`);
    await window.screenshot({ path: 'test-results/req-prod-04-completed.png' });

    // All 13 batches (11 DTE types + contingencia + invalidación) must be
    // accepted by MH, with 5 de 5 documents each.
    const keys = [
      'factura', 'ccf', 'sujetoExcluido', 'facturaExportacion', 'notaCredito', 'notaDebito',
      'notaRemision', 'comprobanteLiquidacion', 'comprobanteRetencion', 'documentoContable',
      'comprobanteDonacion', 'contingencia', 'invalidacion',
    ];
    for (const key of keys) {
      const batch = dialog.getByTestId(`summary-batch-${key}`);
      await expect(batch, `${key} batch must be accepted by MH`).toContainText('Aceptado');
      await expect(batch).toContainText('5 de 5 aceptados por Hacienda');
    }
    await expect(window.getByRole('heading', { name: 'Proceso completado', exact: true })).toBeVisible();
    await window.getByTestId('btn-close-summary').click();

    // Full success promotes the company and shows the next-steps card.
    await expect(window.getByTestId('production-completion-card')).toBeVisible();
    for (const key of keys) {
      await expect(window.getByTestId(`row-status-${key}`)).toHaveText('Enviado');
    }
  });
});
