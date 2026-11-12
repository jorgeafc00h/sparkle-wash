#!/usr/bin/env python3
"""Publish a verified Car Spa batch to a private Azure Blob container."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
from tempfile import TemporaryDirectory
from zipfile import ZipFile, ZipInfo

from archive_evidence import verify_evidence


def azure(*arguments):
    return subprocess.check_output(["az", "storage", *arguments, "--only-show-errors", "--output", "json"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--evidence", type=Path, help="Evidence ZIP produced for this batch")
    parser.add_argument("--account", required=True)
    parser.add_argument("--container", required=True)
    args = parser.parse_args()

    manifest_bytes = (args.archive / "manifest.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    filename = "job-history.json.gz"
    tenant = manifest.get("tenantId", "")
    if (manifest.get("version"), manifest.get("dataset"), manifest.get("file")) != (3, "completed-jobs", filename):
        parser.error("Unsupported archive format")
    if not isinstance(tenant, str) or not re.fullmatch(r"[A-Za-z0-9]+", tenant):
        parser.error("Invalid tenant ID")

    payload = (args.archive / filename).read_bytes()
    if hashlib.sha256(payload).hexdigest() != manifest.get("sha256"):
        parser.error("Archive checksum mismatch")

    evidence = args.evidence.read_bytes() if args.evidence else None
    if evidence is not None:
        verify_evidence(evidence, payload, tenant, manifest["sha256"])

    account = ("--account-name", args.account, "--auth-mode", "login")
    container = json.loads(azure("container", "show", *account, "--name", args.container))
    if container["properties"].get("publicAccess") not in (None, "None"):
        parser.error("The destination container allows public access")

    with TemporaryDirectory() as temp:
        bundle = Path(temp) / "batch.zip"
        with ZipFile(bundle, "w") as output:
            output.writestr(ZipInfo("manifest.json"), manifest_bytes)
            output.writestr(ZipInfo(filename), payload)
            if evidence is not None:
                output.writestr(ZipInfo("evidence.zip"), evidence)
        digest = hashlib.sha256(bundle.read_bytes()).hexdigest()
        blob = f"job-history/v3/{tenant}/{digest}.zip"
        target = (*account, "--container-name", args.container, "--name", blob)
        if not json.loads(azure("blob", "exists", *target))["exists"]:
            azure("blob", "upload", *target, "--file", str(bundle), "--overwrite", "false",
                  "--content-type", "application/zip")

        downloaded = Path(temp) / "download.zip"
        azure("blob", "download", *target, "--file", str(downloaded))
        if hashlib.sha256(downloaded.read_bytes()).hexdigest() != digest:
            raise RuntimeError("Downloaded archive checksum mismatch")
    print(f"Verified Azure Blob archive: {blob}")


if __name__ == "__main__":
    main()
