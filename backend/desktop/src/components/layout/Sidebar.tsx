import { NavLink } from 'react-router-dom';
import {
  Home,
  FileText,
  Users,
  Package,
  ShoppingCart,
  BookOpen,
  Database,
  Settings,
  UserCircle,
  MessageCircle,
  Building2,
  Lock,
  WalletCards,
  Store,
  Receipt,
  Calculator,
  FilePlus2,
  UserCog,
  LogOut,
  Car,
} from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/store';
import { selectCurrentCompany, selectAllCompanies } from '@/store/selectors/companySelectors';
import { selectCurrentTier } from '@/store/selectors/subscriptionSelectors';
import { SubscriptionTier } from '@/services/subscription/SubscriptionTypes';
import { canUseLibrosIVA, canUsePosConsolidation } from '@/services/subscription/FeatureGate';
import { selectActiveLocalUser, selectIsLocalAdmin, selectPermissionSubject } from '@/store/selectors/localUsersSelectors';
import { lockLocalSession } from '@/store/slices/localUsersSlice';
import { hasPermission } from '@/services/localUsers/permissions';
import { UserAvatar } from '@/components/localUsers/UserAvatar';
import type { ScreenPermission } from '@/types/localUsers';
import BrandMark from '@/components/common/BrandMark';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NavItem {
  label: string;
  to: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  testId: string;
  requiresCompany?: boolean;
  /**
   * Subscription gate — if defined and returns false for the current tier,
   * the item is shown in locked state with an "upgrade" tooltip.
   */
  requiresTier?: (tier: SubscriptionTier) => boolean;
  /** Local-user screen permission — items the signed-in user can't open are hidden. */
  permission?: ScreenPermission;
  /** Only the admin (Gmail owner) sees it. */
  adminOnly?: boolean;
}

interface SidebarSection {
  title: string;
  testId: string;
  items: NavItem[];
}

// ---------------------------------------------------------------------------
// Section / nav definitions
// ---------------------------------------------------------------------------

