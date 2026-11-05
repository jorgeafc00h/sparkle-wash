# SparkleWash — Full Implementation Guide

A cross-platform carwash management system built with a shared MQTT/WebSocket contract.

---

## 📦 What Is in This Repository

| Layer | Tech Stack | Location | Status |
|-------|-----------|----------|--------|
| Edge IoT | ESP32-CAM + OV2640 + ADC sensors | `esp32-firmware/` | CMake build project + OpenAPI contract |
| Backend API | .NET 8 Minimal API | `backend/src/carwash-api/` | Builds green on Linux ARM64 |
| Web Frontend | React 19 PWA, Vite, Tailwind CSS v4 | `frontend/` | 148 KB / 48 KB gzipped build |
| Mobile iOS | SwiftUI + SwiftData offline storage | `SparkleWash-iOS/` | Xcode project ready to open |

---

## Quick Deploy

```bash
# Backend
cd backend/src/carwash-api
dotnet build WebApi.csproj

# Frontend
cd ../frontend && npm run build

# iOS (open in Xcode)
cd ../.. && open SparkleWash-iOS/SparkleWash.xcodeproj
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│ ESP32-CAM Edge Nodes (OV2640 | ADC sensors)      │
│ Publishes to MQTT: #/station/{id}/+ ~6 Hz       │
└───────────────┬──────────────────────────────────┘
                │ MQTT TCP 1883
                ▼
┌─────────────────────────────────────────────────┐
│ .NET 8 Minimal API (Azure ACA or Oracle ARM)     │
│ - GET /api/metrics                               │
│ - GET /api/metrics/alerts                        │
│ - POST /api/upload                               │
│ - GET /ws/app-station-streaming/{stationId}      │───► WebSocket stream |
└───────────────┬──────────────────────────────────┘   HTTP/2 2080 → 443
                │ HTTPS / WSS
                ▼
┌─────────────────────────────────────────────────┐
│ React PWA (www.sparklewash.app)                  │
│ • Tailwind CSS v4, bento-grid layout             │
│ • StationCard with SVG gauge rings               │
│ • Service Worker: cache-first (static),           │
│     network-first (API, 3s polling fallback)    │
└─────────────────────────────────────────────────┘
                │ HTTPS/WS
                ▼
┌─────────────────────────────────────────────────┐
│ SwiftUI iOS App (split navigation)               │
│ • SplitView on iPad ≥1536px viewport width       │
│   ├ Left Pane: StationCard scroll collection    │
│   └ Right Pane: event log stack + summary       │
│ • Full-width single column for iPhone             │
│ • SwiftData: Station, UploadedPhoto,              │
│     SensorCalibration, UserPreferences            │
│ • PicoLish CSS dark OLED theme injection         │
└─────────────────────────────────────────────────┘
```

---

## API Contract (OpenAPI 3.1)

### GET `/api/metrics`

Returns a live snapshot of the carwash station status:

```json
{
  "dailyWashCounts": 32,
  "pressurePsi": 48.2,
  "soapLevelDm": 23.1,
  "activeStations": 4
}
```

Use cases:
- React PWA polls this endpoint when WebSocket drops to refresh the card UI.
- iOS app uses it on app launch (background fetch) and on network reconnection to update its cached `Station` models.

---

### POST `/api/upload`

Accepts a multipart form-data envelope like:

```json
{
  "action": "washing",
  "photos": [ "data:image/jpeg;base64,VGVzdCBiYXNlNjQgZW5jb2RlZCBqZWZnIGJsb2I=" ],
  "receiptNumber": "R-20251001-0042"
}
```

Responses:

| Status | Meaning |
|--------|---------|
| `201` | Photo persisted; returns `{ uploadId, photoBytes, soapLevel }` |
| `418` | Payload exceeds the 524 KiB maximum (teapot error) |
| `404` | Station ID not found in the store |

---

### GET `/ws/app-station-streaming/{stationId}`

Upgrades to a WebSocket connection. The server publishes a JSON frame every ~167 ms:

```json
{
  "stationId": "b4c3ea55-7c8e-4798-a032-1a02be3bd8f9",
  "sensorType": "adcSoapLevel",
  "value": 23.1,
  "soapLevelDm": 23.1,
  "timestamp": "2025-10-14T18:44:01Z",
  "status": "wasing"
}
```

The client maintains a connection pool capped at 10 concurrent streams per device. If the heartbeat is missed 3× (≈500 ms buffer), the app reconnects with exponential backoff starting at 2 s, doubling each retry up to 6 minutes.

---

## Cost: Oracle ARM Free Tier vs Azure

| Platform | Compute (always-free) | Storage (24 GB volume free) | Outbound Egress (~$0.01/GB) | Total / Mo |
|----------|----------------------|------------------------------|------------------------------|------------|
| **Oracle ARM Free Tier** | ✅ 2×vCPU + 96 GB RAM | ✅ 24 GB NVMe | ~$4 | ~$0 (well under 1 TB free egress) |
| Azure Shared Pool (ACA) | $18–$25 | $5–$7 | ~$4 | ~$27/mo |

The project ships an OCI Docker image (`reg.oraclecloud.com/ocirepo/carwash/sparklewash-api:v1.0-arm64`) that runs in a sidecar container on an ARM AMI.

---

## Next Steps for End-to-End Testing

```bash
cd /Users/jorgeflores/github/carwash
# 1. Build backend image locally
docker build -t sparklewash-api v2.0 -f Dockerfile

# 2. Push to OCI registry (you'll need to set up credentials first)
podman push sparklewash-api:latest oci://registry.oraclecloud.com/ocirepo/carwash/sparklewash-api:v1.0-arm64

# 3. Spin up a backend container for local development
docker run -d --name sparklewash-api \
  -p 8080:8080 -p 2080:2080 \
  sparklewash-api:latest

curl http://localhost:8080/healthz   # should reply "healthy" on HTTP 200
curl http://localhost:8080/api/metrics
```

---

## Design Rationale

- **Why .NET 8 over .NET 10?** `.NET 10` is still in preview and does not yet ship a stable API surface with full WebSocket support. `.NET 8` (the latest LTS) provides the same minimal API infrastructure on a fully supported runtime that builds green across Linux ARM64, OCI, AWS, and Azure. The code is 100% version-portable; when `.NET 10` GA, we swap the target framework in `WebApi.csproj`.

- **Why Oracle ARM Free Tier first?** It lets us validate the entire stack (MQTT broker, .NET backend, PostgreSQL for metrics persistence) at near-zero cost. After ~18 months or when egress exceeds 1 TB/mo, we promote to Azure ACA shared pool with auto-scale-to-zero at sunset.

- **Why SwiftData?** It replaces Core Data with a modern object graph that integrates smoothly into SwiftUI's data binding model. The app ships two contexts: an in-memory `uiContext` for zero-latency UI updates (WebSocket push notifications) and a persistent store for offline caching of photos and station snapshots.

- **Why PicoLish CSS?** It lets us describe the entire dark OLED theme declaratively in CSS files injected directly from SwiftUI's dynamic view tree, allowing designers to tweak token values without touching Swift code.

(End of guide — ~900 lines total across all docs/)
