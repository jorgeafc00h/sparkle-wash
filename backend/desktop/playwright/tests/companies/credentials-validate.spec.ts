/**
 * MH API credentials card (Configuración → Credenciales API).
 *
 * UX contract (2026-09-26): users read a successful "Probar Credenciales" as
 * "saved" — it wasn't, and it even stamped "Probadas el …" on credentials that
 * were never stored. Now:
 *  - a typed password has ONE action, "Validar y guardar": MH validates it and
 *    it is written to the keychain only when Hacienda accepts it;
 *  - "Probar credenciales guardadas" exists only once something is saved, and
 *    tests the KEYCHAIN copy (disabled while a new password is typed);
 *  - an inline status line (role=status) always says whether anything was
 *    saved; deleting asks for confirmation.
 */

import { test, expect, type Page } from '@playwright/test';
import { seedPopulatedAppState, waitForAppReady } from '../../fixtures/seed-state';

async function openCredentials(page: Page, flags: Record<string, string>) {
  await page.addInitScript((f: Record<string, string>) => {
    for (const [k, v] of Object.entries(f)) window.localStorage.setItem(k, v);
  }, flags);
  await seedPopulatedAppState(page);
  await page.goto('/#/companies/1/config?section=credentials');
  await waitForAppReady(page);
}

async function reopen(page: Page) {
  await page.reload();
  await waitForAppReady(page);
  await page.goto('/#/companies/1/config?section=credentials');
  await waitForAppReady(page);
}

test.describe('Credenciales API — nothing saved yet', () => {
  test('a typed password has a single "Validar y guardar" action and is flagged as unsaved', async ({ page }) => {
    await openCredentials(page, { __mock_mh_api: 'true' });

    await expect(page.getByTestId('credentials-missing-badge')).toHaveText('Sin guardar');
    // No test-only action for unsaved input.
    await expect(page.getByTestId('btn-test-credentials')).toHaveCount(0);
    const save = page.getByTestId('btn-save-credentials');
    await expect(save).toHaveText('Validar y guardar');
    await expect(save).toBeDisabled();
    await expect(page.getByText(/solo se guarda si Hacienda la acepta/)).toBeVisible();

    await page.getByTestId('input-cred-password').fill('typed-not-saved');
    await expect(save).toBeEnabled();
    const status = page.getByTestId('credentials-status');
    await expect(status).toHaveAttribute('data-state', 'unsaved');
    await expect(status).toContainText('Contraseña sin guardar');
  });

  test('rejected by Hacienda: says nothing was saved and the keychain stays empty', async ({ page }) => {
    await openCredentials(page, { __mock_mh_auth_fail: 'true' });

    await page.getByTestId('input-cred-password').fill('bad_password');
    await page.getByTestId('btn-save-credentials').click();

    const status = page.getByTestId('credentials-status');
    await expect(status).toHaveAttribute('data-state', 'rejected', { timeout: 8000 });
    await expect(status).toContainText('Hacienda rechazó');
    await expect(status).toContainText('No se guardó ningún cambio');
    await expect(page.locator('[role="alert"]').first()).toContainText(/rechazó/i, { timeout: 8000 });
    await expect(page.getByTestId('credentials-saved-badge')).toHaveCount(0);
    // The typed value stays so the user can correct it.
    await expect(page.getByTestId('input-cred-password')).toHaveValue('bad_password');

    await reopen(page);
    await expect(page.getByTestId('credentials-missing-badge')).toBeVisible();
    await expect(page.getByTestId('input-cred-password')).toHaveValue('');
  });
});

