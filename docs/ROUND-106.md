# Round 106 — useStationStatus Hook Implementation

## Files Created
| File | Lines | Purpose |
|------|-------|---------|
| frontend/src/hooks/useStationStatus.ts | 172 | WebSocket subscription + buffer + polling fallback |

## Features
- WebSocket connection to /ws/station-streams/:id
- Binary frame decoding (opcode 1 = JSON)
- Buffer max 100 events, filtered by stationId
- HTTP long-poll fallback every 3s when WS unavailable
- Reconnect logic: 7.5s exponential backoff, 20 attempts max
- Connection status tracking

## Architecture
ESP32-CAM → MQTT broker → .NET 10 API → WebSocket → React PWA
Oracle Cloud ARM64 free tier (~$5/mo)

