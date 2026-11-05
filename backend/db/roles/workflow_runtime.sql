-- Additional grants for PostgreSQL arrivals and jobs, after directory_runtime.sql.
\set ON_ERROR_STOP on
BEGIN;
GRANT SELECT, INSERT, UPDATE ON sparklewash.arrivals, sparklewash.jobs TO :"runtime_role";
COMMIT;
