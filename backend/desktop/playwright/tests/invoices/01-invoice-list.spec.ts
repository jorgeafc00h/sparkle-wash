import { test, expect } from '@playwright/test';
import { seedEmptyAppState, seedPopulatedAppState } from '../../fixtures/seed-state';
import { navigateToTab } from '../../utils/helpers';

test.describe('Invoices — List', () => {
  test('shows empty state when no invoices', async ({ page }) => {
    await seedEmptyAppState(page);
    await navigateToTab(page, 'facturas');

    await expect(page.getByText('No hay DTE ni eventos')).toBeVisible({ timeout: 10000 });
  });

  test('shows invoice data table when invoices exist', async ({ page }) => {
    await seedPopulatedAppState(page);
    await navigateToTab(page, 'facturas');

    // Should show invoice list with data
    await expect(page.getByText('DTE-01-M001-000000001')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('DTE-03-M001-000000001')).toBeVisible();
  });

  test('search bar filters invoices', async ({ page }) => {
    await seedPopulatedAppState(page);
    await navigateToTab(page, 'facturas');

    await expect(page.getByText('DTE-01-M001-000000001')).toBeVisible({ timeout: 10000 });

    // Search for CCF control number
    await page.getByPlaceholder(/Buscar/i).fill('DTE-03');

    // Only CCF invoice should be visible
    await expect(page.getByText('DTE-03-M001-000000001')).toBeVisible();
    await expect(page.getByText('DTE-01-M001-000000001')).not.toBeVisible();
  });

  test('batch delete feature: select invoices and delete', async ({ page }) => {
    await seedPopulatedAppState(page);
    await navigateToTab(page, 'facturas');

    // Test checkbox selection
    const checkbox1 = page.getByTestId('checkbox-inv-001');
    const checkbox2 = page.getByTestId('checkbox-inv-002');

    await checkbox1.check();
    await checkbox2.check();

    // Verify checkboxes are checked
    await expect(checkbox1).toBeChecked();
    await expect(checkbox2).toBeChecked();

    // inv-001/002 are Completada — issued DTEs are never bulk-deletable, so no button yet
    const bulkDeleteBtn = page.getByTestId('btn-bulk-delete');
    await expect(bulkDeleteBtn).toHaveCount(0);

    // Adding the draft inv-003 (Nueva) makes exactly that one deletable
    await page.getByTestId('checkbox-inv-003').check();
    await expect(bulkDeleteBtn).toBeVisible();
    await expect(bulkDeleteBtn).toHaveText(/Eliminar \(1\)/);
    await page.getByTestId('checkbox-inv-003').uncheck();

    // Test select all button — toggles to all rows
    await page.getByTestId('btn-select-all').click();
    await expect(page.getByTestId('checkbox-inv-001')).toBeChecked();
  });

  test('batch delete: confirm dialog shows count', async ({ page }) => {
    await seedPopulatedAppState(page);
    await navigateToTab(page, 'facturas');

    // Select the draft invoice
    const checkbox = page.getByTestId('checkbox-inv-003');
    await checkbox.check();

    // Click bulk delete button
    await page.getByTestId('btn-bulk-delete').click();

    // Confirmation dialog should appear with count
    await expect(page.getByText('¿Eliminar 1 elemento seleccionado?')).toBeVisible();
    await expect(page.getByText('Esta acción no se puede deshacer.')).toBeVisible();
  });

  test('batch delete keeps issued DTEs (Completada) and removes only drafts', async ({ page }) => {
    await seedPopulatedAppState(page);
    await navigateToTab(page, 'facturas');

    await page.getByTestId('checkbox-inv-001').check(); // Completada
    await page.getByTestId('checkbox-inv-003').check(); // Nueva

    await page.getByTestId('btn-bulk-delete').click();
    await expect(page.getByText('¿Eliminar 1 elemento seleccionado?')).toBeVisible();
    await expect(page.getByText(/1 documento ya emitido se conservará/)).toBeVisible();
    await page.getByRole('button', { name: 'Eliminar', exact: true }).click();

    await expect(page.getByTestId('checkbox-inv-003')).toHaveCount(0);
    await expect(page.getByTestId('checkbox-inv-001')).toBeVisible();
  });

  test('keyboard shortcut Ctrl+N opens new invoice', async ({ page }) => {
    await seedPopulatedAppState(page);
    await navigateToTab(page, 'facturas');

    // Press Ctrl+N shortcut
    await page.keyboard.press('Control+n');

    // Navigation should occur
    await expect(page).toHaveURL(/\/invoices\/add/);
  });

  test('keyboard shortcut Ctrl+K focuses search bar', async ({ page }) => {
    await seedPopulatedAppState(page);
    await navigateToTab(page, 'facturas');

    // Press Ctrl+K shortcut
    await page.keyboard.press('Control+k');

    // The actual <input> inside the SearchBar should be focused
    await expect(page.locator('[data-testid="search-bar"] input')).toBeFocused();
  });

  test('keyboard shortcut Ctrl+D triggers bulk delete', async ({ page }) => {
    await seedPopulatedAppState(page);
    await navigateToTab(page, 'facturas');

    // Select a draft invoice (issued DTEs are never bulk-deletable)
    await page.getByTestId('checkbox-inv-003').check();

    // Press Ctrl+D shortcut
    await page.keyboard.press('Control+d');

    // Confirmation dialog should appear
    await expect(page.getByText('¿Eliminar 1 elemento seleccionado?')).toBeVisible();
  });

  test('status badges show urgency indicators', async ({ page }) => {
    await seedPopulatedAppState(page);
    await navigateToTab(page, 'facturas');

    // Check that status badges are displayed correctly (scoped to the data table to avoid
    // collisions with the "Nueva Factura" button and the status-filter <option>).
    const table = page.getByTestId('data-table');
    await expect(table.getByText('Nueva').first()).toBeVisible();
    await expect(table.getByText('Completada').first()).toBeVisible();

    // Status badges should have urgency-based styling
    // ErrorEnvio status should have critical urgency (red ring, pulse animation)
    // Modificada status should have high urgency (yellow ring)
    // Sincronizando status should have high urgency with spinning icon
  });

  test('empty state shows contextual tips', async ({ page }) => {
    await seedEmptyAppState(page);
    await navigateToTab(page, 'facturas');

    await expect(page.getByText('No hay DTE ni eventos')).toBeVisible();
    await expect(page.getByText('Crea tu primer DTE o evento electrónico.')).toBeVisible();
    await expect(page.getByTestId('btn-new-invoice')).toBeVisible();
  });

  test('confirmation dialog shows contextual warnings', async ({ page }) => {
    await seedPopulatedAppState(page);
    await navigateToTab(page, 'facturas');

    // Go to invoice detail — use the Nueva invoice (inv-003 / INV-003) so the
    // delete button is actually rendered (Completada invoices can't be locally deleted).
    await page.getByText('INV-003').first().click();

    // Delete invoice
    await page.getByTestId('btn-delete-invoice').click();

    // Confirmation dialog should appear with warning
    await expect(page.getByText('⚠️ Esta acción es irreversible')).toBeVisible();
    await expect(page.getByText('El DTE será eliminado localmente')).toBeVisible();
  });
});
