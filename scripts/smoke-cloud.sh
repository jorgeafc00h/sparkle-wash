#!/usr/bin/env bash
set -euo pipefail

origin=${1:-}
origin=${origin%/}
if [[ ! "$origin" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ || $# -gt 2 ]]; then
  echo 'Usage: scripts/smoke-cloud.sh https://API_HOST [STAFF_SESSION_TOKEN_FILE]' >&2
  exit 2
fi

fetch() {
  curl --proto '=https' --silent --show-error --connect-timeout 10 \
    --max-time 20 --retry 3 --retry-connrefused --retry-max-time 45 "$@"
}

fetch --fail "$origin/healthz" | jq -e '.status == "healthy"' >/dev/null
fetch --fail "$origin/readyz" | jq -e '.status == "ready"' >/dev/null
fetch --fail "$origin/api/packages" | jq -e '
  .currency == "USD" and
  [.vehicleClasses[].id] == ["car", "suv", "xl", "pickup"] and
  [.packages[].id] == ["quick", "essential", "renew", "supreme"]
' >/dev/null
archive_status=$(fetch --output /dev/null --write-out '%{http_code}' "$origin/api/history/archive")
if [[ "$archive_status" != 401 ]]; then
  echo "Expected HTTP 401 from anonymous archive access, received $archive_status." >&2
  exit 1
fi

echo 'HTTPS, liveness, readiness, package catalog, and archive authentication passed.'

if [[ $# -eq 2 ]]; then
  token=$(<"$2")
  if [[ ! "$token" =~ ^[A-Za-z0-9_+/=-]+$ ]]; then
    echo 'Invalid staff session token file.' >&2
    exit 2
  fi
  staff_fetch() {
    printf 'Authorization: Bearer %s\n' "$token" | fetch --fail --header @- "$origin$1"
  }
  staff_fetch /api/auth/session | jq -e '
    (.subject | type == "string" and length > 0) and
    (.tenant.id | type == "string" and length > 0) and
    (.role == "viewer" or .role == "operator" or .role == "admin")
  ' >/dev/null
  staff_fetch /api/jobs/summary | jq -e '.total | type == "number"' >/dev/null
  echo 'Staff session and authorized job summary passed.'
fi
