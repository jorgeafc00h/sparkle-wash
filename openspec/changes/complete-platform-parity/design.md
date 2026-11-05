## Context
See docs/reviews/2026-10-16-project-review.md for evidence and docs/FEATURE-PARITY.md for coverage. Existing specs contradict one another and completion reports did not run the active applications.

The product model has changed: a vehicle job is the primary unit of work. Station snapshots remain a compatibility/device baseline and must not be counted as jobs. The attached Spanish menu is the package/price source; physical ESP32 capture and OCR performance remain unverified.

## Decisions
Keep the current tested demo contract in root specs. Do not silently describe target behavior as implemented. Preserve original upload behavior for compatibility until an explicit API revision. Keep iOS and web clients on one fixture-backed DTO contract; identify telemetry source and freshness. Real operational actions require backend authority and idempotency, not UI-only state. Model camera metadata separately from image bytes and cache photos with explicit retention limits.

Use native SwiftUI view modifiers/system colors and Dynamic Type. A 1536-pixel viewport requirement cannot be used as a SwiftUI point breakpoint; the repaired baseline uses available window width and text size. Reconfirm any exact production layout before polishing.

### Job-first model
The ESP32 sends a bounded photo and/or plate candidate with device event ID, camera ID, capture time and confidence. The API stores an immutable observation and deduplicates retries by device event ID. Normalization uppercases letters and removes separators without inventing characters. Staff confirm/correct the plate and vehicle class; low-confidence or absent candidates stay in an arrival review queue. No station ID is needed to create a job.

Catalog slugs are `quick`, `essential`, `renew`, `supreme`; vehicle classes are `car`, `suv`, `xl`, `pickup`. USD prices in that order are car 10/15/25/35, SUV 12/18/30/40, XL 14/21/35/45, pickup 16/24/40/50. Inclusions are cumulative from the supplied service menu. The initial deterministic suggestion is `essential`, and staff can change it. A confirmed job snapshots its price, class and inclusions so catalog edits cannot change history.

Job states are `arrived` → `queued` → `in_progress` → `completed`, with `cancelled` from nonterminal states. The server owns transition timestamps, rejects invalid changes, and derives elapsed/active minutes. Only one open job per normalized plate; later visits make new jobs. Fleet totals count jobs by state and day, not stations.

Employees have stable IDs, names and active flags. Assignments snapshot historical names. Inventory items have SKU, unit and reorder threshold; on-hand derives from append-only receipt, adjustment and consumption movements. Job consumption is idempotent per operation, references an employee and item, cannot make stock negative, and stays auditable. Reservations are distinct from consumption and release on cancellation.

Staff Google sign-in follows App.Desktop's provider-token-validation pattern but uses SparkleWash-owned sessions, roles and secrets. Device credentials can submit observations; staff roles gate plate correction, jobs, employees and stock changes. Web and SwiftUI use the same versioned DTOs and show loading, stale and error states. Native offline data is read-only until explicit reconciliation. N1CO payment references immutable job IDs and confirmed prices.

## Cloud persistence and archive

Start with Neon PostgreSQL for active records. Use a runtime role with the minimum
data privileges and a separate migration role. Store images privately in object
storage and keep stable object keys and checksums in PostgreSQL. Preserve tenant IDs,
event IDs, job snapshots, inventory dependencies, and idempotency keys in migration.
Validate a dry run with row counts and checksums, then freeze writes for final import
and cutover. Define a rollback point before accepting writes on the new store.

Use 90 days of hot closed-job history and 30 days of readily available evidence as
planning assumptions. Keep automatic purge disabled until retention, holds, and
financial record policy are approved. Export immutable tenant-scoped batches to a
separate private object store with a versioned manifest. Track each batch in PostgreSQL
through export, checksum verification, isolated restore, and eligibility review.
Record IDs and versions in the manifest so purge can recheck eligibility in one
transaction. Preserve inventory ledgers, financial links, and long-lived deduplication
keys even when a job's history moves out of hot storage.

Expose archived history through authorized, paged API reads. Include record versions
and distinguish archive movement from access revocation or erasure. SwiftData
downloads remain read-only and scoped by API origin, server-verified tenant and
account, and entitlement. Cold offline access requires an expiring entitlement.
Sign-out, expiry, and revocation remove access to protected downloads. On reconnection,
sync removals and access changes before adding history. The server archive and
restore process must work independently of any device copy.

See [cost and retention](../../../docs/cloud-cost-and-retention.md) and the
[iOS plan](../../../docs/ios-workboard-plan.md) for sizing and acceptance details.

## Risks / unresolved decisions
- Actual ESP32 board/camera/pinout and broker connectivity have not been verified.
- N1CO is the selected payment processor. Reuse App.Desktop's Google sign-in approach: validate a Google identity token on the backend and issue a SparkleWash-owned session. Do not reuse Facturas Simples account tokens, JWT signing keys, or company membership as SparkleWash staff roles. Staff role assignment and receipt rules still need SparkleWash-specific policy.
- Legacy upload size/status and reset method conflict; settle these in a versioned API contract.
- Hosting prices, infrastructure and prior publication claims are unverified.
- Firmware and deployment examples are not build or deployment evidence.
- Plate recognition confidence and hardware provenance need physical-device validation. Until then arrival ingestion is a tested contract, not a claim of working OCR.

## Validation strategy
Test production route handlers with real HTTP and WebSocket clients; test both DTO decoders against shared payload fixtures; test cancellation/reconnect and interrupted uploads. Validate phone/tablet, light/dark, large text, reduced motion, screen reader and offline/restoration flows. Require physical-device and broker evidence before closing firmware tasks.

Also test atomic restart persistence, duplicate plate events, corrected plates, job transition/idempotency rules, simultaneous stock consumption and no-negative-stock enforcement. Verify whole-carwash totals from jobs and shared catalog/job fixtures in both clients.
