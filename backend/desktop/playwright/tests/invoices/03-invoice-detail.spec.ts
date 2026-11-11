import { test, expect } from '@playwright/test';
import { seedPopulatedAppState, SAMPLE_INVOICES } from '../../fixtures/seed-state';
import { navigateToTab } from '../../utils/helpers';
import { launchAs } from '../../fixtures/launch-modes';

test.describe('Invoices — Detail', () => {
  test('click invoice row navigates to detail page', async ({ page }) => {
    await seedPopulatedAppState(page);
    await navigateToTab(page, 'facturas');

    // Click the first invoice by its control number
    await expect(page.getByText('DTE-01-M001-000000001')).toBeVisible({ timeout: 10000 });
    await page.getByText('DTE-01-M001-000000001').click();

    await expect(page).toHaveURL(/\/invoices\/inv-001/, { timeout: 8000 });
    await expect(page.getByTestId('invoice-detail')).toBeVisible({ timeout: 8000 });
  });

  test('completed invoice shows export and invalidate action buttons', async ({ page }) => {
    await seedPopulatedAppState(page);
    // Navigate directly to a completed invoice
    await page.goto(`/#/invoices/${SAMPLE_INVOICES[0].id}`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('sidebar-inicio')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('invoice-detail')).toBeVisible({ timeout: 8000 });

    // Completed invoice should show export/PDF and invalidate options
    // The canExport and canInvalidate flags are true for status=Completada (4)
    await expect(page.getByRole('button', { name: /Exportar|PDF|Anular|Invalidar/i }).first()).toBeVisible({ timeout: 5000 });
  });

  test('completed factura with MH identifiers can prefill Evento de Retorno', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto(`/#/invoices/${SAMPLE_INVOICES[0].id}`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('invoice-detail')).toBeVisible({ timeout: 8000 });
    await page.getByTestId('btn-actions-menu').click();
    await expect(page.getByTestId('action-create-retorno')).toBeVisible();

    await page.getByTestId('action-create-retorno').click();
    await expect(page.getByText('Crear Evento de Retorno')).toBeVisible();
    await page.getByRole('button', { name: 'Crear', exact: true }).click();

    await expect(page).toHaveURL(/\/invoices\/add\?type=18&parentId=inv-001/, { timeout: 8000 });
    await expect(page.getByText('Nuevo Evento de Retorno (18)')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('DTE de origen para Retorno')).toBeVisible();
    await expect(page.getByLabel('Selecciona el DTE origen')).toHaveValue('inv-001');
    await expect(page.getByLabel('Selecciona el DTE origen').locator('option:checked')).toHaveText(/01 — DTE-01-M001-000000001/);
  });

  test('non applicable completed DTE does not show Retorno action', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto(`/#/invoices/${SAMPLE_INVOICES[1].id}`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('invoice-detail')).toBeVisible({ timeout: 8000 });
    await page.getByTestId('btn-actions-menu').click();
    await expect(page.getByTestId('action-create-retorno')).toHaveCount(0);
    await expect(page.getByText('Registrar Evento de Retorno')).toHaveCount(0);
  });

  test('invalidation page explains invalidation event and copied identifiers', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto(`/#/invoices/${SAMPLE_INVOICES[0].id}/invalidate`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('invalidation')).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('heading', { name: 'Evento de invalidación' })).toBeVisible();
    await expect(page.getByText('Invalidar vs Retorno')).toBeVisible();
    await expect(page.getByText(/Invalidar genera un evento de invalidación/i)).toBeVisible();
    await expect(page.getByTestId('invalidation-identifiers-summary')).toContainText('Tipo DTE');
    await expect(page.getByTestId('invalidation-identifiers-summary')).toContainText('01');
    await expect(page.getByTestId('invalidation-identifiers-summary')).toContainText('11111111-1111-4111-8111-111111111111');
    await expect(page.getByTestId('invalidation-identifiers-summary')).toContainText('SELLO-RECIBIDO-INV-001');
  });

  test('invalidation motivo 1 (anula y sustituye) requires the replacement generation code', async ({ page }) => {
    // A factura transmitted today, so it is inside the invalidation window.
    const now = new Date().toISOString();
    await launchAs(page, 'mhLiteSync', {
      invoices: [{ ...SAMPLE_INVOICES[0], id: 'inv-today', date: now.slice(0, 10), fechaTransmision: now }],
    });
    await page.goto('/#/invoices/inv-today/invalidate');
    await expect(page.getByTestId('invalidation')).toBeVisible({ timeout: 8000 });

    await page.getByLabel('Motivo').selectOption('1');
    const code = page.getByLabel('Código de generación del DTE correcto');
    await expect(code).toBeVisible();
    await expect(page.getByText(/Requerido: código de generación \(UUID v4\)/)).toBeVisible();

    await page.getByLabel('Nombre del responsable').fill('Jorge Flores');
    await page.getByLabel('Documento del responsable').fill('06141404-9');

    // Submitting without it is refused with a clear reason (CAT-024).
    await page.getByTestId('btn-invalidate').click();
    await expect(page.locator('[role="alert"]').first()).toContainText(/motivo 1.*código de generación/i, { timeout: 5000 });

    // Motivo 2 does not ask for it.
    await page.getByLabel('Motivo').selectOption('2');
    await expect(code).toHaveCount(0);
  });

  test('draft invoice can generate quote preview before DTE submission', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__openedUrls = [];
      const fakeWindow = {
        document: { write: () => undefined, close: () => undefined },
        focus: () => undefined,
        print: () => undefined,
      };
      window.open = ((url?: string | URL | undefined) => {
        (window as any).__openedUrls.push(String(url ?? ''));
        return fakeWindow as unknown as Window;
      }) as typeof window.open;
    });

    await seedPopulatedAppState(page);
    await page.goto(`/#/invoices/${SAMPLE_INVOICES[2].id}`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('invoice-detail')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('btn-sync')).toBeVisible();

    await page.getByTestId('btn-quote-preview').click();

    await expect(page.getByText(/Vista previa de cotización/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('quote-pdf-preview-modal')).toBeVisible();
    await expect(page.getByTestId('btn-preview-download')).toBeVisible();
    await expect(page.getByTestId('btn-preview-quote-email')).toBeVisible();
    await expect(page.getByTestId('btn-preview-quote-email')).toContainText(/Enviar cotización por Email/i);
    await expect(page.getByTestId('btn-preview-email')).toHaveCount(0);

    const previewFrame = page.frameLocator('[data-testid="pdf-preview-frame"]');
    await expect(previewFrame.getByRole('heading', { name: 'DOCUMENTO NO TRIBUTARIO' })).toBeVisible({ timeout: 10000 });
    await expect(previewFrame.getByRole('heading', { name: 'COTIZACIÓN' })).toBeVisible();
    await expect(previewFrame.getByText('Número de Cotización:')).toBeVisible();
    await expect(previewFrame.getByText(SAMPLE_INVOICES[2].invoiceNumber)).toBeVisible();

    const confirmation = page.waitForEvent('dialog').then(async (dialog) => {
      expect(dialog.message()).toMatch(/Cliente de correo abierto|Cotización enviada/i);
      await dialog.accept();
    });
    await page.getByTestId('btn-preview-quote-email').click();
    await confirmation;
    await expect(page.getByText(/Cliente de correo abierto/i)).toBeVisible({ timeout: 10000 });

    const openedUrls = await page.evaluate(() => (window as any).__openedUrls as string[]);
    expect(openedUrls.some((url) => {
      const decodedUrl = decodeURIComponent(url);
      return url.startsWith('mailto:') &&
        decodedUrl.includes('Cotización INV-003') &&
        decodedUrl.includes('documento no es tributario');
    })).toBeTruthy();
  });

  test('completed CCF PDF preview keeps email action visible with CCF label', async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto(`/#/invoices/${SAMPLE_INVOICES[1].id}`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('invoice-detail')).toBeVisible({ timeout: 8000 });
    await page.getByTestId('btn-preview-pdf').click();

    await expect(page.getByTestId('invoice-pdf-preview-modal')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('btn-preview-email')).toBeVisible();
    await expect(page.getByTestId('btn-preview-email')).toContainText(/Enviar CCF por Email/i);
  });
});
