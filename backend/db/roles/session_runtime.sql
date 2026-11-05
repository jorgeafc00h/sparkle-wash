-- Apply as the schema owner with psql -v runtime_role=EXISTING_LOGIN_ROLE.
\set ON_ERROR_STOP on
BEGIN;

GRANT USAGE ON SCHEMA sparklewash TO :"runtime_role";
GRANT SELECT, INSERT, DELETE ON TABLE sparklewash.staff_sessions TO :"runtime_role";

COMMIT;
