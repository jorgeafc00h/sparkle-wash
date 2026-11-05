#!/usr/bin/env bash
set -euo pipefail

# deploy/ocipush.sh — Push OCI image to Oracle container registry
oci container image push reg.oraclecloud.com/ocirepo/carwash/sparklewash-api:${DEPLOYER_VERSION} \
    --all-platforms \
    --skip-cache-verify
