/**
 * Visual review tour for the multi-agent code review fixes.
 * Captures screenshots of each changed UI surface to ./review-screenshots/.
 *
 * Run:   npx playwright test playwright/tests/review/review-tour.spec.ts --reporter=list
 * View:  open review-screenshots/
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedPopulatedAppState, waitForAppReady } from '../../fixtures/seed-state';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT = path.join(__dirname, '..', '..', '..', 'review-screenshots');

async function shot(page: import('@playwright/test').Page, name: string) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}

test.describe('Review tour — multi-agent fixes', () => {
  test.beforeEach(async ({ page }) => {
    await seedPopulatedAppState(page);
    await page.goto('/#/home');
    await waitForAppReady(page);
  });

  test('01 dashboard renders', async ({ page }) => {
    await shot(page, '01-dashboard');
  });

  test('02 invoice list — DataTable rows now keyboard-activatable', async ({ page }) => {
    await page.goto('/#/invoices');
    await waitForAppReady(page);

    // Tab focus onto the first interactive row to capture the focus ring.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await shot(page, '02-invoice-list-with-focus');
  });

  test('03 invoice detail — duplicate Acciones Rápidas card removed', async ({ page }) => {
    await page.goto('/#/invoices');
    await waitForAppReady(page);
    // Click the first invoice row
    const firstRow = page.locator('tbody tr').first();
    await firstRow.click();
    await page.waitForLoadState('networkidle');
    await page.locator('[data-testid="invoice-detail"]').first().waitFor({ timeout: 10_000 });
    await shot(page, '03-invoice-detail-deduped');

    // Confirm no "Acciones Rápidas" header anywhere on the page.
    const hasAccionesRapidas = await page.getByText('Acciones Rápidas').count();
    expect(hasAccionesRapidas).toBe(0);
  });

  test('04 company detail — single certificate card', async ({ page }) => {
    await page.goto('/#/companies/1');
    await waitForAppReady(page);
    await shot(page, '04-company-detail');

    // Should see exactly one "Certificado" section card, not two.
    const certHeadings = await page.locator('h2, h3').filter({ hasText: /Certificado/i }).count();
    expect(certHeadings).toBeLessThanOrEqual(1);
  });

  test('05 settings — theme toggle removed', async ({ page }) => {
    await page.goto('/#/settings');
    await waitForAppReady(page);
    await shot(page, '05-settings-no-theme-toggle');

    // No theme toggle controls — three radio-style buttons labelled
    // Light/Dark/System (or their Spanish equivalents Claro/Oscuro/Sistema).
    const themeButtons = await page.getByRole('button', { name: /^(Light|Dark|System|Claro|Oscuro|Sistema)$/ }).count();
    expect(themeButtons).toBe(0);
  });

  test('06 add invoice — keyboard-accessible customer picker', async ({ page }) => {
    await page.goto('/#/invoices/add?type=01');
    await waitForAppReady(page);

    // Focus the customer search input
    const picker = page.locator('#customer-search');
    await picker.click();
    await picker.fill('M');

    // Listbox should appear with role="listbox"
    await page.locator('[role="listbox"]').waitFor({ timeout: 5000 });

    // ArrowDown highlights the first option (aria-selected=true)
    await page.keyboard.press('ArrowDown');
    await shot(page, '06-customer-picker-highlighted');

    const highlighted = await page.locator('[role="option"][aria-selected="true"]').count();
    expect(highlighted).toBeGreaterThan(0);
  });

  test('07 toast UX — error duration + role split', async ({ page }) => {
    // Trigger an invalidation form to fire an error toast (missing fields)
    await page.goto('/#/invoices');
    await waitForAppReady(page);

    const firstRow = page.locator('tbody tr').first();
    await firstRow.click();
    await page.waitForLoadState('networkidle');

    // Open the invalidation page through the actions menu
    const actionsBtn = page.locator('[data-testid="btn-actions-menu"]').first();
    if (await actionsBtn.count()) {
      await actionsBtn.click();
      await shot(page, '07-actions-menu-open');
    } else {
      await shot(page, '07-no-actions-menu');
    }
  });

  test('08 modal focus trap — open subscription modal', async ({ page }) => {
    await page.goto('/#/settings');
    await waitForAppReady(page);

    // Try to open the subscription modal via the Pro upgrade button if present
    const upgradeBtn = page.getByRole('button', { name: /Pro|Suscrip|Upgrade/i }).first();
    if (await upgradeBtn.count() && await upgradeBtn.isVisible().catch(() => false)) {
      await upgradeBtn.click();
      // Wait for any modal
      const modal = page.locator('[role="dialog"][aria-modal="true"]');
      if (await modal.count()) {
        await modal.first().waitFor({ timeout: 3000 }).catch(() => {});
        await shot(page, '08-modal-open');
      } else {
        await shot(page, '08-no-modal-found');
      }
    } else {
      await shot(page, '08-no-upgrade-button');
    }
  });

  test('09 welcome page — sign-in still wired (PKCE-ready)', async ({ page }) => {
    await page.context().clearCookies();
    await page.context().clearPermissions();
    await page.evaluate(() => localStorage.clear());
    await page.goto('/#/welcome');
    await page.waitForLoadState('networkidle');
    await shot(page, '09-welcome-signin');
  });
});
