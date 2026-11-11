// Reactive access to the ticket database for POS pages. Tickets live in
// appStorage (outside Redux), so pages re-read on change events.

import { useCallback, useEffect, useRef, useState } from 'react';
import { TicketDatabase } from '@/services/tickets/TicketDatabase';
import type { Ticket, TicketFilters } from '@/types/ticket';
import { PosSettingsStore, type PosSettings, DEFAULT_POS_SETTINGS } from '@/services/tickets/PosSettingsStore';

export function useTickets(filters: TicketFilters): {
  tickets: Ticket[];
  loading: boolean;
  refresh: () => void;
} {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const refresh = useCallback(() => {
    let cancelled = false;
    TicketDatabase.getTickets(filtersRef.current)
      .then((result) => {
        if (!cancelled) {
          setTickets(result);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const cancel = refresh();
    // UI listener fires on EVERY write — local sales AND Device-Sync relay
    // writes (which never reach the capture listeners), so peer sales show
    // up live without a remount.
    const unsubscribe = TicketDatabase.setUiListener(() => refresh());
    return () => {
      cancel();
      unsubscribe();
    };
  }, [filters.companyId, refresh, filters.from, filters.to, filters.status, filters.unconsolidatedOnly, filters.includeArchived]);

  return { tickets, loading, refresh };
}

export function usePosSettings(companyId: string | undefined): {
  settings: PosSettings;
  save: (settings: PosSettings) => Promise<void>;
} {
  const [settings, setSettings] = useState<PosSettings>(DEFAULT_POS_SETTINGS);

  useEffect(() => {
    let cancelled = false;
    if (!companyId) return;
    PosSettingsStore.get(companyId).then((s) => {
      if (!cancelled) setSettings(s);
    });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const save = useCallback(
    async (next: PosSettings) => {
      setSettings(next);
      if (companyId) await PosSettingsStore.save(companyId, next);
    },
    [companyId],
  );

  return { settings, save };
}
