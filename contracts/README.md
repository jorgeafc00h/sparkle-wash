# Versioned API contract decisions

## Job-first package catalog

`contracts/v1/service-packages.json` is the shared menu fixture for API, web and SwiftUI. GET `/api/packages` returns it, including cumulative service inclusions and the USD matrix in the supplied image. GET `/api/packages/suggestion?vehicleClass=car|suv|xl|pickup` returns Essential Spa as an explainable starting suggestion. A suggestion is neither a job nor a charge; staff confirmation is planned with the arrival/job workflow.

## Plate observations

POST `/api/arrivals/observations` accepts a JSON observation from an ESP32 or integration device authenticated by `X-SparkleWash-Ingest-Key`. Fields are `deviceEventId`, `cameraId`, optional `plateCandidate`, optional `confidence` (0–1), `capturedAt`, and optional base64 JPEG `photoBase64`. Either a candidate or photo is required. The actual JSON body is limited to 400000 bytes; JPEG bytes to 262144. A retry with the same camera/event ID and evidence returns 200 and `duplicate:true`; a changed payload with that ID returns 409. Data persists at `SPARKLEWASH_ARRIVALS_FILE` (default `data/arrivals.json`). No job is created.

GET `/api/arrivals` and GET `/api/arrivals/{id}/photo` require a staff Bearer session. POST `/api/arrivals/{id}/confirm` requires an operator/admin session and `{plate,vehicleClass}`. Confirmation normalizes separators/case, snapshots the reviewer and time, and rejects conflicting reconfirmation. A confirmed observation is still not a job; staff opens one explicitly through `/api/jobs`. Camera evidence currently uses the protected photo store and its 30-day retention.

## Jobs, employees and stock

POST `/api/jobs` requires a confirmed `arrivalId`, `packageId`, operator/admin Bearer session and `Idempotency-Key`. The server snapshots the package and class price and rejects another open job for the same plate. POST `/api/jobs/{id}/transition` advances `arrived` → `queued` → `in_progress` → `completed`, or cancels an open job. GET `/api/jobs`, `/api/jobs/{id}` and `/api/jobs/summary` return job records and whole-carwash counts/time. `arrivalAt` is the server's first observation receipt time; elapsed time never comes from a client clock. Set `SPARKLEWASH_JOBS_FILE` for its atomic JSON store.

GET `/api/employees` lists staff; admins can POST `/api/employees` and change active status. Operators/admins assign active employees to open jobs with POST `/api/jobs/{id}/employees` and an idempotency key. The assignment snapshots the employee name.

GET `/api/inventory/items` returns on-hand, reserved, available and reorder state. Admins create items and post receipts/adjustments. Operators/admins reserve stock for open jobs and post consumption for in-progress jobs with an assigned employee. Every movement has a reason, actor, job/employee where relevant, and operation key; stock cannot go negative or be double deducted on replay. GET `/api/inventory/items/{id}/movements` and `/api/jobs/{id}/materials` expose the audit trail. Completion/cancellation releases remaining reservations. Set `SPARKLEWASH_OPERATIONS_FILE` for the atomic JSON store. These files are single-process stores; multi-replica transactions are a deployment task.

`v1` describes the demo compatibility responses. The checked-in JSON examples are shared DTO fixtures for web, iOS, and API tests. A timestamp in a fixture is illustrative; the server emits the current time. When keyed station telemetry has been ingested, `/api/metrics` returns persisted station readings and reports `X-SparkleWash-Data-Source: station-ingest`; without ingested data it returns the demo fixture shape.

| Conflict | v1 compatibility contract | Planned operational v2 contract |
| --- | --- | --- |
| Upload limit/status | POST `/api/upload` acknowledges only. Missing or zero declared length is 400; declared length above 524288 bytes is 422. No photo is stored. | Implemented separately at POST `/api/stations/{stationId}/photos`: validated multipart JPEGs, 524288 actual request bytes, oversize 413, success 201 with retrievable IDs. |
| Reset method | No reset endpoint exists. | Station reset is no longer part of the primary job workflow. |
| Metrics shape | GET `/api/metrics` returns a flat station array. With no ingested data, alerts are fixed examples and both routes carry `X-SparkleWash-Data-Source: demo`. | Implemented for direct ingestion: snapshots remain at `/api/metrics`; derived alerts and fleet aggregates are at `/api/metrics/alerts` and `/api/metrics/summary`. Streaming freshness remains planned. |
| Station stream | Ordinary GET `/ws` requests receive 404. | Implemented for authenticated WebSocket clients at `/ws/app-station-streaming/{stationId}`. It sends an initial snapshot, updates no faster than once per second, and a heartbeat every 15 seconds by default. |
| Station identity | Demo station IDs are short strings (for example `b4c3`). | Preserve string IDs; do not impose UUID syntax until hardware enrollment establishes the ID format. |

