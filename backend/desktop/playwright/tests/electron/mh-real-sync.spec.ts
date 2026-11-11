/**
 * MH sync end-to-end — Electron shell.
 *
 * Default: hits apitest.dtes.mh.gob.sv with the real cert + credentials
 * from Invoices.Api/Test/InvoiceSyncBaseTest.cs — the whole point of this
 * suite is to verify against MH's test API.
 *
 * MH_MOCK=1: runs against MockMhClient + fake signer (fast, offline-safe)
 * for CI / iteration without burning MH quota.
 *
 * Run:
 *   npx playwright test --config playwright.electron.config.ts
 *   MH_MOCK=1 npx playwright test --config playwright.electron.config.ts
 */

import { test, expect } from '../../fixtures/electron-launch';
import {
  ALL_TYPES,
  STANDALONE_TYPES,
  buildInvoicesFor,
  type InvoiceTypeName,
} from '../../fixtures/dte-types';
import { MH_TEST_CREDENTIALS } from '../../fixtures/mh-test-credentials';

const MOCK = process.env.MH_MOCK === '1';
const REAL = !MOCK;
const SYNC_TIMEOUT = REAL ? 120_000 : 20_000;

// In REAL mode, linked types (NC/ND/NR/CL/CR/DCL) need a parent CCF/Factura
// that's already been submitted to MH — its codigoGeneracion is what
// `documentoRelacionado.numeroDocumento` references, and MH validates that
// reference against its registry. The mh-real-sync fixture pre-seeds fake
// parents (status=Completada, fake UUID) which work for MockMhClient but
// MH's "NO EXISTE UN REGISTRO CON ESTE DATO" check rejects them.
//
// Test 04 (`04-all-dte-types.spec.ts`) covers linked types end-to-end against
// real MH by submitting the parent first inline, so we don't lose coverage.
const TYPES_TO_RUN: InvoiceTypeName[] = REAL ? STANDALONE_TYPES : ALL_TYPES;

// The very first test in this sweep pays the cold Electron boot + Vite dev
// server compile cost (~30-60s on CI / a fresh dev machine). Even at
// test.setTimeout(180s) the hash-nav poll occasionally exceeds 120s. Allow a
// single retry so this cold-start flake doesn't fail the suite.
test.describe.configure({ retries: 1 });

test.describe(`MH sync (${REAL ? 'REAL' : 'mocked'}) — ${TYPES_TO_RUN.length} DTE types`, () => {
  for (const typeName of TYPES_TO_RUN) {
    test(`${typeName}: sign + submit + Completada`, async ({ electronFor }) => {
      // Cold Electron boot + renderer bundle compile on the first test of the
      // batch can exceed Playwright's 30s default test timeout.
      test.setTimeout(180_000);
      const { parentInvoices, target } = buildInvoicesFor(typeName);
      const handle = await electronFor({
        real: REAL,
        invoices: [target, ...parentInvoices],
      });

      const logs: string[] = [];
      handle.window.on('console', (msg) => {
        logs.push(`[${msg.type()}] ${msg.text()}`);
      });
      handle.window.on('pageerror', (err) => {
        logs.push(`[pageerror] ${err.message}`);
      });

      // Navigate to the invoice detail page. We poll: every second, re-set
      // the hash and check for invoice-detail. Before redux-persist finishes
      // rehydrating, AppShell redirects protected routes to /welcome, so the
      // first nav may land on welcome and we need to re-trigger once guest
      // mode is active.
      await expect(async () => {
        await handle.window.evaluate((id) => {
          location.hash = `#/invoices/${id}`;
        }, target.id);
        await expect(handle.window.getByTestId('invoice-detail')).toBeVisible({
          timeout: 3_000,
        });
      }).toPass({ timeout: 120_000, intervals: [1_000] });

      // Wait for redux-persist to finish rehydrating `currentCompany` before
      // clicking Sincronizar — InvoiceDetailPage.handleSync aborts when the
      // company is null, and the sidebar's "Sin empresa" label is the easiest
      // signal that rehydration hasn't landed yet.
      await expect(handle.window.getByText('Sin empresa')).toBeHidden({
        timeout: 30_000,
      });

      const syncBtn = handle.window.getByTestId('btn-sync');
      await expect(syncBtn).toBeVisible();
      await syncBtn.click();

      try {
        await expect(
          handle.window.getByTestId('invoice-detail').getByText(/completada/i).first(),
        ).toBeVisible({ timeout: SYNC_TIMEOUT });
      } catch (err) {
        if (logs.length) {
          console.log(`\n=== Browser console for ${typeName} ===`);
          for (const l of logs) console.log(l);
          console.log(`=== end ===\n`);
        }
        throw err;
      }
    });
  }
});

test('Electron harness bootstraps with cert + credentials', async ({ electronApp }) => {
  const certLen = await electronApp.window.evaluate(async (nit) => {
    const api = (window as any).electronAPI;
    const stored = await api.storage.getItem(`cert_data_${nit}`);
    return stored?.length ?? 0;
  }, MH_TEST_CREDENTIALS.nit);
  expect(certLen).toBeGreaterThan(100);

  const secret = await electronApp.window.evaluate(async (nit) => {
    const api = (window as any).electronAPI;
    return api.secureGet('SparkleWash', `cert_password_${nit}`);
  }, MH_TEST_CREDENTIALS.nit);
  expect(secret).toBe(MH_TEST_CREDENTIALS.certificateKeySha512);
});
