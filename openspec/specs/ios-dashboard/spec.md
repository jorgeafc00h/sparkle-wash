# Native dashboard

## Purpose
Specify the buildable Swift 6 / SwiftUI iOS 18+ dashboard and its shared baseline with the web app. Native colors and SwiftData replace the unimplemented CSS-injection prototype.

## Requirements

### Requirement: Native application target
The Xcode project SHALL contain an application target with one App entry point, valid source references and a simulator test target. Project structure SHALL be reproducible from project.yml using XcodeGen.

#### Scenario: Build for iOS simulator
- **WHEN** xcodebuild builds the SparkleWash scheme for iphonesimulator with signing disabled
- **THEN** it produces SparkleWash.app successfully

### Requirement: Shared API dashboard
The app SHALL decode the same flat station and alert contracts as the web app, label demo data and show pressure, soap, units, phase and textual threshold states. Threshold boundaries SHALL match the web dashboard. It SHALL refresh while active, waiting three seconds between completed polling cycles, and offer manual refresh.

#### Scenario: Read a station snapshot
- **WHEN** the API returns pressure 60 and soap 55
- **THEN** the station card identifies pressure as good and soap as warning

### Requirement: SwiftData offline cache
The app SHALL persist successful snapshots in SwiftData, keyed by API endpoint, restore them as stale, and retain them on network failure. It SHALL surface storage and network errors. Cached snapshots SHALL NOT be uploaded back to the server.

#### Scenario: Switch API endpoint
- **WHEN** an endpoint with no saved snapshot is selected
- **THEN** the app does not display another endpoint's cached stations

### Requirement: Adaptive accessible layout
The app SHALL use Dynamic Type and semantic system colors. On regular-width windows at least 900 points wide and below accessibility text sizes it SHALL show station cards alongside alerts and refresh history. Otherwise it SHALL stack sections vertically. Controls SHALL be labeled and at least 44 points, and readings SHALL have spoken values and text states.

#### Scenario: Large accessibility text size
- **WHEN** the text size is an accessibility size
- **THEN** the dashboard uses a vertical layout with wrapping text instead of the wide split layout

### Requirement: Configurable API address
Settings SHALL accept an HTTP or HTTPS server address without credentials, query or fragment. The default SHALL be localhost port 8080 for the simulator. The app SHALL explain how to configure a device server.

#### Scenario: Invalid endpoint
- **WHEN** the address uses file scheme or embeds credentials
- **THEN** Save is disabled and an inline validation message is shown
