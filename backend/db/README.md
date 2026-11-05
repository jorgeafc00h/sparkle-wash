# PostgreSQL cutover

The active API has optional PostgreSQL stores. The initial schema migration is
`migrations/001_core.sql`; it creates the `sparklewash` schema, all tables used
by the tenant/session/device/workflow/inventory stores, indexes, and the legacy
`default` tenant row. `scripts/db-migrate.sh` applies unapplied numbered
migrations transactionally and records them in `sparklewash.schema_migrations`.
It reads the connection URL from `SPARKLEWASH_MIGRATION_DATABASE_URL`, writes a
temporary mode-0600 libpq password file, and removes it on exit.

The runtime role grants are in `grant-runtime.sql`. Neon Console/CLI-created
roles inherit Neon administrative privileges, so create the restricted login
with SQL as described in `docs/ibm-code-engine-github-actions-plan.md`, then
execute the grants file as the schema owner. The runtime role gets only the
DML operations used by the current stores and no schema creation or
migration-ledger access. Extend the grants deliberately when a new store or
table is added. Never put either connection string in the image or GitHub logs.

`migrations/002_immutable_arrival_evidence.sql` prevents rewrites to original
device provenance and photo identifiers/checksums while allowing staff
confirmation, job linkage and dismissal updates. Four earlier table-creation
migrations are preserved under `docs/archive/2026-11-05/db-migrations/`; they
duplicate the consolidated baseline and are not part of the active chain.

## Validation and remaining cutover

The initial migration has been applied to an isolated local PostgreSQL 17
instance, an ephemeral Neon PostgreSQL 18 validation branch, and the default
Neon `main` branch. Migrations `001_core` and
`002_immutable_arrival_evidence` are applied on `main`. The runtime role was verified to
have no elevated attributes or role memberships; it can perform allowed DML,
cannot read `schema_migrations`, and cannot create tables. The GitHub `ibm-demo`
environment contains `NEON_RUNTIME_CONNECTION_STRING`. The value has not been
read back from GitHub, and it has not been copied into Code Engine or used by
the API. PostgreSQL feature flags remain off.

Before a pilot:

1. Verify every API store on a disposable branch,
   including tenant isolation, concurrent writes, retry deduplication and a
   restore from a backup.
2. Create and store a restricted runtime login separately from the migration
   login. Connect it through the IBM Code Engine generic secret with
   `SSL Mode=VerifyFull` and the pooled Neon endpoint.
3. Rehearse importing any file-backed records, verify row counts/checksums,
   and test sessions and observations across a container replacement.
4. Keep photo bytes and compatibility telemetry on durable storage; the Neon
   schema stores only relational operations records. Rehearse export, checksum
   verification and isolated restore before enabling any retention purge.

The regular integration suite now exercises the PostgreSQL device, arrival,
job, inventory, and staff-session paths against PostgreSQL 18. It verifies
tenant isolation, concurrent retries and stock consumption, plus session
survival across auth-service recreation. Broader store-method coverage, a
read-only file import, Neon restore, and full cutover rehearsal remain. Keep the
PostgreSQL flags off until the full pilot checklist passes. Track migration and
cutover completion in OpenSpec change `complete-platform-parity`, tasks 6.1–6.3.
