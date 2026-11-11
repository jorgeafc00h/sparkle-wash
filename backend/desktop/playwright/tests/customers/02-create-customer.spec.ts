import { test, expect } from '@playwright/test';
import { seedEmptyAppState } from '../../fixtures/seed-state';
import { navigateToTab } from '../../utils/helpers';

test.describe('Customers — Create', () => {
  test('navigate to add customer form', async ({ page }) => {
    await seedEmptyAppState(page);
    await navigateToTab(page, 'clientes');

    await page.getByTestId('add-customer-btn').click();

    await expect(page.getByTestId('customer-form')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Nuevo Cliente' })).toBeVisible();
  });

  test('fill required fields and submit creates customer', async ({ page }) => {
    await seedEmptyAppState(page);
    await navigateToTab(page, 'clientes');
    await page.getByTestId('add-customer-btn').click();
    await expect(page.getByTestId('customer-form')).toBeVisible({ timeout: 10000 });

    // Fill firstName
    await page.getByLabel('Nombre', { exact: false }).first().fill('Juan');
    // Fill lastName
    await page.getByLabel('Apellido', { exact: false }).first().fill('Perez');
    // Submit
    await page.getByTestId('submit-customer-btn').click();

    // Should navigate back to customer list
    await expect(page.getByTestId('customer-list')).toBeVisible({ timeout: 10000 });
  });

  test('customer appears in list after creation', async ({ page }) => {
    await seedEmptyAppState(page);
    await navigateToTab(page, 'clientes');
    await page.getByTestId('add-customer-btn').click();
    await expect(page.getByTestId('customer-form')).toBeVisible({ timeout: 10000 });

    await page.getByLabel('Nombre', { exact: false }).first().fill('Roberto');
    await page.getByLabel('Apellido', { exact: false }).first().fill('Silva');
    await page.getByTestId('submit-customer-btn').click();

    await expect(page.getByTestId('customer-list')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Roberto')).toBeVisible();
  });

  test.describe('Location dropdowns (Departamento / Municipio)', () => {
    test('selecting a departamento updates the Departamento select value', async ({ page }) => {
      await seedEmptyAppState(page);
      await navigateToTab(page, 'clientes');
      await page.getByTestId('add-customer-btn').click();
      await expect(page.getByTestId('customer-form')).toBeVisible({ timeout: 10000 });

      const departamento = page.locator('#departamento');
      const municipio = page.locator('#municipio');

      // Initial state: Departamento is empty, Municipio is disabled
      await expect(departamento).toHaveValue('');
      await expect(municipio).toBeDisabled();

      // Select San Salvador (code 06)
      await departamento.selectOption({ label: 'San Salvador' });

      // Bug: previously the Select stayed empty showing "Seleccione Departamento"
      await expect(departamento).toHaveValue('06');
    });

    test('municipio dropdown enables and populates after departamento selection', async ({ page }) => {
      await seedEmptyAppState(page);
      await navigateToTab(page, 'clientes');
      await page.getByTestId('add-customer-btn').click();
      await expect(page.getByTestId('customer-form')).toBeVisible({ timeout: 10000 });

      const departamento = page.locator('#departamento');
      const municipio = page.locator('#municipio');

      await departamento.selectOption({ label: 'San Salvador' });

      // Municipio must enable once departamento is picked
      await expect(municipio).toBeEnabled({ timeout: 5000 });

      // Options populate from the bundled catalog (CAT-013). Wait until we have
      // more than just the placeholder option.
      await expect
        .poll(async () => municipio.locator('option').count(), { timeout: 8000 })
        .toBeGreaterThan(1);

      // Picking a municipio is possible and the Select reflects the selection
      await municipio.selectOption({ index: 1 });
      await expect(municipio).not.toHaveValue('');
    });

    test('changing departamento clears the previously selected municipio', async ({ page }) => {
      await seedEmptyAppState(page);
      await navigateToTab(page, 'clientes');
      await page.getByTestId('add-customer-btn').click();
      await expect(page.getByTestId('customer-form')).toBeVisible({ timeout: 10000 });

      const departamento = page.locator('#departamento');
      const municipio = page.locator('#municipio');

      await departamento.selectOption({ label: 'San Salvador' });
      await expect(municipio).toBeEnabled();
      await expect
        .poll(async () => municipio.locator('option').count(), { timeout: 8000 })
        .toBeGreaterThan(1);
      await municipio.selectOption({ index: 1 });
      await expect(municipio).not.toHaveValue('');

      // Change departamento — municipio should reset
      await departamento.selectOption({ label: 'La Libertad' });
      await expect(municipio).toHaveValue('');
    });

    test('customer persists departamento and municipio after submit', async ({ page }) => {
      await seedEmptyAppState(page);
      await navigateToTab(page, 'clientes');
      await page.getByTestId('add-customer-btn').click();
      await expect(page.getByTestId('customer-form')).toBeVisible({ timeout: 10000 });

      await page.getByLabel('Nombre', { exact: false }).first().fill('Ana');
      await page.getByLabel('Apellido', { exact: false }).first().fill('Martinez');

      const departamento = page.locator('#departamento');
      const municipio = page.locator('#municipio');

      await departamento.selectOption({ label: 'San Salvador' });
      await expect(municipio).toBeEnabled();
      await expect
        .poll(async () => municipio.locator('option').count(), { timeout: 8000 })
        .toBeGreaterThan(1);
      const selectedMuniLabel = await municipio.locator('option').nth(1).innerText();
      await municipio.selectOption({ index: 1 });

      await page.getByTestId('submit-customer-btn').click();
      await expect(page.getByTestId('customer-list')).toBeVisible({ timeout: 10000 });

      // Drill into the customer detail and verify the persisted location
      await page.getByText('Ana').first().click();
      await expect(page.getByText('San Salvador').first()).toBeVisible({ timeout: 8000 });
      await expect(page.getByText(selectedMuniLabel).first()).toBeVisible();
    });
  });
});
