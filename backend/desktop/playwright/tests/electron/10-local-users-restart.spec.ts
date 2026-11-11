/**
 * Local users — real Electron restart (openspec add-local-users).
 *
 * The web suite covers the UI; this spec proves what only the desktop shell can:
 * the user directory survives an app restart through Electron's app-storage.json
 * (the IPC-backed redux-persist storage), the active session does NOT (the app
 * comes back locked), and the file on disk holds PIN hashes, never PINs.
 * Mock MH — nothing here talks to Hacienda.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  closeElectron,
  launchElectron,
  relaunchElectron,
  type ElectronAppHandle,
} from '../../fixtures/electron-launch';
import { PRO_USER, GOOGLE_USER } from '../../fixtures/pro-state';
import { TEST_COMPANY } from '../../fixtures/seed-state';

const persist = (value: Record<string, unknown>) => {
  const encoded: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) encoded[k] = JSON.stringify(v);
  encoded._persist = JSON.stringify({ version: -1, rehydrated: true });
  return JSON.stringify(encoded);
};

// Signed in with Google — the account that becomes the local admin.
const GOOGLE_AUTH = persist({
  user: PRO_USER,
  isAuthenticated: true,
  isGuestMode: false,
  hasCompletedOnboarding: true,
  loading: false,
  error: null,
  token: GOOGLE_USER.idToken,
  refreshToken: null,
  selectedCompanyId: TEST_COMPANY.id,
});

test.describe('Local users — Electron restart', () => {
  let handle: ElectronAppHandle | null = null;

  test.afterEach(async () => {
    if (handle) await closeElectron(handle);
    handle = null;
  });

  test('the user directory survives a restart, the session does not, and PINs are never stored', async () => {
    handle = await launchElectron({ mock: true, extraStorage: { 'persist:auth': GOOGLE_AUTH } });
    let { window } = handle;

    await window.evaluate(() => { window.location.hash = '#/settings/users'; });
    await expect(window.getByTestId('local-users-intro')).toBeVisible({ timeout: 30_000 });
    await window.getByTestId('btn-enable-local-users').click();
    await window.getByTestId('pin-set-pin').fill('1234');
    await window.getByTestId('pin-set-confirm').fill('1234');
    await window.getByTestId('pin-set-save').click();
    await expect(window.getByTestId('local-users-owner')).toBeVisible();

    await window.getByTestId('btn-new-local-user').click();
    await window.getByTestId('user-form-name').fill('Ana Cajera');
    await window.getByTestId('user-form-pin').fill('5555');
    await window.getByTestId('user-form-pin-confirm').fill('5555');
    await window.getByTestId('user-form-preset-cajero').click();
    await window.getByTestId('user-form-save').click();
    await expect(window.getByTestId('local-user-row-ana')).toBeVisible();

    // main.cjs flushes app-storage.json 100 ms after the last write.
    await window.waitForTimeout(1_500);
    const userDataDir = handle.userDataDir;
    await handle.app.close();

    // On disk: directory + hashes, no PINs, no active session.
    const storage = JSON.parse(readFileSync(join(userDataDir, 'app-storage.json'), 'utf-8')) as Record<string, string>;
    const localUsers = JSON.parse(storage['persist:localUsers']) as Record<string, string>;
    expect(JSON.parse(localUsers.enabled)).toBe(true);
    expect(JSON.parse(localUsers.owner).email).toBe(PRO_USER.email);
    const users = JSON.parse(localUsers.users) as Array<{ username: string; pinHash: string; ownerEmail: string }>;
    expect(users.map((user) => user.username).sort()).toEqual(['ana', 'pro']);
    expect(users.every((user) => user.ownerEmail === PRO_USER.email && /^[0-9a-f]{64}$/.test(user.pinHash))).toBe(true);
    expect(localUsers.activeUserId).toBeUndefined();
    expect(storage['persist:localUsers']).not.toMatch(/"(1234|5555)"/);
    expect(storage['persist:audit']).toContain('Creó el usuario Ana Cajera');

    // Restart: the app comes back locked.
    handle = await relaunchElectron(userDataDir);
    window = handle.window;
    await expect(window.getByTestId('local-lock-screen')).toBeVisible({ timeout: 30_000 });
    await expect(window.getByTestId('lock-user-pro')).toBeVisible();
    await window.getByTestId('lock-user-ana').click();
    await window.getByTestId('lock-pin-input').fill('5555');
    await window.getByTestId('lock-submit').click();

    await expect(window.getByTestId('sidebar-local-user-name')).toHaveText('Ana Cajera');
    await expect(window).toHaveURL(/#\/pos$/);
    await expect(window.getByTestId('sidebar-facturas')).toHaveAttribute('aria-disabled', 'true');
    await expect(window.getByTestId('sidebar-pos-nueva-venta')).not.toHaveAttribute('aria-disabled', 'true');
  });
});
