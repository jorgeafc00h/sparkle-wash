import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  ShoppingCart,
  DollarSign,
  Clock,
  Plus,
  Users,
  Package,
  Building2,
  BookOpen,
  Lock,
  ChevronRight,
  LogIn,
  LogOut,
  CheckCircle,
  AlertTriangle,
  TrendingUp,
  Calendar,
  Star,
  Zap,
  WalletCards,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { Card } from '@/components/common/Card';
import { DataTable, ColumnDef } from '@/components/common/DataTable';
import { useToast } from '@/components/common/Toast';
import { useAppSelector, useAppDispatch } from '@/store';
import {
  selectAllInvoices,
  selectInvoiceStats,
  selectAllCompanies,
  selectCurrentCompany,
  selectCurrentUser,
  selectIsAuthenticated,
  selectPendingSyncInvoices,
  selectAccountSummary,
  selectAllCompras,
  selectAllCustomers,
} from '@/store';
import { selectCurrentTier } from '@/store/selectors/subscriptionSelectors';
import { googleSignIn, googleSignOut } from '@/store/slices/authSlice';
import { reconcileAccountsFromDocuments } from '@/store/slices/accountsSlice';
import { InvoiceStatus, InvoiceType, Invoice } from '@/types/invoice';
import { saleAmountOf } from '@/store/selectors/invoiceSelectors';
import { SubscriptionTier } from '@/services/subscription/SubscriptionTypes';
import { getMaxCompanies } from '@/services/subscription/FeatureGate';
import { SubscriptionModal } from '@/components/modals/SubscriptionModal';
import { DashboardPosCard } from '@/components/pos/DashboardPosCard';

const INVOICE_TYPE_LABELS: Partial<Record<InvoiceType, string>> = {
  [InvoiceType.Factura]: 'Factura',
  [InvoiceType.CCF]: 'CCF',
  [InvoiceType.NotaCredito]: 'N. Crédito',
  [InvoiceType.NotaDebito]: 'N. Débito',
  [InvoiceType.SujetoExcluido]: 'Sujeto Exc.',
  [InvoiceType.FacturaExportacion]: 'F. Exportación',
  [InvoiceType.ComprobanteRetencion]: 'Retención',
  [InvoiceType.ComprobanteLiquidacion]: 'Liquidación',
  [InvoiceType.DocumentoContableLiquidacion]: 'DCL',
  [InvoiceType.ComprobanteDonacion]: 'Donación',
  [InvoiceType.NotaRemision]: 'Remisión',
  [InvoiceType.EventoOperacionesEspeciales]: 'Evento Op. Esp.',
  [InvoiceType.EventoRetorno]: 'Evento Retorno',
};

const STATUS_VARIANT: Partial<Record<InvoiceStatus, 'success' | 'info' | 'error' | 'warning' | 'neutral'>> = {
  [InvoiceStatus.Completada]: 'success',
  [InvoiceStatus.Nueva]: 'info',
  [InvoiceStatus.Anulada]: 'error',
  [InvoiceStatus.ErrorEnvio]: 'warning',
  [InvoiceStatus.Sincronizando]: 'info',
};

const STATUS_LABELS: Partial<Record<InvoiceStatus, string>> = {
  [InvoiceStatus.Completada]: 'Completada',
  [InvoiceStatus.Nueva]: 'Nueva',
  [InvoiceStatus.Anulada]: 'Anulada',
  [InvoiceStatus.ErrorEnvio]: 'Error',
  [InvoiceStatus.Sincronizando]: 'Sincronizando',
};

type InvoiceRow = Record<string, unknown> & {
  id: string;
  fecha: string;
  tipo: InvoiceType;
  cliente: string;
  total: number;
  status: InvoiceStatus;
};

