// Full route × permission matrix: every in-app route declared in src/routes.tsx
// is gated (never "open"), and each user kind sees exactly what the map grants.
// A new route added without a permission entry fails here instead of silently
// becoming reachable by every restricted user.

import { readFileSync } from 'fs';
import { join } from 'path';
import { ALL_PERMISSIONS, SCREEN_PERMISSIONS, canAccessPath, routeAccess } from '@/services/localUsers/permissions';
import type { LocalUser, ScreenPermission } from '@/types/localUsers';

const OUTSIDE_APP_SHELL = new Set(['/welcome', '/onboarding', '*']);

const routes = Array.from(
  readFileSync(join(__dirname, '../../routes.tsx'), 'utf8').matchAll(/path:\s*'([^']+)'/g),
  (m) => m[1],
).filter((path) => !OUTSIDE_APP_SHELL.has(path));

// Concrete URL for a route pattern (":id" → a sample id).
const concrete = (pattern: string) => pattern.replace(/:[^/]+/g, 'sample-id');

const user = (permissions: ScreenPermission[], overrides: Partial<LocalUser> = {}): LocalUser => ({
  id: 'lu_matrix',
  displayName: 'Matriz',
  username: 'matriz',
  role: 'user',
  ownerEmail: 'owner@gmail.com',
  pinHash: 'x',
  pinSalt: 'y',
  permissions,
  isActive: true,
  createdAt: '2026-10-10T00:00:00.000Z',
  updatedAt: '2026-10-10T00:00:00.000Z',
  ...overrides,
});

describe('route × permission matrix (src/routes.tsx)', () => {
  it('finds the app routes', () => {
    expect(routes.length).toBeGreaterThan(40);
    expect(routes).toContain('/invoices/:id/edit');
  });

  it.each(routes)('%s is gated by a permission or admin-only', (route) => {
    expect(routeAccess(concrete(route)).kind).not.toBe('open');
  });

  it('a user without permissions opens nothing; with every permission opens all but the admin-only screens', () => {
    const none = user([]);
    const all = user([...ALL_PERMISSIONS]);
    for (const route of routes) {
      const url = concrete(route);
      expect([route, canAccessPath(none, url)]).toEqual([route, false]);
      const adminOnly = routeAccess(url).kind === 'admin';
      expect([route, canAccessPath(all, url)]).toEqual([route, !adminOnly]);
    }
    expect(canAccessPath(all, '/settings/users')).toBe(false);
    expect(canAccessPath(all, '/settings/audit')).toBe(false);
  });

  it('the admin opens every route; an inactive admin none', () => {
    const admin = user([], { role: 'admin' });
    const inactiveAdmin = user([], { role: 'admin', isActive: false });
    for (const route of routes) {
      expect([route, canAccessPath(admin, concrete(route))]).toEqual([route, true]);
      expect([route, canAccessPath(inactiveAdmin, concrete(route))]).toEqual([route, false]);
    }
  });

  // Action permissions (pos.void) open no screen — they gate buttons inside one.
  it.each(SCREEN_PERMISSIONS)('a user holding only "%s" opens exactly the routes mapped to it', (permission) => {
    const only = user([permission]);
    const opened = routes.filter((route) => canAccessPath(only, concrete(route)));
    expect(opened.length).toBeGreaterThan(0);
    for (const route of routes) {
      const access = routeAccess(concrete(route));
      const expected = access.kind === 'permission' && access.permission === permission;
      expect([route, canAccessPath(only, concrete(route))]).toEqual([route, expected]);
    }
  });

  it.each(['pos.void', 'pos.return', 'pos.cash'] as const)('a user holding only the "%s" action permission opens no route', (action) => {
    const onlyAction = user([action]);
    for (const route of routes) {
      expect([route, canAccessPath(onlyAction, concrete(route))]).toEqual([route, false]);
    }
  });
});
