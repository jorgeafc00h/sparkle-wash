BEGIN;

-- The opaque bearer token stays with the client. Store only its SHA-256 digest.
CREATE TABLE sparklewash.staff_sessions (
    token_digest text PRIMARY KEY CHECK (token_digest COLLATE "C" ~ '^[0-9A-F]{64}$'),
    tenant_id text NOT NULL REFERENCES sparklewash.tenants (id),
    subject text NOT NULL,
    role text NOT NULL CHECK (role IN ('viewer', 'operator', 'admin')),
    email text,
    name text,
    expires_at timestamptz NOT NULL
);

-- Configured default-tenant staff may have no membership row.
CREATE INDEX staff_sessions_revoke ON sparklewash.staff_sessions (tenant_id, subject);
CREATE INDEX staff_sessions_expiry ON sparklewash.staff_sessions (expires_at);

COMMIT;
