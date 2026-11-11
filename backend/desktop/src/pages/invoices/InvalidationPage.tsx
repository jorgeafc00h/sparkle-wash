import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, AlertTriangle, Clock } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { Select } from '@/components/common/Select';
import { Input } from '@/components/common/Input';
import { InvoiceTypeBadge } from '@/components/invoices/InvoiceTypeBadge';
import { InvoiceStatusBadge } from '@/components/invoices/InvoiceStatusBadge';
import { useToast } from '@/components/common/Toast';
import { useAppDispatch, useAppSelector } from '@/store';
import { selectAllInvoices } from '@/store/selectors/invoiceSelectors';
import { selectAllCustomers } from '@/store/selectors/customerSelectors';
import { selectCurrentCompany } from '@/store/selectors/companySelectors';
import { updateInvoice } from '@/store/slices/invoiceSlice';
import { restoreInvoiceStock } from '@/store/slices/productSlice';
import { InvoiceStatus } from '@/types/invoice';
import { CompanyEnvironment } from '@/types/company';
import {
  InvoiceInvalidationService,
  InvalidationReason,
  INVALIDATION_REASON_DESCRIPTIONS,
} from '@/services/invalidation/InvoiceInvalidationService';
import { SecureStorageService } from '@/services/security/SecureStorageService';
import { selectCurrentTier } from '@/store/selectors/subscriptionSelectors';
import { requiresDesktopAdWait } from '@/services/subscription/FeatureGate';
import { AD_CONFIG } from '@/config/subscriptionConfig';
import { useDesktopAdWait } from '@/hooks';

const REASON_OPTIONS = [
  { label: '-- Selecciona un motivo --', value: '' },
  ...Object.entries(INVALIDATION_REASON_DESCRIPTIONS).map(([code, label]) => ({
    value: code,
    label: `${code} — ${label}`,
  })),
];
const UUID_V4_REGEX = /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/;

