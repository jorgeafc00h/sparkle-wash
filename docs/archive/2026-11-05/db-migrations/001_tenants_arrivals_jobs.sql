BEGIN;

CREATE SCHEMA sparklewash;

CREATE TABLE sparklewash.tenants (
    id text PRIMARY KEY,
    name text NOT NULL,
    city text,
    country text NOT NULL,
    phone text,
    time_zone text NOT NULL,
    created_at timestamptz NOT NULL,
    owner_subject text
);

CREATE TABLE sparklewash.arrivals (
    tenant_id text NOT NULL REFERENCES sparklewash.tenants (id),
    id text NOT NULL,
    camera_id text NOT NULL,
    device_event_id text NOT NULL,
    plate_candidate text,
    confidence double precision CHECK (confidence BETWEEN 0 AND 1),
    captured_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL,
    photo_id text,
    evidence_digest text NOT NULL,
    confirmed_plate text,
    vehicle_class text,
    confirmed_by text,
    confirmed_at timestamptz,
    camera_role text,
    job_id text,
    dismissed_at timestamptz,
    dismissed_by text,
    dismiss_reason text,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, camera_id, device_event_id)
);

CREATE INDEX arrivals_recent
    ON sparklewash.arrivals (tenant_id, received_at DESC, id);

CREATE TABLE sparklewash.jobs (
    tenant_id text NOT NULL,
    id text NOT NULL,
    arrival_id text NOT NULL,
    plate text NOT NULL CHECK (plate COLLATE "C" ~ '^[A-Z0-9]{3,12}$'),
    vehicle_class text NOT NULL,
    package_id text NOT NULL,
    package_name text NOT NULL,
    services text[] NOT NULL,
    price_usd numeric NOT NULL CHECK (price_usd >= 0),
    currency text NOT NULL,
    status text NOT NULL CHECK (status IN ('arrived', 'queued', 'in_progress', 'completed', 'cancelled')),
    arrival_at timestamptz NOT NULL,
    started_at timestamptz,
    completed_at timestamptz,
    cancelled_at timestamptz,
    transitions jsonb NOT NULL CHECK (jsonb_typeof(transitions) = 'array'),
    assignments jsonb NOT NULL CHECK (jsonb_typeof(assignments) = 'array'),
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, arrival_id),
    FOREIGN KEY (tenant_id, arrival_id) REFERENCES sparklewash.arrivals (tenant_id, id)
);

-- Exit and bay observations can link to the same job as the entry observation.
ALTER TABLE sparklewash.arrivals ADD CONSTRAINT arrivals_job
    FOREIGN KEY (tenant_id, job_id) REFERENCES sparklewash.jobs (tenant_id, id)
    DEFERRABLE INITIALLY DEFERRED;

-- The write path supplies the same normalized plate used by ArrivalStore.
CREATE UNIQUE INDEX jobs_one_open_per_plate
    ON sparklewash.jobs (tenant_id, plate)
    WHERE status IN ('arrived', 'queued', 'in_progress');

CREATE INDEX jobs_completed_history
    ON sparklewash.jobs (tenant_id, completed_at DESC, id)
    WHERE status = 'completed';

COMMIT;
