import { test, expect } from '@playwright/test';
import { seedEmptyAppState } from '../../fixtures/seed-state';
import { navigateToTab } from '../../utils/helpers';

// IMAP es el método recomendado. Gmail OAuth queda como "alternativa" con
// advertencias obligatorias (app no verificada, 7-day re-auth, 100-user cap).
test.describe('Compras Settings — IMAP primary + Gmail warnings', () => {

  test('shows IMAP card with Recomendado badge', async ({ page }) => {
    await seedEmptyAppState(page);
    await navigateToTab(page, 'compras');
    await page.getByRole('button', { name: /configuraci[oó]n/i }).first().click();

    const imapCard = page.getByTestId('compras-settings-imap-card');
    await expect(imapCard).toBeVisible({ timeout: 10000 });
    await expect(imapCard.getByRole('heading', { name: 'Conectar Gmail' })).toBeVisible();
    await expect(imapCard.getByText('Recomendado')).toBeVisible();
  });

  test('shows Gmail OAuth warnings card with all three caveats', async ({ page }) => {
    await seedEmptyAppState(page);
    await navigateToTab(page, 'compras');
    await page.getByRole('button', { name: /configuraci[oó]n/i }).first().click();

    const warnings = page.getByTestId('compras-settings-gmail-warnings');
    await expect(warnings).toBeVisible({ timeout: 10000 });

    await expect(warnings).toContainText('app no verificada');
    await expect(warnings).toContainText('7 días');
    await expect(warnings).toContainText('100 usuarios');
  });

  test('Gmail card appears AFTER IMAP card (order-3 vs order-1)', async ({ page }) => {
    await seedEmptyAppState(page);
    await navigateToTab(page, 'compras');
    await page.getByRole('button', { name: /configuraci[oó]n/i }).first().click();

    const imapHeading = page.getByTestId('compras-settings-imap-card').getByRole('heading', {
      name: 'Conectar Gmail',
    });
    const gmailHeading = page.getByRole('heading', { name: 'Alternativa: Google OAuth' });

    await expect(imapHeading).toBeVisible({ timeout: 10000 });
    await expect(gmailHeading).toBeVisible();

    const imapBox = await imapHeading.boundingBox();
    const gmailBox = await gmailHeading.boundingBox();
    expect(imapBox).not.toBeNull();
    expect(gmailBox).not.toBeNull();
    // IMAP must render above Gmail in the flex column
    expect(imapBox!.y).toBeLessThan(gmailBox!.y);
  });

  // Auto-detected server/port/SSL — IMAP is presented as email + app
  // password + auto-detected connection info, resolved client-side from the
  // email domain (ImapImportService.detectImapSettings) before the user even
  // hits "Probar". The real connection re-resolves this server-side.
  test('shows auto-detected IMAP server for a non-Gmail domain', async ({ page }) => {
    await seedEmptyAppState(page);
    await navigateToTab(page, 'compras');
    await page.getByRole('button', { name: /configuraci[oó]n/i }).first().click();

    await expect(page.getByTestId('compras-settings-imap-card')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('compras-settings-imap-start').click();

    await page.getByTestId('compras-settings-imap-email-input').fill('persona@outlook.com');

    const hint = page.getByTestId('compras-settings-imap-detected-hint');
    await expect(hint).toBeVisible({ timeout: 10000 });
    await expect(hint).toContainText('outlook.office365.com');
    await expect(hint).toContainText('993');
  });

  test('auto-detected hint is hidden once Avanzado is expanded', async ({ page }) => {
    await seedEmptyAppState(page);
    await navigateToTab(page, 'compras');
    await page.getByRole('button', { name: /configuraci[oó]n/i }).first().click();

    await page.getByTestId('compras-settings-imap-start').click();
    await page.getByTestId('compras-settings-imap-email-input').fill('persona@yahoo.com');
    await expect(page.getByTestId('compras-settings-imap-detected-hint')).toBeVisible({ timeout: 10000 });

    // Once the user opens "Avanzado" the manual host/port fields become the
    // source of truth — the auto-detected hint should step out of the way.
    await page.getByTestId('compras-settings-imap-toggle-advanced').click();
    await expect(page.getByTestId('compras-settings-imap-detected-hint')).toHaveCount(0);
  });
});

// "Probar conexión" never saves. Editing the OCR provider settings flags them
// as unsaved so a successful test isn't mistaken for a saved configuration.
test.describe('Compras Settings — OCR provider unsaved changes', () => {
  test('editing Azure OpenAI / Ollama settings shows "Cambios sin guardar"', async ({ page }) => {
    await seedEmptyAppState(page);
    await navigateToTab(page, 'compras');
    await page.getByRole('button', { name: /configuraci[oó]n/i }).first().click();

    await page.getByTestId('tab-azure').click();
    await expect(page.getByTestId('azure-openai-save')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('azure-openai-unsaved')).toHaveCount(0);
    await page.getByPlaceholder(/openai\.azure\.com/i).first().fill('https://mi-recurso.openai.azure.com');
    await expect(page.getByTestId('azure-openai-unsaved')).toHaveText('Cambios sin guardar');

    await page.getByTestId('tab-ollama').click();
    await expect(page.getByTestId('ollama-save')).toBeVisible();
    await expect(page.getByTestId('ollama-unsaved')).toHaveCount(0);
  });
});
