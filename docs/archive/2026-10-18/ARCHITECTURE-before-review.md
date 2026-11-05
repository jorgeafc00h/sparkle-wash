# SparkleWash — Full Application Architecture

## High-Level System

```
┌─────────────────────────────────────────────────────────────┐
│                     SPARKLEWASH SYSTEM                        │
├─────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────┐ │
│  │   ESP32-CAM Station Units                               │ │
│  │   ├── OV2640 camera (JPEG frames)                       │ │
│  │   ├── ADC rain probe on GPIO5                            │ │
│  │   └── ADC water level (DCM4948 sensor on GPIO6)         │ │
│  └────────────────────────────────────────────────────────┘ │
│                        │                                      │
│                 MQTT Pub/Sub                                 │
│        ┌───────────────┴─────────────────┐                  │
│        │   Mosquitto Broker (local)      │                  │
│        └───────────────┬─────────────────┘                  │
├────────────────────────<│                                  ||
│                         ▼ WebSocket / HTTP 80           WebSocket 9001
│  ┌────────────────────────────────────────────────────────┐ │
│  │   Node.js API Server (v2.1.x)                           │ │
│  └───────────────────┬─────────────────────────────────────┘ │
│       ┌─────────┬─────┴──────────┬──────────┬──────────────┐ │
│       │         │                │          │               │ │
│       ▼ HTTP:873 WebSocket:9001   │  YOLO Server          │ │
│  ┌─────────────────────────────┐   │                      │ │
│  │ REST API Endpoints          │   │ Python ONNX Runtime  │ │
│  │ - POST /api/upload          │   │ + ultralytics.yolo   │ │
│  │ - GET  /api/metrics         │   │ (YOLO11n COCO-trained) │ │
│  │ - GET  /api/metrics/alerts  │   │                      │ │
│  │ - GET  /api/jobs/history    │   └──────────────────────┘ │
│  │ - DELETE /jobs/record/:id   │                             │ │
│  └─────────────────────────────┘                              │ │
├────────────────────────────────────────────────────────────┤
│                     WEB APP (React + TSX)                      │
│  ├── ProductivityDashboard      → Tab 1 (default view)        │
│  ├── JobHistory                 → Tab 2 with photo grid       │
│  ├── Employees                  → Tab 3 leaderboard           │
│  └── Settings                   → Tab 4 config & YOLO notes   │
│                                                              ▼
│              HTTP Server: localhost:8081 (Vite HMR)
└─────────────────────────────────────────────────────────────┘
```

## File Locations

| Component | Path | Purpose |
|-----------|------|---------|
| **Frontend App** | `/carwash/frontend` | React 19 + Vite + TypeScript UI |
| **API Server** | `/carwash/backend/src/carwash-api/server` | Express server, port 5873 |
| **YOLO Inference** | `/carwash/backend/ai-spec-ui` | Python ONNX Runtime inference service |
| **iOS App** | `/carwash/SparkleWash-iOS` | SwiftUI prototype (in-progress) |
| **ESP32-Firmware** | `/carwash/esp32-firmware` | CMake build for ESP-IDF |

## How the Frontend Talks to the Backend

The React app uses `window.fetch` or a custom HTTP client (Axios) to call:

```ts
// Frontend code in /carwash/frontend/src/pages/ProductivityDashboard.tsx
const response = await fetch('/api/metrics');
const stations: StationSnapshot[] = await response.json();
```

The backend (Node.js + HTTP/Express) returns:

```json
[
  { "stationId": 1, "name": "Foam Wash", "status": "washing", "pressurePsi": 65 }
]
```

For the Job History tab, staff upload a photo via `<input type="file" multiple>`, which posts to:

```bash
curl -X POST http://localhost:5873/api/upload \
  -F "photos=@photo1.jpg" \
  -F "action=checking_in"
```

The Node.js forward-request to the YOLO inference service (Python + ONNXRuntime) and returns the result as JSON with `plateNumber`, `model`, and `color`.

## Key Design Decisions

- **Multipart/form-data uploads** handled natively by `URLSession` in Swift or the browser's `fetch(FormData)` in React.
- **YOLO inference** runs off-device (server-side) so we can avoid deploying a quantized ONNX model to the ESP32. This simplifies firmware significantly — no need for TensorFlow Lite or Edge Impulse SDK.
- **WebSocket streaming** fallbacks to HTTP polling when the WebSocket connection is unavailable, ensuring the dashboard always shows live-ish data even if the connection drops.

## Endpoints Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/metrics` | Station snapshots |
| GET | `/api/metrics/alerts` | Active alerts (low soap, low pressure) |
| PUT | `/api/upload` | Multipart form upload of photos for YOLO inference |
| GET | `/api/jobs/history?page=1&limit=20` | Paginated list of completed jobs |
| DELETE | `/api/jobs/record/{id}` | Soft-delete a job record from history |

