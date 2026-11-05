-- A tenant-scoped revision counter lets archive readers invalidate a paged
-- snapshot when a completed job enters, leaves, or changes its displayed data.
CREATE TABLE IF NOT EXISTS sparklewash.archive_revisions (
    tenant_id text PRIMARY KEY REFERENCES sparklewash.tenants(id) ON DELETE CASCADE,
    revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0)
);

INSERT INTO sparklewash.archive_revisions (tenant_id, revision)
SELECT id, 1 FROM sparklewash.tenants
ON CONFLICT (tenant_id) DO NOTHING;

CREATE OR REPLACE FUNCTION sparklewash.bump_archive_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, sparklewash
AS $$
DECLARE
    affected_tenant text;
    relevant_change boolean := false;
BEGIN
    IF TG_OP = 'INSERT' THEN
        affected_tenant := NEW.tenant_id;
        relevant_change := NEW.status = 'completed' AND NEW.completed_at IS NOT NULL;
    ELSIF TG_OP = 'DELETE' THEN
        affected_tenant := OLD.tenant_id;
        relevant_change := OLD.status = 'completed' AND OLD.completed_at IS NOT NULL;
    ELSE
        IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
            IF OLD.status = 'completed' AND OLD.completed_at IS NOT NULL THEN
                INSERT INTO sparklewash.archive_revisions (tenant_id, revision)
                VALUES (OLD.tenant_id, 1)
                ON CONFLICT (tenant_id) DO UPDATE
                    SET revision = sparklewash.archive_revisions.revision + 1;
            END IF;
            IF NEW.status = 'completed' AND NEW.completed_at IS NOT NULL THEN
                INSERT INTO sparklewash.archive_revisions (tenant_id, revision)
                VALUES (NEW.tenant_id, 1)
                ON CONFLICT (tenant_id) DO UPDATE
                    SET revision = sparklewash.archive_revisions.revision + 1;
            END IF;
            RETURN NEW;
        END IF;
        affected_tenant := NEW.tenant_id;
        relevant_change :=
            (OLD.status = 'completed' AND OLD.completed_at IS NOT NULL)
            IS DISTINCT FROM
            (NEW.status = 'completed' AND NEW.completed_at IS NOT NULL)
            OR (NEW.status = 'completed' AND NEW.completed_at IS NOT NULL AND
                (OLD.plate, OLD.package_name, OLD.completed_at) IS DISTINCT FROM
                (NEW.plate, NEW.package_name, NEW.completed_at));
    END IF;

    IF relevant_change THEN
        INSERT INTO sparklewash.archive_revisions (tenant_id, revision)
        VALUES (affected_tenant, 1)
        ON CONFLICT (tenant_id) DO UPDATE
            SET revision = sparklewash.archive_revisions.revision + 1;
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION sparklewash.bump_archive_revision() FROM PUBLIC;

DROP TRIGGER IF EXISTS jobs_archive_revision_insert_delete ON sparklewash.jobs;
CREATE TRIGGER jobs_archive_revision_insert_delete
AFTER INSERT OR DELETE ON sparklewash.jobs
FOR EACH ROW EXECUTE FUNCTION sparklewash.bump_archive_revision();

DROP TRIGGER IF EXISTS jobs_archive_revision_update ON sparklewash.jobs;
CREATE TRIGGER jobs_archive_revision_update
AFTER UPDATE OF tenant_id, status, completed_at, plate, package_name ON sparklewash.jobs
FOR EACH ROW EXECUTE FUNCTION sparklewash.bump_archive_revision();

CREATE INDEX IF NOT EXISTS jobs_tenant_completed_history
    ON sparklewash.jobs (tenant_id, completed_at, id)
    WHERE status = 'completed' AND completed_at IS NOT NULL;

INSERT INTO sparklewash.schema_migrations (version)
VALUES ('003_archive_revisions')
ON CONFLICT (version) DO NOTHING;
