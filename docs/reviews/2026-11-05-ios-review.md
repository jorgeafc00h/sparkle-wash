# iOS UI and offline-history review — 2026-11-05

## Scope and method

Reviewed the active SwiftUI target declared by `SparkleWash-iOS/project.yml`,
`OperationsView.swift`, `OperationsModels.swift`, SwiftData archive tests, and
the November 4 public-catalog simulator capture. Applied the UI/UX Pro Max
SwiftUI and native pre-delivery guidance, then checked Apple's current SwiftUI,
SwiftData, and accessibility references. Re-ran `make ios-build` and
`make ios-test` after adding per-job archive rows.

## Findings

- The public-catalog screenshot has a clear title and package hierarchy,
  consistent native typography, readable price alignment, and semantic dark
  surfaces. The first two package cards show no clipping. This is evidence for
  the public catalog only; staff screens have no signed-in visual evidence.
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
  time. The prior blob migrates on read. Discovery is still capped at 100
  batches and 1,000 jobs, and the client buffers the current archive before
  replacing the rows. Cold-launch offline reading requires a live staff token
  and has no signed short-lived entitlement. This remains an expiring local
  cache, not an independently durable local Neon archive.
- VoiceOver focus through pinned headers, largest Dynamic Type, light-mode
  contrast, signed-in iPhone/iPad layouts, and Reduce Motion need runtime
  acceptance. The Mac was locked during this review, preventing direct
  Simulator app automation; `simctl` tests ran successfully.

## Verification

- `make ios-build` — passed.
- `make ios-test` — passed all 7 simulator tests, including disk-backed
  per-job persistence, migration from the former archive blob, expiry cleanup,
  and withdrawn-batch handling.
- Existing dark-mode public-catalog screenshot — reviewed; this does not cover
  signed-in workboard behavior.

## Next implementation steps

1. Capture the workboard in phone portrait/landscape and iPad
   portrait/landscape, then exercise pinned headers with VoiceOver and large
   Dynamic Type in light/dark appearances and Reduce Motion.
2. Replace the server's file-only archive source with Neon-backed stable
   revisions, resumable cursors, and tombstones. Remove the 100-batch/1,000-job
   cap and persist each bounded page transactionally in the existing
   tenant/account-scoped SwiftData rows. Keep operational snapshot freshness
   separate.
3. Add signed offline entitlements and propagate revocation and deletion
   markers before claiming cold-launch offline history.
4. Only advertise long-term local archive after encrypted object export,
   checksum verification, isolated restore, file protection, backup exclusion,
   bounded storage, and deletion propagation have been verified.

## References

- [Apple WWDC26: Dive into lazy stacks and scrolling with SwiftUI](https://developer.apple.com/videos/play/wwdc2026/321/)
- [Apple: Grouping data with lazy stack views](https://developer.apple.com/documentation/swiftui/grouping-data-with-lazy-stack-views)
- [Apple: Reduce Motion](https://developer.apple.com/documentation/swiftui/environmentvalues/accessibilityreducemotion)
- [Apple: SwiftData model persistence](https://developer.apple.com/documentation/swiftdata/preserving-your-apps-model-data-across-launches)
- [Apple: Fluid navigation transitions](https://developer.apple.com/documentation/uikit/enhancing-your-app-with-fluid-transitions)
