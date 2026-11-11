# pos-tickets — Delta (Phase 2)

## ADDED Requirements

### Requirement: Split payments
The payment dialog SHALL accept several payments (cash, card on an external terminal, other) until
the balance is zero. Change SHALL come only from cash payments, a non-cash payment SHALL NOT exceed
the remaining balance, and cash rounding SHALL apply only when the sale is settled with a single
cash payment.

#### Scenario: Card plus cash
- **WHEN** a $20.00 sale is paid $15.00 by card and the cashier receives $10.00 cash for the rest
- **THEN** the ticket stores two payments (card $15.00, cash $5.00 with tendered $10.00 and change $5.00) and the Z counts it once with both method buckets

#### Scenario: Card can't overpay
- **WHEN** the cashier types $25.00 for a card payment on a $20.00 balance
- **THEN** the card amount is capped at $20.00 (or refused) and the sale is not completed with a negative balance

#### Scenario: No rounding on a split sale
- **WHEN** rounding to $0.05 is enabled and a $8.47 sale is paid $5.00 card + $3.47 cash
- **THEN** the ticket total stays $8.47 with no rounding adjustment

### Requirement: Suspended sales and register shortcuts
F8 SHALL suspend the current sale as an OPEN ticket without moving stock or printing; "Ventas en
espera" SHALL list this register's OPEN tickets for resume or discard. F4 SHALL remove the selected
line. OPEN tickets SHALL NOT appear in closings, consolidation or pending-sales counts.

#### Scenario: Suspend and resume
- **WHEN** the cashier adds two products, presses F8, sells to another customer, then resumes the suspended sale and charges it
- **THEN** stock is deducted only when the resumed sale completes, the resumed ticket keeps its number, and both sales appear in the Z

#### Scenario: Discard a suspended sale
- **WHEN** a suspended sale is discarded
- **THEN** it leaves "Ventas en espera", no stock moved and it never counts as a sale

#### Scenario: F4 removes the selected line
- **WHEN** a line is selected and the cashier presses F4
- **THEN** that line leaves the cart and totals update

### Requirement: Quantities, weighable products and scale barcodes
Products with a weighable unit SHALL accept decimal quantities (3 decimals); others integers ≥ 1.
Typing `N*` before choosing or scanning a product SHALL add N units. With scale barcodes enabled,
an EAN-13 with the configured prefix SHALL be parsed into PLU + weight (or price) and add the
matching product with the derived quantity.

#### Scenario: Weight from a scale label
- **WHEN** scale barcodes are on (prefix 2, PLU 5, weight 5 digits in grams) and the cashier scans the label for PLU 00123 with 01250 g
- **THEN** the product whose code/barcode is 123 is added with quantity 1.250 and line total = 1.25 × price

#### Scenario: Multiplier before a scan
- **WHEN** the cashier types `3*` and then scans a unit product
- **THEN** the line is added with quantity 3

#### Scenario: Decimal quantity only for weighable units
- **WHEN** the cashier types 1.5 on a product sold by unit
- **THEN** the quantity is not accepted as a fraction (stays an integer)

### Requirement: Quick-create product on a barcode miss
On an unknown code, a user allowed to manage products SHALL be offered "Crear producto" with the
code prefilled; saving SHALL create the product (synced and audited like any product) and add it
to the cart. Users without that permission SHALL only see "Código no encontrado".

#### Scenario: Create from the register
- **WHEN** the admin scans an unknown barcode, chooses "Crear producto", types name and price and saves
- **THEN** the product exists in Productos with that barcode and the cart has one unit of it

### Requirement: Registers
Each device SHALL act as a register with a code and name (settings); new tickets SHALL carry the
register id and code and display numbers as `<code>-<number>`; the Z SHALL include only this
register's tickets; the X SHALL offer this register or all registers.

#### Scenario: Two registers, separate Zs
- **WHEN** register C1 sells $10 and a synced peer register C2 sells $20 the same day
- **THEN** C1's Z shows $10 and C1's X with "todas las cajas" shows $30

