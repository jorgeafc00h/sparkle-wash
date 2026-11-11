import { useNavigate, useParams } from 'react-router-dom';
import {
  Settings,
  Trash2,
  Star,
  Rocket,
  Pencil,
  ShieldCheck,
  ShieldAlert,
  Key,
  Building2,
  Mail,
  Phone,
  MapPin,
  FileText,
  CheckCircle2,
  AlertCircle,
  ImageIcon,
  Percent,
} from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { Card } from '@/components/common/Card';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useToast } from '@/components/common/Toast';
import { useAppSelector, useAppDispatch } from '@/store';
import { selectAllCompanies, selectInvoicesByCompanyId, selectSelectedCompanyId } from '@/store';
import { deleteCompany, setDefaultCompany, setSelectedCompany } from '@/store/slices/companySlice';
import { deleteInvoicesByCompany } from '@/store/slices/invoiceSlice';
import { deleteCustomersByCompany } from '@/store/slices/customerSlice';
import { deleteProductsByCompany } from '@/store/slices/productSlice';
import { clearComprasForCompany } from '@/store/slices/comprasSlice';
import { SecureStorageService } from '@/services/security/SecureStorageService';
import { ComprasDatabase } from '@/services/compras/ComprasDatabase';
import { TicketDatabase } from '@/services/tickets/TicketDatabase';
import { CashDrawerStore } from '@/services/tickets/CashDrawerStore';
import { CompanyEnvironment } from '@/types/company';
import { InvoiceStatus } from '@/types/invoice';

// Card section keys — match the ?section= values supported by CompanyConfigPage
type ConfigSection =
  | 'basicInfo'
  | 'env'
  | 'cert'
  | 'credentials'
  | 'settings'
  | 'location'
  | 'logo';

