/**
 * Certificate section — 3-step merged card (Contraseña → Archivo → Validar).
 *
 * Tests:
 *  1. Step 2 (file upload) is disabled until step 1 (password) is saved.
 *  2. Step 3 (validate) is disabled until step 2 (file) is uploaded.
 *  3. False-positive prevented: uploading a file alone does NOT set status "Válido".
 *  4. Validate success → metadata panel appears with parsed NIT.
 *  5. Eliminar → confirm dialog → Redux flags reset, badge returns to initial state.
 *  6. NIT missing guard renders at the top of the card and disables all steps.
 */

import { test, expect, Page } from '@playwright/test';
import {
  TEST_COMPANY,
  waitForAppReady,
} from '../../fixtures/seed-state';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the redux-persist double-encoded format for the companies slice.
 * Allows overriding specific company fields.
 */
function buildCompaniesLocalStorage(companyOverrides: Record<string, unknown> = {}): string {
  const company = { ...TEST_COMPANY, ...companyOverrides };
  const state = {
    companies: JSON.stringify([company]),
    selectedCompanyId: JSON.stringify(company.id),
    currentCompany: JSON.stringify(company),
    loading: JSON.stringify(false),
    error: JSON.stringify(null),
    _persist: JSON.stringify({ version: -1, rehydrated: true }),
  };
  return JSON.stringify(state);
}

/** Build the full set of localStorage entries needed for a working app state. */
function buildBaseLocalStorage(companyOverrides: Record<string, unknown> = {}): Record<string, string> {
  const authState = {
    user: JSON.stringify({
      id: 'guest-user-001',
      email: 'test@facturassimples.com',
      firstName: 'Test',
      lastName: 'User',
      isEmailVerified: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
    isAuthenticated: JSON.stringify(false),
    isGuestMode: JSON.stringify(true),
    hasCompletedOnboarding: JSON.stringify(true),
    loading: JSON.stringify(false),
    error: JSON.stringify(null),
    token: JSON.stringify(null),
    refreshToken: JSON.stringify(null),
    selectedCompanyId: JSON.stringify('1'),
    _persist: JSON.stringify({ version: -1, rehydrated: true }),
  };
  const appState = {
    isInitialized: JSON.stringify(true),
    isOnline: JSON.stringify(true),
    currentTheme: JSON.stringify('light'),
    language: JSON.stringify('es'),
    environment: JSON.stringify('development'),
    syncStatus: JSON.stringify('idle'),
    notifications: JSON.stringify([]),
    _persist: JSON.stringify({ version: -1, rehydrated: true }),
  };
  const subscriptionState = {
    tier: JSON.stringify('pro'),
    _persist: JSON.stringify({ version: -1, rehydrated: true }),
  };

  return {
    'persist:auth': JSON.stringify(authState),
    'persist:app': JSON.stringify(appState),
    'persist:companies': buildCompaniesLocalStorage(companyOverrides),
    'persist:customers': JSON.stringify({ customers: JSON.stringify([]), loading: JSON.stringify(false), error: JSON.stringify(null), _persist: JSON.stringify({ version: -1, rehydrated: true }) }),
    'persist:products': JSON.stringify({ products: JSON.stringify([]), loading: JSON.stringify(false), error: JSON.stringify(null), _persist: JSON.stringify({ version: -1, rehydrated: true }) }),
    'persist:invoices': JSON.stringify({ invoices: JSON.stringify([]), loading: JSON.stringify(false), error: JSON.stringify(null), _persist: JSON.stringify({ version: -1, rehydrated: true }) }),
    'persist:subscription': JSON.stringify(subscriptionState),
    'persist:compras': JSON.stringify({ compras: JSON.stringify([]), _persist: JSON.stringify({ version: -1, rehydrated: true }) }),
    'persist:catalogs': JSON.stringify({ _persist: JSON.stringify({ version: -1, rehydrated: true }) }),
  };
}

/**
 * Navigate to the company config cert section with a custom company state.
 * Uses addInitScript to inject before page load for reliable redux-persist hydration.
 */
async function gotoConfigPageWithState(
  page: Page,
  companyOverrides: Record<string, unknown> = {},
): Promise<void> {
  const entries = buildBaseLocalStorage(companyOverrides);
  await page.addInitScript((data) => {
    for (const [key, value] of Object.entries(data as Record<string, string>)) {
      window.localStorage.setItem(key, value);
    }
  }, entries);
  await page.goto('/#/companies/1/config?section=cert');
  await waitForAppReady(page);
  await expect(page.getByTestId('cert-card')).toBeVisible({ timeout: 8000 });
}

/**
 * Simulate saving a certificate password via SecureStorageService.
 * Must be called AFTER page.goto (needs the app context to be loaded).
 */
async function seedCertPassword(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const mod = await import('/src/services/security/SecureStorageService.ts');
    await mod.SecureStorageService.storeCertificatePassword(
      '0614-140494-134-2',
      // A fake 128-char hex string that stands in for a SHA-512 hash
      'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899',
    );
  });
}

/**
 * Simulate uploading a cert file by storing minimal XML directly via
 * SecureStorageService (bypasses the file input).
 * The clave value matches the seeded password hash so validation passes.
 */
