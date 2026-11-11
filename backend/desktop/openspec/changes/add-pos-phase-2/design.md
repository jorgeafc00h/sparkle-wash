# Design — POS Phase 2

Builds on `add-pos-tickets` (design §2 domain model, §5 cierre, §6 consolidation) and on the
2026-10-31 fixes (Z closes at the click instant, refunds of earlier Zs, `consolidationRevision`,
consolidation invariant `draft == Σ totalAmount − Σ roundingAdjustment`).

## 1. Registers

- `registerId` = the Device Sync device id (`src/services/sync/deviceId.ts`, created on first read,
  device-local). `registerName` (default "Caja 1") and a short `registerCode` ("C1") live in
  `PosSettings` (per company, per device).
- New tickets get `registerId` + `registerCode` at creation. Display number:
  `${registerCode}-${sequential padded 6}`; legacy tickets (no code) keep `#000123`.
- `sequential` stays per company per device DB (peer tickets keep the number their register gave
  them — the register code disambiguates).
- Reports filter by `registerId` (Z: this register only; X: selector "Esta caja / Todas").
  Legacy tickets without `registerId` belong to every register's X "Todas" and to the register of
  the device that holds them locally for Z (they were created there before this change).

## 2. Split payments

- `Ticket.payments[]` already an array. Payment dialog keeps a list; each row: method, amount,
  cash tendered (cash only), card evidence (card only). Balance = total − Σ amounts.
- Completion requires balance === 0 (within $0.005). Change = Σ cash tendered − Σ cash amounts,
  only from cash rows; a card row can never exceed the remaining balance.
- $0.05 rounding (`roundingMode`) applies only when the sale is settled with a single cash payment
  (the 2026-10-31 rule "cash only" extended: any non-cash row → no rounding).
- Closings already bucket per payment; a split ticket contributes to several buckets and counts
  once in `ticketCount`.

## 3. Suspended sales (F8) and shortcuts

- F8 / "Poner en espera" saves the cart as an OPEN ticket (`TicketDatabase.create({complete:false})`,
  `updateOpen` exists). No stock movement, no print. "Ventas en espera (N)" lists OPEN tickets of
  this register: Reanudar (loads into the cart, the OPEN ticket is completed in place on payment so
  its id/number survive) / Descartar (status VOID with reason "Venta en espera descartada", no
  stock effect because nothing was deducted).
- OPEN tickets are excluded from closings (already), consolidation (status filter) and Libros
  pending counts. A cart with lines cannot be replaced by a resumed one without suspending or
  clearing it first.
- F2 = cobrar (exists), F4 = quitar la línea seleccionada (last touched line when none selected),
  F8 = poner en espera. Shortcuts are ignored while a dialog is open.

## 4. Quantities and scale barcodes

- Weighable units (`KG, GR, LB, LT, MT, GAL, M2, M3, TON` — `isWeighableUnit()`) accept decimal
  quantities (3 decimals); others stay integers ≥ 1.
- Typed quantity: each cart line has an editable quantity field; typing `N*` in the search box and
  then scanning/choosing a product adds N units.
- Scale barcodes (`PosSettings.scaleBarcodes`): enabled flag, prefix (default "2"), PLU length
  (default 5), value kind `weight` (grams) or `price` (cents), value length (default 5), EAN-13
  check digit validated. PLU is matched against product `barcode` or `code` (exact, leading zeros
  ignored). Weight → quantity = grams/1000 (KG products; GR products use grams); price → quantity =
  price / unitPrice rounded to 3 decimals.
- Stock math already keeps 4 decimals (`roundStockQuantity`).

## 5. Quick-create on barcode miss

- On a miss (scanner burst or Enter with no exact match) users with `products` permission (or the
  admin) see "Crear producto" with the code prefilled as barcode, name, price (IVA incl.), tax
  category (default GRAVADO), unit, track inventory (default off). Save → `addProduct` (captured by
  sync + audit like any product) → line added to the cart. Others get the existing "Código no
  encontrado" toast.

## 6. Cash management

Stored in `tickets_db_{companyId}` (device-local, not synced):

```ts
CashSession  { id, companyId, registerId, openedAt, openedBy, openingFloat, closedAt?, closingId? }
CashMovement { id, companyId, registerId, sessionId, kind: 'IN' | 'OUT', amount, reason, createdAt, createdBy }
```

- "Abrir caja" (float ≥ 0). Selling without an open session is allowed but the register shows a
  banner "Caja sin abrir" with the action. The Z closes the open session (`closingId`).
- Cash in/out (`pos.cash` permission) during an open session; optional printed slip.
- Arqueo at the Z: expected cash = openingFloat + Σ cash payments of sales in range − Σ cash refunds
  (returns + prior-Z voids paid in cash) + Σ IN − Σ OUT. The operator types `countedCash` (optional
  but prompted); `difference = countedCash − expected` (negative = faltante). All stored in
  `CashClosing.cash = { openingFloat, cashSales, cashRefunds, cashIn, cashOut, expected, counted?,
  difference? }` and printed.

