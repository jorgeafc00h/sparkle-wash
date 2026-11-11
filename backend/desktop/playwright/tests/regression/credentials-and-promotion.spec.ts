/**
 * Regression tests for the 2026-04-20 credentials + promotion batch.
 *
 *  - Bug 1: Credentials form now writes to SecureStorage and re-displays the
 *           saved user on subsequent loads ("Guardadas" badge shown).
 *  - Bug 2: Request Production Access page shows a requirements card and
 *           disables the action buttons until cert + cert password + creds
 *           are all configured.
 *  - Bug 3: "Promover a Producción" clones the company into a new record,
 *           switches selection, and leaves the dev company's data intact.
 */

import { test, expect } from '@playwright/test';
import {
  seedPopulatedAppState,
  waitForAppReady,
} from '../../fixtures/seed-state';

test.describe('Credentials save (keychain round-trip)', () => {
  test('saving credentials shows "Guardadas" badge and persists user after reload', async ({ page }) => {
    // Enable mock MH client so Save validates without hitting the real MH API.
    await page.addInitScript(() => {
      window.localStorage.setItem('__mock_mh_api', 'true');
    });
    await seedPopulatedAppState(page);
    await page.goto('/#/companies/1/config?section=credentials');
    await waitForAppReady(page);

    const passwordField = page.getByTestId('input-cred-password');
    const saveBtn = page.getByTestId('btn-save-credentials');

    await passwordField.fill('s3cr3t-demo');

    await saveBtn.click();
    await expect(page.getByTestId('credentials-saved-badge')).toBeVisible({ timeout: 5000 });

    // Reload the page — the "Guardadas" badge must persist (creds round-tripped).
    await page.reload();
    await waitForAppReady(page);
    await expect(page.getByTestId('credentials-saved-badge')).toBeVisible({ timeout: 8000 });
    // The remove button is only shown after save.
    await expect(page.getByTestId('btn-remove-credentials')).toBeVisible();
  });
});

test.describe('Request Production — requirements gate', () => {
  test('badges show "Falta" when nothing configured and buttons are disabled', async ({ page }) => {
    await seedPopulatedAppState(page);
    // Seeded company has hasValidCertificate=false and no saved creds.
    await page.goto('/#/companies/1/request-production');
    await waitForAppReady(page);

    await expect(page.getByTestId('production-requirements')).toBeVisible({ timeout: 10000 });

    await expect(page.getByTestId('req-cert')).toHaveText(/Falta/);
    await expect(page.getByTestId('req-cert-pwd')).toHaveText(/Falta/);
    await expect(page.getByTestId('req-creds')).toHaveText(/Falta/);

    // "Reenviar pendientes" only appears once a run left documents unaccepted.
    await expect(page.getByTestId('btn-send-generated')).toHaveCount(0);
    await expect(page.getByTestId('btn-start-full-process')).toBeDisabled();

    // Helper button routes the user to the config page.
    await expect(page.getByTestId('btn-go-config')).toBeVisible();
  });
});

test.describe('Promote to Production (clone company)', () => {
  test('clone creates a new company, selects it, and the new company has no data', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/companies/1/config?section=env');
    await waitForAppReady(page);

    const promoteBtn = page.getByTestId('btn-promote-production');
    await expect(promoteBtn).toBeVisible({ timeout: 8000 });
    await promoteBtn.click();

    // Dialog confirm
    await page.getByRole('dialog').getByRole('button', { name: /Promover/ }).click();

    // We should land on the new company's config (id !== '1').
    await expect(page).toHaveURL(/\/companies\/(?!1\b)[^/]+\/config/, { timeout: 10000 });

    // Read Redux state to confirm the clone has correct isolation.
    const snapshot = await page.evaluate(async () => {
      const mod = await import('/src/store/index.ts');
      const store = mod.store ?? mod.default;
      const state = store.getState();
      const companies = state.companies.companies;
      const selectedId = state.companies.selectedCompanyId;
      const current = companies.find((c: any) => c.id === selectedId);
      const source = companies.find((c: any) => c.id === '1');
      const customers = state.customers.customers;
      const products = state.products.products;
      const invoices = state.invoices.invoices;
      return {
        total: companies.length,
        selectedId,
        sameNit: current?.nit === source?.nit,
        cloneEnv: current?.environment,
        cloneHasCert: current?.hasValidCertificate,
        cloneHasApiCreds: current?.hasApiCredentials,
        cloneInvoiceNumber: current?.currentInvoiceNumber,
        cloneId: current?.id,
        // Data linked to the SOURCE company is untouched.
        sourceCustomers: customers.filter((c: any) => c.companyId === '1').length,
        sourceProducts: products.filter((p: any) => p.companyId === '1').length,
        sourceInvoices: invoices.filter((i: any) => i.companyId === '1').length,
        // The new company starts with zero.
        cloneCustomers: customers.filter((c: any) => c.companyId === current?.id).length,
        cloneProducts: products.filter((p: any) => p.companyId === current?.id).length,
        cloneInvoices: invoices.filter((i: any) => i.companyId === current?.id).length,
      };
    });

    expect(snapshot.total).toBe(2);
    expect(snapshot.selectedId).not.toBe('1');
    expect(snapshot.sameNit).toBe(true);
    expect(snapshot.cloneEnv).toBe('PRODUCTION');
    expect(snapshot.cloneHasCert).toBe(false);
    expect(snapshot.cloneHasApiCreds).toBe(false);
    expect(snapshot.cloneInvoiceNumber).toBe(1);
    // Source data preserved, clone isolated.
    expect(snapshot.sourceCustomers).toBeGreaterThan(0);
    expect(snapshot.sourceInvoices).toBeGreaterThan(0);
    expect(snapshot.cloneCustomers).toBe(0);
    expect(snapshot.cloneProducts).toBe(0);
    expect(snapshot.cloneInvoices).toBe(0);
  });

  test('promoting a second time reuses the existing production company', async ({ page }) => {
    await seedPopulatedAppState(page);

    // First promotion
    await page.goto('/#/companies/1/config?section=env');
    await waitForAppReady(page);
    await page.getByTestId('btn-promote-production').click();
    await page.getByRole('dialog').getByRole('button', { name: /Promover/ }).click();
    await expect(page).toHaveURL(/\/companies\/(?!1\b)[^/]+\/config/, { timeout: 10000 });

    const firstProdId = await page.evaluate(async () => {
      const mod = await import('/src/store/index.ts');
      const store = mod.store ?? mod.default;
      return store.getState().companies.selectedCompanyId;
    });

    // Switch back to test company and promote again.
    await page.evaluate(async () => {
      const mod = await import('/src/store/slices/companySlice.ts');
      const storeMod = await import('/src/store/index.ts');
      const store = storeMod.store ?? storeMod.default;
      store.dispatch(mod.setSelectedCompany('1'));
    });

    await page.goto('/#/companies/1/config?section=env');
    await waitForAppReady(page);
    await page.getByTestId('btn-promote-production').click();
    await page.getByRole('dialog').getByRole('button', { name: /Promover/ }).click();

    const after = await page.evaluate(async () => {
      const mod = await import('/src/store/index.ts');
      const store = mod.store ?? mod.default;
      const state = store.getState();
      return {
        total: state.companies.companies.length,
        selectedId: state.companies.selectedCompanyId,
      };
    });

    // No new company was created; selection points at the existing prod one.
    expect(after.total).toBe(2);
    expect(after.selectedId).toBe(firstProdId);
  });
});
