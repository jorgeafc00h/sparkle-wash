# Tasks — POS Phase 2 (release 1.4.0)

Owners: **R** = register agent, **C** = cash/returns agent, **F** = fiscal agent (see
`add-dte-withholding-options`), **N** = App.ReactNative agent, **L** = lead.

## 0. Plan & specs
- [x] 0.1 L — proposal / design / spec delta (this change) + `add-dte-withholding-options`
- [x] 0.2 L — correct `add-pos-tickets/tasks.md` items ticked but never built (2.2 quick-create/F4/F8, 2.3 split)

## 1. Register (R)
- [x] 1.1 Split payments in `PaymentModal` (rows, balance, change from cash only, rounding single-cash only) + Jest balance math
- [x] 1.2 F4 remove selected line, F8 suspend → OPEN ticket, "Ventas en espera" resume/discard (completion in place keeps id/number)
- [x] 1.3 Quantity input per line + `N*` multiplier; decimals only for weighable units (`isWeighableUnit`)
- [x] 1.4 Scale barcodes (settings + parser with EAN-13 check digit) + Jest parser
- [x] 1.5 Quick-create product on barcode miss (permission-gated)
- [x] 1.6 Registers (code defaults to empty so a single register keeps `#000123`; set a code to get `C1-000123`): `registerId`/`registerCode`/`registerName` in PosSettings + stamped on new tickets; display `C1-000123`
- [x] 1.7 Ticket archive (monthly keys, transparent reads, sync adapters list archived, move-back on change) + Jest
- [x] 1.8 Dashboard POS card
- [x] 1.9 Playwright `pos/04-register-phase-2.spec.ts` covering every Register scenario

## 2. Cash, Z and returns (C)
- [x] 2.1 CashSession / CashMovement storage + "Abrir caja", cash in/out (`pos.cash`)
- [x] 2.2 Arqueo at the Z (expected / counted / difference) stored in `CashClosing.cash` + Z receipt
- [x] 2.3 Z per register (+ X "todas las cajas"), per cashier, per product, discount total
- [x] 2.4 Partial returns domain (`TicketReturn`, kept quantities, refund math with cent allocation), `pos.return`
- [x] 2.5 Return UI on the ticket list/detail, return slip print, audit, restock idempotent per return id
- [x] 2.6 Returns in closings (refunds by date, per method, cash expected) and in consolidation (kept units; invariant + `checkConsolidatedInvoice`)
- [x] 2.7 `mergeTicket` returns union by id + Jest (two-device convergence)
- [x] 2.8 Playwright `pos/05-cash-and-returns.spec.ts` covering every Cash/Z/Returns scenario; Electron 08 return slip bytes

## 3. Fiscal options (F) — see `add-dte-withholding-options/tasks.md`

## 4. App.ReactNative (N) — separate PR
- [x] 4.1 Port `mergeTicket` (consolidationRevision, lattice-before-staleness, returns union) + wholesale `upsertFromSync`
- [x] 4.2 Exclude internal-use compras (`internalUse` / tipoDte `UI`) from RN Libro de Compras, MH export and verification
- [x] 4.3 RN Jest green; open PR (not merged — RN ships on its own cadence) — jorgeafc00h/App.ReactNative#2 (also ports the 2026-10-31 POS consolidation fixes)

## 5. Cleanup & release (L)
- [x] 5.0 Follow-ups: discarded holds skipped by the Z, closing reads archives when its range needs them + archives after a Z, `formatTicketNumber` in invoice detail / consolidation / audit, product form barcode field (`products/04-product-barcode`), company delete also clears tickets + cash drawer, POS CCF drafts apply percepción, compra item ids unique per compra
- [x] 5.1 Remove the dead backend contingency queue (`useContingencyRequests` submission path)
- [x] 5.2 CLAUDE.md: AdFree = 2 companies (matches landing + code), Phase 2 state entry
- [x] 5.3 Docs screenshots refreshed for the new POS screens
- [x] 5.4 Full run: lint, Jest, web Playwright, Electron real MH, GreenMail, packaging verify — lint clean; Jest 991/991; web 463/10 skipped; Electron 31/2 skipped; GreenMail passed; packaged 1.4.0 OK
- [x] 5.5 Version 1.4.0, commit on a branch, PR, merge to main → CI publishes installers — PR #2 merged (79ce98b); Windows + macOS workflows succeeded
- [x] 5.6 Verify blobs + latest.yml hashes; remove 1.3.1 leftovers (storage + GitHub release assets) — `installer` holds only 1.4.0 (CI prune), latest.yml / latest-mac.yml sha512 == downloaded exe / mac zip, alias MD5 == versioned; 1.3.0/1.3.1 assets deleted from GitHub release `desktop-latest`

## 6. Stock across registers (L, 2026-11-01)
- [x] 6.1 `src/services/sync/stockLedger.ts` (PN-counter + absolute-write re-base) + `mergeProduct` in mergeEngine (no ledger on either side → LWW)
- [x] 6.2 productSlice writes through the ledger (`setTrackedStock`; edited levels are deltas on the stored ledger; monotonic `updatedAt`); device id warmed at store start-up
- [x] 6.3 syncV2Service live pull flushes re-stamped merges right away
- [x] 6.4 Jest `sync/stockLedger.test.ts` (convergence, CRDT laws, older peers, reducers) + Playwright `pro/16-stock-two-registers` (real relay: 100 − 2 − 3 = 95 on both)
- [x] 6.5 App.ReactNative port (PR #2, RN Jest 2044 passed) + release 1.4.1 (lint; Jest 1004/1004; web 464/10 skipped; Electron real MH 31/2 skipped; GreenMail; packaged 1.4.1 verified)

## Backlog (features, not bugs)
- Customer-facing display, receipt QR + logo bitmap, price-override permission
