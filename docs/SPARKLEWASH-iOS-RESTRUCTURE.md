# Car Spa iOS App — Productivity Dashboard (v1.0)

A SwiftUI-native iOS app for tracking carwash job performance, employee productivity, and revenue summaries.

## Overview

This is a **complete re-architecture** of the original SparkleWash-iOS project, rebuilt from scratch with:

- **Tab-based navigation** (4 top-level tabs + settings)
- **Productivity dashboard** as the primary feature (tab 1)
- **Job history** with ESP32 camera integration and YOLO plate detection (tab 2)
- **Employee productivity tracking** (tab 3)
- **Live station monitoring** (tab 4)

## New Features (not in previous versions)

### Dashboard Tab (Main Feature)
- Daily job counts and revenue totals
- Revenue breakdown by job type (basic, ceramic, premium, express)
- Employee leaderboard with top performers ranked daily
- Recent activity feed (completed jobs shown as chips)
- Live KPI cards showing today's progress

### Job History Tab
- List of all completed jobs with details:
  - License plate number (extracted via YOLO OCR from ESP32 camera photos)
  - Detected vehicle model and color from YOLO inference
  - Employee who performed the job
  - Job duration in milliseconds
- Filter options: All Jobs, This Day, By Plate Prefix
- Photo view mode to see captured images

### Employee Activity Tab
- Shows each employee's completed jobs count
- Revenue generated per employee
- Average jobs/day metric
- Toggle between all/active/inactive employees

### Stations Tab
- Live status of each wash bay (idle, washing, cleaning)
- Pressure PSI gauge with alert thresholds
- Soap level indicator
- Live photo feed from ESP32-CAM mounted at the station

## Architecture

```
SparkleWash-iOS/
├── project.yml              # Project manifest for Xcode Generator CLI
├── Info.plist               # App configuration
├── SparkleWashApp/
│   └── SparkleWashApp.swift # Entry point — defines the tab structure
├── Models/                  # SwiftData models + API data transfer objects
│   └── Models.swift        JobModel, EmployeeModel, DailyStatsModel
├── Composables/            # SwiftUI @Observable state containers
│   └── Composables.swift   Tab navigation, API calls, data fetchers
├── Views/                  # All UI views organized by feature
│   └── Views.swift         DashboardView, JobHistoryView, StationView, SettingsView
├── SparkleWashDataModel.swift  # SwiftData persistence layer
└── Tests/                   # Unit tests for models and views
```

## Data Models

### `Models.swift`

- **JobModel** — stores a completed job with:
  - `plateNumber` (extracted via ESP32 YOLO OCR)
  - `model` (e.g. "Toyota Camry", "BMW X5")
  - `color` (Blue, Gray, Red, etc.)
  - `category` (basic│ceramic│premium│express)
  - `employeeName`
  - `completedAt` timestamp
  - `durationMs` — how long the job took

- **EmployeeModel** — tracks:
  - Total jobs completed
  - Average revenue per day
  - Active/inactive status

- **DailyStatsModel** — aggregates daily totals
- **StationMetric** — live sensor reading (PSI, soap level) with alert states

### `Composables.swift`

- `AppTabs` — coordinate tab switching state
- `LiveDataFetcher` — polls `/api/metrics` every 2 seconds for live station data
- `DashboardViewModel` — builds the productivity dashboard data from raw jobs
- `EmployeeLeaderboardViewModel` — ranks employees by productivity

## API Contract

The iOS app connects to the local Car Spa API at `http://localhost:8080` (or configurable in Settings).

| Method | Path | Returns |
|--------|------|---------|
| GET | `/healthz` | Health check for app startup |
| GET | `/api/metrics` | Live station snapshot (pressure, soap) |
| POST | `/api/upload` | Photo upload from ESP32-CAM |
| GET | `/jobs/history?size=5` → `GET 400` if size > 100; accepts page and size parameters. Default limit is 10 jobs per page; maximum of 100 per page.

## How to Build & Run

```bash
# Step 1: Open Xcode
open SparkleWash-iOS/SparkleWash.xcodeproj

# Step 2: Choose a device (simulator or physical device)

# Step 3: Build → Run
# Product -> Scheme -> Run
```

## Running Tests

The project contains an XCUITest target `XCUITestSparkleWashApp` for automated UI testing.

## Notes on YOLO Integration

YOLO detection runs server-side (e.g. via a Python FastAPI endpoint or a Go server running the YOLO model). The iOS app sends the captured JPEG from the ESP32-CAM endpoint `/api/upload`, which in turn calls YOLO via HTTP request to the model-serving process. The results are returned as JSON with fields like:

```json
{
  "plateNumber": "ABCD-123",
  "confidence": 0.94832,
  "model": "Toyota Camry",
  "color": "Blue"
}
```

The ESP32 firmware is responsible for taking the photo every ~167ms and POSTing to `/api/upload`. The API server runs the YOLO model locally (or via an external service) and returns detection results in the JSON response.

## License

Proprietary internal property of Car Spa Inc.

## Contributors

- Primary architect: [@yourname]
- Reviewer signoff: N/A (in progress)

