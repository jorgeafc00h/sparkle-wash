#!/usr/bin/env python3
"""Rehearse the PostgreSQL import using a copy of the API data directory."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import subprocess


SOURCE_CHECKSUMS = {}


def sha256_file(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_json(path, default):
    if not path.exists():
        SOURCE_CHECKSUMS[str(path)] = {"exists": False, "sha256": None}
        return default
    data = path.read_bytes()
    checksum = hashlib.sha256(data).hexdigest()
    SOURCE_CHECKSUMS[str(path)] = {"exists": True, "sha256": checksum}
    print(f"SHA256 {checksum}  {path.name}", flush=True)
    return json.loads(data, parse_float=str)


def rows(value):
    if not isinstance(value, list) or not all(isinstance(row, dict) for row in value):
        raise ValueError("Expected a JSON array of records")
    return value


def sql_row(record, **extra):
    return {
        **{re.sub(r"(?<!^)(?=[A-Z])", "_", key).lower(): value for key, value in record.items()},
        **extra,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("--site-name", default="SparkleWash")
    parser.add_argument("--time-zone", default="America/El_Salvador")
    parser.add_argument("--evidence-file", type=Path,
                        help="Write a JSON rehearsal record (dry runs only)")
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--commit-directory-and-devices", action="store_true",
                        help="Commit only tenant, staff and device rows to an empty target")
    modes.add_argument("--commit-workflow", action="store_true",
                       help="Commit arrivals and jobs after directory cutover")
    modes.add_argument("--commit-inventory", action="store_true",
                       help="Commit employees, items, movements and reservations after workflow cutover")
    args = parser.parse_args()
    if not args.snapshot.is_dir():
        parser.error("Snapshot directory does not exist")

    tenant_root = args.snapshot / "tenants"
    directory = read_json(tenant_root / "directory.json", {"tenants": []})
    tenants = rows(directory["tenants"])
    if not any(tenant["id"] == "default" for tenant in tenants):
        tenants.append({
            "id": "default", "name": args.site_name, "country": "SV",
            "timeZone": args.time_zone, "createdAt": "1970-01-01T00:00:00Z",
        })

    commit_directory = args.commit_directory_and_devices
    commit_workflow = args.commit_workflow
    commit_inventory = args.commit_inventory
    commit = commit_directory or commit_workflow or commit_inventory
    if args.evidence_file and commit:
        parser.error("Evidence files are only supported for rollback rehearsals")
    tables = {"tenants": [sql_row(tenant) for tenant in tenants]}
    if not (commit_directory or commit_inventory):
        tables.update(arrivals=[], jobs=[])
    tables["devices"] = []
    for table in ("memberships", "invitations"):
        tables[table] = [sql_row(row) for row in rows(directory.get(table, []))]
    operation_tables = ("employees", "items", "movements", "reservations")
    if not commit or commit_inventory:
        tables.update({table: [] for table in operation_tables})
    for tenant in tenants:
        tenant_id = tenant["id"]
        if not isinstance(tenant_id, str) or not re.fullmatch(r"[A-Za-z0-9]+", tenant_id):
            raise ValueError("Invalid tenant ID in snapshot")
        folder = args.snapshot if tenant_id == "default" else tenant_root / tenant_id
        if not (commit_directory or commit_inventory):
            for table in ("arrivals", "jobs"):
                tables[table].extend(sql_row(row, tenant_id=tenant_id) for row in rows(read_json(folder / f"{table}.json", [])))

        if not (commit_workflow or commit_inventory):
            # FPS is a floating-point measurement nested inside the JSON status.
            for device in rows(read_json(folder / "devices.json", [])):
                status = device.get("lastStatus")
                if status is not None and status.get("fps") is not None:
                    status["fps"] = float(status["fps"])
                tables["devices"].append(sql_row(device, tenant_id=tenant_id))

        if not commit or commit_inventory:
            operations = read_json(folder / "operations.json", {table: [] for table in operation_tables})
            for table in operation_tables:
                tables[table].extend(sql_row(row, tenant_id=tenant_id) for row in rows(operations[table]))

    if commit_workflow:
        tables = {table: tables[table] for table in ("arrivals", "jobs")}

    if commit_inventory:
        tables = {table: tables[table] for table in operation_tables}

    locked_tables = ", ".join(f"sparklewash.{table}" for table in tables)
    sql = ["BEGIN;", f"LOCK TABLE {locked_tables} IN EXCLUSIVE MODE;"]
    for table, records in tables.items():
        payload = base64.b64encode(json.dumps(records, ensure_ascii=False).encode()).decode("ascii")
        if table == "tenants" and any(record.get("id") == "default" for record in records):
            # 001_core.sql seeds this exact legacy tenant. Permit it only when it
            # matches the snapshot row; every other target table must be empty.
            sql.append(f"""
