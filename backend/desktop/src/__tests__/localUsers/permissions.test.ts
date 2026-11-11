// Local users — route → permission map and access checks.

import {
  ACTION_PERMISSIONS,
  ALL_PERMISSIONS,
  PERMISSION_PRESETS,
  SCREEN_PERMISSIONS,
  canAccessPath,
  firstAllowedRoute,
  hasPermission,
  matchRoute,
  normalizePermissions,
  routeAccess,
} from '@/services/localUsers/permissions';
import type { LocalUser, ScreenPermission } from '@/types/localUsers';

const user = (permissions: ScreenPermission[], overrides: Partial<LocalUser> = {}): LocalUser => ({
  id: 'lu_test',
  displayName: 'María',
  username: 'maria',
  role: 'user',
  ownerEmail: 'owner@gmail.com',
  pinHash: 'x',
  pinSalt: 'y',
  permissions,
  isActive: true,
  createdAt: '2026-10-07T00:00:00.000Z',
  updatedAt: '2026-10-07T00:00:00.000Z',
  ...overrides,
});

describe('matchRoute', () => {
  it('matches params and splats without matching the bare prefix', () => {
    expect(matchRoute('/invoices/:id/edit', '/invoices/abc/edit')).toBe(true);
    expect(matchRoute('/invoices/:id/edit', '/invoices/abc')).toBe(false);
    expect(matchRoute('/invoices/*', '/invoices/abc')).toBe(true);
    expect(matchRoute('/invoices/*', '/invoices')).toBe(false);
    expect(matchRoute('/pos', '/pos/')).toBe(true);
    expect(matchRoute('/pos', '/pos/tickets')).toBe(false);
  });
});

describe('routeAccess', () => {
  it.each([
    ['/home', 'dashboard'],
    ['/invoices', 'invoices.view'],
    ['/invoices/inv_1', 'invoices.view'],
    ['/invoices/add', 'invoices.create'],
    ['/invoices/inv_1/edit', 'invoices.create'],
    ['/invoices/inv_1/invalidate', 'invoices.invalidate'],
    ['/invoices/contingency', 'invoices.invalidate'],
    ['/invoices/export', 'invoices.export'],
    ['/invoices/libros-iva', 'librosIva'],
    ['/products/stock-adjustment', 'products.stock'],
    ['/products/p1/edit', 'products'],
    ['/pos', 'pos.sell'],
    ['/pos/tickets', 'pos.tickets'],
    ['/pos/closing', 'pos.closing'],
    ['/pos/consolidate', 'pos.consolidate'],
    ['/compras/c1', 'compras'],
    ['/accounts', 'accounts'],
    ['/companies/1/config', 'companies'],
    ['/settings/catalogs/CAT-012', 'catalogs'],
    ['/settings/profile', 'account'],
    ['/settings/account/change-card', 'account'],
    ['/settings/printer', 'settings'],
    ['/settings', 'settings'],
    ['/chat', 'chat'],
  ])('%s requires %s', (path, permission) => {
    expect(routeAccess(path)).toEqual({ kind: 'permission', permission });
  });

  it('user management and the activity log are admin-only', () => {
    expect(routeAccess('/settings/users')).toEqual({ kind: 'admin' });
    expect(routeAccess('/settings/audit')).toEqual({ kind: 'admin' });
  });

  it('every screen permission key is reachable from some route', () => {
    const reachable = new Set<string>();
    for (const path of [
      '/home', '/invoices', '/invoices/add', '/invoices/contingency', '/invoices/export', '/invoices/libros-iva',
      '/customers', '/products', '/products/stock-adjustment', '/carwash', '/pos', '/pos/tickets', '/pos/closing',
      '/pos/consolidate', '/compras', '/accounts', '/settings/catalogs', '/companies', '/settings',
      '/settings/profile', '/chat',
    ]) {
      const access = routeAccess(path);
      if (access.kind === 'permission') reachable.add(access.permission);
    }
    expect([...reachable].sort()).toEqual([...SCREEN_PERMISSIONS].sort());
  });

  it('action permissions (pos.void) map to no route and complete the catalog', () => {
    expect(ACTION_PERMISSIONS).toEqual(['pos.void', 'pos.return', 'pos.cash']);
    expect([...SCREEN_PERMISSIONS, ...ACTION_PERMISSIONS].sort()).toEqual([...ALL_PERMISSIONS].sort());
    for (const path of ['/pos', '/pos/tickets', '/pos/closing', '/pos/consolidate']) {
      const access = routeAccess(path);
      expect(access.kind === 'permission' && access.permission).not.toBe('pos.void');
    }
  });
});

