/**
 * Local users (internal user control) + local audit trail.
 *
 * The Gmail account that enables user control becomes the admin; the users it
 * creates unlock the app with a PIN. Screens a user can't open stay in the
 * sidebar as DISABLED tabs (lock + tooltip, not clickable) and typing their URL
 * shows "Acceso restringido". Everything users create/modify is credited to them
 * in the local audit trail.
 */

import { test, expect, type Page } from '@playwright/test';
import { seedProUserWithGoogleAuth, PRO_USER } from '../../fixtures/pro-state';

const ADMIN_PIN = '1234';

type Preset = 'cajero' | 'facturacion' | 'contador';

async function enableUserControl(page: Page) {
  await seedProUserWithGoogleAuth(page);
  await page.goto('/#/settings/users');
  await expect(page.getByTestId('local-users-intro')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('local-users-owner-email')).toHaveText(PRO_USER.email);
  await page.getByTestId('btn-enable-local-users').click();
  await page.getByTestId('pin-set-pin').fill(ADMIN_PIN);
  await page.getByTestId('pin-set-confirm').fill(ADMIN_PIN);
  await page.getByTestId('pin-set-save').click();
  await expect(page.getByTestId('local-users-owner')).toBeVisible();
}

/** Creates a user from the Usuarios page with a preset or an explicit permission list. */
async function createUser(page: Page, name: string, pin: string, access: Preset | string[]) {
  await page.getByTestId('btn-new-local-user').click();
  await expect(page.getByTestId('user-form')).toBeVisible();
  await page.getByTestId('user-form-name').fill(name);
  await page.getByTestId('user-form-pin').fill(pin);
  await page.getByTestId('user-form-pin-confirm').fill(pin);
  if (typeof access === 'string') {
    await page.getByTestId(`user-form-preset-${access}`).click();
  } else {
    await page.getByTestId('user-form-preset-none').click();
    for (const permission of access) await page.getByTestId(`user-form-perm-${permission}`).check();
  }
  await page.getByTestId('user-form-save').click();
  await expect(page.getByTestId('user-form')).toBeHidden();
}

async function switchUser(page: Page) {
  await page.getByTestId('sidebar-switch-user').click();
  await expect(page.getByTestId('local-lock-screen')).toBeVisible();
}

async function signIn(page: Page, username: string, pin: string) {
  await expect(page.getByTestId('local-lock-screen')).toBeVisible();
  const card = page.getByTestId(`lock-user-${username}`);
  if (await card.isVisible()) {
    await card.click();
  } else if (await page.getByTestId('lock-change-user').isVisible()) {
    await page.getByTestId('lock-change-user').click();
    await page.getByTestId(`lock-user-${username}`).click();
  }
  await page.getByTestId('lock-pin-input').fill(pin);
  await page.getByTestId('lock-submit').click();
  await expect(page.getByTestId('local-lock-screen')).toBeHidden();
}

async function expectTabDisabled(page: Page, testId: string) {
  const tab = page.getByTestId(testId);
  await expect(tab).toBeVisible();
  await expect(tab).toHaveAttribute('aria-disabled', 'true');
  await expect(tab).toHaveAttribute('data-locked', 'permission');
  await expect(tab).toHaveAttribute('title', /Sin permiso/);
}

async function expectTabEnabled(page: Page, testId: string) {
  const tab = page.getByTestId(testId);
  await expect(tab).toBeVisible();
  await expect(tab).not.toHaveAttribute('aria-disabled', 'true');
}

async function openAuditLogFor(page: Page, userLabel: string) {
  await page.goto('/#/settings/audit');
  await expect(page.getByTestId('audit-log-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Historial de actividad', level: 1 })).toBeVisible();
  await page.getByTestId('audit-filter-user').selectOption({ label: userLabel });
  return page.getByTestId('audit-row-summary');
}

