# SparkleWash iOS workboard: current review and implementation plan

Reviewed November 4, 2026 against the active iOS target, `OperationsView.swift`, `OperationsModels.swift`, the disk-backed SwiftData archive tests, and current Apple documentation. The app targets iOS 18 and is generated from `SparkleWash-iOS/project.yml`.

## Current implementation

- The app uses a restrained teal accent, SF Symbols, semantic system surfaces, adaptive text, and labeled status chips.
- One `ScrollView` contains a `LazyVStack` with real `Section` headers for arrivals and jobs. The headers use `pinnedViews: [.sectionHeaders]`; the connection status strip stays above the scroll area. The layout keeps this structure at wide widths as well, so the headers remain pinned on iPad.
- Job cards open details with the iOS 18 zoom navigation transition. Reduce Motion uses standard navigation, suppresses status animation, and now suppresses job queue movement animation.
- SwiftData keeps endpoint-scoped operational snapshots and completed-history batches. Staff data is scoped by tenant, subject, and role and is restored only after a matching live sign-in within the server session and 24-hour local freshness limits. Sign-out clears that endpoint's local record.
- Completed History fetches the authenticated archive index and pages through batches, replaces the saved snapshot only after a complete sync, and reports withdrawn batches. Disk-backed tests cover reopening the store and a withdrawn batch.
- Polling runs while foregrounded every 30 seconds after success, backs off after errors, and is suspended in the background.
- Sign-in exchange responses are now tied to an attempt generation. A newer sign-in attempt, endpoint change, or sign-out invalidates late responses so they cannot restore an old session.

## Remaining review findings

1. **Archive growth:** client sync currently caps discovery at 100 batches and 1,000 jobs. Larger tenants cannot receive a complete history snapshot. Implement server cursors with bounded incremental pages and a revision or withdrawal marker so clients can update without redownloading every batch.
2. **Local retention and the requested Neon archive:** the current SwiftData history is a 24-hour cache, and cold-launch offline access still requires a live staff sign-in. Expired archive payloads are deleted on history access or app restore; stale staff snapshots are scrubbed while the public catalog is retained. A simulator test covers cleanup. This does not yet satisfy a durable, offline SwiftUI archive of Neon history. Define a separate local archive entitlement and retention policy, then persist completed records incrementally in a dedicated SwiftData model keyed by endpoint, tenant, and stable job ID. Keep the short-lived staff snapshot policy separate. A per-device SwiftData copy must not be the sole archive of records purged from Neon: first export to an independent object store, validate checksums and restore, then let signed-in devices cache the approved history. Document and verify data protection, backup exclusion, and a cache size bound before storing plates long-term.
3. **Visual acceptance:** a default-size dark-mode iPhone 17 Pro public-catalog smoke is captured in [the visual review](reviews/2026-11-04-visual-smoke/review.md); the package catalog rendered with no clipping in the first two cards. Signed-in screenshots and interaction evidence are still needed on iPhone and iPad, including large accessibility text, VoiceOver, light/dark appearance, Reduce Motion, header pinning, and navigation return position. This needs a configured Google staff account and seeded tenant.
4. **Session boundary:** cold-launch offline access still requires a live staff sign-in. Keep this behavior explicit until the product defines an offline entitlement. Verify endpoint change, concurrent sign-in, sign-out during sign-in, revoked membership, and expired-session behavior in simulator acceptance.

## Planned sequence

1. Complete the signed-in visual acceptance matrix and fix any clipping, focus obstruction, contrast, or scroll restoration issues it reveals.
2. Add archive page cursors and server revision/withdrawal semantics. Keep each response bounded; persist each completed page transactionally, deduplicate by stable job ID, and resume from the last committed cursor. Do not silently truncate large tenants.
3. Decide the server and device retention windows, offline access boundary, and archive export target. Do not purge Neon data until an independent export has passed checksum and restore validation.
4. Add the separately authorized SwiftData archive model and incremental sync. Define tenant scoping, device data protection, backup exclusion, explicit local deletion, cache size limits, and how revocations or server tombstones reach offline devices. Keep photos out of the local archive unless specifically requested. The existing 24-hour cache purge is covered by a regression test.
5. Add small state transitions only for committed changes: animate status movement and numeric count changes, leave routine polling quiet, and honor Reduce Motion. Keep transitions interruptible and test job card-to-detail navigation both ways.
6. Re-run `make ios-build` and the simulator test command in `README.md`; then perform the signed-in visual acceptance above. Do not mark archive parity complete until large-history paging, local archive retention, and withdrawal behavior are covered by the API and simulator.

### Verification on November 4, 2026

`make ios-build` succeeded after the session-generation and wide-layout changes. After adding 24-hour local data eviction, `make ios-test` passed all 7 simulator tests, including expiry cleanup, disk-backed archive persistence, and withdrawn-batch handling. These results verify compilation and current automated behavior; they do not replace signed-in iPhone/iPad visual acceptance.

## Design and platform guidance

UI UX Pro Max was used for the workboard and accessibility review. Its focused SwiftUI search recommends honoring Reduce Motion and using state-driven animation; the implementation applies motion to job-status changes and suppresses it when requested. Keep accessibility checks focused on observable outcomes such as target size, contrast, VoiceOver labels, and whether pinned headers cover the focused control.

Apple's current guidance says to put grouped content in `Section` containers inside a lazy stack and set `pinnedViews` on that stack to keep section headers visible. SwiftData's `ModelContext` manages model lifecycle and writes changes to the persistent store; use explicit `save()` for archive snapshot replacement and deletion. Current reference pages:

- [Grouping data with lazy stack views](https://developer.apple.com/documentation/swiftui/grouping-data-with-lazy-stack-views)
- [PinnedScrollableViews](https://developer.apple.com/documentation/swiftui/pinnedscrollableviews)
- [SwiftUI navigationTransition](https://developer.apple.com/documentation/swiftui/navigationtransition)
- [SwiftUI Reduce Motion environment](https://developer.apple.com/documentation/swiftui/environmentvalues/accessibilityreducemotion)
- [SwiftData ModelContext](https://developer.apple.com/documentation/swiftdata/modelcontext)
- [Preserving SwiftData models across launches](https://developer.apple.com/documentation/swiftdata/preserving-your-apps-model-data-across-launches)
