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

## Validation and remaining cutover

The initial migration has been applied to an isolated local PostgreSQL 17
instance, an ephemeral Neon PostgreSQL 18 validation branch, and the default
Neon `main` branch. On `main`, the restricted runtime role was verified to
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

The API's PostgreSQL-backed stores are not yet exercised by the regular
integration suite, and only the initial schema migration exists. Keep the
PostgreSQL flags off until the full pilot checklist passes. Track migration and
cutover completion in OpenSpec change `complete-platform-parity`, tasks 6.1–6.3.