const SECTIONS: SidebarSection[] = [
  {
    title: 'PRINCIPAL',
    testId: 'sidebar-section-principal',
    items: [
      { label: 'Inicio', to: '/home', icon: Home, testId: 'sidebar-inicio', permission: 'dashboard' },
      { label: 'Facturas', to: '/invoices', icon: FileText, testId: 'sidebar-facturas', requiresCompany: true, permission: 'invoices.view' },
      { label: 'Clientes', to: '/customers', icon: Users, testId: 'sidebar-clientes', requiresCompany: true, permission: 'customers' },
      { label: 'Productos', to: '/products', icon: Package, testId: 'sidebar-productos', requiresCompany: true, permission: 'products' },
    ],
  },
  {
    title: 'PUNTO DE VENTA',
    testId: 'sidebar-section-pos',
    items: [
      { label: 'Lavado', to: '/carwash', icon: Car, testId: 'sidebar-carwash', requiresCompany: true, permission: 'carwash' },
      { label: 'Nueva venta', to: '/pos', icon: Store, testId: 'sidebar-pos-nueva-venta', requiresCompany: true, permission: 'pos.sell' },
      { label: 'Tickets', to: '/pos/tickets', icon: Receipt, testId: 'sidebar-pos-tickets', requiresCompany: true, permission: 'pos.tickets' },
      { label: 'Cierre de caja', to: '/pos/closing', icon: Calculator, testId: 'sidebar-pos-cierre', requiresCompany: true, permission: 'pos.closing' },
      { label: 'Consolidar', to: '/pos/consolidate', icon: FilePlus2, testId: 'sidebar-pos-consolidar', requiresCompany: true, requiresTier: canUsePosConsolidation, permission: 'pos.consolidate' },
    ],
  },
  {
    title: 'DOCUMENTOS',
    testId: 'sidebar-section-documentos',
    items: [
      { label: 'Compras', to: '/compras', icon: ShoppingCart, testId: 'sidebar-compras', requiresCompany: true, permission: 'compras' },
      { label: 'Libros IVA', to: '/invoices/libros-iva', icon: BookOpen, testId: 'sidebar-libros-iva', requiresCompany: true, requiresTier: canUseLibrosIVA, permission: 'librosIva' },
    ],
  },
  {
    title: 'FINANZAS',
    testId: 'sidebar-section-finanzas',
    items: [
      { label: 'Cobros y pagos', to: '/accounts', icon: WalletCards, testId: 'sidebar-cobros-pagos', requiresCompany: true, permission: 'accounts' },
    ],
  },
  {
    title: 'CATÁLOGO',
    testId: 'sidebar-section-catalogo',
    items: [
      { label: 'Catálogos', to: '/settings/catalogs', icon: Database, testId: 'sidebar-catalogos', permission: 'catalogs' },
    ],
  },
  {
    title: 'SISTEMA',
    testId: 'sidebar-section-sistema',
    items: [
      { label: 'Empresas', to: '/companies', icon: Building2, testId: 'sidebar-empresas', permission: 'companies' },
      { label: 'Configuración', to: '/settings', icon: Settings, testId: 'sidebar-configuracion', permission: 'settings' },
      { label: 'Perfil', to: '/settings/profile', icon: UserCircle, testId: 'sidebar-perfil', permission: 'account' },
      { label: 'Chat Soporte', to: '/chat', icon: MessageCircle, testId: 'sidebar-chat', permission: 'chat' },
      { label: 'Usuarios', to: '/settings/users', icon: UserCog, testId: 'sidebar-usuarios', adminOnly: true },
    ],
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Sidebar() {
  const dispatch = useAppDispatch();
  const currentCompany = useAppSelector(selectCurrentCompany);
  const companies = useAppSelector(selectAllCompanies);
  const tier = useAppSelector(selectCurrentTier);
  const permissionSubject = useAppSelector(selectPermissionSubject);
  const isAdmin = useAppSelector(selectIsLocalAdmin);
  const activeUser = useAppSelector(selectActiveLocalUser);
  const hasCompany = companies.length > 0;

  // Local user control: screens the signed-in user can't open stay in the
  // menu as disabled tabs (lock + tooltip). The AppShell guard still blocks
  // the route itself if someone types the URL.
  const lacksPermission = (item: NavItem) =>
    item.adminOnly ? !isAdmin : !!item.permission && !hasPermission(permissionSubject, item.permission);

  const companyDisplayName =
    currentCompany?.nombreComercial || currentCompany?.nombre || 'Sin empresa';
  const isProduction =
    currentCompany?.environment?.toLowerCase() === 'production';

  return (
    <aside className="w-60 flex-shrink-0 flex flex-col h-screen bg-brand-900 border-r border-brand-800">
      {/* Logo */}
      <div className="px-5 pt-5 pb-5 border-b border-brand-800">
        <div className="flex items-center gap-2.5">
          <BrandMark size={32} className="shrink-0 rounded-lg" />
          <div>
            <p className="text-lg font-bold tracking-tight text-white leading-tight">
              Sparkle<span className="text-sky-400">Wash</span>
            </p>
            <p className="text-xs text-brand-400 mt-0.5">Lavado y facturación</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2">
        {SECTIONS.map((section) => (
          <div key={section.title} className="mb-1">
            <p
              data-testid={section.testId}
              className="px-4 pt-5 pb-2 text-[11px] font-semibold uppercase tracking-widest text-brand-500"
            >
              {section.title}
            </p>
            {section.items.map((item) => {
              const permissionLocked = lacksPermission(item);
              const companyLocked = !!item.requiresCompany && !hasCompany;
              const tierLocked = !!item.requiresTier && !item.requiresTier(tier);
              // Tier-locked items stay CLICKABLE: they open the screen's upgrade panel, which
              // carries the free-trial offer. Only permission/company locks are dead ends.
              const locked = permissionLocked || companyLocked;

              if (locked) {
                const title = permissionLocked
                  ? 'Sin permiso — pide acceso al administrador'
                  : 'Configura una empresa para habilitar esta sección';
                return (
                  <div
                    key={item.to}
                    data-testid={item.testId}
                    title={title}
                    aria-disabled="true"
                    data-locked={permissionLocked ? 'permission' : 'company'}
                    className="flex items-center gap-3 px-4 py-2.5 mx-1 rounded-md text-sm border-l-4 border-transparent text-brand-500/60 cursor-not-allowed select-none"
                  >
                    <item.icon size={18} className="text-brand-600" />
                    <span className="flex-1">{item.label}</span>
                    <Lock size={12} className="text-brand-600 shrink-0" />
                  </div>
                );
              }

              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/home'}
                  data-testid={item.testId}
                  data-locked={tierLocked ? 'tier' : undefined}
                  title={tierLocked ? 'Requiere plan de pago — inicia la prueba gratis o mejora tu plan' : undefined}
                  className={({ isActive }) =>
                    [
                      'flex items-center gap-3 px-4 py-2.5 mx-1 rounded-md text-sm transition-colors',
                      'border-l-4',
                      isActive
                        ? 'bg-white/10 border-accent-500 text-white font-medium'
                        : 'border-transparent text-brand-400 hover:bg-white/5 hover:text-brand-200',
                    ].join(' ')
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon
                        size={18}
                        className={isActive ? 'text-accent-400' : 'text-brand-500'}
                      />
                      <span className={tierLocked ? 'flex-1' : undefined}>{item.label}</span>
                      {tierLocked && <Lock size={12} className="text-brand-600 shrink-0" />}
                    </>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Local user session */}
      {activeUser && (
        <div className="border-t border-brand-800 px-4 py-3 flex items-center gap-2" data-testid="sidebar-local-user">
          <UserAvatar name={activeUser.displayName} size="sm" admin={activeUser.role === 'admin'} />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-white font-medium truncate" data-testid="sidebar-local-user-name">
              {activeUser.displayName}
            </p>
            <p className="text-[10px] text-brand-500 truncate">
              {activeUser.role === 'admin' ? 'Administrador' : `@${activeUser.username}`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => dispatch(lockLocalSession())}
            title="Cambiar de usuario / bloquear"
            aria-label="Cambiar de usuario"
            data-testid="sidebar-switch-user"
            className="p-1.5 rounded-md text-brand-400 hover:text-white hover:bg-white/10"
          >
            <LogOut size={15} />
          </button>
        </div>
      )}

      {/* Company info */}
      <div className="border-t border-brand-800 px-4 py-3 flex items-center gap-2">
        <Building2 size={16} className="text-brand-500 flex-shrink-0" />
        <p className="flex-1 text-xs text-brand-300 font-medium truncate">
          {companyDisplayName}
        </p>
        <span
          className={[
            'text-[10px] font-bold px-1.5 py-0.5 rounded text-white flex-shrink-0',
            isProduction ? 'bg-success' : 'bg-warning',
          ].join(' ')}
        >
          {isProduction ? 'PROD' : 'DEV'}
        </span>
      </div>
    </aside>
  );
}
