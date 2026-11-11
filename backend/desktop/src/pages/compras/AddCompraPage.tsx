import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm, useFieldArray } from 'react-hook-form';
import { Upload, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Card } from '@/components/common/Card';
import { PaymentTermsFields } from '@/components/invoices/PaymentTermsFields';
import { useToast } from '@/components/common/Toast';
import { useAppSelector, useAppDispatch } from '@/store';
import { selectCurrentCompany } from '@/store';
import { loadCompras, initComprasDatabase } from '@/store/slices/comprasSlice';
import { ComprasDatabase } from '@/services/compras/ComprasDatabase';
import { DTEJsonParser } from '@/services/compras/DTEJsonParser';
import { CompraSource, Compra } from '@/types/compras';
import {
  DEFAULT_PAYMENT_TERMS_DRAFT,
  PaymentTermsDraft,
  paymentTermsToPayload,
} from '@/utils/paymentTerms';

type Mode = 'json' | 'manual' | 'internal';

// Marker tipoDte for internal-use records (not a real MH document type).
const INTERNAL_TIPO_DTE = 'UI';

const PAYABLE_COMPRA_TYPES = new Set(['01', '03', '11', '14']);

function todayLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeTipoDte(value: string): string {
  const trimmed = value.trim();
  return trimmed.length === 1 ? `0${trimmed}` : trimmed;
}

function supportsCompraPaymentTerms(tipoDte: string): boolean {
  return PAYABLE_COMPRA_TYPES.has(normalizeTipoDte(tipoDte));
}

type ManualForm = {
  emisorNit: string;
  emisorNrc: string;
  emisorNombre: string;
  emisorNombreComercial: string;
  tipoDte: string;
  codigoGeneracion: string;
  numeroControl: string;
  selloRecibido: string;
  internalReason: string;
  documentReference: string;
  fecha: string;
  items: {
    descripcion: string;
    cantidad: number;
    precioUni: number;
    ventaGravada: number;
    ivaItem: number;
  }[];
};

