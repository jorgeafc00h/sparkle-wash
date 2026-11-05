-- Apply once as the schema owner after reviewing the archive access policy.
-- A separate LOGIN role must be created and granted membership in this role;
-- the workflow connects with PGOPTIONS=-c role=sparklewash_archive_exporter.
DO $archive_role$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sparklewash_archive_exporter') THEN
        CREATE ROLE sparklewash_archive_exporter
            NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
END
$archive_role$;

ALTER ROLE sparklewash_archive_exporter
    NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA sparklewash TO sparklewash_archive_exporter;
GRANT SELECT ON TABLE
    sparklewash.tenants,
    sparklewash.arrivals,
    sparklewash.jobs,
    sparklewash.employees,
    sparklewash.items,
    sparklewash.movements,
    sparklewash.reservations
TO sparklewash_archive_exporter;
