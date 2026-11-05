#!/usr/bin/env python3
"""Verify a version 3 archive by restoring it into empty PostgreSQL tables and rolling back."""
import argparse
import base64
from datetime import date
import gzip
import hashlib
import json
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--evidence-file", type=Path,
                        help="Write a JSON record of this isolated restore rehearsal")
    args = parser.parse_args()
    manifest = json.loads((args.archive / "manifest.json").read_bytes())
    filename = "job-history.json.gz"
    if (manifest.get("version"), manifest.get("dataset"), manifest.get("file")) != (3, "completed-jobs", filename):
        parser.error("Unsupported archive format")
    compressed = (args.archive / filename).read_bytes()
    if hashlib.sha256(compressed).hexdigest() != manifest["sha256"]:
        parser.error("Archive checksum mismatch")
    data = gzip.decompress(compressed)
    batch = json.loads(data)
    tenant = manifest["tenantId"]
    cutoff = date.fromisoformat(manifest["completedBeforeUtc"])
    start_text = manifest.get("completedOnOrAfterUtc")
    start = date.fromisoformat(start_text) if start_text is not None else None
    if start is not None and start >= cutoff:
        parser.error("Invalid archive date range")
    lower_bound = f"OR completed_at < TIMESTAMPTZ '{start} 00:00:00+00'" if start is not None else ""
    tables = ("tenants", "arrivals", "jobs", "employees", "items", "movements", "reservations")
    if (set(batch) != set(tables) or len(batch["tenants"]) != 1 or batch["tenants"][0]["id"] != tenant
            or {table: len(batch[table]) for table in tables} != manifest["rowCounts"]
            or any(row["tenant_id"] != tenant for table in tables[1:] for row in batch[table])):
        parser.error("Archive counts or tenant scope do not match the manifest")

    payload = base64.b64encode(data).decode("ascii")
    locked_tables = ", ".join(f"sparklewash.{table}" for table in tables)
    sql = [
        "BEGIN;",
        "SET LOCAL TIME ZONE 'UTC';",
        f"LOCK TABLE {locked_tables} IN EXCLUSIVE MODE;",
        f"CREATE TEMP TABLE archive_batch AS SELECT convert_from(decode('{payload}', 'base64'), 'UTF8')::jsonb AS data;",
    ]
    for table in tables:
        if table == "tenants":
            sql.append(f"""
DO $$ DECLARE existing_count integer; BEGIN
    SELECT count(*) INTO existing_count FROM sparklewash.tenants;
    IF existing_count > 1 OR EXISTS (
        SELECT 1 FROM sparklewash.tenants WHERE id <> 'default'
    ) THEN
        RAISE EXCEPTION 'Restore requires an empty tenant table except for the baseline default tenant';
    END IF;
    IF EXISTS (
        SELECT 1 FROM sparklewash.tenants target
        CROSS JOIN archive_batch
        CROSS JOIN LATERAL jsonb_populate_recordset(NULL::sparklewash.tenants, data -> 'tenants') source
        WHERE target.id = 'default' AND source.id = 'default'
          AND target IS DISTINCT FROM source
    ) THEN
        RAISE EXCEPTION 'Baseline default tenant does not match the archive';
    END IF;
END $$;
""")
        else:
            sql.append(f"""
DO $$ BEGIN
    IF EXISTS (SELECT FROM sparklewash.{table}) THEN
        RAISE EXCEPTION 'Restore rehearsal requires empty tables';
    END IF;
END $$;
""")
        conflict = " ON CONFLICT (id) DO NOTHING" if table == "tenants" else ""
        sql.append(f"""
INSERT INTO sparklewash.{table}
SELECT restored.* FROM archive_batch,
    jsonb_populate_recordset(NULL::sparklewash.{table}, data -> '{table}') restored{conflict};
""")
    sql.append(f"""
SET CONSTRAINTS ALL IMMEDIATE;
DO $$ BEGIN
    IF EXISTS (
        SELECT FROM sparklewash.jobs WHERE status <> 'completed'
          OR completed_at IS NULL OR completed_at >= TIMESTAMPTZ '{cutoff} 00:00:00+00'
          {lower_bound}
    ) THEN
        RAISE EXCEPTION 'Archive contains ineligible jobs';
    END IF;
END $$;
""")
    sql.extend(f"SELECT count(*) FROM sparklewash.{table};" for table in tables)
    sql.append("ROLLBACK;")
    sql.extend(f"SELECT count(*) FROM sparklewash.{table};" for table in tables)
    result = subprocess.run(
        ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=terse"],
        input="\n".join(sql), text=True, stdout=subprocess.PIPE, check=True,
    )
    lines = result.stdout.splitlines()
    if lines[:len(tables)] != [str(len(batch[table])) for table in tables]:
        raise RuntimeError("Restored row counts did not match the archive")
    rollback_counts = lines[len(tables):]
    if rollback_counts != ["1"] + ["0"] * (len(tables) - 1):
        raise RuntimeError("Restore rollback did not restore the migration baseline")
    print("Verified restore and rolled back: " + ", ".join(f"{len(batch[table])} {table}" for table in tables))
    if args.evidence_file:
        evidence = {
            "formatVersion": 1,
            "mode": "isolated-restore-rollback",
            "tenantId": tenant,
            "archiveSha256": hashlib.sha256(compressed).hexdigest(),
            "manifestSha256": hashlib.sha256((args.archive / "manifest.json").read_bytes()).hexdigest(),
            "tables": {
                table: {"archiveRows": len(batch[table]), "rowsAfterRollback": int(after)}
                for table, after in zip(tables, rollback_counts)
            },
            "restore": {"constraintsValidated": True, "performedAsTransaction": True},
            "rollback": {"performed": True, "baselineDefaultTenantPreserved": True},
        }
        args.evidence_file.parent.mkdir(parents=True, exist_ok=True)
        args.evidence_file.write_text(json.dumps(evidence, indent=2) + "\n")
        print(f"Evidence: {args.evidence_file}")


if __name__ == "__main__":
    main()