export default function AddCompraPage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const toast = useToast();
  const currentCompany = useAppSelector(selectCurrentCompany);

  const [mode, setMode] = useState<Mode>('json');
  const [jsonPreview, setJsonPreview] = useState<Record<string, unknown> | null>(null);
  const [jsonFileName, setJsonFileName] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [paymentTerms, setPaymentTerms] = useState<PaymentTermsDraft>(DEFAULT_PAYMENT_TERMS_DRAFT);

  const { register, handleSubmit, control, watch, formState: { errors } } = useForm<ManualForm>({
    defaultValues: {
      emisorNit: '',
      emisorNrc: '',
      emisorNombre: '',
      emisorNombreComercial: '',
      tipoDte: '01',
      codigoGeneracion: '',
      numeroControl: '',
      selloRecibido: '',
      internalReason: '',
      documentReference: '',
      fecha: todayLocalDate(),
      items: [{ descripcion: '', cantidad: 1, precioUni: 0, ventaGravada: 0, ivaItem: 0 }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const items = watch('items');
  const tipoDte = watch('tipoDte');
  const fecha = watch('fecha');

  function handleJsonFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setJsonFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      // normalize() acepta JSON plano, JWS/JWT y el sobre del firmador, y
      // devuelve siempre el DTE desnudo — así la vista previa y lo que se guarda
      // nunca incluyen la contraseña de firma que trae el sobre.
      const normalized = DTEJsonParser.normalize(String(ev.target?.result ?? ''));
      if (normalized) {
        setJsonPreview(normalized.object as unknown as Record<string, unknown>);
        toast.info('JSON cargado correctamente. Revisa los datos antes de importar.');
      } else {
        toast.error('El archivo no es un JSON válido.');
        setJsonPreview(null);
        setJsonFileName(null);
      }
    };
    reader.readAsText(file);
  }

  async function handleImportJson() {
    if (!jsonPreview || !currentCompany) return;
    setImporting(true);
    try {
      await dispatch(initComprasDatabase()).unwrap();
      // jsonPreview ya viene normalizado (DTE desnudo), así que serializarlo no
      // puede arrastrar el sobre del firmador ni su passwordPri.
      const originalJson = JSON.stringify(jsonPreview);
      const compra = DTEJsonParser.parseDTEObject(
        jsonPreview,
        currentCompany.id,
        CompraSource.Manual,
        undefined,
        originalJson,
      );
      if (!compra) {
        toast.error('El archivo no contiene un DTE válido para compras.');
        return;
      }
      if (await ComprasDatabase.existsByCodigoGeneracion(compra.codigoGeneracion, currentCompany.id)) {
        toast.warning('Esta compra ya fue importada.');
        return;
      }
      await ComprasDatabase.insertCompra(compra);
      dispatch(loadCompras(currentCompany.id));
      toast.success('Compra importada correctamente.');
      navigate('/compras');
    } catch (err) {
      toast.error('Error al importar la compra.');
    } finally {
      setImporting(false);
    }
  }

  async function onManualSubmit(data: ManualForm) {
    if (!currentCompany) return;
    setSaving(true);
    try {
      await dispatch(initComprasDatabase()).unwrap();
      const totalGravada = data.items.reduce((s, i) => s + Number(i.ventaGravada || 0), 0);
      const totalIva = data.items.reduce((s, i) => s + Number(i.ivaItem || 0), 0);
      const isInternal = mode === 'internal';
      const compraId = `compra_${Date.now()}`;
      const termsPayload = paymentTermsToPayload(paymentTerms, {
        supportsPaymentTerms: !isInternal && supportsCompraPaymentTerms(data.tipoDte),
        issueDate: data.fecha,
      });
      const compra: Compra = {
        id: compraId,
        companyId: currentCompany.id,
        emisorNit: data.emisorNit.trim(),
        emisorNrc: data.emisorNrc || undefined,
        emisorNombre: data.emisorNombre,
        emisorNombreComercial: data.emisorNombreComercial || undefined,
        tipoDte: isInternal ? INTERNAL_TIPO_DTE : normalizeTipoDte(data.tipoDte),
        codigoGeneracion: isInternal ? '' : data.codigoGeneracion,
        numeroControl: isInternal ? '' : data.numeroControl,
        selloRecibido: isInternal ? undefined : data.selloRecibido || undefined,
        ...(isInternal
          ? {
              internalUse: true,
              internalReason: data.internalReason.trim() || undefined,
              documentReference: data.documentReference.trim() || undefined,
            }
          : {}),
        fecha: data.fecha,
        dueDate: termsPayload.dueDate,
        paymentCondition: termsPayload.paymentCondition,
        paymentTermCode: termsPayload.paymentTermCode,
        paymentTermPeriod: termsPayload.paymentTermPeriod,
        openInAccounts: termsPayload.openInAccounts,
        totalGravada,
        totalIva,
        totalPagar: totalGravada + totalIva,
        source: CompraSource.Manual,
        items: data.items.map((item, i) => ({
          // Unique per compra: App.ReactNative stores compra items in one
          // table with a globally unique id — `item_0` on every manual compra
          // made a second synced compra's items collide and vanish there.
          id: `${compraId}_item_${i}`,
          compraId,
          numItem: i + 1,
          descripcion: item.descripcion,
          cantidad: Number(item.cantidad),
          precioUni: Number(item.precioUni),
          ventaGravada: Number(item.ventaGravada),
          ivaItem: Number(item.ivaItem),
        })),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await ComprasDatabase.insertCompra(compra);
      dispatch(loadCompras(currentCompany.id));
      toast.success('Compra registrada correctamente.');
      navigate('/compras');
    } catch {
      toast.error('Error al guardar la compra.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-testid="add-compra" className="max-w-3xl mx-auto space-y-6">
      <PageHeader
        title="Nueva Compra"
        subtitle="Importar JSON o ingreso manual"
        onBack={() => navigate(-1)}
      />

      {/* Mode toggle */}
      <div className="flex gap-2">
        <Button
          variant={mode === 'json' ? 'primary' : 'secondary'}
          onClick={() => setMode('json')}
        >
          Importar JSON
        </Button>
        <Button
          variant={mode === 'manual' ? 'primary' : 'secondary'}
          onClick={() => setMode('manual')}
        >
          Ingreso Manual
        </Button>
        <Button
          variant={mode === 'internal' ? 'primary' : 'secondary'}
          onClick={() => setMode('internal')}
          data-testid="compra-mode-internal"
        >
          Uso interno
        </Button>
      </div>

      {/* JSON Import */}
      {mode === 'json' && (
        <Card className="space-y-4">
          <h3 className="font-semibold text-brand-800">Importar JSON DTE</h3>
          <div>
            <label className="text-sm font-medium text-brand-700 block mb-1">
              Archivo JSON (.json)
            </label>
            <input
              type="file"
              accept=".json,.txt,application/json,text/plain"
              className="block w-full text-sm text-brand-700 border border-brand-300 rounded-lg px-3 py-2 cursor-pointer hover:border-brand-400"
              onChange={handleJsonFile}
            />
            {jsonFileName && (
              <p className="text-xs text-green-600 mt-1">Archivo: {jsonFileName}</p>
            )}
          </div>

          {jsonPreview && (
            <>
              <div>
                <h4 className="text-sm font-semibold text-brand-700 mb-2">Vista Previa</h4>
                <pre className="bg-brand-50 border border-brand-200 rounded-lg p-3 text-xs text-brand-700 overflow-auto max-h-64">
                  {JSON.stringify(jsonPreview, null, 2)}
                </pre>
              </div>
              <Button
                variant="primary"
                icon={<Upload size={16} />}
                onClick={handleImportJson}
                loading={importing}
              >
                Confirmar Importación
              </Button>
            </>
          )}
        </Card>
      )}

      {/* Manual Entry */}
      {(mode === 'manual' || mode === 'internal') && (
        <form onSubmit={handleSubmit(onManualSubmit)} className="space-y-6">
          <Card className="space-y-4">
            <h3 className="font-semibold text-brand-800">
              {mode === 'internal' ? 'Proveedor' : 'Datos del Emisor'}
            </h3>
            {mode === 'internal' && (
              <p
                data-testid="compra-internal-hint"
                className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2"
              >
                Compra de uso interno: no es un DTE válido (p. ej. compra en el extranjero o
                ticket comercial). Se guarda solo para control interno y nunca se envía a
                Hacienda ni se verifica.
              </p>
            )}
            <div className="grid grid-cols-2 gap-4">
              <Input
                label={mode === 'internal' ? 'NIT / identificación (opcional)' : 'NIT Emisor'}
                required={mode !== 'internal'}
                {...register('emisorNit', { required: mode === 'internal' ? false : 'Requerido' })}
                error={errors.emisorNit?.message}
              />
              {mode !== 'internal' && (
                <Input
                  label="NRC Emisor"
                  {...register('emisorNrc')}
                />
              )}
            </div>
            <Input
              label={mode === 'internal' ? 'Nombre del proveedor' : 'Nombre Emisor'}
              required
              {...register('emisorNombre', { required: 'Requerido' })}
              error={errors.emisorNombre?.message}
            />
            {mode !== 'internal' && (
              <Input
                label="Nombre Comercial"
                {...register('emisorNombreComercial')}
              />
            )}
          </Card>

          {mode !== 'internal' && (
          <Card className="space-y-4">
            <div>
              <h3 className="font-semibold text-brand-800">Condición de pago</h3>
              <p className="text-sm text-brand-500 mt-1">
                Define si esta compra queda como cuenta por pagar.
              </p>
            </div>
            {supportsCompraPaymentTerms(tipoDte) ? (
              <PaymentTermsFields
                value={paymentTerms}
                onChange={setPaymentTerms}
                issueDate={fecha}
              />
            ) : (
              <p className="text-sm text-brand-500">
                Este tipo de DTE no abre cuentas por pagar automáticamente.
              </p>
            )}
          </Card>
          )}

          {mode === 'internal' && (
            <Card className="space-y-4">
              <h3 className="font-semibold text-brand-800">Datos del documento</h3>
              <Input
                label="Fecha"
                type="date"
                required
                {...register('fecha', { required: 'Requerido' })}
                error={errors.fecha?.message}
              />
              <Input
                label="Referencia del documento"
                placeholder="N.º de ticket, recibo o factura del proveedor"
                data-testid="compra-document-reference"
                {...register('documentReference')}
              />
              <Input
                label="Motivo de uso interno"
                placeholder="Ej. Compra en el extranjero"
                data-testid="compra-internal-reason"
                {...register('internalReason')}
              />
            </Card>
          )}

          {mode !== 'internal' && (
          <Card className="space-y-4">
            <h3 className="font-semibold text-brand-800">Datos del DTE</h3>
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Tipo DTE"
                required
                placeholder="01"
                {...register('tipoDte', { required: 'Requerido' })}
                error={errors.tipoDte?.message}
              />
              <Input
                label="Fecha"
                type="date"
                required
                {...register('fecha', { required: 'Requerido' })}
                error={errors.fecha?.message}
              />
            </div>
            <Input
              label="Código de Generación"
              required
              {...register('codigoGeneracion', { required: 'Requerido' })}
              error={errors.codigoGeneracion?.message}
            />
            <Input
              label="Número de Control"
              required
              {...register('numeroControl', { required: 'Requerido' })}
              error={errors.numeroControl?.message}
            />
            <Input
              label="Sello Recibido"
              {...register('selloRecibido')}
            />
          </Card>
          )}

          <Card className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-brand-800">Líneas de Detalle</h3>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={<Plus size={14} />}
                onClick={() => append({ descripcion: '', cantidad: 1, precioUni: 0, ventaGravada: 0, ivaItem: 0 })}
              >
                Agregar Línea
              </Button>
            </div>
            {fields.map((field, index) => (
              <div key={field.id} className="grid grid-cols-6 gap-2 items-end">
                <div className="col-span-2">
                  <Input
                    label="Descripción"
                    {...register(`items.${index}.descripcion`)}
                    placeholder="Descripción del ítem"
                  />
                </div>
                <Input
                  label="Cantidad"
                  type="number"
                  {...register(`items.${index}.cantidad`, { valueAsNumber: true })}
                />
                <Input
                  label="Precio Unit."
                  type="number"
                  step="0.01"
                  {...register(`items.${index}.precioUni`, { valueAsNumber: true })}
                />
                <Input
                  label="Venta Gravada"
                  type="number"
                  step="0.01"
                  data-testid={`compra-venta-gravada-${index}`}
                  {...register(`items.${index}.ventaGravada`, { valueAsNumber: true })}
                />
                <div className="flex gap-1 items-end">
                  <Input
                    label="IVA"
                    type="number"
                    step="0.01"
                    {...register(`items.${index}.ivaItem`, { valueAsNumber: true })}
                  />
                  {fields.length > 1 && (
                    <button
                      type="button"
                      onClick={() => remove(index)}
                      className="mb-px p-2 text-red-400 hover:text-red-600"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))}
            <div className="text-sm text-brand-500 text-right">
              Total a Pagar: <span className="font-semibold text-accent-600">
                ${items.reduce((s, i) => s + Number(i.ventaGravada || 0) + Number(i.ivaItem || 0), 0).toFixed(2)}
              </span>
            </div>
          </Card>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => navigate('/compras')}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              Guardar Compra
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
