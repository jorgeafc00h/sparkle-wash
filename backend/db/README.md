# PostgreSQL cutover status

The API contains optional PostgreSQL stores, but the database cutover is not
ready for a fresh Neon project. Runtime queries expect a pre-provisioned
`sparklewash` schema. There are currently no versioned schema migrations,
bootstrap SQL, or least-privilege runtime grants in this repository. The Neon
`sparklewash` project currently has an empty `main` branch and is not connected
to the API.

Do not enable `SPARKLEWASH_POSTGRES_DIRECTORY`,
`SPARKLEWASH_POSTGRES_DEVICES`, `SPARKLEWASH_POSTGRES_WORKFLOW`, or
`SPARKLEWASH_POSTGRES_INVENTORY` against a fresh database until migrations and
grants have been implemented and verified. Enabling those flags alone does not
create the schema.

## Required cutover work

1. Add ordered, versioned migrations for every table referenced by the API's
   PostgreSQL stores: tenant directory and invitations, staff sessions, devices,
   arrivals, jobs, employees, inventory items, movements, and reservations.
2. Apply migrations using a separate migration role. Grant the runtime role only
   the required schema usage, table reads/writes, and sequence privileges.
3. Run migrations against an isolated Neon branch. Verify a clean install,
   supported upgrade path, tenant isolation, concurrent writes, retry
   deduplication, and rollback behavior.
4. Connect the API using the pooled Neon endpoint and `SSL Mode=VerifyFull` from
   a Code Engine generic secret. Test session continuity and data survival
   across a container replacement before routing demo users.
5. Keep photos and compatibility telemetry on durable object/file storage.
   Rehearse encrypted archive export, checksum verification, and isolated
   restore before enabling retention purges.

Track implementation in OpenSpec change `complete-platform-parity`, task 6.1.
The demo deployment must keep the PostgreSQL flags off until this work passes.