export default function InvalidationPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const toast = useToast();

  const invoices = useAppSelector(selectAllInvoices);
  const customers = useAppSelector(selectAllCustomers);
  const company = useAppSelector(selectCurrentCompany);

  const invoice = invoices.find(inv => inv.id === id) || null;
  const customer = invoice?.customerId
    ? customers.find((c) => c.id === invoice.customerId && c.companyId === invoice.companyId) ?? null
    : null;
  const invoiceWithCustomer = invoice
    ? customer && invoice.customer?.id !== customer.id
      ? { ...invoice, customer }
      : invoice
    : null;

  const [reason, setReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [replacementGenerationCode, setReplacementGenerationCode] = useState('');
  const [responsibleName, setResponsibleName] = useState('');
  const [responsibleDoc, setResponsibleDoc] = useState('');
  const [invalidating, setInvalidating] = useState(false);
  const tier = useAppSelector(selectCurrentTier);
  const isUITesting = useAppSelector((s) => (s as { app: { isUITesting: boolean } }).app.isUITesting);
  // Matches iOS DeactivateDocumentView.submitDeactivation() / RN DeactivateDocumentModal:
  // rewarded ad before submit for Lite + a PRODUCTION company. Inert while
  // AD_CONFIG.desktop.DESKTOP_REWARDED_ADS_ENABLED is false (current ship state).
  // Company environment (not build env): test companies never wait.
  const isLiveInvalidationCompany =
    company?.isProduction === true || company?.environment === CompanyEnvironment.Production;
  const appEnvironment =
    import.meta.env.PROD && isLiveInvalidationCompany ? 'production' : 'development';
  const needsAdWait = requiresDesktopAdWait(tier, appEnvironment, isUITesting);
  const { adWaiting, adSecondsRemaining, waitForDesktopAdIfNeeded, resetAdWait } = useDesktopAdWait(needsAdWait);
  const normalizedReplacementGenerationCode = replacementGenerationCode.trim().toUpperCase();
  // CAT-024 código 1 (anula y sustituye) requires the replacement DTE's code.
  const isReplacementGenerationCodeValid =
    reason !== InvalidationReason.ErrorInformation ||
    UUID_V4_REGEX.test(normalizedReplacementGenerationCode);
  // Flag the field only once something was typed (the submit guard covers empty).
  const showReplacementCodeError =
    normalizedReplacementGenerationCode.length > 0 && !isReplacementGenerationCodeValid;

  if (!invoice) {
    return (
      <div data-testid="invalidation">
        <PageHeader title="Factura no encontrada" />
        <Card><p className="text-brand-500 text-sm">La factura solicitada no existe.</p></Card>
      </div>
    );
  }

  const isProductionCompany = company?.isProduction === true || company?.environment === CompanyEnvironment.Production;
  const svc = new InvoiceInvalidationService(isProductionCompany);
  const { canInvalidate, reason: blockReason } = svc.canInvalidateInvoice(invoice);
  const deadline = svc.getDeadline(invoice);
  const remaining = svc.getRemainingTime(invoice);

  async function handleInvalidate() {
    if (!invoice) return;
    if (!reason) {
      toast.error('Selecciona un motivo del evento de invalidación.');
      return;
    }
    if (!responsibleName.trim()) {
      toast.error('Ingresa el nombre del responsable.');
      return;
    }
    if (!responsibleDoc.trim()) {
      toast.error('Ingresa el documento del responsable.');
      return;
    }
    if (!company) {
      toast.error('No hay empresa seleccionada.');
      return;
    }
    if (reason === InvalidationReason.Other && customReason.trim().length < 5) {
      toast.error('El motivo personalizado debe tener al menos 5 caracteres.');
      return;
    }
    if (!isReplacementGenerationCodeValid) {
      toast.error(
        normalizedReplacementGenerationCode
          ? 'El código de generación del DTE correcto debe ser UUID v4.'
          : 'Para el motivo 1 (anula y sustituye) ingresa el código de generación del DTE que lo reemplaza.',
      );
      return;
    }
    setInvalidating(true);
    try {
      await waitForDesktopAdIfNeeded();

      const credentials = await SecureStorageService.getCredentials(company.nit, isProductionCompany);
      if (!credentials) {
        toast.error('Credenciales no configuradas.');
        return;
      }
      const certPassword = await SecureStorageService.getCertificatePassword(company.nit, isProductionCompany);
      if (!certPassword) {
        toast.error('Contraseña del certificado no configurada.');
        return;
      }

      const result = await svc.invalidateInvoice(
        invoiceWithCustomer!,
        company,
        {
          reason: reason as InvalidationReason,
          customReason: customReason || undefined,
          replacementGenerationCode:
            reason === InvalidationReason.ErrorInformation && normalizedReplacementGenerationCode
              ? normalizedReplacementGenerationCode
              : undefined,
          responsibleName,
          responsibleDocument: responsibleDoc,
        }
      );

      if (result.success) {
        dispatch(updateInvoice({
          id: invoice.id,
          status: InvoiceStatus.Anulada,
          invalidatedViaApi: true,
          invalidatedAt: result.invalidatedAt || new Date().toISOString(),
          invalidationReason: reason === InvalidationReason.Other
            ? customReason
            : INVALIDATION_REASON_DESCRIPTIONS[reason as InvalidationReason],
        }));
        // The invalidated sale never happened: put back exactly what this
        // invoice discharged (its own OUT movements; idempotent, and a no-op
        // for documents that never moved stock — NC, FSE, POS consolidations).
        dispatch(restoreInvoiceStock({
          invoiceId: invoice.id,
          createdAt: new Date().toISOString(),
          createdBy: 'invalidation',
          reason: `Reingreso por invalidación de ${invoice.controlNumber || invoice.invoiceNumber}`,
        }));
        toast.success('Evento de invalidación registrado correctamente.');
        navigate(`/invoices/${invoice.id}`);
      } else {
        toast.error(result.message);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al anular.');
    } finally {
      setInvalidating(false);
      resetAdWait();
    }
  }

  return (
    <div data-testid="invalidation" className="space-y-6">
      <div>
        <button
          onClick={() => navigate(`/invoices/${id}`)}
          className="flex items-center gap-2 text-sm text-brand-500 hover:text-brand-700 mb-4"
        >
          <ArrowLeft size={16} /> Volver al Detalle
        </button>
        <PageHeader
          title="Evento de invalidación"
          subtitle="Registra ante el MH la invalidación de un DTE emitido"
        />
      </div>

      {/* Invoice Info Banner */}
      <Card>
        <div className="flex items-start gap-4 flex-wrap">
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <InvoiceTypeBadge type={invoice.invoiceType} />
              <InvoiceStatusBadge status={invoice.status} />
            </div>
            <p className="text-sm font-medium text-brand-800">
              {invoice.controlNumber || invoice.invoiceNumber}
            </p>
            <p className="text-xs text-brand-400">
              Código: {invoice.generationCode || '—'}
            </p>
            <p className="text-xs text-brand-400">
              Fecha: {invoice.date.substring(0, 10)}
            </p>
          </div>

          {canInvalidate ? (
            <div className="flex items-center gap-2 bg-amber-50 text-amber-700 rounded-lg px-4 py-3 text-sm">
              <Clock size={16} />
              <div>
                <p className="font-medium">Plazo hasta:</p>
                <p>{deadline.toLocaleDateString('es-SV', { dateStyle: 'medium' })}</p>
                {(remaining.days > 0 || remaining.hours > 0) && (
                  <p className="text-xs">
                    ({remaining.days}d {remaining.hours}h restantes)
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 rounded-lg px-4 py-3 text-sm">
              <AlertTriangle size={16} />
              <div>
                <p className="font-medium">No se puede registrar</p>
                <p className="text-xs mt-0.5">{blockReason}</p>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <h2 className="text-base font-semibold text-brand-800 mb-2">Invalidar vs Retorno</h2>
        <p className="text-sm text-brand-600">
          Invalidar genera un evento de invalidación para dejar sin efecto este DTE ante Hacienda.
          Retorno (18) registra el retorno o devolución asociado a DTE 01, 11 o 14 y se crea desde el detalle del documento cuando aplica.
        </p>
        <div className="mt-4 rounded-lg border border-brand-100 bg-brand-50 p-3" data-testid="invalidation-identifiers-summary">
          <p className="text-xs font-semibold text-brand-700 mb-2">
            Identificadores del DTE que se copiarán al evento:
          </p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <div>
              <dt className="text-brand-500">Tipo DTE</dt>
              <dd className="text-brand-900 font-mono">{invoice.documentType || '—'}</dd>
            </div>
            <div>
              <dt className="text-brand-500">Número de control</dt>
              <dd className="text-brand-900 font-mono break-all">{invoice.controlNumber || invoice.invoiceNumber || '—'}</dd>
            </div>
            <div>
              <dt className="text-brand-500">Código de generación</dt>
              <dd className="text-brand-900 font-mono break-all">{invoice.generationCode || '—'}</dd>
            </div>
            <div>
              <dt className="text-brand-500">Sello de recepción</dt>
              <dd className="text-brand-900 font-mono break-all">{invoice.receptionSeal || '—'}</dd>
            </div>
            <div>
              <dt className="text-brand-500">Fecha de emisión</dt>
              <dd className="text-brand-900">{invoice.date.substring(0, 10)}</dd>
            </div>
          </dl>
        </div>
      </Card>

      {canInvalidate && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <h2 className="text-base font-semibold text-brand-800 mb-4">Motivo del Evento de invalidación</h2>
            <div className="space-y-4">
              <Select
                label="Motivo"
                value={reason}
                onChange={e => setReason(e.target.value)}
                options={REASON_OPTIONS}
                required
              />
              {reason === InvalidationReason.Other && (
                <Input
                  label="Especifica el motivo"
                  value={customReason}
                  onChange={e => setCustomReason(e.target.value)}
                  placeholder="Descripción del motivo (mínimo 5 caracteres)..."
                  required
                />
              )}
              {reason === InvalidationReason.ErrorInformation && (
                <div className="space-y-1">
                  <Input
                    label="Código de generación del DTE correcto"
                    value={replacementGenerationCode}
                    onChange={e => setReplacementGenerationCode(e.target.value.toUpperCase())}
                    placeholder="UUID v4 del DTE que reemplaza al documento"
                    className={showReplacementCodeError ? 'border-red-500 focus:ring-red-500' : undefined}
                  />
                  <p className={showReplacementCodeError ? 'text-xs text-red-600' : 'text-xs text-brand-500'}>
                    Requerido: código de generación (UUID v4) del DTE que sustituye al
                    documento invalidado.
                  </p>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <h2 className="text-base font-semibold text-brand-800 mb-4">Datos del Responsable</h2>
            <div className="space-y-4">
              <Input
                label="Nombre del responsable"
                value={responsibleName}
                onChange={e => setResponsibleName(e.target.value)}
                placeholder="Nombre completo..."
                required
              />
              <Input
                label="Documento del responsable"
                value={responsibleDoc}
                onChange={e => setResponsibleDoc(e.target.value)}
                placeholder="DUI, NIT o pasaporte..."
                required
              />
            </div>
          </Card>
        </div>
      )}

      {adWaiting && (
        <Card>
          <div data-testid="desktop-ad-wait" className="flex flex-col overflow-hidden rounded-lg">
            <iframe
              title="Anuncio"
              data-testid="desktop-ad-frame"
              className="min-h-[240px] w-full rounded-t border-0"
              src={AD_CONFIG.desktop.DESKTOP_AD_LANDING_URL}
            />
            <div className="border-t border-brand-100 px-4 py-3">
              <p className="text-sm font-medium text-brand-800">Preparando registro de invalidación</p>
              <p className="text-xs text-brand-500">
                El evento se registrará automáticamente en {adSecondsRemaining}s.
              </p>
            </div>
          </div>
        </Card>
      )}

      {canInvalidate && (
        <div className="flex gap-3">
          <Button
            variant="danger"
            size="lg"
            icon={<Ban size={16} />}
            loading={invalidating}
            onClick={handleInvalidate}
            data-testid="btn-invalidate"
          >
            Registrar Evento de invalidación
          </Button>
          <Button
            variant="ghost"
            onClick={() => navigate(`/invoices/${id}`)}
          >
            Cancelar
          </Button>
        </div>
      )}

      {!canInvalidate && (
        <Button variant="secondary" onClick={() => navigate(`/invoices/${id}`)}>
          Volver al Detalle
        </Button>
      )}
    </div>
  );
}