function toRow(inv: Invoice): InvoiceRow {
  return {
    id: inv.id,
    fecha: inv.date,
    tipo: inv.invoiceType,
    cliente:
      inv.customer?.businessName ??
      inv.customer?.name ??
      [inv.customer?.firstName, inv.customer?.lastName].filter(Boolean).join(' ') ??
      '—',
    total: saleAmountOf(inv),
    status: inv.status,
  };
}

interface ActionCardDef {
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  color: string;
  bg: string;
  isPrimary?: boolean;
  requiresCompany?: boolean;
  to: string;
}

function ActionCard({
  def,
  locked,
  onNavigate,
  onLockedTap,
}: {
  def: ActionCardDef;
  locked: boolean;
  onNavigate: (to: string) => void;
  onLockedTap: (title: string) => void;
}) {
  const Icon = def.icon;
  return (
    <button
      onClick={() => (locked ? onLockedTap(def.title) : onNavigate(def.to))}
      className={[
        'group relative flex items-center gap-4 text-left p-4 rounded-xl border transition-all',
        def.isPrimary
          ? 'bg-accent-600 border-accent-700 text-white hover:bg-accent-700 shadow-md'
          : 'bg-white border-brand-100 hover:border-accent-300 hover:shadow-md',
        locked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
      ].join(' ')}
      data-testid={`home-card-${def.to.replace(/\//g, '-')}`}
    >
      <div
        className={[
          'w-12 h-12 rounded-lg flex items-center justify-center shrink-0',
          def.isPrimary ? 'bg-white/20' : def.bg,
        ].join(' ')}
      >
        <Icon size={22} className={def.isPrimary ? 'text-white' : def.color} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`font-semibold text-sm ${def.isPrimary ? 'text-white' : 'text-brand-800'}`}>
          {def.title}
        </p>
        <p className={`text-xs mt-0.5 ${def.isPrimary ? 'text-white/80' : 'text-brand-400'}`}>
          {def.subtitle}
        </p>
      </div>
      {locked ? (
        <Lock size={16} className="text-brand-400 shrink-0" />
      ) : (
        <ChevronRight
          size={18}
          className={def.isPrimary ? 'text-white/80' : 'text-brand-400'}
        />
      )}
    </button>
  );
}

