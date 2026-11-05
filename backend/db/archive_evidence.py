"""Validate the evidence sidecar before publication or recovery."""
import gzip
import hashlib
import io
import json
import re
from zipfile import ZipFile


def verify_evidence(evidence_bytes, history, tenant, history_digest):
    batch = json.loads(gzip.decompress(history))
    if len(batch["tenants"]) != 1 or batch["tenants"][0]["id"] != tenant:
        raise ValueError("History tenant mismatch")
    expected = {}
    for arrival in batch["arrivals"]:
        if arrival["tenant_id"] != tenant:
            raise ValueError("Arrival tenant mismatch")
        photo = arrival.get("photo_id")
        if photo is not None:
            camera = arrival["camera_id"]
            if expected.setdefault(photo, camera) != camera:
                raise ValueError("Photo references disagree on camera")

    with ZipFile(io.BytesIO(evidence_bytes)) as archive:
        manifest = json.loads(archive.read("evidence-manifest.json"))
        if (manifest.get("version"), manifest.get("tenantId"), manifest.get("historySha256")) != (1, tenant, history_digest):
            raise ValueError("Evidence manifest does not match history")
        members = ["evidence-manifest.json"]
        found = {}
        for photo in manifest["photos"]:
            identifier = photo["id"]
            if not re.fullmatch(r"[a-fA-F0-9]{32}", identifier) or identifier in found:
                raise ValueError("Invalid or duplicate evidence photo ID")
            member = f"photos/{identifier}.jpg"
            if photo["file"] != member or archive.getinfo(member).file_size != photo["sizeBytes"]:
                raise ValueError("Evidence file metadata mismatch")
            with archive.open(member) as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != photo["sha256"]:
                    raise ValueError("Evidence photo checksum mismatch")
            members.append(member)
            found[identifier] = photo["cameraId"]
        if found != expected or sorted(archive.namelist()) != sorted(members):
            raise ValueError("Evidence members do not match history")
        return manifest
