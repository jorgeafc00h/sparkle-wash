/**
 * POS (tickets) screenshots for the user manual.
 *
 * Captures the counter-sale flow: register with cart, payment modal, ticket
 * history, cierre de caja and the consolidation wizard — plus the printer
 * settings page. Output → docs-screenshots/ (copy to the landing repo's
 * public/docs/images/desktop/ when rebuilding the manual).
 *
 * Run:
 *   npx playwright test playwright/tests/docs/capture-pos-screens.spec.ts
 */

import { test, Page } from '@playwright/test';
import { seedPopulatedAppState, waitForAppReady } from '../../fixtures/seed-state';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', '..', '..', 'docs-screenshots');
mkdirSync(OUT, { recursive: true });

async function shot(page: Page, name: string) {
  await page.screenshot({ path: resolve(OUT, `${name}.png`), fullPage: false });
}

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1440, height: 900 } });

async function makeSaleForShot(page: Page) {
  await page.getByTestId('pos-product-prod-003').click();
  await page.getByTestId('pos-product-prod-005').click();
}

test.describe('Ch22 — Punto de Venta (POS)', () => {
  test('22-pos register + payment + tickets + closing + consolidation + printer settings', async ({ page }) => {
    await seedPopulatedAppState(page);

    // Register with a cart in progress.
    await page.goto('/#/pos');
    await waitForAppReady(page);
    await page.getByTestId('pos-product-prod-002').click();
    await page.getByTestId('pos-product-prod-003').click();
    await page.getByTestId('pos-cart-lines').locator('[data-testid^="pos-cart-line-"]').first().locator('[data-testid^="pos-qty-plus-"]').click();
    await page.waitForTimeout(300);
    await shot(page, '22-pos_01_register-with-cart');

    // Payment modal (cash, quick-cash chips).
    await page.getByTestId('btn-charge').click();
    await page.getByTestId('pay-cash-tendered').fill('2000');
    await page.waitForTimeout(200);
    await shot(page, '22-pos_02_payment-cash');
    await page.getByTestId('btn-confirm-payment').click();
    await expectToastCleared(page);
    await makeSaleForShot(page);
    await page.getByTestId('btn-charge').click();
    await page.getByTestId('btn-confirm-payment').click();
    await expectToastCleared(page);

    // Ticket history.
    await page.goto('/#/pos/tickets');
    await waitForAppReady(page);
    await page.waitForTimeout(400);
    await shot(page, '22-pos_03_ticket-history');

    // Cierre de caja.
    await page.goto('/#/pos/closing');
    await waitForAppReady(page);
    await page.waitForTimeout(400);
    await shot(page, '22-pos_04_cierre-de-caja');

    // Consolidation wizard (step 2 preview).
    await page.goto('/#/pos/consolidate');
    await waitForAppReady(page);
    await page.getByTestId('btn-select-all').click();
    await page.getByTestId('btn-review-selection').click();
    await page.waitForTimeout(300);
    await shot(page, '22-pos_05_consolidate-preview');

    // Printer settings.
    await page.goto('/#/settings/printer');
    await waitForAppReady(page);
    await shot(page, '22-pos_06_printer-settings');
  });
});

test.describe('Ch22 — Punto de Venta: fase 2 (caja, pagos divididos, devoluciones)', () => {
  test('22-pos open drawer + split payment + suspended + cash out + return + arqueo + facturar cierre', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/pos');
    await waitForAppReady(page);

    // Abrir caja con fondo inicial.
    await page.getByTestId('btn-open-cash-drawer').click();
    await page.getByTestId('cash-open-float-input').fill('50');
    await page.waitForTimeout(200);
    await shot(page, '22-pos_07_abrir-caja');
    await page.getByTestId('btn-confirm-open-cash').click();
    await page.getByTestId('cash-drawer-open-info').waitFor();

    // Pago dividido: tarjeta + efectivo.
    await page.getByTestId('pos-product-prod-003').click();
    await page.getByTestId('pos-product-prod-005').click();
    await page.getByTestId('btn-charge').click();
    await page.getByTestId('pay-method-select').selectOption('TARJETA_POS');
    await page.getByTestId('pay-card-last4').fill('4242');
    await page.getByTestId('pay-amount').fill('100');
    await page.getByTestId('btn-add-payment').click();
    await page.getByTestId('pay-cash-tendered').fill('30');
    await page.waitForTimeout(200);
    await shot(page, '22-pos_08_pago-dividido');
    await page.getByTestId('btn-confirm-payment').click();
    await expectToastCleared(page);

    // Venta en espera (F8).
    await page.getByTestId('pos-product-prod-003').click();
    await page.keyboard.press('F8');
    await page.getByTestId('btn-pos-suspended').click();
    await page.waitForTimeout(300);
    await shot(page, '22-pos_09_ventas-en-espera');
    await page.keyboard.press('Escape');

    // Salida de efectivo.
    await page.getByTestId('btn-cash-movement').click();
    await page.getByTestId('cash-movement-kind').selectOption('OUT');
    await page.getByTestId('cash-movement-amount').fill('10');
    await page.getByTestId('cash-movement-reason').fill('Pago a proveedor de pan');
    await page.waitForTimeout(200);
    await shot(page, '22-pos_10_salida-de-efectivo');
    await page.getByTestId('btn-confirm-cash-movement').click();
    await page.getByTestId('cash-drawer-out').waitFor();

    // Devolución parcial.
    await page.goto('/#/pos/tickets');
    await waitForAppReady(page);
    await page.getByTestId('btn-return-ticket-1').click();
    await page.getByTestId('return-qty-0').fill('1');
    await page.getByTestId('return-reason').fill('Producto dañado');
    await page.waitForTimeout(200);
    await shot(page, '22-pos_11_devolucion');
    await page.getByTestId('btn-confirm-return').click();
    await page.getByText(/Devolución registrada/).first().waitFor({ timeout: 10_000 });

    // Arqueo en el cierre Z.
    await page.goto('/#/pos/closing');
    await waitForAppReady(page);
    await page.getByTestId('closing-cash-counted').fill('64');
    await page.waitForTimeout(300);
    await shot(page, '22-pos_12_arqueo-cierre-z');
    await page.getByTestId('btn-close-z').click();
    await page.getByText(/Cierre Z registrado/).first().waitFor({ timeout: 10_000 });

    // Facturar este cierre: cuadre con las ventas.
    await page.locator('[data-testid^="btn-invoice-closing-"]').first().click();
    await waitForAppReady(page);
    await page.getByTestId('btn-review-selection').click();
    await page.getByTestId('consolidate-reconciliation').waitFor();
    await page.waitForTimeout(300);
    await shot(page, '22-pos_13_facturar-cierre');
  });
});

async function expectToastCleared(page: Page) {
  await page.getByText(/Ticket #\d+ guardado/).last().waitFor({ timeout: 10_000 });
}
