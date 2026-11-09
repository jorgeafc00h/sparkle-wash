BEGIN;

CREATE TABLE sparklewash.devices (
    tenant_id text NOT NULL REFERENCES sparklewash.tenants (id),
    id text NOT NULL,
    name text NOT NULL,
    camera_id text NOT NULL,
    role text NOT NULL CHECK (role IN ('entry', 'bay', 'exit')),
    key_hash text NOT NULL CHECK (key_hash COLLATE "C" ~ '^[0-9A-Fa-f]{64}$'),
    key_hint text NOT NULL,
    created_at timestamptz NOT NULL,
    created_by text NOT NULL,
    disabled boolean NOT NULL,
    last_seen_at timestamptz,
    last_status jsonb CHECK (last_status IS NULL OR jsonb_typeof(last_status) = 'object'),
    observations integer NOT NULL CHECK (observations >= 0),
    key_rotated_at timestamptz,
    PRIMARY KEY (tenant_id, id)
);

CREATE UNIQUE INDEX devices_active_camera
    ON sparklewash.devices (tenant_id, camera_id) WHERE NOT disabled;

COMMIT;
