-- Bootstrap the SQL schema expected by the API's optional PostgreSQL stores.
-- Apply via scripts/db-migrate.sh as a database owner/migration role.
CREATE SCHEMA IF NOT EXISTS sparklewash;

CREATE TABLE IF NOT EXISTS sparklewash.schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sparklewash.tenants (
    id text PRIMARY KEY,
    name text NOT NULL,
    city text,
    country text NOT NULL,
    phone text,
    time_zone text NOT NULL,
    created_at timestamptz NOT NULL,
    owner_subject text
);

-- Mirrors TenantDirectory's legacy default tenant so existing single-site
-- operations continue to work when the PostgreSQL directory is selected.
INSERT INTO sparklewash.tenants (id, name, country, time_zone, created_at)
VALUES ('default', 'SparkleWash', 'SV', 'America/El_Salvador', '1970-01-01T00:00:00Z')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS sparklewash.memberships (
    tenant_id text NOT NULL REFERENCES sparklewash.tenants(id),
    subject text NOT NULL,
    email text,
    name text,
    role text NOT NULL,
    added_at timestamptz NOT NULL,
    added_by text NOT NULL,
    PRIMARY KEY (tenant_id, subject),
    UNIQUE (subject)
);

CREATE TABLE IF NOT EXISTS sparklewash.invitations (
    tenant_id text NOT NULL REFERENCES sparklewash.tenants(id),
    id text NOT NULL,
    email text NOT NULL,
    role text NOT NULL,
    invited_at timestamptz NOT NULL,
    invited_by text NOT NULL,
    accepted_at timestamptz,
    accepted_by text,
    PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS invitations_one_pending_email
    ON sparklewash.invitations (tenant_id, lower(email)) WHERE accepted_at IS NULL;

CREATE TABLE IF NOT EXISTS sparklewash.staff_sessions (
    token_digest text PRIMARY KEY,
    tenant_id text NOT NULL REFERENCES sparklewash.tenants(id),
    subject text NOT NULL,
    role text NOT NULL,
    email text,
    name text,
    expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS staff_sessions_expiry ON sparklewash.staff_sessions (expires_at);
CREATE INDEX IF NOT EXISTS staff_sessions_tenant_subject ON sparklewash.staff_sessions (tenant_id, subject);

CREATE TABLE IF NOT EXISTS sparklewash.devices (
    tenant_id text NOT NULL REFERENCES sparklewash.tenants(id),
    id text NOT NULL,
    name text NOT NULL,
    camera_id text NOT NULL,
    role text NOT NULL,
    key_hash text NOT NULL,
    key_hint text NOT NULL,
    created_at timestamptz NOT NULL,
    created_by text NOT NULL,
    disabled boolean NOT NULL DEFAULT false,
    last_seen_at timestamptz,
    last_status jsonb,
    observations integer NOT NULL DEFAULT 0,
    key_rotated_at timestamptz,
    PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS devices_one_active_camera
    ON sparklewash.devices (tenant_id, camera_id) WHERE NOT disabled;

CREATE TABLE IF NOT EXISTS sparklewash.arrivals (
    tenant_id text NOT NULL REFERENCES sparklewash.tenants(id),
    id text NOT NULL,
    device_event_id text NOT NULL,
    camera_id text NOT NULL,
    plate_candidate text,
    confidence double precision,
    captured_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL,
    photo_id text,
    evidence_digest text NOT NULL,
    confirmed_plate text,
    vehicle_class text,
    confirmed_by text,
    confirmed_at timestamptz,
    job_id text,
    camera_role text,
    dismissed_at timestamptz,
    dismissed_by text,
    dismiss_reason text,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, camera_id, device_event_id)
);
CREATE INDEX IF NOT EXISTS arrivals_tenant_received ON sparklewash.arrivals (tenant_id, received_at, id);

CREATE TABLE IF NOT EXISTS sparklewash.jobs (
    tenant_id text NOT NULL REFERENCES sparklewash.tenants(id),
    id text NOT NULL,
    arrival_id text NOT NULL,
    plate text NOT NULL,
    vehicle_class text NOT NULL,
    package_id text NOT NULL,
    package_name text NOT NULL,
    services text[] NOT NULL,
    price_usd numeric(12,2) NOT NULL,
    currency text NOT NULL,
    status text NOT NULL,
    arrival_at timestamptz NOT NULL,
    started_at timestamptz,
    completed_at timestamptz,
    cancelled_at timestamptz,
    transitions jsonb NOT NULL,
    assignments jsonb NOT NULL,
    PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS jobs_tenant_arrival ON sparklewash.jobs (tenant_id, arrival_at, id);
CREATE INDEX IF NOT EXISTS jobs_tenant_plate ON sparklewash.jobs (tenant_id, plate);

CREATE TABLE IF NOT EXISTS sparklewash.employees (
    tenant_id text NOT NULL REFERENCES sparklewash.tenants(id),
    id text NOT NULL,
    name text NOT NULL,
    active boolean NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS sparklewash.items (
    tenant_id text NOT NULL REFERENCES sparklewash.tenants(id),
    id text NOT NULL,
    sku text NOT NULL,
    name text NOT NULL,
    unit text NOT NULL,
    reorder_point numeric(12,3) NOT NULL,
    active boolean NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, sku)
);

CREATE TABLE IF NOT EXISTS sparklewash.movements (
    tenant_id text NOT NULL REFERENCES sparklewash.tenants(id),
    id text NOT NULL,
    item_id text NOT NULL,
    type text NOT NULL,
    delta numeric(12,3) NOT NULL,
    reason text NOT NULL,
    job_id text,
    employee_id text,
    operation_key text NOT NULL,
    at timestamptz NOT NULL,
    actor text NOT NULL,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, operation_key)
);
CREATE INDEX IF NOT EXISTS movements_tenant_item_at ON sparklewash.movements (tenant_id, item_id, at DESC);
CREATE INDEX IF NOT EXISTS movements_tenant_job ON sparklewash.movements (tenant_id, job_id);

CREATE TABLE IF NOT EXISTS sparklewash.reservations (
    tenant_id text NOT NULL REFERENCES sparklewash.tenants(id),
    id text NOT NULL,
    item_id text NOT NULL,
    job_id text NOT NULL,
    quantity numeric(12,3) NOT NULL,
    remaining numeric(12,3) NOT NULL,
    operation_key text NOT NULL,
    at timestamptz NOT NULL,
    actor text NOT NULL,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, operation_key)
);
CREATE INDEX IF NOT EXISTS reservations_tenant_item_at ON sparklewash.reservations (tenant_id, item_id, at);
CREATE INDEX IF NOT EXISTS reservations_tenant_job ON sparklewash.reservations (tenant_id, job_id);

INSERT INTO sparklewash.schema_migrations (version)
VALUES ('001_core')
ON CONFLICT (version) DO NOTHING;
