/**
 * Registering a production company's own Hacienda material — the iOS flow.
 *
 * After homologation Hacienda issues production credentials: an API password
 * and a signing certificate (.crt) with its own password. The TEST and
 * PRODUCTION companies share a NIT, and Desktop used to key all three by NIT
 * only, so registering production overwrote the test company and the promoted
 * company silently reused the test ones. Hacienda's .crt also carries the NIT
 * as digits, which the upload refused for a company NIT typed with dashes.
 *
 * Drives the real UI end to end: real .crt uploads (digits-only NIT), the
 * 3-step certificate card and "Validar y guardar" against the mock MH client.
 */

import { createHash } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { seedPopulatedAppState, waitForAppReady } from '../../fixtures/seed-state';

const COMPANY_NIT = '0614-140494-134-2';
const sha512 = (text: string) => createHash('sha512').update(text).digest('hex');
const TEST_CERT_PWD = 'Pruebas-2026';
const PROD_CERT_PWD = 'Produccion-2026';
const TEST_KEY = Buffer.from('test-private-key').toString('base64');
const PROD_KEY = Buffer.from('prod-private-key').toString('base64');

const crt = (password: string, key: string) => ({
  name: '06141404941342.crt',
  mimeType: 'application/xml',
  buffer: Buffer.from(`<?xml version="1.0"?>
<CertificadoMH>
  <_id>${key.slice(0, 8)}</_id>
  <nit>06141404941342</nit>
  <publicKey><clave>pub</clave><encodied>AQIDBA==</encodied></publicKey>
  <privateKey><clave>${sha512(password)}</clave><encodied>${key}</encodied></privateKey>
  <activo>true</activo>
</CertificadoMH>`),
});

async function openSection(page: Page, companyId: string, section: string) {
  await page.goto(`/#/companies/${companyId}/config?section=${section}`);
  await waitForAppReady(page);
}

async function registerCertificate(page: Page, password: string, key: string) {
  const changeLink = page.getByTestId('cert-change-password-link');
  if (await changeLink.isVisible()) await changeLink.click();
  await page.getByTestId('input-cert-password').fill(password);
  await page.getByTestId('input-cert-password-confirm').fill(password);
  await page.getByTestId('btn-save-cert-password').click();
  await expect(page.getByTestId('cert-change-password-link')).toBeVisible({ timeout: 5000 });

  await page.getByTestId('input-cert-file').setInputFiles(crt(password, key));
  await page.getByTestId('btn-save-cert-file').click();
  await expect(page.getByTestId('cert-badge')).toHaveText('Pendiente de validar', { timeout: 5000 });

  await page.getByTestId('btn-validate-cert').click();
  await expect(page.getByTestId('cert-badge')).toHaveText('Válido', { timeout: 5000 });
}

async function registerApiPassword(page: Page, password: string) {
  await page.getByTestId('input-cred-password').fill(password);
  await page.getByTestId('btn-save-credentials').click();
  await expect(page.getByTestId('credentials-status')).toHaveAttribute('data-state', 'saved', { timeout: 8000 });
}

const stored = (page: Page) =>
  page.evaluate((nit) => {
    const get = (k: string) => window.localStorage.getItem(`secure:${k}`) ?? window.localStorage.getItem(k);
    // Certificates are keyed by the digits-only NIT (what every signer looks
    // up); credentials still by the NIT as typed.
    const digits = nit.replace(/\D/g, '');
    return {
      testCertPwd: get(`cert_password_${digits}`),
      prodCertPwd: get(`cert_password_prod_${digits}`),
      testCert: get(`cert_data_${digits}`),
      prodCert: get(`cert_data_prod_${digits}`),
      testApi: get(`company_creds_${nit}`),
      prodApi: get(`company_creds_prod_${nit}`),
    };
  }, COMPANY_NIT);

test.describe('Production company — registering its own Hacienda credentials and certificate', () => {
  test('production gets its own API password, certificate and certificate password; test is untouched', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('__mock_mh_api', 'true'));
    await seedPopulatedAppState(page);

    // TEST company (dashed NIT) with Hacienda's digits-only certificate.
    await openSection(page, '1', 'cert');
    await registerCertificate(page, TEST_CERT_PWD, TEST_KEY);
    await openSection(page, '1', 'credentials');
    await registerApiPassword(page, 'api-pruebas');

    // Promote.
    await openSection(page, '1', 'env');
    await page.getByTestId('btn-promote-production').click();
    await page.getByRole('dialog').getByRole('button', { name: /Promover/ }).click();
    await expect(page).toHaveURL(/\/companies\/(?!1\b)[^/]+\/config/, { timeout: 10000 });
    const prodId = page.url().match(/\/companies\/([^/]+)\/config/)![1];

    // The promoted company starts on the test material and says so.
    await openSection(page, prodId, 'cert');
    await expect(page.getByTestId('cert-inherited')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('cert-badge')).toHaveText('Falta archivo');

    // Register the production certificate + its password.
    await registerCertificate(page, PROD_CERT_PWD, PROD_KEY);
    await expect(page.getByTestId('cert-inherited')).toHaveCount(0);

    // Register the production API password.
    await openSection(page, prodId, 'credentials');
    await expect(page.getByTestId('credentials-inherited')).toBeVisible({ timeout: 5000 });
    await registerApiPassword(page, 'api-produccion');
    await expect(page.getByTestId('credentials-inherited')).toHaveCount(0);

    const keys = await stored(page);
    expect(keys.testCertPwd).toBe(sha512(TEST_CERT_PWD));
    expect(keys.prodCertPwd).toBe(sha512(PROD_CERT_PWD));
    expect(keys.testCert).toContain(TEST_KEY);
    expect(keys.prodCert).toContain(PROD_KEY);
    expect(JSON.parse(keys.testApi!).password).toBe('api-pruebas');
    expect(JSON.parse(keys.prodApi!).password).toBe('api-produccion');

    // The test company still validates its own certificate. (No reload here:
    // the seed init script would re-inject a state without the production
    // company; the restart path is covered by companyCertificateEnvironment.test.ts.)
    await openSection(page, prodId, 'cert');
    await expect(page.getByTestId('cert-badge')).toHaveText('Válido', { timeout: 8000 });
    await openSection(page, '1', 'cert');
    await page.getByTestId('btn-validate-cert').click();
    await expect(page.getByTestId('cert-badge')).toHaveText('Válido', { timeout: 5000 });
    await expect(page.getByTestId('cert-validation-error')).toHaveCount(0);
  });

  test("a certificate for another NIT is still refused", async ({ page }) => {
    await seedPopulatedAppState(page);
    await openSection(page, '1', 'cert');
    await page.getByTestId('input-cert-password').fill(TEST_CERT_PWD);
    await page.getByTestId('input-cert-password-confirm').fill(TEST_CERT_PWD);
    await page.getByTestId('btn-save-cert-password').click();
    const other = crt(TEST_CERT_PWD, TEST_KEY);
    other.buffer = Buffer.from(other.buffer.toString().replace('<nit>06141404941342</nit>', '<nit>06149999999999</nit>'));
    await page.getByTestId('input-cert-file').setInputFiles(other);
    await page.getByTestId('btn-save-cert-file').click();
    await expect(page.locator('[role="alert"]').first()).toContainText('El certificado pertenece al NIT 06149999999999', { timeout: 5000 });
    await expect(page.getByTestId('cert-badge')).toHaveText('Falta archivo');
  });
});
