-- Desktop point-of-sale fields on jobs: provenance, work-ticket number, customer details and payments.
-- All nullable so jobs written before the desktop POS keep working; payments is a jsonb array.
ALTER TABLE sparklewash.jobs
    ADD COLUMN IF NOT EXISTS source text,
    ADD COLUMN IF NOT EXISTS ticket_number text,
    ADD COLUMN IF NOT EXISTS customer_name text,
    ADD COLUMN IF NOT EXISTS note text,
    ADD COLUMN IF NOT EXISTS payments jsonb DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS paid_at timestamptz;

UPDATE sparklewash.jobs SET payments = '[]'::jsonb WHERE payments IS NULL;

INSERT INTO sparklewash.schema_migrations (version)
VALUES ('004_desktop_pos_job_fields')
ON CONFLICT (version) DO NOTHING;
