# Web dashboard

## Purpose
Specify the mounted React 18 dashboard in frontend/src/App.tsx. Unrouted admin, payment and experimental spec UIs are not supported features.

## Requirements

### Requirement: Validated polling and connection feedback
The dashboard SHALL poll `/api/metrics` and `/api/metrics/alerts` every three seconds with non-overlapping requests, an eight-second timeout, and cancellation on unmount. It SHALL validate snapshots and alerts, label demo data, and expose loading, error, empty and stale states.

#### Scenario: API returns an invalid nested station array
- **WHEN** an API response contains an array of arrays instead of station objects
- **THEN** the dashboard rejects it and retains any last valid snapshot with a visible refresh error

### Requirement: Persisted snapshot fallback
The dashboard SHALL save successfully validated station and alert snapshots to localStorage when storage is available. On startup it SHALL restore that snapshot as stale until a new request succeeds. Failed polling SHALL retain the saved timestamp and data.

#### Scenario: Network is unavailable after a successful refresh
- **WHEN** the next API request fails
- **THEN** previous readings remain visible and are marked as saved data, without claiming to be connected

### Requirement: Accessible shared readings and layout
The dashboard SHALL display status, pressure and soap values with units and textual threshold states. Pressure below 45 SHALL warn, 45 through 60 SHALL be good, and above 60 SHALL be danger. Soap below 35 SHALL be danger, 35 through 55 SHALL warn, and above 55 SHALL be good. Layout SHALL reflow to one column on small phones, with labeled controls and visible keyboard focus.

#### Scenario: Read boundary values without color perception
- **WHEN** pressure is 60 psi and soap is 55 dm
- **THEN** the UI labels pressure good and soap warning in text as well as visual styling

### Requirement: Offline application shell
Production builds SHALL register a syntactically valid JavaScript service worker and serve a manifest. The worker SHALL cache the shell and visited same-origin assets, while excluding API requests and non-GET operations. API snapshot freshness SHALL be managed by the dashboard.

#### Scenario: Reopen a previously loaded dashboard offline
- **WHEN** the service worker has activated and cached the visited build assets
- **THEN** the dashboard shell and last locally saved snapshot can be displayed with a stale status

### Requirement: Refresh activity provenance
The dashboard SHALL show up to twenty local refresh entries and explicitly identify them as refresh history, not sensor events.

#### Scenario: Poll succeeds
- **WHEN** the API snapshot is refreshed
- **THEN** the latest local activity entry records the time and station count
