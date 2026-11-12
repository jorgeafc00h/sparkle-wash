#!/usr/bin/env bash
set -euo pipefail

image=${1:-sparklewash-api:local}
image_user=$(docker image inspect "$image" --format '{{.Config.User}}')
if [[ ! "$image_user" =~ ^[1-9][0-9]*$ ]]; then
  echo "Expected a non-root numeric image user, got '$image_user'." >&2
  exit 1
fi
volume=$(docker volume create)
container=
cleanup() {
  if [[ -n "$container" ]]; then docker rm -f "$container" >/dev/null; fi
  docker volume rm "$volume" >/dev/null
}
trap cleanup EXIT

start() {
  container=$(docker run -d -p 127.0.0.1::8080 -v "$volume:/app/data" \
    -e SPARKLEWASH_INGEST_KEY=local-container-smoke "$@" "$image")
  base_url="http://$(docker port "$container" 8080/tcp)"
  for ((attempt=0; attempt<30; attempt++)); do
    if curl --fail --silent --max-time 1 "$base_url/healthz" >/dev/null; then return; fi
    sleep 1
  done
  docker logs "$container" >&2
  return 1
}

start
curl --fail --silent --show-error "$base_url/" | grep -F 'Car Spa - Operations Dashboard' >/dev/null
curl --fail --silent --show-error "$base_url/readyz" | jq -e '.status == "ready"' >/dev/null
curl --fail --silent --show-error "$base_url/api/packages" | jq -e '.packages | length == 4' >/dev/null
status=$(curl --fail --silent --show-error -o /dev/null -w '%{http_code}' \
  -H 'Content-Type: application/json' -H 'X-SparkleWash-Ingest-Key: local-container-smoke' \
  -d '{"name":"Smoke bay","status":"washing","pressurePsi":42,"soapLevelDm":30}' \
  "$base_url/api/stations/smoke-bay/telemetry")
[[ "$status" == 201 ]]
docker rm -f "$container" >/dev/null
container=
start
curl --fail --silent --show-error "$base_url/readyz" | jq -e '.status == "ready"' >/dev/null
curl --fail --silent --show-error "$base_url/api/metrics" \
  | jq -e 'length == 1 and .[0].stationId == "smoke-bay" and .[0].pressurePsi == 42' >/dev/null
docker rm -f "$container" >/dev/null
container=
start -e SPARKLEWASH_DATA_FILE=/app/read-only/stations.json
status=$(curl --silent --show-error -o /dev/null -w '%{http_code}' "$base_url/readyz")
[[ "$status" == 503 ]]
echo 'API container served its catalog, preserved telemetry across replacement and rejected unwritable storage.'