test.describe('Local users — user control linked to the Gmail admin', () => {
  // The flows sign in/out several times through the real UI.
  test.describe.configure({ timeout: 60_000 });

  test('the signed-in Gmail account becomes the admin with full access', async ({ page }) => {
    await enableUserControl(page);

    const adminRow = page.getByTestId('local-user-row-pro');
    await expect(adminRow).toContainText('Pro Usuario');
    await expect(adminRow).toContainText('Administrador');
    await expect(page.getByTestId('local-user-access-pro')).toHaveText('Todas las pantallas');
    await expect(page.getByTestId('btn-open-audit-log')).toHaveText('Historial de actividad');
    await expect(page.getByTestId('sidebar-local-user-name')).toHaveText('Pro Usuario');
    // The admin keeps every tab enabled, including user management.
    for (const id of ['sidebar-inicio', 'sidebar-facturas', 'sidebar-pos-nueva-venta', 'sidebar-empresas', 'sidebar-configuracion', 'sidebar-usuarios']) {
      await expectTabEnabled(page, id);
    }
  });

  test('the app starts locked after a restart and the admin unlocks with the PIN', async ({ page }) => {
    await enableUserControl(page);
    // Let redux-persist flush the directory, then "restart".
    await page.waitForTimeout(500);
    await page.reload();
    await expect(page.getByTestId('local-lock-screen')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('sidebar-inicio')).toHaveCount(0);

    await page.getByTestId('lock-pin-input').fill('9999');
    await page.getByTestId('lock-submit').click();
    await expect(page.getByTestId('lock-error')).toContainText('PIN incorrecto');

    await page.getByTestId('lock-pin-input').fill(ADMIN_PIN);
    await page.getByTestId('lock-submit').click();
    await expectTabEnabled(page, 'sidebar-inicio');
  });

  test('the 5-attempt PIN cooldown survives a reload (Ctrl+R used to reset it)', async ({ page }) => {
    await enableUserControl(page);
    await page.waitForTimeout(500);
    await page.reload();
    await expect(page.getByTestId('local-lock-screen')).toBeVisible({ timeout: 10_000 });

    for (let i = 0; i < 5; i += 1) {
      await page.getByTestId('lock-pin-input').fill('9999');
      await page.getByTestId('lock-submit').click();
    }
    await expect(page.getByTestId('lock-error')).toContainText('Demasiados intentos');

    await page.waitForTimeout(500);
    await page.reload();
    await expect(page.getByTestId('local-lock-screen')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('lock-error')).toContainText('Demasiados intentos');
    // No PIN can be entered while cooling down.
    await expect(page.getByTestId('lock-pin-input')).toBeDisabled();
    await expect(page.getByTestId('lock-submit')).toBeDisabled();
  });

  test('a cashier sees restricted screens as disabled tabs and their work is credited to them', async ({ page }) => {
    await enableUserControl(page);
    await createUser(page, 'Ana Cajera', '5555', 'cajero');
    await expect(page.getByTestId('local-user-row-ana')).toBeVisible();
    await expect(page.getByTestId('local-user-access-ana')).toContainText('Nueva venta');

    await switchUser(page);
    await page.getByTestId('lock-user-ana').click();
    await page.getByTestId('lock-pin-input').fill('0000');
    await page.getByTestId('lock-submit').click();
    await expect(page.getByTestId('lock-error')).toContainText('PIN incorrecto');
    await page.getByTestId('lock-pin-input').fill('5555');
    await page.getByTestId('lock-submit').click();

    // No dashboard permission → lands on the register (the admin locked on Usuarios).
    await expect(page).toHaveURL(/#\/pos$/);
    await expect(page.getByTestId('sidebar-local-user-name')).toHaveText('Ana Cajera');
    for (const id of ['sidebar-pos-nueva-venta', 'sidebar-pos-tickets', 'sidebar-clientes']) {
      await expectTabEnabled(page, id);
    }
    for (const id of ['sidebar-inicio', 'sidebar-facturas', 'sidebar-productos', 'sidebar-pos-cierre', 'sidebar-empresas', 'sidebar-configuracion', 'sidebar-perfil', 'sidebar-usuarios']) {
      await expectTabDisabled(page, id);
    }
    // A disabled tab is not a link: clicking it goes nowhere.
    await page.getByTestId('sidebar-facturas').click();
    await expect(page).toHaveURL(/#\/pos$/);

    // Typing a blocked URL shows "Acceso restringido", never the screen.
    for (const path of ['/#/invoices', '/#/settings/users', '/#/companies', '/#/settings/audit']) {
      await page.goto(path);
      await expect(page.getByTestId('access-denied')).toBeVisible();
    }
    await page.getByTestId('access-denied-home').click();
    await expect(page).toHaveURL(/#\/pos$/);

    // Ana registers a customer (opened by URL: a toast can cover the header button).
    await page.goto('/#/customers/add');
    await expect(page.getByTestId('customer-form')).toBeVisible({ timeout: 10_000 });
    await page.getByLabel('Nombre', { exact: false }).first().fill('Carlos');
    await page.getByLabel('Apellido', { exact: false }).first().fill('Auditado');
    await page.getByTestId('submit-customer-btn').click();
    await expect(page.getByTestId('customer-list')).toBeVisible({ timeout: 10_000 });

    // The admin sees who did it.
    await switchUser(page);
    await signIn(page, 'pro', ADMIN_PIN);
    await page.goto('/#/customers');
    await page.getByText('Auditado').first().click();
    await expect(page.getByTestId('customer-detail')).toBeVisible();
    await expect(page.getByTestId('audit-created-by')).toContainText('Creado por Ana Cajera');

    const summaries = await openAuditLogFor(page, 'Ana Cajera');
    await expect(summaries.filter({ hasText: 'Creó el cliente Carlos Auditado' })).toHaveCount(1);
    await expect(summaries.filter({ hasText: 'Intento de acceso con PIN incorrecto' })).toHaveCount(1);
    await expect(summaries.filter({ hasText: 'Inició sesión' })).toHaveCount(1);
    await expect(summaries.filter({ hasText: 'Cerró sesión' })).toHaveCount(1);
    await expect(page.getByTestId('audit-row-actor').first()).toHaveText('Ana Cajera');
  });

  test('a POS sale records the cashier on the ticket and in the activity log', async ({ page }) => {
    await enableUserControl(page);
    await createUser(page, 'Ana Cajera', '5555', 'cajero');
    await switchUser(page);
    await signIn(page, 'ana', '5555');
    await expect(page).toHaveURL(/#\/pos$/);
    // No shortcut into screens she can't open (Impresora → Configuración).
    await expect(page.getByTestId('btn-pos-printer-settings')).toHaveCount(0);

    await page.getByTestId('pos-product-prod-003').click(); // Papel Bond A4 — $5.50
    // "Excluir de Libros IVA" is an accounting call: not for a cashier.
    await expect(page.getByTestId('pos-exclude-libros')).toHaveCount(0);
    await page.getByTestId('btn-charge').click();
    await expect(page.getByTestId('payment-modal')).toBeVisible();
    await page.getByTestId('pay-cash-tendered').fill('10');
    await page.getByTestId('btn-confirm-payment').click();
    await expect(page.getByText(/Ticket #1 guardado/)).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('sidebar-pos-tickets').click();
    await expect(page.getByTestId('ticket-cashier-1')).toContainText('Cajero: Ana Cajera');
    // Voiding needs the separate "Anular tickets" permission (not in the Cajero preset).
    await expect(page.getByTestId('btn-void-ticket-1')).toBeDisabled();
    await expect(page.getByTestId('btn-void-ticket-1')).toHaveAttribute('data-locked', 'permission');
    await expect(page.getByTestId('void-ticket-hint-1')).toHaveAttribute('title', /Sin permiso para anular/);

    await switchUser(page);
    await signIn(page, 'pro', ADMIN_PIN);
    const summaries = await openAuditLogFor(page, 'Ana Cajera');
    await expect(summaries.filter({ hasText: 'Registró la venta ticket #1 por $5.50' })).toHaveCount(1);

    // The admin can always void, and sees the Libros IVA toggle.
    await page.goto('/#/pos/tickets');
    await expect(page.getByTestId('btn-void-ticket-1')).toBeEnabled();
    await page.goto('/#/pos');
    await page.getByTestId('pos-product-prod-003').click();
    await expect(page.getByTestId('pos-exclude-libros')).toBeVisible();
  });

  test('"Anular tickets" is granted separately from the Tickets screen', async ({ page }) => {
    await enableUserControl(page);
    await createUser(page, 'Beto Supervisor', '6666', ['pos.sell', 'pos.tickets', 'pos.void']);
    await expect(page.getByTestId('local-user-access-beto')).toContainText('Anular tickets');
    await switchUser(page);
    await signIn(page, 'beto', '6666');
    await page.getByTestId('pos-product-prod-003').click();
    await page.getByTestId('btn-charge').click();
    await page.getByTestId('btn-confirm-payment').click();
    await expect(page.getByText(/Ticket #1 guardado/)).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('sidebar-pos-tickets').click();
    await page.getByTestId('btn-void-ticket-1').click();
    await page.getByTestId('void-reason-input').fill('cliente se arrepintió');
    await page.getByRole('button', { name: /anular ticket/i }).click();
    await expect(page.getByTestId('ticket-row-1')).toContainText('Anulado', { timeout: 10_000 });

    await switchUser(page);
    await signIn(page, 'pro', ADMIN_PIN);
    const summaries = await openAuditLogFor(page, 'Beto Supervisor');
    await expect(summaries.filter({ hasText: 'Anuló el ticket #1' })).toHaveCount(1);
  });

  test('invoices show who created them', async ({ page }) => {
    await enableUserControl(page);
    await createUser(page, 'Luis Factura', '2468', 'facturacion');
    await switchUser(page);
    await signIn(page, 'luis', '2468');
    await expect(page.getByTestId('sidebar-local-user-name')).toHaveText('Luis Factura');
    await expectTabDisabled(page, 'sidebar-pos-nueva-venta');

    await page.getByTestId('sidebar-facturas').click();
    await expect(page.getByTestId('invoice-list')).toBeVisible();
    // Facturación can issue but not invalidate / report contingency.
    await expect(page.getByTestId('btn-contingency-list')).toHaveCount(0);
    await page.getByTestId('btn-new-invoice').click();
    await expect(page.getByTestId('add-invoice')).toBeVisible({ timeout: 8_000 });
    await page.getByText('Factura CF').click();
    await expect(page.getByText('Información General')).toBeVisible({ timeout: 5_000 });
    await page.locator('input[placeholder="Buscar cliente..."]').fill('Maria');
    await page.locator('text=Maria').first().click();
    await page.getByRole('button', { name: /Agregar/i }).click();
    await page.locator('input[placeholder^="Buscar producto"]').last().fill('Consultoría');
    await page.locator('text=Servicio de Consultoría').first().click();
    await page.getByTestId('btn-save').click();
    await expect(page.getByText('DTE creado correctamente.')).toBeVisible({ timeout: 5_000 });
    await expect(page).toHaveURL(/\/invoices$/);

    // "Creado por" column: the new draft is Luis's; seeded history has no author.
    const creators = page.getByTestId('invoice-created-by');
    await expect(creators.filter({ hasText: 'Luis Factura' })).toHaveCount(1);
    await page.getByTestId('invoice-filter-creator').selectOption({ label: 'Luis Factura' });
    await expect(page.locator('table tbody tr')).toHaveCount(1);

    await page.locator('table tbody tr').first().click();
    await expect(page.getByTestId('invoice-detail')).toBeVisible();
    await expect(page.getByTestId('audit-created-by')).toContainText('Creado por Luis Factura');
  });

  test('a view-only user can browse invoices but not issue, edit or invalidate them', async ({ page }) => {
    await enableUserControl(page);
    await createUser(page, 'Vera Lectora', '1122', ['invoices.view']);
    await expect(page.getByTestId('local-user-access-vera')).toHaveText('Ver facturas');
    await switchUser(page);
    await signIn(page, 'vera', '1122');

    // Only screen granted → lands on the DTE list.
    await expect(page).toHaveURL(/#\/invoices$/);
    await expectTabEnabled(page, 'sidebar-facturas');
    await expectTabDisabled(page, 'sidebar-inicio');
    await expectTabDisabled(page, 'sidebar-clientes');
    await expect(page.getByTestId('btn-new-invoice')).toHaveCount(0);
    await expect(page.getByTestId('btn-contingency-list')).toHaveCount(0);
    await expect(page.locator('[data-testid^="checkbox-"]')).toHaveCount(0);

    // A completed seeded document: viewing yes, invalidating/linked docs no.
    await page.locator('table tbody tr').first().click();
    await expect(page.getByTestId('invoice-detail')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Evento de invalidación' })).toHaveCount(0);
    await expect(page.getByTestId('btn-actions-menu')).toHaveCount(0);
    await expect(page.getByTestId('btn-delete-invoice')).toHaveCount(0);

    for (const path of ['/#/invoices/add', '/#/invoices/contingency', '/#/invoices/export']) {
      await page.goto(path);
      await expect(page.getByTestId('access-denied')).toBeVisible();
    }
  });

  test('settings cards and the Usuarios tab are disabled for non-admins', async ({ page }) => {
    await enableUserControl(page);
    await createUser(page, 'Sofia Config', '3344', ['settings']);
    await switchUser(page);
    await signIn(page, 'sofia', '3344');

    await expect(page).toHaveURL(/#\/settings$/);
    await expectTabEnabled(page, 'sidebar-configuracion');
    await expectTabDisabled(page, 'sidebar-usuarios');
    await expectTabDisabled(page, 'sidebar-empresas');

    await expect(page.getByTestId('settings-local-users')).toBeDisabled();
    await expect(page.getByRole('button', { name: /Empresas/ }).first()).toBeDisabled();
    await expect(page.getByTestId('settings-product-categories')).toBeEnabled();
    await page.getByTestId('settings-product-categories').click();
    await expect(page.getByTestId('product-categories')).toBeVisible();
  });

  test('permission changes by the admin apply at the next sign-in, and stock edits are credited', async ({ page }) => {
    await enableUserControl(page);
    await createUser(page, 'Bodega Uno', '7788', ['products']);
    await switchUser(page);
    await signIn(page, 'bodega', '7788');
    await expect(page).toHaveURL(/#\/products$/);
    await expect(page.getByTestId('stock-adjustment-btn')).toHaveCount(0);

    // The admin grants inventory adjustments.
    await switchUser(page);
    await signIn(page, 'pro', ADMIN_PIN);
    await page.goto('/#/settings/users');
    await page.getByTestId('local-user-edit-bodega').click();
    await page.getByTestId('user-form-perm-products.stock').check();
    await page.getByTestId('user-form-save').click();
    await expect(page.getByTestId('local-user-access-bodega')).toContainText('Ajustes de inventario');

    await switchUser(page);
    await signIn(page, 'bodega', '7788');
    await page.goto('/#/products');
    await page.getByTestId('stock-adjustment-btn').click();
    await expect(page.getByTestId('stock-adjustment-page')).toBeVisible({ timeout: 10_000 });
    await page.getByLabel('Ajuste para Laptop Dell Inspiron').fill('-3');
    await page.getByTestId('save-stock-btn').click();
    await expect(page.getByText('Se actualizaron 1 producto')).toBeVisible({ timeout: 5_000 });

    await page.goto('/#/products');
    await page.getByText('Laptop Dell Inspiron').first().click();
    await expect(page.getByTestId('product-detail')).toBeVisible();
    await expect(page.getByTestId('audit-updated-by')).toContainText('Última modificación por Bodega Uno');

    await switchUser(page);
    await signIn(page, 'pro', ADMIN_PIN);
    const summaries = await openAuditLogFor(page, 'Bodega Uno');
    await expect(summaries.filter({ hasText: 'Ajustó inventario: 10 → 7' })).toHaveCount(1);
    const adminSummaries = await openAuditLogFor(page, 'Pro Usuario');
    await expect(adminSummaries.filter({ hasText: 'Cambió los permisos' })).toHaveCount(1);
  });

  test('deactivated users disappear from the lock screen', async ({ page }) => {
    await enableUserControl(page);
    await createUser(page, 'Temporal Uno', '1357', 'contador');
    await page.getByTestId('local-user-toggle-temporal').click();
    await expect(page.getByTestId('local-user-row-temporal')).toContainText('Inactivo');

    await switchUser(page);
    // Only the admin is left, so the lock screen goes straight to the PIN.
    await expect(page.getByTestId('lock-user-temporal')).toHaveCount(0);
    await expect(page.getByTestId('lock-pin-input')).toBeVisible();
  });

  test('turning user control off restores single-user mode', async ({ page }) => {
    await enableUserControl(page);
    await createUser(page, 'Ana Cajera', '5555', 'cajero');
    await page.getByTestId('btn-disable-local-users').click();
    await page.getByTestId('confirm-disable-local-users').click();
    await expect(page.getByTestId('local-users-intro')).toBeVisible();
    await expect(page.getByTestId('sidebar-local-user')).toHaveCount(0);

    // No PIN after a restart and every tab is open again.
    await page.waitForTimeout(500);
    await page.reload();
    await expectTabEnabled(page, 'sidebar-inicio');
    await expect(page.getByTestId('local-lock-screen')).toHaveCount(0);
    for (const id of ['sidebar-facturas', 'sidebar-empresas', 'sidebar-configuracion', 'sidebar-usuarios']) {
      await expectTabEnabled(page, id);
    }
    await page.goto('/#/invoices');
    await expect(page.getByTestId('invoice-list')).toBeVisible();
    // The invoice list's creator filter only exists while user control is on.
    await expect(page.getByTestId('invoice-filter-creator')).toHaveCount(0);
  });
});
