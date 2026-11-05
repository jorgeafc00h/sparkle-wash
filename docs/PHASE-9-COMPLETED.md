# Phase 9 — Complete: useStationStatus Hook

## Summary
Implemented the WebSocket subscription hook with buffer and polling fallback.
The hook is now fully functional with proper WebSocket cleanup, exponential
backoff reconnect logic, and HTTP long-poll fallback.

## Files Created
| File | Lines | Purpose |
|------|-------|---------|
| frontend/src/hooks/useStationStatus.ts | 172 | WebSocket subscription + buffer + polling fallback |

## Implementation Details
- WebSocket connection to `/ws/station-streams/:id` with binary frame decoding
- Buffer max 100 events, filtered by stationId
- TCP fallback: HTTP long-poll every 3s when WS unavailable or on close
- Reconnect logic: exponential backoff 7.5s, capped at 20 attempts
- Track connection status: idle/connecting/connected/error/reconnecting

## Architecture
```
ESP32-CAM (OV2640 + ADC rain probe)
  → MQTT broker (MQTTService, topic +/+/+)
  → .NET 10 Minimal API (WebSocket upgrade + SSE fallback)
  → React PWA (useStationStatus hook)
```
Deployed to Oracle Cloud ARM64 free tier (~$5/mo instead of Azure's $18-30/mo).

## Next Phase
Phase 12 — Admin Dashboard with staff management table
