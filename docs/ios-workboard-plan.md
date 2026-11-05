# SparkleWash iOS review and implementation plan

Reviewed November 5, 2026 against the active iOS 18 target, API archive routes, current OpenSpec, simulator tests and Apple documentation. The Xcode project is generated from `SparkleWash-iOS/project.yml`.

## Current implementation

- The active app is a SwiftUI operations workboard with a restrained teal accent, SF Symbols, semantic surfaces, adaptive SwiftUI text styles, and textual job-state labels. The November 4 iPhone 17 Pro dark-mode capture verifies the public catalog only; it does not verify signed-in screens or the latest contrast changes.
- Arrivals and jobs are `Section` containers in one `LazyVStack` with `pinnedViews: [.sectionHeaders]`. The status strip sits in a top safe-area inset. This structure is used across widths, though signed-in iPad and landscape behavior still needs visual validation.
- Job cards use an iOS 18 matched zoom navigation transition. Reduce Motion selects standard navigation and disables the job movement and status animations. State changes animate; routine polling does not intentionally animate.
- Secondary copy now uses `Color.primary.opacity(0.72)` on semantic system surfaces to improve adaptive contrast. No post-edit light/dark contrast measurement has been recorded. Reorder warnings and other semantic status colors also need measured contrast and VoiceOver review.
- SwiftData stores endpoint-scoped operational snapshots and one `CachedArchivedJob` row per history job, scoped by endpoint plus tenant, subject and role. The archive cache has a 24-hour maximum. Restore scrubs expired operational data and validates saved history; sign-out deletes the endpoint's operational and archive rows.
- Cold-launch history access is implemented with a server-issued ES256 grant, bound to API origin, tenant, staff subject, role and archive revision, with a maximum 24-hour lifetime. The app verifies the grant and uses it only for read-only saved history; it does not restore a bearer token or enable staff mutations. History expiry is checked while the history view is open and when returning to the foreground.
- The API requires `SPARKLEWASH_OFFLINE_SIGNING_PRIVATE_KEY` to issue grants. The IBM deployment plan requires that P-256 PEM as a protected runtime secret. No configured cloud deployment or real signing key was verified during this review. The public key currently accompanies the grant over HTTPS; key trust bootstrap and rotation still need production policy and tests.
- The archive API currently reads compressed tenant files under `SPARKLEWASH_ARCHIVE_DIR`. It is not yet a Neon-backed archive source or a Neon-to-IBM Object Storage export. The SwiftData rows are a device cache, not the durable archive of record.

## Remaining findings

1. **Cold-offline entitlement: implementation present, production validation incomplete.** The simulator test creates a new `OperationsModel` over a reopened disk-backed store and verifies saved history without sign-in. It also checks signature tampering, origin/staff-scope mismatch, expiry, tenant switch, sign-out and batch withdrawal. This verifies model-level cold restoration, not a full app termination/relaunch or revocation against a deployed server. Add expiry-deletion and key rotation/trust-bootstrap tests; verify the protected signing secret is installed before enabling the archive endpoint in a cloud environment. The 24-hour grant is the maximum revocation delay while a device remains offline.
2. **Large-history sync is not resumable.** The API has batch `after` cursors and a revision; the iOS client still rejects more than 100 batches or 1,000 jobs, buffers the full history before replacing rows, and does not persist page progress. OpenSpec 6.5/6.6 still requires bounded resumable pages and deletion/tombstone reconciliation. A withdrawn batch currently clears the cached archive for that scope.
3. **Neon archival and retention are not wired end to end.** The active API reads archive files, and no Neon export, immutable IBM Object Storage copy, checksum/restore evidence, or hold-aware purge was verified. Keep automatic purge disabled until an independent server archive and restore path is proven. SwiftData must remain a bounded local read cache, not the only surviving copy of records purged from Neon.
4. **Local data protection and storage bounds remain open.** The app has time-based eviction, but there is no explicit verified policy for SwiftData file protection, device backup exclusion, maximum cache rows/bytes, or cleanup after database/backup restore. Define these before storing plates long term. The grant and cached rows are local data and need the same protection policy.
5. **Visual/accessibility acceptance remains partial.** The public catalog has a default-size dark-mode smoke capture. Signed-in screenshots/interactions are still needed on iPhone and iPad in portrait and landscape, with large Dynamic Type, VoiceOver focus around pinned headers, light/dark mode, Reduce Motion, and navigation return position. Configurable haptics in the parity spec are not implemented in active SwiftUI code.