function GoogleAuthChip() {
  const dispatch = useAppDispatch();
  const toast = useToast();
  const user = useAppSelector(selectCurrentUser);
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const [busy, setBusy] = useState(false);

  async function handleSignIn() {
    setBusy(true);
    try {
      const res = await dispatch(googleSignIn());
      if (googleSignIn.fulfilled.match(res)) {
        if (res.payload.authenticated) {
          toast.success('Sesión iniciada con Google');
        } else {
          toast.warning(res.payload.providerLinking.message);
        }
      } else {
        // The thunk's payload carries the reason (connection, rejected account, cancelled).
        toast.error(typeof res.payload === 'string' && res.payload ? res.payload : 'No se pudo iniciar sesión');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    await dispatch(googleSignOut());
    toast.success('Sesión cerrada');
  }

  if (isAuthenticated && user) {
    const initials = `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase() || 'U';
    return (
      <div
        className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full bg-white border border-brand-100 shadow-sm"
        data-testid="home-auth-chip"
      >
        {user.avatar ? (
          <img src={user.avatar} alt="" className="w-7 h-7 rounded-full" />
        ) : (
          <div className="w-7 h-7 rounded-full bg-accent-100 text-accent-700 flex items-center justify-center text-xs font-bold">
            {initials}
          </div>
        )}
        <div className="hidden sm:block leading-tight">
          <p className="text-xs font-medium text-brand-800 truncate max-w-[160px]">
            {user.firstName} {user.lastName}
          </p>
          <p className="text-[10px] text-brand-400 truncate max-w-[160px]">{user.email}</p>
        </div>
        <button
          onClick={handleSignOut}
          className="ml-1 p-1 rounded-full hover:bg-brand-50 text-brand-400 hover:text-brand-700"
          aria-label="Cerrar sesión"
          title="Cerrar sesión"
        >
          <LogOut size={14} />
        </button>
      </div>
    );
  }

  return (
    <Button
      variant="secondary"
      icon={<LogIn size={16} />}
      onClick={handleSignIn}
      disabled={busy}
      data-testid="home-google-signin"
    >
      {busy ? 'Conectando…' : 'Iniciar sesión con Google'}
    </Button>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const toast = useToast();
  const invoices = useAppSelector(selectAllInvoices);
  const stats = useAppSelector(selectInvoiceStats);
  const companies = useAppSelector(selectAllCompanies);
  const currentCompany = useAppSelector(selectCurrentCompany);
  const compras = useAppSelector(selectAllCompras);
  const customers = useAppSelector(selectAllCustomers);
  const accountsSummary = useAppSelector((s) => selectAccountSummary(currentCompany?.id)(s));

  const tier = useAppSelector(selectCurrentTier);
  const [showUpgrade, setShowUpgrade] = useState(false);

  const hasCompany = companies.length > 0;
  const isProduction = currentCompany?.environment?.toLowerCase() === 'production';

  useEffect(() => {
    if (!currentCompany?.id) return;
    dispatch(
      reconcileAccountsFromDocuments({
        companyId: currentCompany.id,
        invoices,
        compras,
        customers,
      }),
    );
  }, [compras, currentCompany?.id, customers, dispatch, invoices]);

  const recentInvoices = [...invoices]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 10);

  const columns: ColumnDef<InvoiceRow>[] = [
    { key: 'fecha', label: 'Fecha', sortable: true },
    {
      key: 'tipo',
      label: 'Tipo',
      render: (val) => (
        <Badge variant="neutral">{INVOICE_TYPE_LABELS[val as InvoiceType] ?? String(val)}</Badge>
      ),
    },
    { key: 'cliente', label: 'Cliente' },
    {
      key: 'total',
      label: 'Total',
      sortable: true,
      render: (val) => <span className="font-medium">${Number(val).toFixed(2)}</span>,
    },
    {
      key: 'status',
      label: 'Estado',
      render: (val) => {
        const s = val as InvoiceStatus;
        return (
          <Badge variant={STATUS_VARIANT[s] ?? 'neutral'}>
            {STATUS_LABELS[s] ?? String(s)}
          </Badge>
        );
      },
    },
  ];

  // Calculate monthly stats
  const thisMonth = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    return invoices.filter((inv) => {
      const d = new Date(inv.createdAt ?? inv.date);
      return d.getFullYear() === y && d.getMonth() === m;
    });
  }, [invoices]);

  const monthInvoiceCount = thisMonth.length;
  const monthTotal = thisMonth.reduce((sum, inv) =>
    sum + saleAmountOf(inv), 0);

  // Get pending sync invoices count from state
  const pendingSyncCount = useAppSelector(selectPendingSyncInvoices).length;

  const summaryCards = [
    {
      label: 'Total Facturas',
      value: stats.total,
      icon: <FileText size={22} />,
      color: 'text-accent-600',
      bg: 'bg-accent-50',
    },
    {
      label: 'Total Compras',
      value: compras.length,
      icon: <ShoppingCart size={22} />,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
    },
    {
      label: 'Ingresos del Mes',
      value: `$${stats.monthTotal.toFixed(2)}`,
      icon: <DollarSign size={22} />,
      color: 'text-green-600',
      bg: 'bg-green-50',
    },
    {
      label: 'Pendientes de Sincronizar',
      value: pendingSyncCount,
      icon: <Clock size={22} />,
      color: pendingSyncCount > 0 ? 'text-amber-600' : 'text-green-600',
      bg: pendingSyncCount > 0 ? 'bg-amber-50' : 'bg-green-50',
    },
    {
      label: 'Por Cobrar',
      value: `$${accountsSummary.receivableTotal.toFixed(2)}`,
      subtitle: `${accountsSummary.receivableCount} cuentas activas`,
      icon: <WalletCards size={22} />,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
    },
    // Monthly summary card - new
    {
      label: 'Facturas Este Mes',
      value: `${monthInvoiceCount}`,
      subtitle: `$${monthTotal.toFixed(2)} total`,
      icon: <Calendar size={22} />,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
  ];

  // Quick action cards — mirror the React Native app ordering + styling
  const quickActions: ActionCardDef[] = [
    {
      title: 'Nueva Factura',
      subtitle: 'Crear factura rápida',
      icon: FileText,
      color: 'text-accent-600',
      bg: 'bg-accent-50',
      isPrimary: true,
      requiresCompany: true,
      to: '/invoices/add',
    },
    {
      title: 'Clientes',
      subtitle: 'Administra tus clientes',
      icon: Users,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
      requiresCompany: true,
      to: '/customers',
    },
    {
      title: 'Productos',
      subtitle: 'Catálogo e inventario',
      icon: Package,
      color: 'text-green-600',
      bg: 'bg-green-50',
      requiresCompany: true,
      to: '/products',
    },
    {
      title: 'Compras',
      subtitle: 'Registro de gastos y DTEs recibidos',
      icon: ShoppingCart,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
      requiresCompany: true,
      to: '/compras',
    },
    {
      title: 'Cobros y pagos',
      subtitle: 'Cuentas por cobrar y pagar',
      icon: WalletCards,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
      requiresCompany: true,
      to: '/accounts',
    },
    {
      title: 'Libros IVA',
      subtitle: 'Exportar libros oficiales',
      icon: BookOpen,
      color: 'text-orange-600',
      bg: 'bg-orange-50',
      requiresCompany: true,
      to: '/invoices/libros-iva',
    },
    {
      title: 'Empresas',
      subtitle: hasCompany ? 'Administra tus empresas' : 'Configura tu primera empresa',
      icon: Building2,
      color: 'text-brand-700',
      bg: 'bg-brand-100',
      requiresCompany: false,
      to: hasCompany ? '/companies' : '/companies/add',
    },
  ];

  function handleLockedTap(title: string) {
    toast.error(`Debe configurar una empresa antes de acceder a ${title}`);
  }

  // ── Empty / no-company state ────────────────────────────────────────────────
  if (!hasCompany) {
    return (
      <div data-testid="dashboard" className="space-y-6">
        <PageHeader
          title="Inicio"
          subtitle="Resumen de actividad"
          actions={<GoogleAuthChip />}
        />

        <Card className="bg-gradient-to-br from-accent-50 to-white border-accent-200">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-xl bg-accent-600 text-white flex items-center justify-center shrink-0">
              <Building2 size={28} />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-brand-900">
                Configura tu primera empresa
              </h2>
              <p className="text-sm text-brand-600 mt-1">
                Para emitir facturas, registrar clientes, productos y compras necesitas
                configurar al menos una empresa emisora.
              </p>
              <div className="mt-4">
                <Button
                  variant="primary"
                  icon={<Plus size={16} />}
                  onClick={() => navigate('/companies/add')}
                  data-testid="home-configure-first-company"
                >
                  Configurar empresa
                </Button>
              </div>
            </div>
          </div>
        </Card>

        <div>
          <h2 className="font-semibold text-brand-800 mb-3">Explora</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {quickActions.map((def) => (
              <ActionCard
                key={def.to}
                def={def}
                locked={!!def.requiresCompany}
                onNavigate={navigate}
                onLockedTap={handleLockedTap}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Normal dashboard ─────────────────────────────────────────────────────────
  return (
    <div data-testid="dashboard" className="space-y-6">
      <PageHeader
        title="Inicio"
        subtitle={currentCompany?.nombreComercial ?? currentCompany?.nombre ?? 'Resumen de actividad'}
        actions={
          <div className="flex items-center gap-3">
            {currentCompany && (
              <Badge variant={isProduction ? 'success' : 'warning'}>
                {isProduction ? (
                  <span className="flex items-center gap-1">
                    <CheckCircle size={12} /> Producción
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <AlertTriangle size={12} /> Desarrollo
                  </span>
                )}
              </Badge>
            )}
            <GoogleAuthChip />
          </div>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryCards.map((card) => (
          <Card key={card.label} className="flex items-center gap-4">
            <div className={`${card.bg} ${card.color} p-3 rounded-lg shrink-0`}>
              {card.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-brand-500 truncate">{card.label}</p>
              {/* Handle cards with or without subtitle */}
              {card.subtitle ? (
                <>
                  <p className="text-lg font-bold text-brand-900 truncate">{card.value}</p>
                  <p className="text-xs text-brand-500 truncate">{card.subtitle}</p>
                </>
              ) : (
                <p className="text-2xl font-bold text-brand-900 truncate">{card.value}</p>
              )}
              {/* Pending sync warning */}
              {card.label === 'Pendientes de Sincronizar' && pendingSyncCount > 0 && (
                <div className="flex items-center gap-1 mt-1">
                  <AlertTriangle size={12} className="text-amber-500 shrink-0" />
                  <span className="text-xs text-amber-600">
                    Sincroniza para completar el envío
                  </span>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>

      {/* POS: today's counter sales + tickets still to consolidate (hidden until the POS is used) */}
      {currentCompany && <DashboardPosCard companyId={currentCompany.id} />}

      {/* Pro upgrade card — Lite tier only */}
      {tier === SubscriptionTier.Lite && (
        <div
          data-testid="pro-upgrade-card"
          className="rounded-xl border border-accent-200 bg-gradient-to-r from-accent-50 to-blue-50 p-4 flex items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-accent-100 text-accent-600 flex items-center justify-center shrink-0">
              <Star size={20} />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-accent-900 text-sm">Suscríbete a Pro</p>
              <p className="text-xs text-accent-700 truncate">
                Facturas ilimitadas · Hasta {getMaxCompanies(SubscriptionTier.AdFree)} empresas · Libros IVA · Respaldo en Drive · Envío por correo
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => navigate('/settings/promo')}
              className="flex items-center gap-1 rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-700 transition-colors"
            >
              <Zap size={13} />
              $7/mes
            </button>
            <button
              onClick={() => setShowUpgrade(true)}
              className="rounded-lg border border-accent-300 px-3 py-1.5 text-xs font-medium text-accent-700 hover:bg-accent-100 transition-colors"
            >
              Ver planes
            </button>
          </div>
        </div>
      )}

      {/* Action cards — RN parity */}
      <div>
        <h2 className="font-semibold text-brand-800 mb-3">Acciones Rápidas</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {quickActions.map((def) => (
            <ActionCard
              key={def.to}
              def={def}
              locked={false}
              onNavigate={navigate}
              onLockedTap={handleLockedTap}
            />
          ))}
        </div>
      </div>

      {/* Recent invoices */}
      <Card padding="none">
        <div className="px-5 py-4 border-b border-brand-100 flex items-center justify-between">
          <h2 className="font-semibold text-brand-800">Últimas Facturas</h2>
          <Button variant="ghost" size="sm" onClick={() => navigate('/invoices')}>
            Ver todas
          </Button>
        </div>
        <div className="p-4">
          {recentInvoices.length === 0 ? (
            <p className="text-center text-brand-400 py-8">No hay facturas aún.</p>
          ) : (
            <DataTable<InvoiceRow>
              columns={columns}
              data={recentInvoices.map(toRow)}
              onRowClick={(row) => navigate(`/invoices/${row.id}`)}
            />
          )}
        </div>
      </Card>

      <SubscriptionModal
        isOpen={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        requiredTier={SubscriptionTier.AdFree}
        featureName="Facturas ilimitadas"
      />
    </div>
  );
}