function initialsFor(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || '?';
}

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const toast = useToast();

  const companies = useAppSelector(selectAllCompanies);
  const selectedCompanyId = useAppSelector(selectSelectedCompanyId);
  const company = companies.find((c) => c.id === id) ?? null;
  const isSelected = !!company && company.id === selectedCompanyId;

  const companyInvoices = useAppSelector(selectInvoicesByCompanyId(company?.id ?? ''));
  const hasOnlyNewInvoices = companyInvoices.every((inv) => inv.status === InvoiceStatus.Nueva);

  const [showDelete, setShowDelete] = useState(false);

  if (!company) {
    return (
      <div data-testid="company-detail" className="py-16 text-center text-brand-400">
        Empresa no encontrada.
      </div>
    );
  }

  const isProduction = company.environment === CompanyEnvironment.Production;
  const canDelete = hasOnlyNewInvoices;

  async function handleDelete() {
    if (!canDelete) {
      toast.error('No se puede eliminar una empresa con facturas emitidas, anuladas, en contingencia o con error de envío.');
      return;
    }
    if (company!.nit) {
      await SecureStorageService.clearCompanyData(
        company!.nit,
        company!.environment === CompanyEnvironment.Production,
      );
    }
    await ComprasDatabase.deleteCompanyData(company!.id);
    // POS data lives outside Redux too: tickets (+ monthly archives) and the
    // device-local cash drawer would otherwise outlive the company.
    await TicketDatabase.deleteCompanyData(company!.id);
    await CashDrawerStore.deleteCompanyData(company!.id);
    dispatch(deleteInvoicesByCompany(company!.id));
    dispatch(deleteCustomersByCompany(company!.id));
    dispatch(deleteProductsByCompany(company!.id));
    dispatch(clearComprasForCompany(company!.id));
    await dispatch(deleteCompany(company!.id));
    toast.success('Empresa eliminada correctamente.');
    navigate('/companies');
  }

  async function handleSetDefault() {
    await dispatch(setDefaultCompany(company!.id));
    toast.success(`${company!.nombreComercial} establecida como predeterminada y activa.`);
  }

  /**
   * Switch the ACTIVE company — the one the sidebar badge reflects and the one
   * new DTEs/POS tickets are created under. Previously there was no UI for
   * this, so "Predeterminar" was (wrongly) read as switching companies.
   */
  function handleSelect() {
    dispatch(setSelectedCompany(company!.id));
    toast.success(`Trabajando ahora con ${company!.nombreComercial}.`);
  }

  function editSection(section: ConfigSection) {
    navigate(`/companies/${company!.id}/config?section=${section}`);
  }

  // ── Section card wrapper ─────────────────────────────────────────────────
  function SectionCard({
    title,
    icon,
    iconBg,
    iconFg,
    section,
    children,
    status,
  }: {
    title: string;
    icon: React.ReactNode;
    iconBg: string;
    iconFg: string;
    section: ConfigSection;
    status?: React.ReactNode;
    children: React.ReactNode;
  }) {
    return (
      <Card className="group relative hover:shadow-md transition-shadow">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-10 h-10 rounded-lg ${iconBg} ${iconFg} flex items-center justify-center shrink-0`}>
              {icon}
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-brand-800 leading-tight truncate">{title}</h2>
              {status && <div className="mt-1">{status}</div>}
            </div>
          </div>
          <button
            onClick={() => editSection(section)}
            aria-label={`Editar ${title}`}
            title={`Editar ${title}`}
            className="p-2 rounded-lg text-brand-400 hover:text-accent-700 hover:bg-accent-50 transition-colors shrink-0"
          >
            <Pencil size={16} />
          </button>
        </div>
        {children}
      </Card>
    );
  }

  // ── Field row ────────────────────────────────────────────────────────────
  function Row({ icon, label, value }: { icon?: React.ReactNode; label: string; value: React.ReactNode }) {
    return (
      <div className="flex items-start gap-3 py-2 border-b border-brand-50 last:border-b-0">
        {icon && <div className="text-brand-400 mt-0.5 shrink-0">{icon}</div>}
        <div className="min-w-0 flex-1">
          <p className="text-xs text-brand-400 uppercase tracking-wide font-medium">{label}</p>
          <p className="text-sm text-brand-800 font-medium break-words">{value || '—'}</p>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="company-detail" className="space-y-6">
      {/* Hero header */}
      <Card className="bg-gradient-to-br from-brand-900 to-accent-700 text-white border-none">
        <div className="flex flex-wrap items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-white/15 border border-white/25 flex items-center justify-center text-2xl font-black">
            {initialsFor(company.nombreComercial || company.nombre)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold leading-tight truncate">
                {company.nombreComercial}
              </h1>
              {company.isDefault && (
                <span className="inline-flex items-center gap-1 text-[11px] bg-amber-400/25 text-amber-100 border border-amber-300/30 px-2 py-0.5 rounded-full font-medium">
                  <Star size={11} className="fill-amber-300 text-amber-300" /> Predeterminada
                </span>
              )}
            </div>
            <p className="text-sm text-white/70 truncate">{company.nombre}</p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span
                className={[
                  'text-xs font-semibold px-2 py-0.5 rounded-full border',
                  isProduction
                    ? 'bg-green-400/20 text-green-100 border-green-300/30'
                    : 'bg-amber-400/20 text-amber-100 border-amber-300/30',
                ].join(' ')}
              >
                {isProduction ? 'Producción' : 'Desarrollo'}
              </span>
              {company.nit && (
                <span className="text-xs text-white/70">NIT: {company.nit}</span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {isSelected ? (
              <span
                data-testid="company-active-badge"
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-medium text-white"
                title="Esta es la empresa activa: los DTE y tickets nuevos se crean aquí"
              >
                <CheckCircle2 size={14} />
                Empresa activa
              </span>
            ) : (
              <Button
                variant="secondary"
                icon={<CheckCircle2 size={14} />}
                onClick={handleSelect}
                data-testid="select-company-btn"
                className="bg-white/10 text-white border-white/25 hover:bg-white/20"
              >
                Trabajar con esta empresa
              </Button>
            )}
            {!company.isDefault && (
              <Button
                variant="secondary"
                icon={<Star size={14} />}
                onClick={handleSetDefault}
                data-testid="set-default-btn"
                className="bg-white/10 text-white border-white/25 hover:bg-white/20"
              >
                Predeterminar
              </Button>
            )}
            <Button
              variant="secondary"
              icon={<Settings size={14} />}
              onClick={() => navigate(`/companies/${company.id}/config`)}
              className="bg-white text-brand-900 border-transparent hover:bg-white/90"
            >
              Editar configuración
            </Button>
            <div className="relative group/del">
              <Button
                variant="danger"
                icon={<Trash2 size={14} />}
                onClick={() => canDelete && setShowDelete(true)}
                disabled={!canDelete}
                title={!canDelete ? 'Solo se puede eliminar una empresa si todas sus facturas están en estado Nueva' : undefined}
              >
                Eliminar
              </Button>
              {!canDelete && (
                <div className="absolute bottom-full mb-2 right-0 w-64 hidden group-hover/del:block bg-brand-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg pointer-events-none z-50">
                  Solo se puede eliminar una empresa si todas sus facturas están en estado Nueva. Las facturas ya emitidas o procesadas deben conservarse.
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Production access banner (dev only) */}
      {!isProduction && (
        <Card className="bg-gradient-to-r from-accent-50 to-white border border-accent-200">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-accent-600 text-white flex items-center justify-center shrink-0">
                <Rocket size={18} />
              </div>
              <div>
                <p className="font-semibold text-brand-900">Solicita acceso a producción</p>
                <p className="text-xs text-brand-600 mt-0.5">
                  Envía un lote de DTEs de prueba al Ministerio de Hacienda para
                  habilitar esta empresa en producción.
                </p>
              </div>
            </div>
            <Button
              variant="primary"
              icon={<Rocket size={14} />}
              onClick={() => navigate(`/companies/${company.id}/request-production`)}
              data-testid="request-production-btn"
            >
              Iniciar proceso
            </Button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* General Info — pencil now opens the basic-info form (was wrongly
            pointing at the location section). */}
        <SectionCard
          title="Información General"
          icon={<Building2 size={18} />}
          iconBg="bg-brand-100"
          iconFg="text-brand-700"
          section="basicInfo"
        >
          <dl className="space-y-0">
            <Row icon={<FileText size={14} />} label="Nombre Legal" value={company.nombre} />
            <Row icon={<Building2 size={14} />} label="Nombre Comercial" value={company.nombreComercial} />
            <Row label="NIT" value={company.nit ?? '—'} />
            <Row label="NRC" value={company.nrc ?? '—'} />
            <Row icon={<Mail size={14} />} label="Correo" value={company.correo} />
            <Row icon={<Phone size={14} />} label="Teléfono" value={company.telefono ?? '—'} />
            <Row icon={<MapPin size={14} />} label="Dirección" value={company.complemento} />
            <Row
              icon={<MapPin size={14} />}
              label="Departamento / Municipio"
              value={`${company.departamento || '—'} / ${company.municipio || '—'}`}
            />
          </dl>
        </SectionCard>

        <div className="space-y-6">
          {/* Environment */}
          <SectionCard
            title="Ambiente"
            icon={<Percent size={18} />}
            iconBg={isProduction ? 'bg-green-100' : 'bg-amber-100'}
            iconFg={isProduction ? 'text-green-700' : 'text-amber-700'}
            section="env"
            status={
              <Badge variant={isProduction ? 'success' : 'warning'}>
                {isProduction ? 'Producción' : 'Desarrollo'}
              </Badge>
            }
          >
            <p className="text-sm text-brand-600">
              {isProduction
                ? 'Los documentos generados se envían al Ministerio de Hacienda y tienen validez fiscal.'
                : 'Modo de pruebas. Los documentos generados no tienen validez fiscal.'}
            </p>
          </SectionCard>

          {/* Certificate */}
          <SectionCard
            title="Certificado Digital"
            icon={
              company.hasValidCertificate ? (
                <ShieldCheck size={18} />
              ) : (
                <ShieldAlert size={18} />
              )
            }
            iconBg={company.hasValidCertificate ? 'bg-green-100' : 'bg-amber-100'}
            iconFg={company.hasValidCertificate ? 'text-green-700' : 'text-amber-700'}
            section="cert"
            status={
              company.hasValidCertificate ? (
                <Badge variant="success">Certificado válido</Badge>
              ) : (
                <Badge variant="warning">Sin certificado</Badge>
              )
            }
          >
            <dl className="space-y-0">
              {company.certificateExpiryDate && (
                <Row
                  label="Vencimiento"
                  value={new Date(company.certificateExpiryDate).toLocaleDateString('es-SV')}
                />
              )}
              {company.certificateSubject && (
                <Row label="Sujeto" value={company.certificateSubject} />
              )}
              {!company.hasValidCertificate && (
                <p className="text-sm text-brand-500 italic">
                  Aún no has cargado un certificado .crt para esta empresa.
                </p>
              )}
            </dl>
          </SectionCard>

          {/* API Credentials */}
          <SectionCard
            title="Credenciales API"
            icon={<Key size={18} />}
            iconBg={company.hasApiCredentials ? 'bg-sky-100' : 'bg-amber-100'}
            iconFg={company.hasApiCredentials ? 'text-sky-700' : 'text-amber-700'}
            section="credentials"
            status={
              <Badge variant={company.hasApiCredentials ? 'success' : 'warning'}>
                {company.hasApiCredentials ? 'Configuradas' : 'No configuradas'}
              </Badge>
            }
          >
            <p className="text-sm text-brand-600 flex items-center gap-2">
              {company.hasApiCredentials ? (
                <>
                  <CheckCircle2 size={14} className="text-green-600" />
                  Las credenciales de Hacienda están guardadas y listas para firmar
                  documentos.
                </>
              ) : (
                <>
                  <AlertCircle size={14} className="text-amber-600" />
                  Configura tu NIT de autenticación y contraseña para enviar documentos
                  al Ministerio de Hacienda.
                </>
              )}
            </p>
          </SectionCard>

          {/* Logo */}
          <SectionCard
            title="Logo"
            icon={<ImageIcon size={18} />}
            iconBg="bg-rose-100"
            iconFg="text-rose-700"
            section="logo"
            status={
              <Badge variant={company.logoUrl ? 'success' : 'neutral'}>
                {company.logoUrl ? 'Cargado' : 'Sin logo'}
              </Badge>
            }
          >
            {company.logoUrl ? (
              <img
                src={company.logoUrl}
                alt="Logo"
                className="h-16 object-contain border border-brand-100 rounded-lg p-2"
              />
            ) : (
              <p className="text-sm text-brand-500">
                Agrega un logo para que aparezca en los PDF generados.
              </p>
            )}
          </SectionCard>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showDelete}
        onClose={() => setShowDelete(false)}
        onConfirm={handleDelete}
        title="Eliminar Empresa"
        confirmLabel="Eliminar"
        variant="danger"
      >
        <div className="space-y-4">
          <div className="rounded-xl border-2 border-red-400 bg-red-50 p-4 text-center">
            <p className="text-base font-extrabold text-red-700 leading-snug">
              ⚠️ Se eliminarán facturas, productos y clientes relacionados. ¿Seguro que desea continuar?
            </p>
          </div>
          <p className="text-sm text-brand-600">
            Estás a punto de eliminar la empresa <strong>"{company.nombreComercial}"</strong>. Esta acción es <strong>irreversible</strong> y borrará sus facturas Nueva, clientes, productos, compras locales, certificado y credenciales.
          </p>
        </div>
      </ConfirmDialog>
    </div>
  );
}