## Implementation order

1. Complete signed-entitlement security/expiry tests and production key handling: verify a true app cold relaunch, history removal at expiry, key rotation/trust bootstrap, and behavior after sign-out, tenant/account switch, offline expiry and confirmed revocation. Keep signing keys in the protected server runtime only.
2. Replace the file-only archive index with a tenant-scoped Neon-backed archive source and an idempotent export to private IBM Object Storage. Add versioned manifests, counts and checksums; restore into an isolated database before considering any purge. Keep the proposed 90-day online job and 30-day online evidence windows as planning assumptions pending policy approval; IBM Archive objects have a 90-day minimum retention before deletion.
3. Add bounded page-level persistence and resume using stable archive revisions/cursors and deletion markers. Remove the 100-batch/1,000-job caps without loading the full archive into memory. Preserve the current fail-closed behavior for withdrawn records while defining selective tombstone removal.
4. Set the local SwiftData protection, backup and size policies; implement and test backup/restore cleanup and expiry deletion. Do not cache photo bytes in this archive; keep verified evidence references only.
5. Complete signed-in visual/accessibility acceptance on phone and tablet, then implement configurable haptics. Fix any clipping, insufficient contrast, focus obstruction, or scroll restoration issues found. Capture evidence for both themes and Reduce Motion.
6. Re-run `make ios-build` and `make ios-test`; keep OpenSpec task 6.6 open until cursor resume, tombstones, entitlement expiry/revocation, tenant switching and cold restore meet its full acceptance criteria.

## Verification evidence

The latest available simulator result is `Test-SparkleWash-2026.11.05_11-12-47--0600.xcresult`: **8 passed, 0 failed** on iPhone 17 Pro / iOS 27.0. `make ios-test` builds and runs the simulator target. The passing tests include the offline grant scope/tamper/expiry checks, disk-backed archive sync and migration, withdrawal, local expiry cleanup, and shared-contract tests. This is automated model/build evidence; it is not signed-in visual acceptance, an actual device test, a cloud key-configuration test, or proof of Neon export/restore.

## UI UX Pro Max review

UI UX Pro Max guidance was applied for contrast, accessible labels, Dynamic Type, semantic SwiftUI views and Reduce Motion. The current source follows those patterns in several components. The public screenshot predates the latest contrast edit, so the contrast improvement still needs visual measurement in both appearances. The focused search did not provide a pinned-header/VoiceOver-focus or archive-retention match; those findings above come from current source, tests and OpenSpec rather than an asserted skill result.

## Apple platform references

Apple's current guidance supports grouping content in `Section` inside a lazy stack and pinning headers with `pinnedViews`. WWDC26 explains lazy-stack size estimation, prefetching and scroll-position implications; preserve visible anchors and avoid offset assumptions as content changes. `ModelContext` manages model lifecycle and persistence; explicit saves are appropriate where the app replaces a downloaded archive snapshot.

- [Grouping data with lazy stack views](https://developer.apple.com/documentation/swiftui/grouping-data-with-lazy-stack-views)
- [Dive into lazy stacks and scrolling with SwiftUI — WWDC26](https://developer.apple.com/videos/play/wwdc2026/321/)
- [PinnedScrollableViews](https://developer.apple.com/documentation/swiftui/pinnedscrollableviews)
- [SwiftUI navigationTransition](https://developer.apple.com/documentation/swiftui/navigationtransition)
- [SwiftUI Reduce Motion environment](https://developer.apple.com/documentation/swiftui/environmentvalues/accessibilityreducemotion)
- [SwiftData ModelContext](https://developer.apple.com/documentation/swiftdata/modelcontext)
- [Preserving SwiftData models across launches](https://developer.apple.com/documentation/swiftdata/preserving-your-apps-model-data-across-launches)
- [Apple file protection levels](https://developer.apple.com/documentation/Foundation/FileProtectionType/complete)
