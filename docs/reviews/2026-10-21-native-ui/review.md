> Superseded prototype exploration. The maintained app was subsequently found in `backend/ios`, paired with `backend/web`. See `backend/docs/IOS_PLAN.md` for the current native work. Screenshots and code here are retained as historical design exploration.

# iPhone UI refinement and React feature comparison — 2026-10-21

> **Follow-up, 2026-11-04:** The web compilation failure and missing mounted workboard described below are historical findings, superseded by the current `frontend/src/main.tsx` → `OperationsApp.tsx`. `make verify` now passes the web typecheck, build and tests. The active page includes package pricing, Google staff sign-in, arrival confirmation/job opening, job transitions/assignments, summary metrics, and read-only employee and inventory lists. Payments, receipts, complete inventory editing, photo evidence review, streaming and hosted acceptance remain incomplete. See the current [README](../../README.md) and [architecture](../ARCHITECTURE.md).

## Scope and source of truth

The native app now uses four sections: Overview, Jobs, Team, and Packages. The former single scroll of generic cards is preserved in `docs/archive/2026-10-21/OperationsView-before-iphone-refinement.swift`. The new screens use native navigation, SF Symbols, semantic surfaces, a teal accent, and Dynamic Type. The original package names, Spanish service descriptions, and USD price matrix are retained.

The current web entry point imports `frontend/src/OperationsApp.tsx`. That file fails TypeScript compilation and currently renders only sign-in/workboard scaffolding, with no working operational lists or actions. This contradicts the historical mounted-feature claims in `docs/FEATURE-PARITY.md`. The comparison below distinguishes the intended working set documented in README/architecture from what the current web source can prove. Unmounted experimental web components were not promoted into production.

| Feature | React evidence in current checkout | Refined native experience |
| --- | --- | --- |
| Public package menu and four vehicle prices | Documented in README; missing from current mounted component | Packages tab; vehicle selection changes the exact price; detail page lists every inclusion |
| Staff Google sign-in and roles | Token exchange scaffold exists but does not compile | Official GoogleSignIn client retained; account sheet; viewer/operator/admin roles; settings and sign-out |
| Arrival review and job creation | Documented; current component has a static arrivals heading | Overview queue; candidate/confidence/camera/time; staff confirm plate/class and choose package before opening |
| Job totals and elapsed time | Documented; current component has a static jobs heading | Server-derived overview totals, UTC day disclosure, on-site/active minutes, immutable package price |
| Job queue and history | Documented; no current mounted implementation | Active/completed/all filters and plate/package search; explicit empty states |
| Employee assignments and transitions | Documented; current component has no working controls | Job detail assignments, queue/start/complete, and confirmed cancellation; permissions and stale state disable writes |
| Employees | Documented; absent from mounted component | Team tab with active flags and active assignment counts |
| Inventory | Documented read-only stock; absent from mounted component | Team → Supplies, available/on-hand/reserved values and reorder notices |
| Offline and failure feedback | Historical web claims cannot be reverified while build fails | Endpoint-scoped read cache retained; stale warnings and failed writes retain the server snapshot; public menu freshness is distinct from staff sign-in |
| Payments, receipts, camera evidence, editing stock, streaming | Incomplete or experimental | Still pending; no simulated successful operations were introduced |

Native service inclusions are labeled as inclusions, rather than presenting unsaved local checkboxes as completed work. Individual service completion is not part of the current HTTP contract. Employees and supplies remain read-only management lists; assignments are writable through the existing job route.

## Validation

- `make ios-build`: succeeded after the redesign.
- `make ios-test`: 9 tests passed in the first redesign run. Includes real production native model logic with a URLProtocol transport fixture for roles, retained snapshots after failed writes, endpoint changes, sign-out, and rendering staff data. Fixtures are test-only, never a production authentication bypass.
- Native UI acceptance uses `SparkleWashUIAcceptance` / `make ios-ui-test`. It requires the actual API on localhost:8080 and exercises tabs, car/pickup pricing, package inclusions, restricted workspaces, and settings.
- `make verify`: strict OpenSpec passes all 8 items, then TypeScript fails on existing `OperationsApp.tsx` errors (duplicate exports, undeclared types, invalid sign-in code). Web build/tests and API integration tests are not reached by that command.

Screenshots named `contract-fixture` contain labeled test data, not live carwash activity. Public-catalogue UI screenshots use the running production API. Final simulator observations and results are recorded below as checks finish.

## Remaining acceptance

Real Google sign-in needs this installation's iOS/server client IDs and an approved staff account. Real payment, physical camera, full VoiceOver interaction, and end-to-end operational acceptance remain separate unfinished parity tasks. No OpenSpec task has been marked complete from the visual refinement alone.
