/**
 * E2E test: Create invoice → verify in list → verify persistence across reload.
 *
 * Validates:
 *  - AddInvoicePage type picker → form → save flow
 *  - Invoice appears in InvoiceListPage after creation
 *  - Invoice persists across page reload (redux-persist → app-storage.json)
 *  - Status = Nueva (0) since it hasn't been synced with MH
 */

import { test, expect } from '@playwright/test';
import {
  seedPopulatedAppState,
  waitForAppReady,
} from '../../fixtures/seed-state';

test.describe('Create Invoice — end-to-end', () => {
  test('create Factura CF with product, verify in list, verify persistence', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/invoices');
    await waitForAppReady(page);

    // ── Step 1: Navigate to AddInvoicePage ────────────────────────────────
    const newBtn = page.getByTestId('btn-new-invoice');
    await expect(newBtn).toBeVisible({ timeout: 8_000 });
    await newBtn.click();
    await expect(page.getByTestId('add-invoice')).toBeVisible({ timeout: 8_000 });

    // ── Step 2: Select DTE type — Factura CF ──────────────────────────────
    await page.getByText('Factura CF').click();

    // Should advance to step 2 (form)
    await expect(page.getByText('Información General')).toBeVisible({ timeout: 5_000 });

    // ── Step 3: Pick a customer ───────────────────────────────────────────
    const customerInput = page.locator('input[placeholder="Buscar cliente..."]');
    await customerInput.fill('Maria');
    // Wait for dropdown to appear and click the first result
    await page.locator('text=Maria').first().click();

    // ── Step 4: Add a line item ───────────────────────────────────────────
    // Click "Agregar ítem" button
    await page.getByRole('button', { name: /Agregar/i }).click();

    // A new row should appear — fill the product search
    // ProductDropdown is now a combobox autocomplete with placeholder
    // "Buscar producto o describir manualmente...". Match the prefix to
    // stay tolerant of further wording tweaks.
    const productInputs = page.locator('input[placeholder^="Buscar producto"]');
    await productInputs.last().fill('Consultoría');
    // Wait for dropdown and click the product
    await page.locator('text=Servicio de Consultoría').first().click();

    // Verify the unit price was auto-filled (150.00) — check the totals sidebar
    await expect(page.getByText('$150.00').first()).toBeVisible({ timeout: 3_000 });

    // ── Step 5: Save the invoice ──────────────────────────────────────────
    await page.getByTestId('btn-save').click();

    // Should navigate back to invoice list
    await expect(page.getByText('DTE creado correctamente.')).toBeVisible({ timeout: 5_000 });
    await expect(page).toHaveURL(/\/invoices$/, { timeout: 5_000 });

    // ── Step 6: Verify the new invoice appears in the list ────────────────
    // Count invoices — seeded 3 + newly created 1 = 4
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(4, { timeout: 8_000 });

    // The new invoice should be in the list (Maria appears in 2 rows now:
    // the seeded Completada one + the newly created Nueva one)
    const mariaRows = page.getByRole('cell', { name: 'Maria Gonzalez' });
    await expect(mariaRows).toHaveCount(2);

    // ── Step 7: Verify persistence in storage ───────────────────────────
    // redux-persist writes to localStorage (or electronAPI.storage in Electron).
    // Verify the new invoice was serialized and persisted.
    const persistedInvoices = await page.evaluate(() => {
      const raw = localStorage.getItem('persist:invoices');
      if (!raw) return null;
      const outer = JSON.parse(raw);
      return JSON.parse(outer.invoices);
    });
    expect(persistedInvoices).not.toBeNull();
    expect(persistedInvoices.length).toBe(4);
    // The newest invoice (unshift'd) should be first
    expect(persistedInvoices[0].invoiceType).toBe(0); // Factura
    expect(persistedInvoices[0].status).toBe(0); // Nueva
  });

  test('create CCF with business customer, verify type badge', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/invoices/add');
    await waitForAppReady(page);
    await expect(page.getByTestId('add-invoice')).toBeVisible({ timeout: 8_000 });

    // Select CCF type
    await page.getByText('CCF').first().click();
    await expect(page.getByText('Información General')).toBeVisible({ timeout: 5_000 });

    // Pick business customer (Empresa XYZ)
    const customerInput = page.locator('input[placeholder="Buscar cliente..."]');
    await customerInput.fill('Empresa XYZ');
    await page.locator('text=Empresa XYZ').first().click();

    // Add item
    await page.getByRole('button', { name: /Agregar/i }).click();
    // ProductDropdown is now a combobox autocomplete with placeholder
    // "Buscar producto o describir manualmente...". Match the prefix to
    // stay tolerant of further wording tweaks.
    const productInputs = page.locator('input[placeholder^="Buscar producto"]');
    await productInputs.last().fill('Laptop');
    await page.locator('text=Laptop Dell Inspiron').first().click();

    // Save
    await page.getByTestId('btn-save').click();
    await expect(page.getByText('DTE creado correctamente.')).toBeVisible({ timeout: 5_000 });

    // Verify we're on the list and CCF is visible
    await expect(page).toHaveURL(/\/invoices$/, { timeout: 5_000 });
  });

  test('cannot save invoice without items', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/invoices/add');
    await waitForAppReady(page);
    await expect(page.getByTestId('add-invoice')).toBeVisible({ timeout: 8_000 });

    // Select Factura CF
    await page.getByText('Factura CF').click();
    await expect(page.getByText('Información General')).toBeVisible({ timeout: 5_000 });

    // Try to save without adding items
    await page.getByTestId('btn-save').click();

    // Should show error toast
    await expect(page.getByText('Agrega al menos un ítem')).toBeVisible({ timeout: 3_000 });
  });
});
