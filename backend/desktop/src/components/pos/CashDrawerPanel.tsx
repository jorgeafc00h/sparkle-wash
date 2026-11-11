// Cash drawer bar for the register (and the cierre page): "Caja sin abrir"
// banner with "Abrir caja" (float), or the open session with "Entradas y
// salidas" (cash in/out with a reason, gated by the `pos.cash` action
// permission). Device-local — CashDrawerStore. See add-pos-phase-2 design §6.

import React, { useCallback, useEffect, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, Lock, Wallet } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Select } from '@/components/common/Select';
import { Modal } from '@/components/common/Modal';
import { useToast } from '@/components/common/Toast';
import { useAppDispatch, useAppSelector } from '@/store';
import { selectAuditActor } from '@/store/selectors/localUsersSelectors';
import { recordAuditEvents } from '@/store/slices/auditSlice';
import { useCan } from '@/hooks/useLocalUsers';
import { CashDrawerStore } from '@/services/tickets/CashDrawerStore';
import { getCachedDeviceId, getDeviceId } from '@/services/sync/deviceId';
import { round2, type CashMovement, type CashSession } from '@/types/ticket';

const money = (value: number) => `$${value.toFixed(2)}`;

/** This device's register id (the Device Sync device id), resolved once. */
export function useThisRegisterId(): string | null {
  const [registerId, setRegisterId] = useState<string | null>(() => getCachedDeviceId());
  useEffect(() => {
    if (registerId) return;
    let cancelled = false;
    void getDeviceId().then((id) => {
      if (!cancelled) setRegisterId(id);
    });
    return () => {
      cancelled = true;
    };
  }, [registerId]);
  return registerId;
}

/** Open session + its movements for this register, live. */
export function useCashSession(companyId: string | undefined, registerId: string | null): {
  session: CashSession | null;
  movements: CashMovement[];
  loaded: boolean;
  refresh: () => void;
} {
  const [session, setSession] = useState<CashSession | null>(null);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!companyId || !registerId) return;
    let cancelled = false;
    void (async () => {
      const open = await CashDrawerStore.getOpenSession(companyId, registerId);
      const list = open ? await CashDrawerStore.getMovements(companyId, open.id) : [];
      if (cancelled) return;
      setSession(open);
      setMovements(list);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, registerId, version]);

  useEffect(() => CashDrawerStore.subscribe(refresh), [refresh]);

  return { session, movements, loaded, refresh };
}

interface CashDrawerPanelProps {
  companyId: string;
  className?: string;
}

