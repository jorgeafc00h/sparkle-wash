import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Crown, Ticket, CheckCircle, Info, Pencil, Check, CreditCard, Star, Shield } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/common/Card';
import { Input } from '@/components/common/Input';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { SubscriptionModal } from '@/components/modals/SubscriptionModal';
import { N1COBadge } from '@/components/common/N1COBadge';
import { useToast } from '@/components/common/Toast';
import { useAppSelector, useAppDispatch } from '@/store';
import { selectCurrentTier } from '@/store/selectors/subscriptionSelectors';
import { selectCurrentCompany } from '@/store/selectors/companySelectors';
import { selectAuthToken } from '@/store/selectors/authSelectors';
import { SubscriptionTier } from '@/services/subscription/SubscriptionTypes';
import { getMaxCompanies } from '@/services/subscription/FeatureGate';
import { bestTier } from '@/services/subscription/AccountEntitlementService';
import { trialRemainingDays } from '@/services/subscription/SyncTrialService';
import { purchaseN1CO } from '@/store/slices/subscriptionSlice';
import { appStorage } from '@/services/storage/ElectronStorage';
import { API_CONFIG } from '@/config/api';

const STORAGE_EMAIL_KEY = 'promo_user_email';
const STORAGE_PROMO_REF_KEY = 'promoReference';
const STORAGE_PROMO_DATE_KEY = 'promoReferenceDate';
// Same backend as every other call (already ends in /api)
const API_BASE = API_CONFIG.production.baseUrl;

interface PromoResponse {
  success: boolean;
  message: string;
  orderReference?: string;
}

interface PromoStatus {
  status: 'pending' | 'approved' | 'rejected';
  creditsGranted?: number;
  orderReference?: string;
}

const TIER_LABELS: Record<SubscriptionTier, string> = {
  [SubscriptionTier.Lite]: 'Free (Gratis)',
  [SubscriptionTier.AdFree]: 'Pro',
  [SubscriptionTier.Pro]: 'Business',
  [SubscriptionTier.ProSync]: 'Pro+Sync',
  [SubscriptionTier.Enterprise]: 'Enterprise',
};

interface CardForm {
  cardNumber: string;
  cardholderName: string;
  expiryMonth: string;
  expiryYear: string;
  cvv: string;
  cardEmail: string;
}

/** Pro's company cap, from the gate itself so the copy can't drift from it again. */
const PRO_MAX_COMPANIES = getMaxCompanies(SubscriptionTier.AdFree);

const PLAN_OPTIONS = [
  {
    tier: SubscriptionTier.AdFree,
    label: 'Pro',
    price: '$7.00/mes',
    description: `Facturas ilimitadas · ${PRO_MAX_COMPANIES} empresas · Libros IVA · Sin anuncios · Drive backup`,
    icon: <Star size={16} className="text-blue-600" />,
    accent: 'border-blue-400 bg-blue-50',
  },
  {
    tier: SubscriptionTier.Pro,
    label: 'Business',
    price: '$14.00/mes',
    description: 'Todo lo de Pro · Empresas ilimitadas · Soporte prioritario',
    icon: <Shield size={16} className="text-purple-600" />,
    accent: 'border-purple-400 bg-purple-50',
  },
];

