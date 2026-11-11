import { Input } from '@/components/common/Input';
import { Select } from '@/components/common/Select';
import type { PaymentTermsDraft } from '@/utils/paymentTerms';
import { addPaymentTermToDate, normalizePaymentCondition } from '@/utils/paymentTerms';

const PAYMENT_CONDITION_OPTIONS = [
  { label: '1 - Contado', value: '1' },
  { label: '2 - Crédito', value: '2' },
  { label: '3 - Otro', value: '3' },
];

const PAYMENT_TERM_OPTIONS = [
  { label: '01 - Días', value: '01' },
  { label: '02 - Meses', value: '02' },
  { label: '03 - Años', value: '03' },
];

interface PaymentTermsFieldsProps {
  value: PaymentTermsDraft;
  onChange: (value: PaymentTermsDraft) => void;
  issueDate?: string;
}

export function PaymentTermsFields({ value, onChange, issueDate }: PaymentTermsFieldsProps) {
  const condition = normalizePaymentCondition(value.paymentCondition);
  const isCash = condition === 1;
  const parsedPeriod = Number.parseInt(value.paymentTermPeriod || '30', 10);
  const estimatedDueDate = !isCash
    ? addPaymentTermToDate(
      issueDate,
      value.paymentTermCode || '01',
      Number.isFinite(parsedPeriod) && parsedPeriod > 0 ? parsedPeriod : 30,
    )
    : undefined;

  function update(patch: Partial<PaymentTermsDraft>) {
    onChange({ ...value, ...patch });
  }

  function handleConditionChange(rawValue: string) {
    const nextCondition = normalizePaymentCondition(rawValue);
    if (nextCondition === 1) {
      onChange({
        paymentCondition: 1,
        paymentTermCode: '',
        paymentTermPeriod: '',
        dueDate: '',
        openInAccounts: false,
      });
      return;
    }

    onChange({
      paymentCondition: nextCondition,
      paymentTermCode: value.paymentTermCode || '01',
      paymentTermPeriod: value.paymentTermPeriod || '30',
      dueDate: '',
      openInAccounts: false,
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Select
          label="Condición"
          value={String(condition)}
          onChange={(event) => handleConditionChange(event.target.value)}
          options={PAYMENT_CONDITION_OPTIONS}
          data-testid="payment-condition"
        />
        {!isCash && (
          <>
            <Select
              label="Plazo"
              value={value.paymentTermCode || '01'}
              onChange={(event) => update({ paymentTermCode: event.target.value })}
              options={PAYMENT_TERM_OPTIONS}
              data-testid="payment-term-code"
            />
            <Input
              label="Periodo"
              type="number"
              min="1"
              step="1"
              value={value.paymentTermPeriod || '30'}
              onChange={(event) => update({ paymentTermPeriod: event.target.value })}
              data-testid="payment-term-period"
            />
          </>
        )}
      </div>

      {!isCash && (
        <p className="text-sm text-brand-600" data-testid="payment-due-date">
          Vencimiento estimado: {estimatedDueDate || 'se calculará con el plazo'}
        </p>
      )}

      {isCash && (
        <div className="space-y-3">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={value.openInAccounts}
              onChange={(event) => update({
                openInAccounts: event.target.checked,
                dueDate: event.target.checked ? value.dueDate || issueDate || '' : '',
              })}
              className="w-4 h-4 rounded border-brand-300 text-accent-600 focus:ring-accent-500"
              data-testid="payment-open-in-accounts"
            />
            <span className="text-sm text-brand-700">Registrar saldo pendiente</span>
          </label>
          {value.openInAccounts && (
            <Input
              label="Vencimiento"
              type="date"
              value={value.dueDate || issueDate || ''}
              onChange={(event) => update({ dueDate: event.target.value })}
              data-testid="payment-due-date"
            />
          )}
        </div>
      )}
    </div>
  );
}

export default PaymentTermsFields;
