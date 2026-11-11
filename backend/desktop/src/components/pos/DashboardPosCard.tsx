// Dashboard card "Ventas POS hoy" (POS Phase 2): today's counter sales and the
// month's tickets still waiting to be consolidated into a factura, with a
// shortcut to the consolidation wizard. Hidden until the POS has been used.

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Store } from 'lucide-react';
import { Card } from '@/components/common/Card';
import { usePermissionCheck } from '@/hooks/useLocalUsers';
import { TicketDatabase } from '@/services/tickets/TicketDatabase';
import { computePosDashboardStats, type PosDashboardStats } from '@/services/tickets/posDashboard';

export function DashboardPosCard({ companyId }: { companyId: string }) {
  const navigate = useNavigate();
  const { canOpen } = usePermissionCheck();
  const [stats, setStats] = useState<PosDashboardStats | null>(null);

  const refresh = useCallback(async () => {
    try {
      const count = await TicketDatabase.getCount(companyId);
      if (count === 0) {
        setStats(null);
        return;
      }
      const now = new Date();
      const bounds = computePosDashboardStats([], now); // window bounds only
      // getTickets filters on createdAt; a ticket parked last month and charged
      // today is still today's sale, so read a day earlier and let the stats decide.
      const from = new Date(new Date(bounds.monthStart).getTime() - 86_400_000).toISOString();
      const tickets = await TicketDatabase.getTickets({ companyId, from });
      setStats(computePosDashboardStats(tickets, now));
    } catch {
      setStats(null);
    }
  }, [companyId]);

  useEffect(() => {
    void refresh();
    // Local sales and peer (Device Sync) sales both refresh the card.
    return TicketDatabase.setUiListener(() => void refresh());
  }, [refresh]);

  if (!stats) return null;
  const canConsolidate = canOpen('/pos/consolidate');
  const canSell = canOpen('/pos');

  return (
    <Card data-testid="dashboard-pos-card" className="flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="flex items-center gap-4 flex-1 min-w-0">
        <div className="bg-teal-50 text-teal-600 p-3 rounded-lg shrink-0">
          <Store size={22} />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-brand-500">Ventas POS hoy</p>
          <p className="text-2xl font-bold text-brand-900" data-testid="dashboard-pos-today-amount">
            ${stats.todayAmount.toFixed(2)}
          </p>
          <p className="text-xs text-brand-500" data-testid="dashboard-pos-today-count">
            {stats.todayCount} {stats.todayCount === 1 ? 'ticket' : 'tickets'}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 sm:justify-end">
        <div className="text-right">
          <p className="text-xs text-brand-500">Sin facturar este mes</p>
          <p
            className={`text-sm font-semibold ${stats.unconsolidatedCount > 0 ? 'text-amber-700' : 'text-emerald-700'}`}
            data-testid="dashboard-pos-unconsolidated"
          >
            {stats.unconsolidatedCount > 0
              ? `${stats.unconsolidatedCount} ${stats.unconsolidatedCount === 1 ? 'ticket' : 'tickets'} · $${stats.unconsolidatedAmount.toFixed(2)}`
              : 'Todo consolidado'}
          </p>
        </div>
        {stats.unconsolidatedCount > 0 && canConsolidate ? (
          <button
            type="button"
            data-testid="dashboard-pos-consolidate"
            onClick={() => navigate('/pos/consolidate')}
            className="flex items-center gap-1 rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-700"
          >
            Consolidar <ChevronRight size={14} />
          </button>
        ) : canSell ? (
          <button
            type="button"
            data-testid="dashboard-pos-open"
            onClick={() => navigate('/pos')}
            className="flex items-center gap-1 rounded-lg border border-brand-200 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50"
          >
            Ir a la caja <ChevronRight size={14} />
          </button>
        ) : null}
      </div>
    </Card>
  );
}