export default function DiscountCouponPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const dispatch = useAppDispatch();
  const tier = useAppSelector(selectCurrentTier);
  const trialUntil = useAppSelector((s) => s.subscription.accountEntitlement?.trialUntil);
  // A running free trial is not a purchase: the trial user can buy any plan (it replaces the
  // trial). Otherwise only real upgrades are offered — Business, Pro+Sync and Enterprise have
  // nothing higher to buy here, and a "Mejorar plan" that lists cheaper plans is a downgrade.
  const onTrial = trialRemainingDays(trialUntil) !== null;
  const purchaseBaseTier = onTrial ? SubscriptionTier.Lite : tier;
  const upgradeOptions = PLAN_OPTIONS.filter(
    (p) => p.tier !== purchaseBaseTier && bestTier(purchaseBaseTier, p.tier) === p.tier,
  );
  const canUpgrade = upgradeOptions.length > 0;
  const currentCompany = useAppSelector(selectCurrentCompany);
  const authToken = useAppSelector(selectAuthToken);

  const [email, setEmail] = useState('');
  const [isEditingEmail, setIsEditingEmail] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [promoResponse, setPromoResponse] = useState<PromoResponse | null>(null);
  const [promoStatus, setPromoStatus] = useState<PromoStatus | null>(null);
  const [storedRef, setStoredRef] = useState('');
  const [storedRefDate, setStoredRefDate] = useState(0);
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);

  // N1CO card payment state
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionTier | null>(null);
  const [cardPurchasing, setCardPurchasing] = useState(false);
  const [cardForm, setCardForm] = useState<CardForm>({
    cardNumber: '',
    cardholderName: '',
    expiryMonth: '',
    expiryYear: '',
    cvv: '',
    cardEmail: '',
  });

  useEffect(() => {
    loadStoredData();
  }, []);

  useEffect(() => {
    if (storedRef && isActivePromoRef()) {
      checkPromoStatus(storedRef);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedRef]);

  function isActivePromoRef(): boolean {
    if (!storedRef) return false;
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return storedRefDate > oneDayAgo;
  }

  async function loadStoredData() {
    const savedEmail = await appStorage.getItem(STORAGE_EMAIL_KEY);
    const savedRef = await appStorage.getItem(STORAGE_PROMO_REF_KEY);
    const savedDate = await appStorage.getItem(STORAGE_PROMO_DATE_KEY);
    if (savedEmail) setEmail(savedEmail);
    if (savedRef) setStoredRef(savedRef);
    if (savedDate) setStoredRefDate(parseFloat(savedDate));
  }

  async function saveEmail() {
    await appStorage.setItem(STORAGE_EMAIL_KEY, email);
    setIsEditingEmail(false);
  }

  async function requestPromoCode() {
    if (!email.trim()) {
      toast.error('Por favor ingresa tu correo electrónico');
      return;
    }
    setLoading(true);
    try {
      // Clear expired reference
      if (storedRef && !isActivePromoRef()) {
        await appStorage.removeItem(STORAGE_PROMO_REF_KEY);
        await appStorage.removeItem(STORAGE_PROMO_DATE_KEY);
        setStoredRef('');
        setStoredRefDate(0);
      }

      const userId = `desktop_user_${Date.now()}`;

      const resp = await fetch(`${API_BASE}/promo/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          email: email.trim(),
          nit: currentCompany?.nit,
          orderReference: storedRef || undefined,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error((err as any).message ?? 'Error al solicitar cupón');
      }

      const data = (await resp.json()) as PromoResponse;
      setPromoResponse(data);

      if (data.orderReference) {
        const now = Date.now();
        await appStorage.setItem(STORAGE_PROMO_REF_KEY, data.orderReference);
        await appStorage.setItem(STORAGE_PROMO_DATE_KEY, String(now));
        setStoredRef(data.orderReference);
        setStoredRefDate(now);
      }
    } catch (err: any) {
      toast.error(err.message ?? 'Error al solicitar código promocional');
    } finally {
      setLoading(false);
    }
  }

  async function checkPromoStatus(ref: string) {
    if (!ref) return;
    setCheckingStatus(true);
    try {
      const resp = await fetch(`${API_BASE}/promo/status/${encodeURIComponent(ref)}`);

      if (resp.status === 404) {
        // Email was sent; treat as pending success
        setPromoResponse({
          success: true,
          message: 'El código promocional fue enviado a tu correo electrónico.',
          orderReference: ref,
        });
        return;
      }

      if (!resp.ok) throw new Error('Error al verificar estado del código');

      const status = (await resp.json()) as PromoStatus;
      setPromoStatus(status);

      if (status.status === 'approved') {
        // Clear stored reference
        await appStorage.removeItem(STORAGE_PROMO_REF_KEY);
        await appStorage.removeItem(STORAGE_PROMO_DATE_KEY);
        setStoredRef('');
        setStoredRefDate(0);
        toast.success(
          `¡Código aprobado! ${status.creditsGranted ? `Se han agregado ${status.creditsGranted} facturas a tu cuenta.` : ''}`
        );
      }
    } catch (err: any) {
      toast.error(err.message ?? 'Error al verificar estado');
    } finally {
      setCheckingStatus(false);
    }
  }

  async function handleCardPurchase() {
    if (!selectedPlan) return;
    const { cardNumber, cardholderName, expiryMonth, expiryYear, cvv, cardEmail } = cardForm;
    if (!cardNumber || !cardholderName || !expiryMonth || !expiryYear || !cvv || !cardEmail) {
      toast.error('Por favor completa todos los campos de la tarjeta');
      return;
    }
    setCardPurchasing(true);
    try {
      const result = await dispatch(purchaseN1CO({
        tier: selectedPlan,
        cardData: { cardNumber: cardNumber.replace(/\s/g, ''), cardholderName, expiryMonth, expiryYear, cvv },
        customer: { email: cardEmail, name: cardholderName },
      }));
      if (purchaseN1CO.fulfilled.match(result)) {
        toast.success('¡Suscripción activada! Bienvenido a tu nuevo plan.');
        setSelectedPlan(null);
        setCardForm({ cardNumber: '', cardholderName: '', expiryMonth: '', expiryYear: '', cvv: '', cardEmail: '' });
      } else {
        toast.error((result.payload as string) ?? 'Error al procesar el pago');
      }
    } finally {
      setCardPurchasing(false);
    }
  }

  function formatCardNumber(value: string) {
    return value.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
  }

  // ── Approved state ────────────────────────────────────────────────────────

  if (promoStatus?.status === 'approved') {
    return (
      <div className="max-w-lg mx-auto space-y-6">
        <PageHeader title="Código Procesado" />
        <Card className="flex flex-col items-center gap-4 py-8 text-center">
          <CheckCircle size={56} className="text-green-500" />
          <h2 className="text-xl font-bold text-brand-900">¡Código promocional procesado!</h2>
          {promoStatus.creditsGranted && (
            <p className="text-brand-600">
              Se han agregado{' '}
              <span className="font-semibold">{promoStatus.creditsGranted}</span> facturas a tu
              cuenta.
            </p>
          )}
          {promoStatus.orderReference && (
            <div className="text-xs text-brand-400 font-mono bg-brand-50 px-3 py-1.5 rounded">
              {promoStatus.orderReference}
            </div>
          )}
          <Button variant="primary" onClick={() => navigate(-1)}>
            Continuar
          </Button>
        </Card>
      </div>
    );
  }

  // ── Promo requested state ─────────────────────────────────────────────────

  if (promoResponse) {
    return (
      <div className="max-w-lg mx-auto space-y-6">
        <PageHeader title={promoResponse.success ? '¡Solicitud Enviada!' : 'Información'} />
        <Card className="flex flex-col items-center gap-4 py-8 text-center">
          <CheckCircle
            size={56}
            className={promoResponse.success ? 'text-green-500' : 'text-brand-400'}
          />
          <p className="text-brand-700">{promoResponse.message}</p>

          {promoResponse.success && (
            <div className="w-full rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
              Enviamos un código promocional a tu correo electrónico.
            </div>
          )}

          {promoResponse.orderReference && (
            <div className="space-y-1 text-center">
              <p className="text-xs text-brand-400">Código de Referencia:</p>
              <div className="font-mono text-sm bg-brand-50 px-4 py-2 rounded-lg border border-brand-200">
                {promoResponse.orderReference}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2 w-full">
            {promoResponse.orderReference && (
              <Button
                variant="secondary"
                loading={checkingStatus}
                onClick={() => checkPromoStatus(promoResponse.orderReference!)}
              >
                Verificar Estado
              </Button>
            )}
            <Button variant="ghost" onClick={() => setPromoResponse(null)}>
              Volver al formulario
            </Button>
            <Button variant="primary" onClick={() => navigate(-1)}>
              Continuar
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // ── Main form ─────────────────────────────────────────────────────────────

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <PageHeader
        title="Planes y Códigos Promocionales"
        subtitle="Gestiona tu suscripción o aplica un código de descuento"
      />

      {/* Current tier */}
      <Card className="flex items-center gap-3">
        <Crown size={20} className="text-accent-600 shrink-0" />
        <div>
          <p className="text-sm text-brand-500">Plan actual</p>
          <p className="font-semibold text-brand-800">{TIER_LABELS[tier]}</p>
        </div>
        {canUpgrade && (
          <Button
            variant="primary"
            size="sm"
            className="ml-auto"
            onClick={() => setShowSubscriptionModal(true)}
          >
            Mejorar plan
          </Button>
        )}
      </Card>

      {/* Subscription upgrade cards */}
      {canUpgrade && (
        <Card className="space-y-3">
          <h2 className="font-semibold text-brand-800">Planes disponibles</h2>
          <div className="space-y-2">
            {purchaseBaseTier === SubscriptionTier.Lite && (
              <button
                onClick={() => setShowSubscriptionModal(true)}
                className="w-full text-left rounded-lg border border-brand-200 px-4 py-3 hover:border-accent-400 hover:bg-accent-50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-brand-800">Pro</p>
                    <p className="text-xs text-brand-500">{PRO_MAX_COMPANIES} empresas · Libros IVA · Sin anuncios · Drive</p>
                  </div>
                  <Badge variant="info">Actualizar</Badge>
                </div>
              </button>
            )}
            <button
              onClick={() => setShowSubscriptionModal(true)}
              className="w-full text-left rounded-lg border border-brand-200 px-4 py-3 hover:border-accent-400 hover:bg-accent-50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-brand-800">Business</p>
                  <p className="text-xs text-brand-500">
                    Todo lo de Pro · Empresas ilimitadas
                  </p>
                </div>
                <Badge variant="info">Actualizar</Badge>
              </div>
            </button>
          </div>
        </Card>
      )}

      {/* N1CO card payment */}
      {canUpgrade && (
        <Card className="space-y-4">
          <div className="flex items-center gap-2">
            <CreditCard size={18} className="text-accent-600 shrink-0" />
            <h2 className="font-semibold text-brand-800">Pagar con tarjeta</h2>
          </div>

          <N1COBadge variant="block" />

          {!authToken && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-2">
              <Info size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">
                Debes <strong>iniciar sesión con Google</strong> para suscribirte. Esto vincula tu pago con tu cuenta.
              </p>
            </div>
          )}

          {onTrial && (
            <p className="text-sm text-brand-600" data-testid="promo-trial-note">
              Estás en la prueba gratis de Pro+Sync. Al suscribirte, la prueba termina y pasas al
              plan que elijas (Pro y Business no incluyen la sincronización entre dispositivos).
            </p>
          )}

          {/* Plan selector */}
          <div className="grid grid-cols-2 gap-2">
            {upgradeOptions.map((plan) => (
              <button
                key={plan.tier}
                onClick={() => setSelectedPlan(selectedPlan === plan.tier ? null : plan.tier)}
                className={[
                  'flex flex-col gap-1 rounded-xl border-2 px-4 py-3 text-left transition-all',
                  selectedPlan === plan.tier ? plan.accent + ' shadow-sm' : 'border-brand-200 hover:border-brand-300',
                ].join(' ')}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-semibold text-brand-900">
                    {plan.icon}
                    {plan.label}
                  </div>
                  <span className="text-sm font-bold text-brand-700">{plan.price}</span>
                </div>
                <p className="text-xs text-brand-500">{plan.description}</p>
              </button>
            ))}
          </div>

          {/* Card form — only when plan selected */}
          {selectedPlan && (
            <div className="space-y-3 border-t border-brand-100 pt-4">
              <Input
                label="Nombre del titular"
                value={cardForm.cardholderName}
                onChange={(e) => setCardForm((f) => ({ ...f, cardholderName: e.target.value }))}
                placeholder="Como aparece en la tarjeta"
              />
              <Input
                label="Número de tarjeta"
                value={cardForm.cardNumber}
                onChange={(e) => setCardForm((f) => ({ ...f, cardNumber: formatCardNumber(e.target.value) }))}
                placeholder="1234 5678 9012 3456"
                maxLength={19}
              />
              <div className="grid grid-cols-3 gap-2">
                <Input
                  label="Mes"
                  value={cardForm.expiryMonth}
                  onChange={(e) => setCardForm((f) => ({ ...f, expiryMonth: e.target.value.replace(/\D/g, '').slice(0, 2) }))}
                  placeholder="MM"
                  maxLength={2}
                />
                <Input
                  label="Año"
                  value={cardForm.expiryYear}
                  onChange={(e) => setCardForm((f) => ({ ...f, expiryYear: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                  placeholder="AAAA"
                  maxLength={4}
                />
                <Input
                  label="CVV"
                  value={cardForm.cvv}
                  onChange={(e) => setCardForm((f) => ({ ...f, cvv: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                  placeholder="123"
                  maxLength={4}
                />
              </div>
              <Input
                label="Correo de facturación"
                value={cardForm.cardEmail}
                onChange={(e) => setCardForm((f) => ({ ...f, cardEmail: e.target.value }))}
                placeholder="tu@correo.com"
                type="email"
              />
              <Button
                variant="primary"
                className="w-full"
                loading={cardPurchasing}
                disabled={!authToken}
                onClick={handleCardPurchase}
              >
                Pagar {PLAN_OPTIONS.find((p) => p.tier === selectedPlan)?.price}
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-brand-200" />
        <span className="text-xs text-brand-400">o usa un código</span>
        <div className="flex-1 h-px bg-brand-200" />
      </div>

      {/* Promo code section */}
      <Card className="space-y-4">
        <div className="flex items-center gap-2">
          <Ticket size={18} className="text-accent-600" />
          <h2 className="font-semibold text-brand-800">Código de Descuento</h2>
        </div>

        {/* Info */}
        <div className="flex gap-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2.5">
          <Info size={14} className="text-blue-500 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700">
            Ingresa tu correo para recibir el código promocional. El código será enviado a tu
            bandeja de entrada.
          </p>
        </div>

        {/* Email */}
        <div className="space-y-1">
          <label className="text-sm font-medium text-brand-700">Correo electrónico</label>
          {isEditingEmail ? (
            <div className="flex gap-2">
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@correo.com"
                type="email"
                className="flex-1"
              />
              <Button
                variant="secondary"
                size="sm"
                icon={<Check size={14} />}
                onClick={saveEmail}
              >
                Guardar
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex-1 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-700">
                {email || <span className="text-brand-400">Sin correo configurado</span>}
              </div>
              <button
                onClick={() => setIsEditingEmail(true)}
                className="p-1.5 rounded-lg text-brand-400 hover:text-brand-600 hover:bg-brand-100 transition-colors"
                aria-label="Editar correo"
              >
                <Pencil size={14} />
              </button>
            </div>
          )}
        </div>

        <Button
          variant="primary"
          className="w-full"
          loading={loading || checkingStatus}
          disabled={!email.trim()}
          onClick={requestPromoCode}
        >
          Solicitar Código Promocional
        </Button>

        {storedRef && isActivePromoRef() && (
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            loading={checkingStatus}
            onClick={() => checkPromoStatus(storedRef)}
          >
            Verificar solicitud anterior
          </Button>
        )}
      </Card>

      <SubscriptionModal
        isOpen={showSubscriptionModal}
        onClose={() => setShowSubscriptionModal(false)}
      />
    </div>
  );
}