describe('pos.void (Anular tickets)', () => {
  it('the Cajero preset cannot void; the admin always can; it must be granted explicitly', () => {
    const cajero = PERMISSION_PRESETS.find((preset) => preset.id === 'cajero')!;
    expect(cajero.permissions).not.toContain('pos.void');
    expect(hasPermission(user(cajero.permissions), 'pos.void')).toBe(false);
    expect(hasPermission(user([], { role: 'admin' }), 'pos.void')).toBe(true);
    expect(hasPermission(null, 'pos.void')).toBe(true); // user control off
    expect(hasPermission(user(['pos.tickets', 'pos.void']), 'pos.void')).toBe(true);
    // Voiding does not open any extra screen.
    expect(canAccessPath(user(['pos.void']), '/pos/tickets')).toBe(false);
  });
});

describe('pos.return / pos.cash (POS Phase 2 action permissions)', () => {
  it('the Cajero preset holds neither; the admin and user-control-off always do; they open no screen', () => {
    const cajero = PERMISSION_PRESETS.find((preset) => preset.id === 'cajero')!;
    for (const action of ['pos.return', 'pos.cash'] as const) {
      expect(cajero.permissions).not.toContain(action);
      expect(hasPermission(user(cajero.permissions), action)).toBe(false);
      expect(hasPermission(user([], { role: 'admin' }), action)).toBe(true);
      expect(hasPermission(null, action)).toBe(true);
      expect(hasPermission(user(['pos.tickets', action]), action)).toBe(true);
      expect(canAccessPath(user([action]), '/pos/tickets')).toBe(false);
      expect(canAccessPath(user([action]), '/pos')).toBe(false);
    }
  });
});

describe('access checks', () => {
  it('no subject (user control off) can open everything', () => {
    expect(canAccessPath(null, '/settings/users')).toBe(true);
    expect(hasPermission(null, 'companies')).toBe(true);
  });

  it('the admin bypasses permissions and opens admin-only screens', () => {
    const admin = user([], { role: 'admin' });
    expect(canAccessPath(admin, '/companies/1/config')).toBe(true);
    expect(canAccessPath(admin, '/settings/users')).toBe(true);
  });

  it('a cashier only opens the register screens', () => {
    const cashier = user(['pos.sell', 'pos.tickets']);
    expect(canAccessPath(cashier, '/pos')).toBe(true);
    expect(canAccessPath(cashier, '/pos/tickets')).toBe(true);
    expect(canAccessPath(cashier, '/pos/closing')).toBe(false);
    expect(canAccessPath(cashier, '/invoices')).toBe(false);
    expect(canAccessPath(cashier, '/settings/users')).toBe(false);
    expect(canAccessPath(cashier, '/home')).toBe(false);
  });

  it('viewing invoices does not grant issuing them', () => {
    const viewer = user(['invoices.view']);
    expect(canAccessPath(viewer, '/invoices/inv_1')).toBe(true);
    expect(canAccessPath(viewer, '/invoices/add')).toBe(false);
    expect(canAccessPath(viewer, '/invoices/inv_1/edit')).toBe(false);
  });

  it('inactive users have no access at all', () => {
    expect(canAccessPath(user(ALL_PERMISSIONS.slice(), { isActive: false }), '/home')).toBe(false);
  });
});

describe('firstAllowedRoute', () => {
  it('lands each user on their first permitted screen', () => {
    expect(firstAllowedRoute(null)).toBe('/home');
    expect(firstAllowedRoute(user(['dashboard', 'pos.sell']))).toBe('/home');
    expect(firstAllowedRoute(user(['pos.sell', 'customers']))).toBe('/pos');
    expect(firstAllowedRoute(user(['librosIva']))).toBe('/invoices/libros-iva');
    expect(firstAllowedRoute(user([]))).toBeNull();
  });
});

describe('normalizePermissions', () => {
  it('drops unknown keys, de-duplicates and keeps catalog order', () => {
    expect(normalizePermissions(['pos.sell', 'bogus', 'dashboard', 'pos.sell'])).toEqual(['dashboard', 'pos.sell']);
  });
});
