import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { ChevronRight, ChevronLeft, CheckCircle, Building2, ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Card } from '@/components/common/Card';
import { SubscriptionModal } from '@/components/modals/SubscriptionModal';
import { LocationDropdowns } from '@/components/forms/LocationDropdowns';
import { CatalogPicker } from '@/components/forms/CatalogPicker';
import { GovernmentCatalogId } from '@/types/catalog';
import { useToast } from '@/components/common/Toast';
import { useAppDispatch, useAppSelector } from '@/store';
import { selectAllCompanies, selectCurrentTier } from '@/store';
import { canCreateCompany, getMaxCompanies } from '@/services/subscription/FeatureGate';
import { createCompany, updateCompany } from '@/store/slices/companySlice';
import { CreateCompanyInput, CompanyEnvironment } from '@/types/company';
import { CertificateService } from '@/services/security/CertificateService';

async function sha512Hex(text: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = (window as any).electronAPI;
  if (api?.sha512) {
    return api.sha512(text) as Promise<string>;
  }
  const msgBuffer = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-512', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const STEPS = [
  { label: 'Información Básica', description: 'Nombre, NIT y NRC' },
  { label: 'Contacto y Ubicación', description: 'Correo, teléfono y dirección' },
  { label: 'Actividad Económica', description: 'Actividad y establecimiento' },
  { label: 'Certificado', description: 'Carga de certificado digital' },
];

type FormData = {
  nombre: string;
  nombreComercial: string;
  nit: string;
  nrc: string;
  correo: string;
  telefono: string;
  complemento: string;
  departamentoCode: string;
  departamento: string;
  municipioCode: string;
  municipio: string;
  distritoCode: string;
  distrito: string;
  codActividad: string;
  descActividad: string;
  tipoEstablecimiento: string;
  establecimiento: string;
  certificatePassword: string;
};

