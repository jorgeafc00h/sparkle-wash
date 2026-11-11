import { Page } from '@playwright/test';
import { seedPopulatedAppState, waitForAppReady } from '../fixtures/seed-state';

export { waitForAppReady };

/**
 * Navigate to a sidebar item by name.
 * testId must match the data-testid on the NavLink in Sidebar.tsx.
 */
export async function navigateToTab(
  page: Page,
  name:
    | 'inicio'
    | 'facturas'
    | 'clientes'
    | 'productos'
    | 'compras'
    | 'libros-iva'
    | 'catalogos'
    | 'configuracion'
    | 'perfil'
    | 'chat',
  timeout = 15000,
): Promise<void> {
  const testId = `sidebar-${name}`;
  await page.getByTestId(testId).click({ timeout });
  // Brief wait for navigation
  await page.waitForTimeout(300);
}

/**
 * Seed populated state, navigate to /, wait for ready, then navigate to a tab.
 */
export async function seedAndNavigate(
  page: Page,
  tab: Parameters<typeof navigateToTab>[1],
): Promise<void> {
  await seedPopulatedAppState(page);
  await navigateToTab(page, tab);
}

/**
 * Wait for a toast notification with specific text.
 */
export async function waitForToast(page: Page, text: string, timeout = 8000): Promise<void> {
  await page.getByText(text).waitFor({ state: 'visible', timeout });
}

/**
 * Fill an input by its label text (FormField uses label elements).
 */
export async function fillByLabel(page: Page, label: string, value: string): Promise<void> {
  const input = page.getByLabel(label, { exact: false });
  await input.first().click();
  await input.first().fill(value);
}
