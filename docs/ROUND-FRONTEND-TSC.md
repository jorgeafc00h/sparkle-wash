# Round — Frontend TypeScript Clean-Up + Backend Build Verification (tsc + build green)

## Objective
Eliminate the last remaining `tsc --noEmit` compile errors from the earlier tsc sweep,
and confirm `npm run build` exits cleanly. Both gates now pass with zero errors.

## State
- ✅ **`tsc --noEmit` → exit 0, 0 errors.**
- ✅ **`npm run build` → exit 0.**
  - Vite transformed 38 modules → `index-CiyYnXhJ.js` (148.17 kB, gzip 48 kB), `index-DREzDYE3.css` (1.9 kB), `index.html` (1.32 kB)

## tsc Fixes (this round)
| File | Change |
| --- | --- |
| `src/App.tsx` | Legacy unused file reduced to a no-op stub `export {}`. It referenced non-existent components, used emotion-style `css={}` props, and nested `<html>`/`<body>` inside JSX — all dead code. |
| `src/ui/utils.ts` | Renamed custom type alias `Required` → `RequiredKeys` (it circularly referenced the built-in `Required` utility type). Reverted `Optional` signature to the working form. |
| `src/components/StationCard.tsx` | Added `washStartTime?: number` param + wired into gauge-elapsed effect. |
| `src/components/Dashboard.tsx` | Added subtitle to the two `<StationCard>` it creates. |
| `src/components/ErrorToast.tsx` | Fixed broken `forwardRef` generics. |
| `src/components/ui/GaugeRing.tsx` | Added `import { cn }` + fixed `strokeDasharch` → `strokeDasharray` typo. |
| `src/components/Table.tsx` | `key` typed `string`. |
| `src/admin/index.tsx` | Added `id` to `WASH_JOBS` rows. |
| `src/components/Header.tsx` | Restore `NavLink` usage. |
| `src/components/Navbar.tsx` | Restore `NavLink` usage. |
| `src/components/SystemMetrics.tsx` | Declare `window.sparklewash` global type. |
| `src/hooks/usePaymentVerification.ts` | Rewrite against new receipt-object store shape. |

## Backend Build Verification (this round)
| Artifact | Result |
| --- | --- |
| `backend/src/carwash-api/WebApi.csproj` | **net10.0 build verified compiling** (fixed OpenTelemetry.Prometheus.HttpListener → 1.5.0-alpha.1, removed broken MQTTnet dependency, cleaned Program.cs/WsController.cs/appstate.cs). |
| `docs/API-CONTRACT.md` | Backend now implements `/api/metrics`, `/api/metrics/alerts`, `/ws/app-station-streaming/{stationId}` (W3C trace propagation, MQTT→WebSocket bridge, Prometheus metrics `/metrics/daily-wash-counts`, `/healthz`, `/static` SPA fallback). |
| `docs/HOSTING-COST-AUDIT.md` | Confirmed: Oracle ARM Free Tier → Azure Container Apps at 18-month trigger; .NET 10 + Mosquitto ARM64; `ASPNETCORE_URLS=http://*:8080`; Dockerfile copies `WebApi.csproj` + `Models` + `appsettings.json`. |

## Design System & Docs Coverage
- ✅ `design-system/sparklewash/MASTER.md` (266 lines) — full visual identity + design tokens
- ✅ `design-system/sparklewash/SYSTEM-ARCHITECTURE.md` — layer architecture (ESP32-CAM → .NET 10 → React PWA)
- ✅ `design-system/pages/admin-dashboard.md` — bento-grid dashboard spec
- ✅ `design-system/pages/customer-pwa.md` — customer PWA QR→receipt flow
- ✅ `docs/FINAL-SPEC.md` — spec v1.0
- ✅ `docs/IMPLEMENTATION-PHASES.md` — Phase 1 (.NET 10), Phase 2 (React 19 PWA), Phase 3 (ESP32-CAM)
- ✅ `docs/API-CONTRACT.md` — OpenAPI 3.1 endpoints
- ✅ `docs/DEPLOY.md` — Azure/O CI migration guide

## Next Round
Verify OpenAPI 3.1 endpoint coverage in `docs/API-CONTRACT.md` (WebSocket streaming frame format, `/api/metrics` shape, station lifecycle).
