# Design — POS Tickets (thermal printing, stock discharge, ticket→DTE consolidation)

Status: proposal for review · Research date: 2026-09-26

---

## 1. Research summary

### 1.1 Target hardware: Epson TM-T20II (model M267D)

Identified from the user's photo. Key facts (Epson datasheets / installer guide):

| Aspect | Value |
|---|---|
| Print method | Direct thermal, monochrome, 203 dpi |
| Speed | 200 mm/s |
| Paper | 80 mm roll (58 mm supported), ~72 mm printable on 80 |
| Columns | 48 (font A 12×24) or 64 (condensed) on 80 mm; 32 on 58 mm |
| Command set | **ESC/POS native** (Epson's own POS command system) |
| Interface (M267D variant) | USB (USB Printer Class on Windows); sibling variants ship +Serial / +Ethernet |
| Drivers | Epson Advanced Printer Driver (APD) for Windows; CUPS supports it on macOS |

Implications:

- ESC/POS is the de-facto standard across Epson/Star/Bixolon/Xprinter — building for ESC/POS
  makes the integration **generic** ("cualquier impresora de tickets ESC/POS") with the TM-T20II
  as the tuned profile (80 mm / 48 cols / partial cut).
- The M267D is **USB-only**. Direct USB from Electron requires native `usb`/libusb modules and a
  Windows driver swap (Zadig/WinUSB) that breaks the vendor driver — bad for non-technical users
  and violates the "no native modules" packaging rule. The two production-safe transports are
  **OS spooler raw** (USB printer installed once with the Epson driver) and **network TCP 9100**
  (if the Ethernet variant/module is present or the printer is shared from a print server).
- 58 mm support is included because "generic printer" was requested; layout switches to 32 cols.

### 1.2 How Electron apps print ESC/POS receipts (ecosystem survey)

The dominant library is `node-thermal-printer` (Klemen1337, pure JS, MIT): builds ESC/POS buffers
(text alignment/formatting, 1D/2D barcodes, QR, cut, drawer kick) and sends them over several
interfaces — `network` (raw TCP 9100), `printer` (OS spooler), `usb` (native, avoid),
`bluetooth`, `file`. Common findings from issues/practice:

1. **Network TCP 9100 is the most reliable cross-platform path** — no drivers, no natives; just
   `net.Socket`. Standard for Ethernet POS printers.
2. **Windows spooler raw** for USB printers: the printer is installed normally (Epson APD), and
   raw bytes are submitted as a `RAW` datatype job to the named printer. Implementable without
   native modules via a small PowerShell `RawPrinterHelper` (Add-Type Win32Spooler) invocation.
3. **macOS**: `lp -d <queue> -o raw <file>` (child_process) after adding the printer in CUPS —
   equally driver-free from our side.
4. WebPOS/Epson ePOS-Device JS SDK exists but is network/Bluetooth-oriented and commercial-ish;
   not needed since we own the Node main process.

Decision: **`node-thermal-printer` (pure JS) as the buffer builder, our own transport layer**
(network = lib's TCP; spooler = PS/lp raw) so no native dependency ever enters `package.json →
dependencies`. This respects the installer/packaging lessons in CLAUDE.md (the v1.1.0 fix:
only pure-JS runtime deps ship in asar).

### 1.3 How established POS systems model this (Square, Loyverse, Dynamics, QuickBooks practice)

- **Receipt/ticket per transaction, not an invoice**: the printed receipt is an internal/
  customer record; fiscal/accounting documents are derived later. Loyverse and Square both deduct
  inventory at sale time per line item (Boooksy/Square retail: "inventory subtracts when you
  sell"), not at invoicing time.
- **X/Z reports**: X-report = mid-day read (no reset); **Z-report = end-of-day close** that
  totals every receipt since the last Z, breaks sales down by category/payment method, and
  resets counters (Salesforce/Dynamics/till terminology). The Z snapshot is the natural input for
  accounting consolidation.
- **Consolidation pattern**: "many receipts → one summary document" is the standard bridge from
  POS to accounting (QuickBooks "multiple sales orders → one invoice"; ERP daily-sales-journal
  imports). Our equivalent: many tickets → one Factura DTE at day/week/month end, selectable.

### 1.4 Fiscal framing (El Salvador / MH DTE)

- MH's DTE catalog has **no "ticket" document type**. Retail walk-in sales are documented with
  **Factura (consumidor final)** — DTE type `01` with receptor "Consumidor Final", **prices with
  IVA included**, receptor identified by name + (optionally) DUI/pasaporte. (References: EDICOM,
  Facxi and Algoritmos DTE guides.)
- Therefore: our thermal ticket is an **internal + customer receipt, explicitly non-fiscal**,
  printing a visible disclaimer *"Documento no fiscal — no es factura ni DTE"*. Tax compliance
  happens through DTEs emitted by the existing pipeline, either per-sale (future option) or via
  the new **consolidation** flow.
- **Monthly/periodic consolidation of consumidor-final sales into a single FCF** is a management
  practice some salvadorean accountants accept for small retail, but public sources do not show
  an explicit general MH allowance (the DCL — Documento Contable de Liquidación, type `09` — is
  an authorized consolidation regime for specific sectors such as cooperatives/hydrocarbons).
  **Action item (user/contador)**: validate the consolidation cadence for their régimen. The
  design keeps the engine DTE-type-agnostic (Factura by default; CCF or others selectable) and
  shows a one-time advisory in the wizard. The strict-compliance per-ticket-FCF emission path is
  deliberately left as a Phase-3+ option (same consolidation plumbing, batch size 1).

---

## 2. Domain model

New file `src/types/ticket.ts`. Tickets live **outside Redux** in a per-company appStorage
database (`tickets_db_{companyId}`) via `src/services/tickets/TicketDatabase.ts`, copying the
proven `ComprasDatabase` pattern (in-memory map + debounced JSON flush + change listeners). Why
not a slice: retail volume (100–500 tickets/day) would bloat `app-storage.json` whitelists and
rehydrate costs; Compras already validated the pattern and Device-Sync v2 already knows how to
capture from change listeners. Cap: soft-archive tickets older than 2 years into
`tickets_archive_{companyId}` (count guard, like the 5000-entry stock-movement cap).

```ts
export type TicketStatus = 'OPEN' | 'COMPLETED' | 'VOID' | 'CONSOLIDATED';
export type PaymentMethod = 'EFECTIVO' | 'TARJETA_POS' | 'OTRO';

export interface TicketPayment {
  id: string;
  method: PaymentMethod;
  amount: number;              // applied to total
  // Cash:
  tendered?: number;           // efectivo recibido
  change?: number;             // vuelto
  // External credit-card POS terminal (typed by cashier):
  posAuthCode?: string;        // código de aprobación del datáfono
  posLast4?: string;           // last 4 digits only — NEVER full PAN/CVV (PCI)
  posCardType?: 'VISA' | 'MASTERCARD' | 'AMEX' | 'OTRO';
  posReference?: string;       // referencia/batch del datáfono
  note?: string;
}

export interface TicketLine {
  id: string;
  productId?: string;          // catalog link (undefined = free-text quick item)
  productCode?: string;
  productName: string;
  quantity: number;
  unitPrice: number;           // IVA INCLUIDO (retail price shown on shelf/receipt)
  lineTotal: number;           // quantity * unitPrice − lineDiscount, 2-dec rounded
  discount?: number;           // line-level discount amount (IVA-incl.), reason in obs
  taxCategory?: ProductTaxCategory; // snapshot from product at sale time
  obs?: string;
}

export interface Ticket {
  id: string;                  // `tkt_${nanoid(10)}`
  companyId: string;
  sequential: number;          // per-company increasing counter (daily resettable)
  status: TicketStatus;
  items: TicketLine[];
  payments: TicketPayment[];
  discountTotal?: number;      // ticket-level discount (IVA-incl.), applied after lines
  roundingAdjustment?: number; // explicit "Redondeo" line (see money rules), ±
  totalAmount: number;         // sum(lineTotal) − discountTotal + roundingAdjustment
  taxIncluded: number;         // derived from GRAVADO lines only — see money rules
  /** Sale the accountant does NOT want reflected in Libros IVA when the ticket
   *  is consolidated (internal consumption, personal use, etc.). Propagates to
   *  the generated invoice's Invoice.excludeFromLibrosIVA (§6.5). Default false. */
  excludeFromLibrosIVA?: boolean;
  customerName?: string;       // optional walk-in name
  cashierName?: string;
  createdAt: string; completedAt?: string; voidedAt?: string; voidReason?: string;
  invoiceId?: string;          // set on CONSOLIDATED (the DTE that consumed this ticket)
  invoiceControlNumber?: string; // display convenience (numeroControl of that DTE)
  consolidatedAt?: string;
  printedCount: number;
  // Device-Sync v2 fields (added in the sync phase):
  updatedAt: string; deviceId?: string; deletedAt?: string;
}
```

Status lattice (enforced in `TicketDatabase` transitions, mirrored in merge rules):

```
OPEN ──complete──▶ COMPLETED ──consolidate──▶ CONSOLIDATED
 │                     │
 └──cancel──▶ VOID ◀──void(+reason, restocks)──┘
VOID / CONSOLIDATED are terminal. CONSOLIDATED is only exited by the
consolidation-revert path (invoice failed/invalidated) back to COMPLETED.
```

Money rules: `unitPrice` is IVA-inclusive (what the customer pays). Discounts (line and
ticket-level) are recorded explicitly, never silently folded into `unitPrice`, so the receipt
prints a visible "Descuento" line and audits reconcile. **Cash rounding**: US-coin scarcity in El
Salvador makes exact change impractical below $0.05 — a setting (`roundingMode: 'NONE' |
'NEAREST_0.05'`, default NONE) adds an explicit `roundingAdjustment` line on cash payments so the
Z-report cash-count reconciles to the cent. `taxIncluded` is derived **only from GRAVADO lines**
(`Σ gravado − Σ gravado/1.13`); lines snapshotting `taxCategory` EXENTO/NO_GRAVADO/EXPORTACION
contribute to totals but not to the IVA line, and consolidation keeps gravado/exempt grouped
separately (§6.2). Consolidation into a **Factura** reuses inclusive prices; into a **CCF** the
wizard decomposes (`unitPriceExcl = round(unitPrice / 1.13, 4)` and lets `computeTotals` in
`invoiceSlice` do the canonical math) — covered by unit tests with fixtures that assert
cent-rounding against the existing invoice engine.

Tickets are not invoices: they never count toward the Free-tier monthly invoice cap
(`getMaxInvoicesPerMonth`), and consolidated DTEs do — harmless because consolidation is
Pro-gated (Infinity) by §7.

### 2.1 Stock integration

On ticket completion, for every line with a `productId` whose product has `trackInventory`:

- dispatch `applyTicketStockDeduction` (new reducer in `productSlice`, modeled on
  `applyInvoiceStockDeduction`): clamps at ≥ 0, appends `StockMovement { type: 'OUT', quantity,
  reason: 'Venta POS', referenceId: ticket.id, createdBy: cashierName }`.
- Oversell policy setting (`posSettings.oversell: 'BLOCK' | 'ALLOW'`): BLOCK warns and refuses to
  complete the ticket while stock (available − in-carts) is insufficient; ALLOW records negative
  drift for later adjustment (matches current invoice behavior which clamps at 0 + records the
  requested quantity in the movement).

Void restores stock with a mirrored `IN` movement (`reason: 'Anulación ticket'`) — allowed only
while status is `COMPLETED` (never after consolidation).

### 2.2 Barcode / scanner

Keyboard-wedge scanners (the overwhelming majority) type the code and press Enter — so the POS
register keeps a focused search input; on Enter, match `Product.barcode` (exact) then
`productCode` (SKU), adding a hit to the cart and flashing a miss with a "crear producto rápido"
modal that pre-fills price/name. This finally activates the dormant `Product.barcode` field.
(Camera/USB-HID and Bluetooth scanners behave identically; no native integration needed.)

---

## 3. Printing architecture

### 3.1 Process split (testability + security)

```
Renderer (React)                      Main (Node)                          Hardware
────────────────                      ───────────                          ────────
PosRegisterPage ──▶ ReceiptPayload ──▶ ipc printer:print(cfg,payload)
ReceiptPreview                       ThermalPrinterService
(on-screen 48/32-col                  ├─ EscposBuilder (node-thermal-printer,
 monospace render of the              │    type 'epson', width 48|32)
 same payload)                        ├─ TransportA: network  ─ net TCP 9100 ──▶ printer
                                      └─ TransportB: spooler  ─ temp file +
                                           Win: RawPrinterHelper (PowerShell)
                                           mac/linux: lp -d <q> -o raw        ──▶ printer
```

- `ReceiptPayload` (`src/services/printing/ReceiptDocument.ts`) is **pure JSON** (company header,
  kind `TICKET|TEST|Z_REPORT`, lines, payments, totals, footer). The renderer also renders the
  same payload into an on-screen monospace preview so "what you see is what prints".
- The ESC/POS byte-building and transports live **only in main** (`electron/thermalPrinterService.cjs`),
  exposed through three new preload channels:
  - `printer:list()` → spooler names (`Get-Printer` on win, `lpstat -a` elsewhere)
  - `printer:print(config, payload)` → `{ ok, transport, error?, bytes? }`
  - `printer:status(config)` → network: TCP connect + `DLE ENQ` status nibble; spooler: queue exists
- `main.cjs` stays the single entry: register handlers from the service module (extracting it is
  optional cleanup; it can also be `require`'d from `main.cjs` like the IMAP handler today).
- **IPC hardening** (gap fix — the spooler transport spawns child processes): printer/queue
  names are validated against `^[A-Za-z0-9 _ . \- ()]{1,120}$` before reaching PowerShell/lp;
  payload size capped (e.g. 500 lines / 64 KB), strings length-capped and stripped of control
  chars; temp files `0600` in userData, deleted after spool; PowerShell invoked with
  `-EncodedCommand` (no string interpolation into a shell).

### 3.2 Printer config (per company, persisted)

`src/store/slices/settingsSlice` (or appStorage key `pos_settings_{companyId}` — final placement
in tasks, preference: settingsSlice so it rides existing persistence):

```ts
interface PosSettings {
  printer: {
    transport: 'network' | 'spooler';
    network: { host: string; port: number; timeoutMs: number };   // default 9100/4000
    spooler: { printerName: string };
    paper: { widthMm: 80 | 58; copies: number; cut: boolean };
    headerLines: string[];   // e.g. "¡Gracias por su compra!"
    footerLines: string[];
    logoEnabled: boolean;    // Phase 2+: NV-logo bitmap; text header first
    cashDrawerKick: boolean; // off by default — TM-T20II has no DK port
  } | null;                  // null = printing disabled (ticket saved, no paper)
  oversell: 'BLOCK' | 'ALLOW';
}
```

Setup UX: Settings → **"Punto de venta / Impresora"**: transport picker with plain-language
explanations, "Detectar impresoras" (`printer:list`), host field for network, **"Imprimir página
de prueba"** button with success/failure toast, paper width toggle, live receipt preview.

### 3.3 Receipt layout (80 mm, 48 cols — the TM-T20II profile)

```
        EMPRESA S.A. DE C.V.          ← company name (double height)
        NIT 1234-567890-103-5
        Av. ... Sucursal ...
────────────────────────────────
Ticket #000123      26/09/26 14:32
Cajero: María        Cliente: —
────────────────────────────────
Café grande           2  $3.00   $6.00
Pan con pollo         1  $2.50   $2.50
  (obs: sin cebolla)
────────────────────────────────
Subtotal (IVA incl.)           $8.50
  IVA incluido 13%              $0.98
TOTAL                          $8.50
EFECTIVO                       $10.00
VUELTO                          $1.50
────────────────────────────────
Documento no fiscal —
no es factura ni DTE.
Factura disponible a solicitud.
        **** GRACIAS ****
[partial cut]
```

Rules: name wraps to a second line before truncation; quantities right-aligned; totals section
per payment; QR (ticket id + timestamp, via existing `qrcode` dep → ESC/POS GS1 QR) Phase 2+;
CODE39 barcode of `#000123` optional. Z-report layout reuses the same builder with a
methods/taxes matrix.

### 3.4 Failure handling

- Print failure **never fails the sale**: ticket is already persisted; the UI offers
  "Reintentar impresión" (Ticket detail → Reimprimir, increments `printedCount`).
- Network transport: connect timeout 4 s, single retry, clear toast with transport hints.
- Spooler transport: PS/lp exit codes surfaced verbatim in the toast.

---

## 4. UI & routes

Sidebar gains a **PUNTO DE VENTA** section (`requiresCompany`), between Productos and Compras:

| Route | Page | Notes |
|---|---|---|
| `/pos` | `PosRegisterPage` | Grid of top products + category filter + scan/search bar; cart on the right; F2=charge, F4=void line, F8=suspend (keeps OPEN ticket). |
| `/pos/tickets` | `TicketListPage` | Date/status/method filters; row → detail (payments, movements, reprint, void while allowed). |
| `/pos/closing` | `ClosingPage` | X (read) / Z (close) — see §5. |
| `/pos/consolidate` | `ConsolidatePage` | Wizard — see §6 (tier-gated, §7). |

All inside the `RequireCompany` block in `routes.tsx`. Existing pages untouched except
`InvoiceDetailPage` (+ "Tickets incluidos" panel, §6.4).

---

## 5. Cierre de caja (X/Z reports)

- **X-report**: on-screen + printable snapshot of today (or arbitrary range): ticket count,
  voided count + reasons, gross total, IVA-included breakdown, totals **per payment method**
  (EFECTIVO sums `tendered`/`change` separately for cash-count reconciliation; TARJETA_POS sums
  `amount` and lists auth codes for datáfono settlement matching).
- **Z-report (close)**: same numbers **since the last Z** (the classic reset semantics), stores
  `CashClosing { id, companyId, closedAt, from, to, ticketIds[], totals }` in
  `tickets_db_{companyId}.closings`. Consolidation wizard offers "seleccionar por cierre" as a
  picker (month-end = "all of September's Zs or just these tickets").

---

## 6. Consolidation: many tickets → one DTE

### 6.1 Wizard flow (`/pos/consolidate`)

1. **Selection**: filters (date range, status=COMPLETED & `invoiceId` empty, by Z-closing, by
   payment method); multi-select with "select all filtered"; shows running totals.
2. **Review**: lines **aggregated by product** (`productId` or fallback `productName+unitPrice`),
   quantities summed, unit price = common price or weighted average (flagged when mixed with a
   tooltip); totals preview (Factura: inclusive; CCF: decomposed) using the same math as
   `computeTotals`, gravado and exempt lines kept in separate buckets; receptor step (Consumidor
   Final by default, or pick a Customer for CCF); one-time fiscal advisory (§1.4) with "no
   mostrar de nuevo". **Libros split (§6.5)**: if the selection mixes normal and
   `excludeFromLibrosIVA` tickets, the wizard forces two drafts (one per flag) so books stay
   clean. **Date semantics advisory**: the DTE carries `fechaGeneracion` = emission moment —
   DTEs cannot be backdated — with the ticket period summarized in the invoice observation.
3. **Generate**: builds a **draft Invoice** via existing `buildInvoice` (`status=Nueva`), items =
   aggregated lines, then the user goes through the normal sign & send pipeline.
4. **Link**: when that invoice reaches `Completada`, `markTicketsConsolidated(ids, invoice)` sets
   each ticket's `invoiceId`/`invoiceControlNumber`/`consolidatedAt` and status `CONSOLIDATED`.
5. **Revert**: if the invoice ends `ErrorEnvio` or is invalidated/`Anulada` **before** any NC
   exists against it, tickets are released to `COMPLETED` (fields cleared) and can be
   re-consolidated. After `Anulada` with NC, the operator decides per-ticket (advanced action,
   Phase 2).

### 6.2 Invariants

- Only `COMPLETED && !invoiceId` tickets of one company are selectable.
- A ticket belongs to **at most one** invoice; the invoice id + control number are the audit link.
- Consolidation never mutates stock (stock already moved at completion — §2.1, matching the
  Square/Loyverse per-sale deduction model).
- Line aggregation preserves per-ticket detail for audit: the invoice's "Tickets incluidos"
  panel lists `#seq · date · total · method` pulled from linked tickets (reading through the
  >2y archive when needed).

### 6.5 Libros IVA integration (exclusion + completeness)

How Libros IVA works today: `LibrosIVAPage` month-filters `selectAllInvoices` (excluding DTE
event types) and hands the array to `MHAnnexExportService`, which buckets CCF/FCF `Completada`
into the F-107 annexes. One seam, one filter — the design adds:

- **Ticket flag** `excludeFromLibrosIVA` (§2), editable at creation and from ticket detail, with
  a tooltip explaining the use cases (internal consumption, owner withdrawals, accountant
  criteria).
- **Propagation**: consolidation writes the flag onto the generated `Invoice.excludeFromLibrosIVA?`
  (new optional field on `src/types/invoice.ts`; rides the existing `invoices` persist whitelist
  untouched). Per §6.1, mixed selections split into two drafts so a single invoice never mixes
  included and excluded sales.
- **Filter with disclosure, not silently**: `LibrosIVAPage.monthInvoices` drops
  `excludeFromLibrosIVA` invoices, and the page shows a visible counter chip — *"N facturas
  excluidas de este libro (POS/configuración)"* — so the omission is always apparent to whoever
  reviews the export. Excluded invoices remain visible in the invoice list with a small badge.
- **Completeness warning**: the Libros IVA page (and Dashboard, Phase 2+) shows a banner when the
  selected month has `COMPLETED` tickets not yet consolidated: *"N tickets de ventas del período
  no están consolidados en DTE"* with a link to the wizard. Without this, an accountant reading
  only Libros IVA would not know sales exist outside the books.
- **Honesty note**: exclusion is an accounting/management convenience — a transmitted DTE still
  exists at MH and cross-checks against the monthly declaration; the criteria for what belongs
  in the books is the contador's (same action item as §1.4). Tickets themselves never appear in
  Libros IVA (they are not DTEs); only consolidated invoices do.

### 6.3 Migration/edge cases

- Free-text lines (no productId) aggregate under their literal name; the review step warns if a
  name matches a catalog product with a different price (typo guard).
- Rounding: aggregate per line, then sum — identical order to manual invoice entry; fixtures in
  tests assert equality with `computeTotals` output for the same lines.
- Tickets db grows unbounded → soft-archive > 2y into `tickets_archive_{companyId}` (never
  archived: unconsolidated COMPLETED or linked-to-live-invoice tickets).

---

## 7. Tier gating (product decision — recommendation)

| Feature | Free | Pro $7 | Business $14 |
|---|---|---|---|
| POS register, print ticket, history, void | ✅ | ✅ | ✅ |
| Cierre de caja X/Z (on-screen + thermal) | ✅ | ✅ | ✅ |
| Consolidation wizard (tickets → DTE) | 🔒 | ✅ | ✅ |
| Ticket sync (Device Sync v2) | — | — | rides Pro+Sync gate |

Rationale: the POS is the daily-engagement hook for the free tier (and stock management is
already free); the consolidation wizard is the accountant-facing time-saver worth paying for.
Gated via a new `canUsePosConsolidation(tier)` in `FeatureGate.ts` (AdFree|Pro), pattern identical
to `canExport` — locked UI + `SubscriptionModal` upsell, plus a Playwright regression spec
mirroring `subscription-gates.spec.ts`.

## 8. Device Sync v2 extension

Add `'ticket'` to `protocol.ts` entity types, `capture.ts` allowlist (listening to
`TicketDatabase` change events, exactly as Compras does), `entityAdapters.ts`, and the merge
engine: LWW on `(updatedAt, deviceId)`, tombstones win, status lattice from §2 enforced on apply,
`invoiceId` write-once once `CONSOLIDATED` (revert handled by a new authoritative event, not by
LWW re-write). Correlativo/`sequential`: per-device ranges not needed (sequential is display
order, not fiscal); conflicts resolve to max.

## 9. Testing strategy

- **Jest (unit)**: `EscposLayout` golden-buffer snapshots (init `1B 40`, cut, alignment opcodes);
  aggregation math incl. IVA decomposition/rounding vs `computeTotals`; `TicketDatabase` CRUD +
  listeners + archive; `applyTicketStockDeduction` (+clamp, +movement record); consolidation
  state machine (link/revert/invariant violations); `PosSettings` validation.
- **Playwright (web)**: full POS sale (scan → cart → cash w/ change → ticket COMPLETED → stock
  badges drop), card payment with POS fields, void path, X/Z cierre, consolidation wizard with
  mocked DTE send (route interception) incl. revert on failure, tier-gate spec.
- **Playwright (electron)**: **virtual thermal printer** — a local `net.Server` on an ephemeral
  port acting as printer; assert captured bytes contain company name, disclaimer, cut opcode;
  `printer:list` mocked; test-print toast assertions.
- **Docs**: extend the numbered screenshot suite (`docs-screenshots/22-pos_*`) and update
  CLAUDE.md "Current Project State".

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| TM-T20II is USB-only (M267D) → spooler raw needs one-time Epson driver install | Guided setup screen with OS-specific steps + detect button; recommend Ethernet variant for network transport |
| PowerShell/lp spawning on every receipt | Temp file in userData (0600) + cleanup; measured ~150–400 ms — acceptable per receipt; network transport default when available |
| appStorage JSON growth at retail volume | Debounced flush (existing storage engine), soft-archive >2y, sqlite `db:*` bridge reserved for a later phase (native module decision deferred, NOT reintroduced casually) |
| Fiscal exposure of periodic FCF consolidation | Non-fiscal disclaimer on every ticket, one-time advisory, accountant validation action item, DTE-type-agnostic engine, per-ticket FCF path (batch=1) available Phase 3+ |
| Card data | Store only last4/auth/ref (PCI-SAQ-A posture); inputs masked + maxlength |
| Sync conflicts on consolidation links | `invoiceId` write-once + authoritative revert event (§8) |
| Command injection via spooler printer names / oversized payloads | Strict name regex, payload size/string caps, `-EncodedCommand`, 0600 temp files (§3) |
| Free-tier tickets have no cloud backup (CloudSync v1 is invoice/customer/product/company only) | Z-cierre CSV + tickets JSON/CSV export available to all tiers; full backup rides Device Sync v2 (Pro+Sync); noted in setup docs |
| Silent Libros IVA omissions would misstate books | Exclusion is always disclosed (counter chip + badge, §6.5) + pending-consolidation banner closes the completeness loop |
| Backdating temptation at month-end consolidation | Wizard advisory: DTE carries emission date; period goes in observations (§6.1) |

## Phase 2+ backlog (explicitly deferred, not forgotten)

- **Devolución parcial** (line-level return on a completed ticket): refund record + restock,
  printable refund slip; full-ticket VOID covers the simple case in v1. After consolidation,
  returns go through the existing NotaCredito DTE.
- **Weight-embedded barcodes** (scales, KG products): parse prefix/PLU/weight from the scanned
  code and price accordingly.
- **Dashboard "Ventas POS hoy" card** + "N tickets sin consolidar este mes" reminder (also
  surfaced by the §6.5 banner).
- Receipt **QR** (ticket id / future consulta link) and **NV logo bitmap**; per-cashier Z
  reports; customer-facing display; price-override permissions.

## 11. Open decisions (for the user)

1. Tier gating table in §7 — confirm or adjust (esp. Free-tier consolidation).
2. Consolidation cadence legality for their régimen (contador) — §1.4 — **jointly with the
   Libros-IVA exclusion criteria (§6.5)**: what may legally stay out of the F-107 books is the
   accountant's call.
3. Z-report per company vs per "cajero" (multi-cashier shifts) — v1 is per company/day.
4. Receipt QR content (ticket id vs future "consulta tu factura" link) — Phase 2+.
5. Discount policy in v1: line-level only, ticket-level only, or both (model carries both; UI
   could ship line-level first).
6. Cash rounding default (`NEAREST_0.05` is the retail reality in El Salvador but changes
   printed totals; ship default `NONE` and let each shop opt in?).
