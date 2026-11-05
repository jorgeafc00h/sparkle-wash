# Code review — 2026-10-18

The guide referenced `docs/reviews/2026-10-16-project-review.md`, but that file was absent from this checkout. This review used the active entry points, OpenSpec baseline and real verification commands. There is no Git metadata in this workspace, so this is a working-tree review without a commit diff.

## Confirmed defects repaired

| Finding | Evidence before repair | Repair |
| --- | --- | --- |
| API solution could not restore | `make verify` failed on nonexistent ASP.NET package references | Use the .NET 10 Web SDK and framework reference |
| Tests did not target a buildable production app | Tests referenced `Program.BuildApp`, absent from the active `Program.cs` | Expose the production app builder and test it over HTTP |
| Mounted web app stayed on loading text | `frontend/src/main.tsx` rendered a placeholder and never mounted `App` | Mount the typed dashboard with validated polling and saved-data states |
| Historical HTTP contract claimed unimplemented operations | `docs/openapi.yaml` described live aggregate metrics, WebSocket, stored photos and HTTP 418 | Publish current route description and versioned contract decisions |
| No station persistence or derived history | Active API returned hard-coded station values only | Add keyed HTTP/MQTT ingestion, atomic file persistence, derived alerts, wash history and WebSocket delivery |
| Native target was not buildable | Generated project was absent, and active Swift files had extensive syntax errors | Preserve originals in `docs/archive/2026-10-18/ios-pre-review`, replace with a Swift 6 dashboard baseline and generate the project before builds |
| Vite selected an unused app | Extensionless `./App` import resolved to `App.jsx` before `App.tsx` | Import `App.tsx` explicitly; verify the mounted page in a browser |

## Verification

`make verify` passes: eight strict OpenSpec items, web type check/build, four web tests, and 25 API integration tests. The ingestion test restarts the actual API and checks persisted state. The MQTT test starts an in-process authenticated broker, checks WebSocket delivery and a broker restart. `make ios-build` passes and `make ios-test` passes four simulator tests. These tests do not prove physical camera capture, payments, cloud readiness or native device behavior.

## Remaining risks

1. The legacy upload route still checks declared length and does not store files. The protected photo route has actual size enforcement and retention, but only structural JPEG validation.
2. Google sign-in with SparkleWash-owned sessions and N1CO have been selected. Staff role mapping, merchant credentials, order reconciliation, receipt rules and hardware board details remain unresolved or unverified.
3. Browser WebSocket authentication awaits an identity-backed flow; browser clients cannot send the current custom stream header.
4. Native operational parity, physical device behavior and deployment remain unverified.

## Subsequent integration groundwork

The user selected the App.Desktop Google sign-in pattern and N1CO. SparkleWash now has a Google ID token exchange that issues its own in-memory staff session for allowlisted Google subject IDs, plus a signed, persistent N1CO webhook inbox. Neither reset controls nor payment confirmation is implemented yet; the webhook cannot by itself prove an order is paid.
