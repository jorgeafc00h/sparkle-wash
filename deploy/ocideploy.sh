#!/usr/bin/env bash
# ───────────────────────────────────────────────────────────────────────────────
# deploy/ocideploy.sh — OCI Container Instance deployment (ARM64 AMI)
# Runs the .NET 10 Minimal API inside an OCI VM, mounted via Caddy reverse proxy
# to serve the React PWA static build and API proxy routes on port 80.
# ───────────────────────────────────────────────────────────────────────────────

set -euo pipefail

image="reg.oraclecloud.com/ocirepo/carwash/sparklewash-api:${DEPLOYER_VERSION:-latest-arm64}"
container_name_prefix="sparklewash-api-$(openssl rand -hex 8)"
instance_name="${CLOUD_INSTANCE_NAME:-api-instance-$(openssl rand -hex 5)}"

oci container instance launch \
    --source-image=$image \
    --display-name="$instance_name" \
    --compartment-id=$(oci iam compartment list --all-pages=true | tail -1 | grep -oE '"id":"[^"]+"' | sed 's/"id":"//' | head -n 1) \
    --launch-options=OCI_CONTAINER_RUN_OPTIONS='{"Env": [{"name":"ASPNETCORE_URLS", "value":"${SPARKLEWASH_API_SCHEME:-http}://${SPARKLEWASH_API_HOST:-localhost}:8084"}, {"name":"ASPNETCORE_ENVIRONMENT", "value":"Production"}], "HostnameOverride":"${DEPLOYER_VERSION}", "Port": 80 }' \
    --wait

# Attach a Caddy reverse proxy listener via `oci network load-balancer` rule
oci load balancer create ...  # or use OCI Container Instances v1.2 with direct port mapping on 80
echo "OCI Container Instance deployed: $instance_name"
echo $instance_name
