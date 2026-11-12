# Phase 5 — Complete: .NET 10 Backend API

## Summary
Phase 5 implements the full .NET 10 backend for Car Spa:

| File | Purpose |
|------|---------|
| `backend/Program.cs` | Minimal API host with CORS, background worker registration, WebSocket upgrade |
| `backend/CarWash.Api.csproj` | SDK-style project file with Swashbuckle + MQTTnet |
| `backend/src/CarWash.Api/Controllers/MetricController.cs` | Implements GET /api/metrics + GET /api/metrics/alerts |
| `backend/MockSensorService.cs` | Simulates the MQTT sensor reading payloads |
| `docs/API-CONTRACT.md` | OpenAPI 3.1 contract documenting all endpoints |
| `docs/PHASE-5-COMPLETED.md` | (this file) Summary of what was built |

## API Endpoints
- `GET /api/metrics` — Live metrics for dashboard gauges.
- `GET /api/metrics/alerts` — Active alerts (low soap, pressure drop).
- `WS GET /ws/app-station-streaming/:stationId` — Binary WebSocket re-broadcast of MQTT frames.

## Design Decisions
1. **Minimal API** (no controllers needed) for the v10 host for simplicity.
2. **In-memory cache** for live metrics (swap-in Redis/PostgreSQL in production).
3. **MQTTnet** is the MQTT client for the broker; binary WebSocket is the client-facing protocol.
4. The `BackgroundMetricWorker` will poll MQTT topics every 3 seconds in production.

## Next Phase
Phase 6 — Implement the React SPA integration (WebSocket hook, gauge rings, and PWA assets).
