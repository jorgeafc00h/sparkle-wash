# Tasks: add-device-sync-v2 (App.Desktop)

Test gates: `npm test` (Jest), `npm run test:e2e` (Playwright web), `npm run test:e2e:electron` (packaged app),
`npx tsc --noEmit`, `openspec validate add-device-sync-v2 --strict`.

## 1. Foundations

- [x] 1.1 Add `@microsoft/signalr` to `package.json`; hub URL + `syncV2` flags in `src/config/api.ts`.
- [x] 1.2 `src/services/sync/deviceIdService.ts` — read-or-create `sync_device_id` UUID in appStorage + `{platform:'desktop', appVersion}`. Jest: idempotent across calls, stable across "restart" (mocked storage).
- [x] 1.3 Normalize `updatedAt` stamping + add `deletedAt` tombstone support in `invoiceSlice`, `customerSlice`, `productSlice`, `companySlice` reducers (create/update/delete). Jest per slice: timestamps stamped, delete sets `deletedAt` instead of hard remove.
  - As built: tombstones in the sync version map (RN design I3) instead of `deletedAt` entity fields; product reducers stamp `updatedAt`.
- [x] 1.4 `src/services/sync/outbox.ts` — `appendOutbox(co, entry)`, `ackUntil(co, lastId)`, debounced persistence to appStorage key `sync_outbox_{co}`; envelopes `{t,id,op,u,payload}`. Jest: append order, tombstone capture, ack trims, survives storage reload, debounced write batching.
  - As built: outbox = references in the persisted `syncV2` slice (RN design I1), payloads materialized at flush.

## 2. Merge engine (pure, exhaustive unit tests)

- [x] 2.1 `src/services/sync/mergeEngine.ts` — `applyChange(local, change)` per design D5 (LWW `(updatedAt, deviceId)`, status lattice, write-once MH ids, immutable completed/anulled items+totals, tombstones, compra dedupe by `codigoGeneracion`→`numeroControl`, plain LWW for customers/products).
- [x] 2.2 Jest `mergeEngine.test.ts` — at minimum: LWW newer wins; exact tie broken by deviceId deterministically (both orders converge); lattice `Nueva<Sincronizando<Completada<Anulada` never regresses; write-once id conflict surfaces `conflict` instead of applying; newer upsert after tombstone resurrects; older upsert after tombstone ignored; compra duplicate dropped; completed-doc item change rejected; digest input ordering stable.
- [x] 2.3 `src/services/sync/digestService.ts` — per-type `count` + SHA-256 over sorted `id:updatedAt`; compare + diff-list helpers. Jest: known-vector digests, mismatch detection, missing-id diff.

## 3. Sync service (protocol loop)

- [x] 3.1 `src/services/sync/syncV2Service.ts` — SignalR connection (`withUrl(hub, {accessTokenFactory})`, `withAutomaticReconnect`), loop `Register → flush outbox (Push ≤500 batches) → Pull(cursor,500) → apply via mergeEngine → ReportManifest`; handles `ChangesAvailable`, `PeersChanged`, `EpochReset`, `DigestRequested`. Start/stop on app launch, auth change, company switch (wired from `syncV2Slice`).
  - Engine shared verbatim with App.ReactNative; hub connection uses skipNegotiation WebSockets (design E2).
- [x] 3.2 REST fallback: push outbox via `POST /api/v2/sync/{co}/push` when socket down (reuse axios client + app JWT headers pattern from `CloudSyncService.getHeaders()`); entries cleared only on ack. Jest with axios mocked: fallback fires only when disconnected, retries keep entries.
- [x] 3.3 Epoch reset handler: drop cursor, adopt new epoch, `setTimeout(random 0–30 s)` stagger, full-snapshot push through outbox in 500-batches. Jest: stagger range enforced, cursor dropped, snapshot batches correct.
- [x] 3.4 Digest reconcile flow on manifest count mismatch (request/respond/exchange/push missing; "Pendiente de verificar" state when no peer online). Jest with mocked hub.
  - Shared engine: RequestDigest → DigestRequested → Digest → DigestAvailable → push/QueryPeers; cursors kept aligned by pulling after live pushes; "Pendiente de verificar" clears once the repair converges (Jest two-device suite). Relay-side hub methods are an Invoices.Api review item.
- [x] 3.5 `src/store/slices/syncV2Slice.ts` — `{epoch, cursor, peers, devices manifests, outboxCount, status, conflicts, pendingVerify}`; persisted whitelist entries in `src/store/persistence.ts`. Jest: reducers + persistence whitelist.
- [x] 3.6 Outbox middleware replacing `syncMiddleware` push path (v1 direct POSTs behind a dormant flag until decommission task 5.3): on each create/update/delete fulfilled action → stamp + append outbox + trigger debounced flush. Jest: every of the 5 entity types and deletes captured; Lite tier captures nothing.
  - Capture middleware + ComprasDatabase listener (design E1); v1 `syncMiddleware` untouched until the decommission task.

