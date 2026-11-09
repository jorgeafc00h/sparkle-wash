# Superseded PostgreSQL migrations

These four migrations predate the consolidated `backend/db/migrations/001_core.sql`
baseline. They create tables already created by `001_core.sql` and must not be
run alongside it. The active migration runner previously enumerated both sets,
which made a fresh database migration fail on duplicate tables.

The authenticated SparkleWash Neon `main` ledger was checked on 2026-11-05 and
contained only `001_core`; arrivals and jobs were empty. No older deployment
using this migration sequence was identified. The archived SQL is retained for
historical reference only. Do not restore it to the active migrations directory
without a tested compatibility migration plan.
