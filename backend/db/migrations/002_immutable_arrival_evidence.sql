-- Arrival provenance and evidence references describe the original device event.
-- Staff confirmation, job linkage and dismissal are intentionally mutable.
BEGIN;

CREATE OR REPLACE FUNCTION sparklewash.reject_arrival_evidence_rewrite()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF ROW(
        NEW.tenant_id, NEW.id, NEW.device_event_id, NEW.camera_id,
        NEW.plate_candidate, NEW.confidence, NEW.captured_at, NEW.received_at,
        NEW.photo_id, NEW.evidence_digest, NEW.camera_role
    ) IS DISTINCT FROM ROW(
        OLD.tenant_id, OLD.id, OLD.device_event_id, OLD.camera_id,
        OLD.plate_candidate, OLD.confidence, OLD.captured_at, OLD.received_at,
        OLD.photo_id, OLD.evidence_digest, OLD.camera_role
    ) THEN
        RAISE EXCEPTION 'Arrival evidence provenance is immutable.'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS arrivals_provenance_immutable ON sparklewash.arrivals;
CREATE TRIGGER arrivals_provenance_immutable
    BEFORE UPDATE ON sparklewash.arrivals
    FOR EACH ROW
    EXECUTE FUNCTION sparklewash.reject_arrival_evidence_rewrite();

INSERT INTO sparklewash.schema_migrations (version)
VALUES ('002_immutable_arrival_evidence')
ON CONFLICT (version) DO NOTHING;

COMMIT;
