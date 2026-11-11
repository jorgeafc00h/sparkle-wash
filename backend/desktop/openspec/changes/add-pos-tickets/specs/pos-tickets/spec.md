# pos-tickets — Delta

## ADDED Requirements

### Requirement: Counter-sale ticket creation
The app SHALL provide a company-scoped POS register (`/pos`) where the user composes a ticket from
catalog products (grid/search/barcode-scanner input), optional free-text quick items, and
completes it by recording at least one payment (cash with tendered/change, or card on an external
POS terminal captured as auth code + last 4 + card type, never full PAN/CVV). A completed ticket
SHALL be persisted in the per-company ticket database and SHALL NOT require MH connectivity.

#### Scenario: Barcode sale completes offline
- **WHEN** the cashier scans a product barcode, sets quantity 2, takes $10 cash on an $8.50 ticket
- **THEN** the ticket persists with status COMPLETED, change $1.50 is computed, and no network call is made

#### Scenario: Card payment records terminal evidence only
- **WHEN** the cashier charges a card on the external datáfono and types the auth code and last 4 digits
- **THEN** the ticket stores method TARJETA_POS with auth/last4/reference and no full card number anywhere

### Requirement: Stock discharge and restore on tickets
Completing a ticket with catalog lines on inventory-tracked products SHALL record an OUT
`StockMovement` per line with `referenceId` = ticket id and decrement product stock; voiding a
COMPLETED ticket SHALL record a mirrored IN movement and restore stock. Consolidation SHALL NOT
mutate stock.

#### Scenario: Sale deducts stock once
- **WHEN** a 2-unit ticket for an inventory-tracked product (stock 10) completes
- **THEN** product stock becomes 8 and exactly one OUT movement referencing the ticket id exists

#### Scenario: Void restores stock
- **WHEN** that ticket is voided with a reason before any consolidation
- **THEN** stock returns to 10 and an IN movement with reason "Anulación ticket" references the ticket id

### Requirement: Thermal ESC/POS printing with generic + TM-T20II profile
The app SHALL print tickets, test pages and Z-reports as raw ESC/POS bytes from the Electron main
process, over a network transport (TCP 9100) or the OS spooler (raw), configured per company with
paper width 80/58 mm, copies, cut and custom header/footer lines — with no native Node modules in
the shipped `dependencies`. Printed tickets SHALL carry the disclaimer that the document is not a
fiscal invoice/DTE. Print failures SHALL NOT fail the sale and SHALL offer a reprint.

#### Scenario: Network test print on the TM-T20II profile
- **WHEN** the user saves printer settings (network host, 80 mm) and taps "Imprimir página de prueba"
- **THEN» the printer emits the page and a success toast appears

#### Scenario: Spooler raw on Windows
- **WHEN** transport is spooler and the printer name matches an installed queue
- **THEN» raw ESC/POS bytes are submitted as a RAW datatype job without any native module

#### Scenario: Printer offline does not lose the sale
- **WHEN» the ticket completes but the printer is unreachable
- **THEN» the ticket remains COMPLETED with an error toast and a working "Reimprimir" action

### Requirement: Cierre de caja (X/Z reports)
The app SHALL produce an X-report (read-only snapshot for a range) and a Z-report (close since the
previous Z) containing ticket and void counts, gross totals, IVA-included breakdown and totals per
payment method (cash tendered/change reconciled separately, card totals with auth references),
printable on the configured thermal printer. Each Z SHALL persist a closing snapshot referencing
its ticket ids.

#### Scenario: Z closes the day and is reusable as a consolidation filter
- **WHEN** the cashier runs the Z close for the day
- **THEN** a snapshot with the day's ticket ids is stored, and the consolidation wizard offers that Z as a selection filter

### Requirement: Ticket-to-DTE consolidation
The app SHALL provide a consolidation wizard that selects unconsolidated COMPLETED tickets of one
company (all, some, by date range or by Z-closing), aggregates lines per product with quantity
sums and price conflict flagging, and generates a draft DTE invoice through the existing invoice
pipeline. When that invoice reaches Completada the selected tickets SHALL become CONSOLIDATED
linked to it (invoiceId + control number); if the invoice fails at MH or is invalidated before
consumption, the tickets SHALL be released back to COMPLETED. A ticket SHALL belong to at most one
invoice, and the invoice detail page SHALL list the tickets it consumed.

#### Scenario: Month-end consolidation into one Factura
- **WHEN** the user selects 120 September tickets and generates a Factura (Consumidor Final) that MH accepts
- **THEN** each ticket shows CONSOLIDATED with that invoice's id/control number, and the invoice detail lists all 120 tickets

#### Scenario: Failed DTE releases tickets
- **WHEN** the generated invoice ends in ErrorEnvio
- **THEN** the tickets return to COMPLETED, unlinked, and can be re-consolidated

### Requirement: Libros IVA exclusion with disclosure and completeness warning
A ticket SHALL carry an optional `excludeFromLibrosIVA` flag (editable before consolidation), and
consolidation SHALL propagate it to the generated invoice (`Invoice.excludeFromLibrosIVA`). The
Libros IVA page SHALL exclude flagged invoices from the F-107 export while ALWAYS displaying a
visible counter of excluded invoices for the period. A consolidation selection mixing flagged and
unflagged tickets SHALL be split into separate draft invoices. The Libros IVA page SHALL warn
when the selected period has COMPLETED tickets not yet consolidated into any DTE.

#### Scenario: Excluded sale stays out of the books, visibly
- **WHEN** an excludeFromLibrosIVA ticket is consolidated and the invoice completes
- **THEN** that invoice is omitted from the F-107 export and the page shows "1 factura excluida (POS/configuración)"

#### Scenario: Mixed selection splits
- **WHEN** the wizard selection contains normal and excluded tickets
- **THEN** two draft invoices are generated — one per flag — and each links only its own tickets

#### Scenario: Unconsolidated sales are flagged to the accountant
- **WHEN** the selected month has 40 COMPLETED tickets with no invoiceId
- **THEN** the Libros IVA page shows a warning banner linking to the consolidation wizard

### Requirement: POS tier gating
Ticket selling, printing and X/Z reports SHALL be available to all tiers. The consolidation wizard
SHALL require a paid tier (Pro/Business) via `FeatureGate` with locked UI + subscription modal,
consistent with existing gates.

#### Scenario: Free user sells but cannot consolidate
- **WHEN** a Free-tier user opens /pos/consolidate
- **THEN** the wizard is locked with an upgrade prompt, while /pos selling and printing remain fully usable

### Requirement: Ticket entity in Device Sync v2
When Device Sync v2 is entitled and active, tickets SHALL sync as a `ticket` entity with LWW merge
on (updatedAt, deviceId), tombstone deletes, the ticket status lattice enforced on apply, and
`invoiceId` treated as write-once once CONSOLIDATED.

#### Scenario: Ticket syncs to a second device
- **WHEN» a Pro+Sync user completes a ticket on Desktop with a sync session open
- **THEN» the ticket appears on their other device with the same status and payments
