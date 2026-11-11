import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Building2, BookOpen, RefreshCw, User, CreditCard, CloudUpload, Download, Upload, FileText, MonitorSmartphone, Tags, LifeBuoy, UserCog, Car } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/common/Card';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { Input } from '@/components/common/Input';
import { Select } from '@/components/common/Select';
import { useAppSelector } from '@/store';
import { selectCurrentTier, selectCurrentCompany } from '@/store';
import { SubscriptionTier } from '@/services/subscription/SubscriptionTypes';
import { canUploadToDrive } from '@/services/subscription/FeatureGate';
import GoogleAuthService from '@/services/auth/GoogleAuthService';
import { useToast } from '@/components/common/Toast';
import { LogExportService } from '@/services/logging/LogExportService';
import { SupportTicketService } from '@/services/support/SupportTicketService';
import { APP_VERSION } from '@/config/appVersion';
import { usePermissionCheck } from '@/hooks/useLocalUsers';

const TIER_LABEL: Record<SubscriptionTier, string> = {
  [SubscriptionTier.Lite]: 'Free',
  [SubscriptionTier.AdFree]: 'Pro',
  [SubscriptionTier.Pro]: 'Business',
  [SubscriptionTier.ProSync]: 'Pro+Sync',
  [SubscriptionTier.Enterprise]: 'Enterprise',
};

const TIER_VARIANT: Record<SubscriptionTier, 'neutral' | 'info' | 'purple'> = {
  [SubscriptionTier.Lite]: 'neutral',
  [SubscriptionTier.AdFree]: 'info',
  [SubscriptionTier.Pro]: 'purple',
  [SubscriptionTier.ProSync]: 'purple',
  [SubscriptionTier.Enterprise]: 'purple',
};

// `href` doubles as the access check: cards the signed-in local user can't
// open are shown disabled (see services/localUsers/permissions.ts).
const SETTINGS_GRID = [
  {
    label: 'Usuarios y permisos',
    description: 'Usuarios locales, PIN e historial de actividad',
    icon: <UserCog size={22} />,
    href: '/settings/users',
    color: 'text-indigo-600',
    bg: 'bg-indigo-50',
    testId: 'settings-local-users',
  },
  {
    label: 'SparkleWash (lavado)',
    description: 'Conexión con la API, tickets de trabajo y cuenta Google',
    icon: <Car size={22} />,
    href: '/settings/carwash',
    color: 'text-sky-600',
    bg: 'bg-sky-50',
    testId: 'settings-carwash',
  },
  {
    label: 'Empresas',
    description: 'Gestión de empresas registradas',
    icon: <Building2 size={22} />,
    href: '/companies',
    color: 'text-accent-600',
    bg: 'bg-accent-50',
  },
  {
    label: 'Catálogos',
    description: 'Catálogos del Ministerio de Hacienda',
    icon: <BookOpen size={22} />,
    href: '/settings/catalogs',
    color: 'text-green-600',
    bg: 'bg-green-50',
  },
  {
    label: 'Sincronización entre dispositivos',
    description: 'Teléfono y computadora al día (Pro+Sync)',
    icon: <MonitorSmartphone size={22} />,
    href: '/settings/sync',
    color: 'text-purple-600',
    bg: 'bg-purple-50',
    testId: 'settings-device-sync',
  },
  {
    label: 'Categorías de Productos',
    description: 'Organiza y filtra tu catálogo',
    icon: <Tags size={22} />,
    href: '/settings/categories',
    color: 'text-teal-600',
    bg: 'bg-teal-50',
    testId: 'settings-product-categories',
  },
  {
    label: 'Registros de Sincronización',
    description: 'Historial de envíos al MH',
    icon: <RefreshCw size={22} />,
    href: '/settings/sync-logs',
    color: 'text-amber-600',
    bg: 'bg-amber-50',
  },
  {
    label: 'Perfil',
    description: 'Tu información de cuenta',
    icon: <User size={22} />,
    href: '/settings/profile',
    color: 'text-purple-600',
    bg: 'bg-purple-50',
  },
  {
    label: 'Cuenta',
    description: 'Resumen de uso y suscripción',
    icon: <CreditCard size={22} />,
    href: '/settings/account',
    color: 'text-brand-600',
    bg: 'bg-brand-100',
  },
];

