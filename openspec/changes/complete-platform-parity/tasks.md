## 1. Verified foundation (completed before job pivot)
- [x] 1.1 Resolve upload/reset/aggregate contract conflicts and publish versioned shared fixtures.
- [x] 1.2 Add station ingestion and durable snapshots. Retain as a compatibility/device foundation, not a job count.
- [x] 1.3 Add authenticated MQTT-to-WebSocket delivery and reconnect integration tests. Adapt topics for arrivals later.
- [x] 1.4 Store and retrieve bounded photos with retention and actual size enforcement. Link arrival provenance later.

## 2. Job and business domain
- [x] 2.1 Publish package catalog, exact four-class price matrix and shared fixtures from the supplied menu.
- [x] 2.2 Add durable plate observations, device retry deduplication, staff confirmation/correction and image provenance.
- [x] 2.3 Add durable job lifecycle, price snapshot, employee assignments, server-derived time and whole-carwash totals.
- [x] 2.4 Add employees and inventory stock ledger with idempotent receipts, adjustments, reservations and job consumption.
- [ ] 2.5 Finish Google staff roles and protect operational mutations; remove station reset from the primary workflow.
- [ ] 2.6 Reconcile N1CO orders to jobs and issue server-backed digital receipts. Signed webhook inbox exists.

## 3. Web job operations
- [x] 3.1 Replace mounted station dashboard with arrivals, suggestions, active/completed jobs and whole-carwash totals.
- [ ] 3.2 Add job detail, employee assignment, elapsed time, service checklist and material consumption flows.
- [ ] 3.3 Add employee and inventory management, stock alerts and movement audit views.
- [ ] 3.4 Add receipt/payment states, camera evidence, authenticated live updates and tested HTTP fallback.
- [ ] 3.5 Validate offline shell, browser accessibility and responsive layouts end to end.

## 4. SwiftUI parity
- [x] 4.1 Replace station dashboard with arrivals, suggestions, jobs and whole-carwash totals using shared DTOs.
- [ ] 4.2 Add job detail, staff assignment, service checklist, elapsed time and materials/inventory screens.
- [ ] 4.3 Add photo caching, receipt/payment states, authenticated streaming and reconnect behavior.
- [ ] 4.4 Add endpoint-scoped offline read cache, accessible haptics/preferences and reconciliation safeguards.
- [ ] 4.5 Validate phone/tablet layouts, VoiceOver, Dynamic Type, reduced motion and light/dark modes.

## 5. Edge and deployment
- [ ] 5.1 Confirm ESP32 board/camera/pins and implement bounded plate/image observation payloads.
- [ ] 5.2 Test real capture, OCR/provenance and retry behavior with physical hardware against the API.
- [ ] 5.3 Validate container/Compose/cloud deployment, operational health and secrets configuration.
- [ ] 5.4 Run end-to-end acceptance for each job workflow on web and SwiftUI; archive only with evidence.

## 6. Cloud persistence and retention
- [x] 6.1 Define tenant-scoped PostgreSQL migrations, runtime roles, immutable evidence references and production readiness checks.
- [x] 6.2 Implement transactional operational stores and restart-safe staff sessions. Verify concurrent writes, tenant isolation, and retry deduplication.
- [ ] 6.3 Build a read-only JSON import rehearsal with row counts, checksums, cutover and rollback evidence.
- [ ] 6.4 Export versioned archive batches, verify their checksums, and restore into an isolated database. Implement hold-aware purge behind an explicit policy switch.
- [ ] 6.5 Add authorized paged archive reads, version cursors and revocation or deletion markers. Validate cross-tenant denials.
- [ ] 6.6 Complete authorized offline history: persist archive jobs as tenant/account-scoped SwiftData records, add bounded resumable server cursors and tombstones, issue a signed short-lived offline entitlement for cold launch, and verify expiry, revocation, tenant switching, sign-out and restore. The existing 24-hour snapshot cache is a foundation only.
- [ ] 6.7 Validate HTTPS, image pulls, secrets, cold starts, persistent data and measured cost on the selected cloud.
