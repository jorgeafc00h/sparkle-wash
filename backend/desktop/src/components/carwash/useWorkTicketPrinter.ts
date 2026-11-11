// Prints (and reprints) carwash work tickets with the current company, POS
// printer settings and carwash settings. A job that has no work-ticket number
// yet (camera-originated) gets one attached first.

import { useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '@/store';
import { selectCurrentCompany } from '@/store/selectors/companySelectors';
import { selectActiveLocalUser } from '@/store/selectors/localUsersSelectors';
import { usePosSettings } from '@/hooks/useTickets';
import { registerSettingsOf } from '@/services/tickets/PosSettingsStore';
import { printWorkTicket, type PrintWorkTicketResult } from '@/services/printing/WorkTicketPrinting';
import { nextWorkTicketNumber } from '@/services/carwash/workTicketNumber';
import { attachJobTicket, selectCarwashPackages, selectCarwashSettings } from '@/store/slices/carwashSlice';
import type { CarwashJob } from '@/services/carwash/types';

export function useWorkTicketPrinter() {
  const dispatch = useAppDispatch();
  const company = useAppSelector(selectCurrentCompany);
  const carwash = useAppSelector(selectCarwashSettings);
  const catalog = useAppSelector(selectCarwashPackages) as { vehicleClasses?: Array<{ id: string; name: string }> } | null | undefined;
  const cashier = useAppSelector(selectActiveLocalUser);
  const { settings } = usePosSettings(company?.id);

  /** Prints the job's work ticket; never throws. Attaches a ticket number when missing. */
  const print = useCallback(
    async (job: CarwashJob): Promise<PrintWorkTicketResult & { job: CarwashJob }> => {
      let current = job;
      try {
        if (!current.ticketNumber) {
          const registerCode = carwash.registerCode || registerSettingsOf(settings).code || 'C1';
          const ticketNumber = await nextWorkTicketNumber(registerCode);
          await dispatch(attachJobTicket({ jobId: current.id, ticketNumber })).unwrap();
          current = { ...current, ticketNumber };
        }
        const result = await printWorkTicket(current, settings, {
          company,
          registerCode: carwash.registerCode,
          cashierName: cashier?.displayName,
          footer: carwash.workTicketFooter,
          copies: carwash.workTicketCopies,
          vehicleClassName: catalog?.vehicleClasses?.find((c) => c.id === current.vehicleClass)?.name,
        });
        return { ...result, job: current };
      } catch (err) {
        return { ok: false, printed: 0, error: err instanceof Error ? err.message : String(err), job: current };
      }
    },
    [dispatch, company, carwash, catalog, cashier, settings],
  );

  return { print, settings, company };
}
