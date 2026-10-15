# Carwash API Spec (Graphify-Style Open Specifications)

## Quick Links

- **GitHub repo**: `https://github.com/Fission-AI/carwash`
- **OpenAPI spec**: `/backend/api-spec.openapi.yaml`
- **UI bundle**: `/ai-spec-ui/dist/index.html`

## Build & Test

```bash
cd /carwash/backend
dotnet build

cd ../ai-spec-ui && npm install && npm run build && npm test
```

## Components (all in `ai-spec-ui/src/`)

| File | Purpose |
|------|---------|
| `main.tsx` | App entry, bundles all UI components |
| `health.tsx` | System health indicator component |
| `metrics.tsx` | Dashboard table for 4 station telemetry |
| `alerts.tsx` | Threshold alert panels (lowPressure/highPressure) |
| `upload.tsx` | Multipart photo upload form |
| `streaming-component.tsx` | WebSocket stream consumer (@~6 Hz) |
| `types.ts` | Shared TypeScript interfaces |

## Tests

- **Unit tests** (`src/unit_tests/`): React rendering assertions, component mounting
- **Integration tests** (`src/integration/tests.spec.ts`): HTTP + WebSocket endpoint tests

Run `npm test` to verify all pass.

## Publishing Workflow

1. Push the `.NET` project to `github.com/Fission-AI/carwash`
2. Run `npm run build` → produces `ai-spec-ui/dist/index.html`
3. Publish bundle to GitHub Releases or a static host
4. Register on [`openspec.dev`](https://openspec.dev) via GitHub Actions or manual upload

End.
