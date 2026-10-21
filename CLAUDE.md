# SparkleWash — project memory

Carwash operations: ESP32-CAM cameras read plates, a vision gateway posts arrivals, staff confirm them
and run jobs from a web console or the iOS/iPadOS app. Status, review history and open items:
`docs/STATUS.md` (keep it updated after each round of work). iOS work: follow `docs/IOS_PLAN.md`
(how to run every test, what each UI test checks, backlog) and add to its progress log.

## Layout

| Path | What | Test |
|---|---|---|
| `src/carwash-api` | .NET 10 minimal API, JSON-file stores, multi-tenant | `dotnet test src/carwash-api.Tests/CarwashApi.Tests.csproj` |
| `edge/vision-gateway` | Python: YOLOv3 (cv2.dnn) → plate OCR → vote → POST | `cd edge/vision-gateway && pip install -r requirements-dev.txt && python -m pytest` |
| `edge/esp32-cam` | Arduino firmware 1.2 (BLE setup, mDNS, Preferences) | CI only (arduino-cli, esp32 core 3.0.7, NimBLE-Arduino 1.4.3) |
| `web` | React/TS/Vite: landing at `/`, console at `/app/` (hash routes) | `cd web && npm test && npm run build` (also runs `tsc -b`) |
| `ios` | SwiftUI app + `SparkleKit` Swift package, XcodeGen `project.yml` | CI only (macOS); no Swift toolchain in the Linux container |
| `contracts/v1` | `service-packages.json`: price sheet shared by API, web, iOS | |

Dead code awaiting the owner's approval to delete (don't build on it, don't delete without asking):
`ai-spec-ui/`, `spa/`, `static/`, `src/carwash_api/`, `src/carwash-api/server/`, `PaymentPosStore.cs`,
root `ApiIntegrationTests.cs` / `package.json`, `spec.yaml`, `api-spec.openapi.yaml`, `README-for-openspec.txt`.
The real API contract is the generated `/openapi.json`.

## Key design rules

- **Tenancy:** every staff endpoint resolves its stores with `tenants.For(session.TenantId)`. The
  `default` tenant is the original single site. Bay telemetry, washes and MQTT belong only to `default`.
- **Auth:**
  - Staff sign in with a Google ID token; `SPARKLEWASH_GOOGLE_CLIENT_ID` is comma-separated (web + iOS clients).
  - Cameras use device keys `swd.{tenant}.{device}.{secret}`. Keys are stored hashed, bound to one cameraId, shown once.
- **Arrivals:** pending means no job, not dismissed, and a role other than exit/bay. Opening a job uses an
  idempotency key. Exit sightings suggest *Mark done*.
- **i18n:** Spanish is the default everywhere.
  - Web dictionaries: `web/src/i18n/{es,en}.ts`; key parity is type-checked.
  - iOS strings are generated from those plus `ios/SparkleWash/Resources/ios-strings.json`. Run
    `python3 ios/scripts/gen_strings.py` after changing either, and commit the generated `.lproj` files.
- **iOS offline:** changes go through `SyncEngine.perform` → the `PendingOperation` outbox, then an optimistic
  `LocalStore.apply`, replayed in order. Jobs opened offline get id `local-<arrivalId>` and can't be advanced
  until they sync.
- **BLE protocol:** UUIDs `5F6D000{1..7}-8A3B-4C2A-9A1D-7B3C2E1F0A10`, name prefix `SparkleCam-`.
  - Status strings: `idle`, `connecting`, `connected:<ip>`, `failed:<reason>`.
  - Keep `CameraLink.swift` and the firmware in sync.

## Gotchas learned the hard way

- **Swift and CI:**
  - `operator` is a Swift keyword: write `` case `operator` ``.
  - SparkleKit types the app constructs need explicit `public init`s, declared inside the struct (not in an extension).
  - The app's unit-test target must NOT also link SparkleKit, or two copies split `APIError`.
  - The app uses an in-memory SwiftData store when hosting tests (`AppConfig.isUnitTesting` / `-ui-testing`).
  - Read iOS CI failures in the "Failed tests" step; the raw xcodebuild log is noisy.
- **Firmware:**
  - esp32cam needs C++17, so build on ESP32 core 3.x.
  - NimBLE `setValue(const char*)` copies the pointer: send `(const uint8_t*)s.c_str(), s.length()`.
  - Don't disable Wi-Fi modem sleep while Bluetooth is on.
- **Web:**
  - Vite bakes `VITE_GOOGLE_CLIENT_ID` / `VITE_API_BASE_URL` in at build time. The Static Web Apps workflow
    reads them from repository variables and only deploys from `main`.
  - Don't use CSS `text-transform: capitalize` on Spanish dates.

## Working conventions

- Develop on the assigned `claude/*` branch; push with `git push -u origin <branch>`. No PRs unless asked.
- Commit messages end with the Co-Authored-By / Claude-Session lines; never include model names in commits.
- Before pushing, run the fast checks for what changed (API tests, pytest, `npm test` + build, `gen_strings.py`).
- Watch GitHub Actions (`ci.yml`, `ios.yml`) through the GitHub MCP tools and fix until green.
