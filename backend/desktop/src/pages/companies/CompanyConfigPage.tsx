import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { Image as ImageIcon, Trash2, Upload, Eye, EyeOff, CheckCircle2, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Card } from '@/components/common/Card';
import { Badge } from '@/components/common/Badge';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { LocationDropdowns } from '@/components/forms/LocationDropdowns';
import { CatalogPicker } from '@/components/forms/CatalogPicker';
import { GovernmentCatalogId } from '@/types/catalog';
import { useToast } from '@/components/common/Toast';
import { useAppSelector, useAppDispatch } from '@/store';
import { selectAllCompanies } from '@/store';
import { selectCurrentTier } from '@/store/selectors/subscriptionSelectors';
import {
  promoteToProduction,
  updateCompany,
  validateCredentials,
  type CredentialsCheckFailure,
} from '@/store/slices/companySlice';
import { CompanyEnvironment } from '@/types/company';
import { SubscriptionTier } from '@/services/subscription/SubscriptionTypes';
import { SecureStorageService } from '@/services/security/SecureStorageService';
import { CertificateService } from '@/services/security/CertificateService';
import { parseCertificateXML } from '@/services/signing/CertificateParser';
import {
  validateCompanyForMH,
  formatErrors,
} from '@/services/validation/MHSchemaValidator';