export default function SettingsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const tier = useAppSelector(selectCurrentTier);
  const currentCompany = useAppSelector(selectCurrentCompany);
  const { canOpen } = usePermissionCheck();

  const driveExportAllowed = canUploadToDrive(tier);
  const [isSignedInWithGoogle, setIsSignedInWithGoogle] = useState(false);
  const [exportingLogs, setExportingLogs] = useState(false);
  const [uploadingLogs, setUploadingLogs] = useState(false);

  // Support ticket (chat.api) with local logs + App Insights link attached.
  const [supportOpen, setSupportOpen] = useState(false);
  const [sendingTicket, setSendingTicket] = useState(false);
  const [supportSummary, setSupportSummary] = useState('');
  const [supportDetail, setSupportDetail] = useState('');
  const [supportCategory, setSupportCategory] = useState('printing');
  const [createdTicket, setCreatedTicket] = useState<{ ticketId: string; appInsightsUrl: string } | null>(null);

  useEffect(() => {
    GoogleAuthService.isSignedIn().then(setIsSignedInWithGoogle);
  }, []);

  function handleOpenSupport() {
    setCreatedTicket(null);
    setSupportSummary('');
    setSupportDetail('');
    setSupportOpen(true);
  }

  async function handleSendSupportTicket() {
    if (!supportSummary.trim()) {
      toast.error('Describe brevemente el problema');
      return;
    }
    setSendingTicket(true);
    try {
      const result = await SupportTicketService.createDiagnosticsTicket({
        summary: supportSummary.trim(),
        description: supportDetail.trim(),
        category: supportCategory as 'printing' | 'sync' | 'platform' | 'account' | 'other',
        screenContext: 'settings',
        nit: currentCompany?.nit,
        companyName: currentCompany?.nombreComercial || currentCompany?.nombre,
      });
      if (result.success && result.ticket) {
        setCreatedTicket(result.ticket);
        toast.success(`Ticket ${result.ticket.ticketId} creado`);
      } else {
        toast.error(result.error ?? 'No se pudo crear el ticket');
      }
    } finally {
      setSendingTicket(false);
    }
  }

  async function handleExportLogs() {
    setExportingLogs(true);
    try {
      const result = await LogExportService.exportToFile();
      if (result.success) {
        toast.success('Registros exportados correctamente');
      } else if (result.error !== 'Cancelado') {
        toast.error(result.error ?? 'Error al exportar registros');
      }
    } finally {
      setExportingLogs(false);
    }
  }

  async function handleUploadLogs() {
    setUploadingLogs(true);
    try {
      const result = await LogExportService.uploadToServer(currentCompany?.nit ?? undefined);
      if (result.success) {
        toast.success('Registros enviados al servidor para diagnóstico');
      } else {
        toast.error(result.error ?? 'Error al enviar registros');
      }
    } finally {
      setUploadingLogs(false);
    }
  }

  return (
    <div data-testid="settings" className="space-y-6">
      <PageHeader title="Configuración" subtitle="Ajustes del sistema" />

      {/* Settings grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {SETTINGS_GRID.map((item) => {
          const allowed = canOpen(item.href);
          return (
          <button
            key={item.href}
            data-testid={'testId' in item ? item.testId : undefined}
            onClick={() => navigate(item.href)}
            disabled={!allowed}
            title={allowed ? undefined : 'Sin permiso — pide acceso al administrador'}
            className={[
              'text-left p-5 bg-white rounded-lg border border-brand-100 shadow-sm transition-all',
              allowed ? 'hover:shadow-md hover:border-brand-200' : 'opacity-50 cursor-not-allowed',
            ].join(' ')}
          >
            <div className={`${item.bg} ${item.color} w-10 h-10 rounded-lg flex items-center justify-center mb-3`}>
              {item.icon}
            </div>
            <div className="flex items-center justify-between">
              <p className="font-semibold text-brand-800">{item.label}</p>
              {item.label === 'Cuenta' && (
                <Badge variant={TIER_VARIANT[tier]}>{TIER_LABEL[tier]}</Badge>
              )}
            </div>
            <p className="text-xs text-brand-400 mt-0.5">{item.description}</p>
          </button>
          );
        })}
      </div>

      {/* Google Drive Export — paid tiers + Google auth */}
      {driveExportAllowed && isSignedInWithGoogle && canOpen('/settings/google-drive') && (
        <button
          onClick={() => navigate('/settings/google-drive')}
          className="w-full text-left p-5 bg-white rounded-lg border border-brand-100 shadow-sm hover:shadow-md hover:border-brand-200 transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="bg-blue-50 text-blue-600 w-10 h-10 rounded-lg flex items-center justify-center">
              <CloudUpload size={22} />
            </div>
            <div>
              <p className="font-semibold text-brand-800">Exportar a Google Drive</p>
              <p className="text-xs text-brand-400">Respaldo seguro en la nube</p>
            </div>
          </div>
        </button>
      )}

      {/* System Logs */}
      <Card className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="bg-slate-50 text-slate-600 w-10 h-10 rounded-lg flex items-center justify-center shrink-0">
            <FileText size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-brand-800">Registros del Sistema</p>
            <p className="text-xs text-brand-400 mt-0.5">
              Registros de actividad local para diagnóstico de problemas.
              Los registros no contienen contraseñas ni información sensible.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            variant="secondary"
            size="sm"
            icon={<Download size={14} />}
            onClick={handleExportLogs}
            loading={exportingLogs}
            disabled={exportingLogs || uploadingLogs}
            data-testid="btn-export-logs"
          >
            Exportar a archivo
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<Upload size={14} />}
            onClick={handleUploadLogs}
            loading={uploadingLogs}
            disabled={exportingLogs || uploadingLogs}
            data-testid="btn-upload-logs"
          >
            Enviar al servidor
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<LifeBuoy size={14} />}
            onClick={handleOpenSupport}
            data-testid="btn-open-support-ticket"
          >
            Crear ticket de soporte
          </Button>
        </div>
      </Card>

      {/* Support ticket — sends local logs + App Insights link to chat.api */}
      <Modal
        isOpen={supportOpen}
        onClose={() => setSupportOpen(false)}
        title="Crear ticket de soporte"
        size="md"
      >
        <div className="space-y-4">
          {createdTicket ? (
            <div className="space-y-3" data-testid="support-ticket-result">
              <p className="text-sm text-brand-700">
                Ticket <span className="font-mono font-semibold" data-testid="support-ticket-id">{createdTicket.ticketId}</span> creado.
                Se adjuntaron los registros locales y un enlace a la telemetría del error en Application Insights.
              </p>
              <a
                href={createdTicket.appInsightsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 underline underline-offset-2"
                data-testid="support-ticket-ai-link"
              >
                Ver eventos en Application Insights
              </a>
              <div className="flex justify-end">
                <Button variant="primary" size="sm" onClick={() => setSupportOpen(false)} data-testid="btn-close-support-ticket">
                  Cerrar
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-xs text-brand-400">
                Se enviarán los registros locales de esta instalación y un enlace a los eventos
                de Application Insights alrededor de este momento para que soporte pueda revisar el error.
                Los registros no contienen contraseñas ni información sensible.
              </p>
              <Select
                label="Categoría"
                value={supportCategory}
                onChange={(e) => setSupportCategory(e.target.value)}
                options={[
                  { label: 'Impresión de tickets', value: 'printing' },
                  { label: 'Sincronización', value: 'sync' },
                  { label: 'Plataforma / app', value: 'platform' },
                  { label: 'Cuenta', value: 'account' },
                  { label: 'Otro', value: 'other' },
                ]}
                data-testid="select-support-category"
              />
              <Input
                label="Resumen del problema"
                placeholder="Ej. La impresora de tickets no imprime al cobrar"
                value={supportSummary}
                onChange={(e) => setSupportSummary(e.target.value)}
                maxLength={200}
                data-testid="input-support-summary"
              />
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-brand-700" htmlFor="support-detail">
                  Detalle (opcional)
                </label>
                <textarea
                  id="support-detail"
                  className="w-full min-h-[80px] px-3 py-2 text-sm border border-brand-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-300 bg-white text-brand-900"
                  placeholder="Qué hiciste, qué esperabas y qué pasó…"
                  value={supportDetail}
                  onChange={(e) => setSupportDetail(e.target.value)}
                  maxLength={2000}
                  data-testid="input-support-detail"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="secondary" size="sm" onClick={() => setSupportOpen(false)} data-testid="btn-cancel-support-ticket">
                  Cancelar
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  icon={<LifeBuoy size={14} />}
                  onClick={handleSendSupportTicket}
                  loading={sendingTicket}
                  disabled={sendingTicket}
                  data-testid="btn-send-support-ticket"
                >
                  Enviar a soporte
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* App info */}
      <Card>
        <h2 className="font-semibold text-brand-800 mb-2">Información de la App</h2>
        <p className="text-sm text-brand-500">
          Versión <span className="font-mono font-medium">{APP_VERSION}</span> — SparkleWash Desktop
        </p>
        <p className="text-xs text-brand-400 mt-1">
          &copy; {new Date().getFullYear()} Key Labs. Facturación Electrónica para El Salvador.
        </p>
      </Card>
    </div>
  );
}
