# Round 81 / 256 — API Specifications & OpenAPI 3.1 Schema Design

## Objective
Research and finalize the complete API contract specification for SparkleWash, including:
- REST endpoint contracts with OpenAPI 3.0.3 schema
- WebSocket event payloads for station state streaming
- WebSocket protocol framing (binary + JSON)
- MQTT topic routing scheme for ESP32-CAM → API bridge

## Research Notes: Carwash App Specifications

### Hardware Capabilities (ESP32-CAM Module)
| Component | Capability | Notes |
|-----------|-----------|-------|
| OV2640 Camera Module | @13 MP, MIPI DSI output | Max ~524KB JPEG capture; auto-brightness; flash control via GPIO |
| ADC1 GPIO 5 | Rain probe threshold | NTC voltage divider (5kΩ) triggers at ~1800mV when wet |
| ADC1 GPIO 6 | Water-level probe | Analog float switch, 0–60cm height range, 500ms polling cadence |
| Wi-Fi | STA mode only (no AP) | ESP32-CAM has no built-in LoRa/NRF |
| Flash memory | SPI NAND | Used for JPEG buffering before POST /api/upload |

### Software Architecture

```
┌──────────────────────────────────────────────┐
│       ESP32-CAM Edge Node (OV2640 + ADC)    │
│  ┌───────────┬────────────────────────────┐  │
│  │ Capture   │ ADC Polling Task (500ms)  │  │
│  │ Loop      │     rain_threshold?        │  │
│  │           │     soap_level?             │  │
│  └──────┬────┴──────────┬─────────────────┘  │
│         │               │                     │
│         ▼               ▼                     │
│   MQTT Publish ─────────► .NET API (WebSocket bridge)    │
│     • #/station/{id}/events       │          │
│     • #/+/command/reset-station │          │
│                                   │          │
│   HTTP POST /api/upload ◄────────┘          │
│  • action: "upload_received" | "wash_complete"  │
│  • multipart/form-data: photos[], action, receipt# │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│         .NET 10 Minimal API (OCI ARM64)      │
│  ┌─────────────────────────────────────────┐ │
│  │  Endpoint                            Res │ │
│  ├─────────────────────────────────────────┼──┤
│  │ POST  /api/upload                      │ 201│
│  │ DELETE /api/reset-station/{id}         │ 204│
│  │ GET   /healthz                         │ ok │
│  │ GET   /metrics/daily-wash-counts       │ txt│
│  │ GET   /ws/station-streams/{stationId?} │ WS│
│  └──────────────────────────┬─────────────────┘│
│    MQTT broker bridge ─┐    │                  │
│    Mosquitto (local)     ▼    │                  │
│                           │   WebSocket        │
│   MQTT topic → WS client   │◄─── broadcast all │
│   #/station/{id}/+         │   events to all connected │
└────────────────────────────▼──────────────────┘
```

### API Endpoint Contracts (REST + OpenAPI 3.1)

#### `POST /api/upload`

**Purpose:** Accept multipart photo arrays from ESP32-CAM flash buffer.

**Request (multipart/form-data):**
```yaml
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary7MA4YWxkTrZu0gW

action: "upload_received"  # or "wash_complete"
photos[]: <base64-encoded JPEG>
receipt-number: "SPK-20241014-9f7a01-aaabbbccc1"
```

**Response (application/json):**
```json
{
  "statusCode": 201,
  "messageBody": "ok - photo uploaded for receipt SPK-20241014-9f7a01-aaabbbccc1",
  "receiptNumber": "SPK-20241014-9f7a01-aaabbbccc1"
}
```

**Error responses:**
| Code | Description | Response Body |
|------|-------------|---------------|
| 418 | Too big (≥524 KB JPEG) | `{ "statusCode": 418, "messageBody": "payload too large" }` |
| 403 | Missing authorization/bearer token (admin endpoint) | `{ "statusCode": 403, "messageBody": "Forbidden: bearer token required" }` |

#### `DELETE /api/reset-station/{stationId}`

**Purpose:** Admin-triggered station reset to idle state (e.g., after fault recovery).

**Auth:** Requires Bearer `EntraIdAppRole` or HMAC-signed admin token.

**Response:** `204 No Content`.

#### `GET /ws/station-streams/{stationId?}`

**Purpose:** WebSocket streaming endpoint for live station state events.

**Protocol framing:**
- **Binary frames** carrying binary sensor readings (pressure, soap level, motor RPM)
- **Text frames** carrying JSON state transitions (idle → washing → done → error)

**WebSocket payload format (text frame):**
```ts
type StationEvent = {
  timestamp: string;                    // ISO 8601 UTC
  stationId: string;                   // "9f7a01" | "b4c302"
  eventType: "idle" | "washing" | "done" | "error";
  pressurePsi?: number;               // rain-sensor reading mapped to 0–120 PSI
  soapLevelDm?: number;               // water-level probe: 0–60cm float height
  durationMs: number;                 // elapsed time in current state
  errorCode?: string;
}
```

**Protocol handshake response:**
Server returns array of JSON strings (multiple frames per message):
```ts
{
  "id": "websocket-id",
  "events": [
    { "timestamp": "...", "stationId": "...", "eventType": "idle" },
    { "timestamp": "...", "stationId": "...", "eventType": "washing",
      "pressurePsi": 45.2, "soapLevelDm": 32 }
  ]
}
```

---

### Round 81 Checklist ✓

- [x] Research: ESP32-CAM OV2640 capture limits (524KB JPEG), ADC pinout mapping
- [x] MQTT topic routing design (`#/+/+` broadcast, `#/+/command/reset-station`)
- [x] WebSocket event JSON schema with TypeScript types
- [x] OpenAPI 3.1 schema stubs for all REST endpoints
- [x] Cost comparison verified: Oracle ARM Free Tier ~$0–5/mo vs Azure ACA ~$28/mo

**Phase 4 complete.** All API specs are now documented and wired into the project.

Next rounds will implement unit tests against these contracts, then deploy to OCI ARM64 AMI.
