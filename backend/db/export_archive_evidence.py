#!/usr/bin/env python3
"""Package the photo evidence referenced by a verified completed-job batch."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import re
from tempfile import NamedTemporaryFile
from zipfile import ZipFile, ZipInfo


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("batch", type=Path)
    parser.add_argument("photos", type=Path, help="Photo directory from the same tenant's frozen snapshot")
    parser.add_argument("output", type=Path, help="New evidence ZIP file")
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Output already exists")

    manifest = json.loads((args.batch / "manifest.json").read_bytes())
    filename = "job-history.json.gz"
    if (manifest.get("version"), manifest.get("dataset"), manifest.get("file")) != (3, "completed-jobs", filename):
        parser.error("Unsupported archive format")
    compressed = (args.batch / filename).read_bytes()
    history_digest = hashlib.sha256(compressed).hexdigest()
    if history_digest != manifest.get("sha256"):
        parser.error("History checksum mismatch")
    batch = json.loads(gzip.decompress(compressed))
    tenant = manifest["tenantId"]
    if len(batch["tenants"]) != 1 or batch["tenants"][0]["id"] != tenant:
        parser.error("History tenant mismatch")

    cameras = {}
    for arrival in batch["arrivals"]:
        if arrival["tenant_id"] != tenant:
            parser.error("Arrival tenant mismatch")
        photo_id = arrival.get("photo_id")
        if photo_id is None:
            continue
        if not isinstance(photo_id, str) or not re.fullmatch(r"[a-fA-F0-9]{32}", photo_id):
            parser.error("Invalid photo ID")
        camera = arrival["camera_id"]
        if cameras.setdefault(photo_id, camera) != camera:
            parser.error("Photo is linked to inconsistent cameras")

    evidence = {"version": 1, "tenantId": tenant, "historySha256": history_digest, "photos": []}
    with NamedTemporaryFile(dir=args.output.parent) as temporary:
        with ZipFile(temporary, "w") as archive:
            for photo_id, camera in sorted(cameras.items()):
                image = args.photos / (photo_id + ".jpg")
                metadata = args.photos / (photo_id + ".json")
                if not image.is_file() or not metadata.is_file():
                    parser.error(f"Missing evidence for photo {photo_id}")
                record = json.loads(metadata.read_bytes())
                data = image.read_bytes()
                if record["id"] != photo_id or record["stationId"] != camera or record["sizeBytes"] != len(data):
                    parser.error(f"Photo metadata does not match reference {photo_id}")
                member = f"photos/{photo_id}.jpg"
                archive.writestr(ZipInfo(member), data)
                evidence["photos"].append({
                    "id": photo_id, "cameraId": camera, "uploadedAt": record["uploadedAt"],
                    "file": member, "sizeBytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                })
            archive.writestr(ZipInfo("evidence-manifest.json"), json.dumps(evidence, indent=2) + "\n")
        temporary.flush()
        temporary.seek(0)
        with args.output.open("xb") as output:
            while chunk := temporary.read(1024 * 1024):
                output.write(chunk)
    print(f"Packaged {len(evidence['photos'])} evidence photos for history {history_digest}")


if __name__ == "__main__":
    main()
