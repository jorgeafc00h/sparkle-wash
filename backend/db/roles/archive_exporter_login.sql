-- One-time setup for a tenant's archive export login. Pass `archive_password`
-- through a protected psql include file; do not put it on the command line.
\set ON_ERROR_STOP on
\if :{?archive_password}
\else
\echo 'Set archive_password in a protected psql include file first.'
\quit 2
\endif

CREATE ROLE sparklewash_archive_login
    LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
    PASSWORD :'archive_password';
GRANT sparklewash_archive_exporter TO sparklewash_archive_login
    WITH INHERIT FALSE, SET TRUE;