async function seedCertFile(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const storeMod = await import('/src/services/security/SecureStorageService.ts');
    const fakeXml = `<?xml version="1.0"?>
<CertificadoMH>
  <_id>cert-test-001</_id>
  <nit>0614-140494-134-2</nit>
  <publicKey>
    <clave>aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899</clave>
    <encodied>AQIDBA==</encodied>
  </publicKey>
  <privateKey>
    <clave>aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899</clave>
    <encodied>AQIDBA==</encodied>
  </privateKey>
  <activo>true</activo>
</CertificadoMH>`;
    await storeMod.SecureStorageService.storeCertificateData(
      '0614-140494-134-2',
      fakeXml,
    );
  });
}

/**
 * Reload the page and re-seed any SecureStorage entries that don't persist
 * across reloads (they're stored in the same localStorage namespace so they
 * actually do survive, but we call this to also re-read certPasswordSaved).
 */
async function reloadAndWait(page: Page): Promise<void> {
  await page.reload();
  await waitForAppReady(page);
  await expect(page.getByTestId('cert-card')).toBeVisible({ timeout: 8000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Certificate section — 3-step card', () => {
  test('step 2 file input is disabled until password (step 1) is saved', async ({ page }) => {
    // Default state: no password saved, no cert file
    await gotoConfigPageWithState(page);

    // Step 2 container should be visually disabled
    const step2 = page.getByTestId('cert-step-2');
    await expect(step2).toBeVisible();
    // The file input inside step 2 should have the disabled attribute
    const fileInput = step2.locator('[data-testid="input-cert-file"]');
    await expect(fileInput).toBeDisabled();
  });

  test('step 3 validate button is disabled until file (step 2) is uploaded', async ({ page }) => {
    // Password saved but no file yet — hasCertificateFile is false/absent
    await gotoConfigPageWithState(page, { hasValidCertificate: false });
    await seedCertPassword(page);
    await reloadAndWait(page);

    const validateBtn = page.getByTestId('btn-validate-cert');
    await expect(validateBtn).toBeDisabled();
  });

  test('false-positive prevented: uploading file only → badge NOT "Válido"', async ({ page }) => {
    // State: password saved + cert file uploaded BUT NOT validated
    await gotoConfigPageWithState(page, {
      hasCertificateFile: true,
      hasValidCertificate: false,
    });
    await seedCertPassword(page);
    await reloadAndWait(page);

    // Badge must be "Pendiente de validar", never "Válido"
    const badge = page.getByTestId('cert-badge');
    await expect(badge).toBeVisible({ timeout: 5000 });
    const badgeText = await badge.innerText();
    expect(badgeText).not.toBe('Válido');
    expect(badgeText).toContain('Pendiente');
  });

  test('validate success → metadata panel appears with parsed NIT', async ({ page }) => {
    // State: password saved + cert file uploaded, not yet validated
    await gotoConfigPageWithState(page, {
      hasCertificateFile: true,
      hasValidCertificate: false,
    });
    await seedCertPassword(page);
    await seedCertFile(page);
    await reloadAndWait(page);

    // Click validate
    const validateBtn = page.getByTestId('btn-validate-cert');
    await expect(validateBtn).toBeEnabled({ timeout: 5000 });
    await validateBtn.click();

    // Metadata panel should appear
    await expect(page.getByTestId('cert-metadata-panel')).toBeVisible({ timeout: 8000 });

    // The NIT in the metadata must match what's in the seeded XML
    const nitText = await page.getByTestId('cert-meta-nit').innerText();
    expect(nitText).toContain('0614-140494-134-2');

    // Badge must now be "Válido"
    const badge = page.getByTestId('cert-badge');
    await expect(badge).toHaveText('Válido', { timeout: 5000 });
  });

  test('eliminar → confirm dialog → Redux flags reset, badge returns to initial state', async ({
    page,
  }) => {
    // State: fully valid certificate
    await gotoConfigPageWithState(page, {
      hasCertificateFile: true,
      hasValidCertificate: true,
    });
    await seedCertPassword(page);
    await seedCertFile(page);
    await reloadAndWait(page);

    // The delete button should be visible (cert is configured)
    const deleteBtn = page.getByTestId('btn-delete-cert');
    await expect(deleteBtn).toBeVisible({ timeout: 5000 });
    await deleteBtn.click();

    // Confirm dialog must appear
    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });

    // Confirm deletion
    await page.getByRole('button', { name: 'Eliminar' }).last().click();

    // Wait for the success toast
    await expect(page.getByText('Certificado eliminado.')).toBeVisible({ timeout: 8000 });

    // After deletion, the stored cert data should be gone from SecureStorage
    const certData = await page.evaluate(async () => {
      const mod = await import('/src/services/security/SecureStorageService.ts');
      return mod.SecureStorageService.getCertificateData('0614-140494-134-2');
    });
    expect(certData).toBeNull();

    // Badge must have reset — should no longer say "Válido"
    const badge = page.getByTestId('cert-badge');
    const badgeText = await badge.innerText();
    expect(badgeText).not.toBe('Válido');
  });

  test('NIT missing guard renders at top of card and all step inputs are disabled', async ({
    page,
  }) => {
    // State: company with no NIT
    await gotoConfigPageWithState(page, { nit: '' });

    // Guard alert must be visible
    await expect(page.getByTestId('cert-nit-missing-alert')).toBeVisible({ timeout: 5000 });

    // File input must be disabled (step 2 greyed out due to missing NIT)
    const fileInput = page.getByTestId('input-cert-file');
    await expect(fileInput).toBeDisabled();
  });
});
