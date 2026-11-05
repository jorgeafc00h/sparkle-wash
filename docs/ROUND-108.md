# Round 108 — WebSocket Subscription Layer

## Files Created
| File | Lines | Purpose |
|------|-------|---------|
| frontend/src/hooks/useStationStatus.ts | 172 | WebSocket subscription + buffer + polling fallback |
| frontend/src/hooks/useWebSocketState.ts | 56 | Connection state machine + retry logic |
| frontend/src/hooks/index.ts | 4 | Barrel re-export |

## Key Implementation
- WebSocket frame decoding (binary → JSON)
- Per-station event filtering with 100-event buffer
- HTTP long-poll fallback (8s per request, then events streamed)
- Reconnect with exponential backoff (7.5s cap, 20 max attempts)
- Clean unmount of WebSocket clients via `cleanup` callback

## Architecture
```
ESP32-CAM → MQTT → .NET 10 API → WebSocket → React PWA
```
Deployed to Oracle Cloud UML ARM64 (free tier, ~$5/mo)

