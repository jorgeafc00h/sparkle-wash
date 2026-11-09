BEGIN;

CREATE TABLE sparklewash.memberships (
    tenant_id text NOT NULL REFERENCES sparklewash.tenants (id),
    subject text PRIMARY KEY,
    email text,
    name text,
    role text NOT NULL CHECK (role IN ('viewer', 'operator', 'admin')),
    added_at timestamptz NOT NULL,
    added_by text NOT NULL
);
CREATE INDEX memberships_tenant ON sparklewash.memberships (tenant_id);

CREATE TABLE sparklewash.invitations (
    tenant_id text NOT NULL REFERENCES sparklewash.tenants (id),
    id text NOT NULL,
    email text NOT NULL,
    role text NOT NULL CHECK (role IN ('viewer', 'operator', 'admin')),
    invited_at timestamptz NOT NULL,
    invited_by text NOT NULL,
    accepted_at timestamptz,
    accepted_by text,
    PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX invitations_pending_email
    ON sparklewash.invitations (tenant_id, lower(email)) WHERE accepted_at IS NULL;

CREATE TABLE sparklewash.employees (
    tenant_id text NOT NULL REFERENCES sparklewash.tenants (id),
    id text NOT NULL,
    name text NOT NULL,
    active boolean NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (tenant_id, id)
);

CREATE TABLE sparklewash.items (
    tenant_id text NOT NULL REFERENCES sparklewash.tenants (id),
    id text NOT NULL,
    sku text NOT NULL,
    name text NOT NULL,
    unit text NOT NULL,
    reorder_point numeric NOT NULL CHECK (reorder_point >= 0),
    active boolean NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, sku)
);

CREATE TABLE sparklewash.movements (
    tenant_id text NOT NULL,
    id text NOT NULL,
    item_id text NOT NULL,
    type text NOT NULL,
    delta numeric NOT NULL,
    reason text NOT NULL,
    job_id text,
    employee_id text,
    operation_key text NOT NULL,
    at timestamptz NOT NULL,
    actor text NOT NULL,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, operation_key),
    FOREIGN KEY (tenant_id, item_id) REFERENCES sparklewash.items (tenant_id, id),
    FOREIGN KEY (tenant_id, job_id) REFERENCES sparklewash.jobs (tenant_id, id),
    FOREIGN KEY (tenant_id, employee_id) REFERENCES sparklewash.employees (tenant_id, id)
);
CREATE INDEX movements_item_history ON sparklewash.movements (tenant_id, item_id, at, id);

CREATE TABLE sparklewash.reservations (
    tenant_id text NOT NULL,
    id text NOT NULL,
    item_id text NOT NULL,
    job_id text NOT NULL,
    quantity numeric NOT NULL CHECK (quantity > 0),
    remaining numeric NOT NULL CHECK (remaining BETWEEN 0 AND quantity),
    operation_key text NOT NULL,
    at timestamptz NOT NULL,
    actor text NOT NULL,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, operation_key),
    FOREIGN KEY (tenant_id, item_id) REFERENCES sparklewash.items (tenant_id, id),
    FOREIGN KEY (tenant_id, job_id) REFERENCES sparklewash.jobs (tenant_id, id)
);
CREATE INDEX reservations_item ON sparklewash.reservations (tenant_id, item_id) WHERE remaining > 0;

COMMIT;
