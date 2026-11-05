-- Additional grants after workflow_runtime.sql.
\set ON_ERROR_STOP on
BEGIN;
GRANT SELECT, INSERT, UPDATE ON sparklewash.employees, sparklewash.reservations TO :"runtime_role";
GRANT SELECT, INSERT ON sparklewash.items, sparklewash.movements TO :"runtime_role";
COMMIT;
