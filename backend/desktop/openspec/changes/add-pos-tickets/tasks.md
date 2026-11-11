# Tasks — add-pos-tickets

Phased so each phase ships value independently. Estimates assume one developer.

## 1. Domain & storage (≈2 d)
- [x] 1.1 `src/types/ticket.ts` — Ticket/TicketLine/TicketPayment/TicketStatus per design §2, incl. line/ticket discounts, `roundingAdjustment`, per-line `taxCategory` snapshot, `excludeFromLibrosIVA`
- [x] 1.2 `src/services/tickets/TicketDatabase.ts` — appStorage `tickets_db_{companyId}` (ComprasDatabase pattern): CRUD, sequential counter, status-transition guard, closings collection, change events, >2y soft-archive
- [x] 1.3 `productSlice.applyTicketStockDeduction` + `restoreTicketStock` reducers (OUT/IN movements, referenceId=ticket id)
- [x] 1.4 `PosSettings` (printer + oversell + roundingMode) in settings persistence
- [x] 1.5 Jest: database transitions/archive, stock deduction & restore; totals math — discounts, NEAREST_0.05 rounding, mixed gravado/exempt `taxIncluded` derivation vs fixtures

## 2. POS register UI (≈3 d)
- [x] 2.1 Routes `/pos`, `/pos/tickets` under RequireCompany; sidebar PUNTO DE VENTA section
- [x] 2.2 `PosRegisterPage` — product grid (top/category), search + barcode capture (barcode → productCode fallback), cart with qty steppers, F2 shortcut. **Correction 2026-10-31:** miss → quick-create modal and F4/F8 were ticked here but never built — delivered by `add-pos-phase-2` (1.2, 1.5)
- [x] 2.3 Payment modal — cash (tendered/change, optional NEAREST_0.05 rounding line) + card-POS fields (masked last4/auth/ref); line/ticket discount entry with visible receipt lines; `excludeFromLibrosIVA` toggle with tooltip. **Correction 2026-10-31:** multi-payment split was ticked but the dialog sent one payment — delivered by `add-pos-phase-2` (1.1)
- [x] 2.4 Completion flow: persist ticket → dispatch stock deduction → receipt preview (48/32-col monospace render of ReceiptPayload)
- [x] 2.5 `TicketListPage` + detail (payments, movements, reprint, void-with-reason while allowed)
- [x] 2.6 Playwright web: scan→cart→cash sale, card sale, void path, stock badge drop

## 3. Thermal printing (≈3 d)
- [x] 3.1 `npm i node-thermal-printer` (dependencies — pure JS only) and verify `npm run build && electron-builder` packaging stays green
- [x] 3.2 `src/services/printing/ReceiptDocument.ts` (ReceiptPayload model) shared by preview & main
- [x] 3.3 `electron/thermalPrinterService.cjs` — EscposBuilder (epson, 48/32 cols, layout per design §3.3, disclaimer, partial cut) + transports: network TCP 9100 (timeout+retry) and spooler raw (PowerShell RawPrinterHelper / `lp -o raw`, temp file 0600 + cleanup)
- [x] 3.4 IPC: `printer:list` (Get-Printer / lpstat), `printer:print`, `printer:status`; preload bridge additions; hardening per design §3 — printer-name regex, payload size/string caps, `-EncodedCommand`, 0600 temp files
- [x] 3.5 Settings → "Punto de venta / Impresora" panel: transport picker, detect, host/port or printer name, paper width, header/footer editor, test print, TM-T20II preset note
- [x] 3.6 Reprint from ticket detail (`printedCount`); print-failure toast that never blocks the sale
- [x] 3.7 Jest golden-buffer tests; Playwright electron spec with virtual TCP printer asserting bytes (init + company + disclaimer + cut)

## 4. Cierre de caja X/Z (≈1.5 d)
- [x] 4.1 Aggregation service (per method incl. tendered/change split, IVA-included breakdown, counts) — Jest-tested
- [x] 4.2 `/pos/closing` — X (range read) & Z (close-since-last-Z, persists CashClosing with ticketIds)
- [x] 4.3 Thermal Z-report layout via the same builder; CSV export of the cierre

## 5. Consolidation wizard + Libros IVA (≈4 d)
- [x] 5.1 Selection step — filters (date/status/method/by-Z), multi-select, running totals
- [x] 5.2 Aggregation — per-product grouping, weighted-price flagging, gravado/exempt buckets, IVA decomposition for CCF, fixtures vs `computeTotals`
- [x] 5.3 Draft invoice generation via `buildInvoice`; fiscal + date-semantics advisory (one-time dismiss)
- [x] 5.4 Link on Completada (`markTicketsConsolidated`), revert on ErrorEnvio/invalidation
- [x] 5.5 `InvoiceDetailPage` "Tickets incluidos" panel (archive read-through)
- [x] 5.6 `canUsePosConsolidation` in FeatureGate + locked UI/modal; Playwright regression (mirror subscription-gates.spec.ts)
- [x] 5.7 Playwright: consolidate N tickets → mocked MH accept → CONSOLIDATED; reject → released
- [x] 5.8 Libros IVA integration (design §6.5): `Invoice.excludeFromLibrosIVA` field + propagation; mixed-selection forced split; `LibrosIVAPage` filter + visible excluded counter chip; invoice-list badge; pending-consolidation warning banner → wizard link; Playwright specs for all three scenarios

## 6. Device Sync v2 ticket entity (≈1.5 d) — DONE 2026-09-26
- [x] 6.1 `'ticket'` in protocol/entityAdapters/capture (TicketDatabase listener); merge rules (LWW, lattice, invoiceId write-once, revert event) — mergeEngine.ts diverges from the RN copy by `mergeTicket` (ported to RN in its own change); relay acceptance added in Invoices.SyncApi SyncValidator/SyncHub DigestTypes
- [x] 6.2 Sync session spec: ticket appears on second device — Jest `src/__tests__/sync/ticketSync.test.ts` (13) + Playwright `pro/13-pos-ticket-sync.spec.ts` (real relay round-trip both directions)

## 7. Docs & release (≈1 d)
- [x] 7.1 `docs-screenshots/22-pos_*` capture spec + run
- [x] 7.2 CLAUDE.md "Current Project State" + architecture tree entries
- [ ] 7.3 Full test pass: `npm test`, `npm run test:e2e`, `npm run test:e2e:electron`; bump version; commit/push to trigger installer workflows; verify blobs

## Open items requiring user decision (design §11)
- Tier table confirmation (consolidation Pro-gated?)
- Contador sign-off on FCF consolidation cadence **and Libros-IVA exclusion criteria**
- Z-report per-company vs per-cashier
- Receipt QR content (Phase 2+)
- Discount policy in v1 (line-only first?) and cash-rounding default (NONE vs NEAREST_0.05)

## Phase 2+ backlog (design, after §10)
Devolución parcial (line-level returns + restock + refund slip), weight-embedded barcodes
(scales/KG), dashboard "Ventas POS hoy" + unconsolidated reminder, receipt QR + NV logo,
per-cashier Z reports, customer-facing display, price-override permissions.