// ── Crypto helpers ────────────────────────────────────────────────────────────
// Uses Electron IPC (Node crypto) for maximum cross-platform reliability.
// Falls back to Web Crypto API when running outside Electron (tests/browser).
async function sha512Hex(text: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = (window as any).electronAPI;
  if (api?.sha512) {
    return api.sha512(text) as Promise<string>;
  }
  // Web Crypto fallback (Electron secure context or browser)
  const msgBuffer = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-512', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── Logo editor ──────────────────────────────────────────────────────────────
const MAX_LOGO_SIDE_PX = 600;

async function resizeImageToDataUrl(file: File): Promise<{
  dataUrl: string;
  width: number;
  height: number;
}> {
  const readAsDataUrl = (f: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
      reader.readAsDataURL(f);
    });

  const src = await readAsDataUrl(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Archivo de imagen inválido'));
    el.src = src;
  });

  const ratio = Math.min(1, MAX_LOGO_SIDE_PX / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.round(img.naturalWidth * ratio);
  const height = Math.round(img.naturalHeight * ratio);

  if (ratio === 1 && file.size < 300_000) {
    return { dataUrl: src, width, height };
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas no disponible');
  ctx.drawImage(img, 0, 0, width, height);
  const mime = file.type === 'image/png' || src.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
  const dataUrl = canvas.toDataURL(mime, mime === 'image/jpeg' ? 0.9 : undefined);
  return { dataUrl, width, height };
}

function LogoEditor({
  companyId,
  logoUrl,
  logoWidth,
  logoHeight,
  isFreeTier,
}: {
  companyId: string;
  logoUrl?: string;
  logoWidth: number;
  logoHeight: number;
  isFreeTier: boolean;
}) {
  const dispatch = useAppDispatch();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Selecciona un archivo de imagen (PNG, JPG, SVG).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('El logo no puede pesar más de 5 MB.');
      return;
    }
    setUploading(true);
    try {
      const { dataUrl, width, height } = await resizeImageToDataUrl(file);
      await dispatch(
        updateCompany({
          id: companyId,
          logoUrl: dataUrl,
          invoiceLogo: dataUrl,
          logoWidth: width,
          logoHeight: height,
        }),
      );
      toast.success('Logo actualizado.');
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Error al procesar la imagen.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleRemove() {
    await dispatch(
      updateCompany({
        id: companyId,
        logoUrl: '',
        invoiceLogo: '',
      }),
    );
    toast.success('Logo eliminado.');
  }

  if (isFreeTier) {
    return (
      <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 border border-amber-200">
        <ImageIcon size={20} className="text-amber-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-amber-800">Logo personalizado disponible en planes de pago</p>
          <p className="text-xs text-amber-700 mt-1">
            Los PDFs en el plan gratuito muestran el logo de Facturas Simples con un enlace a{' '}
            <span className="font-medium">www.facturasimples.pro</span>. Mejora tu plan para usar tu propio logo.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {logoUrl ? (
        <div className="flex items-center gap-4 p-4 rounded-lg bg-brand-50 border border-brand-100">
          <img
            src={logoUrl}
            alt="Logo de la empresa"
            className="h-20 w-20 object-contain bg-white rounded border border-brand-200 p-1"
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-brand-800">Logo actual</p>
            <p className="text-xs text-brand-500">
              {logoWidth}×{logoHeight} px — se usa en los PDF generados.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-brand-50 border border-dashed border-brand-200">
          <div className="w-12 h-12 rounded-lg bg-white flex items-center justify-center text-brand-400 shrink-0">
            <ImageIcon size={22} />
          </div>
          <div>
            <p className="text-sm font-medium text-brand-700">Aún no has cargado un logo</p>
            <p className="text-xs text-brand-500">
              PNG o JPG transparente, hasta 5 MB. Se redimensiona automáticamente.
            </p>
          </div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml"
        onChange={handleFile}
        className="hidden"
      />

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          icon={<Upload size={14} />}
          onClick={() => fileRef.current?.click()}
          loading={uploading}
        >
          {logoUrl ? 'Reemplazar logo' : 'Cargar logo'}
        </Button>
        {logoUrl && (
          <Button
            variant="danger"
            icon={<Trash2 size={14} />}
            onClick={handleRemove}
            disabled={uploading}
          >
            Eliminar
          </Button>
        )}
      </div>
    </div>
  );
}

type CredentialsForm = {
  credPassword: string;
};

/**
 * What the credentials card last did, shown inline (not only as a toast) so
 * the user always knows whether anything was saved.
 */
type CredStatus =
  | { kind: 'idle' }
  | { kind: 'checking'; action: 'save' | 'test' }
  | { kind: 'saved' }
  | { kind: 'stored-ok' }
  | { kind: 'rejected' | 'unreachable'; action: 'save' | 'test'; message: string };

/**
 * Inline, persistent result of the last credentials action (aria-live, so it
 * is announced) — says explicitly whether anything was saved.
 */
function CredentialsStatusLine({
  status,
  hasTypedPassword,
  credentialsSaved,
}: {
  status: CredStatus;
  hasTypedPassword: boolean;
  credentialsSaved: boolean;
}) {
  let tone: 'info' | 'success' | 'warning' | 'error' | null = null;
  let text = '';
  switch (status.kind) {
    case 'checking':
      tone = 'info';
      text = status.action === 'save'
        ? 'Validando con Hacienda… se guardará solo si Hacienda la acepta.'
        : 'Probando con Hacienda las credenciales guardadas…';
      break;
    case 'saved':
      tone = 'success';
      text = 'Hacienda aceptó las credenciales y quedaron guardadas en el llavero.';
      break;
    case 'stored-ok':
      tone = 'success';
      text = 'Las credenciales guardadas funcionan con Hacienda.';
      break;
    case 'rejected':
    case 'unreachable':
      tone = status.kind === 'rejected' ? 'error' : 'warning';
      text = status.action === 'save'
        ? `${status.message} No se guardó ningún cambio${credentialsSaved ? '; siguen activas las credenciales guardadas anteriormente' : ''}.`
        : status.kind === 'rejected'
          ? 'Hacienda rechazó las credenciales guardadas. Escribe la contraseña vigente y pulsa «Validar y actualizar».'
          : status.message;
      break;
    default:
      if (hasTypedPassword) {
        tone = 'warning';
        text = credentialsSaved
          ? 'Contraseña nueva sin guardar: pulsa «Validar y actualizar» para aplicarla.'
          : 'Contraseña sin guardar: pulsa «Validar y guardar».';
      }
  }
  const styles = {
    info: 'bg-blue-50 text-blue-800 border-blue-200',
    success: 'bg-green-50 text-green-800 border-green-200',
    warning: 'bg-amber-50 text-amber-800 border-amber-200',
    error: 'bg-red-50 text-red-700 border-red-200',
  };
  return (
    <div role="status" aria-live="polite" data-testid="credentials-status" data-state={!tone ? 'idle' : status.kind === 'idle' ? 'unsaved' : status.kind}>
      {tone && (
        <p className={['flex items-start gap-2 rounded-lg border px-3 py-2 text-xs', styles[tone]].join(' ')}>
          {tone === 'success' ? (
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          ) : (
            <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          )}
          <span>{text}</span>
        </p>
      )}
    </div>
  );
}

function toCredentialsFailure(err: unknown): CredentialsCheckFailure {
  if (err && typeof err === 'object' && 'kind' in err && 'message' in err) {
    return err as CredentialsCheckFailure;
  }
  return { kind: 'unreachable', message: (err as Error)?.message ?? 'No se pudo validar con Hacienda.' };
}

type SettingsForm = {
  ivaPercentage: number;
  invoicePrefix: string;
  currentInvoiceNumber: number;
  useSequentialControlNumbers: boolean;
  nextSequenceNumber: number;
  isPerceptionAgent: boolean;
};

const SECTION_IDS = {
  basicInfo: 'section-basic-info',
  env: 'section-env',
  cert: 'section-cert',
  credentials: 'section-credentials',
  settings: 'section-settings',
  activity: 'section-activity',
  location: 'section-location',
  logo: 'section-logo',
} as const;

interface BasicInfoForm {
  nombre: string;
  nombreComercial: string;
  nit: string;
  nrc: string;
  correo: string;
  telefono: string;
}

export default function CompanyConfigPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const toast = useToast();
  const [searchParams] = useSearchParams();

  const companies = useAppSelector(selectAllCompanies);
  const company = companies.find((c) => c.id === id) ?? null;
  // Production companies keep their own MH credentials and certificate.
  const isProductionCompany = company?.environment === CompanyEnvironment.Production;
  const currentTier = useAppSelector(selectCurrentTier);
  const isFreeTier = currentTier === SubscriptionTier.Lite;

  // Deep-link support: ?section=cert|credentials|env|settings|location|logo
  const targetSection = searchParams.get('section') as keyof typeof SECTION_IDS | null;
  useEffect(() => {
    if (!targetSection || !company) return;
    const elementId = SECTION_IDS[targetSection];
    if (!elementId) return;
    // Wait one tick so cards are in the DOM
    const t = setTimeout(() => {
      const el = document.getElementById(elementId);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('ring-2', 'ring-accent-400', 'ring-offset-2');
      setTimeout(
        () => el.classList.remove('ring-2', 'ring-accent-400', 'ring-offset-2'),
        2000,
      );
    }, 50);
    return () => clearTimeout(t);
  }, [targetSection, company]);

  const [showEnvConfirm, setShowEnvConfirm] = useState(false);
  const [certFileName, setCertFileName] = useState<string | null>(null);
  const [certFileRef, setCertFileRef] = useState<File | null>(null);
  const [savingCert, setSavingCert] = useState(false);
  const [showCertPassword, setShowCertPassword] = useState(false);
  const [showCertPasswordConfirm, setShowCertPasswordConfirm] = useState(false);
  const [showCredPassword, setShowCredPassword] = useState(false);
  const [credStatus, setCredStatus] = useState<CredStatus>({ kind: 'idle' });
  const [showRemoveCredsConfirm, setShowRemoveCredsConfirm] = useState(false);
  const [certPassword, setCertPassword] = useState('');
  const [certPasswordConfirm, setCertPasswordConfirm] = useState('');
  const [savingCertPassword, setSavingCertPassword] = useState(false);
  const [validatingCert, setValidatingCert] = useState(false);
  const [certPasswordSaved, setCertPasswordSaved] = useState(false);
  // Whether to show the password inputs (for "Cambiar contraseña" flow)
  const [showPasswordInputs, setShowPasswordInputs] = useState(false);
  // Cert validation result + metadata
  const [certValidationError, setCertValidationError] = useState<string | null>(null);
  const [certMeta, setCertMeta] = useState<{
    nit: string;
    activo: boolean;
    fingerprint: string;
    // No explicit expiry in this XML format — kept for future extension
  } | null>(null);
  const [showDeleteCertConfirm, setShowDeleteCertConfirm] = useState(false);
  const certFileInputRef = useRef<HTMLInputElement>(null);

  // A production company that never uploaded its own certificate signs with
  // the test company's.
  const [certInherited, setCertInherited] = useState(false);

  // Is there already a saved certificate password for this company's NIT?
  useEffect(() => {
    if (!company?.nit) return;
    SecureStorageService.getCertificatePassword(company.nit, isProductionCompany).then((p) => {
      setCertPasswordSaved(!!p);
    });
    SecureStorageService.usesInheritedCertificate(company.nit, isProductionCompany).then(setCertInherited);
  }, [company?.nit, isProductionCompany]);
  const [locationData, setLocationData] = useState({
    departamentoCode: company?.departamentoCode ?? '',
    departamento: company?.departamento ?? '',
    municipioCode: company?.municipioCode ?? '',
    municipio: company?.municipio ?? '',
    distritoCode: company?.distritoCode ?? '',
    distrito: company?.distrito ?? '',
  });
  const [savingLocation, setSavingLocation] = useState(false);
  // Re-seed when company loads asynchronously (deep-link / rehydration).
  // Without this, saving would overwrite the record with empty strings.
  useEffect(() => {
    if (!company) return;
    setLocationData({
      departamentoCode: company.departamentoCode ?? '',
      departamento: company.departamento ?? '',
      municipioCode: company.municipioCode ?? '',
      municipio: company.municipio ?? '',
      distritoCode: company.distritoCode ?? '',
      distrito: company.distrito ?? '',
    });
  }, [company?.id, company?.departamentoCode, company?.municipioCode, company?.distritoCode]);

  const [activityData, setActivityData] = useState({
    codActividad: company?.codActividad ?? '',
    descActividad: company?.descActividad ?? '',
    tipoEstablecimiento: company?.tipoEstablecimiento ?? '',
    establecimiento: company?.establecimiento ?? '',
  });
  const [savingActivity, setSavingActivity] = useState(false);
  useEffect(() => {
    if (!company) return;
    setActivityData({
      codActividad: company.codActividad ?? '',
      descActividad: company.descActividad ?? '',
      tipoEstablecimiento: company.tipoEstablecimiento ?? '',
      establecimiento: company.establecimiento ?? '',
    });
  }, [company?.id, company?.codActividad, company?.tipoEstablecimiento]);

  const credForm = useForm<CredentialsForm>({ defaultValues: { credPassword: '' } });
  const typedCredPassword = credForm.watch('credPassword');
  const [credentialsSaved, setCredentialsSaved] = useState(false);
  // A production company that never saved its own password uses the test
  // company's — Hacienda rejects it if the production password differs.
  const [credentialsInherited, setCredentialsInherited] = useState(false);

  // Check keychain on mount to show the "Guardadas" badge when credentials exist.
  useEffect(() => {
    if (!company?.nit) {
      setCredentialsSaved(false);
      setCredentialsInherited(false);
      return;
    }
    SecureStorageService.getCredentials(company.nit, isProductionCompany).then((stored) => {
      setCredentialsSaved(!!stored);
    });
    SecureStorageService.usesInheritedCredentials(company.nit, isProductionCompany).then(
      setCredentialsInherited,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company?.nit, isProductionCompany]);
  const basicInfoForm = useForm<BasicInfoForm>({
    defaultValues: {
      nombre: company?.nombre ?? '',
      nombreComercial: company?.nombreComercial ?? '',
      nit: company?.nit ?? '',
      nrc: company?.nrc ?? '',
      correo: company?.correo ?? '',
      telefono: company?.telefono ?? '',
    },
  });
  // Re-seed form when the company changes (after async load or update).
  useEffect(() => {
    if (!company) return;
    basicInfoForm.reset({
      nombre: company.nombre ?? '',
      nombreComercial: company.nombreComercial ?? '',
      nit: company.nit ?? '',
      nrc: company.nrc ?? '',
      correo: company.correo ?? '',
      telefono: company.telefono ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company?.id, company?.nombre, company?.nit, company?.nrc]);
  const [savingBasicInfo, setSavingBasicInfo] = useState(false);

  const settingsForm = useForm<SettingsForm>({
    defaultValues: {
      ivaPercentage: company?.ivaPercentage ?? 13,
      invoicePrefix: company?.invoicePrefix ?? '',
      currentInvoiceNumber: company?.currentInvoiceNumber ?? 1,
      useSequentialControlNumbers: company?.useSequentialControlNumbers ?? false,
      nextSequenceNumber: company?.nextSequenceNumber ?? 1,
      isPerceptionAgent: company?.isPerceptionAgent ?? false,
    },
  });
  // Re-seed when company loads asynchronously — without this, "Guardar"
  // overwrites currentInvoiceNumber with 1 and corrupts the DTE sequence.
  useEffect(() => {
    if (!company) return;
    settingsForm.reset({
      ivaPercentage: company.ivaPercentage ?? 13,
      invoicePrefix: company.invoicePrefix ?? '',
      currentInvoiceNumber: company.currentInvoiceNumber ?? 1,
      useSequentialControlNumbers: company.useSequentialControlNumbers ?? false,
      nextSequenceNumber: company.nextSequenceNumber ?? 1,
      isPerceptionAgent: company.isPerceptionAgent ?? false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    company?.id,
    company?.ivaPercentage,
    company?.invoicePrefix,
    company?.currentInvoiceNumber,
    company?.useSequentialControlNumbers,
    company?.nextSequenceNumber,
    company?.isPerceptionAgent,
  ]);

  if (!company) {
    return (
      <div data-testid="company-config" className="py-16 text-center text-brand-400">
        Empresa no encontrada.
      </div>
    );
  }

  const [promoting, setPromoting] = useState(false);

  async function handlePromoteToProduction() {
    setPromoting(true);
    try {
      const result = await dispatch(promoteToProduction(company!.id)).unwrap();
      if (result.kind === 'reused') {
        toast.info?.('Ya existe una empresa de producción para este NIT. Seleccionada.');
      } else {
        toast.success(
          'Empresa de producción creada. Configura certificado y credenciales de Hacienda.',
        );
      }
      // Navega a la configuración de la nueva (o reutilizada) empresa.
      navigate(
        `/companies/${result.kind === 'created' ? result.company.id : result.companyId}/config`,
      );
    } catch (err) {
      toast.error(typeof err === 'string' ? err : 'Error al promover a producción.');
    } finally {
      setPromoting(false);
    }
  }

  async function handleSaveCertPassword() {
    if (!company!.nit) {
      toast.error('La empresa no tiene NIT. Configúralo en "Información General".');
      return;
    }
    if (!certPassword) {
      toast.error('Ingresa la contraseña del certificado.');
      return;
    }
    if (certPassword !== certPasswordConfirm) {
      toast.error('Las contraseñas no coinciden.');
      return;
    }
    setSavingCertPassword(true);
    try {
      const hashedPassword = await sha512Hex(certPassword);
      await SecureStorageService.storeCertificatePassword(company!.nit, hashedPassword, isProductionCompany);
      setCertPasswordSaved(true);
      setCertPassword('');
      setCertPasswordConfirm('');
      setShowPasswordInputs(false);
      toast.success('Contraseña del certificado guardada.');
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Error al guardar la contraseña.');
    } finally {
      setSavingCertPassword(false);
    }
  }

  async function handleValidateCertificate() {
    if (!company!.nit) {
      toast.error('La empresa no tiene NIT.');
      return;
    }
    setValidatingCert(true);
    setCertValidationError(null);
    setCertMeta(null);
    try {
      const result = await CertificateService.validateCertificate(company!.nit, isProductionCompany);
      if (result.valid) {
        toast.success('Certificado válido — contraseña y archivo coinciden.');
        await dispatch(updateCompany({ id: company!.id, hasValidCertificate: true }));
        // Parse metadata to display in the panel
        const xmlContent = await SecureStorageService.getCertificateData(company!.nit, isProductionCompany);
        if (xmlContent) {
          try {
            const certData = parseCertificateXML(xmlContent);
            // Compute a short public-key fingerprint: first 16 + last 4 hex chars
            // of the public key clave (SHA-512 hash stored in XML)
            const fp = certData.publicKey.clave;
            const fingerprint = fp.length > 20
              ? `${fp.slice(0, 16)}…${fp.slice(-4)}`
              : fp;
            setCertMeta({
              nit: certData.nit,
              activo: certData.activo,
              fingerprint,
            });
          } catch {
            // Non-fatal: metadata display is best-effort
          }
        }
      } else {
        const errMsg = result.error ?? 'Certificado inválido.';
        setCertValidationError(errMsg);
        toast.error(errMsg);
      }
    } catch (err) {
      const errMsg = (err as Error)?.message ?? 'Error al validar el certificado.';
      setCertValidationError(errMsg);
      toast.error(errMsg);
    } finally {
      setValidatingCert(false);
    }
  }

  async function handleRemoveCertPassword() {
    if (!company!.nit) return;
    await SecureStorageService.removeCertificatePassword(company!.nit, isProductionCompany);
    // A production company falls back to the test company's password.
    setCertPasswordSaved(!!(await SecureStorageService.getCertificatePassword(company!.nit, isProductionCompany)));
    toast.success('Contraseña del certificado eliminada.');
  }

  async function handleRemoveCertificate() {
    if (!company!.nit) return;
    try {
      await CertificateService.removeCertificateForCompany(company!.nit, isProductionCompany);
      await dispatch(
        updateCompany({ id: company!.id, hasValidCertificate: false, hasCertificateFile: false }),
      );
      setCertPasswordSaved(!!(await SecureStorageService.getCertificatePassword(company!.nit, isProductionCompany)));
      setCertInherited(await SecureStorageService.usesInheritedCertificate(company!.nit, isProductionCompany));
      setCertMeta(null);
      setCertValidationError(null);
      setCertFileName(null);
      setCertFileRef(null);
      toast.success('Certificado eliminado.');
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Error al eliminar el certificado.');
    }
  }

  // One primary action — "Validar y guardar": the password is checked against
  // MH (the company's own environment) and written to the keychain ONLY when
  // Hacienda accepts it. There is deliberately no "test the typed password"
  // button: a successful test that saved nothing read as "saved" to users
  // (and used to stamp "Probadas el …" on credentials that were never stored).
  async function handleSaveCredentials(data: CredentialsForm) {
    if (!company!.nit) {
      toast.error('Esta empresa no tiene NIT configurado. Edítalo en "Información General".');
      return;
    }
    setCredStatus({ kind: 'checking', action: 'save' });
    try {
      await dispatch(
        validateCredentials({
          companyId: company!.id,
          credentials: { user: company!.nit, password: data.credPassword },
          isProduction: company!.environment === CompanyEnvironment.Production,
        }),
      ).unwrap();
      await SecureStorageService.storeCredentials(
        company!.nit,
        { user: company!.nit, password: data.credPassword },
        isProductionCompany,
      );
      await dispatch(
        updateCompany({
          id: company!.id,
          hasApiCredentials: true,
          credentialsLastTestedAt: new Date().toISOString(),
        }),
      );
      setCredentialsSaved(true);
      setCredentialsInherited(false);
      credForm.reset({ credPassword: '' });
      setCredStatus({ kind: 'saved' });
      toast.success('Credenciales validadas con Hacienda y guardadas.');
    } catch (err) {
      // Validation failed — nothing was written to the keychain.
      const failure = toCredentialsFailure(err);
      setCredStatus({ kind: failure.kind, action: 'save', message: failure.message });
      toast.error(`${failure.message} No se guardó ningún cambio.`);
    }
  }

  /** Checks the credentials ALREADY stored in the keychain (nothing is typed). */
  async function handleTestStoredCredentials() {
    if (!company!.nit) return;
    const stored = await SecureStorageService.getCredentials(company!.nit, isProductionCompany);
    if (!stored?.password) {
      setCredentialsSaved(false);
      toast.error('No hay credenciales guardadas para probar.');
      return;
    }
    setCredStatus({ kind: 'checking', action: 'test' });
    try {
      await dispatch(
        validateCredentials({
          companyId: company!.id,
          credentials: { user: stored.user || company!.nit, password: stored.password },
          isProduction: company!.environment === CompanyEnvironment.Production,
        }),
      ).unwrap();
      await dispatch(
        updateCompany({ id: company!.id, credentialsLastTestedAt: new Date().toISOString() }),
      );
      setCredStatus({ kind: 'stored-ok' });
      toast.success('Las credenciales guardadas funcionan con Hacienda.');
    } catch (err) {
      const failure = toCredentialsFailure(err);
      setCredStatus({ kind: failure.kind, action: 'test', message: failure.message });
      toast.error(failure.message);
    }
  }

  async function handleRemoveCredentials() {
    if (!company!.nit) return;
    await SecureStorageService.removeCredentials(company!.nit, isProductionCompany);
    await dispatch(updateCompany({ id: company!.id, hasApiCredentials: false }));
    credForm.reset({ credPassword: '' });
    // A production company falls back to the test company's credentials.
    const inherited = await SecureStorageService.usesInheritedCredentials(company!.nit, isProductionCompany);
    setCredentialsSaved(inherited);
    setCredentialsInherited(inherited);
    setCredStatus({ kind: 'idle' });
    toast.success('Credenciales eliminadas.');
  }

  async function handleSaveLocation() {
    // Validate the location subset against the MH `Direccion` schema.
    // Departamento must match CAT-012, municipio CAT-013. Saving an
    // invalid pair would silently break submissions later with [096].
    const result = validateCompanyForMH({
      ...company!,
      departamentoCode: locationData.departamentoCode,
      municipioCode: locationData.municipioCode,
    });
    const blocking = result.errors.filter(
      (e) => e.field === 'departamentoCode' || e.field === 'municipioCode',
    );
    if (blocking.length > 0) {
      toast.error(formatErrors(blocking) ?? 'Ubicación inválida.');
      return;
    }
    setSavingLocation(true);
    try {
      await dispatch(
        updateCompany({
          id: company!.id,
          departamentoCode: locationData.departamentoCode,
          departamento: locationData.departamento,
          municipioCode: locationData.municipioCode,
          municipio: locationData.municipio,
          distritoCode: locationData.distritoCode,
          distrito: locationData.distrito,
        })
      );
      toast.success('Ubicación guardada.');
    } finally {
      setSavingLocation(false);
    }
  }

  async function handleSaveActivity() {
    // Validate codActividad / descActividad / tipoEstablecimiento before
    // dispatching — these are MH `Emisor` schema fields and a bad value
    // here is the most common cause of [096] rejections in the field.
    const result = validateCompanyForMH({
      ...company!,
      codActividad: activityData.codActividad,
      descActividad: activityData.descActividad,
      tipoEstablecimiento: activityData.tipoEstablecimiento,
    });
    const blocking = result.errors.filter(
      (e) =>
        e.field === 'codActividad' ||
        e.field === 'descActividad' ||
        e.field === 'tipoEstablecimiento',
    );
    if (blocking.length > 0) {
      toast.error(formatErrors(blocking) ?? 'Actividad económica inválida.');
      return;
    }
    setSavingActivity(true);
    try {
      await dispatch(
        updateCompany({
          id: company!.id,
          codActividad: activityData.codActividad,
          descActividad: activityData.descActividad,
          tipoEstablecimiento: activityData.tipoEstablecimiento,
          establecimiento: activityData.establecimiento,
        })
      );
      toast.success('Actividad económica guardada.');
    } finally {
      setSavingActivity(false);
    }
  }

  async function handleSaveSettings(data: SettingsForm) {
    await dispatch(
      updateCompany({
        id: company!.id,
        ivaPercentage: data.ivaPercentage,
        invoicePrefix: data.invoicePrefix,
        currentInvoiceNumber: data.currentInvoiceNumber,
        useSequentialControlNumbers: data.useSequentialControlNumbers,
        nextSequenceNumber: data.nextSequenceNumber,
        isPerceptionAgent: data.isPerceptionAgent,
      })
    );
    toast.success('Configuración guardada.');
  }

  async function handleSaveBasicInfo(data: BasicInfoForm) {
    // Validate the basic-info subset against the MH `Emisor` schema. NIT
    // (9 or 14 digits, optionally dashed), NRC (1-8 digits), nombre
    // non-empty, telefono ≥8 digits, correo a valid email.
    const result = validateCompanyForMH({
      ...company!,
      nit: data.nit.trim(),
      nrc: data.nrc.trim(),
      nombre: data.nombre.trim(),
      telefono: data.telefono.trim(),
      correo: data.correo.trim(),
    });
    const blocking = result.errors.filter((e) =>
      ['nit', 'nrc', 'nombre', 'telefono', 'correo'].includes(e.field),
    );
    if (blocking.length > 0) {
      toast.error(formatErrors(blocking) ?? 'Información general inválida.');
      return;
    }
    setSavingBasicInfo(true);
    try {
      await dispatch(
        updateCompany({
          id: company!.id,
          nombre: data.nombre.trim(),
          nombreComercial: data.nombreComercial.trim() || data.nombre.trim(),
          nit: data.nit.trim(),
          nrc: data.nrc.trim(),
          correo: data.correo.trim(),
          telefono: data.telefono.trim(),
        }),
      );
      toast.success('Información general guardada.');
    } finally {
      setSavingBasicInfo(false);
    }
  }

  const isProduction = company.environment === CompanyEnvironment.Production;

  return (
    <div data-testid="company-config" className="max-w-2xl mx-auto space-y-6">
      <PageHeader
        title="Configuración de Empresa"
        subtitle={company.nombreComercial}
        actions={
          <Button variant="secondary" onClick={() => navigate(`/companies/${company.id}`)}>
            Volver
          </Button>
        }
      />

      {/* Basic info — editable so users can repair wiped fields */}
      <Card id={SECTION_IDS.basicInfo} className="scroll-mt-20 transition-shadow">
        <h2 className="font-semibold text-brand-800 mb-3">Información General</h2>
        <form
          onSubmit={basicInfoForm.handleSubmit(handleSaveBasicInfo)}
          className="space-y-3"
          data-testid="basic-info-form"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Razón Social"
              {...basicInfoForm.register('nombre', { required: 'Requerido' })}
              error={basicInfoForm.formState.errors.nombre?.message}
              data-testid="input-nombre"
            />
            <Input
              label="Nombre Comercial"
              {...basicInfoForm.register('nombreComercial')}
              data-testid="input-nombre-comercial"
            />
            <Input
              label="NIT"
              placeholder="NNNN-NNNNNN-NNN-N"
              {...basicInfoForm.register('nit', {
                required: 'NIT requerido',
                pattern: {
                  value: /^[0-9]{4}-?[0-9]{6}-?[0-9]{3}-?[0-9]$/,
                  message: 'Formato: NNNN-NNNNNN-NNN-N',
                },
              })}
              error={basicInfoForm.formState.errors.nit?.message}
              data-testid="input-nit"
            />
            <Input
              label="NRC"
              {...basicInfoForm.register('nrc', { required: 'NRC requerido' })}
              error={basicInfoForm.formState.errors.nrc?.message}
              data-testid="input-nrc"
            />
            <Input
              label="Correo"
              type="email"
              {...basicInfoForm.register('correo')}
              data-testid="input-correo"
            />
            <Input
              label="Teléfono"
              {...basicInfoForm.register('telefono')}
              data-testid="input-telefono"
            />
          </div>
          <div className="flex justify-end">
            <Button
              type="submit"
              variant="primary"
              loading={savingBasicInfo}
              data-testid="btn-save-basic-info"
            >
              Guardar
            </Button>
          </div>
        </form>
      </Card>

      {/* Environment */}
      <Card id={SECTION_IDS.env} className="scroll-mt-20 transition-shadow">
        <h2 className="font-semibold text-brand-800 mb-3">Ambiente</h2>
        <div className="flex items-center justify-between">
          <div>
            <Badge variant={isProduction ? 'success' : 'info'}>
              {isProduction ? 'Producción' : 'Desarrollo'}
            </Badge>
            <p className="text-xs text-brand-400 mt-1">
              {isProduction
                ? 'Documentos enviados al Ministerio de Hacienda real.'
                : 'Documentos de prueba, no tienen validez fiscal.'}
            </p>
          </div>
          {!isProduction && (
            <Button
              variant="primary"
              loading={promoting}
              onClick={() => setShowEnvConfirm(true)}
              data-testid="btn-promote-production"
            >
              Promover a Producción
            </Button>
          )}
        </div>
        {!isProduction && (
          <p className="text-xs text-brand-500 mt-3">
            Al promover se crea una NUEVA empresa de producción con el mismo
            NIT y datos, pero sin certificado, sin credenciales API y sin
            facturas/clientes/compras. La empresa de desarrollo actual se
            mantiene intacta para seguir probando.
          </p>
        )}
      </Card>

      {/* Certificado de Firma — unified 3-step card */}
      <Card id={SECTION_IDS.cert} className="scroll-mt-20 transition-shadow" data-testid="cert-card">
        {/* Header: title + single-source-of-truth status badge */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-brand-800">Certificado de Firma</h2>
          {(() => {
            if (!certPasswordSaved) {
              return <Badge variant="neutral" data-testid="cert-badge">Sin configurar</Badge>;
            }
            if (!company.hasCertificateFile) {
              return <Badge variant="warning" data-testid="cert-badge">Falta archivo</Badge>;
            }
            if (!company.hasValidCertificate) {
              return <Badge variant="info" data-testid="cert-badge">Pendiente de validar</Badge>;
            }
            return <Badge variant="success" data-testid="cert-badge">Válido</Badge>;
          })()}
        </div>

        {/* NIT guard — rendered FIRST, disables all steps when missing */}
        {!company.nit && (
          <div
            className="flex items-start gap-2 p-3 mb-4 rounded-lg bg-red-50 border border-red-200"
            data-testid="cert-nit-missing-alert"
          >
            <AlertCircle size={16} className="text-red-600 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-red-700">NIT no configurado</p>
              <p className="text-xs text-red-600 mt-0.5">
                El NIT es obligatorio para asociar el certificado a esta empresa.
              </p>
              <button
                type="button"
                className="text-xs text-red-700 underline mt-1 hover:text-red-900"
                onClick={() => {
                  const el = document.getElementById(SECTION_IDS.basicInfo);
                  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
              >
                Configurar NIT
              </button>
            </div>
          </div>
        )}

        {certInherited && (
          <p
            className="text-xs rounded-lg border px-3 py-2 mb-4 bg-amber-50 text-amber-800 border-amber-200"
            data-testid="cert-inherited"
          >
            Esta empresa de producción está firmando con el certificado de la
            empresa de pruebas. Si Hacienda te emitió un certificado de
            producción, guarda su contraseña (paso 1) y carga el archivo (paso
            2); la empresa de pruebas no se modifica.
          </p>
        )}

        <div className="space-y-5">
          {/* ── PASO 1: Contraseña ─────────────────────────────────────────── */}
          <div
            className={`rounded-lg border p-4 space-y-3 ${!company.nit ? 'opacity-50 pointer-events-none' : ''}`}
            data-testid="cert-step-1"
          >
            <div className="flex items-center gap-2">
              <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${certPasswordSaved ? 'bg-green-100 text-green-700' : 'bg-brand-100 text-brand-600'}`}>
                {certPasswordSaved ? <CheckCircle2 size={14} /> : '1'}
              </span>
              <span className="text-sm font-medium text-brand-800">Contraseña</span>
              {certPasswordSaved && !showPasswordInputs && (
                <button
                  type="button"
                  className="ml-auto text-xs text-accent-600 hover:text-accent-800 underline"
                  data-testid="cert-change-password-link"
                  onClick={() => setShowPasswordInputs(true)}
                >
                  Cambiar contraseña
                </button>
              )}
            </div>

            {certPasswordSaved && !showPasswordInputs ? (
              <p className="text-xs text-green-700 ml-8">
                Contraseña guardada en el llavero del sistema.
              </p>
            ) : (
              <>
                <p className="text-xs text-brand-500 ml-8">
                  Ingresa la contraseña privada del certificado de Hacienda. Se guarda
                  cifrada en tu dispositivo.
                </p>
                <div className="ml-8 space-y-3">
                  <Input
                    label="Contraseña"
                    type={showCertPassword ? 'text' : 'password'}
                    placeholder="Contraseña del certificado"
                    value={certPassword}
                    onChange={(e) => setCertPassword(e.target.value)}
                    data-testid="input-cert-password"
                    rightAddon={
                      <button
                        type="button"
                        onClick={() => setShowCertPassword((v) => !v)}
                        className="text-brand-400 hover:text-brand-700"
                        tabIndex={-1}
                        aria-label={showCertPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                        title={showCertPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      >
                        {showCertPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    }
                  />
                  <Input
                    label="Confirmar Contraseña"
                    type={showCertPasswordConfirm ? 'text' : 'password'}
                    placeholder="Repite la contraseña"
                    value={certPasswordConfirm}
                    onChange={(e) => setCertPasswordConfirm(e.target.value)}
                    data-testid="input-cert-password-confirm"
                    rightAddon={
                      <button
                        type="button"
                        onClick={() => setShowCertPasswordConfirm((v) => !v)}
                        className="text-brand-400 hover:text-brand-700"
                        tabIndex={-1}
                        aria-label={showCertPasswordConfirm ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                        title={showCertPasswordConfirm ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      >
                        {showCertPasswordConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    }
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleSaveCertPassword}
                      loading={savingCertPassword}
                      disabled={!certPassword}
                      data-testid="btn-save-cert-password"
                    >
                      {certPasswordSaved ? 'Actualizar Contraseña' : 'Guardar Contraseña'}
                    </Button>
                    {showPasswordInputs && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setShowPasswordInputs(false);
                          setCertPassword('');
                          setCertPasswordConfirm('');
                        }}
                      >
                        Cancelar
                      </Button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* ── PASO 2: Archivo .crt ──────────────────────────────────────── */}
          <div
            className={`rounded-lg border p-4 space-y-3 ${!certPasswordSaved || !company.nit ? 'opacity-50 pointer-events-none' : ''}`}
            data-testid="cert-step-2"
            title={!certPasswordSaved ? 'Guarda la contraseña primero (paso 1)' : undefined}
          >
            <div className="flex items-center gap-2">
              <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${company.hasCertificateFile ? 'bg-green-100 text-green-700' : 'bg-brand-100 text-brand-600'}`}>
                {company.hasCertificateFile ? <CheckCircle2 size={14} /> : '2'}
              </span>
              <span className="text-sm font-medium text-brand-800">Archivo .crt de Hacienda (XML)</span>
            </div>

            <div className="ml-8 space-y-2">
              <input
                ref={certFileInputRef}
                type="file"
                accept=".crt,.xml"
                data-testid="input-cert-file"
                className="block w-full text-sm text-brand-700 border border-brand-300 rounded-lg px-3 py-2 cursor-pointer hover:border-brand-400 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!certPasswordSaved || !company.nit}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  setCertFileName(file ? file.name : null);
                  setCertFileRef(file);
                }}
              />
              {certFileName && (
                <p className="text-xs text-green-600">Archivo seleccionado: {certFileName}</p>
              )}
              {company.hasCertificateFile && !certFileName && (
                <p className="text-xs text-brand-500">Archivo ya cargado. Selecciona uno nuevo para reemplazarlo.</p>
              )}
            </div>

            {certFileName && (
              <div className="ml-8">
                <Button
                  variant="primary"
                  size="sm"
                  loading={savingCert}
                  disabled={!certPasswordSaved || !company.nit}
                  data-testid="btn-save-cert-file"
                  onClick={async () => {
                    if (!certFileRef || !company!.nit) return;
                    setSavingCert(true);
                    try {
                      const xmlContent = await certFileRef.text();
                      // Retrieve the already-saved hash (step 1 guarantees it exists)
                      const storedHash = await SecureStorageService.getCertificatePassword(company!.nit, isProductionCompany) ?? '';
                      await CertificateService.storeCertificateForCompany(
                        company!.nit,
                        xmlContent,
                        storedHash,
                        isProductionCompany,
                      );
                      setCertInherited(false);
                      // Mark file as uploaded WITHOUT setting hasValidCertificate — that
                      // requires explicit validation in step 3 to prevent false positives.
                      await dispatch(updateCompany({ id: company!.id, hasCertificateFile: true }));
                      toast.success('Archivo .crt guardado. Valida el certificado en el paso 3.');
                      setCertFileName(null);
                      setCertFileRef(null);
                      if (certFileInputRef.current) certFileInputRef.current.value = '';
                    } catch (err) {
                      toast.error((err as Error)?.message ?? 'Error al guardar el certificado.');
                    } finally {
                      setSavingCert(false);
                    }
                  }}
                >
                  Guardar Certificado
                </Button>
              </div>
            )}
          </div>

          {/* ── PASO 3: Validar ───────────────────────────────────────────── */}
          <div
            className={`rounded-lg border p-4 space-y-3 ${!company.hasCertificateFile || !company.nit ? 'opacity-50 pointer-events-none' : ''}`}
            data-testid="cert-step-3"
            title={!company.hasCertificateFile ? 'Carga el archivo .crt primero (paso 2)' : undefined}
          >
            <div className="flex items-center gap-2">
              <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${company.hasValidCertificate ? 'bg-green-100 text-green-700' : 'bg-brand-100 text-brand-600'}`}>
                {company.hasValidCertificate ? <CheckCircle2 size={14} /> : '3'}
              </span>
              <span className="text-sm font-medium text-brand-800">Validar</span>
            </div>

            <div className="ml-8 space-y-3">
              <p className="text-xs text-brand-500">
                Verifica que la contraseña y el archivo coinciden. Esta es la única
                acción que activa el estado "Válido".
              </p>

              <Button
                variant="secondary"
                size="sm"
                onClick={handleValidateCertificate}
                loading={validatingCert}
                disabled={!company.hasCertificateFile || !company.nit}
                data-testid="btn-validate-cert"
              >
                Validar Certificado
              </Button>

              {/* Failure banner */}
              {certValidationError && (
                <div
                  className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200"
                  data-testid="cert-validation-error"
                >
                  <AlertCircle size={14} className="text-red-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-red-700">{certValidationError}</p>
                </div>
              )}

              {/* Metadata panel — shown after successful validation */}
              {company.hasValidCertificate && certMeta && (
                <div
                  className="rounded-lg bg-green-50 border border-green-200 p-3 space-y-1.5"
                  data-testid="cert-metadata-panel"
                >
                  <p className="text-xs font-semibold text-green-800 mb-1">Detalles del certificado</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <span className="text-xs text-brand-500">NIT propietario</span>
                    <span className="text-xs text-brand-800 font-mono" data-testid="cert-meta-nit">{certMeta.nit || '—'}</span>
                    <span className="text-xs text-brand-500">Activo</span>
                    <span className={`text-xs font-medium ${certMeta.activo ? 'text-green-700' : 'text-red-600'}`} data-testid="cert-meta-activo">
                      {certMeta.activo ? 'Sí' : 'No'}
                    </span>
                    <span className="text-xs text-brand-500">Huella (clave pública)</span>
                    <span className="text-xs text-brand-800 font-mono break-all" data-testid="cert-meta-fingerprint">{certMeta.fingerprint}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Eliminar certificado ──────────────────────────────────────── */}
          {(company.hasCertificateFile || company.hasValidCertificate) && (
            <div className="pt-1 border-t border-brand-100">
              <Button
                variant="danger"
                size="sm"
                onClick={() => setShowDeleteCertConfirm(true)}
                disabled={!company.nit}
                data-testid="btn-delete-cert"
              >
                Eliminar Certificado
              </Button>
            </div>
          )}
        </div>
      </Card>

      <ConfirmDialog
        isOpen={showDeleteCertConfirm}
        onClose={() => setShowDeleteCertConfirm(false)}
        onConfirm={handleRemoveCertificate}
        title="Eliminar Certificado"
        message="Se eliminarán el archivo .crt, la contraseña y la caché de firma. Deberás volver a configurarlos para enviar DTE. ¿Continuar?"
        confirmLabel="Eliminar"
        variant="danger"
      />

      {/* API Credentials */}
      <Card id={SECTION_IDS.credentials} className="scroll-mt-20 transition-shadow">
        <div className="flex items-start justify-between mb-1">
          <h2 className="font-semibold text-brand-800">Credenciales API</h2>
          <div className="text-right">
            {credentialsSaved ? (
              <span data-testid="credentials-saved-badge">
                <Badge variant="success">Guardadas</Badge>
              </span>
            ) : (
              <span data-testid="credentials-missing-badge">
                <Badge variant="neutral">Sin guardar</Badge>
              </span>
            )}
            {credentialsSaved && company.credentialsLastTestedAt && (
              <p className="text-xs text-brand-400 mt-1" data-testid="credentials-last-tested">
                Probadas el{' '}
                {new Date(company.credentialsLastTestedAt).toLocaleString('es-SV')}
              </p>
            )}
          </div>
        </div>
        <p className="text-xs text-brand-500 mb-3">
          Usuario y contraseña de la API de Hacienda para esta empresa. Se
          almacenan cifradas en el llavero del sistema (safeStorage).
        </p>
        {credentialsInherited && (
          <p
            className="text-xs rounded-lg border px-3 py-2 mb-3 bg-amber-50 text-amber-800 border-amber-200"
            data-testid="credentials-inherited"
          >
            Esta empresa de producción está usando la contraseña guardada en la
            empresa de pruebas. La contraseña de API de producción puede ser
            distinta: si Hacienda la rechaza, escribe la de producción y pulsa
            «Validar y actualizar».
          </p>
        )}
        <form onSubmit={credForm.handleSubmit(handleSaveCredentials)} className="space-y-3">
          <div>
            <label className="text-sm font-medium text-brand-700 block mb-1">NIT (Usuario API)</label>
            <div className="px-3 py-2 rounded-lg bg-brand-50 border border-brand-200 text-sm text-brand-700 font-mono">
              {company.nit || <span className="text-brand-400 italic">No configurado</span>}
            </div>
          </div>
          <Input
            label={credentialsSaved ? 'Nueva contraseña' : 'Contraseña'}
            type={showCredPassword ? 'text' : 'password'}
            placeholder={credentialsSaved ? 'Escríbela solo si cambió' : 'Contraseña de Hacienda'}
            data-testid="input-cred-password"
            helperText={`Al guardar, primero se valida con Hacienda (ambiente de ${
              company.environment === CompanyEnvironment.Production ? 'producción' : 'pruebas'
            }); solo se guarda si Hacienda la acepta.`}
            {...credForm.register('credPassword', {
              required: 'Ingresa la contraseña de Hacienda',
              // Editing after a result clears it — the status line then
              // describes the new, not-yet-saved value.
              onChange: () => setCredStatus((prev) => (prev.kind === 'checking' ? prev : { kind: 'idle' })),
            })}
            error={credForm.formState.errors.credPassword?.message}
            rightAddon={
              <button
                type="button"
                onClick={() => setShowCredPassword((v) => !v)}
                className="text-brand-400 hover:text-brand-700"
                tabIndex={-1}
                aria-label={showCredPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                title={showCredPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showCredPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            }
          />
          <CredentialsStatusLine
            status={credStatus}
            hasTypedPassword={!!typedCredPassword}
            credentialsSaved={credentialsSaved}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant="primary"
              loading={credStatus.kind === 'checking' && credStatus.action === 'save'}
              disabled={!company.nit || !typedCredPassword || credStatus.kind === 'checking'}
              data-testid="btn-save-credentials"
            >
              {credentialsSaved ? 'Validar y actualizar' : 'Validar y guardar'}
            </Button>
            {credentialsSaved && (
              <Button
                type="button"
                variant="secondary"
                loading={credStatus.kind === 'checking' && credStatus.action === 'test'}
                // With a new password typed, the only meaningful action is to
                // validate + save it; testing now would check the OLD one.
                disabled={!!typedCredPassword || credStatus.kind === 'checking'}
                title={
                  typedCredPassword
                    ? 'Primero guarda o borra la contraseña nueva'
                    : 'Comprueba con Hacienda las credenciales ya guardadas'
                }
                onClick={() => { void handleTestStoredCredentials(); }}
                data-testid="btn-test-credentials"
              >
                Probar credenciales guardadas
              </Button>
            )}
            {credentialsSaved && (
              <Button
                type="button"
                variant="danger"
                onClick={() => setShowRemoveCredsConfirm(true)}
                disabled={credStatus.kind === 'checking'}
                data-testid="btn-remove-credentials"
              >
                Eliminar
              </Button>
            )}
          </div>
        </form>
      </Card>
      <ConfirmDialog
        isOpen={showRemoveCredsConfirm}
        onClose={() => setShowRemoveCredsConfirm(false)}
        onConfirm={() => { void handleRemoveCredentials(); }}
        title="Eliminar credenciales"
        message="Se eliminarán del llavero el usuario y la contraseña de Hacienda de esta empresa. No podrás enviar DTEs hasta volver a guardarlas. ¿Continuar?"
        confirmLabel="Eliminar"
        variant="danger"
      />

      {/* Invoice Settings */}
      <Card id={SECTION_IDS.settings} className="scroll-mt-20 transition-shadow">
        <h2 className="font-semibold text-brand-800 mb-3">Configuración de Facturas</h2>
        <form onSubmit={settingsForm.handleSubmit(handleSaveSettings)} className="space-y-3">
          <Input
            label="Porcentaje IVA (%)"
            type="number"
            {...settingsForm.register('ivaPercentage', { valueAsNumber: true, min: 0, max: 100 })}
          />
          <Input
            label="Prefijo de Factura"
            placeholder="FC"
            {...settingsForm.register('invoicePrefix')}
          />
          <Input
            label="Número Actual de Factura"
            type="number"
            {...settingsForm.register('currentInvoiceNumber', { valueAsNumber: true, min: 1 })}
          />

          {/* Numeración secuencial del numeroControl MH.
              Cuando está activa, el sufijo de 15 dígitos del controlNumber
              usa este contador (000000000000001, 000000000000002, …) en
              lugar del valor derivado de timestamp. Requiere un solo
              dispositivo activo a la vez para evitar colisiones. */}
          <div className="pt-2 border-t border-brand-100 space-y-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                {...settingsForm.register('useSequentialControlNumbers')}
                className="mt-0.5 h-4 w-4 rounded border-brand-300 text-accent-600 focus:ring-accent-500"
              />
              <div className="flex-1">
                <p className="text-sm font-medium text-brand-800">
                  Usar números de control secuenciales
                </p>
                <p className="text-xs text-brand-500">
                  Genera <span className="font-mono">DTE-XX-…-000000000000001</span> en
                  lugar del sufijo derivado de timestamp. Útil para tener una
                  numeración legible en MH. <strong>Requiere uso en un solo
                  dispositivo</strong> para evitar colisiones.
                </p>
              </div>
            </label>
            <Input
              label="Próximo número de control"
              type="number"
              {...settingsForm.register('nextSequenceNumber', { valueAsNumber: true, min: 1 })}
              helperText="El siguiente DTE enviado usará este número (zero-padded a 15 dígitos). Se incrementa automáticamente con cada envío."
              disabled={!settingsForm.watch('useSequentialControlNumbers')}
            />
          </div>

          {/* IVA percepción 1% (Código Tributario art. 163) — only taxpayers
              the DGII designated as agentes de percepción. */}
          <div className="pt-2 border-t border-brand-100">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                data-testid="company-perception-agent"
                {...settingsForm.register('isPerceptionAgent')}
                className="mt-0.5 h-4 w-4 rounded border-brand-300 text-accent-600 focus:ring-accent-500"
              />
              <div className="flex-1">
                <p className="text-sm font-medium text-brand-800">
                  Agente de percepción de IVA (1%)
                </p>
                <p className="text-xs text-brand-500">
                  Actívalo solo si Hacienda te designó agente de percepción. Tus CCF
                  de $100.00 o más (sin IVA) a clientes que no son grandes
                  contribuyentes suman el 1% de IVA percibido.
                </p>
              </div>
            </label>
          </div>

          <Button type="submit" variant="primary">
            Guardar Configuración
          </Button>
        </form>
      </Card>

      {/* Economic Activity */}
      <Card id={SECTION_IDS.activity} className="space-y-3 scroll-mt-20 transition-shadow">
        <h2 className="font-semibold text-brand-800">Actividad Económica</h2>
        <CatalogPicker
          catalogId={GovernmentCatalogId.ECONOMIC_ACTIVITIES}
          label="Actividad Económica"
          placeholder="Seleccione una actividad económica"
          value={activityData.codActividad}
          description={activityData.descActividad}
          onChange={(code, desc) =>
            setActivityData((prev) => ({ ...prev, codActividad: code, descActividad: desc }))
          }
        />
        <CatalogPicker
          catalogId={GovernmentCatalogId.ESTABLISHMENT_TYPES}
          label="Tipo de Establecimiento"
          placeholder="Seleccione tipo de establecimiento"
          value={activityData.tipoEstablecimiento}
          description={activityData.establecimiento}
          onChange={(code, desc) =>
            setActivityData((prev) => ({ ...prev, tipoEstablecimiento: code, establecimiento: desc }))
          }
        />
        <Button variant="primary" loading={savingActivity} onClick={handleSaveActivity}>
          Guardar Actividad
        </Button>
      </Card>

      {/* Location */}
      <Card id={SECTION_IDS.location} className="space-y-3 scroll-mt-20 transition-shadow">
        <h2 className="font-semibold text-brand-800">Ubicación</h2>
        <LocationDropdowns
          departamentoCode={locationData.departamentoCode}
          departamento={locationData.departamento}
          municipioCode={locationData.municipioCode}
          municipio={locationData.municipio}
          distritoCode={locationData.distritoCode}
          distrito={locationData.distrito}
          onDepartamentoChange={(code, name) =>
            setLocationData((prev) => ({
              ...prev,
              departamentoCode: code,
              departamento: name,
              municipioCode: '',
              municipio: '',
              distritoCode: '',
              distrito: '',
            }))
          }
          onMunicipioChange={(code, name) =>
            setLocationData((prev) => ({
              ...prev,
              municipioCode: code,
              municipio: name,
              distritoCode: '',
              distrito: '',
            }))
          }
          onDistritoChange={(code, name) =>
            setLocationData((prev) => ({ ...prev, distritoCode: code, distrito: name }))
          }
        />
        <Button variant="primary" loading={savingLocation} onClick={handleSaveLocation}>
          Guardar Ubicación
        </Button>
      </Card>

      {/* Logo */}
      <Card id={SECTION_IDS.logo} className="scroll-mt-20 transition-shadow">
        <h2 className="font-semibold text-brand-800 mb-3">Logo</h2>
        <LogoEditor
          companyId={company.id}
          logoUrl={company.logoUrl ?? company.invoiceLogo}
          logoWidth={company.logoWidth ?? 100}
          logoHeight={company.logoHeight ?? 100}
          isFreeTier={isFreeTier}
        />
      </Card>

      <ConfirmDialog
        isOpen={showEnvConfirm}
        onClose={() => setShowEnvConfirm(false)}
        onConfirm={handlePromoteToProduction}
        title="Promover a Producción"
        message={
          'Se creará una nueva empresa de Producción con el mismo NIT y datos '
          + 'de contacto. La nueva empresa empieza SIN certificado, SIN '
          + 'credenciales de Hacienda y SIN historial (facturas, clientes, '
          + 'productos, compras). La empresa actual queda intacta. ¿Continuar?'
        }
        confirmLabel="Promover"
        variant="danger"
      />
    </div>
  );
}
