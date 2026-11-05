#!/usr/bin/env python3
"""Verify a single Linux AMD64 OCI release against the image loaded for smoke testing."""
import argparse
import hashlib
import json
import subprocess
import tarfile


def verified_blob(archive, descriptor, *, read_json=False):
    digest = descriptor["digest"]
    algorithm, separator, value = digest.partition(":")
    if algorithm != "sha256" or not separator or len(value) != 64 or any(c not in "0123456789abcdef" for c in value):
        raise ValueError("Expected a SHA-256 OCI descriptor")
    member = archive.getmember(f"blobs/sha256/{value}")
    if not member.isfile() or member.size != descriptor["size"]:
        raise ValueError(f"Invalid OCI blob size or type for {digest}")
    with archive.extractfile(member) as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != value:
            raise ValueError(f"OCI blob checksum mismatch for {digest}")
        if read_json:
            stream.seek(0)
            return json.load(stream)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive")
    parser.add_argument("image", help="Docker image loaded from the same release build")
    args = parser.parse_args()

    with tarfile.open(args.archive, mode="r:") as archive:
        with archive.extractfile("index.json") as stream:
            index = json.load(stream)
        descriptors = index["manifests"]
        if len(descriptors) != 1 or descriptors[0]["mediaType"] != "application/vnd.oci.image.manifest.v1+json":
            parser.error("Expected a single OCI image manifest")
        descriptor = descriptors[0]
        manifest = verified_blob(archive, descriptor, read_json=True)
        config = verified_blob(archive, manifest["config"], read_json=True)
        if (config["os"], config["architecture"]) != ("linux", "amd64"):
            parser.error("Expected Linux AMD64")
        for layer in manifest["layers"]:
            verified_blob(archive, layer)

    local_id = subprocess.check_output(
        ["docker", "image", "inspect", args.image, "--format", "{{.Id}}"], text=True
    ).strip()
    if local_id != manifest["config"]["digest"]:
        parser.error("Loaded image does not match the OCI configuration")
    print(f"Verified Linux AMD64 OCI image {descriptor['digest']} matches {args.image}.")


if __name__ == "__main__":
    main()
