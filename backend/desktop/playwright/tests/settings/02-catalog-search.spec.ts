import { test, expect } from '@playwright/test';
import { seedPopulatedAppState } from '../../fixtures/seed-state';
import { navigateToTab } from '../../utils/helpers';

test.describe('Settings — Catalog search', () => {
  test('catalog list search matches option code and description', async ({ page }) => {
    await seedPopulatedAppState(page);
    await navigateToTab(page, 'catalogos');

    await expect(page.getByTestId('catalogs')).toBeVisible({ timeout: 10000 });
    const search = page.getByTestId('search-bar').locator('input');

    await search.fill('Retorno');
    await expect(page.getByText('CAT-002')).toBeVisible();
    await expect(page.getByText('Tipo de Documento / Evento')).toBeVisible();

    await search.fill('Operaciones Especiales');
    await expect(page.getByText('CAT-002')).toBeVisible();
    await expect(page.getByText('CAT-023')).toBeVisible();

    await search.fill('evento');
    await expect(page.getByText('CAT-002')).toBeVisible();
    await expect(page.getByText('CAT-024')).toBeVisible();
  });
});
