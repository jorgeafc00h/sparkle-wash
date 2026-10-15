# Carwash AI Spec UI + Test Suite

Location: `ai-spec-ui/` directory in this repo.

## Summary

Built per [openspec.dev](https://openspec.dev/) spec conventions, using the Graphify pattern (local deterministic AST parsing, no vector store).

The spec defines:

- **4 UI components** — React + Axios for health, metrics, alerts, upload
- **1 WebSocket component** — `/ws/app/station-streaming/{stationId}` with ~6 Hz updates
- **5 unit tests** (React Testing Library + Vitest mocks)
- **6 integration tests** hitting `http://localhost:5001` endpoints

All code is in TypeScript, built with Vite, and runs with a single `npm test`.

## Setup

```bash
cd /Users/jorgeflores/github/carwash/ai-spec-ui
npm install
npm run build
npm test
```

## Running Endpoints (for integration tests)

```bash
cd /Users/jorgeflores/github/carwash/backend/src/carwash-api
dotnet run
```

Then open your browser at `http://localhost:5001` and inspect the DOM or use `vitest --run`.
