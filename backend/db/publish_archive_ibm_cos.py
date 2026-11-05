#!/usr/bin/env python3
"""Publish a verified SparkleWash archive to a locked private IBM COS bucket."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
from tempfile import TemporaryDirectory
from zipfile import ZipFile, ZipInfo

from archive_evidence import verify_evidence


def cos(*arguments):
    output = subprocess.check_output(
        ["ibmcloud", "cos", *arguments, "--output", "json"], stderr=subprocess.PIPE
    )
    return json.loads(output) if output.strip() else {}


def object_exists(bucket, key, region):
    result = subprocess.run(
        ["ibmcloud", "cos", "object-head", "--bucket", bucket, "--key", key,
         "--region", region, "--output", "json"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    if result.returncode == 0:
        return True
    message = (result.stdout + result.stderr).lower()
    if "404" in message or "nosuchkey" in message or "notfound" in message:
        return False
    raise RuntimeError("COS object HEAD failed; refusing to publish without checking the destination")


def public_block_is_closed(value):
    if isinstance(value, dict):
        required = ("BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets")
        if all(key in value for key in required):
            return all(value[key] is True for key in required)
        return any(public_block_is_closed(item) for item in value.values())
    if isinstance(value, list):
        return any(public_block_is_closed(item) for item in value)
    return False


def has_configured_object_retention(configuration):
    if configuration.get("ObjectLockEnabled") != "Enabled":
        return False
    default = configuration.get("Rule", {}).get("DefaultRetention", {})
    if default.get("Mode") not in ("COMPLIANCE", "GOVERNANCE"):
        return False
    days = default.get("Days", 0) or 0
    years = default.get("Years", 0) or 0
    return days > 0 or years > 0


def retention_is_active(retention):
    value = retention.get("Retention", retention)
    if value.get("Mode") not in ("COMPLIANCE", "GOVERNANCE"):
        return False
    date = value.get("RetainUntilDate")
    if not isinstance(date, str):
        return False
    try:
        until = datetime.fromisoformat(date.replace("Z", "+00:00"))
    except ValueError:
        return False
    if until.tzinfo is None:
        until = until.replace(tzinfo=timezone.utc)
    return until > datetime.now(timezone.utc)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--evidence", type=Path, help="Evidence ZIP produced for this batch")
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--region", required=True)
    args = parser.parse_args()

    manifest_bytes = (args.archive / "manifest.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    filename = "job-history.json.gz"
    tenant = manifest.get("tenantId", "")
    if (manifest.get("version"), manifest.get("dataset"), manifest.get("file")) != (
        3, "completed-jobs", filename,
    ):
        parser.error("Unsupported archive format")
    if not isinstance(tenant, str) or not re.fullmatch(r"[A-Za-z0-9]+", tenant):
        parser.error("Invalid tenant ID")

    payload = (args.archive / filename).read_bytes()
    if hashlib.sha256(payload).hexdigest() != manifest.get("sha256"):
        parser.error("Archive checksum mismatch")
    evidence = args.evidence.read_bytes() if args.evidence else None
    if evidence is not None:
        verify_evidence(evidence, payload, tenant, manifest["sha256"])

    region_args = ("--bucket", args.bucket, "--region", args.region)
    access = cos("public-access-block-get", *region_args)
    if not public_block_is_closed(access):
        parser.error("COS bucket must block all public access before archive publication")
    lock = cos("object-lock-configuration-get", *region_args)
    if not has_configured_object_retention(lock):
        parser.error("COS bucket must have an approved nonzero Object Lock default retention")

    with TemporaryDirectory() as temp:
        bundle = Path(temp) / "archive.zip"
        with ZipFile(bundle, "w") as output:
            output.writestr(ZipInfo("manifest.json"), manifest_bytes)
            output.writestr(ZipInfo(filename), payload)
            if evidence is not None:
                output.writestr(ZipInfo("evidence.zip"), evidence)
        digest = hashlib.sha256(bundle.read_bytes()).hexdigest()
        key = f"job-history/v3/{tenant}/{digest}.zip"

        if not object_exists(args.bucket, key, args.region):
            cos("object-put", "--bucket", args.bucket, "--key", key,
                "--body", str(bundle), "--content-type", "application/zip", "--region", args.region)

        retention = cos("object-retention-get", "--bucket", args.bucket, "--key", key,
                        "--region", args.region)
        if not retention_is_active(retention):
            raise RuntimeError("COS object lacks active Object Lock retention")

        local_copy = Path(temp) / "download.zip"
        subprocess.run(
            ["ibmcloud", "cos", "object-get", "--bucket", args.bucket, "--key", key,
             "--region", args.region, str(local_copy)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
        )
        existing_digest = hashlib.sha256(local_copy.read_bytes()).hexdigest()
        if existing_digest != digest:
            raise RuntimeError("Existing digest-addressed COS object has different bytes")
    print(f"Verified IBM COS archive: {key} sha256={digest}")


if __name__ == "__main__":
    main()
