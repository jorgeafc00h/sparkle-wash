/**
 * Regression tests for the 2026-04-14 company-flow bug report:
 *
 *  Bug 1 — Invoice creation must be blocked when no company is selected.
 *          Previously, /invoices/add silently fell back to DEFAULT_COMPANY_ID
 *          and let the user emit a DTE for a non-existent company.
 *
 *  Bug 2 — Updating one field on a company (e.g. saving the certificate
 *          password) wiped every other field (nombre / NIT / NRC / dirección
 *          ...) because the updateCompany thunk reconstructed the entire
 *          Company object with `''` defaults instead of merging.
 */

import { test, expect, Page } from '@playwright/test';
import {
  seedPopulatedAppState,
  waitForAppReady,
} from '../../fixtures/seed-state';

/**
 * Clear the currently-selected company without removing companies from the
 * list. This is the state that triggered the original bug: companies exist
 * but `currentCompany` is null, and the create-invoice flow silently fell
 * back to DEFAULT_COMPANY_ID.
 */
async function clearSelectedCompany(page: Page) {
  // Dispatch directly into the redux store so the change takes effect without
  // racing redux-persist rehydration.
  await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const storeModule = await import('/src/store/index.ts');
    const slice = await import('/src/store/slices/companySlice.ts');
    const store = storeModule.store ?? storeModule.default;
    const setSelected = slice.setSelectedCompany;
    if (setSelected) store.dispatch(setSelected(null));
    w.__currentCompanyClearedForTest = true;
  });
}

test.describe('Bug 1 — invoice creation blocked without selected company', () => {
  test('list page nav button shows toast + redirects to /companies', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/invoices');
    await waitForAppReady(page);
    await clearSelectedCompany(page);
    await page.goto('/#/invoices');
    await waitForAppReady(page);

    const newBtn = page.getByTestId('btn-new-invoice');
    await expect(newBtn).toBeVisible({ timeout: 8000 });
    await newBtn.click();

    // Should be sent to the companies list, not /invoices/add.
    await expect(page).toHaveURL(/\/companies(\?|$|#)/, { timeout: 5000 });
  });

  test('direct nav to /invoices/add shows the company-required gate', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/invoices');
    await waitForAppReady(page);
    await clearSelectedCompany(page);
    await page.goto('/#/invoices/add');
    await waitForAppReady(page);

    await expect(page.getByTestId('invoice-add-no-company')).toBeVisible({
      timeout: 8000,
    });
    // Action button takes the user to create-company.
    await page.getByTestId('btn-go-create-company').click();
    await expect(page).toHaveURL(/\/companies\/add/, { timeout: 5000 });
  });
});

test.describe('Bug 2 — updating company fields preserves other fields', () => {
  test('saving basic info section keeps NIT / NRC / dirección intact', async ({ page }) => {
    await seedPopulatedAppState(page);
    // Navigate straight to the new basic-info section of CompanyConfigPage.
    await page.goto('/#/companies/1/config?section=basicInfo');
    await waitForAppReady(page);

    await expect(page.getByTestId('basic-info-form')).toBeVisible({ timeout: 8000 });

    // Change ONLY nombreComercial — every other field must survive.
    const nombreComercialInput = page.getByTestId('input-nombre-comercial');
    await nombreComercialInput.fill('TestCo Renombrada');

    await page.getByTestId('btn-save-basic-info').click();
    // Toast confirmation appears.
    await expect(page.getByText('Información general guardada.')).toBeVisible({
      timeout: 5000,
    });

    // Re-read the form values from redux-persist via the form inputs themselves.
    // None of the originally seeded fields should have been wiped.
    const nitVal = await page.getByTestId('input-nit').inputValue();
    const nrcVal = await page.getByTestId('input-nrc').inputValue();
    const correoVal = await page.getByTestId('input-correo').inputValue();
    expect(nitVal).not.toBe('');
    expect(nrcVal).not.toBe('');
    expect(correoVal).not.toBe('');

    // And the new value persists.
    expect(await nombreComercialInput.inputValue()).toBe('TestCo Renombrada');
  });

  test('updateCompany reducer merges partial patches (unit-style via window store)', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/companies');
    await waitForAppReady(page);

    // Drive the bug repro from inside the page: dispatch an updateCompany
    // with ONLY { id, certificatePath } and assert the company's nombre/nit
    // survives. Before the fix, this dispatch zeroed out everything.
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      const sliceModule = await import('/src/store/slices/companySlice.ts');
      const storeModule = await import('/src/store/index.ts');
      const store = storeModule.store ?? storeModule.default;

      const before = store.getState().companies.companies.find(
        (c: any) => c.id === '1',
      );
      if (!before) return { ok: false, reason: 'company not seeded' };

      const beforeSnapshot = {
        nombre: before.nombre,
        nit: before.nit,
        nrc: before.nrc,
      };

      await store.dispatch(
        sliceModule.updateCompany({
          id: '1',
          certificatePath: '/tmp/fake.crt',
        }),
      );

      const after = store.getState().companies.companies.find(
        (c: any) => c.id === '1',
      );
      return {
        ok: true,
        beforeSnapshot,
        afterSnapshot: {
          nombre: after.nombre,
          nit: after.nit,
          nrc: after.nrc,
          certificatePath: after.certificatePath,
        },
      };
    });

    expect(result.ok).toBe(true);
    expect(result.afterSnapshot.nombre).toBe(result.beforeSnapshot.nombre);
    expect(result.afterSnapshot.nit).toBe(result.beforeSnapshot.nit);
    expect(result.afterSnapshot.nrc).toBe(result.beforeSnapshot.nrc);
    expect(result.afterSnapshot.certificatePath).toBe('/tmp/fake.crt');
  });
});
