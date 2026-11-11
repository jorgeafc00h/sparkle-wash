import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { CreditCard, FileText, Building2, TrendingUp, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/common/Card';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useToast } from '@/components/common/Toast';
import { useAppSelector, useAppDispatch } from '@/store';
import { selectCurrentTier } from '@/store';
import { selectAllCompanies } from '@/store';
import { selectAllInvoices } from '@/store';
import { selectActiveSubscription } from '@/store/selectors/subscriptionSelectors';
import { SubscriptionTier } from '@/services/subscription/SubscriptionTypes';
import { cancelN1CO } from '@/store/slices/subscriptionSlice';
import { getMaxCompanies } from '@/services/subscription/FeatureGate';
import { trialRemainingDays } from '@/services/subscription/SyncTrialService';

/** Pro's company cap, from the gate itself so the copy can't drift from it again. */
const PRO_MAX_COMPANIES = getMaxCompanies(SubscriptionTier.AdFree);

const TIER_LABEL: Record<SubscriptionTier, string> = {
  [SubscriptionTier.Lite]: 'Free (Gratis)',
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

const TIER_COMPANY_LIMIT: Record<SubscriptionTier, string> = {
  [SubscriptionTier.Lite]: '1',
  [SubscriptionTier.AdFree]: String(PRO_MAX_COMPANIES),
  [SubscriptionTier.Pro]: 'Ilimitadas',
  [SubscriptionTier.ProSync]: 'Ilimitadas',
  [SubscriptionTier.Enterprise]: 'Ilimitadas',
};

const TIER_FEATURES: Record<SubscriptionTier, string[]> = {
  [SubscriptionTier.Lite]: [
    'Todos los tipos de DTE',
    'Firma local',
    '1 empresa máximo',
    'Anuncio antes de sincronizar (desktop)',
  ],
  [SubscriptionTier.AdFree]: [
    'Todos los tipos de DTE',
    'Firma local',
    `${PRO_MAX_COMPANIES} empresas máximo`,
    'Libros IVA',
    'Respaldo en Google Drive',
    'Envío por correo',
    'Exportación PDF en lote',
    'Sin anuncios',
  ],
  [SubscriptionTier.Pro]: [
    'Todo lo de Pro',
    'Empresas ilimitadas',
    'Soporte prioritario',
  ],
  [SubscriptionTier.ProSync]: [
    'Todo lo de Business',
    'Sincronización entre dispositivos (teléfono y computadora)',
    'Empresas ilimitadas',
    'Sin anuncios',
  ],
  [SubscriptionTier.Enterprise]: [
    'Todo lo de Pro+Sync',
    'Sincronización entre dispositivos',
    'Respaldos en el servidor',
    'Empresas ilimitadas',
  ],
};

export default function AccountSummaryPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const dispatch = useAppDispatch();
  const tier = useAppSelector(selectCurrentTier);
  const activeSubscription = useAppSelector(selectActiveSubscription);
  const companies = useAppSelector(selectAllCompanies);
  const invoices = useAppSelector(selectAllInvoices);
  const compraCount = useAppSelector((s) => s.compras.compras.length);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const trialUntil = useAppSelector((s) => s.subscription.accountEntitlement?.trialUntil);
  const trialDays = trialRemainingDays(trialUntil);
  const onTrial = trialDays !== null;
  // Card update / cancel act on an N1CO subscription. A free trial (or a TIER_OVERRIDES grant)
  // has none — the backend answered "No hay suscripción activa" to both buttons.
  const hasN1coSubscription = Boolean(activeSubscription?.n1coSubscriptionId);
  const isPastDue = activeSubscription?.status === 'payment_failed';
  // Only Free and Pro have something higher to buy; a trial user can buy any plan.
  const canChangePlan = onTrial || tier === SubscriptionTier.Lite || tier === SubscriptionTier.AdFree;

  async function handleCancelSubscription() {
    setCancelling(true);
    try {
      const result = await dispatch(cancelN1CO());
      if (cancelN1CO.fulfilled.match(result)) {
        toast.success('Suscripción cancelada correctamente.');
      } else {
        toast.error((result.payload as string) ?? 'No se pudo cancelar la suscripción');
      }
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div data-testid="account-summary" className="max-w-lg mx-auto space-y-6">
      <PageHeader title="Resumen de Cuenta" subtitle="Suscripción y uso" />

      {/* Past-due banner — shown when N1CO renewal failed and tier is in
          grace period. CTA points at the change-card page. */}
      {isPastDue && (
        <Card
          data-testid="past-due-banner"
          className="border-amber-300 bg-amber-50 flex items-start gap-3 py-4"
        >
          <AlertTriangle className="text-amber-600 flex-shrink-0 mt-0.5" size={20} />
          <div className="flex-1 text-sm">
            <p className="font-semibold text-amber-900">Pago pendiente</p>
            <p className="text-amber-800 mt-1 mb-3">
              La última cobranza fue rechazada. Actualiza tu tarjeta para
              continuar disfrutando las funciones premium.
            </p>
            <Button
              variant="primary"
              size="sm"
              data-testid="past-due-update-card"
              onClick={() => navigate('/settings/account/change-card')}
            >
              Actualizar tarjeta
            </Button>
          </div>
        </Card>
      )}

      {/* Current plan */}
      <Card>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-semibold text-brand-800">Plan Actual</h2>
            <div className="mt-1">
              <Badge variant={TIER_VARIANT[tier]}>{TIER_LABEL[tier]}</Badge>
              {onTrial && (
                <span data-testid="account-trial-badge" className="ml-2 text-xs text-brand-500">
                  Prueba gratis: {trialDays} {trialDays === 1 ? 'día restante' : 'días restantes'}
                </span>
              )}
            </div>
          </div>
          <CreditCard size={24} className="text-brand-300" />
        </div>
        <ul className="space-y-1 text-sm text-brand-600 mb-4">
          {TIER_FEATURES[tier].map((f) => (
            <li key={f} className="flex items-center gap-2">
              <span className="text-green-500">✓</span> {f}
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2">
          {canChangePlan && (
            <Button
              variant="primary"
              className="w-full"
              onClick={() => navigate('/settings/promo')}
            >
              Cambiar Plan
            </Button>
          )}
          {hasN1coSubscription && (
            <Button
              variant="secondary"
              className="w-full"
              data-testid="account-change-card-btn"
              onClick={() => navigate('/settings/account/change-card')}
            >
              Actualizar tarjeta
            </Button>
          )}
          {hasN1coSubscription && (
            <Button
              variant="danger"
              className="w-full"
              data-testid="account-cancel-subscription-btn"
              loading={cancelling}
              onClick={() => setShowCancelDialog(true)}
            >
              Cancelar suscripción
            </Button>
          )}
        </div>
      </Card>

      {/* Usage stats */}
      <Card>
        <h2 className="font-semibold text-brand-800 mb-4">Uso Actual</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-brand-600">
              <Building2 size={16} className="text-accent-500" />
              <span>Empresas</span>
            </div>
            <span className="text-sm font-medium text-brand-800">
              {companies.length} / {TIER_COMPANY_LIMIT[tier]}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-brand-600">
              <FileText size={16} className="text-purple-500" />
              <span>Documentos emitidos</span>
            </div>
            <span className="text-sm font-medium text-brand-800">{invoices.length}</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-brand-600">
              <TrendingUp size={16} className="text-green-500" />
              <span>Compras registradas</span>
            </div>
            <span className="text-sm font-medium text-brand-800">{compraCount}</span>
          </div>
          </div>
        </Card>

      <ConfirmDialog
        isOpen={showCancelDialog}
        onClose={() => setShowCancelDialog(false)}
        onConfirm={handleCancelSubscription}
        title="Cancelar suscripción"
        message="Tu suscripción se cancelará en N1CO y tu cuenta volverá al plan gratis."
        confirmLabel="Cancelar suscripción"
        variant="danger"
      />
    </div>
  );
}