### Requirement: Cash management and arqueo
The register SHALL be opened with a float; cash in/out SHALL be recorded with a reason by users
with `pos.cash`; the Z SHALL compute expected cash = float + cash sales − cash refunds + cash in −
cash out, accept the counted cash and store and print the difference (faltante/sobrante).

#### Scenario: Shortage at the Z
- **WHEN** the register opens with $50, sells $30 cash, takes out $10 for a supplier and the cashier counts $68 at the Z
- **THEN** expected cash is $70, the difference is −$2.00 (faltante) and the saved closing and Z receipt show both

#### Scenario: Cash out requires permission
- **WHEN** a cashier without "Entradas/salidas de efectivo" opens the register page
- **THEN** the cash in/out action is disabled

### Requirement: Z breakdowns
The Z SHALL show totals per cashier, a per-product summary and the discount total, in addition to
the per-method totals.

#### Scenario: Two cashiers
- **WHEN** cashier Ana sells $10 and cashier Beto sells $15 before the Z
- **THEN** the Z lists Ana $10 (1) and Beto $15 (1)

### Requirement: Partial returns
Users with `pos.return` SHALL be able to return some units of some lines of a completed ticket that
is not on a draft or invoice, with a refund method and reason; returned units SHALL be restocked
once, a return slip SHALL print, refunds SHALL appear in the Z of the day of the return, and
consolidation SHALL invoice only the kept units. Returns on consolidated or pending tickets SHALL be
refused with guidance to issue a credit note.

#### Scenario: Return one unit
- **WHEN** a ticket sold 3 × $2.00 and the customer returns 1 unit for cash
- **THEN** stock increases by 1, the refund is $2.00, the next Z shows a $2.00 cash refund and expected cash drops by $2.00

#### Scenario: Consolidation invoices only what was kept
- **WHEN** that ticket is consolidated
- **THEN** the draft line has quantity 2 and the draft total equals $4.00 and the reconciliation balances

#### Scenario: Return refused after invoicing
- **WHEN** the user tries to return a line of a ticket that is consolidated
- **THEN** the action is refused with "Emite una nota de crédito sobre la factura"

#### Scenario: Return with ticket discount
- **WHEN** a ticket of 2 × $5.00 with a $1.00 ticket discount returns 1 unit
- **THEN** the refund is $4.50 (the unit's share of the discount is not refunded)

### Requirement: Ticket archive
Final tickets older than the current and previous month SHALL move to per-month archive storage;
lists, reports, consolidation, invoice links and Device Sync SHALL keep seeing them.

#### Scenario: Archived ticket still reachable
- **WHEN** a consolidated ticket from three months ago is archived
- **THEN** the hot ticket store no longer holds it, the invoice detail still lists it, a ticket-list date filter on that month shows it and Device Sync digests are unchanged

### Requirement: Dashboard POS card
The dashboard SHALL show today's POS sales (count, amount) and the number of unconsolidated tickets
of the month with a link to the consolidation wizard (when POS has been used).

#### Scenario: Card reflects today
- **WHEN** two tickets are sold today
- **THEN** the dashboard POS card shows 2 tickets and their total

### Requirement: Stock converges across registers
Product stock changed on several synced devices SHALL converge to the sum of every device's changes,
whatever the delivery order: stock SHALL travel as a per-device counter inside the product
(`stockLedger`), merged per device, with an edited level recorded as a local change rather than an
absolute overwrite. Copies from app versions without the counter SHALL still be accepted (a newer
absolute level re-bases the counter) and products without a counter on either side SHALL merge as
before.

#### Scenario: Concurrent sales on two registers
- **WHEN** a product has stock 100 and, before syncing, the Desktop sells 2 and a phone register sells 3
- **THEN** after sync both devices show 95 and the merged product is sent back to the peer

#### Scenario: Older app writes an absolute level
- **WHEN** a device without the counter sets the stock to 20 after this device sold 2 from 10
- **THEN** the product shows 20 and later sales count down from it
