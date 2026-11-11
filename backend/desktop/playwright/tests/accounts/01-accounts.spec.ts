import { expect, test } from '@playwright/test';
import { seedFinanceAppState } from '../../fixtures/seed-state';

test.describe('Cobros y pagos', () => {
  test('shows receivables and payables from local documents', async ({ page }) => {
    await seedFinanceAppState(page);

    await page.getByTestId('sidebar-cobros-pagos').click();
    await expect(page.getByTestId('cuentas.desktop')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Cobros y pagos' })).toBeVisible();

    await expect(page.getByTestId('cuentas.segment.porCobrar')).toBeVisible();
    await expect(page.getByText('DTE-01-M001-000000001')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Maria Gonzalez')).toBeVisible();

    await page.getByTestId('cuentas.segment.porPagar').click();
    await expect(page.getByText('DTE-03-PROV-000000001')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Proveedor Demo S.A. de C.V.')).toBeVisible();
  });

  test('registers a partial receivable payment and updates status and balance', async ({ page }) => {
    await seedFinanceAppState(page);

    await page.getByTestId('sidebar-cobros-pagos').click();
    await expect(page.getByTestId('cuentas.desktop')).toBeVisible({ timeout: 10000 });

    await page.getByText('DTE-01-M001-000000001').click();
    await expect(page.getByTestId('cuentas.payment.modal')).toBeVisible();
    await page.getByTestId('cuentas.payment.amount').fill('100');
    await page.getByTestId('cuentas.payment.submit').click();

    await expect(page.getByText('Cobro registrado')).toBeVisible({ timeout: 8000 });
    const table = page.getByTestId('data-table');
    await expect(table.getByText('$100.00')).toBeVisible();
    await expect(table.getByText('$200.00')).toBeVisible();
  });

  test('registers a partial payable payment and updates status and balance', async ({ page }) => {
    await seedFinanceAppState(page);

    await page.getByTestId('sidebar-cobros-pagos').click();
    await expect(page.getByTestId('cuentas.desktop')).toBeVisible({ timeout: 10000 });

    await page.getByTestId('cuentas.segment.porPagar').click();
    await page.getByText('DTE-03-PROV-000000001').click();
    await expect(page.getByTestId('cuentas.payment.modal')).toBeVisible();
    await page.getByTestId('cuentas.payment.amount').fill('13');
    await page.getByTestId('cuentas.payment.submit').click();

    await expect(page.getByText('Pago registrado')).toBeVisible({ timeout: 8000 });
    const table = page.getByTestId('data-table');
    await expect(table.getByText('$13.00')).toBeVisible();
    await expect(table.getByText('$100.00')).toBeVisible();
  });

  test('shows payment terms for credit and explicit unpaid cash invoices', async ({ page }) => {
    await seedFinanceAppState(page);

    await page.getByTestId('sidebar-facturas').click();
    await page.getByTestId('btn-new-invoice').click();
    await expect(page.getByTestId('add-invoice')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /Factura CF/i }).click();
    await expect(page.getByText('Paso 2 — Completa los datos del documento')).toBeVisible({ timeout: 5000 });

    await expect(page.getByTestId('payment-condition')).toBeVisible();
    await page.getByTestId('payment-condition').selectOption('2');
    await expect(page.getByTestId('payment-term-code')).toBeVisible();
    await page.getByTestId('payment-term-code').selectOption('02');
    await page.getByTestId('payment-term-period').fill('2');
    await expect(page.getByTestId('payment-due-date')).toContainText('Vencimiento estimado');

    await page.getByTestId('payment-condition').selectOption('1');
    await page.getByTestId('payment-open-in-accounts').check();
    await expect(page.getByTestId('payment-due-date')).toBeVisible();
  });

  test('shows payment terms for manual compras that open payables', async ({ page }) => {
    await seedFinanceAppState(page);

    await page.getByTestId('sidebar-compras').click();
    await page.getByRole('button', { name: /Agregar Compra/i }).first().click();
    await page.getByRole('button', { name: /Ingreso Manual/i }).click();

    await expect(page.getByRole('heading', { name: 'Condición de pago' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('payment-condition')).toBeVisible();

    await page.getByTestId('payment-condition').selectOption('2');
    await expect(page.getByTestId('payment-term-code')).toBeVisible();
    await page.getByTestId('payment-term-period').fill('45');
    await expect(page.getByTestId('payment-due-date')).toContainText('Vencimiento estimado');

    await page.getByTestId('payment-condition').selectOption('1');
    await page.getByTestId('payment-open-in-accounts').check();
    await expect(page.getByTestId('payment-due-date')).toBeVisible();
  });
});
