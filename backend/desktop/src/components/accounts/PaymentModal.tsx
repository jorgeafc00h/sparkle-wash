import { useEffect, useMemo, useState } from 'react';
import { CreditCard } from 'lucide-react';
import { AccountEntry } from '@/types/accounts';
import { AccountsLedgerService, todayLocalDate } from '@/services/accounts/AccountsLedgerService';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import { Select } from '@/components/common/Select';

interface PaymentModalProps {
  entry: AccountEntry | null;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: {
    paymentDate: string;
    amount: number;
    methodCode: string;
    reference?: string;
    notes?: string;
  }) => void;
}

const PAYMENT_METHODS = [
  { label: 'Efectivo', value: '01' },
  { label: 'Tarjeta', value: '02' },
  { label: 'Transferencia', value: '03' },
  { label: 'Cheque', value: '04' },
  { label: 'Otro', value: '99' },
];

const currency = new Intl.NumberFormat('es-SV', {
  style: 'currency',
  currency: 'USD',
});

function today(): string {
  return todayLocalDate();
}

export function PaymentModal({ entry, isOpen, onClose, onSubmit }: PaymentModalProps) {
  const [paymentDate, setPaymentDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [methodCode, setMethodCode] = useState('03');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  function resetForm() {
    setPaymentDate(today());
    setAmount('');
    setMethodCode('03');
    setReference('');
    setNotes('');
  }

  useEffect(() => {
    if (isOpen) {
      resetForm();
    }
  }, [entry?.id, isOpen]);

  const parsedAmount = Number(amount);
  const error = useMemo(() => {
    if (!entry || amount.trim() === '') return null;
    return AccountsLedgerService.validatePayment(entry, parsedAmount);
  }, [amount, entry, parsedAmount]);

  function handleSubmit() {
    if (!entry) return;
    const validation = AccountsLedgerService.validatePayment(entry, parsedAmount);
    if (validation) return;
    onSubmit({
      paymentDate,
      amount: parsedAmount,
      methodCode,
      reference,
      notes,
    });
    resetForm();
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={entry?.direction === 'receivable' ? 'Registrar cobro' : 'Registrar pago'}
      size="md"
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              resetForm();
              onClose();
            }}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!entry || !!error || amount.trim() === ''}
            icon={<CreditCard size={16} />}
            data-testid="cuentas.payment.submit"
          >
            Guardar
          </Button>
        </>
      }
    >
      {entry && (
        <div className="space-y-4" data-testid="cuentas.payment.modal">
          <div className="rounded-lg bg-brand-50 border border-brand-100 p-3">
            <p className="text-sm font-semibold text-brand-900">{entry.party.name}</p>
            <p className="text-xs text-brand-500 mt-0.5">{entry.documentNumber}</p>
            <p className="text-sm text-brand-700 mt-2">
              Saldo pendiente: <span className="font-semibold">{currency.format(entry.balance)}</span>
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Fecha"
              type="date"
              value={paymentDate}
              onChange={(event) => setPaymentDate(event.target.value)}
              data-testid="cuentas.payment.date"
            />
            <Input
              label="Monto"
              type="number"
              min="0"
              step="0.01"
              required
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              error={error ?? undefined}
              helperText="Ingrese el monto a registrar"
              data-testid="cuentas.payment.amount"
            />
          </div>

          <Select
            label="Método"
            options={PAYMENT_METHODS}
            value={methodCode}
            onChange={(event) => setMethodCode(event.target.value)}
            data-testid="cuentas.payment.method"
          />

          <Input
            label="Referencia"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder="Transferencia, cheque, comprobante"
            data-testid="cuentas.payment.reference"
          />

          <div className="flex flex-col gap-1">
            <label htmlFor="cuentas-payment-notes" className="text-sm font-medium text-brand-700">
              Notas
            </label>
            <textarea
              id="cuentas-payment-notes"
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="w-full rounded-lg border border-brand-300 px-3 py-2 text-sm text-brand-900 focus:outline-none focus:ring-2 focus:ring-accent-500"
              data-testid="cuentas.payment.notes"
            />
          </div>
        </div>
      )}
    </Modal>
  );
}

export default PaymentModal;
