// Payment capture for the POS register: one or several payments (split —
// POS Phase 2 design §2) until the balance is zero. Cash (tendered/change) or
// card on the EXTERNAL datáfono — we only record auth evidence (last 4, auth
// code), never full PAN/CVV. Change comes only from cash; a card payment can
// never exceed the balance; $0.05 rounding only when the whole sale is paid
// with one cash payment (balance math in services/tickets/splitPayments).

import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Select } from '@/components/common/Select';
import { round2 } from '@/types/ticket';
import {
  BALANCE_EPSILON,
  amountDue,
  capToRemaining,
  exceedsRemaining,
  remainingBalance,
  sumPaymentAmounts,
} from '@/services/tickets/splitPayments';

export interface CartPayment {
  method: 'EFECTIVO' | 'TARJETA_POS' | 'OTRO';
  amount: number;
  tendered?: number;
  change?: number;
  posAuthCode?: string;
  posLast4?: string;
  posCardType?: 'VISA' | 'MASTERCARD' | 'AMEX' | 'OTRO';
  posReference?: string;
}

interface PaymentModalProps {
  isOpen: boolean;
  /** Exact total — what a card / "otro" / split payment charges. */
  total: number;
  /**
   * Cash total, with the $0.05 rounding applied when the shop enables it.
   * Defaults to `total` (rounding only applies to a single cash payment).
   */
  cashTotal?: number;
  onClose: () => void;
  onConfirm: (payments: CartPayment[]) => void | Promise<void>;
}

/**
 * Most change a cashier can hand back. Anything above is a typo or a barcode
 * scanned into the field (7501234567890 "received"), never a real payment.
 */
export const MAX_CASH_CHANGE = 1000;

const METHOD_LABEL: Record<CartPayment['method'], string> = {
  EFECTIVO: 'Efectivo',
  TARJETA_POS: 'Tarjeta',
  OTRO: 'Otro',
};

