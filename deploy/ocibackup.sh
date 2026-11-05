#!/usr/bin/env bash
set -euo pipefail

# deploy/ocibackup.sh — OCI backup (OCI VM image) + .NET API tarball
tar -czhf "/tmp/sparklewash-backup-${DEPLOYER_VERSION}.tar.gz" \
    backend/src/carwash-api/*.csproj backend/src/carwash-api/*.cs backend/src/carwash-api/*.json Makefile.ci Dockerfile nginx/Caddyfile
