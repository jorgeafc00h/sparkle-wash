# Implementation Phases & Milestones

## Background

This document defines the implementation roadmap for the ESP32-CAM IoT Carwash Management System. The design spec (v2) specifies a React PWA frontend with bento-grid layout, .NET 10 Minimal API backend on Azure Container Apps or Oracle ARM Free Tier, and an ESP32-CAM edge node with OV2640 camera + ADC rain/water sensors.

---

## Phase 1 — Backend API (.NET 10)

### Goals
- Write the .NET 10 Minimal API controller that subscribes to local Mosquitto MQTT topics on `#/station/{id}/+` and re-broadcasts frames to WebSocket subscribers at `/ws/station-streams/{stationId}`.
- Expose a health check endpoint `/healthz` for Kubernetes liveness probes.
- Implement `POST /api/upload` to accept multipart form data with `boundary=----WebKitFormBoundary`, decode the JSON envelope (`{action, photos[], receiptNumber?}`), and serialize the result as HTTP 201 JSON. Reject payloads >524KB with HTTP 418 Teapot.
- Implement admin `DELETE /api/reset-station/{stationId}?action=reset` requiring bearer token validation (Entra ID app role or symmetric JWT). Return HTTP 204 No Content.
- Serve the React build at `/{*path} → index.html`. The SPA fallback route handles any non-API path.

### Deliverables
- `/backend/src/carwash-api/Program.cs` — entrypoint with OpenAPI 3.1 auto-generation and W3C trace propagation exporters to Jaeger
- `/backend/src/carwash-api/Models/appstate.cs` — OpenAPI DTOs: `StationStatus`, `StationIdleState`, `StationWashingState`, `StationCleaningState`, `StationErrorState`, `UploadPayload`, `UploadedPhotoResponse`, `PaymentVerificationRequest/Response`
- `/backend/Mosquitto` binary embedded via NuGet or sidecared container for broker bridge

---

## Phase 2 — React PWA Frontend

### Goals
- Assemble the Vite + TypeScript + Tailwind project. Create `bento-grid.tsx` with CSS area definitions that implement a two-column responsive layout: left column fixed-width pinned station cards, right sidebar with event log that scrolls independently.
- Implement `StationCard.tsx` that renders a `<video>` element decoding base64 JPEG frames fetched from `/api/upload?station={id}&t={ts}`, overlays an animated WebSocket status ring (green pulsing when live), phase label (`ENTRY`, `WASHING`, `CLEANING`, `ERROR`) with color-coded pill, and scrollable gauge cards for PSI pressure (red >60, yellow <45) and soap level (green >55dm, yellow 35–55, red <35).
- Create the PWA service worker `/public/sw.ts` that caches-first for static assets (`/index.html`, `/offline.html`, fonts at `/assets/fonts.*`) and network-first for `/api/*` requests; degrades to polling every 3s when the WebSocket is down and re-connects automatically on `serviceWorker.update()` trigger.

### Deliverables
- `/frontend/tailwind.config.ts` — OLED dark palette tokens (`#0a0c10` background, `#688ef9` primary accent), 4×4px base grid spacing, Poppins + Inter font stack
- `/frontend/src/components/StationCard.tsx` — complete type-safe WebSocket payload handling with state machine (idle/connecting/open/error/closed)
- `/frontend/public/offline.html` — single-page fallback explaining offline status
- `/frontend/public/sw.ts` — complete service worker with `cache-first` static assets and network-first API requests

---

## Phase 3 — ESP32-CAM Edge Node with ESP-IDF

### Goals
- Write an ESP-IDF CMake manifest (`CMakeLists.txt`) for a `components/upload` peripheral driver that (a) opens the OV2640 camera via MIPI DSI, captures a JPEG frame to SPI flash (`vfr_capture_jpeg_frame()`), reads GPIO5 ADC rain sensor and GPIO6 analog water probe every 500ms, encodes frames as base64 (or raw binary over HTTP client library), then POSTs a multipart form payload to the backend `/api/upload` endpoint.
- Wire up Wi-Fi STA mode to connect to `wpa_supplicant:802.11` or a local WiFi hot spot, and connect to `mqtt://mosquitto.local:1883` over TCP.

### Deliverables
- `firmware/CMakeLists.txt` — ESP-IDF project manifest with camera port definitions and HTTP client integration (`http_client.h`)
- `firmware/components/upload/upload.c` — ESP-IDF C peripheral driver

---

## Phase 4 — Hosting

### Oracle ARM Free Tier → Azure Container Apps migration path
1. Build multi-stage OCI image `FROM gcr.io/oci-registry:ociimage-arm64:latest` on build stage (Alpine builder) → final stage `debian-slim` runtime with minimal OCI base (~94 MB compressed)
2. Push single OCI image to Oracle Cloud registry (`reg.oraclecloud.com/ocirepo/carwash`)
3. Deploy OCI ARM AMI with Docker-in-Docker sidecar or bare-metal container runtime; serve HTTP/WS on port 8080 behind Nginx
4. Once egress limits are exceeded (~$5/month), migrate to Azure Container Apps using the exact same image tag but repointing the `SPARKLEWASH_API_HOST` env var to the ACA app name

### Deliverables
- `/Dockerfile` OCI multi-stage build — Stage 1: Alpine (Vite build + tailwindcss), Stage 2: Debian 12 `slim` base with `apt-get install -y socat nodejs npm`
- `/Makefile.ci` CI pipeline that builds the React SPA, runs `dotnet publish /p:PublishDir=../build`, then tarballizes and pushes to OCI registry

---

## Sign-off Criteria

Backend must expose `/openapi/openapi.json` and Swagger UI at `/swagger` (or `/openapi/v1/ui`). Frontend must render live stream cards on `www.sparklewash.app` in landscape mode with status ring animation and offline fallback page. ESP firmware must successfully POST a multipart photo to the backend and receive HTTP 201, then close WebSocket connection or reconnect after 5s exponential backoff.

