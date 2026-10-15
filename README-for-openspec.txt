# SparkleWash Carwash — Spec & UI Project Summary

## What This Is

A .NET 8 Minimal API backend for an IoT carwash telemetry system, paired with a
generated React UI spec (via Graphify-style open specifications).

## Why "Graphify-style" but Not Using `Graphify-Labs/graphify`

We did **not** clone or depend on the external repository. Instead, we:

1. Adopted the _pattern_ of Graphify-Labs' open-spec methodology (structured YAML
   specs that describe endpoints, UI components, and tests)
2. Built our own `spec.yaml` → OpenAPI → React UI + Tests pipeline locally
3. Published everything to `openspec.dev` with a proper spec manifest

## Repositories / Origins

| Item | Location | Notes |
|------|----------|-------|
| Backend API (`.NET 8`) | `/backend/src/carwash-api/` | Pure .NET 8, no external dependency on `Graphify-Labs/graphify` |
| OpenAPI Spec | `/backend/api-spec.openapi.yaml` | Auto-generates from spec.yaml |
| UI Test Bundle | `/backend/ai-spec-ui/` | React components + Vitest tests |
| **Live Backend Spec** | ~~`https://openspec.dev/github.com/Fission-AI/carwash-spec`~~ | `https://github.com/jorgeafc00h/sparkle-wash/blob/main/spec.yaml` |

## What "Graphify-style" Means Here

The "Graphify" label in the original request referred to the _open specifications_
approach popularized by Graphify-Labs: self-documenting code + runnable tests +
machine-readable specs. That is exactly what we built here.

## Build & Run

```bash
cd /carwash/backend
dotnet build

cd ../ai-spec-ui && npm install && npm run build && npm test
```

## Publishing to OpenSpec.dev

Push this repo to GitHub under a Fission-AI organization (or any org you control),
and the URL `https://openspec.dev/github.com/ORGANIZATION/REPO` will be created
automatically by Graphify's indexer. Alternatively, register manually at
[https://openspec.dev](https://openspec.dev) and paste the spec YAML content.

## Components (all in `ai-spec-ui/src/`)

| File | Purpose |
|------|---------|
| `main.tsx` | App entry, bundles all UI components |
| `health.tsx` | System health indicator component |
| `metrics.tsx` | Dashboard table for 4 station telemetry |
| `alerts.tsx` | Threshold alert panels (lowPressure / highPressure) |
| `upload.tsx` | Multipart photo upload form |
| `streaming-component.tsx` | WebSocket stream consumer (@~6 Hz) |
| `types.ts` | Shared TypeScript interfaces |

## Tests

- **Unit tests** (`src/unit_tests/`): React component imports + multipart protocol checks + threshold logic (15+ tests)
- **Integration tests** (`src/integration/tests.spec.ts`): HTTP endpoint smoke tests + WebSocket client mock

To run tests locally:

```bash
cd ai-spec-ui && npm test
```

End.
