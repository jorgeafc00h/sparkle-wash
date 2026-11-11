/**
 * Regression — "Actividad económica" picker closed while typing.
 *
 * Modal's open effect depended on the consumer's (inline) onClose, so every
 * keystroke in CatalogPicker's search re-ran it: focus jumped to the header
 * "Cerrar" button, typed letters were lost and the next Space/Enter closed the
 * dialog. pressSequentially fires real key events — fill() would hide the bug.
 */

import { test, expect } from '@playwright/test';
import { seedPopulatedAppState, waitForAppReady } from '../../fixtures/seed-state';

const SEARCH_PLACEHOLDER = 'Buscar por código o descripción…';

test.describe('Companies — Actividad económica picker', () => {
  test.beforeEach(async ({ page }) => {
    // CAT-019 is not seeded: force CatalogService onto the bundled catalogs.json.
    await page.route(/\/catalog(\?|$)/i, (route) => route.abort());
    await seedPopulatedAppState(page);
    await page.goto('/#/companies/1/config?section=activity');
    await waitForAppReady(page);
  });

  test('typing a multi-word search keeps the dialog open and focused', async ({ page }) => {
    const trigger = page.getByRole('button', { name: /45209/ });
    await trigger.click();

    const dialog = page.getByRole('dialog');
    const search = dialog.getByPlaceholder(SEARCH_PLACEHOLDER);
    await expect(dialog).toBeVisible();
    await expect(search).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Cerrar' })).not.toBeFocused();

    await search.pressSequentially('venta de', { delay: 40 });
    await expect(dialog).toBeVisible();
    await expect(search).toBeFocused();
    await expect(search).toHaveValue('venta de');

    await page.keyboard.press('Enter');
    await search.pressSequentially(' vehículos', { delay: 40 });
    await expect(dialog).toBeVisible();
    await expect(search).toHaveValue('venta de vehículos');

    await dialog.getByRole('button', { name: /45100/ }).click();
    await expect(dialog).toBeHidden();
    const updated = page.getByRole('button', { name: /45100 — Venta de vehículos automotores/ });
    await expect(updated).toBeVisible();
    // Focus returns to the trigger, not lost to <body>.
    await expect(updated).toBeFocused();
  });

  test('Escape still closes the picker and clears the search', async ({ page }) => {
    await page.getByRole('button', { name: /45209/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder(SEARCH_PLACEHOLDER).pressSequentially('moto');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // Selection unchanged.
    await expect(page.getByRole('button', { name: /45209/ })).toBeVisible();

    await page.getByRole('button', { name: /45209/ }).click();
    await expect(page.getByRole('dialog').getByPlaceholder(SEARCH_PLACEHOLDER)).toHaveValue('');
  });
});
