# SparkleWash iOS workboard: current review and implementation plan

Reviewed November 5, 2026 against the active iOS target, `OperationsView.swift`, `OperationsModels.swift`, the disk-backed SwiftData archive tests, and current Apple documentation. The app targets iOS 18 and is generated from `SparkleWash-iOS/project.yml`.

## Current implementation

- The app uses a restrained teal accent, SF Symbols, semantic system surfaces, adaptive text, and labeled status chips.
- One `ScrollView` contains a `LazyVStack` with real `Section` headers for arrivals and jobs. The headers use `pinnedViews: [.sectionHeaders]`; the connection status strip stays above the scroll area. The layout keeps this structure at wide widths as well, so the headers remain pinned on iPad.
- Job cards open details with the iOS 18 zoom navigation transition. Reduce Motion uses standard navigation, suppresses status animation, and now suppresses job queue movement animation.
- SwiftData keeps endpoint-scoped operational snapshots and one `CachedArchivedJob` row per completed-history job, scoped by endpoint and the encoded tenant/subject/role identity. The row records its source batch and sync time. Staff data is restored only after a matching live sign-in within the server session and 24-hour local freshness limits. Sign-out clears that endpoint's local records.
- Completed History fetches the authenticated archive index and pages through batches, replaces the saved row set only after a complete sync, migrates the earlier encoded `Data` snapshot on read, and clears saved rows when a batch is withdrawn. Disk-backed tests cover row persistence, legacy migration, and withdrawal.
- Polling runs while foregrounded every 30 seconds after success, backs off after errors, and is suspended in the background.
- Sign-in exchange responses are now tied to an attempt generation. A newer sign-in attempt, endpoint change, or sign-out invalidates late responses so they cannot restore an old session.

## Remaining review findings

1. **Archive growth:** client sync currently caps discovery at 100 batches and 1,000 jobs. Larger tenants cannot receive a complete history snapshot. Implement server cursors with bounded incremental pages and a revision or withdrawal marker so clients can update without redownloading every batch.
2. **Local retention and the requested Neon archive:** the new per-job SwiftData rows remain a 24-hour cache, not a durable Neon archive. The app reads `/api/history/archive` from compressed files under `SPARKLEWASH_ARCHIVE_DIR`; there is no Neon export pipeline or IBM Object Storage integration in the active API. Cold-launch offline access also fails because restore clears the live token, expiry and staff scope. Design a server-signed, short-lived offline entitlement bound to endpoint, tenant, staff subject, role and a server archive revision. A device must verify it offline without storing a reusable server token; sign-out, tenant/account switch, confirmed revocation on next sync, expiry or explicit deletion must remove access. State the revocation delay inherent in a bounded offline grant. The current sync still buffers at most 1,000 jobs and replaces its rows after a complete sync; it does not resume from a stable cursor. Keep staff operational cache freshness separate. SwiftData must not be the sole archive of rows purged from Neon: first export completed rows and evidence to private object storage, verify manifest/checksums, restore into an isolated database, then permit per-device caching. Document and verify file protection, backup exclusion, cache limits, paging/resume and deletion propagation before storing plates long-term.
3. **Visual acceptance:** a default-size dark-mode iPhone 17 Pro public-catalog smoke is captured in [the visual review](reviews/2026-11-04-visual-smoke/review.md); the package catalog rendered with no clipping in the first two cards. Signed-in screenshots and interaction evidence are still needed on iPhone portrait and landscape and iPad portrait and landscape, including large accessibility text, VoiceOver, light/dark appearance, Reduce Motion, header pinning, and navigation return position. The project now declares iPhone landscape support, but that layout still needs simulator verification. Signed-in acceptance needs a configured Google staff account and seeded tenant.
4. **Session boundary:** cold-launch offline access is not implemented. The OpenSpec requires authorized offline history, so implement the bounded signed entitlement before calling the feature complete. Test endpoint changes, cold relaunch, tenant/account changes, sign-out during sign-in, expiry, clock rollback/forward, confirmed revocation, and behavior while offline until entitlement expiry.

## Planned sequence

