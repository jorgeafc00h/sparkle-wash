# SparkleWash: Complete System Specification — v2.1

**Date:** 2025  
**Status:** Complete specification. Ready for implementation across all four platforms.

---

## Executive Summary

SparkleWash is a real-time IoT carwash management system with four coordinated platform layers:

| Layer | Platform | Role |
|-------|----------|------|
| **Edge IoT** | ESP32-CAM (OV2640 + ADC rain/water probes) | Captures live camera frames, sensor readings, sends JSON over MQTT→WebSocket |
| **Backend API** | .NET 8 Minimal API (ARM64), ASP.NET 8 | Subscribes to MQTT topics, re-broadcasts JSON frames over WebSocket; serves OpenAPI 3.0 |
| **Frontend Web** | React 19 + Vite + Tailwind CSS | PWA with bento-grid live feed, WebSocket status ring, gauge cards (PSI pressure, soap level) |
| **Mobile Native iOS** | SwiftUI + PicoLish CSS | Split-view iPad dashboard, iPhone full-width card view, SwiftData local caching for offline mode |

---

## Architecture Overview

```
┌─────────────────────────────┐      ┌─────────────────────────────┐
│   ESP32-CAM (OV2640 + ADC) │ TCP  │ MQTT Broker (Mosquitto)    │
│   — HTTP multipart photos   │1883  │                             │
│   — MQTT JSON frames        │       └──────────┬─────────────────┘
└──────────────┬──────────────┘                  │ TCP/1883         │
               │                                 ▼                  │
┌──────────────▼──────────────┐    ┌─────────────────────────────┐ │
│  .NET 8 Minimal API         │ HTTP│ WebSocket:8080 /ws/station │ ◄── Browser PWA React + SwiftUI WebView
│  — ASP.NET OpenApi          │      └────────────┬──────────────┘ │ (optional for internal apps)
│  — /api/metrics, /api/upload│                  │                  │
│  — W3C trace propagation    │                  ▼                  │
│  — Prometheus metrics       │          ┌─────────────────────────┐
└──────────────┬──────────────┘ HTTP 2080      │   React PWA        │
               │ WebSocket                        │   (Vite + Tailwind)   │
┌──────────────▼──────────────┐      ┌──────────▼───────────────┐ │
│   React PWA Frontend       │ HTTP 443 │ Oracle ARM Free Tier   │ │
│   — Bento Grid live feed   │    8080  │   (or Azure ACA later) │ │
│   — StationCard components │          └───────────────────────┘ │
│   — Service Worker cache   │                                     │
└────────────────────────────┘                                     │
                                                                   │
┌─────────────────────────────────────────────────────────────────┘
```

---

## Platform 1: ESP32-CAM Edge Firmware

**Hardware:** ESP32-CAM dev module, OV2640 camera sensor, GPIO5 (ADC rain probe), GPIO6 (analog water level).

**Firmware:** CMake-based ESP-IDF project. No Arduino. Sends JSON frames over MQTT to `#/station/{id}/+/+` topic. Each frame encodes a JPEG + base64-encoded ADC readings.

### Deliverables

- `esp32-firmware/CMakeLists.txt` — CMake manifest with camera peripheral driver
- `esp32-firmware/main.c` — Main logic: captures OV2640 JPEG frame, reads ADC rain/water probes every 500ms, posts to MQTT topic `/station/${CONFIG_STATION_ID}/+`, then POSTs the raw JPEG binary to HTTP endpoint `/api/upload` for persistence.
- `esp32-firmware/flash.sh` — ESP-IDF flash script

### MQTT Payload (JSON)

```json
{
  "stationId": "b4c302",
  "sensorType": "adcRainLevel",
  "value": 6.5,
  "rainLevelDm": 89,
  "timestamp": "2025-10-14T18:44:01.123Z",
  "status": "idle",
  "action": "washing"
}
```

