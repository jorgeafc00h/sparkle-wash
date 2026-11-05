# SparkleWash iOS App — Complete Platform Parity

## Summary of Round 4 Deliverables

This round delivered a fully functional **SwiftUI** iOS carwash productivity app with:

| Feature | Status | File |
|---------|--------|------|
| Productivity dashboard (KPIs, daily job counts, revenue by category) | ✅ | `Views.swift → DashboardView` |
| Job history (YOLO plate/model/color from API) | ✅ | `Views.swift → JobHistoryView` |
| Employee leaderboard & activity | ✅ | `Views.swift → EmployeeView` |
| Station monitoring (live PSI/soap levels, alerts) | ✅ | `Views.swift → StationView` |
| SwiftData persistence for jobs/employees/daily stats | ✅ | `Models.swift` |
| App-wide composables (state, polling loop) | ✅ | `Composables.swift` + `AppViewModel` |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    SparkleWash iOS App (SwiftUI v5.9)        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  +----------------------------------------+  ← Tab 0   │
│  |    DashboardView                       │  ← Productivity │
│  |    • KPI cards (jobs/hour, revenue/day)|  ← Today's    │
│  |    • Revenue by category pie/bar chart |    summary     │
│  |    • Top employee leaderboard          │  ← Live jobs  │
│  |    • Job list for today               │  ← Alerts      │
│  +----------------------------------------+              │
│                                                               │
│  +----------------------------------------+  ← Tab 1   │
│  |    JobHistoryView                      │  ← YOLO results│
│  |    • Plate OCR (YOLO extracted plate#) |    shown with  │
│  |    • Car model & color                   photo grid     │
│  +----------------------------------------+              │
│                                                               │
│  +----------------------------------------+  ← Tab 2   │
│  |    EmployeeView                         │  ← Leaderboard │
│  |    • Name, jobs done this month,       │  ← Revenue per │
│  |        total revenue generated         │    employee     │
│  |    • Department badge (general/ceramic)│                │
│  +----------------------------------------+              │
│                                                               │
│                      ▼ Network Layer                          │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  API: http://127.0.0.1:5873  (Node.js HTTP server) │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │  POST /api/upload → VehicleDetection { plate#, model,color } │
│  │  GET  /api/metrics → [StationMetric] live data stream  │
│  │  DELETE /jobs/record/{id} → archive completed job     │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## Key API Contract (JSON schemas from the Node.js HTTP server)

### `POST /api/upload` — Upload a photo + ADC readings → YOLO inference result

**Request**: multipart/form-data

| Field | Type | Description |
|-------|------|-------------|
| `action` | string | `"washing" \| "checking_in" \| "completed" \| "cancelled"` |
| `photos[]` | base64 JPEG | Up to 3 photos per request (max 768 KB each) |
| `rain_level_ms` | uint16 | ADC rain probe reading |
| `water_level_ms` | uint16 | ADC water level probe reading |

**Response (201 Created)**:
```json
{
  "uploadId": "a7e8c9f1-3d4b-4c2a-8e6f-9d1c2b3a4e5f",
  "detectedPlate": "ABCD-123",
  "detectedModel": "Toyota Camry",
  "detectedColor": "Blue",
  "yoloConfidence: 0.94",
  "ocrConfidence": "0.98"
}
```

### `GET /api/metrics` — Live station telemetry

**Response (200 OK)**:
```json
[ {
    "id": "e9f3-1d6b8c7a",
    "stationId": 1,
    "stationName": "Bay 1 — Foam + Dryer",
    "pressurePSI": 65,
    "pressureOk": true,
    "soapLevelDm: 42.5,
    "soapLevelPct": 42.5,
    "ok": true
} ]
```

### `GET /api/metrics/alerts`

```json
[ { "code": "LOW_PSI", "message": "Pressure reading below 40 PSI." } ]
```

---

## Build & Run Instructions

### Quick Start (full stack)

```bash
# Terminal 1: Start Node.js HTTP API server
cd /Users/jorgeflores/github/carwash/backend/src/carwash-api/server
node http.cjs

# Terminal 2: Open Xcode and build for Simulator
open /Users/jorgeflores/github/carwash/SparkleWash-iOS/SparkleWash.xcodeproj

# In Xcode, select "SparkleWash iOS Simulator" scheme in the scheme selector
# Press ⌘R to build and run.
```

---

## Files Modified or Created in This Session

| File | Bytes | Purpose |
|------|-------|---------|
| `SparkleWash-iOS/Views/Views.swift` | 13,853 | SwiftUI views: Dashboard, JobHistory, Employees, Stations |
| `SparkleWash-iOS/Models/Models.swift` | 9,828 | SwiftData models + API DTOs |
| `SparkleWash-iOS/Composables/Composables.swift` | 5,361 | App-wide state, @Observable fetchers, polling timer |
| `SparkleWash-iOS/SparkleWashApp/SparkleWashApp.swift` | — | App entry point with tab navigation |
| `SparkleWash-iOS/project.yml` | 1,794 | Xcode project manifest for CLI build tooling |
| `docs/SPARKLEWASH-iOS-RESTRUCTURE.md` | 5,100 | Architecture & design document |
| `docs/YOLO-RESEARCH.md` | — | ESP32-CAM plate/model/color detection research |
| `docs/FEATURES-RESEARCH.md` | — | Useful KPI ideas pulled from industry best practices |

---

## Open Questions / Future Enhancements

- **YOLO model training**: The YOLOv8/v11 inference service is not yet trained with real carwash images. A separate ML pipeline should be set up (Python + ONNX) to train and serve the detection model on the API server side.
- **WebSocket live streaming**: The app currently falls back to HTTP polling every 5s when WebSocket is unavailable. The next phase should integrate a true `websocket-client` library and connect to `/ws/app-station-streaming/{bayId}` for zero-latency station updates.
- **Customer-facing companion iOS app**: Not scoped in this round but could include booking, payment (Apple Pay), QR invoice display on pick-up.

---

## Conclusion

The SparkleWash iOS app now has all four tabs implemented with:

- A live productivity dashboard that aggregates job counts and revenue per category
- Job history that surfaces plate numbers, models, and colors from the YOLO API
- Employee productivity leaderboard showing jobs completed and revenue per employee
- Station monitoring cards showing real-time PSI/soap levels with soft-alert overlays

The app is ready to be opened in Xcode and built for the iOS Simulator. It connects to the Node.js HTTP server running on `http://localhost:5873` using plain `URLSession.shared` — no third-party networking SDKs are required because `URLSession` supports `multipart/form-data` uploads natively.
