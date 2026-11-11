# Add POS Phase 2 — split payments, suspended sales, cash management, per-register Z, partial returns, ticket archive

## Why

The 2026-10-31 code review of the POS module (`add-pos-tickets`) found that the register works for
the simple case but a real counter in El Salvador needs more, and that several items of the first
change were ticked in `tasks.md` but never built:

- `tasks.md` 2.2/2.3 promised **F4/F8 shortcuts, quick-create on barcode miss and multi-payment
  split** — none exist (the payment dialog sends exactly one payment; F8 does nothing; an unknown
  barcode only shows a toast).
- The **cierre de caja** reports sales but cannot reconcile the drawer: there is no opening float,
  no cash taken in/out during the day, no "efectivo contado vs esperado". The page is titled
  "Arqueo" but counts nothing.
- Registers that share a company through Device Sync each see **all** company tickets, so every
  register's Z includes the other register's sales; ticket numbers repeat across registers.
- Only a full-ticket **void** exists: a customer returning one item of five forces voiding the sale
  and re-ringing four items.
- Every ticket lives in ONE appStorage key that is re-serialised on each write; the main process
  refuses values over 64 MB (≈64 000 tickets, ~7 months at 300 tickets/day) and every sale gets
  slower before that.
- Scales print **weight-embedded barcodes** (EAN-13, prefix 2) that the register cannot read, and
  quantities are ±1 only (no 1.25 kg).

## What Changes

- **Register** (`/pos`): split payments (any mix of cash / card / other until the balance is 0;
  change only from cash; $0.05 rounding only when the sale is settled entirely in cash), F4 removes
  the selected line, **F8 suspends** the sale as an OPEN ticket ("Ventas en espera": resume /
  discard; no stock moves until completed), quantity entry (typed, `3*` multiplier before a scan)
  with **decimal quantities for weighable units** (KG, GR, LB, LT, MT, GAL, M2, M3, TON), **scale
  barcodes** (configurable EAN-13 prefix, PLU + weight or price), **quick-create product** on a
  barcode miss (admin/products permission), dashboard card "Ventas POS hoy" + unconsolidated
  reminder.
- **Registers**: each device is a register (`registerId` = Device Sync device id, editable name
  "Caja 1"); new tickets, cash sessions and closings carry it; ticket numbers display with the
  register code (`C1-000123`).
- **Cash management**: open the register with a float ("Abrir caja"), record cash in/out with a
  reason ("Entradas y salidas de efectivo"), and at the Z enter the counted cash → expected,
  difference (faltante / sobrante) stored and printed.
- **Z per register** by default (option "todas las cajas" for X), with a **per-cashier** breakdown,
  a per-product summary and the discount total.
- **Partial returns** ("Devolución") on a completed, un-invoiced ticket: pick lines and quantities,
  refund method, reason; stock restored for the returned units; a printed return slip; refunds
  appear in the Z of the day they happen and reduce expected cash; consolidation invoices only what
  was kept. Returns on a ticket already in a sent invoice are refused (NC territory).
- **Ticket archive**: final tickets (CONSOLIDATED / VOID / fully returned) older than the current
  and previous month move to per-month archive keys; reads, reports, consolidation and Device Sync
  see them transparently.
- **Permissions**: new action permissions `pos.return` ("Devoluciones") and `pos.cash`
  ("Entradas/salidas de efectivo"); Cajero keeps neither by default.

## Impact

- Code: `src/pages/pos/*`, `src/components/pos/*`, `src/services/tickets/*`, `src/types/ticket.ts`,
  `src/services/printing/*`, `electron/thermalPrinterService.cjs` (return slip / Z layout only),
  `src/store/slices/productSlice.ts` (return restock), `src/services/sync/mergeEngine.ts`
  (`mergeTicket`: returns union), `src/services/localUsers/permissions.ts`, dashboard.
- Data: additive fields only (`registerId`, `registerCode`, `payments[]` already an array,
  `returns[]`, cash sessions/movements in `tickets_db_{companyId}`, archive keys
  `tickets_archive_{companyId}_{YYYY-MM}`). Old tickets load unchanged.
- Sync: `ticket` payload gains `returns`, `registerId`; cash sessions/movements are device-local
  (not synced) in this change.
- App.ReactNative must port `mergeTicket` (returns union + `consolidationRevision`) — tracked in its
  own PR.
- **Stock across registers:** product stock syncs as a per-device convergent counter inside the
  product payload (design §10) — no relay change; App.ReactNative ports the same module.
