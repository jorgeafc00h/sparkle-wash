## 1. Job model
- [x] 1.1 Add optional job fields and `JobPayment`; derive `paidUsd`/`paymentStatus`; serialize `payments` as an array for legacy jobs.
- [x] 1.2 Mark jobs opened through `POST /api/jobs` with source `camera`.

## 2. Routes
- [x] 2.1 `POST /api/jobs/walk-in` with validation before any write, idempotent replay and conflicts.
- [x] 2.2 `POST /api/jobs/{id}/ticket`, write-once.
- [x] 2.3 `POST /api/jobs/{id}/payments`, idempotent, rejected on cancelled jobs.
- [x] 2.4 Operator/admin only, tenant scoped, publishes `jobs` (and `arrivals` for walk-ins).

## 3. Storage and contract
- [x] 3.1 Migration `004_desktop_pos_job_fields.sql` and PostgreSQL store read/write of the new fields.
- [x] 3.2 Update `/openapi.json`.
- [ ] 3.3 Run the PostgreSQL integration test against a real database (skipped locally).

## 4. Verification
- [x] 4.1 `DesktopPosWorkflowTests` against `Program.BuildApp`.
- [x] 4.2 Development-only `src/carwash-api.DevHost` for desktop/iOS end-to-end runs.
