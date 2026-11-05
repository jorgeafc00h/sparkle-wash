# SparkleWash — Full System Deployment Guide

## Overview

SparkleWash is a complete IoT carwash management system consisting of four coordinated components:

| Component | Technology | Port | Purpose |
|-----------|-----------|------|---------|
| **ESP32-CAM Edge** | CMake + ESP-IDF, OV2640 camera | N/A | Captures photos, reads ADC sensors, posts to MQTT/HTTP |
| **Node.js HTTP API** | Node.js + Express/http | 5873 | Lightweight REST server for metrics, jobs, station telemetry |
| **React PWA** | React 19 + Vite + Tailwind | 8081 | Web dashboard for station monitoring with bento grid layout |
| **SwiftUI iOS App** | SwiftUI (iOS 16+) | N/A | Productivity tracker with tab navigation |

## Quick Start — Running the Full Stack

```bash
# Terminal 1: Start the API server
cd /Users/jorgeflores/github/carwash/backend/src/carwash-api/server
node http.cjs
# Output: SparkleWash API v2.1.0 listening on http://127.0.0.1:5873

# Terminal 2 (optional): Open React PWA app in browser
open http://localhost:8081/  > & # if you start the frontend server

# Terminal 3: Open Xcode for iOS simulator
open /Users/jorgeflores/github/carwash/SparkleWash-iOS/SparkleWash.xcodeproj

# Select a scheme from the scheme selector and press ⌘R to run
```

## Architecture Diagram

```
                    ┌──────────────────────────┐
                    │   ESP32-CAM Edge Node   │
                    │  OV2640 + ADC + MQTT    │
                    └─────────────┬───────────┘
                                  │ MQTT Pub/Sub
                                  ▼ TCP 1883
                    ┌──────────────────────────┐
    ┌──────────────▼──────────────────────────┤
    │              MQTT Broker                 │
    │                  Mosquitto               │
    └──────────────┬──────────────────────────┘
                   │
                   ▼ HTTP 80 (or WebSocket)
    ┌─────────────────────────────────────────┐
    │  Node.js API Server (v2.1.0)            │
    │  ┌─────────────────────────────────┐    │
    │  │ GET  /healthz                   │    │
    │  │ GET  /api/metrics               │    │
    │  │ GET  /api/metrics/alerts        │    │
    │  │ POST /api/upload                │    │
    │  │ GET  /jobs/stats                │    │
    │  │ GET  /jobs/history?size=5       │    │
    │  │ GET  /openapi.json              │    │
    │  │ DELETE /jobs/record/{id}        │    │
    │  └─────────────────────────────────┘    │
    └───────────────┬─────────────────────────┘
                    │
                    ▼ HTTP / WebSocket
    ┌─────────────────────────────────────────┐
    │   SparkleWash iOS App                   │
    │   Tab 1: Dashboard (jobs, revenue)      │
    │   Tab 2: Job History                    │
    │   Tab 3: Employees                       │
    │   Tab 4: Stations                       │
    └─────────────────────────────────────────┘

    ┌─────────────────────────────────────────┐
    │   React PWA (web dashboard)             │
    │   GET /api/metrics → station cards      │
    │                                          │
    │   WebSocket: ~167ms heartbeat           │
    └─────────────────────────────────────────┘
```

## iOS App — Tab by Tab

### Tab 0: Dashboard (Primary Productivity Screen)
- **KPI Cards**: Total jobs completed today, total revenue
- **Pie chart / bar breakdown**: Revenue by job type (basic=$25, ceramic=$85, premium=$150, express=$14.99)
- **Employee leaderboard**: Top 5 employees ranked by jobs completed / revenue generated
- **Activity feed**: Last 10 jobs displayed as scrolling chips

### Tab 1: Job History
- Table with columns: Plate #, Model, Color, Employee, Status, Duration
- Sortable headers
- Filter dropdown: All Jobs | Today Only | Completed Today
- Tap a row → expand to show full photo + metadata
- Swipe-to-dismiss for archiving old jobs

### Tab 2: Employees
- List of all employees with badges showing active/inactive status
- Each row shows: Name, Jobs Done This Month, Total Revenue, Avg Jobs/Day
- Toggle switch to set employee as active/inactive
- Tap → show full work history for that employee

### Tab 3: Stations (Live Monitoring)
- Horizontal scroll of station cards
- Each card shows: Bay ID, PSI gauge with color bands, soap level indicator, status badge
- Tap a station → show live photo feed from ESP32-CAM
- Alert overlay when pressure drops below 40 PSI or soap goes below 25 dm

### Tab 4: Settings
- API endpoint URL (configurable for different environments)
- Toggle for live data polling interval
- Enable/disable sound haptics on events
- Export data to CSV/JSON formats
- Reset all daily counters

## Build Targets

| Target | Platform | Use Case |
|--------|----------|----------|
| SparkleWash (iPhone) | Simulator iPhone 15 Pro | Development & testing |
| SparkleWash (iPad) | Simulator iPad Pro | Split-view dashboard mode |
| SparkleWash (real device) | Physical iPhone | Production deployment |

## Environment Variables

Set these in your environment or `.env` before running:

```bash
export SPARKLEWASH_API_URL=http://localhost:5873
export SPARKLEWASH_WEB_URL=http://localhost:8081
export SPARKLEWASH_MQTT_BROKER=mqtt://mqtt.eclipse.io:1883
```

## Testing

```bash
# iOS build (simulator)
open SparkleWash-iOS/SparkleWash.xcodeproj
# Select scheme → Run

# Web frontend build
cd /Users/jorgeflores/github/carwash/frontend && npm run build

# Backend API server runs directly via `node backend/src/carwash-api/server/http.cjs`
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "App couldn't connect to server" | Ensure the Node.js HTTP server is running. Start it first with `node backend/.../server/http.cjs`. |
| WebSocket connection refused | Try disabling live updates toggle — app falls back to polling mode. |
| No jobs showing in history API endpoint returns 400. Increase limit parameter to 100. | Ensure the `/jobs` query includes a size parameter. Default page size is 10, maximum allowed is 100. |

## Next Steps (Future Features)

- [ ] WebSocket live feed for real-time ESP32 station updates (vs. HTTP polling)
- [ ] Push notifications when a job completes or an alert triggers
- [ ] iCloud sync with cloud backend (when deploying to production)
- [ ] Dark/light mode toggle using System Appearance API
- [ ] Widget extension showing today's KPI summary on the Home screen

---

*Generated by SparkleWash Build Pipeline v2.1.0*
