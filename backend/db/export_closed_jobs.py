#!/usr/bin/env python3
"""Export completed jobs and their operational dependencies."""
import argparse
from datetime import date
import gzip
import hashlib
import json
from pathlib import Path
import re
import subprocess

from archive_limits import COMPRESSED_LIMIT, EXPANDED_LIMIT


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tenant")
    parser.add_argument("before", type=date.fromisoformat, help="Exclusive UTC cutoff, YYYY-MM-DD")
    parser.add_argument("--on-or-after", type=date.fromisoformat, help="Inclusive UTC start, YYYY-MM-DD")
    parser.add_argument("output", type=Path, help="New output directory")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9]+", args.tenant):
        parser.error("Invalid tenant ID")
    if args.on_or_after is not None and args.on_or_after >= args.before:
        parser.error("The start date must precede the cutoff")
    if args.output.exists():
        parser.error("Output directory already exists")

    query = """
BEGIN READ ONLY;
WITH selected_jobs AS (
    SELECT * FROM sparklewash.jobs
    WHERE tenant_id = :'tenant' AND status = 'completed'
      AND completed_at < (:'cutoff'::date::timestamp AT TIME ZONE 'UTC')
      AND completed_at >= COALESCE(
          NULLIF(:'start', '')::date::timestamp AT TIME ZONE 'UTC', '-infinity'::timestamptz)
), selected_arrivals AS (
    SELECT a.* FROM sparklewash.arrivals a
    WHERE a.tenant_id = :'tenant'
      AND EXISTS (SELECT FROM selected_jobs j WHERE a.id = j.arrival_id OR a.job_id = j.id)
), selected_movements AS (
    SELECT m.* FROM sparklewash.movements m JOIN selected_jobs j
      ON (m.tenant_id, m.job_id) = (j.tenant_id, j.id)
), selected_reservations AS (
    SELECT r.* FROM sparklewash.reservations r JOIN selected_jobs j
      ON (r.tenant_id, r.job_id) = (j.tenant_id, j.id)
), selected_items AS (
    SELECT i.* FROM sparklewash.items i WHERE i.tenant_id = :'tenant'
      AND i.id IN (SELECT item_id FROM selected_movements UNION SELECT item_id FROM selected_reservations)
), selected_employees AS (
    SELECT e.* FROM sparklewash.employees e WHERE e.tenant_id = :'tenant'
      AND e.id IN (
          SELECT employee_id FROM selected_movements
          UNION
          SELECT assignment ->> 'employeeId'
          FROM selected_jobs CROSS JOIN LATERAL jsonb_array_elements(assignments) AS assignment
      )
)
SELECT jsonb_build_object(
    'tenants', (SELECT jsonb_agg(t) FROM sparklewash.tenants t WHERE t.id = :'tenant'),
    'arrivals', COALESCE((SELECT jsonb_agg(a ORDER BY a.id) FROM selected_arrivals a), '[]'::jsonb),
    'jobs', COALESCE((SELECT jsonb_agg(j ORDER BY j.completed_at, j.id) FROM selected_jobs j), '[]'::jsonb),
    'employees', COALESCE((SELECT jsonb_agg(e ORDER BY e.id) FROM selected_employees e), '[]'::jsonb),
    'items', COALESCE((SELECT jsonb_agg(i ORDER BY i.id) FROM selected_items i), '[]'::jsonb),
    'movements', COALESCE((SELECT jsonb_agg(m ORDER BY m.id) FROM selected_movements m), '[]'::jsonb),
    'reservations', COALESCE((SELECT jsonb_agg(r ORDER BY r.id) FROM selected_reservations r), '[]'::jsonb)
);
COMMIT;
"""
    # -X disables local psql startup scripts. Values are quoted by psql.
    result = subprocess.run(
        ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
         "-v", f"tenant={args.tenant}", "-v", f"cutoff={args.before}",
         "-v", f"start={args.on_or_after or ''}"],
        input=query.encode(), stdout=subprocess.PIPE, check=True,
    )
    if len(result.stdout) > EXPANDED_LIMIT:
        parser.error("Expanded archive exceeds the staff API limit. Choose a shorter date range.")
    batch = json.loads(result.stdout)
    if batch["tenants"] is None:
        parser.error("Tenant does not exist")
    compressed = gzip.compress(result.stdout, mtime=0)
    if len(compressed) > COMPRESSED_LIMIT:
        parser.error("Compressed archive exceeds the staff API limit. Choose a shorter date range.")
    manifest = {
        "version": 3,
        "tenantId": args.tenant,
        "completedBeforeUtc": str(args.before),
        "dataset": "completed-jobs",
        "rowCounts": {table: len(rows) for table, rows in batch.items()},
        "file": "job-history.json.gz",
        "sha256": hashlib.sha256(compressed).hexdigest(),
    }
    if args.on_or_after is not None:
        manifest["completedOnOrAfterUtc"] = str(args.on_or_after)
    args.output.mkdir(mode=0o700)
    (args.output / manifest["file"]).write_bytes(compressed)
    # A missing manifest indicates an incomplete export.
    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Exported {manifest['rowCounts']['jobs']} completed jobs")


if __name__ == "__main__":
    main()
