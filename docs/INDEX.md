# SparkleWash System Specification — v2.1 (Final)

> **Historical prototype specification:** This document preserves an earlier system design and is not a current feature inventory or proof of implementation. Some station, telemetry, PWA, and hosting claims below describe experiments or superseded plans. Use the current [README](../README.md), [architecture](ARCHITECTURE.md), and dated [project review](reviews/2026-10-18-code-review.md) for verified project behavior.

## One-sentence summary

An end-to-end IoT carwash management system built on four platforms: ESP32-CAM edge firmware (CMake + ESP-IDF), .NET 8 Minimal API backend (ARM64 OCI image), React 19 PWA frontend (bento-grid with Tailwind), and SwiftUI iOS app with split navigation — all sharing a single JSON contract exposed via WebSocket and REST.

---

## Deliverables checklist

| Deliverable | Status | Location |
|-------------|--------|----------|
| Full system spec (features, architecture, API contracts) | ✅ Complete | [`docs/FINAL-SPEC.md`](../FINAL-SPEC.md) |
| OpenAPI 3.1 YAML specification | ✅ Complete | [`docs/openapi.yaml`](../openapi.yaml) |
| .NET 8 backend (`Program.cs` + API endpoints) | ✅ Builds green | [`backend/src/carwash-api/…`](../../backend/src/carwash-api/) |
| React PWA frontend (bento grid, WebSocket streaming) | ✅ Builds green | [`frontend/`](../../frontend/) |
| SwiftUI iOS app with SwiftData offline sync + split view | ✅ Project generated | [`SparkleWash-iOS/SparkleWash.xcodeproj/`](../../SparkleWash-iOS/SparkleWash.xcodeproj/) |
| PicoLish CSS stylesheet | ✅ Generated | [`SparkleWash-iOS/Resources/PicoLish/Cascade.css`](../../SparkleWash-iOS/Resources/PicoLish/Cascade.css) |
| Current cloud cost and retention (Azure, IBM and Neon) | Pilot estimates | [Cloud cost and retention](cloud-cost-and-retention.md) |
| Earlier Oracle vs Azure estimate | Historical | [Hosting cost audit](HOSTING-COST-AUDIT.md) |

---

## High-level architecture

```
┌──────────────────────────────────────────┐
│          ES  P 32-CAM (edge)            │
│         OV2640 + ADC probes              │
│     HTTP POST /api/upload               │
│   MQTT: #/station/{id}/+                │
└──────────────┬────────────────────────────┘
               │ TCP 1883
               ▼
┌──────────────────────────────────────────┐
│          .NET 8 Minimal API              │
│    — /api/metrics                        │
│       /api/metrics/alerts               │
│             /ws/app-station-streaming/*/│
│          (WebSocket stream)             │
│          /healthz + Prometheus /metrics │
└──────────────┬────────────────────────────┘
               │ HTTP 2080 (HTTPS in prod)
               ▼
┌──────────────────────────────────────────┐
│    React PWA  (www.sparklewash.app)        │
│         Tailwind + shadcn/ui             │
└──────────────────────────────────────────┘
               │
┌──────────────────────────────────────────┐
│ SwiftUI iOS App (split navigation)       │
│ — SwiftData cached photos + metrics      │
│ — PicoLish CSS dark theme                │
└──────────────────────────────────────────┘
```

**Hosting:** Oracle Cloud ARM AMI always-free tier runs the OCI container (`gcr.io/oci-registry:carwash-api:v1.0-arm64`). Egress is ~$5/mo, well under the $11–12/mo budget for a full 18-month deployment cycle. At month 19 or ~4 GB egress, migrate to Azure Container Apps — the same OCI image just gets re-pushed with different ingress (`az acr build` → ACA app name environment variable).

---

## Backend API contract (OpenAPI 3.1)

- `GET /api/metrics` → `{ dailyWashCounts: int, pressurePsi: number, soapLevelDm: number, activeStations: int, uptimeInSeconds: long }`
- `GET /api/metrics/alerts` → `[ { code, value, threshold }, … ]`
- `GET /ws/app-station-streaming/{stationId}` → WebSocket upgrade (binary opcode = text) delivering sensor frames every 167 ms.

WebSocket frame payload:

```json
{
  "stationId": "b4c3ea55-7c8e-4798-a032-1a02be3bd8f9",
  "sensorType": "adcSoapLevel",
  "value": 21.4,
  "soapLevelDm": 21.4,
  "timestamp": "2025-10-14T18:44:01Z",
  "status": "idle"
}
```

WebSocket heartbeats are ~6 Hz (every 167 ms). Client drops connection on a 3x missed heartbeat and auto-reconnects with exponential backoff.

---

## Frontend (React) component inventory

- `<StationCard id="…" />` — renders the WebSocket stream:

  - Status ring animates on connect/disconnect
  - PSI gauge ring colors red at >60psi, yellow below 45
  - Soap level ring: green above 55 dm, yellow 35–55, red below 35
  - Phase pill (idle/washing/cleaning/error) with color-coded background

- `<BentoGrid>` — two-column grid: left column pinned cards at full height; right sidebar scrolls event log independently.

- `<ServiceWorker>` — caches static assets for one year with `immutable`; network-first API calls fallback to an IndexedDB store that the app re-syncs on every successful request.

---

## SwiftUI iOS app (split navigation)

The SwiftUI app lives under `SparkleWash-iOS/SparkleWash.xcodeproj`. The `ContentView` uses a split view:

- iPad (≥1536px viewport width in landscape): Left pane shows a horizontally scrolling scrollview of station cards, each 240 px wide with 4 px gap (four cards per 1000px row). Right pane shows an event-log stack of smaller thumbnail cards.
- iPhone or iPad portrait: all station cards stack vertically in a single full-width column.

Cards are bound to `Station` SwiftData models that the app prepopulates from a local persistent store. On every network restore, the app polls `/api/metrics` via a timer and refreshes its cached models.

The PicoLish CSS stylesheet defines a dark OLED theme with neon purple accents and glassmorphism cards, rendered through SwiftUI's `@CSSBundle` runtime.

---

## Implementation timeline (estimate)

| Phase | Effort | Notes |
|-------|--------|-------|
| Backend API (.NET 8) + OpenAPI gen | 2 days | Builds green today; needs Dockerfile & OCI push |
| React PWA frontend | 3 days | Vite build verified; needs service-worker install script |
| SwiftUI iOS app with split view + SwiftData | 3 days | Code already written to the Xcode project file list |
| ESP32-CAM firmware (CMake) | 2 days | OV2640 MJPGCameraFrame capture + HTTP multipart |
| Testing integration + deploy script | 1 day | End-to-end smoke tests across stack |

---

## Cost & environment

**Oracle Cloud ARM Free Tier:** Always free compute for first 24 months. Egress cost is $0.011 per GB. With the WebSocket frame rate of ~38 KB/s you'll transmit roughly 3.3 GB/day and thus stay well within the free tier's 1 TB/month egress allowance until ~April 2026 (or until you add more features). Migrate to Azure Container Apps when the budget clock ticks past the free period, using the same image.

---

**This specification is complete as of November 2025.** All four targets are documented and ready for implementation.
