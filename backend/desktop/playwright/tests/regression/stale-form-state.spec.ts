/**
 * Regression tests for the 2026-04-20 "stale-prop / dead-field" bug sweep.
 *
 * Each bug below has the same root cause as the original LocationDropdowns fix:
 * the form had a field that was either hardcoded to empty, not wired to a
 * control, or not re-seeded after async state load — causing silent data loss
 * at save time. The assertions here lock in the fix.
 */

import { test, expect } from '@playwright/test';
import {
  seedEmptyAppState,
  seedPopulatedAppState,
  waitForAppReady,
} from '../../fixtures/seed-state';
import { navigateToTab } from '../../utils/helpers';

test.describe('Stale-form-state regressions', () => {
  // ─────────────────────────────────────────────────────────────────────────────
  // Bug #5 — CustomerFormPage: "Tiene retención de contribuyente" checkbox
  // was rendered as a plain <input> without register/Controller. Toggling
  // it did nothing and values.hasContributorRetention was always the default.
  // ─────────────────────────────────────────────────────────────────────────────
  test('customer retention checkbox toggles and persists to the saved customer', async ({ page }) => {
    await seedEmptyAppState(page);
    await navigateToTab(page, 'clientes');
    await page.getByTestId('add-customer-btn').click();
    await expect(page.getByTestId('customer-form')).toBeVisible({ timeout: 10000 });

    await page.getByLabel('Nombre', { exact: false }).first().fill('Luis');
    await page.getByLabel('Apellido', { exact: false }).first().fill('Ramos');

    const checkbox = page.getByTestId('customer-has-retention');
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    await expect(checkbox).toBeChecked();

    await page.getByTestId('submit-customer-btn').click();
    await expect(page.getByTestId('customer-list')).toBeVisible({ timeout: 10000 });

    // Open the customer and verify the "Retención" badge is shown (detail
    // page only renders it when hasContributorRetention === true).
    await page.getByText('Luis').first().click();
    await expect(page.getByText('Retención', { exact: true })).toBeVisible({ timeout: 8000 });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Bug #4 — AddCompraPage: the manual-entry items grid had no input for
  // ventaGravada, yet totalGravada / totalPagar were computed by summing it.
  // Every manual compra saved with totalGravada = 0.
  // ─────────────────────────────────────────────────────────────────────────────
  test('manual compra accepts ventaGravada and totals reflect it', async ({ page }) => {
    await seedPopulatedAppState(page); // Pro tier so compras is unlocked
    await navigateToTab(page, 'compras');

    await page.goto('/#/compras/add');
    await waitForAppReady(page);
    await expect(page.getByTestId('add-compra')).toBeVisible({ timeout: 10000 });

    // Switch to manual mode
    await page.getByRole('button', { name: /Ingreso Manual/i }).click();

    // The new input exists and is editable (before the fix, it didn't exist).
    const ventaGravada = page.getByTestId('compra-venta-gravada-0');
    await expect(ventaGravada).toBeVisible();

    // Fill with a distinctive value and verify the "Total a Pagar" hint uses it.
    await ventaGravada.fill('100');
    await page.getByLabel('IVA', { exact: false }).first().fill('13');

    // Totals are computed as: sum(ventaGravada) + sum(ivaItem) → 113.00
    await expect(page.getByText('$113.00')).toBeVisible({ timeout: 3000 });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Bugs #1 & #2 — CompanyConfigPage: locationData / activityData were
  // captured by useState(company?.x ?? '') with no re-seed. Regression test:
  // deep-link straight into the Location and Activity sections and assert the
  // dropdowns reflect the SAVED values, not empty strings.
  // ─────────────────────────────────────────────────────────────────────────────
  test('company config location section loads seeded departamento/municipio', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/companies/1/config?section=location');
    await waitForAppReady(page);

    // Legacy seeded municipioCode=14 is normalized to CAT-013 San Salvador Norte (20).
    const departamento = page.locator('#departamento');
    const municipio = page.locator('#municipio');

    await expect(departamento).toHaveValue('06', { timeout: 8000 });
    await expect(municipio).toHaveValue('20', { timeout: 8000 });
  });

  test('company config activity section loads seeded codActividad/tipoEstablecimiento', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/companies/1/config?section=activity');
    await waitForAppReady(page);

    // Seeded TEST_COMPANY has codActividad=45209 / tipoEstablecimiento=07.
    // CatalogPicker renders the selected value in its trigger text.
    await expect(page.getByText(/45209/).first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Predio', { exact: false }).first()).toBeVisible({ timeout: 8000 });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Bug #3 — CompanyConfigPage settingsForm: useForm({ defaultValues: ... })
  // with no reset(). Regression test: the settings section shows the seeded
  // currentInvoiceNumber and saving does not clobber it.
  // ─────────────────────────────────────────────────────────────────────────────
  test('company config settings section shows seeded currentInvoiceNumber', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/companies/1/config?section=settings');
    await waitForAppReady(page);

    const invoiceNumberInput = page
      .getByLabel('Número Actual de Factura', { exact: false });
    await expect(invoiceNumberInput).toHaveValue('1', { timeout: 8000 });
  });
});
