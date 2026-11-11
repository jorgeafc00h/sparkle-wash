# Desktop POS work tickets and job payments

## Why
The SparkleWash Desktop point of sale opens jobs for walk-in customers without a camera sighting, prints a numbered work ticket, and records what the customer paid. The API only knew camera arrivals and had nowhere to keep a ticket number, a customer name or payments.

## What Changes
- Jobs gain `source`, `ticketNumber`, `customerName`, `note`, `payments`, `paidAt`, plus derived `paidUsd` and `paymentStatus`. Older jobs read back with an empty `payments` array.
- `POST /api/jobs/walk-in` opens a job from a staff-entered, already confirmed arrival (camera id `pos-counter`, no photo) with an idempotency key.
- `POST /api/jobs/{id}/ticket` sets the work-ticket number once.
- `POST /api/jobs/{id}/payments` records an idempotent manual payment on a job.
- PostgreSQL migration `004_desktop_pos_job_fields.sql` adds the nullable columns.
- `/openapi.json` lists the three routes. `src/carwash-api.DevHost` is a development-only host for end-to-end runs; it is not built into the production image.

## Capabilities
### New Capabilities
- `desktop-pos`: walk-in jobs, work tickets and recorded payments.

## Impact
API (`JobStore`, `PostgresWorkflowStores`, `Program.cs`), database migration, integration tests (`DesktopPosWorkflowTests`), `backend/desktop` and iOS clients that consume the fields.

## Non-goals
Payments are recorded by staff; they are not verified against N1CO or any card processor, and a recorded payment is not proof of settlement. No refunds, no editing or deleting payments, no receipts server side. `PaymentPosStore.cs` stays unwired.
