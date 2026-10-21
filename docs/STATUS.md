# SparkleWash: review and status (updated 2026-10-21)

## What is real today

| Area | State |
|---|---|
| **API** (`src/carwash-api`, .NET 10 minimal API) | Solid. Camera arrivals with staff confirmation, jobs with an enforced state machine and idempotency keys, employees, an inventory ledger with reservations, Google staff sign-in with roles, n1co payment webhook inbox (HMAC-verified), station telemetry over HTTP and MQTT, a WebSocket stream. Atomic JSON-file persistence. 43 tests. |
| **Plate tracking** (new) | Camera sightings of a plate that already has an open job are linked to that job and kept out of the review queue. `GET /api/jobs?plate=`, `GET /api/plates/{plate}/timeline`, `GET /api/arrivals?pending=true`. |
| **Edge vision** (new, `edge/`) | ESP32-CAM firmware serving `/cam-hi.jpg`; Python gateway: YOLOv3 vehicles via `cv2.dnn` → plate region → OCR → multi-frame vote → idempotent `POST /api/arrivals/observations`. 12 tests plus a live gateway→API check. |
| **Staff console** (new, `web/`) | React + TS + Vite. Live floor, arrival review, job board, plate tracker, bays. Google sign-in, plus an in-browser demo. 18 tests. Deployed by the Static Web Apps workflow (repointed from `ai-spec-ui`). |
| **Exit cameras + live updates** (new) | `SPARKLEWASH_EXIT_CAMERAS`: exit sightings close the loop on a job and suggest *Mark done*. `GET /api/events` pushes arrival/job changes to consoles. |
| **Languages** (new) | Console is Spanish by default with English available. The catalog matches the posted price sheet (Quick/Essential/Renew/Supreme Spa) and has English translations. |
| **Landing page + video** (new) | `/` is a Spanish paper-cut landing page with the demo, ESP32-CAM details and real console screens. A 64 s Spanish explainer video is rendered from `web/video/explainer.html`. The console moved to `/app/`. |
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

1. ~~Revenue endpoints are public~~: fixed. They now require a staff session or the ingestion key.
2. **Staff sessions live in memory.** A restart signs everyone out, and two API instances can't share sessions. That's fine for one box; use a shared store before scaling out.
3. **`PaymentPosStore` is dead code** (removal pending owner approval). It is never registered or routed. Either wire POS references onto jobs or delete it.
4. **Stale specs.** `spec.yaml` (duplicate keys, React snippets that don't compile) and `api-spec.openapi.yaml` (`/jobs/stats`, `/jobs/history` don't exist) don't describe the API. Generate OpenAPI from the endpoints, or delete them.
5. **Dead or duplicate front ends and servers:** `ai-spec-ui/` (doesn't compile), `spa/` (Compose code with non-existent imports), `static/wwwroot/` (about 30 stale hashed bundles with no source), `src/carwash_api/app.py` and `src/carwash-api/server/*` (stub servers in Python, Node and Perl). Nothing deploys from them any more; delete them once the owner approves.
6. **JSON-file storage** caps out at a few thousand jobs per file, because each write rewrites the whole file. Move to SQLite or Postgres when history matters.

## Next steps

1. Train or download a licence-plate YOLO model (ONNX) for your country's plates and pass `--plate-model`. The contour fallback is fine for a demo but weak in real light.
2. Mount the exit camera and add it to `SPARKLEWASH_EXIT_CAMERAS` (support is built).
3. Translate API error and suggestion text, if anything other than the console will show it to people (the console already localizes errors by status code).
4. Close the remaining open findings above.
