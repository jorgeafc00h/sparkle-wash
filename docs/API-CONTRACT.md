# CarWash Management API — OpenAPI 3.1 + WebSocket Streaming

**Server:** `http://localhost:5000` (development target — Oracle Cloud UML ARM64 production hostname TBD)  
**Version:** v1.0.0

## Overview

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/metrics` | GET | The live metrics: dailyWashCounts, pressurePsi, soapLevel, activeStations, uptime |
| `/api/metrics/alerts` | GET | The alerts: `[{code, value, threshold}, ...]` |
| `/ws/app-station-streaming/:stationId` | WS | Binary WebSocket stream re-broadcasts incoming MQTT JSON frames |

---

## `GET /api/metrics`

Returns a snapshot of live metrics read from the in-memory cache (populated by the `BackgroundMetricWorker`).

### Response (200 OK)

```json
{
  "dailyWashCounts": 32,
  "pressurePsi": 48.2,
  "soapLevel": 23.1,
  "activeStations": 4,
  "uptimeInSeconds": 3600
}
```

## `GET /api/metrics/alerts`

Returns the active alerts list.

### Response (200 OK)

```json
[
  {"code": "lowSoapLevel", "value": 23, "threshold": 50},
  {"code": "pressureDrop", "value": 34, "threshold": 38}
]
```

## `GET /ws/app-station-streaming/:stationId`

Upgrade endpoint. The server sends binary WebSocket frames (opcode = 1 = text) containing JSON payloads like:

```json
{
  "stationId": "b4c302",
  "sensorType": "adcSoapLevel",
  "value": 21.4,
  "soapLevelDm": 21.4,
  "timestamp": "2025-10-14T18:44:01Z",
  "status": "idle",
  "action": "washing"
}
```

WebSocket upgrade requires a `Connection: Upgrade; upgrade: websocket` header and the browser must set `Content-Type: application/json; charset=utf-8`.

---

## Error responses

| Status | Condition |
|--------|-----------|
| 404 | `:stationId` not found (invalid UUID) |
| 429 | Too many concurrent WebSocket clients (default: 10) |
| 500 | Background worker failure |

---

This contract is machine-readable at `docs/api.yaml`.