## 4. Gating + UI

- [x] 4.1 Tier model: add `proSync` to `SubscriptionTier` + `subscriptionConfig` (canonical `free|pro|pro_sync|enterprise`) with N1CO product id (e.g. `n1co.facturassimples.prosync.monthly`) and legacy display-name mapping; add `canUseDeviceSync(tier)` gate (`proSync`/`enterprise`). Gate sync startup on it + app JWT; Free/plain-Pro = no connection, locked panel + upgrade prompt to Pro+Sync; entitlement refresh reflects centralized web purchases. Jest for the gate logic (free → off, pro → off, proSync → on, enterprise → on).
- [x] 4.2 `SincronizacionPanel` (Settings, sibling of `SyncLogsPage`): per-device rows (platform icon, appVersion, last sync, counts), online state, outbox pending count, conflict badge, "Pendiente de verificar" chips. Unit-render Jest (node env: logic-only helpers tested; render assertions via Playwright below).
- [x] 4.3 Settings navigation entry + route. Playwright: panel visible for seeded Pro user, locked state for Lite (pattern: `playwright/fixtures/pro-state.ts`).
- [x] 4.4 Correlativo seeding after sync: `max(local, serverMax) + 1` wired into invoice creation seam. Jest: seeding math, no regression when server max lower.

## 5. Integration & E2E (Playwright, hub mocked via route interception of `negotiate`/WebSocket frames — extend `playwright/tests/pro/04-cloud-sync.spec.ts` patterns)

- [x] 5.1 `sync-relay.spec.ts`: seeded Pro desktop with a mocked peer manifest → create customer/product/invoice/compra → assert outbox envelopes pushed (route assertions) and panel counts update.
  - Implemented against a REAL local relay + Node peer (`pro/11-device-sync.spec.ts`) instead of route-mocked frames.
- [x] 5.2 `sync-catchup.spec.ts`: server returns queued `ChangesAvailable` + `Pull` entries on connect → apply → UI shows peer-created entities; cursor persisted across reload.
  - Covered by `pro/11-device-sync.spec.ts` (phone→Desktop arrival on Sincronizar) and the full scenario `pro/12-full-sync-desktop-android.spec.ts` phase C.
- [x] 5.3 `sync-offline.spec.ts`: abort routes (offline) → make edits → reconnect → outbox flushes, entries acked; LWW + lattice applied on conflicting peer edits.
  - Tombstone + forbidden/error paths in `pro/11`; offline/reconnect + epoch recovery covered by the shared engine suite and Detox (`e2e/sync-v2.e2e.js`).
- [x] 5.4 `sync-epoch.spec.ts`: mock `EpochReset` → staggered snapshot pushed, cursor reset, counts converge.
  - Real relay restart (not a mocked frame) in `pro/11-device-sync.spec.ts`: Sincronizar after a cold start re-seeds under the new epoch.
- [x] 5.5 `sync-gating.spec.ts`: Free AND plain-Pro users → no negotiate call, locked panel with Pro+Sync upsell; Pro+Sync (in-app purchase or seeded centralized entitlement) unlocks sync (extends `09-feature-unlock-post-purchase.spec.ts`).
  - 2026-09-26 (paid-feature review, from the RN session): `playwright/tests/pro/11-device-sync.spec.ts` gating now covers
    Sin Publicidad (`adfree`) too, and a relay refusal — a Pro+Sync app holding a plain-Pro account token gets "…requiere
    Pro+Sync" and the shared relay's Desktop rows / the phone's received changes are unchanged. 8/8 passed. The shared engine's
    two `any`s were typed in RN and copied here (`HubConnectionLike.on` generic, `as SyncEntity`); lint + sync Jest (91) green.
- [x] 5.6 Electron smoke (`playwright/tests/electron/`): launch packaged app with local flag → deviceId created in `app-storage.json`, outbox file appears after an edit.
  - `playwright/tests/electron/07-device-sync-smoke.spec.ts` (real Electron shell + local relay): deviceId + `persist:syncV2` epoch land in userData/app-storage.json.
- [x] 5.7 Manual/integration against local stack: `dotnet run --project Invoices.SyncApi` (+ the API for auth) with Desktop pointed at localhost — real register/push/pull with the Android emulator as the second device (pilot matrix scenario 1 in strategy §14).
  - Automated as App.ReactNative `FacturasSimplesRN/scripts/e2e-full-sync.sh`: real Desktop (Playwright phases A/C) + real Android app (Detox phase B) through one local relay — green 2026-09-25.

## 6. Cutover & hygiene

- [ ] 6.1 Delete dormant v1 push flag + `CloudSyncService` + its v1 tests after server decommission (Phase 5); update `cloudSyncService.test.ts` → removed or replaced by outbox tests.
- [ ] 6.2 Full gates green: `npm test`, `npm run test:e2e`, `npm run test:e2e:electron`, `npx tsc --noEmit`.
- [x] 6.3 Docs: CLAUDE.md sync section updated; strategy doc cross-link.
