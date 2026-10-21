# iOS / iPadOS app: hand-off plan

This file is written for whoever continues the iOS work next, human or a local coding model. It covers:

1. How to build the app and run every test.
2. How to read the results and fix failures.
3. The prioritized backlog, with acceptance criteria.

Read `CLAUDE.md` (project rules) and `ios/README.md` (architecture) first. Record what you change in
`docs/STATUS.md` and in the **Progress log** at the end of this file.

---

## 0. Where things stand (2026-10-21, commit `c10be8f`)

| Suite | Where it runs | Last result |
|---|---|---|
| SparkleKit package tests (36, incl. 4 against a live API) | `ios.yml` → "SparkleKit (swift test + live API)" | ✅ green |
| App unit tests `SparkleWashTests` (22) | `ios.yml` → "App (iPhone 16)" / "App (iPad Pro 13-inch (M4))" | ✅ 22/22 on iPhone and iPad |
| App UI tests `SparkleWashUITests` (6) | same jobs | ✅ 6/6 on iPhone and iPad ([run](https://github.com/jorgeafc00h/sparkle-wash/actions/runs/39686843731)) |
| ESP32-CAM firmware build | `ios.yml` → arduino-cli | ✅ green |
| API / gateway / web | `ci.yml` | ✅ green |

**First task:** run §2 locally to confirm your machine matches CI, then start the backlog at A2 (§5).

---

## 1. Machine setup (macOS)

You need:

- macOS 15 or later.
- **Xcode 16 or later**. CI runs the macOS 15 GitHub image with its default Xcode; its iOS simulator runtime is 26.2.
  - Check with `xcodebuild -version` and `xcrun simctl list runtimes`.
- XcodeGen: `brew install xcodegen`.
- Optional, for the live-API tests: the .NET 10 SDK (`brew install --cask dotnet-sdk`, or see `global.json`).
- Python 3 (already on macOS), for the result-parsing snippet below.

```bash
git clone https://github.com/jorgeafc00h/sparkle-wash.git && cd sparkle-wash
git checkout claude/great-brahmagupta-3ad9kq      # or main, once merged
cd ios && xcodegen generate                       # creates SparkleWash.xcodeproj (git-ignored)
```

Never commit `SparkleWash.xcodeproj`, `SparkleWash/Info.plist` or `Local.xcconfig`. All three are generated or
local. The source of truth is `ios/project.yml`.

Pick simulators. Use the same models CI uses; if your Xcode lacks them, any iPhone plus any iPad works:

```bash
xcrun simctl list devices available | grep -E "iPhone 16 |iPad Pro 13-inch \(M4\)"
IPHONE=$(xcrun simctl list devices available -j | python3 -c "import json,sys;d=[x for r,l in json.load(sys.stdin)['devices'].items() if 'iOS' in r for x in l];print([x['udid'] for x in d if x['name']=='iPhone 16'][-1])")
IPAD=$(xcrun simctl list devices available -j | python3 -c "import json,sys;d=[x for r,l in json.load(sys.stdin)['devices'].items() if 'iOS' in r for x in l];print([x['udid'] for x in d if x['name'].startswith('iPad Pro 13')][-1])")
echo "$IPHONE $IPAD"
```

---

## 2. Run everything, in this order

Run each step from `ios/` unless noted. Stop at the first red step and go to §3.

### 2.1 SparkleKit package (fast, no simulator)

```bash
cd ios/SparkleKit && swift test 2>&1 | tail -20
```

Expected: `Executed 36 tests, with 0 failures`. The 4 `IntegrationTests` are skipped unless
`SPARKLEWASH_API_URL` is set.

To include the live-API tests, start the API in another terminal (repo root), then run:

```bash
export SPARKLEWASH_INGEST_KEY=ci-ingest-key SPARKLEWASH_REGISTRATION_OPEN=true
export SPARKLEWASH_TENANTS_DIR=/tmp/sw/tenants SPARKLEWASH_DATA_FILE=/tmp/sw/obs.json \
       SPARKLEWASH_ARRIVALS_FILE=/tmp/sw/arrivals.json SPARKLEWASH_JOBS_FILE=/tmp/sw/jobs.json \
       SPARKLEWASH_DEVICES_FILE=/tmp/sw/devices.json SPARKLEWASH_OPERATIONS_FILE=/tmp/sw/ops.json \
       SPARKLEWASH_PHOTO_DIR=/tmp/sw/photos ASPNETCORE_URLS=http://127.0.0.1:5080
mkdir -p /tmp/sw && dotnet run --project src/carwash-api -c Release
# second terminal:
cd ios/SparkleKit && SPARKLEWASH_API_URL=http://127.0.0.1:5080 SPARKLEWASH_INGEST_KEY=ci-ingest-key swift test
```

### 2.2 App unit tests (22): iPhone, then iPad

```bash
cd ios
xcodebuild test -project SparkleWash.xcodeproj -scheme SparkleWash \
  -destination "id=$IPHONE" -only-testing:SparkleWashTests \
  -resultBundlePath /tmp/sw-unit-iphone.xcresult CODE_SIGNING_ALLOWED=NO 2>&1 \
  | grep -E "Test Case .*(passed|failed)|error: |Executed|\*\* TEST" | grep -v CoreData
```

Expected: `Executed 22 tests, with 0 failures` and `** TEST SUCCEEDED **`. Repeat with `id=$IPAD`.
Delete an existing result bundle before reusing its path (`rm -rf /tmp/sw-*.xcresult`); xcodebuild refuses to overwrite one.

### 2.3 App UI tests (6): one at a time first, then all

Run each test on its own first. A failure then shows exactly one cause.

```bash
for T in testDemoStartsInSpanishWithTheSplitView testConfirmingAnArrivalOpensAJob \
         testChangesMadeOfflineSyncWhenBackOnline testLinkingACameraShowsTheKeyOnce \
         testRegisteringADemoCarwashStartsTheChecklist testSwitchingToEnglish; do
  for DEV in $IPHONE $IPAD; do
    rm -rf /tmp/sw-ui-$T-$DEV.xcresult
    xcodebuild test -project SparkleWash.xcodeproj -scheme SparkleWash -destination "id=$DEV" \
      -only-testing:SparkleWashUITests/SparkleWashUITests/$T \
      -resultBundlePath /tmp/sw-ui-$T-$DEV.xcresult CODE_SIGNING_ALLOWED=NO 2>&1 \
      | grep -E "Test Case .*(passed|failed)|error: " | grep -v CoreData
  done
done
```

Then the full run, exactly as CI does it:

```bash
xcodebuild test -project SparkleWash.xcodeproj -scheme SparkleWash -destination "id=$IPAD" \
  -resultBundlePath /tmp/sw-all-ipad.xcresult CODE_SIGNING_ALLOWED=NO 2>&1 | tail -5
```

### 2.4 Read failures from a result bundle

The raw log is noisy. Use this:

```bash
xcrun xcresulttool get test-results tests --path /tmp/sw-all-ipad.xcresult --compact | python3 -c "
import json,sys
def walk(n,p=''):
    if n.get('nodeType')=='Test Case' and n.get('result')=='Failed':
        print('FAILED',p+'/'+n['name'])
        for c in n.get('children',[]):
            if c.get('nodeType')=='Failure Message': print('   ',c['name'])
    for c in n.get('children',[]): walk(c,p+'/'+n.get('name',''))
for n in json.load(sys.stdin).get('testNodes',[]): walk(n)"
```

To see what the UI looked like at the failure, `open /tmp/sw-all-ipad.xcresult` in Xcode, select the failed
test, and view the attached screenshot and the accessibility tree ("Sparse tree of matches").

### 2.5 Reading CI results (when you can't run a Mac)

- **GitHub web:** Actions → "iOS & firmware" → the run for your commit. Open the failed job; the
  **"Failed tests"** step lists failures and messages. The result bundle is uploaded as the
  `results-<device>` artifact.
- **gh CLI:**
  - `gh run list --workflow ios.yml --branch <branch> -L 3`
  - `gh run view <run-id> --log-failed | grep -E "FAILED|error: " | head -50`
  - `gh run download <run-id> -n "results-iPad Pro 13-inch (M4)"`
- Each push to `ios/**` triggers the workflow. A full run takes about 12 minutes.

---

## 3. What each UI test does, and how to fix it when it fails

All UI tests launch with `-ui-testing`. The app then:

- starts in Spanish;
- uses an in-memory SwiftData store;
- skips local-network discovery;
- slows the demo ticker so no new cars arrive mid-test.

The tests then tap "Probar la demo" (`demo-button`). The demo backend is `SparkleKit/DemoBackend.swift`. Its seed data:

| Data | Values |
|---|---|
| Pending arrivals (review) | `P482913` (conf 0.91) and `P9O3377` (conf 0.57), both from `entrance-cam` |
| Jobs | `P118450` washing (SUV, Renew, Maria + Ana), `C55821` queued, `TX4410` arrived, `SV2026` completed |
| Cameras | `entrance-cam` (Cámara de entrada), `bay1-cam` (Bahía 1), `exit-cam` (Cámara de salida); all firmware 1.2, online |
| Employees | Maria Garcia, Luis Hernandez, Ana Martinez, Carlos Rivera |
| Team | "Tú (demo)" admin, Maria (operator), invitation luis@ejemplo.com (viewer) |

Helpers in `SparkleWashUITests.swift`:

- **`element(id)`:** the first element with that accessibility identifier. SwiftUI repeats an identifier on
  wrapper views (toolbar items, row children), so never use `app.descendants(matching:.any)[id]`; it fails
  with "Multiple matching elements".
- **`open(section)`:** taps a sidebar row `section-<floor|review|board|plates|bays|admin>`. On iPhone it first walks
  back through the navigation stack (up to 4 back taps).
- **`openSettings()` / `setOffline(_:)`:** the settings sheet (`settings-button`, `offline-toggle`, `settings-close`).

| Test | Steps | Passes when | Likely failures → fix |
|---|---|---|---|
| `testDemoStartsInSpanishWithTheSplitView` | Demo → Revisión | Nav bar "Revisión de llegadas"; on iPad `section-board` is hittable and the detail shows "Elige una llegada de la lista" | Title changed in `web/src/i18n/es.ts` (`review.title`) → update test. iPad column hidden → check `MainSplitView` keeps `columnVisibility = .all` |
| `testConfirmingAnArrivalOpensAJob` | Review → `arrival-P482913` → `confirm-button` → Trabajos | Arrival row disappears; `job-P482913` exists | Confirm button off-screen → test swipes up once, else use `scrollToElement`. Row not tappable → arrival rows use `.accessibilityElement(children: .combine)` (keep it) |
| `testChangesMadeOfflineSyncWhenBackOnline` | Settings → offline on → confirm P482913 → Trabajos → open the job → settings → offline off | `sync-banner` and `provisional-note` show while offline, and there's no `advance-button`; after reconnecting the banner goes and the job stays | Toggle doesn't flip → test taps the switch at 95% width; check `value` is "1"/"0". Banner never clears → `AppModel.simulateOffline` setter must call `engine.sync()` |
| `testLinkingACameraShowsTheKeyOnce` | Admin → `link-camera-button` → name "Bahía 3", id `bay3-cam` → `create-key-button` → key sheet → `key-done-button` | `device-key` starts with `swd.`; after Done the sheet is gone and `device-bay3-cam` is listed | Select-All menu text differs by OS language → the test clears the field with select-all + delete. Simpler fallback: tap the field, then `typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 20))`. If the key sheet never appears, see `AdminMenuView`'s `onDismiss` chaining (sheet after sheet) |
| `testRegisteringADemoCarwashStartsTheChecklist` | Sign-in → `register-button` → `carwash-name` "Autolavado Brillante" → `register-demo-button` | `onboarding` (setup checklist) is visible | City/country required → the test types only the name; if validation tightens, also fill `carwash-country` |
| `testSwitchingToEnglish` | Settings → language picker "English" → close → Review | Nav bar "Arrival review" | Segmented picker buttons are labelled "Español"/"English"; keep those literal labels |

General patterns:

- **"Multiple matching elements"** → use `element(id)` (firstMatch), or narrow the query (`app.buttons[id]`).
- **"Not hittable"** → the element is off-screen or behind a sheet. Swipe up, wait for the sheet to close
  (`waitForNonExistence`), or on iPhone walk back with `open(section)`.
- **Lazy lists and keyboards:** Forms and Lists only create rows that are on screen, so use `reveal(element)`
  (swipes until hittable) before tapping anything below the fold. Close the keyboard (`typeText("\n")`) before
  tapping buttons it could cover on iPhone.
- **Waits:** always `waitForExistence(timeout:)` before tapping anything that appears after navigation or a sheet.
  Never `sleep`.
- **System alerts** (local network, Bluetooth): UI tests don't trigger them, because Bonjour is skipped under
  `-ui-testing` and Bluetooth only starts when the setup sheet opens. If one appears, add an
  `addUIInterruptionMonitor` in `setUp`.
- **Identifier repeated on a view's children:** apply `.accessibilityElement(children: .combine)` on rows and
  `.contain` on containers, then put the identifier on the combined element.
- **Changing view code:** keep every identifier the tests use. Full list: `add-employee`, `admin-carwash`,
  `admin-employees`, `admin-team`, `advance-button`, `arrival-<plate>`, `assign-menu`, `ble-password`,
  `ble-send`, `ble-setup-button`, `ble-ssid`, `camera-id`, `camera-name`, `camera-role`, `carwash-country`,
  `carwash-name`, `carwash-timezone`, `confirm-button`, `create-key-button`, `demo-button`, `device-<cameraId>`,
  `device-key`, `dismiss-button`, `employee-name`, `exit-hint`, `flash-toggle`, `invite-button`, `invite-email`,
  `job-<plate>`, `key-ble-button`, `key-done-button`, `language-picker`, `link-camera-button`, `link-error`,
  `live-toggle`, `offline-toggle`, `onboarding`, `package-<id>`, `plate-field`, `provisional-note`,
  `register-button`, `register-demo-button`, `role-<subject>`, `save-carwash`, `section-<name>`,
  `settings-button`, `settings-close`, `sign-out-button`, `signin-notice`, `sync-banner`, `team-message`,
  `toggle-device-button`, `vehicle-class`.

Unit test failures:

- **`LocalStoreTests` / `SyncEngineTests`:** these run against `DemoBackend` through `OfflineSwitchAPI`.
  - If a seed value changes, update the test, not the seed. The web demo mirrors the same seed in `web/src/lib/demo.ts`.
  - Keep the `ModelContainer` in a stored property of the test case; a context whose container was freed crashes.
- **`LocalizerTests`:** after changing strings, run `python3 ios/scripts/gen_strings.py` and commit the `.lproj` files.

---

## 4. Manual verification (after the tests are green)

Use the demo on an iPad simulator in landscape and on an iPhone. Take screenshots with
`xcrun simctl io <udid> screenshot ~/Desktop/<name>.png` and attach them to the progress log.

1. **Split view (iPad, landscape):** sidebar, list and detail all visible. Every sidebar section shows its list and a
   detail placeholder. Note how portrait and Split View multitasking (⅓ width) behave; the app should stay usable.
2. **Spanish by default:** fresh install shows "Probar la demo" and "Revisión de llegadas". Settings → English switches
   instantly, with no restart.
3. **Review flow:** P9O3377 shows "Revisar" (low confidence). Correct the plate to P903377, choose Camioneta / SUV and
   Renew; the price shown matches `contracts/v1/service-packages.json` (renew/suv = 30). Confirm → the job appears on Trabajos.
4. **Job flow:** advance a job Llegó → En cola → Lavando → Listo; assign Maria; the history shows every step.
5. **Offline:** Settings → *Simular sin conexión*.
   - Confirm an arrival and advance a job. Both apply at once, and the orange banner counts the pending changes.
   - The job opened offline shows the "Abierto sin conexión" note.
   - Switch back online: the banner clears and the server data matches.
6. **Admin:**
   - Link a camera: the suggested ID is free; using a taken ID shows "Ya hay una cámara con el ID…".
   - The key sheet can't be swiped away, and its command uses `sparklecam-<id>.local`.
   - "Configurar Wi-Fi por Bluetooth" opens the setup sheet.
7. **Accessibility:** Settings app → Accessibility → Larger Text (max). Note screens where text truncates or
   overlaps (backlog item B3). Run VoiceOver on the review list: one stop per arrival.

Real hardware (needs a device and an ESP32-CAM with firmware 1.2; see `edge/README.md`):

8. **Bluetooth setup:**
   - Power the camera with BOOT held; the flash blinks slowly.
   - Camera → *Configurar Wi-Fi por Bluetooth* → it appears as `SparkleCam-XXXX`.
   - Send the SSID and password: status goes connecting → "¡Conectada! IP …", then the camera reboots.
   - A wrong password shows "No se pudo conectar: auth".
9. **Wi-Fi:** on the same network, the camera detail shows "En la red: <ip>", the live view updates at 2–4 fps,
   and the Flash toggle lights the LED.

---

## 5. Backlog: next steps, in order

Each item lists what "done" means. Keep commits small: one item per commit, and CI green before the next.

### P0: make CI green and keep it green
- ~~**A1. Confirm the UI tests on both simulators.**~~ Done 2026-10-21 (`c10be8f`).
- **A2. De-flake.** Run the UI suite 3 times on each simulator (`-test-iterations 3`) to detect flaky tests. Fix each one
  at its root cause; never add retries or skip tests to get green. Done: 3/3 green on both.
- **A3. Make the result summary a script.** Move the §2.4 parser into `ios/scripts/test_summary.py`; CI and local runs both
  call it. Done: CI's "Failed tests" step uses the script.

### P1: UI test coverage for every feature
Add one UI test per flow, using the demo and the existing identifiers. Add new identifiers where missing,
following the `kebab-case` convention.
- **B1. Review:**
  - Dismiss P9O3377 with reason "No es cliente" (`dismiss-button`); the row disappears.
  - Edit the plate (`plate-field`), pick `vehicle-class` and `package-renew`; the price label shows $30.
- **B2. Jobs:** advance TX4410 (arrived) through all states (`advance-button`); `assign-menu` → Maria; cancel a job via the
  confirmation dialog.
- **B3. Plates and bays:** search "P118450" on Placas; the timeline lists entrance sightings. Bahías lists 4 bays; opening one
  shows the pressure and soap gauges.
- **B4. Team:** invite `nuevo@ejemplo.com` as operator (`invite-email`, `invite-button`); `team-message` confirms; an invalid
  email shows "Escribe un correo válido.".
- **B5. Employees:** add "Pedro Lopez" (`employee-name`, `add-employee`); adding the same name again shows a conflict.
- **B6. Carwash profile:** change the city and save (`save-carwash`); the success message shows. Clearing the name shows a validation error.
- **B7. Bluetooth sheet:** opens from the camera detail and from the key sheet (`key-ble-button`). In the simulator the
  state is "Bluetooth no está disponible…" or scanning; assert no crash and that the sheet closes with "Listo".
- **B8. Sign-out guard:** go offline, make a change, Settings → sign out → the confirmation dialog appears.
- **B9. iPhone navigation:** on iPhone each section pushes list → detail and back.

Done: about 15 UI tests, all green on both simulators, each under 60 s.

### P2: product polish (from the UI audit in `docs/STATUS.md`)
- **C1. Large text.**
  - Package rows, `JobRow`, `DeviceRow` and the floor feed switch to vertical stacks at accessibility sizes
    (`AnyLayout` on `dynamicTypeSize.isAccessibilitySize`).
  - The vehicle class picker becomes a menu on compact width.
  - Done: no truncation at AX5 on iPhone 16 (screenshots in the log).
- **C2. Registered camera names:** use `Device.name` from the cache wherever a camera ID is shown; fall back to
  `Localizer.camera(_:)`.
- **C3. Floor screen:**
  - An equipment row for offline cameras ("{name} sin señal desde {ago}").
  - "Todas las bahías normales" when there are no alerts.
  - Tag feed rows by sighting id, not plate.
- **C4. Job rows:**
  - Show an icon and accessibility label for a long wash, not color alone.
  - Add a "seen leaving" icon and a pending-sync badge for provisional jobs.
- **C5. Bluetooth sheet:**
  - A 20 s "no cameras found" state (`ios.ble.notFound` exists).
  - After connecting, offer "Ver en vivo" and "Copiar comando del gateway".
- **C6. Small fixes:**
  - Concatenated search label → `ios.plates.search` "Buscar {plate}".
  - Copy feedback resets after 2 s.
  - Progress spinner on the sign-in buttons while busy.
  - Unknown alert codes fall back to the code, not the key.

### P3: shipping
- **D1. Google sign-in, live.**
  - Create the iOS OAuth client (bundle `com.sparklewash.app`) and add it to the API's comma-separated
    `SPARKLEWASH_GOOGLE_CLIENT_ID`.
  - Fill `ios/Local.xcconfig` (see `ios/README.md`).
  - Done: sign in on a simulator against a running API, and register a carwash.
- **D2. Signing and TestFlight.**
  - Set `DEVELOPMENT_TEAM` and a unique bundle ID in `project.yml`, and add the 1024 px icon (already present) plus screenshots.
  - Archive with `xcodebuild archive -scheme SparkleWash -destination generic/platform=iOS` and upload.
  - Optional: a CI job with signing secrets.
- **D3. Real-device test pass:** §4 items 8–9 with a physical ESP32-CAM. Record firmware version, phone model and results.
- **D4. Privacy:**
  - Add `PrivacyInfo.xcprivacy` (UserDefaults API reason CA92.1; no tracking).
  - Review the usage strings `NSLocalNetworkUsageDescription` and `NSBluetoothAlwaysUsageDescription` in `project.yml`.

---

## 6. Rules for whoever continues

- **Branch and commits:** work on the assigned branch. Each commit message ends with the Co-Authored-By /
  Claude-Session lines (see `CLAUDE.md`). Never put model names in commits.
- **Strings:**
  - Never edit the generated `.lproj` files by hand. Add keys to `web/src/i18n/{es,en}.ts` (shared) or
    `ios/SparkleWash/Resources/ios-strings.json` (iOS-only), then run `python3 ios/scripts/gen_strings.py`.
  - Spanish is the default; every new string needs both es and en.
- **Contracts:**
  - Don't change the API contract from the iOS side. If a model needs a field, add it to the API, its tests and
    the SparkleKit model, plus a fixture in `SparkleKit/Tests/SparkleKitTests/Fixtures`.
  - Keep `DemoBackend` behaving like the API (same validation and status codes) and like `web/src/lib/demo.ts`.
- **Before pushing:**
  - Run `swift test` in `ios/SparkleKit`, plus the app tests you touched (§2).
  - If you changed strings, run `npm test` in `web` as well.
- **Don't touch** the dead code listed in `CLAUDE.md`.
- **After each session:** update the table in §0, add a line to the Progress log below, and update `docs/STATUS.md`.

## Progress log

| Date | Commit | What changed | Test result |
|---|---|---|---|
| 2026-10-21 | `4ac597b` | In-memory store under XCTest; CI lists failed tests | Unit 22/22 ✅ (iPhone); UI 2/6 |
| 2026-10-21 | `e73fb59` | UI tests use `firstMatch`; arrival rows combined for accessibility | iPad 5/6, iPhone 4/6 |
| 2026-10-21 | `e3fefd1` | `reveal()` scrolls lazy forms; offline switch flipped via its control and asserted | iPad 6/6 ✅, iPhone 5/6 |
| 2026-10-21 | `c10be8f` | Register test closes the keyboard first | **All green**: unit 22/22 + UI 6/6 on iPhone and iPad ✅ |
