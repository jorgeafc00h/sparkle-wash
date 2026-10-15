# SparkleWash Carwash API Spec UI

Built using Graphify-Labs/open-spec pattern. All tests pass. Run the `.NET` backend
at `http://localhost:5001`, then point the UI to it via environment variable:
```bash
echo "API_BASE_URL=http://localhost:5001" >> .env && npm run dev
```

## Quick Run

```bash
npm install
npm run build
open build/index.html
```

## Test Commands

| Command | Description |
|---------|-------------|
| `npm test` | runs unit + integration tests (integration skip if server is offline) |
| `npm run build` | bundles UI for deployment to openspec.dev |

## Architecture

- **Endpoints**: `/health`, `/api/metrics`, `/api/metrics/alerts`, `/api/upload`, `/api/upload/{id}`, `/ws/app/station-streaming/{stationId}`
- **WebSocket**: streams station telemetry at ~6 Hz (16–17ms interval) with per-station JSON payload
- **UI**: React components for health, metrics dashboard, alerts feed, upload form, stream viewer
