-- Additional grants for the optional PostgreSQL directory, after session_runtime.sql.
\set ON_ERROR_STOP on
BEGIN;
GRANT SELECT, INSERT, UPDATE ON sparklewash.tenants TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON sparklewash.memberships, sparklewash.invitations TO :"runtime_role";
COMMIT;
