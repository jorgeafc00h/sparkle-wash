## ADDED Requirements

### Requirement: Walk-in jobs from the point of sale
The API SHALL let an operator or admin open a job for a walk-in vehicle with `POST /api/jobs/walk-in` under an `Idempotency-Key`. The job SHALL come from a staff-confirmed arrival (camera id `pos-counter`, no photo) that never appears in the pending review queue. Its source SHALL be `desktop-pos`, while jobs opened through `POST /api/jobs` SHALL have source `camera`.

#### Scenario: Walk-in is created once
- **WHEN** an operator posts a valid walk-in twice with the same key and input
- **THEN** the first call returns 201 with the job and the second returns 200 with the same job, and only one job and one arrival exist

#### Scenario: Conflicting walk-in
- **WHEN** the key is reused with a different plate or package, or the plate already has an open job
- **THEN** the API returns 409 and, for an open job, includes that job in the response

#### Scenario: Invalid walk-in writes nothing
- **WHEN** the plate, class, package, employee or ticket number is invalid
- **THEN** the API returns 400 and no arrival or job is created

### Requirement: Walk-in validation
The plate, vehicle class, package, employee, ticket number (1-32 letters, digits or dashes), customer name (80 characters at most) and note (200 characters at most) SHALL be validated before anything is stored.

#### Scenario: Oversized note
- **WHEN** the note has 201 characters
- **THEN** the API returns 400 and stores nothing

### Requirement: Write-once work ticket
`POST /api/jobs/{id}/ticket` SHALL set the job's ticket number when it has none, return 200 when the same number is already set, and return 409 when a different number is set. Unknown jobs SHALL return 404 and invalid numbers 400.

#### Scenario: Different ticket number
- **WHEN** a job already has ticket `OT-1` and another number is posted
- **THEN** the API returns 409 and the ticket stays `OT-1`

### Requirement: Recorded job payments
`POST /api/jobs/{id}/payments` SHALL append a payment (`cash`, `card`, `transfer` or `other`, above 0 and at most 100000 USD) under an `Idempotency-Key`. Cancelled jobs SHALL reject payments with 409. These payments are staff records and SHALL NOT be presented as verified by a payment processor.

#### Scenario: Cancelled job
- **WHEN** a payment is posted for a cancelled job
- **THEN** the API returns 409 and records nothing

### Requirement: Payment status on jobs
A job view SHALL always include a `payments` array (empty for jobs created before this change), `paidUsd` and `paymentStatus` (`unpaid`, `partial`, or `paid` once `paidUsd` reaches `priceUsd`). `paidAt` SHALL be set when the job first becomes fully paid.

#### Scenario: Partial then full payment
- **WHEN** a payment below the price and then a payment covering the remainder are recorded
- **THEN** the status goes from `partial` to `paid` and `paidAt` is set at the second payment

#### Scenario: Replayed or conflicting payment
- **WHEN** the same key is sent with the same body, or with a different body
- **THEN** the API returns 200 without adding a payment, or 409 respectively

### Requirement: Staff-only, tenant-scoped writes
The three routes SHALL require an operator or admin session (viewers receive 403, anonymous callers 401) and SHALL only see and change jobs of the caller's carwash.

#### Scenario: Other carwash
- **WHEN** another carwash's staff post a ticket or payment for this job id
- **THEN** the API returns 404
