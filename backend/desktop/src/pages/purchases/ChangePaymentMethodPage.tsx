import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreditCard, ArrowLeft, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/common/Card';
import { Input } from '@/components/common/Input';
import { Button } from '@/components/common/Button';
import { N1COBadge } from '@/components/common/N1COBadge';
import { useToast } from '@/components/common/Toast';
import { useAppSelector, useAppDispatch } from '@/store';
import { selectActiveSubscription } from '@/store/selectors/subscriptionSelectors';
import { selectAuthToken } from '@/store/selectors/authSelectors';
import { changePaymentMethodN1CO } from '@/store/slices/subscriptionSlice';

interface CardForm {
  cardNumber: string;
  cardholderName: string;
  expiryMonth: string;
  expiryYear: string;
  cvv: string;
}

export default function ChangePaymentMethodPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const dispatch = useAppDispatch();
  const activeSubscription = useAppSelector(selectActiveSubscription);
  const authToken = useAppSelector(selectAuthToken);

  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<CardForm>({
    cardNumber: '',
    cardholderName: '',
    expiryMonth: '',
    expiryYear: '',
    cvv: '',
  });

  const isPastDue = activeSubscription?.status === 'payment_failed';
  const noSubscription = !activeSubscription;

  function formatCardNumber(value: string) {
    return value.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
  }

  async function handleSubmit() {
    const { cardNumber, cardholderName, expiryMonth, expiryYear, cvv } = form;
    if (!cardNumber || !cardholderName || !expiryMonth || !expiryYear || !cvv) {
      toast.error('Completa todos los campos de la tarjeta');
      return;
    }
    if (!authToken) {
      toast.error('Debes iniciar sesión con Google');
      return;
    }
    setSubmitting(true);
    try {
      const result = await dispatch(changePaymentMethodN1CO({
        cardData: {
          cardNumber: cardNumber.replace(/\s/g, ''),
          cardholderName,
          expiryMonth,
          expiryYear,
          cvv,
        },
      }));
      if (changePaymentMethodN1CO.fulfilled.match(result)) {
        toast.success('Tarjeta actualizada correctamente.');
        navigate('/settings/account');
      } else {
        toast.error((result.payload as string) ?? 'No se pudo actualizar el método de pago');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div data-testid="change-payment-method" className="max-w-lg mx-auto space-y-6">
      <PageHeader
        title="Actualizar Tarjeta"
        subtitle="Cambia el método de pago de tu suscripción"
      />

      {/* Past-due warning */}
      {isPastDue && (
        <Card
          data-testid="past-due-banner"
          className="border-amber-300 bg-amber-50 flex items-start gap-3 py-4"
        >
          <AlertTriangle className="text-amber-600 flex-shrink-0" size={20} />
          <div className="text-sm">
            <p className="font-semibold text-amber-900">Pago pendiente</p>
            <p className="text-amber-800 mt-1">
              Tu suscripción se encuentra en pausa porque la última cobranza fue rechazada.
              Actualiza tu tarjeta para reanudar el acceso a las funciones premium.
            </p>
          </div>
        </Card>
      )}

      {/* No-subscription state */}
      {noSubscription && (
        <Card className="text-center py-8">
          <p className="text-brand-600 mb-4">
            No tienes una suscripción activa. Primero contrata un plan.
          </p>
          <Button variant="primary" onClick={() => navigate('/settings/promo')}>
            Ver planes
          </Button>
        </Card>
      )}

      {!noSubscription && (
        <Card className="space-y-4">
          <div className="flex items-center gap-2">
            <CreditCard size={18} className="text-accent-600 shrink-0" />
            <h2 className="font-semibold text-brand-800">Nueva tarjeta</h2>
          </div>

          <N1COBadge variant="block" />

          <Input
            label="Nombre del titular"
            value={form.cardholderName}
            onChange={(e) => setForm((f) => ({ ...f, cardholderName: e.target.value }))}
            placeholder="Como aparece en la tarjeta"
          />
          <Input
            label="Número de tarjeta"
            value={form.cardNumber}
            onChange={(e) => setForm((f) => ({ ...f, cardNumber: formatCardNumber(e.target.value) }))}
            placeholder="1234 5678 9012 3456"
            maxLength={19}
          />
          <div className="grid grid-cols-3 gap-2">
            <Input
              label="Mes"
              value={form.expiryMonth}
              onChange={(e) => setForm((f) => ({ ...f, expiryMonth: e.target.value.replace(/\D/g, '').slice(0, 2) }))}
              placeholder="MM"
              maxLength={2}
            />
            <Input
              label="Año"
              value={form.expiryYear}
              onChange={(e) => setForm((f) => ({ ...f, expiryYear: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
              placeholder="AAAA"
              maxLength={4}
            />
            <Input
              label="CVV"
              value={form.cvv}
              onChange={(e) => setForm((f) => ({ ...f, cvv: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
              placeholder="123"
              maxLength={4}
            />
          </div>

          <Button
            variant="primary"
            className="w-full"
            loading={submitting}
            disabled={!authToken}
            onClick={handleSubmit}
          >
            Guardar nueva tarjeta
          </Button>

          <Button
            variant="ghost"
            className="w-full"
            icon={<ArrowLeft size={14} />}
            onClick={() => navigate('/settings/account')}
          >
            Cancelar
          </Button>
        </Card>
      )}
    </div>
  );
}