**Message rate:** ~6 Hz (one JSON frame every ~167ms = 6 frames/s, but we publish one every 500ms; WebSocket heartbeat is ~6× slower at 38 KB/s). The image is captured once per wash action and POSTed as multipart/form-data with `Content-Type: multipart/form-data; boundary=----WebKitFormBoundary` header.

---

## Platform 2: .NET 10 Minimal API Backend

**Runtime:** ASP.NET 7.0, dotnet 8, minimal API server on `http://0.0.0.0:8080`.

**Hosting:** `dockerfile` builds a multi-stage image (Alpine builder → Debian Slim runtime) and pushes to OCI registry at `reg.oraclecloud.com/ocirepo/carwash/sparklewash-api:v1.0-arm64`.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/metrics` | Returns live metrics snapshot (dailyWashCounts, pressurePsi, soapLevel, activeStations, uptimeInSeconds) |
| GET | `/api/metrics/alerts` | Returns array of active alerts (lowSoapLevel, pressureDrop, rainDetected) |
| GET | `/ws/app-station-streaming/{stationId}` | WebSocket upgrade endpoint. Server pushes JSON frames (text, opcode=1) at 167ms heartbeat interval. |
| POST | `/api/upload` | Accepts multipart/form-data from ESP32-CAM; decodes envelope (`{action, photos[], receiptNumber?}`); persists images + writes to metrics store; returns 201 JSON or 418 Teapot if payload >524KB |
| GET | `/healthz` | Prometheus health check endpoint for K8s liveness probe |

#### WebSocket Frame Payload (JSON)

```json
{
  "stationId": "b4c302",
  "sensorType": "adcSoapLevel",
  "value": 21.4,
  "soapLevelDm": 21.4,
  "timestamp": "2025-10-14T18:44:01Z",
  "status": "idle" // or "washing", "cleaning", "error"
}
```

#### API Response Schemas

**GET /api/metrics (200)** — Returns `MetricsSnapshot`:
```json
{
  "dailyWashCounts": 32,
  "pressurePsi": 48.2,
  "soapLevel": 23.1,
  "activeStations": 4
}
```

**GET /api/metrics/alerts (200)** — Returns array of `MetricAlert`:
```json
[
  {"code": "lowSoapLevel", "value": 23.1, "threshold": 55.0},
  {"code": "pressureDrop",   "value": 34.0, "threshold": 38.0}
]
```

**POST /api/upload (201)** — Returns:
```json
{
  "uploadId": "a7f3c9e1-4b2f-4d8a-9c3e-1f5b7a2d9e8c",
  "photoBytes": 1024,
  "soapLevel": 21.4,
  "rainLevel": 6.5
}
```

**Error Codes:**

| Status | When |
|--------|------|
| 404 | Invalid `stationId` UUID |
| 418 | Multipart upload payload exceeds 524KB |
| 429 | Too many concurrent WebSocket connections (default: 10) |
| 500 | Internal broker/worker failure |

### OpenAPI 3.0 Specification

See `docs/openapi.yaml` — generated by `Microsoft.AspNetCore.OpenApi` at runtime and exposed as `/openapi.json`. It also generates a Swagger UI at `/swagger` for manual testing.

---

## Platform 3: React PWA Frontend — Web Browser Layer

**Stack:** React 19 TypeScript, Vite 5, Tailwind CSS 4, shadcn/ui primitives, `react-use`, `useWebSocket` (custom impl wrapping the WebSocket API).

**Build target:** Single-page app served by Nginx or Caddy reverse proxy; SPA fallback serves `index.html` for all routes. Service worker handles offline caching (cache-first for static assets, network-first but with 3s polling fallback to `/api/metrics`) and offline detection page (`offline.html`).

### Components

- **`StationCard`** — Renders a live WebSocket stream: status ring animation (green pulsing when connected), phase label (idle/washing/cleaning/error in color-coded pills: green/red/yellow/blue), embedded JPEG video element decoding `/api/upload?station={id}&t={ts}`, and gauge cards for PSI pressure (>60 red, <45 yellow) and soap level in decimeters (green >55dm, yellow 35–55, red <35).
- **`BentoGrid`** — Two-column responsive grid: left column fixed-width pinned station cards, right sidebar scrolling event log.
- **`DashboardSkeleton`** — SDFs that render while waiting for the first WebSocket frame to arrive.
- **`StationReset`** — Admin-only bearer token-protected reset endpoint POST `/api/reset-station/{stationId}` with action: wash/charge.

### PWA Manifest (`manifest.json`)

```json
{
  "name": "SparkleWash Carwash Monitor",
  "short_name": "SparkleWash",
  "start_url": "/",
  "display": "standalone",
  "theme_color": "#111827",
  "background_color": "#0a0c10",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

### Service Worker (`sw.js`)

Cache-first strategy for static assets (`/index.html`, `/offline.html`, `/assets/fonts.*`, JS + CSS) with a max-age of one year and `immutable` directive. Network-first for `/api/*` requests, falling back to an IndexedDB cache if the WebSocket is down. Polling interval of 3 seconds on fallback to keep the UI alive when MQTT brokers drop.

---

## Platform 4: SwiftUI iOS App (iOS 18+) — Mobile Native Layer

**Stack:** SwiftUI 5.2+, Swift 6, CoreData/SwiftData for local storage, `Combine` or async/await for WebSocket API calls, PicoLish CSS framework for styling, Vision Pro spatial rendering for ARKit integration.

### Architectural Stack

| Concern | Technology |
|---------|------------|
| UI framework | SwiftUI (split view nav) |
| Local DB | SwiftData Model + persistent container |
| Network calls | `URLSession` async/await with background download session |
| WebSocket | Custom `WebSocketClient` wrapper using URLSession or SwiftConcurs' WebSocketKit |
| Styling | PicoLish CSS framework (dark OLED palette, glassmorphism cards) |
| Spatial/Augmented | ARKit via `ARSCNView`, Live Captions for live transcription of station events spoken out loud |

### Project Structure

```
SparkleWash-iOS/
├─ SparkleWashApp.swift                     # App entry point (split view nav root)
├─ SparkleWashApp.swift                     # SwiftUI app host
├─ Models/
│   ├─ Station.swift                         # SwiftData entity mapping API schema
│   ├─ PhotoSnapshot.swift                   # Entity: photoUrl, timestamp, stationId
│   └─ Calibration.swift                     # Entity: sensorId, calibrationOffset
├─ Views/
│   ├─ ContentView.swift                     # Root split view (iPad), full-width iPhone
│   ├─ StationCard.swift                     # Live card rendering WebSocket JSON frames
│   ├─ GaugeView.swift                       # PSI and Soap level gauge arcs
│   ├─ UploadView.swift                      # Photo upload progress bar + action buttons
│   ├─ CalibrationView.swift                 # Haptic sliders for sensor calibration
│   └─ OfflineView.swift                     # SwiftData read-only mode UI when network is down
├─ Resources/
│   ├─ assets.xcassets/
│   │   └─ AppIcon.appiconset/              # 192x192, 1024x1024
│   └─ PicoLish-CascadeCSS.ips               # SwiftUI CSS injection (dark OLED)
└─ SparkleWashDataModel.swift                # Schema registration for SwiftData
```

### Split Navigation — iPad Layout

iPad layout splits left-right at 1536px viewport width (or 40% of main screen). Left pane shows a horizontal scroll collection pinned to the left edge: each card is 240px wide with 4px gap (matches `var space-` token). Right pane scrolls independently and shows a stack of event-log cards rendered via PicoLish CSS flexbox.

The split view adapts gracefully when rotating the device or resizing the window. Cards render their own inner layout: status ring (CSS animation), phase label pill (green/red/yellow/blue tokens), gauge arcs (`stroke-linecap: round`), action buttons (`button-style: outline` with 5px border radius, 8px gap to adjacent controls).

### iPhone Layout — Full-Width Cards

On iPhone, cards stack vertically occupying full width. The `ContentView` body conditionals on `environment(\.screenEdgeEffect) == .standard` using either full-width or a split layout at the breakpoint of 1536px. Below 834px (iPhone SE), font size tokens are reduced by one scale (12px base).

### PicoLish CSS Styling Tokens

| Token | Value |
|-------|-------|
| `--bg-primary` | `#0a0c10` (OLED black) |
| `--bg-card`     | `#111827` (glassmorphism overlay 10%) |
| `--bg-surface` | `#1f2937` |
| `--primary`     | `#688ef9` (neon purple accent) |
| `--success`     | `#00e676` (soap level good) |
| `--warning`     | `#ffc107` (soap mid-range) |
| `--danger`      | `#d32f2f` (PSI pressure >60psi) |
| `--space-unit`  | `0.25rem` (4px base, scale: 2) |

PicoLish is a CSS-in-SwiftUI style sheet: you write normal Tailwind-like utility classes (via the framework's runtime CSS generator) and inject them as a `CSSBundle` at app launch. The framework then renders them directly from the view tree via `modifier` closures, so no separate `.css` files need to be shipped.

### Offline Mode & SwiftData Sync

When the WebSocket drops, the `StationCard` enters **offline mode**: it reads its cached photos from SwiftData and renders thumbnails from the local blob store. When connectivity returns, a background task queues any new frames that were uploaded but not yet persisted in the API. The sync mechanism polls `/api/metrics` every 3s when offline and pushes cached snapshots back to the server via `URLSession.dataTask` POST with `multipart/form-data`.

### Haptics & Vibration Feedback

When a new wash phase completes, the app triggers a haptic vibration (`.trigger() = .success(.light)`). The user can configure this in Settings (toggleable per station). The API exposes a haptic endpoint `POST /haptics/station/{id}` that returns a vibration pattern object for client consumption.

---

## Cost & Hosting Recommendation

**Platform 1: Oracle Cloud ARM Free Tier** (Always-free, $0/mo). 2 OCPU vCPUs (+96 GB RAM), 24 GB block volume, 10 Gbps egress bandwidth. Your container at `reg.oraclecloud.com/ocirepo/carwash/sparklewash-api:v1.0-arm64` costs only egress ($0.011/GB). WebSocket frames at ~38 KB/s (~0.33 GB/day = $0.01/day = $0.32/mo total outbound). You are well within the 10 Gbps free egress limit, so your bill is effectively $0/month for compute + < $5/mo total (egress only if you exceed the free tier's 10 TB bandwidth — unlikely unless traffic spikes).

**Platform 2: Azure Container Apps** ($18–$25/mo on shared pool, auto-scales to zero at sunset, 18-month free tier). Migrate when Oracle's free period ends or if latency SLAs become too strict. The OCI→ACA migration path requires only reassigning the hostname in the ACA environment variables; the image does not change.

**Recommendation:** Start on Oracle ARM Free Tier for $0 compute cost. In 18 months or when egress exceeds 1 TB, migrate to ACA. Documented migration steps live in `docs/DEPLOY.md`.

---

## Complete API Contract (OpenAPI 3.1)

See `docs/openapi.yaml` — it defines:

- `GET /api/metrics` → `200 OK` returns `{ dailyWashCounts, pressurePsi, soapLevel, activeStations, uptime }`
- `GET /api/metrics/history/{date}` → Returns an array of `{ date, washCount }` objects.
- `POST /api/upload` — multipart request body: `action` (string), `photos[]` (base64-encoded JPEG blobs), and optional `receiptNumber`. Returns `201` with uploaded photo list or `418` for payload >524KB. Supports bearer token auth via `Authorization: Bearer $TOKEN` header.
- `GET /ws/app-station-streaming/{stationId}` — WebSocket upgrade endpoint. Server sends periodic JSON frames (text, opcode=1) with the station's sensor readings. WebSocket heartbeat is 167ms (approx ~6 Hz). The client must set `Connection: Upgrade; upgrade=websocket` and `Content-Type: application/json`.
- `GET /healthz` — Health endpoint for Kubernetes liveness/readiness probes, returning `{ "status": "healthy" }`.

---

## Implementation Roadmap

| Phase | Deliverable | Duration |
|-------|-------------|----------|
| Phase 1 | Backend: .NET 8 Minimal API + OpenAPI 3.1 generation + WebSocket streaming | 2 days |
| Phase 2 | Frontend: React PWA with bento-grid, service worker, StationCard components | 3 days |
| Phase 3 | ESP32-CAM firmware (CMake project) — OV2640 JPEG capture + ADC reads + MQTT + HTTP upload | 2 days |
| Phase 4 | iOS SwiftUI app with split navigation, SwiftData caching, WebSocket client, PicoLish CSS styling | 3 days |
| Phase 5 | Dockerfile multi-stage build → OCI registry push → Oracle ARM AMI deployment | 1 day |
| Phase 6 | End-to-end integration: upload photo via HTTP, receive JSON over WebSocket, render in StationCard, verify offline caching | 1 day |

**Total estimated effort:** ~12 hours (solo) or 2–3 days (team). All four platforms compile/build green by end of Phase 4.

---

## Verification Checklist

- [ ] `dotnet build backend/src/carwash-api/WebApi.csproj` → exit code 0
- [ ] `npm run build` at `/frontend` → exit code 0 (148 kB JS / 48 kB gzip)
- [ ] `tsc --noEmit` on React frontend project → no TypeScript errors
- [ ] WebSocket heartbeat: measure client-side receive rate = ~6 frames/s (interval 167 ms)
- [ ] PSI gauge threshold: red when >60psi, yellow <45psi. Soap level: green >55dm, yellow 35–55, red <35dm.
- [ ] Offline mode: Service worker caches static assets; PWA `navigator.onLine` toggled → app remains functional on cached data.
- [ ] iOS split navigation layout switches from full-width single-column to split grid at viewport width ≥1536px.
- [ ] Offline mode renders previously-uploaded photos from SwiftData cache when network toggle is toggled OFF.
- [ ] Haptic vibration triggers on phase change events (configurable).

---

## Appendix: Project File Layout

```
carwash/
├── docs/
│   ├── FINAL-SPEC.md                    # THIS DOCUMENT
│   ├── openapi.yaml                     # OpenAPI 3.1 spec for .NET API
│   ├── DEPLOY.md                        # OCI → ACA migration steps
│   └── INDEX.md                         # Overview README
├── backend/
│   └── src/carwash-api/
│       ├── WebApi.csproj                 # Target: net8.0, Microsoft.AspNetCore.OpenApi 8.x
│       ├── Program.cs                    # .NET 8 entry point with endpoints
│       ├── Models/Models.cs              # Record types (MetricsSnapshot, MetricAlert, SensorFrame)
│       └── Components/MetricsStore.cs    # Singleton in-memory store + snapshot generation
├── frontend/
│   ├── package.json
│   ├── tailwind.config.ts                # Dark OLED palette tokens
│   ├── components/StationCard.tsx        # WebSocket payload + state machine
│   ├── public/offline.html
│   └── public/sw.js                      # Service worker (cache-first / network-first)
├── esp32-firmware/
│   ├── CMakeLists.txt
│   ├── main.c
│   └── components/upload/upload.c        # ESP-IDF upload driver
└── SparkleWash-iOS/
    ├── SparkleWashApp.swift
    ├── Models/Station.swift
    ├── Views/StationCard.swift
    └── SparkleWashDataModel.swift
```

---

**End of document.**

(End of file - total 321 lines)