N1CO is the selected payment processor. Staff identity will follow the App.Desktop Google sign-in and backend session pattern, with Car Spa-owned roles and secrets. Role assignment and receipt rules are still pending.

POST `/api/auth/google` validates a Google ID token against `SPARKLEWASH_GOOGLE_CLIENT_ID` and admits only Google subject IDs mapped in `SPARKLEWASH_STAFF_ROLES` (`numeric-sub=viewer|operator|admin`, separated by semicolons). It returns an eight-hour opaque Car Spa session token. The server stores only a token digest in memory, so restart expires sessions. Job, employee and stock routes enforce these roles; web and native sign-in flows are still being built.

## N1CO webhook inbox (partial task 1.6)

POST `/api/payments/n1co/webhook` requires `SPARKLEWASH_N1CO_WEBHOOK_SECRET`, verifies `X-H4B-Hmac-Sha256` against the raw request body, rejects bodies above 65536 actual bytes, and stores a bounded, deduplicated event inbox at `SPARKLEWASH_N1CO_WEBHOOK_FILE` (default `data/n1co-webhooks.json`). An unset secret returns 503. A valid delivery returns 202 and reports whether it was a duplicate. Events are **not** proof that a receipt is paid: the backend still needs to reconcile the order with N1CO's Orders API and match amount, currency, and order reference before issuing a verified receipt. No live N1CO credentials or merchant account have been configured or exercised here.

## Station ingestion now implemented

Set `SPARKLEWASH_INGEST_KEY` to a secret and optionally set `SPARKLEWASH_DATA_FILE` to an absolute writable JSON path. POST `/api/stations/{stationId}/telemetry` with the key in `X-SparkleWash-Ingest-Key` and JSON `{name,status,pressurePsi,soapLevelDm}`. Valid statuses are `idle`, `washing`, `cleaning`, `drying`, `error`. POST `/api/stations/{stationId}/washes` with the same key and `{category,revenueUsd}` after that station exists. GET `/api/washes/history?limit=20` returns up to 100 records and GET `/api/metrics/summary` returns counts and recorded revenue. Stored history is bounded to 1000 washes. Physical hardware integration remains pending.

## MQTT and WebSocket delivery

Set `SPARKLEWASH_MQTT_HOST`, `SPARKLEWASH_MQTT_USER`, `SPARKLEWASH_MQTT_PASSWORD`, and `SPARKLEWASH_STREAM_KEY`. The MQTT bridge connects with TLS to port 8883 by default. For a local test broker only, set `SPARKLEWASH_MQTT_TLS=false` and `SPARKLEWASH_MQTT_PORT` to the local listener. It subscribes to `sparklewash/stations/+/telemetry`, accepting up to 4096-byte JSON payloads with the telemetry fields above. The bridge persists accepted readings and reconnects with a 2–30 second backoff.

WebSocket clients connect to `/ws/app-station-streaming/{stationId}` with `X-SparkleWash-Stream-Key`. The server allows at most 50 clients, queues only each client's latest station frame, sends frames no faster than once per second, and sends a heartbeat after 15 seconds without updates. The heartbeat interval can be set to 1–60 seconds with `SPARKLEWASH_STREAM_HEARTBEAT_SECONDS`. Native and browser clients are not yet wired to this route; browser authentication needs an identity-backed flow because browser WebSocket requests cannot supply this custom header.

## Stored photos

POST `/api/stations/{stationId}/photos` requires a known station, the ingestion key, and one or two `photos` multipart parts with `image/jpeg`. It validates JPEG segment structure and the actual total request body at 524288 bytes; malformed input is 400 and oversized input is 413. The response contains photo metadata and IDs. GET `/api/stations/{stationId}/photos` lists metadata; GET `/api/photos/{photoId}` returns JPEG bytes. Both retrieval routes require the same key. Set `SPARKLEWASH_PHOTO_DIR` to a writable directory. Photos older than 30 days are pruned, as are the oldest photos above 1000 records or 50 MiB. `SPARKLEWASH_PHOTO_MAX_COUNT` can lower the count for a small installation. Full image codec decoding is not performed; validation checks JPEG segment structure.
