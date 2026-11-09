-- Additional grants for PostgreSQL devices, after directory_runtime.sql.
\set ON_ERROR_STOP on
BEGIN;
GRANT SELECT, INSERT, UPDATE ON sparklewash.devices TO :"runtime_role";
COMMIT;