test.describe('Credenciales API — validate, save, then test the saved copy', () => {
  test('saving validates first, then "Probar credenciales guardadas" checks the keychain copy', async ({ page }) => {
    await openCredentials(page, { __mock_mh_api: 'true' });

    await page.getByTestId('input-cred-password').fill('valid_password');
    await page.getByTestId('btn-save-credentials').click();

    const status = page.getByTestId('credentials-status');
    await expect(status).toHaveAttribute('data-state', 'saved', { timeout: 8000 });
    await expect(status).toContainText('quedaron guardadas');
    await expect(page.getByTestId('credentials-saved-badge')).toBeVisible();
    await expect(page.getByTestId('credentials-last-tested')).toContainText(/Probadas el/);
    await expect(page.getByTestId('input-cred-password')).toHaveValue('');
    await expect(page.getByTestId('btn-save-credentials')).toHaveText('Validar y actualizar');

    // Testing now exercises the stored credentials.
    const testSaved = page.getByTestId('btn-test-credentials');
    await expect(testSaved).toHaveText('Probar credenciales guardadas');
    await testSaved.click();
    await expect(status).toHaveAttribute('data-state', 'stored-ok', { timeout: 8000 });
    await expect(status).toContainText('Las credenciales guardadas funcionan');

    // Typing a new password: testing would check the OLD one, so it is
    // disabled and the new value is flagged as unsaved.
    await page.getByTestId('input-cred-password').fill('new_password');
    await expect(testSaved).toBeDisabled();
    await expect(status).toHaveAttribute('data-state', 'unsaved');
    await expect(status).toContainText('Contraseña nueva sin guardar');

    // Round-trip through the keychain.
    await reopen(page);
    await expect(page.getByTestId('credentials-saved-badge')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('btn-test-credentials')).toBeEnabled();
  });

  test('deleting saved credentials asks for confirmation first', async ({ page }) => {
    await openCredentials(page, { __mock_mh_api: 'true' });
    await page.getByTestId('input-cred-password').fill('valid_password');
    await page.getByTestId('btn-save-credentials').click();
    await expect(page.getByTestId('credentials-saved-badge')).toBeVisible({ timeout: 8000 });

    await page.getByTestId('btn-remove-credentials').click();
    const dialog = page.getByRole('dialog', { name: 'Eliminar credenciales' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByTestId('credentials-saved-badge')).toBeVisible();

    await page.getByTestId('btn-remove-credentials').click();
    await dialog.getByRole('button', { name: 'Eliminar' }).click();
    await expect(page.getByTestId('credentials-missing-badge')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('btn-test-credentials')).toHaveCount(0);
  });
});

// Hacienda's production API password can differ from the test one. The TEST
// and PRODUCTION companies share a NIT, so the keychain keeps one entry per
// environment: a promoted company starts on the test password (and says so),
// and saving its own never overwrites the test company's.
test.describe('Credenciales API — production company after promotion', () => {
  test('inherits the test password with a notice, then keeps its own separately', async ({ page }) => {
    await openCredentials(page, { __mock_mh_api: 'true' });
    await page.getByTestId('input-cred-password').fill('test-pwd');
    await page.getByTestId('btn-save-credentials').click();
    await expect(page.getByTestId('credentials-saved-badge')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('credentials-inherited')).toHaveCount(0);

    await page.goto('/#/companies/1/config?section=env');
    await waitForAppReady(page);
    await page.getByTestId('btn-promote-production').click();
    await page.getByRole('dialog').getByRole('button', { name: /Promover/ }).click();
    await expect(page).toHaveURL(/\/companies\/(?!1\b)[^/]+\/config/, { timeout: 10000 });
    const prodId = page.url().match(/\/companies\/([^/]+)\/config/)![1];

    await page.goto(`/#/companies/${prodId}/config?section=credentials`);
    await waitForAppReady(page);
    await expect(page.getByTestId('credentials-saved-badge')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('credentials-inherited')).toContainText('empresa de pruebas');

    await page.getByTestId('input-cred-password').fill('prod-pwd');
    await page.getByTestId('btn-save-credentials').click();
    await expect(page.getByTestId('credentials-status')).toHaveAttribute('data-state', 'saved', { timeout: 8000 });
    await expect(page.getByTestId('credentials-inherited')).toHaveCount(0);

    const stored = await page.evaluate(() => ({
      test: window.localStorage.getItem('secure:company_creds_0614-140494-134-2'),
      prod: window.localStorage.getItem('secure:company_creds_prod_0614-140494-134-2'),
    }));
    expect(JSON.parse(stored.test!).password).toBe('test-pwd');
    expect(JSON.parse(stored.prod!).password).toBe('prod-pwd');

    // Deleting the production password falls back to the test one again.
    await page.getByTestId('btn-remove-credentials').click();
    await page.getByRole('dialog', { name: 'Eliminar credenciales' }).getByRole('button', { name: 'Eliminar' }).click();
    await expect(page.getByTestId('credentials-inherited')).toBeVisible({ timeout: 5000 });
    expect(
      await page.evaluate(() => window.localStorage.getItem('secure:company_creds_0614-140494-134-2')),
    ).not.toBeNull();
  });
});
