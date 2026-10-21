# SparkleWash: review and status (updated 2026-10-21, round 4)

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
| **Registration + multi-carwash** (new) | `POST /api/tenants/register`: a carwash signs up with its owner's Google account (admin). Each carwash has its own data directory; the original single-site setup is the `default` carwash. `SPARKLEWASH_REGISTRATION_OPEN=false` closes sign-ups. |
| **Linked ESP32 devices** (new) | Per-camera keys (shown once, stored hashed, bound to one camera id), roles entry/bay/exit, rotate/disable, heartbeat with online status. |
| **Admin view** (new) | Console *Administración*: carwash details, cameras (link wizard with gateway command), team (invite by email, roles, remove), wash employees. Setup checklist for new carwashes. |
| **iOS / iPadOS app** (new, `ios/`) | SwiftUI, iOS 17. `NavigationSplitView` (sections · list · detail) on iPad, a stack on iPhone. Same features as the console, Spanish by default (strings generated from the console's). SwiftData cache with an ordered outbox: changes made offline apply at once and sync, in order, with idempotency keys. Google sign-in (PKCE). Cameras: Bonjour discovery with live view and flash; Wi-Fi setup over Bluetooth LE. Shared code in the `SparkleKit` Swift package. See `ios/README.md`. |
| **Camera firmware 1.2** (new) | Bluetooth LE setup mode (no Wi-Fi saved, saved Wi-Fi unreachable, or BOOT held), settings in flash (no sketch editing), mDNS `_sparklewash._tcp` with TXT `id`/`fw`, host `sparklecam-<id>.local`. Builds on ESP32 core 3.x with esp32cam + NimBLE-Arduino 1.4.x. |
| **CI** | `ci.yml`: API, gateway and console tests (also on `claude/**` branches). `ios.yml`: SparkleKit tests against a live API, the app's unit and UI tests on iPhone and iPad simulators (macOS runner, XcodeGen), and an arduino-cli firmware build. The Static Web Apps job now builds and tests the site itself, checks every landing asset, and smoke-tests the deployed URLs. |
| **Tests** | API 46, gateway 16, console 36, SparkleKit 36, iOS app 22 unit + 6 UI. |

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

## Round 3 review: registration, devices, admin

What was missing:

1. **There was no registration.** Staff access came only from the server setting `SPARKLEWASH_STAFF_ROLES`, and all data belonged to one site. A second carwash would have shared arrivals, jobs and photos with the first.
2. **ESP32 devices weren't linked to anything.** Every camera used one shared ingest key, and `cameraId` was free text: any device holding the key could post as any camera, and one leak meant replacing the key everywhere.
3. **There was no admin view.** Employees and inventory had API endpoints but no screen; cameras and staff access couldn't be managed at all.
4. **The console ignored roles.** Viewers saw action buttons that always failed with 403.

Bugs fixed:

5. **Confirmed arrivals could vanish from review.** If confirming succeeded and opening the job failed (network, or the plate already had an open job), the arrival left the review queue for good. Now it stays, marked "confirmed, open the job".
6. **There was no way to discard a false read.** Misreads, duplicates and staff vehicles had no exit from review. Added *Descartar* with a reason.
7. **An expired or revoked session left the console stuck on error banners.** Any 401, including from the live-update stream, now returns to sign-in with a notice.
8. **"Done today" was counted in UTC.** In El Salvador that rolls over at 6 pm local time. It now uses the carwash's time zone.
9. **Bay data leaked between sites.** The console's bay screen read the public `/api/metrics`, which shows the default site's bays to everyone. It now reads the per-carwash `/api/bays`.
10. **Google sign-in kept stale form values.** The callback was frozen at initialization, so registration would have submitted an empty form. Fixed with a callback ref.

Still open:

* Bay controllers (MQTT and the shared ingest key) report only to the default carwash. Per-carwash bay controllers need their own device keys, the same pattern as cameras.
* An invitation is matched by verified Google email. There is no email sending yet: the admin tells the person to sign in.
* One Google account belongs to one carwash. People working at two carwashes need two accounts.

## Round 4: iOS app, firmware 1.2, whole-codebase review

Added: the iOS/iPadOS app, firmware 1.2 and the macOS CI described above. Three review agents then covered the iOS code and firmware, the API, gateway, console and workflows, and the UI against the new features.

Bugs fixed:

1. **Wash history and revenue leaked across carwashes.** `/api/washes/history` and `/api/metrics/summary` accepted any staff session, so a newly registered carwash could read the original site's revenue. They are now limited to the default carwash's staff (or the ingest key). Regression test added.
2. **The vision gateway crashed on an API outage.** A refused or dropped connection escaped the retry loop and killed the process, losing the plate. It now retries, logs and keeps running.
3. **Firmware BLE values were wrong on the wire.** NimBLE's templated `setValue(const char*)` copied the pointer, so the app could never read the status. Sent as bytes now. Modem sleep stays on while Bluetooth runs (required for coexistence), and a camera with saved Wi-Fi retries every 5 minutes instead of staying in setup mode.
4. **The Static Web Apps deploy never succeeded.** The Oryx build ran a stale script and produced no upload folder.
5. **The console's "Listos hoy" used the UTC day**, even though the API returns the local-day count. A malformed `#/…` link also blanked the console.
6. **iOS:** a job opened offline vanished after a refresh, the same queued change could be sent twice, and the unit tests linked a second copy of SparkleKit (which splits `APIError`).

UI added for the new features:

* **Console:** camera cards show IP and firmware, an *Actualizar a 1.2* prompt and first-connection help. The link dialog suggests a free camera ID and explains duplicates. The key dialog explains Bluetooth setup and points the gateway at `sparklecam-<id>.local`. Phones get connection state, theme and sign-out in a header menu.
* **Landing:** an iPhone/iPad app section, Bluetooth setup steps, and FAQ answers on offline use and running several carwashes.
* **iOS:** last-sync time, a sign-out warning when changes are unsynced, "needs connection" states with retry, and Bluetooth setup straight after a key is issued (firmware 1.2+ only).

Still open:

* **Deploy:** the site only deploys from `main`. The branch needs a merge (or a PR for a preview), and the repo variables `VITE_GOOGLE_CLIENT_ID` and `VITE_API_BASE_URL` must be set, or the deployed console is demo-only.
* **Google OAuth clients:** web and iOS clients still need creating in Google Cloud Console. The API accepts a comma-separated `SPARKLEWASH_GOOGLE_CLIENT_ID`.
* **UI follow-ups from the audit:**
  * iOS layouts at accessibility text sizes.
  * Registered camera names instead of names guessed from IDs.
  * A status-chip row on the phone job board.
  * An equipment-health row on the floor screen.
  * Explainer video lines about the app.

## Next steps

1. Train or download a licence-plate YOLO model (ONNX) for your country's plates and pass `--plate-model`. The contour fallback is fine for a demo but weak in real light.
2. Mount the exit camera and add it to `SPARKLEWASH_EXIT_CAMERAS` (support is built).
3. Translate API error and suggestion text, if anything other than the console will show it to people (the console already localizes errors by status code).
4. Close the remaining open findings above.
5. Distribute the iOS app (TestFlight): set a development team and bundle ID, and fill `ios/Local.xcconfig` with the server URL and the iOS OAuth client.
