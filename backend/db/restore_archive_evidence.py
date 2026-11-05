#!/usr/bin/env python3
"""Recover verified evidence into a new directory using the API photo file layout."""
import argparse
from datetime import datetime
import hashlib
import io
import json
from pathlib import Path
import shutil
from zipfile import ZipFile

from archive_evidence import verify_evidence


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("batch", type=Path, help="Recovered history batch containing evidence.zip")
    parser.add_argument("output", type=Path, help="New photo directory for the restore rehearsal")
    args = parser.parse_args()

    manifest = json.loads((args.batch / "manifest.json").read_bytes())
    filename = "job-history.json.gz"
    if (manifest.get("version"), manifest.get("dataset"), manifest.get("file")) != (3, "completed-jobs", filename):
        parser.error("Unsupported archive format")
    history = (args.batch / filename).read_bytes()
    digest = hashlib.sha256(history).hexdigest()
    if digest != manifest.get("sha256"):
        parser.error("History checksum mismatch")

    evidence = (args.batch / "evidence.zip").read_bytes()
    verified = verify_evidence(evidence, history, manifest["tenantId"], digest)
    for photo in verified["photos"]:
        if datetime.fromisoformat(photo["uploadedAt"]).utcoffset() is None:
            parser.error("Evidence timestamp must have a time zone")

    args.output.mkdir(mode=0o700)
    try:
        with ZipFile(io.BytesIO(evidence)) as archive:
            for photo in verified["photos"]:
                identifier = photo["id"]
                with archive.open(photo["file"]) as source, (args.output / f"{identifier}.jpg").open("xb") as target:
                    shutil.copyfileobj(source, target)
                record = {
                    "id": identifier,
                    "stationId": photo["cameraId"],
                    "uploadedAt": photo["uploadedAt"],
                    "sizeBytes": photo["sizeBytes"],
                }
                (args.output / f"{identifier}.json").write_text(json.dumps(record) + "\n", encoding="utf-8")
    except BaseException:
        shutil.rmtree(args.output)
        raise
    print(f"Restored {len(verified['photos'])} evidence photos")


if __name__ == "__main__":
    main()
