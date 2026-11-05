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

For a non-persisting import rehearsal, point `psql` at a disposable database
after applying the active migrations and run:

```sh
PGHOST=127.0.0.1 PGDATABASE=sparklewash_test PGUSER=postgres \
  python3 backend/db/rehearse_import.py /path/to/snapshot \
  --evidence-file /path/to/import-rehearsal.json
```

The script imports within one transaction and rolls it back. It accepts only
empty target tables, except for the migration's matching seeded `default`
tenant. The evidence file records source-file SHA-256 values, row counts,
source immutability, the post-rollback baseline, and that cutover was not
performed. Never point this rehearsal at Neon `main` or a production database.

After creating an archive with `export_closed_jobs.py`, verify its compressed
checksum, tenant scope, row counts and relational constraints by restoring it
inside a transaction on a separate disposable database:

```sh
PGHOST=127.0.0.1 PGDATABASE=sparklewash_test PGUSER=postgres \
  python3 backend/db/rehearse_archive_restore.py /path/to/archive \
  --evidence-file /path/to/restore-rehearsal.json
```

The restore rehearsal requires empty operational tables and permits only the
matching migration-seeded `default` tenant. It checks the restored counts,
rolls back, and records the archive and manifest digests. This proves the
transactional restore path, not a retained copy in independent object storage.

## IBM Cloud Object Storage publication

`publish_archive_ibm_cos.py` accepts a v3 archive directory, optional evidence
ZIP, private bucket, and bucket region. Authenticate `ibmcloud` and install its
Cloud Object Storage plug-in first. The publisher refuses a bucket without all
four public-access-block flags and a nonzero Object Lock default in COMPLIANCE
or GOVERNANCE mode. The business must approve the retention window and mode
before configuring the bucket; do not confuse this with IBM Archive tier's
90-day minimum storage duration. It writes a digest-addressed ZIP, checks the
object's active retention, downloads the complete object, and verifies its
SHA-256. Re-running the command reuses an existing digest key only after
downloading and matching the bytes.

```sh
python3 backend/db/publish_archive_ibm_cos.py /path/to/archive \
  --bucket YOUR_PRIVATE_ARCHIVE_BUCKET --region us-south \
  --evidence /path/to/evidence.zip
```

The script has only been rehearsed with a local fake IBM CLI. It has not been
run against a real COS bucket. It does not purge Neon records or enforce
row-level legal/financial holds. Run `rehearse_archive_restore.py` on a
disposable PostgreSQL database before treating an uploaded batch as restorable
or enabling any deletion policy. The repository's manual
`.github/workflows/archive-neon-to-ibm-cos.yml` workflow performs this isolated
restore rehearsal before publication; it requires a protected `ibm-archive`
GitHub Environment with a read-only Neon export URI, IBM COS credentials and a
reviewer gate. It does not run automatically and does not delete source rows.

The rehearsal has been smoke-tested against a disposable PostgreSQL 18 database
using a synthetic empty snapshot. It has not yet been run against an actual
file-backed application data directory, so this is tool validation rather than
cutover evidence. The regular integration suite now exercises the PostgreSQL
device, arrival, job, inventory, and staff-session paths against PostgreSQL 18.
It verifies tenant isolation, concurrent retries and stock consumption, plus
session survival across auth-service recreation. Broader store-method
coverage, an actual file-backed import, Neon restore, and full cutover rehearsal
remain. Keep the PostgreSQL flags off until the full pilot checklist passes.
Track migration and cutover completion in OpenSpec change
`complete-platform-parity`, tasks 6.1–6.3.