1. Complete the signed-in visual acceptance matrix on phone portrait/landscape and iPad portrait/landscape; fix any clipping, focus obstruction, contrast, or scroll restoration issues it reveals.
2. Replace the archive API’s file-only source with a Neon-backed, tenant-scoped archive index and add opaque cursors, stable revisions, tombstones and bounded pages. Persist each downloaded page transactionally in SwiftData and resume from the last committed cursor; remove the 100-batch/1,000-job client cap without unbounded memory buffering.
3. Implement an idempotent server export from Neon to encrypted IBM COS, with versioned manifest, object references, counts and checksums. Restore a sample into an isolated Neon database and verify row/object counts and checksums before any purge. Start with 90 days of online completed records and 30 days of online evidence; archive eligible evidence only when its retention exceeds IBM COS Archive’s 90-day minimum. Keep open jobs, financial/audit holds and unresolved disputes out of purge.
4. Define the bounded offline entitlement and server/device retention windows with the business. Implement signed entitlement verification for the existing `CachedArchivedJob` SwiftData rows, separate from the 24-hour operational snapshot. Define local file protection, backup exclusion, cache-size behavior, explicit deletion and tombstone/revocation handling. Keep photo bytes out of the local archive; store only metadata and evidence references. Expand the row cache to page-level resume only after the API provides stable revisions and cursors.
5. Add small state transitions only for committed changes: animate status movement and numeric count changes, leave routine polling quiet, and honor Reduce Motion. Keep transitions interruptible and test job card-to-detail navigation both ways.
6. Re-run `make ios-build` and the simulator test command in `README.md`; then perform the signed-in visual acceptance above. Do not mark archive parity complete until large-history paging, local archive retention, and withdrawal behavior are covered by the API and simulator.

### Verification on November 4, 2026

`make ios-build` succeeded after the session-generation and wide-layout changes. After adding 24-hour local data eviction, `make ios-test` passed all 7 simulator tests, including expiry cleanup, disk-backed archive persistence, and withdrawn-batch handling. These results verify compilation and current automated behavior; they do not prove cold-launch offline entitlement, incremental large-tenant resume, Neon export/restore, or signed-in iPhone/iPad visual acceptance.

### Follow-up on November 5, 2026

The iPhone target now declares portrait and both landscape orientations. `make ios-build` succeeded and `make ios-test` passed all 7 simulator tests after the change. The landscape runtime layout has not yet been visually captured. The simulator is available through `simctl`, but desktop UI automation could not access the Simulator app while macOS was locked; complete the landscape screenshot and signed-in accessibility matrix when the Mac is unlocked.

### Follow-up on November 5, 2026: per-job archive persistence

`CachedArchivedJob` now persists one job per SwiftData row with endpoint, tenant/subject/role scope, stable job ID, source batch, and sync time. The prior single-blob cache migrates when read; a complete successful sync replaces the scoped rows, and withdrawal, account-scope change, sign-out, and 24-hour expiry remove them. The existing session-bound history access check remains in force, so this does not enable cold-launch offline access. `make ios-build` succeeded and `make ios-test` passed all 7 tests, including disk-backed row reopen, legacy-cache migration, batch withdrawal, and expiry cleanup. The 100-batch/1,000-job cap and full-history in-memory sync remain until the server supplies resumable stable cursors.

## Design and platform guidance

UI UX Pro Max was used for the workboard and accessibility review. The SwiftUI stack search recommends accessible labels, Dynamic Type, semantic views and honoring `accessibilityReduceMotion`; the implementation applies restrained state-driven motion to job-status changes and suppresses it when requested. The focused stack search did not find a pinned-header/VoiceOver-focus match, so test that behavior directly with VoiceOver on iPhone and iPad. Its offline/archive searches also found no useful match; the retention and entitlement requirements here come from OpenSpec and code findings, not a claimed skill result.

Apple's current guidance says to put grouped content in `Section` containers inside a lazy stack and set `pinnedViews` on that stack to keep section headers visible. WWDC26 also notes that lazy-stack positions are estimates and can shift as rows are measured, so preserve visible content anchors and avoid offset-based scroll logic; filter data before creating leaf views. SwiftData's `ModelContext` manages model lifecycle and writes changes to the persistent store; use explicit `save()` for archive snapshot replacement and deletion. Current reference pages:

- [Grouping data with lazy stack views](https://developer.apple.com/documentation/swiftui/grouping-data-with-lazy-stack-views)
- [Dive into lazy stacks and scrolling with SwiftUI — WWDC26](https://developer.apple.com/videos/play/wwdc2026/321/)
- [PinnedScrollableViews](https://developer.apple.com/documentation/swiftui/pinnedscrollableviews)
- [SwiftUI navigationTransition](https://developer.apple.com/documentation/swiftui/navigationtransition)
- [SwiftUI Reduce Motion environment](https://developer.apple.com/documentation/swiftui/environmentvalues/accessibilityreducemotion)
- [SwiftData ModelContext](https://developer.apple.com/documentation/swiftdata/modelcontext)
- [Preserving SwiftData models across launches](https://developer.apple.com/documentation/swiftdata/preserving-your-apps-model-data-across-launches)
