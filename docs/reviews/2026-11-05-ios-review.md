# iOS UI and offline-history review — 2026-11-05

## Scope and method

Reviewed the active SwiftUI target declared by `SparkleWash-iOS/project.yml`,
`OperationsView.swift`, `OperationsModels.swift`, SwiftData archive tests, and
the November 4 public-catalog simulator capture. Applied the UI/UX Pro Max
SwiftUI and native pre-delivery guidance, then checked Apple's current SwiftUI,
SwiftData, and accessibility references. Ran `make ios-build` and `make
ios-test` after enabling iPhone landscape orientations.

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
- Completed-history rows are still serialized together into one optional
  `Data` field on `CachedOperationsSnapshot`. Discovery is capped at 100 batches
  and 1,000 jobs. Cold-launch offline reading requires a live staff token and
  has no signed short-lived entitlement. The app therefore has an expiring
  SwiftData cache, not an independently durable local Neon archive.
- VoiceOver focus through pinned headers, largest Dynamic Type, light-mode
  contrast, signed-in iPhone/iPad layouts, and Reduce Motion need runtime
  acceptance. The Mac was locked during this review, preventing direct
  Simulator app automation; `simctl` tests ran successfully.

## Verification

- `make ios-build` — passed.
- `make ios-test` — passed all 7 simulator tests.
- Existing dark-mode public-catalog screenshot — reviewed; this does not cover
  signed-in workboard behavior.

## Next implementation steps

1. Capture the workboard in phone portrait/landscape and iPad
   portrait/landscape, then exercise pinned headers with VoiceOver and large
   Dynamic Type in light/dark appearances and Reduce Motion.
2. Replace the single archive `Data` snapshot with tenant/account-scoped
   `ArchivedJob` SwiftData rows. Persist each bounded server page and resume
   from a stable server revision/cursor; keep the 24-hour operational snapshot
   policy separate.
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