DO $$ DECLARE existing_count integer; BEGIN
    SELECT count(*) INTO existing_count FROM sparklewash.tenants;
    IF existing_count > 1 OR EXISTS (
        SELECT 1 FROM sparklewash.tenants target
        WHERE target.id <> 'default'
    ) THEN
        RAISE EXCEPTION 'Import requires an empty tenant target except for the baseline default tenant';
    END IF;
    IF EXISTS (
        SELECT 1 FROM sparklewash.tenants target
        CROSS JOIN LATERAL jsonb_populate_recordset(NULL::sparklewash.tenants,
            convert_from(decode('{payload}', 'base64'), 'UTF8')::jsonb) source
        WHERE target.id = 'default' AND source.id = 'default'
          AND target IS DISTINCT FROM source
    ) THEN
        RAISE EXCEPTION 'Baseline default tenant does not match the source snapshot';
    END IF;
END $$;
""")
        else:
            sql.append(f"""
DO $$ BEGIN
    IF EXISTS (SELECT FROM sparklewash.{table}) THEN
        RAISE EXCEPTION 'Import requires empty target tables';
    END IF;
END $$;
""")
        # Base64 keeps arbitrary snapshot data out of the SQL syntax.
        conflict = " ON CONFLICT (id) DO NOTHING" if table == "tenants" else ""
        sql.append(f"""
INSERT INTO sparklewash.{table}
SELECT * FROM jsonb_populate_recordset(NULL::sparklewash.{table},
    convert_from(decode('{payload}', 'base64'), 'UTF8')::jsonb){conflict};
""")
    sql.append("SET CONSTRAINTS ALL IMMEDIATE;")
    for table, records in tables.items():
        sql.append(f"""
DO $$ BEGIN
    IF (SELECT count(*) FROM sparklewash.{table}) <> {len(records)} THEN
        RAISE EXCEPTION 'Imported row count did not match the source';
    END IF;
END $$;
""")
        sql.append(f"SELECT count(*) FROM sparklewash.{table};")
    sql.append("COMMIT;" if commit else "ROLLBACK;")
    if not commit:
        for table in tables:
            sql.append(f"SELECT count(*) FROM sparklewash.{table};")
    result = subprocess.run(
        ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=terse"],
        input="\n".join(sql), text=True, stdout=subprocess.PIPE, check=True,
    )
    lines = result.stdout.splitlines()
    expected_counts = [str(len(records)) for records in tables.values()]
    if lines[:len(expected_counts)] != expected_counts:
        raise RuntimeError("Rehearsal row counts did not match source counts")
    rollback_counts = lines[len(expected_counts):]
    if not commit:
        expected_baseline = ["1" if table == "tenants" else "0" for table in tables]
        if rollback_counts != expected_baseline:
            raise RuntimeError("Rollback did not restore the target tables to their allowed baseline state")

    changed_sources = []
    for source, initial in SOURCE_CHECKSUMS.items():
        path = Path(source)
        final = {"exists": path.exists(), "sha256": sha256_file(path) if path.exists() else None}
        if final != initial:
            changed_sources.append(source)
    if changed_sources:
        raise RuntimeError("Source snapshot changed during rehearsal: " + ", ".join(changed_sources))

    action = "Imported: " if commit else "Validated and rolled back: "
    print(action + ", ".join(f"{len(records)} {table}" for table, records in tables.items()))
    if args.evidence_file:
        evidence = {
            "formatVersion": 1,
            "mode": "dry-run-rollback",
            "snapshot": str(args.snapshot.resolve()),
            "sourceFiles": SOURCE_CHECKSUMS,
            "sourceUnchanged": True,
            "tables": {
                table: {"sourceRows": len(records), "rowsAfterRollback": int(after),
                        "preImportRows": int(after)}
                for (table, records), after in zip(tables.items(), rollback_counts)
            },
            "cutover": {"performed": False, "requiresFrozenWritesAndExplicitApproval": True},
            "rollback": {"performed": True, "importedRowsRemoved": True,
                         "baselineDefaultTenantPreserved": True},
        }
        args.evidence_file.parent.mkdir(parents=True, exist_ok=True)
        args.evidence_file.write_text(json.dumps(evidence, indent=2) + "\n")
        print(f"Evidence: {args.evidence_file}")


if __name__ == "__main__":
    main()
