# iOS UI and offline-history review — 2026-11-05

## Scope and method

Reviewed the active SwiftUI target declared by `SparkleWash-iOS/project.yml`,
`OperationsView.swift`, `OperationsModels.swift`, SwiftData archive tests, and
the November 5 public-catalog simulator captures. Applied the UI/UX Pro Max
SwiftUI and native pre-delivery guidance, then checked Apple's current SwiftUI,
SwiftData, and accessibility references. On November 5, launched the app on an
iPhone 17 Pro simulator against the local API, without staff OAuth credentials,
and captured the light-mode catalog at
`docs/reviews/2026-11-05-visual-smoke/iphone-17-pro-light-catalog.png`.
Captured the same catalog in dark appearance at
`docs/reviews/2026-11-05-visual-smoke/iphone-17-pro-dark-catalog.png`.
Captured the iPad Pro 13 catalog in light and dark appearances at
`docs/reviews/2026-11-05-visual-smoke/ipad-pro-13-light-catalog.png` and
`docs/reviews/2026-11-05-visual-smoke/ipad-pro-13-dark-catalog.png`.
Re-ran `make ios-test` after implementing signed offline history entitlements.

## Findings

- The live public-catalog screenshots have a clear title and package hierarchy,
  consistent native typography, readable price alignment, and distinct native
  card surfaces. The visible package cards show no clipping in light or dark
  appearance on iPhone 17 Pro and iPad Pro 13. The iPad uses a balanced four
  column layout; its lower half remains open because the public catalog has
  little content. Staff screens have no signed-in visual evidence.
- The active workboard uses `Section` containers within a `LazyVStack` with
  `pinnedViews: [.sectionHeaders]`. The connection/status strip uses
  `safeAreaInset`, keeping the pinned headers below it. This matches Apple's
  current pinned-header pattern.
- Job details use an iOS 18 zoom navigation transition. Status movement and
  queue changes honor Reduce Motion; ordinary polling does not animate job
  cards. Keep those effects tied to state changes rather than periodic refresh.
- The project initially restricted iPhone to portrait. Both landscape
  orientations are now declared in `project.yml`. Build and simulator tests
  pass, but a landscape capture is still needed to validate the layout.
- Completed-history rows now persist individually in `CachedArchivedJob`, with
  endpoint and tenant/subject/role scope, stable job ID, source batch, and sync
  time. The prior blob migrates on read. Sync downloads bounded pages, saves a
  page and its next offset together, resumes after reopening the disk-backed
  store, and keeps partial rows inaccessible until the full revision commits.
  There is no fixed total-job cap, but each page currently performs one
  SwiftData lookup per row and the local cache has no aggregate row or byte
  budget. The archive index issues a 24-hour ES256 entitlement
  bound to origin, tenant, staff subject, role, and archive revision. SwiftData
  persists it; the corresponding public key is pinned per API origin in the
  device-only Keychain during authenticated HTTPS sync. Cold restore requires
  an exact match to that pin, and an authenticated HTTPS sync accepts server
  key rotation. Tests reject a self-signed replacement and exercise rotation
  using an injected key store; a temporarily unavailable key store preserves
  the cache for a later retry. Real Keychain behavior remains unverified on a
  signed device build. The API can page completed jobs from PostgreSQL after
  migration 003 and its runtime grant are applied; Neon export, COS restore,
  and selective tombstones remain incomplete. IBM needs a protected P-256
  signing key before the feature can run there.
- Default secondary text measured 3.29:1 against a light card surface in the
  earlier capture. Operations secondary copy now uses semantic primary color
  at 0.72 opacity; refreshed light and dark captures look legible. A full pixel
  contrast audit across surfaces and Dynamic Type sizes remains open. VoiceOver
  focus through pinned headers, largest Dynamic Type, signed-in iPhone/iPad
  layouts, and Reduce Motion also need runtime acceptance. Interactive
  sign-in testing is not configured because staff OAuth credentials are absent.

