#!/usr/bin/env bash
set -euo pipefail

: "${IBM_CE_APP:?Set the existing Code Engine demo application name}"
: "${IBM_CE_REGISTRY_SECRET:?Set the Code Engine registry pull secret name}"
: "${IMAGE_REF:?Set the published Linux AMD64 image reference by digest}"
IBM_CE_CPU=${IBM_CE_CPU:-0.125}
IBM_CE_MEMORY=${IBM_CE_MEMORY:-0.25G}
runtime_secret_args=()
if [[ -n "${IBM_CE_RUNTIME_SECRET:-}" ]]; then
  runtime_secret_args+=(--env-from-secret "$IBM_CE_RUNTIME_SECRET")
fi

if [[ ! "$IMAGE_REF" =~ ^[^[:space:]@]+@sha256:[a-f0-9]{64}$ ]]; then
  echo 'IMAGE_REF must be a registry image reference pinned to a SHA-256 digest.' >&2
  exit 2
fi

ibmcloud ce application update --name "$IBM_CE_APP" \
  --image "$IMAGE_REF" --registry-secret "$IBM_CE_REGISTRY_SECRET" \
  --cpu "$IBM_CE_CPU" --memory "$IBM_CE_MEMORY" \
  "${runtime_secret_args[@]}" \
  --port 8080 --min-scale 0 --max-scale 1 \
  --probe-live type=http --probe-live port=8080 --probe-live path=/healthz \
  --probe-ready type=http --probe-ready port=8080 --probe-ready path=/readyz \
  --wait

ibmcloud ce application get --name "$IBM_CE_APP"
