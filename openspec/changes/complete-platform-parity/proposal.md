# Job-centered operational platform parity

## Why
Car Spa must follow cars and their work, not fixed wash stations. An ESP32 camera observes an arriving plate; staff confirm the vehicle, choose a detailing package, assign employees, record materials and close the job. The business needs whole-carwash job counts, elapsed time, employee activity and stock usage on web and SwiftUI. Existing station metrics are a technical baseline, not the product dashboard.

## What Changes
- Accept plate-observation events with image provenance and confidence; staff confirm/correct them before job creation.
- Publish the supplied Quick, Essential, Renew and Supreme packages with prices by car, SUV, XL and pickup class.
- Persist a job lifecycle, service checklist, employee assignments, server-derived elapsed time and whole-carwash totals.
- Add an auditable inventory ledger for cleaning compounds and other resources, including receipts, adjustments, reservations and per-job consumption.
- Make the mounted web and SwiftUI experiences job-first. Preserve legacy station routes for compatibility during migration.
- Continue protected identity, N1CO receipts, camera, firmware and deployment work in support of jobs.

- Move operational storage to managed PostgreSQL for the cloud pilot. Archive eligible closed history and support scoped read-only SwiftData downloads.

## Capabilities
### New Capabilities
- `platform-parity`: end-to-end operational features across backend, web, iOS and firmware.

## Impact
Backend routes, data model and telemetry worker; web and native arrivals/jobs/employee/inventory views; firmware camera payload; shared fixtures, integration tests, device tests and accessibility validation.

## Non-goals
No automatic plate-based identity or package purchase. OCR confidence alone cannot authorize a job, stock deduction or payment. Existing station telemetry and photo endpoints remain compatibility interfaces, not the main operational model. Physical OCR accuracy requires device evidence.
