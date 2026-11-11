// Screen permissions for local users — the single map from routes to the
// permission that opens them. AppShell enforces it (a blocked route renders
// "Acceso restringido"), the Sidebar and Settings grid hide what a user can't
// open, and pages hide action buttons that lead to blocked routes.
//
// The admin (the Gmail owner) bypasses every check. Admin-only screens (user
// management, activity log) are not grantable.

import type { LocalUser, ScreenPermission } from '@/types/localUsers';

export interface PermissionDefinition {
  key: ScreenPermission;
  label: string;
  description: string;
  group: string;
  /**
   * 'action' = an in-page action with no route of its own (e.g. voiding a
   * ticket). Screens are opened through ROUTE_PERMISSIONS; actions are checked
   * with useCan/usePermissionCheck where the button lives.
   */
  kind?: 'screen' | 'action';
}

export const PERMISSION_GROUPS = ['Principal', 'Punto de venta', 'Documentos y finanzas', 'Sistema'] as const;

export const PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'dashboard', label: 'Inicio', description: 'Resumen de ventas y métricas', group: 'Principal' },
  { key: 'invoices.view', label: 'Ver facturas', description: 'Lista y detalle de documentos', group: 'Principal' },
  { key: 'invoices.create', label: 'Crear y editar facturas', description: 'Emitir, editar borradores y notas', group: 'Principal' },
  { key: 'invoices.invalidate', label: 'Anular y contingencia', description: 'Invalidar DTE y reportar contingencia', group: 'Principal' },
  { key: 'invoices.export', label: 'Exportar facturas', description: 'Excel, JSON y PDF por lote', group: 'Principal' },
  { key: 'customers', label: 'Clientes', description: 'Ver, crear y editar clientes', group: 'Principal' },
  { key: 'products', label: 'Productos', description: 'Ver, crear y editar productos', group: 'Principal' },
  { key: 'products.stock', label: 'Ajustes de inventario', description: 'Entradas, salidas y ajustes de stock', group: 'Principal' },
  { key: 'carwash', label: 'Lavado (órdenes de trabajo)', description: 'Tablero de lavado, nuevos servicios y tickets de trabajo', group: 'Punto de venta' },
  { key: 'pos.sell', label: 'Nueva venta', description: 'Registrar ventas en caja', group: 'Punto de venta' },
  { key: 'pos.tickets', label: 'Tickets', description: 'Historial y reimpresión', group: 'Punto de venta' },
  { key: 'pos.void', label: 'Anular tickets', description: 'Anular ventas y devolver el stock', group: 'Punto de venta', kind: 'action' },
  { key: 'pos.return', label: 'Devoluciones', description: 'Devolver productos de un ticket y reembolsar', group: 'Punto de venta', kind: 'action' },
  { key: 'pos.cash', label: 'Entradas/salidas de efectivo', description: 'Meter o sacar efectivo de la caja con un motivo', group: 'Punto de venta', kind: 'action' },
  { key: 'pos.closing', label: 'Cierre de caja', description: 'Cortes X y Z', group: 'Punto de venta' },
  { key: 'pos.consolidate', label: 'Consolidar tickets', description: 'Convertir tickets en factura', group: 'Punto de venta' },
  { key: 'compras', label: 'Compras', description: 'Registro e importación de compras', group: 'Documentos y finanzas' },
  { key: 'librosIva', label: 'Libros IVA', description: 'Libros de ventas y compras', group: 'Documentos y finanzas' },
  { key: 'accounts', label: 'Cobros y pagos', description: 'Cuentas por cobrar y por pagar', group: 'Documentos y finanzas' },
  { key: 'catalogs', label: 'Catálogos', description: 'Catálogos del Ministerio de Hacienda', group: 'Sistema' },
  { key: 'companies', label: 'Empresas', description: 'Datos, certificado y credenciales MH', group: 'Sistema' },
  { key: 'settings', label: 'Configuración', description: 'Impresora, categorías, sincronización', group: 'Sistema' },
  { key: 'account', label: 'Perfil y suscripción', description: 'Cuenta Google, plan y pagos', group: 'Sistema' },
  { key: 'chat', label: 'Chat soporte', description: 'Asistente de ayuda', group: 'Sistema' },
];

export const ALL_PERMISSIONS: readonly ScreenPermission[] = PERMISSIONS.map((p) => p.key);

/** Permissions that open a screen (every one is mapped to at least one route). */
export const SCREEN_PERMISSIONS: readonly ScreenPermission[] = PERMISSIONS.filter((p) => p.kind !== 'action').map((p) => p.key);

/** In-page action permissions (no route). The admin always holds them. */
export const ACTION_PERMISSIONS: readonly ScreenPermission[] = PERMISSIONS.filter((p) => p.kind === 'action').map((p) => p.key);

/** Quick-start permission sets for the user form. */
export const PERMISSION_PRESETS: readonly { id: string; label: string; permissions: ScreenPermission[] }[] = [
  {
    id: 'cajero',
    label: 'Cajero',
    permissions: ['carwash', 'pos.sell', 'pos.tickets', 'customers'],
  },
  {
    id: 'facturacion',
    label: 'Facturación',
    permissions: ['dashboard', 'invoices.view', 'invoices.create', 'customers', 'products'],
  },
  {
    id: 'contador',
    label: 'Contador',
    permissions: ['dashboard', 'invoices.view', 'invoices.export', 'compras', 'librosIva', 'accounts', 'catalogs'],
  },
];

