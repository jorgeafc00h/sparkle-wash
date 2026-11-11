# Add POS Tickets — thermal receipt printing, stock discharge & ticket→DTE consolidation

## Why

The app handles MH-compliant DTE invoicing, but a shop's day-to-day counter sales are small,
instant, walk-in operations where opening the full DTE wizard per sale is impractical. Retail users
need a **punto de venta (POS)** flow: pick products (or scan a barcode), take payment (cash or an
external credit-card POS terminal), get a thermal receipt in seconds. The ticket's purpose is
**stock discharge + payment record**, not taxation — and at the end of a period the merchant
consolidates many tickets into **one** regular DTE factura (all or a selection) through the existing
submission pipeline.

The building blocks already exist in this repo but are not connected to any counter-sale flow:

- A complete Products/Inventory module (`src/types/product.ts`, `productSlice.applyInvoiceStockDeduction`,
  `StockMovement` ledger, `Product.barcode` — dormant field, no scanner UI).
- The full DTE pipeline (Factura with receptor "Consumidor Final", `buildInvoice`, sign & send).
- An `appStorage` database pattern for high-volume, non-Redux collections (`ComprasDatabase`).
- A main-process IPC + file-storage bridge ready to host a printer service.

No POS/ticket/thermal code exists in either the Desktop app or the iOS app (verified 2026-09-26);
this is net-new.

## What Changes

- **POS register** (`/pos`): product grid + search + barcode-scanner input, cart, keyboard-first
  checkout, payments captured as cash or card-on-external-POS-terminal (auth code / last 4 /
  card type typed by the cashier — never full PAN).
- **Tickets** as a first-class local entity (`TicketDatabase`, appStorage per company — the
  Compras pattern), company-scoped, status `OPEN → COMPLETED → (VOID | CONSOLIDATED)`.
- **Stock discharge on ticket completion**: `StockMovement OUT` per catalog line with
  `referenceId = ticketId` (mirrors the existing invoice deduction); void restores stock.
- **Thermal printing** via a new main-process `ThermalPrinterService` + IPC (`printer:*`):
  generic ESC/POS over **network TCP 9100** or the **OS spooler** (raw). First-class profile for
  the target printer **Epson TM-T20II** (80 mm, 48 cols, ESC/POS native). Pure-JS only
  (`node-thermal-printer`) — no native modules, preserving the installer rules in CLAUDE.md.
- **Receipts are explicitly non-fiscal**: printed tickets carry a
  *"Documento no fiscal — no es factura/DTE"* disclaimer; the DTE is issued at consolidation.
- **Cierre de caja (X/Z report)**: end-of-day per-payment-method, per-tax summary, printable on
  the thermal printer; persists a closing snapshot referencing its ticket ids.
- **Consolidation wizard** (`/pos/consolidate`): select tickets (all/some/date range/unconsolidated),
  preview aggregated lines per product, generate a **draft Factura (Consumidor Final)** through the
  existing invoice pipeline; on `Completada` the tickets become `CONSOLIDATED` and are linked to
  the invoice (`invoiceId`); on MH error/invalidation they are released back to `COMPLETED`.
  Invoice detail gains a "Tickets incluidos" panel.
- **Libros IVA interplay**: tickets carry an `excludeFromLibrosIVA` flag for sales the accountant
  wants out of the books; consolidation propagates it to the generated invoice, mixed selections
  split into two drafts, the Libros IVA page excludes them **with a visible counter** (never
  silently) and warns when the period still has unconsolidated ticket sales.
- **Device Sync v2**: new `'ticket'` entity in the v2 protocol/capture/adapters/merge engine
  (same Pro+Sync gating as everything else).
- **Settings**: "Impresora de tickets" panel (transport, network host/port or spooler printer
  name, paper 58/80 mm, header/footer lines, copies, cut) with a **test-print** button and
  platform printer enumeration (no native deps: `Get-Printer` on Windows, `lpstat` on macOS).

## Capabilities

### New Capabilities
- `pos-tickets`: counter-sale register, ticket persistence, stock discharge/restore, thermal
  ESC/POS printing (network + spooler transports), receipt layout engine, cierre de caja X/Z,
  ticket→DTE consolidation with link/revert semantics, printer settings & test print.

### Modified Capabilities
- `device-sync` (delta in this repo's `add-device-sync-v2` baseline): adds the `ticket` entity
  type to the outbox capture allowlist, entity adapters and LWW merge rules.

## Impact

- **New code**: `src/types/ticket.ts`, `src/services/tickets/TicketDatabase.ts` (+ aggregation &
  consolidation helpers), `src/services/printing/ReceiptDocument.ts` (pure model),
  `src/services/printing/EscposLayout.ts` (renderer-side preview + payload builder),
  `electron/thermalPrinterService.cjs` + `printer:*` IPC handlers in `main.cjs`,
  `src/pages/pos/{PosRegisterPage,TicketListPage,ClosingPage,ConsolidatePage}.tsx`,
  printer Settings panel, sidebar "PUNTO DE VENTA" section.
- **Changed code**: `productSlice` (+`applyTicketStockDeduction`), `routes.tsx`, `Sidebar.tsx`,
  `preload.cjs` (+`printer:*`), `capture.ts`/`entityAdapters.ts`/`protocol.ts`/`mergeEngine.ts`
  (+`ticket`), `InvoiceDetailPage` (+tickets panel), `package.json` (+`node-thermal-printer`).
- **Dependencies**: `node-thermal-printer` only (pure JS). **No native modules** (`usb`,
  `node-printer`) — they would reintroduce the packaging/asar breakage documented in CLAUDE.md.
- **Tests**: Jest suites (layout golden buffers, aggregation/IVA math, database, stock reducer,
  consolidation state machine incl. revert) + Playwright POS specs incl. a virtual TCP printer
  that captures raw ESC/POS bytes.
- **Out of scope**: cash-drawer hardware (kick command exists behind a setting but TM-T20II has
  no DK port), native USB transport, fiscal-printer certification models, iOS/Android POS,
  server-side ticket storage beyond Device Sync v2 relay, customer-facing display.
