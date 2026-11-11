/**
 * Settings → Impresora de tickets: USB guidance + step-by-step diagnostics.
 *
 * Prod App Insights (2026-10-13): a customer with a USB ticket printer ran
 * seven test prints against the default NETWORK connection
 * (192.168.1.100:9100 → "no respondió (timeout)") and nothing pointed at USB.
 * The Electron bridge is stubbed here (printer methods only — storage stays on
 * the web path); the main-process side is covered by Jest
 * (printing/thermalPrinterDiagnostics) and electron/08-pos-thermal-printing.
 */

import { test, expect, type Page } from '@playwright/test';
import { seedPopulatedAppState, waitForAppReady } from '../../fixtures/seed-state';

const USB_QUEUE = 'EPSON TM-T20II Receipt5';

async function openWithStubbedPrinter(page: Page, queues: string[]) {
  await page.addInitScript(({ queues: q }) => {
    const calls: Array<[string, { transport: string }]> = [];
    (window as unknown as { __printerCalls: typeof calls }).__printerCalls = calls;
    const step = (id: string, label: string, status: string, detail: string, hint?: string) => ({ id, label, status, detail, hint });
    (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
      printerList: async () => q,
      printerStatus: async () => ({ ok: true }),
      printerPrint: async (config: { transport: string; network?: { host: string; port: number } }) => {
        calls.push(['print', config]);
        return config.transport === 'network'
          ? { ok: false, error: `Impresora ${config.network?.host}:${config.network?.port} no respondió (timeout)`, code: 'TIMEOUT' }
          : { ok: true, transport: 'spooler' };
      },
      printerDiagnose: async (config: { transport: string }) => {
        calls.push(['diagnose', config]);
        return config.transport === 'network'
          ? {
            ok: false,
            transport: 'network',
            platform: 'win32',
            steps: [
              step('config', 'Configuración', 'ok', 'Red: 192.168.1.50:9100'),
              step('connect', 'Conexión a la impresora', 'error', 'Impresora 192.168.1.50:9100 no respondió (timeout)',
                'Si la impresora está conectada por cable USB, cambia «Conexión» a USB.'),
            ],
          }
          : {
            ok: false,
            transport: 'spooler',
            platform: 'win32',
            steps: [
              step('spooler-service', 'Servicio de cola de impresión', 'ok', 'Print Spooler en ejecución.'),
              step('queue', 'Cola de impresión', 'ok', '«EPSON TM-T20II Receipt5» — driver EPSON TM-T20II Receipt5.'),
              step('port', 'Puerto', 'ok', 'Conectada por USB (USB001).'),
              step('state', 'Estado de la impresora', 'error', 'Windows reporta la impresora: Offline.',
                'Enciéndela, revisa el cable USB y el papel.'),
              step('jobs', 'Trabajos en cola', 'warn', '2 trabajo(s) esperando (Error, Printing).',
                'Un trabajo atascado bloquea los siguientes: cancélalos.'),
            ],
          };
      },
    };
  }, { queues });
  await seedPopulatedAppState(page);
  await page.goto('/#/settings/printer');
  await waitForAppReady(page);
  await expect(page.getByTestId('printer-settings')).toBeVisible();
}

