# Web operations workboard

## Purpose

Specify the mounted React operations page in `frontend/src/main.tsx` and
`frontend/src/OperationsApp.tsx`. The previous station dashboard remains an
unmounted compatibility experiment and is not the landing page.

## Requirements

### Requirement: Public service catalog

The signed-out page SHALL load and validate the service-package catalog from
`GET /api/packages`, show package descriptions, included services, vehicle
classes, and prices, and show a visible error when the catalog cannot be loaded.
When a public Google OAuth web client ID is configured, it SHALL show the
Google sign-in button; otherwise it SHALL explain that sign-in is not
configured.

#### Scenario: Visitor views the menu

- **WHEN** the package catalog is available
- **THEN** the page shows the four service packages with their vehicle-class
  prices and included services without requiring staff sign-in

#### Scenario: Visitor needs staff operations

- **WHEN** no Google client ID is configured
- **THEN** the public catalog remains available and the page explains that
  staff sign-in is not configured

### Requirement: Authenticated operations workboard

After Google identity verification and a successful staff session exchange,
the page SHALL fetch arrivals, jobs, job summary, employees, and inventory from
the API and validate each response. It SHALL show whole-carwash waiting, active,
and completed-today totals, arrivals awaiting review, job status and elapsed
time, assignments, employees, and available inventory. It SHALL refresh after
each completed fetch, using a 15-second foreground interval and a 60-second
interval while the document is hidden. Refresh errors SHALL retain the last
successful workboard and state its last update time.

#### Scenario: Staff session loads operations

- **WHEN** an authorized staff member signs in
- **THEN** the page shows the validated arrivals, jobs, totals, employees, and
  stock from the authenticated API routes

#### Scenario: Session expires

- **WHEN** any workboard route returns HTTP 401
- **THEN** the page clears the expired session and asks the staff member to sign
  in again

### Requirement: Role-checked job actions

Only operator and admin sessions SHALL be offered job mutations. An operator
SHALL be able to confirm an arrival and open its selected package job, advance a
job through queued, in-progress, and completed states, and assign an active
employee not already assigned. Mutations SHALL use idempotency keys and show
action errors. Viewer sessions SHALL remain read-only.

#### Scenario: Operator opens a job from an arrival

- **WHEN** an operator confirms a plate and submits a vehicle class and package
- **THEN** the page confirms the arrival and creates its job using an
  idempotency key

#### Scenario: Viewer opens the same workboard

- **WHEN** a viewer signs in
- **THEN** operational data is visible but job mutation controls are absent

### Requirement: Honest feature status

The mounted page SHALL NOT describe demo station metrics as live job counts,
the legacy `/api/upload` acknowledgment as photo storage, or employee and
inventory summaries as full management workflows. Missing catalog, sign-in,
refresh, and action states SHALL be visible in context.

#### Scenario: Station endpoints return demo samples

- **WHEN** the compatibility station endpoints provide demo readings
- **THEN** the operations page does not present those readings as carwash job
  activity
