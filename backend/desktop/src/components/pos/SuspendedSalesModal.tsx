// "Ventas en espera" (POS Phase 2 design §3): this register's OPEN tickets —
// sales parked with F8. Reanudar loads one into the cart (it is charged in
// place, keeping its id and number); Descartar voids it ("Venta en espera
// descartada") with no stock effect, since nothing was deducted.

import React, { useState } from 'react';
import { Play, Trash2 } from 'lucide-react';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import type { Ticket } from '@/types/ticket';
import { formatTicketNumber } from '@/services/tickets/ticketNumber';
import { formatQuantity } from '@/services/tickets/posQuantity';

interface SuspendedSalesModalProps {
  isOpen: boolean;
  tickets: Ticket[];
  onClose: () => void;
  onResume: (ticket: Ticket) => void;
  onDiscard: (ticket: Ticket) => void | Promise<void>;
}

const time = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString('es-SV', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
};

export function SuspendedSalesModal({ isOpen, tickets, onClose, onResume, onDiscard }: SuspendedSalesModalProps) {
  const [discarding, setDiscarding] = useState<Ticket | null>(null);

  return (
    <>
      <Modal isOpen={isOpen && !discarding} onClose={onClose} title={`Ventas en espera (${tickets.length})`} size="md">
        <div data-testid="suspended-sales" className="space-y-2">
          {tickets.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">No hay ventas en espera en esta caja.</p>
          ) : (
            tickets.map((t) => {
              const units = t.items.reduce((sum, l) => sum + l.quantity, 0);
              return (
                <div
                  key={t.id}
                  data-testid={`suspended-sale-${t.sequential}`}
                  className="flex items-center gap-3 rounded-lg border border-brand-200 p-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-brand-900">
                      {formatTicketNumber(t)} · ${t.totalAmount.toFixed(2)}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {time(t.updatedAt || t.createdAt)} · {t.items.length} producto(s), {formatQuantity(units)} unidad(es)
                      {t.customerName ? ` · ${t.customerName}` : ''}
                      {t.cashierName ? ` · ${t.cashierName}` : ''}
                    </p>
                    <p className="text-xs text-slate-400 truncate">
                      {t.items.map((l) => l.productName).join(', ')}
                    </p>
                  </div>
                  <Button size="sm" data-testid={`btn-resume-${t.sequential}`} onClick={() => onResume(t)}>
                    <Play size={14} /> Reanudar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    data-testid={`btn-discard-${t.sequential}`}
                    onClick={() => setDiscarding(t)}
                    title="Descartar la venta en espera"
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </Modal>
      <ConfirmDialog
        isOpen={!!discarding}
        onClose={() => setDiscarding(null)}
        onConfirm={async () => {
          const target = discarding;
          setDiscarding(null);
          if (target) await onDiscard(target);
        }}
        title="Descartar venta en espera"
        message={discarding ? `La venta ${formatTicketNumber(discarding)} por $${discarding.totalAmount.toFixed(2)} se descarta: no cuenta como venta y no mueve inventario.` : ''}
        confirmLabel="Descartar"
        variant="danger"
      />
    </>
  );
}
