# Round 105 — Summary

Built the React SPA app shell with routing, station cards, gauge rings, and admin panel.

## Files Created

| File | Lines | Purpose |
|------|-------|---------|
| frontend/src/App.tsx | 69 | Router shell with StationCard grid, StatCounter, AdminPanel |
| frontend/src/main.tsx | 16 | React 19 createRoot entry point |
| frontend/src/utils/cn.ts | 4 | CSS class joiner utility |
| frontend/src/hooks/index.ts | Barrel | Re-export all hooks |
| frontend/src/components/ui/Button.tsx | 21 | Multi-variant button (ghost/outline/default) |
| frontend/src/components/ui/CardSkeleton.tsx | 8 | Loading placeholder for cards |
| frontend/src/components/ui/index.ts | Barrel | Re-export UI components (Card, Button, StatusBadge, etc.) |
| backend/Program.cs | ~120 | .NET 10 minimal API: CORS, routes, WebSocket upgrade, SSE fallback |
| backend/StationRegistry.cs | ~140 | In-memory station registry with event streaming |
| backend/api/appsettings.json | 20 | Kestrel + app configuration |

## Architecture

- ESP32-CAM (OV2640 + ADC rain probe) → MQTT broker → .NET 10 API → WebSocket → React PWA
- Deployed to Oracle Cloud ARM64 free tier (~$5/mo instead of Azure's $18–30/mo)

## Key Features

- WebSocket binary frame decoding (opcode = 1 = text/JSON)
- Per-station filtering at client
- 3s long-poll fallback when WS unavailable
- Max 20 reconnect attempts at 7.5s backoff
- StationRegistry with thread-safe dictionary + SSE streaming
- Minimal API routes: /api/metrics, /api/station/stream, /ws/station-streams/:id

## Next: Round 106

### Tasks
- Implement Admin panel with staff management table
- Add station controls for each wash bay
- Wire up WebSocket subscription with real-time updates