export default function CreateCompanyPage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const toast = useToast();
  const tier = useAppSelector(selectCurrentTier);
  const companies = useAppSelector(selectAllCompanies);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [step, setStep] = useState(0);
  const [certFileName, setCertFileName] = useState<string | null>(null);
  const [certFileRef, setCertFileRef] = useState<File | null>(null);
  const certFileInputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    trigger,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    defaultValues: {
      nombre: '',
      nombreComercial: '',
      nit: '',
      nrc: '',
      correo: '',
      telefono: '',
      complemento: '',
      departamentoCode: '',
      departamento: '',
      municipioCode: '',
      municipio: '',
      distritoCode: '',
      distrito: '',
      codActividad: '',
      descActividad: '',
      tipoEstablecimiento: '',
      establecimiento: '',
      certificatePassword: '',
    },
  });

  const departamentoCode = watch('departamentoCode');
  const departamento = watch('departamento');
  const municipioCode = watch('municipioCode');
  const municipio = watch('municipio');
  const distritoCode = watch('distritoCode');
  const distrito = watch('distrito');

  const stepFields: (keyof FormData)[][] = [
    ['nombre', 'nombreComercial', 'nit', 'nrc'],
    ['correo', 'telefono', 'complemento', 'departamentoCode', 'departamento', 'municipioCode', 'municipio'],
    ['codActividad', 'descActividad', 'tipoEstablecimiento', 'establecimiento'],
    ['certificatePassword'],
  ];

  async function handleNext() {
    const valid = await trigger(stepFields[step]);
    if (valid) setStep((s) => s + 1);
  }

  async function onSubmit(data: FormData) {
    setSubmitting(true);
    try {
      const input: CreateCompanyInput = {
        nombre: data.nombre,
        nombreComercial: data.nombreComercial,
        nit: data.nit || undefined,
        nrc: data.nrc || undefined,
        correo: data.correo,
        telefono: data.telefono || undefined,
        complemento: data.complemento,
        departamentoCode: data.departamentoCode,
        departamento: data.departamento,
        municipioCode: data.municipioCode,
        municipio: data.municipio,
        distritoCode: data.distritoCode || undefined,
        distrito: data.distrito || undefined,
        codActividad: data.codActividad,
        descActividad: data.descActividad,
        tipoEstablecimiento: data.tipoEstablecimiento,
        establecimiento: data.establecimiento,
        codEstableMH: 'M001',
        codEstable: '',
        codPuntoVentaMH: 'P001',
        codPuntoVenta: '',
        environment: CompanyEnvironment.Development,
        ivaPercentage: 13,
      };
      const result = await dispatch(createCompany(input)).unwrap();

      // If the user selected a certificate file, store it now that we have the NIT.
      if (certFileRef && result.nit && data.certificatePassword) {
        try {
          const xmlContent = await certFileRef.text();
          const hashedPassword = await sha512Hex(data.certificatePassword);
          await CertificateService.storeCertificateForCompany(result.nit, xmlContent, hashedPassword);
          await dispatch(updateCompany({ id: result.id, hasCertificateFile: true }));
        } catch (certErr) {
          toast.error(
            `Empresa creada, pero el certificado no se pudo guardar: ${certErr instanceof Error ? certErr.message : 'Error desconocido'}. Configúralo desde la pantalla de la empresa.`
          );
          navigate(`/companies/${result.id}`);
          return;
        }
      }

      toast.success(`Empresa "${result.nombreComercial}" creada correctamente.`);
      navigate(`/companies/${result.id}`);
    } catch {
      toast.error('Error al crear la empresa. Inténtalo de nuevo.');
    } finally {
      setSubmitting(false);
    }
  }

  // Tier gate — the wizard must not be reachable once the plan's company
  // limit is reached (Lite=1, Pro=2, Business=∞ — FeatureGate.getMaxCompanies). Tests seed a Pro-tier state
  // specifically so this gate stays open for them.
  const maxCompanies = getMaxCompanies(tier);
  const limitReached = !canCreateCompany(tier, companies.length);

  if (limitReached) {
    return (
      <div data-testid="company-limit-reached" className="max-w-lg mx-auto py-10 space-y-6">
        <PageHeader title="Nueva Empresa" />
        <Card className="text-center space-y-4 py-10">
          <Building2 size={40} className="mx-auto text-brand-300" />
          <div className="space-y-1">
            <p className="font-semibold text-brand-800">
              Límite de empresas de tu plan alcanzado
            </p>
            <p className="text-sm text-brand-500">
              Tu plan actual permite {maxCompanies === Infinity ? 'empresas ilimitadas' : `${maxCompanies} empresa${maxCompanies === 1 ? '' : 's'}`} y ya tienes {companies.length}.
              Actualiza para agregar más empresas.
            </p>
          </div>
          <div className="flex justify-center gap-2 pt-2">
            <Button variant="secondary" icon={<ArrowLeft size={16} />} onClick={() => navigate('/companies')}>
              Volver
            </Button>
            <Button variant="primary" onClick={() => setShowUpgradeModal(true)}>
              Ver planes
            </Button>
          </div>
        </Card>
        <SubscriptionModal isOpen={showUpgradeModal} onClose={() => setShowUpgradeModal(false)} />
      </div>
    );
  }

  return (
    <div data-testid="create-company" className="max-w-2xl mx-auto">
      <PageHeader
        title="Nueva Empresa"
        subtitle="Registrar empresa para facturación electrónica"
      />

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8">
        {STEPS.map((s, i) => (
          <div key={i} className="flex items-center gap-2 flex-1">
            <div
              className={[
                'w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0',
                i < step
                  ? 'bg-green-500 text-white'
                  : i === step
                  ? 'bg-accent-600 text-white'
                  : 'bg-brand-100 text-brand-400',
              ].join(' ')}
            >
              {i < step ? <CheckCircle size={16} /> : i + 1}
            </div>
            <div className="hidden sm:block">
              <p className={`text-xs font-medium ${i === step ? 'text-brand-900' : 'text-brand-400'}`}>
                {s.label}
              </p>
              <p className="text-xs text-brand-400">{s.description}</p>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-px flex-1 mx-2 ${i < step ? 'bg-green-400' : 'bg-brand-200'}`} />
            )}
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit(onSubmit)}>
        <Card className="mb-6">
          {/* Step 1 */}
          {step === 0 && (
            <div className="space-y-4">
              <h3 className="font-semibold text-brand-800">Información Básica</h3>
              <Input
                label="Nombre Legal"
                required
                {...register('nombre', { required: 'El nombre legal es requerido' })}
                error={errors.nombre?.message}
              />
              <Input
                label="Nombre Comercial"
                required
                {...register('nombreComercial', { required: 'El nombre comercial es requerido' })}
                error={errors.nombreComercial?.message}
              />
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="NIT"
                  placeholder="0000-000000-000-0"
                  {...register('nit')}
                  error={errors.nit?.message}
                />
                <Input
                  label="NRC"
                  placeholder="000000-0"
                  {...register('nrc')}
                  error={errors.nrc?.message}
                />
              </div>
            </div>
          )}

          {/* Step 2 */}
          {step === 1 && (
            <div className="space-y-4">
              <h3 className="font-semibold text-brand-800">Contacto y Ubicación</h3>
              <Input
                label="Correo Electrónico"
                type="email"
                required
                {...register('correo', {
                  required: 'El correo es requerido',
                  pattern: { value: /^\S+@\S+\.\S+$/, message: 'Correo inválido' },
                })}
                error={errors.correo?.message}
              />
              <Input
                label="Teléfono"
                placeholder="2222-2222"
                {...register('telefono')}
                error={errors.telefono?.message}
              />
              <Input
                label="Dirección (Complemento)"
                required
                {...register('complemento', { required: 'La dirección es requerida' })}
                error={errors.complemento?.message}
              />
              <LocationDropdowns
                departamentoCode={departamentoCode}
                departamento={departamento}
                municipioCode={municipioCode}
                municipio={municipio}
                distritoCode={distritoCode}
                distrito={distrito}
                onDepartamentoChange={(code, name) => {
                  setValue('departamentoCode', code);
                  setValue('departamento', name);
                  setValue('municipioCode', '');
                  setValue('municipio', '');
                  setValue('distritoCode', '');
                  setValue('distrito', '');
                }}
                onMunicipioChange={(code, name) => {
                  setValue('municipioCode', code);
                  setValue('municipio', name);
                  setValue('distritoCode', '');
                  setValue('distrito', '');
                }}
                onDistritoChange={(code, name) => {
                  setValue('distritoCode', code);
                  setValue('distrito', name);
                }}
              />
            </div>
          )}

          {/* Step 3 */}
          {step === 2 && (
            <div className="space-y-4">
              <h3 className="font-semibold text-brand-800">Actividad Económica</h3>
              <CatalogPicker
                catalogId={GovernmentCatalogId.ECONOMIC_ACTIVITIES}
                label="Actividad Económica"
                placeholder="Seleccione una actividad económica"
                value={watch('codActividad')}
                description={watch('descActividad')}
                onChange={(code, desc) => {
                  setValue('codActividad', code, { shouldValidate: true });
                  setValue('descActividad', desc, { shouldValidate: true });
                }}
                required
                error={errors.codActividad?.message}
              />
              <input type="hidden" {...register('codActividad', { required: 'Selecciona una actividad económica' })} />
              <input type="hidden" {...register('descActividad', { required: true })} />

              <CatalogPicker
                catalogId={GovernmentCatalogId.ESTABLISHMENT_TYPES}
                label="Tipo de Establecimiento"
                placeholder="Seleccione tipo de establecimiento"
                value={watch('tipoEstablecimiento')}
                description={watch('establecimiento')}
                onChange={(code, desc) => {
                  setValue('tipoEstablecimiento', code, { shouldValidate: true });
                  setValue('establecimiento', desc, { shouldValidate: true });
                }}
                required
                error={errors.tipoEstablecimiento?.message}
              />
              <input type="hidden" {...register('tipoEstablecimiento', { required: 'Selecciona un tipo de establecimiento' })} />
              <input type="hidden" {...register('establecimiento', { required: true })} />
            </div>
          )}

          {/* Step 4 */}
          {step === 3 && (
            <div className="space-y-4">
              <h3 className="font-semibold text-brand-800">Certificado Digital</h3>
              <div>
                <label className="text-sm font-medium text-brand-700 block mb-1">
                  Archivo de Certificado (.crt XML de Hacienda)
                </label>
                <input
                  ref={certFileInputRef}
                  type="file"
                  accept=".crt,.xml"
                  className="block w-full text-sm text-brand-700 border border-brand-300 rounded-lg px-3 py-2 cursor-pointer hover:border-brand-400"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    setCertFileName(file ? file.name : null);
                    setCertFileRef(file);
                  }}
                />
                {certFileName && (
                  <p className="text-xs text-green-600 mt-1">Archivo seleccionado: {certFileName}</p>
                )}
                <p className="text-xs text-brand-400 mt-1">
                  Opcional — puedes configurarlo más tarde en Editar Configuración.
                </p>
              </div>
              <Input
                label="Contraseña del Certificado"
                type="password"
                placeholder="Contraseña privada del certificado de Hacienda"
                {...register('certificatePassword')}
                error={errors.certificatePassword?.message}
              />
            </div>
          )}
        </Card>

        <div className="flex justify-between">
          <Button
            type="button"
            variant="secondary"
            icon={<ChevronLeft size={16} />}
            onClick={() => setStep((s) => s - 1)}
            disabled={step === 0}
          >
            Anterior
          </Button>

          {step < STEPS.length - 1 ? (
            <Button
              type="button"
              variant="primary"
              onClick={handleNext}
            >
              Siguiente <ChevronRight size={16} className="ml-1" />
            </Button>
          ) : (
            <Button
              type="submit"
              variant="primary"
              loading={submitting}
            >
              Crear Empresa
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