/** Routes only the admin can open, regardless of permissions. */
export const ADMIN_ONLY_ROUTES = ['/settings/users', '/settings/audit'] as const;

// Ordered — the first matching pattern wins, so specific paths come before
// their `/:id` siblings (e.g. /invoices/libros-iva before /invoices/:id).
const ROUTE_PERMISSIONS: readonly [string, ScreenPermission][] = [
  ['/home', 'dashboard'],

  ['/invoices/libros-iva', 'librosIva'],
  ['/invoices/export', 'invoices.export'],
  ['/invoices/contingency', 'invoices.invalidate'],
  ['/invoices/add', 'invoices.create'],
  ['/invoices/:id/edit', 'invoices.create'],
  ['/invoices/:id/invalidate', 'invoices.invalidate'],
  ['/invoices/*', 'invoices.view'],
  ['/invoices', 'invoices.view'],

  ['/customers/*', 'customers'],
  ['/customers', 'customers'],

  ['/products/stock-adjustment', 'products.stock'],
  ['/products/*', 'products'],
  ['/products', 'products'],

  ['/carwash', 'carwash'],
  ['/pos/tickets', 'pos.tickets'],
  ['/pos/closing', 'pos.closing'],
  ['/pos/consolidate', 'pos.consolidate'],
  ['/pos', 'pos.sell'],

  ['/compras/*', 'compras'],
  ['/compras', 'compras'],
  ['/accounts', 'accounts'],

  ['/companies/*', 'companies'],
  ['/companies', 'companies'],

  ['/settings/catalogs/*', 'catalogs'],
  ['/settings/catalogs', 'catalogs'],
  ['/settings/profile', 'account'],
  ['/settings/account/*', 'account'],
  ['/settings/account', 'account'],
  ['/settings/promo', 'account'],
  ['/settings/*', 'settings'],
  ['/settings', 'settings'],

  ['/chat', 'chat'],
];

/**
 * Minimal route matcher (no router dependency, so Jest can load this module):
 * `:param` matches one segment, a trailing `/*` matches one or more segments.
 */
export function matchRoute(pattern: string, pathname: string): boolean {
  const clean = (value: string) => value.split('?')[0].replace(/\/+$/, '') || '/';
  const path = clean(pathname);
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2);
    return path.startsWith(`${prefix}/`) && path.length > prefix.length + 1;
  }
  const want = clean(pattern).split('/');
  const got = path.split('/');
  if (want.length !== got.length) return false;
  return want.every((segment, i) => (segment.startsWith(':') ? got[i].length > 0 : segment === got[i]));
}

export type RouteAccess =
  | { kind: 'open' }
  | { kind: 'admin' }
  | { kind: 'permission'; permission: ScreenPermission };

/** What a path requires. Unknown paths are open (the router sends them home). */
export function routeAccess(pathname: string): RouteAccess {
  if (ADMIN_ONLY_ROUTES.some((route) => matchRoute(route, pathname))) return { kind: 'admin' };
  for (const [pattern, permission] of ROUTE_PERMISSIONS) {
    if (matchRoute(pattern, pathname)) return { kind: 'permission', permission };
  }
  return { kind: 'open' };
}

/**
 * `null` user = user control disabled (single-user install): everything allowed.
 * Inactive users have no access at all.
 */
export function hasPermission(user: LocalUser | null | undefined, permission: ScreenPermission): boolean {
  if (!user) return true;
  if (!user.isActive) return false;
  if (user.role === 'admin') return true;
  return user.permissions.includes(permission);
}

export function canAccessPath(user: LocalUser | null | undefined, pathname: string): boolean {
  if (!user) return true;
  const access = routeAccess(pathname);
  if (access.kind === 'open') return true;
  if (access.kind === 'admin') return user.isActive && user.role === 'admin';
  return hasPermission(user, access.permission);
}

// Landing route per permission, in sidebar order — where a restricted user goes
// when the screen they asked for (usually /home) is off-limits.
const LANDING_ROUTES: readonly [ScreenPermission, string][] = [
  ['dashboard', '/home'],
  ['invoices.view', '/invoices'],
  // The register stays a cashier's landing screen; the Lavado board is one click away.
  ['pos.sell', '/pos'],
  ['carwash', '/carwash'],
  ['customers', '/customers'],
  ['products', '/products'],
  ['pos.tickets', '/pos/tickets'],
  ['pos.closing', '/pos/closing'],
  ['pos.consolidate', '/pos/consolidate'],
  ['compras', '/compras'],
  ['librosIva', '/invoices/libros-iva'],
  ['accounts', '/accounts'],
  ['invoices.export', '/invoices/export'],
  ['products.stock', '/products/stock-adjustment'],
  ['catalogs', '/settings/catalogs'],
  ['companies', '/companies'],
  ['settings', '/settings'],
  ['account', '/settings/profile'],
  ['chat', '/chat'],
];

/** First screen the user may open, or null when they have no screens at all. */
export function firstAllowedRoute(user: LocalUser | null | undefined): string | null {
  if (!user || user.role === 'admin') return '/home';
  for (const [permission, route] of LANDING_ROUTES) {
    if (hasPermission(user, permission)) return route;
  }
  return null;
}

/** Keeps only known keys, de-duplicated, in catalog order. */
export function normalizePermissions(permissions: readonly string[]): ScreenPermission[] {
  const wanted = new Set(permissions);
  return ALL_PERMISSIONS.filter((key) => wanted.has(key));
}
