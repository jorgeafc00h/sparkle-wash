#!/usr/bin/env bash
set -euo pipefail

# ───────────────────────────────────────────────────────────────────────────────
# deploy/ocibuild.sh — Build multi-stage OCI image for .NET 10 Minimal API + PWA
# ═══════════════════════════════════════════════════════════════════════════════

export DEPLOYER_VERSION="${DEPLOYER_VERSION:-v1.0.0-arm64}"

if [[ "${OCI_CLI:+x}" == "" ]]; then
    echo "ERROR: OCI_CLI environment variable is not set." >&2
    exit 1
fi

oci_container_image build \
    --image-name="reg.oraclecloud.com/ocirepo/carwash/sparklewash-api:${DEPLOYER_VERSION}" \
    .

echo "OCI image built. You can now pull it with:"
echo "  oci container image pull reg.oraclecloud.com/ocirepo/carwash/sparklewash-api:${DEPLOYER_VERSION} --all-platforms"