function parseMoney(text: string): number | undefined {
  const trimmed = text.trim().replace(',', '.');
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

export function PaymentModal({ isOpen, total: exactTotal, cashTotal, onClose, onConfirm }: PaymentModalProps) {
  const [rows, setRows] = useState<CartPayment[]>([]);
  const [method, setMethod] = useState<CartPayment['method']>('EFECTIVO');
  const [amountText, setAmountText] = useState('');
  const [tendered, setTendered] = useState<number>(0);
  const [cardType, setCardType] = useState<'VISA' | 'MASTERCARD' | 'AMEX' | 'OTRO'>('VISA');
  const [last4, setLast4] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [reference, setReference] = useState('');
  const [confirming, setConfirming] = useState(false);

  const resetEntry = (nextMethod: CartPayment['method'] = 'EFECTIVO') => {
    setMethod(nextMethod);
    setAmountText('');
    setTendered(0);
    setLast4('');
    setAuthCode('');
    setReference('');
  };

  // Every opening starts clean (a cancelled split must not linger).
  useEffect(() => {
    if (!isOpen) return;
    setRows([]);
    resetEntry('EFECTIVO');
    setCardType('VISA');
  }, [isOpen]);

  const roundedCash = cashTotal ?? exactTotal;
  const typedAmount = parseMoney(amountText);
  const due = amountDue({ exactTotal, cashTotal: roundedCash, rows, entryMethod: method, entryAmount: typedAmount });
  const remaining = remainingBalance(due, rows);
  const paid = sumPaymentAmounts(rows);
  const entryAmount = capToRemaining(typedAmount, remaining);
  const capped = exceedsRemaining(typedAmount, remaining);
  const roundingApplied = round2(due - exactTotal) !== 0;
  const roundingDiff = round2(roundedCash - exactTotal);
  const isCash = method === 'EFECTIVO';

  const change = useMemo(
    () => (isCash && tendered > 0 ? round2(Math.max(0, tendered - entryAmount)) : 0),
    [isCash, tendered, entryAmount],
  );

  // Cash with nothing typed = exact payment (fast path; the quick-cash chips
  // cover the "recibí billete X" case). Short only when explicitly underpaid.
  const tenderedTooHigh = isCash && tendered > round2(entryAmount + MAX_CASH_CHANGE);
  const cashShort = isCash && tendered > 0 && tendered + BALANCE_EPSILON < entryAmount;
  const entryOpen = remaining > BALANCE_EPSILON;
  const entryValid = entryOpen && entryAmount > 0 && !cashShort && !tenderedTooHigh;
  const entrySettles = entryValid && Math.abs(remaining - entryAmount) < BALANCE_EPSILON;
  const settledByRows = rows.length > 0 && !entryOpen;
  const canConfirm = settledByRows || entrySettles;

  const entryPayment = (): CartPayment => ({
    method,
    amount: entryAmount,
    tendered: isCash ? (tendered > 0 ? round2(tendered) : entryAmount) : undefined,
    change: isCash ? change : undefined,
    posCardType: method === 'TARJETA_POS' ? cardType : undefined,
    posLast4: method === 'TARJETA_POS' && last4 ? last4 : undefined,
    posAuthCode: method === 'TARJETA_POS' ? authCode.trim() || undefined : undefined,
    posReference: method === 'TARJETA_POS' ? reference.trim() || undefined : undefined,
  });

  const addRow = () => {
    if (!entryValid) return;
    setRows((prev) => [...prev, entryPayment()]);
    // The rest is usually cash ("pagó una parte con tarjeta y el resto en efectivo").
    resetEntry('EFECTIVO');
  };

  const removeRow = (index: number) => setRows((prev) => prev.filter((_, i) => i !== index));

  const confirm = async () => {
    if (!canConfirm) return;
    const payments = settledByRows ? rows : [...rows, entryPayment()];
    setConfirming(true);
    try {
      await onConfirm(payments);
    } finally {
      setConfirming(false);
    }
  };

  const quickCash = [entryAmount, Math.ceil(entryAmount), Math.ceil(entryAmount / 5) * 5, Math.ceil(entryAmount / 10) * 10]
    .map((v) => round2(v))
    .filter((v, i, arr) => v > 0 && arr.indexOf(v) === i && v >= entryAmount)
    .slice(0, 4);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Cobrar $${due.toFixed(2)}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          {entryOpen && (
            <Button
              variant="secondary"
              data-testid="btn-add-payment"
              disabled={!entryValid || entrySettles}
              onClick={addRow}
              title="Registra este pago y cobra el saldo con otro método"
            >
              Agregar pago
            </Button>
          )}
          <Button
            data-testid="btn-confirm-payment"
            disabled={!canConfirm}
            loading={confirming}
            onClick={confirm}
          >
            Confirmar pago
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-testid="payment-modal">
        {rows.length > 0 && (
          <div className="space-y-1.5" data-testid="pay-rows">
            {rows.map((row, i) => (
              <div key={i} data-testid={`pay-row-${i}`} className="flex items-center justify-between rounded-lg border border-brand-200 px-3 py-1.5 text-sm">
                <div className="min-w-0">
                  <span className="font-medium text-brand-900">{METHOD_LABEL[row.method]}</span>
                  {row.method === 'EFECTIVO' && row.tendered !== undefined && row.tendered > row.amount && (
                    <span className="text-xs text-slate-500"> · recibido ${row.tendered.toFixed(2)}, vuelto ${(row.change ?? 0).toFixed(2)}</span>
                  )}
                  {row.method === 'TARJETA_POS' && row.posLast4 && <span className="text-xs text-slate-500"> · ****{row.posLast4}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">${row.amount.toFixed(2)}</span>
                  <button
                    type="button"
                    data-testid={`pay-row-remove-${i}`}
                    onClick={() => removeRow(i)}
                    className="text-slate-400 hover:text-error"
                    title="Quitar este pago"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
            <div className="flex justify-between text-sm px-1">
              <span className="text-slate-600">Pagado ${paid.toFixed(2)}</span>
              <span data-testid="pay-balance" className={`font-semibold ${entryOpen ? 'text-amber-700' : 'text-emerald-700'}`}>
                {entryOpen ? `Saldo pendiente $${remaining.toFixed(2)}` : 'Saldo cubierto'}
              </span>
            </div>
          </div>
        )}

        {entryOpen && (
          <>
            <Select
              data-testid="pay-method-select"
              label={rows.length > 0 ? 'Método del siguiente pago' : 'Método de pago'}
              value={method}
              options={[
                { label: 'Efectivo', value: 'EFECTIVO' },
                { label: 'Tarjeta (datáfono)', value: 'TARJETA_POS' },
                { label: 'Otro', value: 'OTRO' },
              ]}
              onChange={(e) => {
                setMethod(e.target.value as CartPayment['method']);
                setTendered(0);
              }}
            />

            <div className="space-y-1">
              <Input
                data-testid="pay-amount"
                label="Monto de este pago"
                type="number"
                min={0}
                step="0.01"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                placeholder={remaining.toFixed(2)}
                helperText={amountText ? undefined : 'Vacío = todo el saldo. Escribe una parte para dividir el pago.'}
              />
              {capped && (
                <p data-testid="pay-amount-capped" className="text-xs text-amber-700">
                  {isCash
                    ? `El monto no puede pasar del saldo: se aplican $${entryAmount.toFixed(2)} (anota lo recibido en "Efectivo recibido").`
                    : `Un pago con ${METHOD_LABEL[method].toLowerCase()} no puede pasar del saldo: se aplican $${entryAmount.toFixed(2)}.`}
                </p>
              )}
            </div>

            {isCash && (
              <div className="space-y-2">
                <Input
                  data-testid="pay-cash-tendered"
                  label="Efectivo recibido"
                  type="number"
                  min={0}
                  step="0.01"
                  value={tendered || ''}
                  onChange={(e) => setTendered(Number(e.target.value) || 0)}
                  placeholder={entryAmount.toFixed(2)}
                  autoFocus
                />
                <div className="flex flex-wrap gap-1.5">
                  {quickCash.map((v) => (
                    <button
                      key={v}
                      type="button"
                      data-testid={`pay-quick-${v.toFixed(2)}`}
                      onClick={() => setTendered(round2(v))}
                      className="px-2.5 py-1 text-xs rounded-full border border-brand-300 text-brand-700 hover:bg-brand-50"
                    >
                      ${v.toFixed(2)}
                    </button>
                  ))}
                </div>
                <div className="flex justify-between items-center rounded-lg bg-brand-50 px-3 py-2">
                  <span className="text-sm text-brand-700">Vuelto</span>
                  <span data-testid="pay-cash-change" className="text-lg font-bold text-brand-900">
                    ${change.toFixed(2)}
                  </span>
                </div>
                {cashShort && (
                  <p data-testid="pay-cash-short" className="text-xs text-error">
                    El efectivo recibido no cubre ${entryAmount.toFixed(2)}. Escribe una parte en "Monto de este pago" para dividir el cobro.
                  </p>
                )}
                {tenderedTooHigh && (
                  <p data-testid="pay-cash-too-high" className="text-xs text-error">
                    Monto recibido demasiado alto (el vuelto no puede pasar de ${MAX_CASH_CHANGE.toFixed(0)}). Revisa la cifra.
                  </p>
                )}
                {roundingApplied && roundingDiff !== 0 && (
                  <p data-testid="pay-cash-rounding" className="text-xs text-slate-500">
                    Total en efectivo redondeado a $0.05 ({roundingDiff > 0 ? '+' : '−'}${Math.abs(roundingDiff).toFixed(2)}). Con tarjeta o pago dividido se cobra el monto exacto.
                  </p>
                )}
              </div>
            )}

            {method === 'TARJETA_POS' && (
              <div className="space-y-2">
                <p className="text-xs text-slate-500">
                  Cobra en tu datáfono y registra la evidencia (nunca el número completo de la tarjeta).
                </p>
                <Select
                  data-testid="pay-card-type"
                  label="Tipo"
                  value={cardType}
                  options={[
                    { label: 'VISA', value: 'VISA' },
                    { label: 'Mastercard', value: 'MASTERCARD' },
                    { label: 'AMEX', value: 'AMEX' },
                    { label: 'Otro', value: 'OTRO' },
                  ]}
                  onChange={(e) => setCardType(e.target.value as typeof cardType)}
                />
                <Input
                  data-testid="pay-card-last4"
                  label="Últimos 4 dígitos (opcional)"
                  inputMode="numeric"
                  maxLength={4}
                  value={last4}
                  onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                />
                <Input
                  data-testid="pay-card-auth"
                  label="Código de aprobación (opcional)"
                  value={authCode}
                  onChange={(e) => setAuthCode(e.target.value.slice(0, 12))}
                />
                <Input
                  data-testid="pay-card-ref"
                  label="Referencia del voucher del POS (opcional)"
                  value={reference}
                  onChange={(e) => setReference(e.target.value.slice(0, 30))}
                />
              </div>
            )}

            {method === 'OTRO' && (
              <p className="text-sm text-slate-500">Registro genérico del pago por ${entryAmount.toFixed(2)}.</p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
