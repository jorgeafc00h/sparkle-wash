// Ticket ↔ invoice lifecycle through the middleware (2026-10-31):
//  • a failed send (ErrorEnvio) keeps the tickets on the draft, and the retry
//    that reaches Completada links them (it used to release them, leaving the
//    sales "pending" forever and consolidable a second time);
//  • a second draft can't steal tickets another draft already reserved;
//  • a release bumps consolidationRevision so it reaches other devices.

jest.mock('@/services/storage/ElectronStorage', () => {
  const map = new Map<string, string>();
  return {
    appStorage: {
      getItem: jest.fn(async (key: string) => (map.has(key) ? map.get(key)! : null)),
      setItem: jest.fn(async (key: string, value: string) => {
        map.set(key, value);
      }),
      removeItem: jest.fn(async (key: string) => {
        map.delete(key);
      }),
      getAllKeys: jest.fn(async () => Array.from(map.keys())),
    },
    __map: map,
  };
});

import { TicketDatabase } from '@/services/tickets/TicketDatabase';
import { ticketConsolidationMiddleware } from '@/store/middleware/ticketConsolidationMiddleware';
import { InvoiceStatus, InvoiceType, type Invoice } from '@/types/invoice';

const COMPANY = 'co-life';

async function sell(amount: number) {
  return TicketDatabase.create({
    companyId: COMPANY,
    items: [{ id: 'l1', productName: 'Café', quantity: 1, unitPrice: amount, lineTotal: amount }],
    payments: [{ id: 'p1', method: 'EFECTIVO' as const, amount }],
    totalAmount: amount,
    taxIncluded: 0,
  });
}

function harness(invoices: Partial<Invoice>[]) {
  const state = { invoices: { invoices: invoices as Invoice[] } };
  const store = { getState: () => state, dispatch: jest.fn() };
  const next = jest.fn((action: unknown) => action);
  const run = (action: { type: string; payload?: unknown }) =>
    (ticketConsolidationMiddleware as unknown as (s: typeof store) => (n: typeof next) => (a: unknown) => unknown)(store)(next)(action);
  return { state, run };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storage: any = require('@/services/storage/ElectronStorage');
  storage.__map.clear();
  await TicketDatabase.deleteCompanyData(COMPANY);
});

describe('consolidation lifecycle via middleware', () => {
  it('ErrorEnvio keeps the reservation; the retry to Completada links the tickets', async () => {
    const a = await sell(5);
    const b = await sell(7);
    await TicketDatabase.markPendingConsolidation(COMPANY, [a.id, b.id], 'inv-1');
    const invoice: Partial<Invoice> = {
      id: 'inv-1', companyId: COMPANY, invoiceType: InvoiceType.Factura,
      status: InvoiceStatus.ErrorEnvio, sourceTicketIds: [a.id, b.id],
    };
    const { state, run } = harness([invoice]);

    run({ type: 'invoices/setInvoiceStatus', payload: { id: 'inv-1', status: InvoiceStatus.ErrorEnvio } });
    await flush();
    expect((await TicketDatabase.getByInvoiceId(COMPANY, 'inv-1')).map((t) => t.pendingInvoiceId)).toEqual(['inv-1', 'inv-1']);

    state.invoices.invoices = [{ ...invoice, status: InvoiceStatus.Completada, controlNumber: 'DTE-01-0001' } as Invoice];
    run({ type: 'invoices/updateInvoice', payload: { id: 'inv-1' } });
    await flush();
    const linked = await TicketDatabase.getTicketsByIds(COMPANY, [a.id, b.id]);
    expect(linked.every((t) => t.status === 'CONSOLIDATED' && t.invoiceId === 'inv-1')).toBe(true);
  });

  it('relinks by sourceTicketIds when the reservation was lost (older releases)', async () => {
    const a = await sell(5);
    await TicketDatabase.markPendingConsolidation(COMPANY, [a.id], 'inv-2');
    await TicketDatabase.releaseConsolidation(COMPANY, 'inv-2'); // what ErrorEnvio used to do
    const { run } = harness([{
      id: 'inv-2', companyId: COMPANY, invoiceType: InvoiceType.Factura,
      status: InvoiceStatus.Completada, sourceTicketIds: [a.id],
    }]);
    run({ type: 'invoices/setInvoiceStatus', payload: { id: 'inv-2', status: InvoiceStatus.Completada } });
    await flush();
    const [ticket] = await TicketDatabase.getTicketsByIds(COMPANY, [a.id]);
    expect(ticket.status).toBe('CONSOLIDATED');
    expect(ticket.invoiceId).toBe('inv-2');
  });

  it('never relinks a ticket another draft holds', async () => {
    const a = await sell(5);
    await TicketDatabase.markPendingConsolidation(COMPANY, [a.id], 'inv-other');
    await TicketDatabase.markConsolidated(COMPANY, 'inv-3', 'X', [a.id]);
    const [ticket] = await TicketDatabase.getTicketsByIds(COMPANY, [a.id]);
    expect(ticket.status).toBe('COMPLETED');
    expect(ticket.pendingInvoiceId).toBe('inv-other');
  });

  it('a second draft cannot steal reserved tickets', async () => {
    const a = await sell(5);
    const b = await sell(6);
    expect(await TicketDatabase.markPendingConsolidation(COMPANY, [a.id, b.id], 'inv-first')).toBe(2);
    expect(await TicketDatabase.markPendingConsolidation(COMPANY, [a.id, b.id], 'inv-second')).toBe(0);
    const tickets = await TicketDatabase.getTicketsByIds(COMPANY, [a.id, b.id]);
    expect(tickets.every((t) => t.pendingInvoiceId === 'inv-first')).toBe(true);
  });

  it('deleting the draft releases its tickets and bumps consolidationRevision', async () => {
    const a = await sell(5);
    await TicketDatabase.markPendingConsolidation(COMPANY, [a.id], 'inv-4');
    const { run } = harness([{ id: 'inv-4', companyId: COMPANY, invoiceType: InvoiceType.Factura, status: InvoiceStatus.Nueva }]);
    run({ type: 'invoices/deleteInvoice', payload: 'inv-4' });
    await flush();
    const [ticket] = await TicketDatabase.getTicketsByIds(COMPANY, [a.id]);
    expect(ticket.pendingInvoiceId).toBeUndefined();
    expect(ticket.consolidationRevision).toBe(1);
  });

  it('an invalidated invoice without credit note releases consolidated tickets', async () => {
    const a = await sell(5);
    await TicketDatabase.markPendingConsolidation(COMPANY, [a.id], 'inv-5');
    await TicketDatabase.markConsolidated(COMPANY, 'inv-5', 'X');
    const { run } = harness([{ id: 'inv-5', companyId: COMPANY, invoiceType: InvoiceType.Factura, status: InvoiceStatus.Anulada }]);
    run({ type: 'invoices/setInvoiceStatus', payload: { id: 'inv-5', status: InvoiceStatus.Anulada } });
    await flush();
    const [ticket] = await TicketDatabase.getTicketsByIds(COMPANY, [a.id]);
    expect(ticket.status).toBe('COMPLETED');
    expect(ticket.invoiceId).toBeUndefined();
  });
});