## Verification

- `make ios-build` — passed.
- `make ios-test` — passed all 8 simulator tests on November 5, including
  disk-backed cold restoration, grant signature/scope/expiry validation,
  tamper and self-signed key replacement rejection, key rotation through the
  injected key store, temporary key-store failure preservation, migration from
  the former archive blob, expiry cleanup, withdrawn-batch handling, and
  interrupted page sync followed by disk-backed store reopen and resume.
- iPhone 17 Pro simulator, iOS 27, live catalog backed by the local API — light
  and dark appearance captures reviewed and saved; this does not cover
  signed-in workboard behavior or prove theme contrast at largest Dynamic Type.
- iPad Pro 13 simulator, iOS 27, live catalog backed by the local API — light
  and dark portrait captures reviewed and saved. Landscape and signed-in
  workboard acceptance remain outstanding.

## Follow-up fix — November 5, 2026

The follow-up audit found that expiry cleanup removed all cached archive rows
for an endpoint when one staff snapshot expired. Cleanup now relies on each
archive row's own 24-hour `syncedAt` expiry, preserving a still-valid row for
another staff scope at the same endpoint. The regression case is covered by
`testRestorePurgesExpiredStaffSnapshotsAndArchivePayloads`. Both the source
project and synchronized deployment mirror passed all 8 simulator tests on
iPhone 17 Pro / iOS 27.2.

## Neon history reader — November 5, 2026

The API now serves tenant-scoped completed-job pages from PostgreSQL when the
PostgreSQL workflow flag is enabled. Migration 003 advances a per-tenant
revision when displayed completed-job data changes; the page endpoint reads a
repeatable-read snapshot and rejects stale batch identifiers. Local PostgreSQL
18 integration coverage verified migration, runtime SELECT-only access to the
revision counter, cross-tenant isolation, stale-page rejection, readiness, and
the authorized HTTP index/page flow. Migration 003 and its runtime SELECT-only
grant have since been applied to Neon `main` and the grant was verified. The
API has not been connected to that database, and the COS export is not an API
read source yet. Keep the PostgreSQL feature flags off until cutover and import
acceptance are complete.

## Next implementation steps

1. Capture the signed-in workboard in phone portrait/landscape and iPad
   landscape, then exercise pinned headers with VoiceOver and large
   Dynamic Type in light/dark appearances and Reduce Motion.
2. Reduce per-page SwiftData query overhead, define and enforce a local row/byte
   budget without silently losing archive records, and decide whether completed
   rows need to remain usable beyond the 24-hour entitlement window.
3. Add selective deletion/revocation markers and test tenant-wide changes that
   affect a downloaded archive. Run a signed-device force-quit/relaunch test
   with real Keychain persistence; the current reopen test reconstructs the
   SwiftData container in the simulator process.
4. Only advertise long-term local archive after encrypted object export,
   checksum verification, isolated restore, file protection, backup exclusion,
   storage policy, and deletion propagation have been verified. Neon `main`
   now has migration 003 and the runtime SELECT grant; enable hosted PostgreSQL
   reads only after operational-store cutover and import/restore acceptance.

## References

- [Apple WWDC26: Dive into lazy stacks and scrolling with SwiftUI](https://developer.apple.com/videos/play/wwdc2026/321/)
- [Apple: Grouping data with lazy stack views](https://developer.apple.com/documentation/swiftui/grouping-data-with-lazy-stack-views)
- [Apple: Reduce Motion](https://developer.apple.com/documentation/swiftui/environmentvalues/accessibilityreducemotion)
- [Apple: SwiftData model persistence](https://developer.apple.com/documentation/swiftdata/preserving-your-apps-model-data-across-launches)
- [Apple: Fluid navigation transitions](https://developer.apple.com/documentation/uikit/enhancing-your-app-with-fluid-transitions)
