# SparkleWash para iOS / iPadOS

SwiftUI app for the carwash staff: the same features as the web console (`/app/`), in Spanish by default.

| | |
|---|---|
| **iPad** | `NavigationSplitView` in three columns: sections · list · detail. |
| **iPhone** | The same columns collapse into a navigation stack. |
| **Offline** | SwiftData keeps arrivals, jobs, cameras, employees, the price list and photos on the device. Changes made without signal (confirm an arrival, advance or cancel a job, assign, dismiss) apply on screen at once. They queue in order and sync when the connection returns. Every request has an idempotency key, so retries never duplicate a job. |
| **Live** | The server's change feed (SSE) triggers a refresh, with a 30 s poll as backup. |
| **Cameras** | Wi-Fi: Bonjour finds the ESP32-CAM (`_sparklewash._tcp`) for a live view and flash control. Bluetooth LE: sends the Wi-Fi details to a camera in setup mode. See `edge/README.md`. |
| **Sign-in** | Google (`ASWebAuthenticationSession` + PKCE). Session token in the Keychain. |
| **Demo** | Runs the whole app without a server, including a "simulate offline" switch. |

## Layout

```
ios/
├── project.yml            XcodeGen spec (app + unit tests + UI tests)
├── Config.xcconfig        server / Google settings (override in Local.xcconfig, git-ignored)
├── SparkleKit/            Swift package: models, API client, outbox, Google OAuth (PKCE),
│                          camera LAN client + BLE protocol, demo backend. `swift test`.
├── SparkleWash/           the app (App/, Data/ SwiftData + sync, Devices/ Bonjour + BLE, Views/)
├── SparkleWashTests/      LocalStore, SyncEngine (offline → online), Localizer
├── SparkleWashUITests/    demo flows on iPhone and iPad
└── scripts/gen_strings.py Localizable.strings from web/src/i18n + Resources/ios-strings.json
```

## Build and run

```bash
brew install xcodegen
cd ios
xcodegen generate
open SparkleWash.xcodeproj           # Run on an iPad or iPhone simulator; "Probar la demo" needs no server
```

Tests:

```bash
cd ios/SparkleKit && swift test                       # package tests (live-API tests skip without SPARKLEWASH_API_URL)
cd ios && xcodebuild test -project SparkleWash.xcodeproj -scheme SparkleWash \
  -destination 'platform=iOS Simulator,name=iPad Pro 13-inch (M4)' CODE_SIGNING_ALLOWED=NO
```

CI (`.github/workflows/ios.yml`) runs all of this on macOS against a live API, on an iPhone and an iPad
simulator, and compiles the ESP32-CAM firmware.

## Connecting to your server

Create `ios/Local.xcconfig`:

```
SPARKLEWASH_API_URL = https:/$()/your-api.azurewebsites.net
GOOGLE_IOS_CLIENT_ID = 1234567890-abc.apps.googleusercontent.com
GOOGLE_REDIRECT_SCHEME = com.googleusercontent.apps.1234567890-abc
```

Set up Google:

1. In Google Cloud Console → *APIs & Services → Credentials*, create an **iOS** OAuth client with bundle ID `com.sparklewash.app`.
2. Add its client ID to the API's `SPARKLEWASH_GOOGLE_CLIENT_ID`, comma-separated with the web client ID. The API accepts tokens from either.
3. The redirect scheme is the client ID reversed (`com.googleusercontent.apps.<id>`).

## Strings

The UI strings are the web console's (`web/src/i18n/es.ts`, `en.ts`) plus `SparkleWash/Resources/ios-strings.json`. After changing either, run:

```bash
python3 ios/scripts/gen_strings.py
```
