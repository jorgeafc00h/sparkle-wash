# SparkleWash: review and status (2026-10-21)

## What is real today

| Area | State |
|---|---|
| **API** (`src/carwash-api`, .NET 10 minimal API) | Solid. Camera arrivals with staff confirmation, jobs with an enforced state machine and idempotency keys, employees, an inventory ledger with reservations, Google staff sign-in with roles, n1co payment webhook inbox (HMAC-verified), station telemetry over HTTP and MQTT, a WebSocket stream. Atomic JSON-file persistence. 42 tests. |
| **Plate tracking** (new) | Camera sightings of a plate that already has an open job are linked to that job and kept out of the review queue. `GET /api/jobs?plate=`, `GET /api/plates/{plate}/timeline`, `GET /api/arrivals?pending=true`. |
| **Edge vision** (new, `edge/`) | ESP32-CAM firmware serving `/cam-hi.jpg`; Python gateway: YOLOv3 vehicles via `cv2.dnn` → plate region → OCR → multi-frame vote → idempotent `POST /api/arrivals/observations`. 12 tests plus a live gateway→API check. |
| **Staff console** (new, `web/`) | React + TS + Vite. Live floor, arrival review, job board, plate tracker, bays. Google sign-in, plus an in-browser demo. 11 tests. Deployed by the Static Web Apps workflow (repointed from `ai-spec-ui`). |
| **CI** (new) | `.github/workflows/ci.yml` runs all three test suites. |

## Review findings

Fixed in this round:

1. **The API did not build.** `WebApi.csproj` embedded `../../../contracts/v1/service-packages.json`, outside the repo. The contracts now live in `contracts/v1/`.
2. **The Static Web Apps deploy shipped nothing usable.** It pointed at `ai-spec-ui`, whose `build` script copies a `.tsx` file into `index.html`, and `output_location: build` never existed. It now builds `web/`.
3. **`/openapi.json` was invalid OpenAPI.** It used `del` instead of `delete` for `DELETE /api/auth/session`.
4. **The MQTT test failed on IPv4-only hosts.** The test broker also opened an IPv6 listener.
5. **80 build artifacts were committed** (`bin/`, `obj/`, `__pycache__`) despite `.gitignore`.
6. **Repeat camera sightings flooded the review queue.** Every frame of a car already being washed became a new unconfirmed arrival. They now attach to the open job.

Still open, in priority order:

1. **Revenue endpoints are public.** `/api/washes/history` and `/api/metrics/summary` need no auth. Gate them behind a staff session.
2. **Staff sessions live in memory.** A restart signs everyone out, and two API instances can't share sessions. That's fine for one box; use a shared store before scaling out.
3. **`PaymentPosStore` is dead code.** It is never registered or routed. Either wire POS references onto jobs or delete it.
4. **Stale specs.** `spec.yaml` (duplicate keys, React snippets that don't compile) and `api-spec.openapi.yaml` (`/jobs/stats`, `/jobs/history` don't exist) don't describe the API. Generate OpenAPI from the endpoints, or delete them.
5. **Dead or duplicate front ends and servers:** `ai-spec-ui/` (doesn't compile), `spa/` (Compose code with non-existent imports), `static/wwwroot/` (about 30 stale hashed bundles with no source), `src/carwash_api/app.py` and `src/carwash-api/server/*` (stub servers in Python, Node and Perl). Recommend deleting them once you confirm nothing deploys from them.
6. **JSON-file storage** caps out at a few thousand jobs per file, because each write rewrites the whole file. Move to SQLite or Postgres when history matters.

## Next steps

1. Train or download a licence-plate YOLO model (ONNX) for your country's plates and pass `--plate-model`. The contour fallback is fine for a demo but weak in real light.
2. Mount a second camera at the bay exit and show "left the lot" on the timeline. Optionally suggest **Mark done** when the exit camera sees an in-progress plate, with staff still confirming.
3. Replace polling with Server-Sent Events for arrivals and job changes.
4. Close the open findings above, starting with the auth gap.