## 7. Z per register, per cashier, per product

- `ClosingTotals` gains `registerId`, `byCashier: Record<name, { count, amount }>`,
  `byProduct: Array<{ key, name, quantity, amount }>` (top 20 by amount + "otros"),
  `discountTotal`, `refunds: { count, amount, byMethod }` (partial returns), plus the cash block
  above. Z = this register; X can choose all registers.
- "Facturar este cierre" (2026-10-31) keeps working: the closing's sale ids are per register.

## 8. Partial returns

```ts
TicketReturn {
  id, createdAt, createdBy, reason,
  lines: Array<{ lineId, quantity, amount }>,   // amount = refunded value of those units (IVA incl., after line + apportioned ticket discount)
  refund: { method: PaymentMethod, amount },    // Σ lines.amount, rounded to cents
  registerId?
}
Ticket.returns?: TicketReturn[]
```

- Allowed on COMPLETED tickets that are not pending on a draft and not consolidated. Returned
  quantity per line ≤ sold − already returned. Unit refund value = (line net after line discount
  and the line's share of the ticket discount — same cent allocation as consolidation) / quantity.
- Effects: restock returned units (`restoreTicketStock`-style movement with
  `referenceId = returnId`, idempotent per return id); print "COMPROBANTE DE DEVOLUCIÓN" (non-fiscal);
  audit "Registró una devolución". A ticket fully returned is treated as final (archivable) but
  stays COMPLETED with all lines returned.
- Voiding a ticket with returns restores only the units not yet returned and refunds the remainder.
- Consolidation: lines use kept quantity/amount (sold − returned); a fully returned ticket is not
  offered; the invariant becomes `draft == Σ (totalAmount − Σ refunds) − Σ roundingAdjustment`.
  `checkConsolidatedInvoice` uses the same kept amounts.
- Z: refunds by `createdAt` in range, per method; cash refunds reduce expected cash.
- Sync: `returns` merged as a union by `id` (write-once entries) in `mergeTicket`; the stock side
  effect goes through the product stock ledger (§10), so it converges across registers like sales.
- Permission `pos.return`.

## 9. Ticket archive

- Hot DB keeps OPEN/COMPLETED tickets and everything from the current + previous month (by sale
  time). On load (and after a Z), final tickets older than that move to
  `tickets_archive_{companyId}_{YYYY-MM}` (one key per month, ~9 MB at 300 tickets/day).
- `getTickets` with a date range older than the hot window, `getTicketsByIds`,
  `getByInvoiceId`, closing reports and the consolidation wizard read the needed archive months
  (lazy, cached). `entityAdapters` (Device Sync) list hot + archived ids so digests stay equal to
  peers; `upsertFromSync` writes into the archive month when the ticket belongs there.
- An archived ticket that changes again (release, return) moves back to the hot DB.

## 10. Stock across registers — convergent counter (2026-11-01)

Product stock used to sync as an absolute value merged last-writer-wins: two registers selling the
same product concurrently lost one deduction. A separate `stockMovement` entity would need a relay
change (`Invoices.SyncApi`) and a migration; instead the counter rides inside the product payload
(`src/services/sync/stockLedger.ts`, byte-identical in App.ReactNative):

- `stockLedger = { base, baseAt, baseBy, devices: { [deviceId]: { in, out } } }`,
  stock = base + Σ in − Σ out (shown never below 0).
- Each device only grows its own `in`/`out`; `mergeLedgers` takes the max per device per direction
  and the newest base — commutative, associative, idempotent.
- Reducers write through the ledger (`setTrackedStock`); an edited level (product form, ajuste de
  inventario) is a local delta on the stored ledger, never an absolute overwrite.
- `mergeProduct` (mergeEngine): LWW for every other field; stock via `mergeProductStock`. A copy
  without a ledger (older app) or whose `stock` disagrees with its carried ledger is an absolute
  write: if strictly newer than the merged base it re-bases (`base = value − net of known counters`).
  No ledger on either side → plain LWW (merge-conformance fixture unchanged).
- A merge that keeps our counters is re-stamped by this device and re-sent; the live-pull task now
  flushes the outbox right after applying (it used to wait for the next local change).
- Ledgers are created lazily from the synced copy (`base` = level, `baseAt` = updatedAt, `init`), so
  two registers starting from the same copy share the base.

## 11. Tests (coded UI = acceptance)

Every scenario in `specs/pos-tickets/spec.md` has a Playwright test (web, stubbed printer bridge)
under `playwright/tests/pos/04-*.spec.ts`…, plus Jest for the pure modules (split balance, scale
barcode parser, returns math, archive partitioning, cash expected/difference, per-cashier totals,
merge of returns). Electron `08-pos-thermal-printing` gains the return slip bytes.
