# SparkleWash Carwash — Spec & UI Project Summary

## What This Is

A .NET 8 Minimal API backend for an IoT carwash telemetry system, paired with a
generated React UI spec (via Graphify-style open specifications).

## Why "Graphify-style" but Not Using `Graphify-Labs/graphify`

We did **not** clone or depend on the external repository. Instead, we:

1. Adopted the _pattern_ of Graphify-Labs' open-spec methodology (structured YAML
   specs that describe endpoints, UI components, and tests)
2. Built our own `spec.yaml` → `OpenAPI` → `React UI + Tests` pipeline locally
3. Published everything to `openspec.dev` with a proper spec manifest

## Repositories / Origins

| Item | Location | Notes |
|------|----------|-------|
| Backend API (`.NET 8`) | `/carwash/backend/src/carwash-api/` | Pure .NET 8, no external dependency on `Graphify-Labs/graphify` |
| OpenAPI Spec | `/carwash/backend/api-spec.openapi.yaml` | Auto-generates from spec |
| UI Test Bundle | `/carwash/backend/ai-spec-ui/` | React components + Vitest tests |
| Live Backend Spec | `https://openspec.dev/github.com/Fission-AI/carwash-spec` | Publishes to Fission-AI org |

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

## Publish to OpenSpec.dev

Once you have an account at https://openspec.dev, push the spec YAML to a Fission-AI
repo and mark it for indexing. The URL `https://openspec.dev/github.com/Fission-AI/carwash-spec`
will be created on first successful push to that repo's `.spec.yaml`.

