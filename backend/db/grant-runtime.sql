-- Run as the migration/schema owner after creating the restricted runtime role.
-- The API performs no DDL. New migrations must repeat these grants for new tables.
GRANT USAGE ON SCHEMA sparklewash TO sparklewash_runtime;
GRANT SELECT, INSERT, UPDATE ON sparklewash.tenants TO sparklewash_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON sparklewash.memberships, sparklewash.invitations,
    sparklewash.staff_sessions TO sparklewash_runtime;
GRANT SELECT, INSERT, UPDATE ON sparklewash.devices, sparklewash.arrivals, sparklewash.jobs,
    sparklewash.employees, sparklewash.items TO sparklewash_runtime;
GRANT SELECT, INSERT ON sparklewash.movements TO sparklewash_runtime;
GRANT SELECT, INSERT, UPDATE ON sparklewash.reservations TO sparklewash_runtime;
GRANT SELECT ON sparklewash.archive_revisions TO sparklewash_runtime;