test.describe('Impresora de tickets — USB guidance and diagnostics', () => {
  test('enabling the printer preselects the detected USB ticket queue', async ({ page }) => {
    await openWithStubbedPrinter(page, ['Microsoft Print to PDF', 'EPSON L3150 Series', USB_QUEUE]);
    await page.getByTestId('chk-enable-printer').check();

    await expect(page.getByTestId('printer-transport')).toHaveValue('spooler');
    await expect(page.getByTestId('printer-queue')).toHaveValue(USB_QUEUE);
    await expect(page.getByTestId('printer-queue-help')).toContainText(`la de tickets parece ser «${USB_QUEUE}»`);
  });

  test('a failed network test runs the diagnosis and offers the USB printer', async ({ page }) => {
    await openWithStubbedPrinter(page, [USB_QUEUE]);
    await page.getByTestId('chk-enable-printer').check();
    await page.getByTestId('printer-transport').selectOption('network');
    // No sample IP is prefilled any more; the test button needs a real one.
    await expect(page.getByTestId('printer-host')).toHaveValue('');
    await expect(page.getByTestId('btn-test-print')).toBeDisabled();
    await page.getByTestId('printer-host').fill('192.168.1.50');

    await page.getByTestId('btn-test-print').click();

    const diagnostics = page.getByTestId('printer-diagnostics');
    await expect(diagnostics).toHaveAttribute('data-ok', 'false');
    await expect(page.getByTestId('printer-diagnostics-summary')).toContainText('Conexión a la impresora');
    await expect(page.getByTestId('diag-step-connect')).toHaveAttribute('data-status', 'error');
    await expect(page.getByTestId('diag-step-connect')).toContainText('cambia «Conexión» a USB');

    await expect(page.getByTestId('usb-suggestion')).toContainText(USB_QUEUE);
    await page.getByTestId('btn-switch-to-usb').click();
    await expect(page.getByTestId('printer-transport')).toHaveValue('spooler');
    await expect(page.getByTestId('printer-queue')).toHaveValue(USB_QUEUE);
    await expect(page.getByTestId('printer-diagnostics')).toHaveCount(0);

    await page.getByTestId('btn-test-print').click();
    await expect(page.getByText('Página de prueba enviada')).toBeVisible();
    const calls = await page.evaluate(() => (window as unknown as { __printerCalls: Array<[string, { transport: string }]> }).__printerCalls);
    expect(calls.map(([kind, config]) => `${kind}:${config.transport}`)).toEqual(
      ['print:network', 'diagnose:network', 'print:spooler'],
    );
  });

  test('"Diagnosticar" shows each USB step with its status and what to do', async ({ page }) => {
    await openWithStubbedPrinter(page, [USB_QUEUE]);
    await page.getByTestId('chk-enable-printer').check();
    await page.getByTestId('btn-printer-diagnose').click();

    await expect(page.getByTestId('printer-diagnostics-summary')).toContainText('Estado de la impresora');
    await expect(page.getByTestId('diag-step-port')).toHaveAttribute('data-status', 'ok');
    await expect(page.getByTestId('diag-step-state')).toHaveAttribute('data-status', 'error');
    await expect(page.getByTestId('diag-step-state')).toContainText('Offline');
    await expect(page.getByTestId('diag-step-jobs')).toHaveAttribute('data-status', 'warn');
    await expect(page.getByTestId('diag-step-jobs')).toContainText('cancélalos');
  });

  test('an accented queue is preselected and printable; a name the printer service refuses is flagged, never preselected', async ({ page }) => {
    // "POS [caja]" looks like a ticket printer but "[" is outside the names
    // the main process accepts — preselecting it made every print fail with
    // "Nombre de impresora inválido".
    await openWithStubbedPrinter(page, ['POS [caja] 80mm', 'Recibo Bixolón #2']);
    await page.getByTestId('chk-enable-printer').check();

    await expect(page.getByTestId('printer-queue')).toHaveValue('Recibo Bixolón #2');
    await expect(page.getByTestId('btn-test-print')).toBeEnabled();
    await page.getByTestId('btn-test-print').click();
    await expect(page.getByText('Página de prueba enviada')).toBeVisible();

    await page.getByTestId('printer-queue').selectOption('POS [caja] 80mm');
    await expect(page.getByTestId('printer-queue').locator('option[value="POS [caja] 80mm"]')).toHaveText('POS [caja] 80mm (nombre no compatible)');
    await expect(page.getByText('El nombre de esta cola tiene caracteres que no se pueden usar')).toBeVisible();
    await expect(page.getByTestId('btn-test-print')).toBeDisabled();
    await expect(page.getByTestId('btn-printer-diagnose')).toBeDisabled();
  });

  test('a stored example IP is flagged in the host field', async ({ page }) => {
    await openWithStubbedPrinter(page, []);
    await page.getByTestId('chk-enable-printer').check();
    await page.getByTestId('printer-transport').selectOption('network');
    await page.getByTestId('printer-host').fill('192.168.1.100');
    await expect(page.getByText('Es la IP de ejemplo')).toBeVisible();
  });
});
