# Phase 6 — Complete: Oracle Cloud ARM64 (OCI UML) Deployment

## Summary

Phase 6 documents the end-to-end deployment of Car Spa to Oracle Cloud's
**Universal Linux Machine (UML)** on the ARM64 free tier. This is the cheapest
option at **~$5/month** compared to Azure Container Apps (~$18–30/month).

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Oracle UML ARM64 UML (free tier: 2 vCPU, 180GB storage)       │
├─────────────────────────────────────────────────────────────────┤
│  Container Registry (OCI Registry)                              │
│   • dockerd + systemctl (systemd unit: sparklewash.service)     │
│   • Dockerfile: multi-stage linux-arm64 build target           │
├─────────────────────────────────────────────────────────────────┤
│  systemd unit (sparklewash.service)                            │
│   • Restarts container on failure                              │
│   • Reloads on image redeployment                             │
├─────────────────────────────────────────────────────────────────┤
│  Reverse Proxy (Caddy/Nginx) — HTTPS/TLS + static SPA         │
├─────────────────────────────────────────────────────────────────┤
│  .NET 10 API (Program.cs)                                       │
│   • Minimal API with WebSocket upgrade + long-poll fallback    │
│   • /api/metrics, /api/metrics/alerts                          │
│   • /ws/station-streams/:id (binary frames, opcode 1 = JSON)   │
├─────────────────────────────────────────────────────────────────┤
│  React PWA Vite (served from backend/wwwroot)                  │
│   • Installable, offline-first, service worker cache-first      │
└─────────────────────────────────────────────────────────────────┘

Data Flow:
  ┌────────────┐   MQTT (WS-bridged binary frames)   ┌────────────┐
  │  ESP32-CAM │ ──────────────────────────────────▶   .NET 10 API │
  │  OV2640    │                                          │  Minimal API  │
  │  ADC rain  │  re-broadcast JSON events to WS            │  WebSockets   │
  │  float sw  │  (per station, filtered on client side)    │  → PWA React  │
  └────────────┘                                          └────────────┘
```

### Cost Comparison

| Provider      | Type                   | Monthly Cost     | Notes                                    |
|---------------|------------------------|------------------|------------------------------------------|
| **Oracle UML** | ARM64 free tier (UML)  | ~$5| Cheapest. ARM-based VM with systemd.    |
| Azure CA      | Managed Kubernetes     | ~$18–30         | Fully managed, complex setup            |
| AWS Lambda    | Pay-per-invocation     | ~$0–7           | Hard to use with WebSocket streaming    |
| Google Run    | Container              | ~$30–50         | Pay-per-request, harder with WS         |

### Files

| File | Purpose |
|------|---------|
| `backend/Dockerfile` | ARM64 multi-stage build (.NET + React from wwwroot) |
| `backend/src/CarWash.Api/Program.cs` | Minimal API host + WebSocket + long-poll fallback |
| `backend/MockSensorService.cs` | Simulates MQTT sensor readings |
| `docs/api.yaml` | OpenAPI 3.1 contract (machine-readable) |
| `docs/PHASE-6-DEPLOYMENT.md` | This document |

### Next Phase

Phase 7 — ESP32-CAM edge: OV2640 + ADC rain gauge wiring, firmware, and MQTT bridge.