export function CashDrawerPanel({ companyId, className = '' }: CashDrawerPanelProps) {
  const toast = useToast();
  const dispatch = useAppDispatch();
  const auditActor = useAppSelector(selectAuditActor);
  const canMoveCash = useCan('pos.cash');
  const registerId = useThisRegisterId();
  const { session, movements, loaded } = useCashSession(companyId, registerId);

  const [opening, setOpening] = useState(false);
  const [floatInput, setFloatInput] = useState('');
  const [moving, setMoving] = useState(false);
  const [kind, setKind] = useState<'IN' | 'OUT'>('OUT');
  const [amountInput, setAmountInput] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  if (!registerId || !loaded) return null;

  const cashIn = round2(movements.filter((m) => m.kind === 'IN').reduce((s, m) => s + m.amount, 0));
  const cashOut = round2(movements.filter((m) => m.kind === 'OUT').reduce((s, m) => s + m.amount, 0));

  const openDrawer = async () => {
    const value = floatInput.trim() === '' ? 0 : Number(floatInput.replace(',', '.'));
    if (!Number.isFinite(value) || value < 0) {
      toast.error('Fondo inicial inválido');
      return;
    }
    setSaving(true);
    try {
      const opened = await CashDrawerStore.openSession({ companyId, registerId, openingFloat: value, openedBy: auditActor.name });
      dispatch(recordAuditEvents([{
        actor: auditActor,
        action: 'create',
        entityType: 'closing',
        entityId: opened.id,
        companyId,
        entityLabel: 'Caja',
        summary: `Abrió la caja con un fondo de ${money(opened.openingFloat)}`,
      }]));
      toast.success(`Caja abierta — fondo ${money(opened.openingFloat)}`);
      setOpening(false);
      setFloatInput('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo abrir la caja');
    } finally {
      setSaving(false);
    }
  };

  const saveMovement = async () => {
    const value = Number(amountInput.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) {
      toast.error('Indica un monto mayor que cero');
      return;
    }
    if (!reason.trim()) {
      toast.error('Indica el motivo');
      return;
    }
    setSaving(true);
    try {
      const movement = await CashDrawerStore.addMovement({ companyId, registerId, kind, amount: value, reason, createdBy: auditActor.name });
      dispatch(recordAuditEvents([{
        actor: auditActor,
        action: 'create',
        entityType: 'closing',
        entityId: movement.id,
        companyId,
        entityLabel: 'Caja',
        summary: `${movement.kind === 'IN' ? 'Entrada' : 'Salida'} de efectivo de ${money(movement.amount)}: ${movement.reason}`,
      }]));
      toast.success(`${movement.kind === 'IN' ? 'Entrada' : 'Salida'} de ${money(movement.amount)} registrada`);
      setAmountInput('');
      setReason('');
      setMoving(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo registrar');
    } finally {
      setSaving(false);
    }
  };

  const lockedHint = 'Sin permiso para entradas/salidas de efectivo';

  return (
    <div data-testid="cash-drawer-panel" className={className}>
      {!session ? (
        <div
          data-testid="cash-drawer-closed-banner"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          <span className="flex items-center gap-2"><Wallet size={16} /> Caja sin abrir — abre la caja con el fondo inicial para cuadrar el efectivo al cierre.</span>
          <Button size="sm" data-testid="btn-open-cash-drawer" onClick={() => setOpening(true)}>Abrir caja</Button>
        </div>
      ) : (
        <div
          data-testid="cash-drawer-open-info"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm text-brand-800"
        >
          <span className="flex items-center gap-2">
            <Wallet size={16} className="text-accent-600" />
            Caja abierta desde {new Date(session.openedAt).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })} · Fondo {money(session.openingFloat)}
            {cashIn > 0 && <span data-testid="cash-drawer-in"> · Entradas {money(cashIn)}</span>}
            {cashOut > 0 && <span data-testid="cash-drawer-out"> · Salidas {money(cashOut)}</span>}
          </span>
          <span title={canMoveCash ? 'Entradas y salidas de efectivo' : lockedHint} data-testid="cash-movement-hint">
            <Button
              size="sm"
              variant="secondary"
              data-testid="btn-cash-movement"
              disabled={!canMoveCash}
              aria-disabled={!canMoveCash}
              data-locked={canMoveCash ? undefined : 'permission'}
              aria-label={canMoveCash ? 'Entradas y salidas de efectivo' : `Entradas y salidas (no disponible: ${lockedHint})`}
              onClick={() => setMoving(true)}
            >
              {canMoveCash ? <ArrowDownCircle size={14} /> : <Lock size={14} />} Entradas y salidas
            </Button>
          </span>
        </div>
      )}

      <Modal
        isOpen={opening}
        onClose={() => { if (!saving) setOpening(false); }}
        title="Abrir caja"
        size="sm"
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpening(false)} disabled={saving}>Cancelar</Button>
            <Button data-testid="btn-confirm-open-cash" loading={saving} onClick={() => void openDrawer()}>Abrir caja</Button>
          </div>
        )}
      >
        <div className="space-y-2">
          <p className="text-sm text-slate-600">Cuenta el efectivo con el que inicia la caja (fondo para dar vuelto).</p>
          <Input
            data-testid="cash-open-float-input"
            data-autofocus
            label="Fondo inicial ($)"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={floatInput}
            onChange={(e) => setFloatInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void openDrawer(); }}
          />
        </div>
      </Modal>

      <Modal
        isOpen={moving}
        onClose={() => { if (!saving) setMoving(false); }}
        title="Entradas y salidas de efectivo"
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setMoving(false)} disabled={saving}>Cerrar</Button>
            <Button data-testid="btn-confirm-cash-movement" loading={saving} disabled={!canMoveCash} onClick={() => void saveMovement()}>
              Registrar
            </Button>
          </div>
        )}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Select
              data-testid="cash-movement-kind"
              label="Tipo"
              value={kind}
              options={[
                { label: 'Salida (pago, retiro)', value: 'OUT' },
                { label: 'Entrada (cambio, depósito)', value: 'IN' },
              ]}
              onChange={(e) => setKind(e.target.value as 'IN' | 'OUT')}
            />
            <Input
              data-testid="cash-movement-amount"
              data-autofocus
              label="Monto ($)"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
            />
          </div>
          <Input
            data-testid="cash-movement-reason"
            label="Motivo"
            placeholder="Ej.: pago a proveedor, retiro parcial, cambio"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {movements.length > 0 && (
            <div className="border border-brand-100 rounded-lg divide-y divide-brand-50 text-sm" data-testid="cash-movement-list">
              {movements.map((m) => (
                <div key={m.id} className="flex items-center justify-between px-3 py-1.5" data-testid={`cash-movement-row-${m.id}`}>
                  <span className="flex items-center gap-2 min-w-0">
                    {m.kind === 'IN' ? <ArrowDownCircle size={14} className="text-emerald-600" /> : <ArrowUpCircle size={14} className="text-red-600" />}
                    <span className="truncate">{m.reason}</span>
                    <span className="text-xs text-slate-400">{new Date(m.createdAt).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}</span>
                  </span>
                  <span className={m.kind === 'IN' ? 'text-emerald-700' : 'text-red-700'}>{m.kind === 'IN' ? '+' : '-'}{money(m.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
