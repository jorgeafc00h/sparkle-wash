## ADDED Requirements

### Requirement: Legacy station telemetry compatibility
The system SHALL retain authenticated station telemetry and streaming as device compatibility interfaces while jobs become the primary operational model. Station frames SHALL NOT be counted as vehicle jobs. Clients using legacy streams SHALL reconnect with bounded backoff and show stale snapshots during failure.

#### Scenario: Broker disconnects and recovers
- **WHEN** the broker stops supplying telemetry and later reconnects
- **THEN** both clients indicate stale data, avoid duplicate subscriptions and resume current readings with a bounded event history

### Requirement: Durable camera workflow
The API SHALL persist validated, bounded camera uploads and provide image retrieval. Both clients SHALL display actual arrival/job photos with provenance. Native offline mode SHALL render previously cached photos with freshness information and reconcile metadata on reconnection.

#### Scenario: Offline native camera view
- **WHEN** connectivity is lost after a photo has been cached
- **THEN** the native app displays the stored image marked offline without inventing a new frame

### Requirement: Authoritative receipts and payments
The backend SHALL verify receipt/payment state with the selected authoritative payment system. Both clients SHALL support the specified QR-to-receipt workflow, digital receipt viewing and explicit pending, failed and confirmed states.

#### Scenario: Unknown receipt
- **WHEN** either client submits a receipt that the server cannot verify
- **THEN** the client reports an unverified receipt and never treats local data alone as payment confirmation

### Requirement: Authorized operations on both platforms
The backend SHALL enforce roles for job, employee, plate correction and inventory mutations. Both clients SHALL expose permitted job controls, staff/integration settings and operational summaries with loading and failure feedback. Legacy station reset is not part of the primary workflow.

#### Scenario: Unauthorized job mutation
- **WHEN** a user without the required role submits a job or stock change from either platform
- **THEN** the backend rejects the change and the UI retains the prior authoritative state

### Requirement: Native feedback and accessible parity
Native phase changes SHALL support configurable haptics. Shared workflows SHALL work on phone and tablet with screen readers, large text, reduced motion and light/dark modes. Native layout SHALL use available window points rather than fixed physical pixels.

#### Scenario: Haptics disabled
- **WHEN** a phase changes while the user's haptics preference is disabled
- **THEN** the native UI updates the phase without vibration

### Requirement: Verified edge and deployment
Firmware SHALL build for the confirmed board and publish real camera/sensor data using valid MQTT topics and upload contracts. Container and deployment configuration SHALL build and start the actual API and frontend and pass readiness checks.

#### Scenario: End-to-end hardware acceptance
- **WHEN** a physical ESP32 observes a vehicle and uploads an image
- **THEN** the backend persists a reviewable arrival and web and iOS display matching evidence before staff confirmation

### Requirement: Plate-based arrivals
The backend SHALL accept authenticated, bounded, idempotent ESP32 plate observations with image provenance, candidate text and confidence. It SHALL keep unconfirmed observations separate from jobs. Staff SHALL confirm or correct the plate and vehicle class before creating a job. Web and SwiftUI SHALL show provenance and uncertainty.

#### Scenario: Ambiguous camera observation
- **WHEN** a camera submits a low-confidence or unreadable plate
- **THEN** an arrival remains available for staff review without creating or merging a job

### Requirement: Detailing packages and price snapshot
The backend SHALL publish Quick, Essential, Renew and Supreme inclusions and the supplied four-class USD price matrix. A new arrival SHALL receive an explainable package suggestion, which staff can change. Confirmation SHALL snapshot the selected package, inclusions, class and price on the job.

#### Scenario: Vehicle class changes before confirmation
- **WHEN** staff changes a suggested car to SUV
- **THEN** the package price uses the SUV row and no charge exists until the job is confirmed

### Requirement: Job lifecycle and whole-carwash totals
The backend SHALL persist arrivals, jobs, status transitions, employee assignments, timestamps and server-derived elapsed time. It SHALL reject invalid transitions, prevent duplicate open jobs for a plate, and publish whole-carwash active/completed counts and timing summaries. Both clients SHALL show the same job lifecycle and totals.

#### Scenario: Car completes detailing
- **WHEN** staff completes an in-progress job
- **THEN** the server records completion time and duration, and the completed-job count increases once

### Requirement: Employees and inventory ledger
The backend SHALL persist employees and auditable inventory items/movements. Job resource usage SHALL reference items and employees, be idempotent, and never create negative on-hand stock. Both clients SHALL expose employee lists, stock and per-job materials with loading and failure feedback.

#### Scenario: Insufficient compound
- **WHEN** a job attempts to consume more compound than is available
- **THEN** the server rejects the deduction and leaves stock and job usage unchanged

### Requirement: Cross-platform job parity
The mounted web app and SwiftUI app SHALL present arrivals, package suggestions, jobs, employees, time on site and inventory using the same server contracts. Both SHALL handle stale/offline reads accessibly. Legacy station screens SHALL not be the primary dashboard.

#### Scenario: Native app loses connectivity
- **WHEN** connectivity fails after jobs and inventory were loaded
- **THEN** SwiftUI shows the cached snapshot as stale and does not invent job changes or stock movements

### Requirement: Recoverable operational history
The system SHALL keep active operational state durable across API replacement.
Archive batches SHALL be tenant-scoped, versioned, integrity checked and independently
restorable. Automated purge SHALL require an approved policy, a verified restore and
a current eligibility check for each exported record version.

#### Scenario: Archive verification fails
- **WHEN** an exported batch cannot be verified or restored
- **THEN** the source records remain available and the batch can be retried without duplicate records

#### Scenario: A closed job is placed on hold after export
- **WHEN** the archive process rechecks records before purge
- **THEN** the held record remains in the operational store

### Requirement: Authorized offline history
The native app SHALL keep downloaded history read-only and scoped to the authorized
origin, tenant and staff account. Offline access SHALL require a bounded entitlement.
Sign-out, expiry, confirmed revocation and deletion SHALL remove access to the
affected records.

#### Scenario: Same endpoint, different tenant
- **WHEN** a staff member signs in to a different tenant at the same API origin
- **THEN** the prior tenant's archived records remain inaccessible

#### Scenario: Archived history is available offline
- **WHEN** an entitled staff member opens previously downloaded history while offline
- **THEN** the app displays the saved records and their last synchronization time
