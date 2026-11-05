# Phase 6 — Complete: React PWA Frontend Integration

## Summary

Phase 6 wires up the React PWA to the .NET 10 backend:

| File | Purpose |
|------|---------|
| `frontend/src/hooks/useStationStatus.ts` | Subscribes to WebSocket stream, filters by stationId, buffers events, HTTP fallback |
| `.frontend/src/hooks/useWebSocket.ts` | WebSocket connection state machine with exponential backoff + 167ms heartbeat |
| `frontend/src/types/index.ts` | TypeScript types mirroring the .NET 10 backend contracts |
| `frontend/src/pwa/service-worker.ts` | PWA cache-first/offline strategy |
| `frontend/.css` | Dark OLED theme tokens (accent: hsl(244,98%,61%)) |

## Key Implementation Highlights

1. **useStationStatus** — the primary data hook. It:
   - Connects to `ws://localhost:5000/ws/station-streams/:id`
   - Buffers up to 100 events
   - Decodes binary WebSocket frames (opcode 1 = text/JSON)
   - Falls back to HTTP polling every 3s if WS fails
   - Applies exponential backoff: 7.5s max, 20 attempts

2. **useWebSocket** — the underlying client. It:
   - Implements a state machine (connecting → connected → closing → error)
   - Reconnects with exponential backoff
   - Uses a 167ms heartbeat (6 pings/sec) to keep the connection alive
   - Handles protocol version negotiation (v1 = WebSocket, v2 = long-poll)

3. **TypeScript types** — mirror the .NET backend exactly. Types like `StationStatusEvent`, `WSState`, `CN` (class joiner) are all shared.

4. **Service Worker** — cache-first for statics, offline fallback for `/api/*` + `/ws/*`.

## API Contract
The API is documented in `docs/API-CONTRACT.md`. Endpoints:
- `GET /api/metrics`
- `GET /api/metrics/alerts`
- `WS GET /ws/station-streams/:stationId`
