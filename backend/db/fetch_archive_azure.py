#!/usr/bin/env python3
"""Retrieve a published Azure archive batch for an isolated restore rehearsal."""
import argparse
import hashlib
import json
from pathlib import Path
import re
from tempfile import TemporaryDirectory
from zipfile import ZipFile

from archive_evidence import verify_evidence
from publish_archive_azure import azure


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("blob", help="Digest-addressed blob printed by the publisher")
    parser.add_argument("output", type=Path, help="New local batch directory")
    parser.add_argument("--account", required=True)
    parser.add_argument("--container", required=True)
    args = parser.parse_args()

    match = re.fullmatch(r"job-history/v3/([A-Za-z0-9]+)/([a-f0-9]{64})\.zip", args.blob)
    if not match:
        parser.error("Expected a version 3 digest-addressed blob name")
    if args.output.exists():
        parser.error("Output directory already exists")
    tenant, digest = match.groups()

    with TemporaryDirectory() as temp:
        downloaded = Path(temp) / "batch.zip"
        azure("blob", "download", "--account-name", args.account, "--auth-mode", "login",
              "--container-name", args.container, "--name", args.blob, "--file", str(downloaded))
        with downloaded.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != digest:
                parser.error("Downloaded archive checksum mismatch")

        filename = "job-history.json.gz"
        with ZipFile(downloaded) as archive:
            members = sorted(archive.namelist())
            has_evidence = "evidence.zip" in members
            expected = ["manifest.json", filename]
            if has_evidence:
                expected.append("evidence.zip")
            if members != sorted(expected):
                parser.error("Unexpected archive members")
            manifest_bytes = archive.read("manifest.json")
            manifest = json.loads(manifest_bytes)
            if (manifest.get("version"), manifest.get("dataset"), manifest.get("tenantId"), manifest.get("file")) != (
                3, "completed-jobs", tenant, filename,
            ):
                parser.error("Archive manifest does not match the blob name")
            with archive.open(filename) as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != manifest.get("sha256"):
                    parser.error("Archive payload checksum mismatch")

            evidence = archive.read("evidence.zip") if has_evidence else None
            if evidence is not None:
                verify_evidence(evidence, archive.read(filename), tenant, manifest["sha256"])

            args.output.mkdir(mode=0o700)
            if evidence is not None:
                (args.output / "evidence.zip").write_bytes(evidence)
            with archive.open(filename) as source, (args.output / filename).open("xb") as output:
                while chunk := source.read(1024 * 1024):
                    output.write(chunk)
            (args.output / "manifest.json").write_bytes(manifest_bytes)
    print("Verified download. Run the PostgreSQL restore rehearsal on the extracted batch.")


if __name__ == "__main__":
    main()
