#!/usr/bin/env python3
"""Stage a verified v3 archive for the authenticated staff history API."""
import argparse
import gzip
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
import re
from tempfile import NamedTemporaryFile

from archive_limits import COMPRESSED_LIMIT, EXPANDED_LIMIT


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("staging_root", type=Path)
    args = parser.parse_args()

    manifest = json.loads((args.archive / "manifest.json").read_bytes())
    filename = "job-history.json.gz"
    tenant = manifest.get("tenantId")
    if (manifest.get("version"), manifest.get("dataset"), manifest.get("file")) != (3, "completed-jobs", filename):
        parser.error("Unsupported archive format")
    if not isinstance(tenant, str) or not re.fullmatch(r"[A-Za-z0-9]+", tenant):
        parser.error("Invalid tenant ID")
    with (args.archive / filename).open("rb") as source:
        compressed = source.read(COMPRESSED_LIMIT + 1)
    if len(compressed) > COMPRESSED_LIMIT:
        parser.error("Compressed payload exceeds the staff API limit")
    digest = hashlib.sha256(compressed).hexdigest()
    if digest != manifest.get("sha256"):
        parser.error("Archive checksum mismatch")
    with gzip.GzipFile(fileobj=BytesIO(compressed)) as source:
        expanded = source.read(EXPANDED_LIMIT + 1)
    if len(expanded) > EXPANDED_LIMIT:
        parser.error("Expanded payload exceeds the staff API limit")
    data = json.loads(expanded)
    if (not isinstance(data, dict) or len(data["tenants"]) != 1 or data["tenants"][0]["id"] != tenant
            or len(data["jobs"]) != manifest["rowCounts"]["jobs"]
            or any(row["tenant_id"] != tenant or row["status"] != "completed" for row in data["jobs"])):
        parser.error("Invalid completed jobs or tenant scope")

    directory = args.staging_root / tenant
    directory.mkdir(parents=True, mode=0o750, exist_ok=True)
    path = directory / (digest + ".json.gz")
    # A private temp file in the same directory makes publication atomic.
    with NamedTemporaryFile(dir=directory, delete=False) as temporary:
        temporary_path = Path(temporary.name)
        try:
            temporary.write(compressed)
            temporary.flush()
            os.fchmod(temporary.fileno(), 0o640)
            os.replace(temporary_path, path)
        finally:
            temporary_path.unlink(missing_ok=True)
    print(f"Staged archive batch {digest}")


if __name__ == "__main__":
    main()
