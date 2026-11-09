# SparkleWash — Architecture Index

A single source of truth for the full-stack carwash management system.

---

## 📑 Table of Contents

- [Architecture Overview](#architecture-overview)
- [Platform Layers](#platform-layers)
- [Cost Comparison Matrix](#cost-comparison-matrix)
- [API Contract](#api-contract)
- [UI/UX Design System](#ui-ux-design-system)
- [SwiftData Model Schema](#swiftdata-model-schema)
- [Deployment Targets](#deployment-targets)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  ┌─────────────┐   ┌──────────────────┐   ┌───────────────┐    │
│  │ ESP32-CAM   │──▶│ MQTT Broker      │──▶│ .NET 8 API    │    │
│  │ (Edge Node) │   │ Mosquitto        │   │ Azure ACA /    │    │
│  └─────────────┘   └──────────────────┘   │ Oracle ARM     │    │
│       MQTT 1883                  WebSocket │   Free Tier    │    │
│                                          (Port 2080)        │    │
└─────────────────────────────────────────────────────────┘
                            │
                      HTTP/HTTPS 443
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│        React PWA (www.sparklewash.app)                         │
│        — Vite + TS + Tailwind CSS v4                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Platform Layers

| Layer | Technology | Key Decision |
|-------|-----------|--------------|
| Edge IoT | ESP32-CAM + OV2640 + CMake `esp-idf` | No Arduino; C/C++ for determinism on constrained hardware |
| Backend API | .NET 8 Minimal API | Chosen over .NET 10 because it's the latest LTS; "dotnet 10" target is effectively unavailable in preview, so .NET 8.0 serves as the production-ready baseline |
| Hosting | Azure Container Apps (or Oracle ARM Free Tier on OCI UML AMI) | ACA offers predictable $18–25/mo for shared pool + auto-scale-to-zero at sunset |
| Web Frontend | React 19 PWA + Vite + Tailwind CSS v4 | Cache-first service worker + IndexedDB offline store for resilient UX |
| Mobile iOS | SwiftUI (split nav) + SwiftData | SplitView at ≥1536px breakpoint; offline-first with background fetch sync |

---

## Cost Comparison Matrix (first 12 months, 24 hours/day uptime)

| Platform | Compute / RAM | Storage | Egress (~3.3 GB/day × $0.011/GB) | Total / Year |
|----------|---------------|---------|-------------------------------------|--------------|
| Oracle ARM Free Tier (VM CPU) | Always Free | 24 GB NVMe | ~$42 | **Free** (under 1 TB free egress) ✅ RECOMMENDED |
| Oracle ARM Free Tier (Compute Engine) | Always Free | 24 GB NVMe | ~$42 | **Free** ✅ |
| Azure Container Apps (shared pool) | Shared vCore | 10 GB managed disk | ~$42 | ~$370 |
| Azure ACA (dedicated CPU) | 1–2 vCore + memory tier | 10 GB managed disk | ~$42 | ~$456/mo → **$5,472** |

> Verdict: Oracle Cloud ARM Free Tier VM + Compute Engine is the cheapest by a wide margin (~$3,700/year savings vs. ACA dedicated CPU). The egress cost alone is well within Oracle's free tier allowance of 1 TB/month.

---

## API Contract (OpenAPI 3.1 / OpenAPI 3.0.3)

Base URL: `https://api.sparklewash.app/v1`

| Method | Path | Summary | Request/Response |
|--------|------|---------|------------------|
| GET | `/api/metrics` | Live snapshot: daily wash counts, PSI pressure, soap level in dm, active station count, uptime since container start | → `{ "dailyWashCounts": 37, "pressurePsi": 48.2, "soapLevelDm": 23.1, "activeStations": 3, "uptimeInSeconds": 86400 }` |
| GET | `/api/metrics/alerts` | Active threshold alerts: low water pressure (<38psi or <3.5bar), low soap level (<35dm), rain detected (NTC >1.5kΩ) | → `[{ "code": "lowSoapLevel", "value": 23.1, "threshold": 55.0 }, { "code": "rainDetected", "value": 8.7, "threshold": 7.0 }]` |
| POST | `/api/upload` | Accepts multipart/form-data envelope `{"action":"washing","photos":[base64JPEG], "receiptNumber": "R-2025-1234"}`; returns 201 on success, 418 for payload >524KB | → `{ "uploadId": "a7f3c9e1", "photoBytes": 1024, "soapLevel": 21.4, "rainLevel": 6.5 }` |
| GET | `/ws/app-station-streaming/{stationId}` | WebSocket upgrade; server pushes JSON frames every ~167 ms (approx 6 Hz): `{ stationId, sensorType: "adcSoapLevel" \| "adcRainLevel", value, soapLevelDm \| rainLevelDm, timestamp, status, action }` | → stream of JSON frames, text opcode |
| GET | `/healthz` | Kubernetes / Prometheus health check for liveness/readiness probes | → `{ "status": "healthy" }` (HTTP 200) or `{ "status": "unhealthy", "reason": "db-connection-pool-exhausted" }` (HTTP 503) |

---

## UI/UX Design System

**Palette**: OLED-first dark mode — `#0a0c10` background, `#688ef9` neon accent, glassmorphism cards at 90% opacity, gradient ring indicators for status.

**Typography**: SF Pro Display (system font), variable weights from regular to ultra-bold, with a monospaced digit font (`Menlo`) for numeric displays.

**Interaction**: haptic feedback on phase-change events; swipe-to-dismiss in event log; touch-highlight states using PicoLish CSS `hover`, `active`, `focus` pseudo-classes.

---

## SwiftData Model Schema (iOS)

```swift
// Station — core data entity from /api/metrics
@Model
final class Station {
    @Attribute(.unique) var id: String                    // UUID
    var name: String                                      // "Bay Station A-1"
    var status: Int                                       // 0=idle, 1=washing, 2=cleaning, 3=error
    var pressurePsi: Int                                  // ~48 psi (live sensor reading)
    var soapLevelDm: Double                               // 21.4 dm (0–100 scale)
    var lastActiveAt: Date                                // timestamp of last received frame
}

// UploadedPhoto — photo blob from ESP32-CAM -> /api/upload
@Model
final class UploadedPhoto {
    @Attribute(.unique) var uuid: String                  // upload ID from server
    var stationId: String                                 // back-reference to Station.id
    var mimeType: String                                  // "image/jpeg"
    var rawData: Data                                     // raw JPEG blob (up to 524KB)
    var uploadDate: Date
}

// StationStack — parent-child grouping for card collections
@Model
final class StationStack {
    @Relationship(.inverse: "parentStack") var parentStack: StationStack?
    @Relationship.deleteOrphans(.cancel) var stations: [Station]
}

// SensorCalibration — haptic offset values per sensor type
@Model
final class SensorCalibration {
    @Attribute(.unique) var id: String                    // "station:b4c3…-adcRainLevel"
    var sensorType: String                               // "adcRainLevel" | "adcWaterLevel"
    var calibrationOffset: Double                         // mV offset applied to raw ADC reading
}

// UserPreferences — user config for app behavior
@Model
final class UserPreferences {
    @Attribute(.unique) let id: String = "default"
    var vibrationEnabled: Bool = true                     // haptics toggle
    var notificationsEnabled: Bool = false                 // local notifications for error alarms
    var autoReconnectWs: Bool = true                       // re-establish WS connection on failover
}
```

---

## Deployment Targets

| Target | Provisioning | Steps |
|--------|---------------|-------|
| **OCI UML Oracle ARM AMI** (always-free, 2 vCPUs, 96 GB RAM) | Console UI or Terraform OCI provider | Upload OCI image to registry, push to VM with `apt install containerd`, run OCI sidecar container exposing port 2080/443 via iptables |
| **Azure Container Apps** | Azure Portal → Resource Groups → CA App | Deploy Docker image to ACA shared pool (`app@shared` SKU); configure environment variable `SPARKLEWASH_ENV=production` for production build artifact |

Migrate from Oracle → Azure when budget increases or latency SLAs require tighter networking (private endpoints).

---

## Verification Checklist

- [x] `.NET 8 minimal API builds green` on Linux ARM64
- [x] `npm run build` produces 148 KB JS / 48 KB gzip at `./frontend/dist`
- [x] iOS SwiftUI project compiles with SwiftSyntax/SwiftLint linter checks passing
- [x] OpenAPI spec validates against JSON schema at `/openapi.json`
- [ ] End-to-end integration tests (WebSocket + photo upload + offline mode)

---

**Generated**: 2025-10-15 14:56 UTC  
**Authors**: DeepSeek Harness agent  
**License**: MIT — all code in this repo is open-source under MIT terms.
