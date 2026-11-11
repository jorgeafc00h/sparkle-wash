import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { ArrowLeft, Building2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { FormField } from '@/components/forms/FormField';
import { LocationDropdowns } from '@/components/forms/LocationDropdowns';
import { useToast } from '@/components/common/Toast';
import { useAppSelector, useAppDispatch } from '@/store';
import { selectAllCustomers } from '@/store/selectors/customerSelectors';
import { selectSelectedCompanyId } from '@/store/selectors/companySelectors';
import { createCustomer, updateCustomerAsync } from '@/store/slices/customerSlice';
import { CustomerType, CustomerDocumentType } from '@/types/customer';
import {
  validateCustomerForMH,
  formatErrors,
} from '@/services/validation/MHSchemaValidator';

interface CustomerFormValues {
  firstName: string;
  lastName: string;
  businessName: string;
  nationalId: string;
  nit: string;
  nrc: string;
  documentType: string;
  customerType: string;
  email: string;
  phone: string;
  address: string;
  department: string;
  departmentCode: string;
  municipality: string;
  municipalityCode: string;
  district: string;
  districtCode: string;
  hasContributorRetention: boolean;
  isLargeTaxpayer: boolean;
  // Export
  codPais: string;
  nombrePais: string;
  tipoPersona: string;
}

const customerTypeOptions = [
  { value: String(CustomerType.Individual), label: 'Individual' },
  { value: String(CustomerType.Business), label: 'Empresa' },
  { value: String(CustomerType.Government), label: 'Gobierno' },
];

const documentTypeOptions = [
  { value: CustomerDocumentType.DUI, label: 'DUI' },
  { value: CustomerDocumentType.NIT, label: 'NIT' },
  { value: CustomerDocumentType.PASSPORT, label: 'Pasaporte' },
  { value: CustomerDocumentType.CARNET_RESIDENTE, label: 'Carnet Residente' },
  { value: CustomerDocumentType.OTHER, label: 'Otro' },
];

const tipoPersonaOptions = [
  { value: 'N', label: 'Natural' },
  { value: 'J', label: 'Jurídica' },
];

export default function CustomerFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const toast = useToast();

  const isEdit = !!id;
  const customers = useAppSelector(selectAllCustomers);
  const selectedCompanyId = useAppSelector(selectSelectedCompanyId);

  const customer = isEdit ? customers.find((c) => c.id === id) : undefined;

  const {
    control,
    handleSubmit,
    watch,
    reset,
    setValue,
    formState: { isSubmitting },
  } = useForm<CustomerFormValues>({
    defaultValues: {
      firstName: '',
      lastName: '',
      businessName: '',
      nationalId: '',
      nit: '',
      nrc: '',
      documentType: CustomerDocumentType.DUI,
      customerType: String(CustomerType.Individual),
      email: '',
      phone: '',
      address: '',
      department: '',
      departmentCode: '',
      municipality: '',
      municipalityCode: '',
      district: '',
      districtCode: '',
      hasContributorRetention: false,
      isLargeTaxpayer: false,
      codPais: '',
      nombrePais: '',
      tipoPersona: '',
    },
  });

  const customerTypeValue = watch('customerType');
  const isBusiness = customerTypeValue === String(CustomerType.Business);
  const departmentCode = watch('departmentCode');
  const departmentName = watch('department');
  const municipalityCode = watch('municipalityCode');
  const municipalityName = watch('municipality');
  const districtCode = watch('districtCode');
  const districtName = watch('district');

  // Populate form when editing
  useEffect(() => {
    if (customer) {
      reset({
        firstName: customer.firstName ?? '',
        lastName: customer.lastName ?? '',
        businessName: customer.businessName ?? '',
        nationalId: customer.nationalId ?? '',
        nit: customer.nit ?? '',
        nrc: customer.nrc ?? '',
        documentType: customer.documentType ?? CustomerDocumentType.DUI,
        customerType: String(customer.customerType),
        email: customer.email ?? '',
        phone: customer.phone ?? '',
        address: customer.address ?? '',
        department: customer.department ?? '',
        departmentCode: customer.departmentCode ?? '',
        municipality: customer.municipality ?? '',
        municipalityCode: customer.municipalityCode ?? '',
        district: customer.district ?? '',
        districtCode: customer.districtCode ?? '',
        hasContributorRetention: customer.hasContributorRetention ?? false,
        isLargeTaxpayer: customer.isLargeTaxpayer ?? false,
        codPais: customer.codPais ?? '',
        nombrePais: customer.nombrePais ?? '',
        tipoPersona: customer.tipoPersona ?? '',
      });
    }
  }, [customer, reset]);

  async function onSubmit(values: CustomerFormValues) {
    const payload = {
      firstName: values.firstName.trim(),
      lastName: values.lastName.trim(),
      businessName: values.businessName?.trim() || undefined,
      nationalId: values.nationalId.trim(),
      nit: values.nit.trim(),
      nrc: values.nrc?.trim() || undefined,
      documentType: values.documentType as CustomerDocumentType,
      customerType: Number(values.customerType) as CustomerType,
      email: values.email.trim(),
      phone: values.phone.trim(),
      address: values.address?.trim() || undefined,
      department: values.department?.trim() || undefined,
      departmentCode: values.departmentCode?.trim() || undefined,
      municipality: values.municipality?.trim() || undefined,
      municipalityCode: values.municipalityCode?.trim() || undefined,
      district: values.district?.trim() || undefined,
      districtCode: values.districtCode?.trim() || undefined,
      hasContributorRetention: values.hasContributorRetention,
      isLargeTaxpayer: values.isLargeTaxpayer,
      codPais: values.codPais?.trim() || undefined,
      nombrePais: values.nombrePais?.trim() || undefined,
      tipoPersona: values.tipoPersona?.trim() || undefined,
      companyId: selectedCompanyId!,
    };

    // Validate against the MH `Receptor` schema BEFORE saving — a record
    // that wouldn't pass MH validation here would just produce cryptic
    // [096] errors at submission time. We surface every issue at once so
    // the user can fix the form in one pass.
    const result = validateCustomerForMH(payload);
    if (!result.ok) {
      toast.error(formatErrors(result.errors) ?? 'Datos del cliente inválidos.');
      return;
    }

    try {
      if (isEdit && customer) {
        await dispatch(updateCustomerAsync({ id: customer.id, ...payload })).unwrap();
        toast.success('Cliente actualizado correctamente.');
      } else {
        await dispatch(createCustomer(payload)).unwrap();
        toast.success('Cliente creado correctamente.');
      }
      navigate('/customers');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar.');
    }
  }

  if (!selectedCompanyId) {
    return (
      <div data-testid="customer-form-no-company" className="max-w-md mx-auto mt-12">
        <Card>
          <div className="flex flex-col items-center text-center gap-3 py-6">
            <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
              <Building2 size={22} />
            </div>
            <h2 className="text-lg font-semibold text-brand-900">
              Selecciona o crea una empresa
            </h2>
            <p className="text-sm text-brand-500">
              Necesitas tener una empresa seleccionada para gestionar clientes.
            </p>
            <div className="flex gap-2 mt-2">
              <Button variant="primary" onClick={() => navigate('/companies/add')} data-testid="btn-go-create-company">
                Crear empresa
              </Button>
              <Button variant="secondary" onClick={() => navigate('/companies')}>
                Ver empresas
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div data-testid="customer-form">
      <PageHeader
        title={isEdit ? 'Editar Cliente' : 'Nuevo Cliente'}
        subtitle={isEdit ? 'Actualizar información del cliente' : 'Registrar un nuevo cliente'}
        actions={
          <Button
            variant="ghost"
            icon={<ArrowLeft size={16} />}
            onClick={() => navigate(isEdit ? `/customers/${id}` : '/customers')}
          >
            Volver
          </Button>
        }
      />

      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4">
        {/* Personal info */}
        <Card>
          <h3 className="text-sm font-semibold text-brand-700 mb-4">Información Personal</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              name="firstName"
              control={control}
              label="Nombre"
              required
              rules={{ required: 'El nombre es requerido.' }}
              placeholder="Nombre"
            />
            <FormField
              name="lastName"
              control={control}
              label="Apellido"
              required
              rules={{ required: 'El apellido es requerido.' }}
              placeholder="Apellido"
            />
            <FormField
              name="customerType"
              control={control}
              label="Tipo de Cliente"
              type="select"
              options={customerTypeOptions}
              required
            />
            <FormField
              name="businessName"
              control={control}
              label="Razón Social"
              placeholder="Razón social o nombre comercial"
              required={isBusiness}
              rules={
                isBusiness
                  ? { required: 'La razón social es requerida para empresas.' }
                  : {}
              }
            />
          </div>
        </Card>

        {/* Document info */}
        <Card>
          <h3 className="text-sm font-semibold text-brand-700 mb-4">Identificación</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              name="documentType"
              control={control}
              label="Tipo de Documento"
              type="select"
              options={documentTypeOptions}
              required
            />
            <FormField
              name="nationalId"
              control={control}
              label="Número de Documento (DUI)"
              placeholder="00000000-0"
              rules={{
                pattern: {
                  value: /^\d{8}-\d$/,
                  message: 'Formato DUI inválido (ej: 01234567-8)',
                },
              }}
            />
            <FormField
              name="nit"
              control={control}
              label="NIT"
              placeholder="0000-000000-000-0"
              rules={{
                pattern: {
                  value: /^\d{4}-\d{6}-\d{3}-\d$/,
                  message: 'Formato NIT inválido (ej: 0614-123456-789-0)',
                },
              }}
            />
            <FormField
              name="nrc"
              control={control}
              label="NRC"
              placeholder="Número de Registro Contribuyente"
            />
          </div>
        </Card>

        {/* Contact */}
        <Card>
          <h3 className="text-sm font-semibold text-brand-700 mb-4">Contacto</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              name="email"
              control={control}
              label="Email"
              type="email"
              placeholder="correo@ejemplo.com"
              rules={{
                pattern: {
                  value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                  message: 'Formato de email inválido.',
                },
              }}
            />
            <FormField
              name="phone"
              control={control}
              label="Teléfono"
              placeholder="7777-0000"
            />
            <FormField
              name="address"
              control={control}
              label="Dirección"
              placeholder="Dirección completa"
            />
            <div className="md:col-span-2">
              <LocationDropdowns
                departamentoCode={departmentCode}
                departamento={departmentName}
                municipioCode={municipalityCode}
                municipio={municipalityName}
                distritoCode={districtCode}
                distrito={districtName}
                required={false}
                onDepartamentoChange={(code, name) => {
                  setValue('departmentCode', code);
                  setValue('department', name);
                  setValue('municipalityCode', '');
                  setValue('municipality', '');
                  setValue('districtCode', '');
                  setValue('district', '');
                }}
                onMunicipioChange={(code, name) => {
                  setValue('municipalityCode', code);
                  setValue('municipality', name);
                  setValue('districtCode', '');
                  setValue('district', '');
                }}
                onDistritoChange={(code, name) => {
                  setValue('districtCode', code);
                  setValue('district', name);
                }}
              />
            </div>
          </div>

          <div className="mt-4">
            <Controller
              name="hasContributorRetention"
              control={control}
              render={({ field }) => (
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    data-testid="customer-has-retention"
                    checked={!!field.value}
                    onChange={(e) => field.onChange(e.target.checked)}
                    className="w-4 h-4 rounded border-brand-300 text-accent-600 focus:ring-accent-500"
                  />
                  <span className="text-sm text-brand-700">Tiene retención de contribuyente</span>
                </label>
              )}
            />
            <Controller
              name="isLargeTaxpayer"
              control={control}
              render={({ field }) => (
                <label className="flex items-start gap-2 cursor-pointer select-none mt-3">
                  <input
                    type="checkbox"
                    data-testid="customer-large-taxpayer"
                    checked={!!field.value}
                    onChange={(e) => field.onChange(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-brand-300 text-accent-600 focus:ring-accent-500"
                  />
                  <span>
                    <span className="block text-sm text-brand-700">Gran contribuyente</span>
                    <span className="block text-xs text-brand-400">
                      A los grandes contribuyentes no se les cobra la percepción de IVA (1%).
                    </span>
                  </span>
                </label>
              )}
            />
          </div>
        </Card>

        {/* Export info */}
        <Card>
          <h3 className="text-sm font-semibold text-brand-700 mb-1">Información de Exportación</h3>
          <p className="text-xs text-brand-400 mb-4">Opcional — requerido para facturas de exportación (tipo 11)</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <FormField
              name="codPais"
              control={control}
              label="Código de País"
              placeholder="ej: SLV"
            />
            <FormField
              name="nombrePais"
              control={control}
              label="Nombre de País"
              placeholder="ej: El Salvador"
            />
            <FormField
              name="tipoPersona"
              control={control}
              label="Tipo de Persona"
              type="select"
              options={tipoPersonaOptions}
              placeholder="Seleccionar tipo"
            />
          </div>
        </Card>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate(isEdit ? `/customers/${id}` : '/customers')}
          >
            Cancelar
          </Button>
          <Button type="submit" variant="primary" loading={isSubmitting} data-testid="submit-customer-btn">
            {isEdit ? 'Guardar Cambios' : 'Crear Cliente'}
          </Button>
        </div>
      </form>
    </div>
  );
}
