# Design: Device Sync v2 — Desktop client

## Context

Desktop is Electron+React+RTK, fully local-first (redux-persist over `app-storage.json`). Sync v1 is
a fire-and-forget push middleware. The server (Invoices.Api change `add-device-sync-v2`) provides a
SignalR hub (`/hubs/sync`, internal JWT via `access_token`), a bounded in-memory change log per company,
a REST fallback (`/api/v2/sync/*`), manifests, epoch resets and correlativo maxima. Desktop is a
pilot platform with Android; iOS follows later. Protocol details are normative in
`App.ReactNative/docs/SYNC_V2_REDIS_SIGNALR_STRATEGY.md` §5–§8.

## Goals / Non-Goals

**Goals:**
- Same-owner cross-device sync with <5 s convergence while both devices are online, and correct
  catch-up after offline periods.
- Zero data loss locally: the outbox survives crashes/updates and is only cleared on server ack.
- DTE invariants hold locally no matter what arrives from the log.
- Paid-tier enforcement (Pro/Business) with a clean Lite upgrade path.
- Keep all 61 existing Playwright specs and 27 Jest files green.

**Non-Goals:**
- Server work (owned by Invoices.Api change), iOS, company sharing, migrating compras out of
  `ComprasDatabase`'s storage model, real-time push for chat (`ChatService` untouched).

## Decisions

### D1 — deviceId: random UUID in appStorage, minted once
`deviceIdService.ts` reads-or-creates `sync_device_id` in `appStorage` (Electron `userData`, survives
updates; NOT `identifierForVendor`-style hardware ids). Stable across restarts; per-install.

### D2 — Outbox: persisted JSON, append-on-local-write, clear-on-ack
Key `sync_outbox_{companyId}` in appStorage. Envelope per entry: `{t, id, op, u, payload}` where
`op: 'upsert' | 'delete'` (deletes are tombstones), `u` = ISO `updatedAt` stamped at write time.
Appends happen in a new outbox middleware subscribed to the SAME fulfilled actions as today's
`syncMiddleware` plus explicit compras actions and invoice deletes (which v1 never synced). Ordering
guarantee: append in Redux dispatch order; the outbox is the ONLY push source (replaces
`syncMiddleware`'s direct POSTs, which are removed after the cutover task). Clearing: entries are
removed only after `Push` ack (`lastId` ≥ their stream id) or REST 200. Outbox grows unbounded
offline? Cap display warning at 5,000 entries; real bound is server retention (30-day catch-up
window covers realistic offline periods).

### D3 — SignalR client: `@microsoft/signalr` with automatic reconnect
`syncV2Service.ts` (singleton) builds `HubConnectionBuilder().withUrl(hubUrl, { accessTokenFactory })
.withAutomaticReconnect([0, 2000, 5000, 10000, 30000])`. Hub URL: `${API_CONFIG.baseUrl}/hubs/sync`;
JWT from `AuthProviderService.getToken()` (already persisted as `app_auth_token`). Connection
lifecycle owned by the app (start on launch + on auth/company switch; stop on logout). Server
events handled: `ChangesAvailable` → enqueue pull; `PeersChanged` → update panel; `EpochReset` → D6;
`DigestRequested` → D7.

### D4 — Sync loop (the device protocol)
1. On connect: `Register(co, manifest)` → `{epoch, head, peers}`; store epoch + cursor in
   `syncSlice` (persisted).
2. Flush: `Push(co, outbox.slice(0, 500))` until acked (server returns `lastId` + `rejected[]`;
   rejected entries are logged, never retried blindly).
3. Pull: `Pull(co, cursor, 500)` until drained; apply each entry through the merge engine; commit
   cursor only after a successful apply batch.
4. `ReportManifest(co, manifest)` with fresh counts.
5. While connected: debounce outbox flush 2 s; on `ChangesAvailable`, pull.
6. While disconnected: opportunistic REST push of the outbox (same envelopes) to
   `POST /api/v2/sync/{co}/push`; on failure keep entries (retry next window/foreground).

### D5 — Merge engine: pure, deterministic, tested exhaustively
`mergeEngine.ts` exports `applyChange(local, change) → {entity, applied, conflict}`:
- LWW by `(updatedAt, deviceId)` — deviceId breaks ties deterministically (both devices converge).
- DTE status lattice `Nueva < Sincronizando < Completada < Anulada`: lower never overwrites higher.
- Write-once: `generationCode`, `controlNumber`, `receptionSeal`, `fechaTransmision` — first
  non-empty wins; a later DIFFERENT value is surfaced as a conflict (logged + panel badge), not applied.
- `Completada`/`Anulada` docs: items/totals immutable.
- Tombstones beat older upserts; a local edit newer than the tombstone resurrects (LWW on `u`).
- Compras dedupe by `codigoGeneracion` then `numeroControl` (matches import dedupe).
- Customers/products: plain LWW.
The engine has NO I/O — slices apply returned entities through normal RTK reducers so persist,
selectors and UI all stay consistent.

### D6 — Epoch reset: staggered full snapshot
On `EpochReset(co, epoch)`: drop cursor, set new epoch, wait `random(0–30 s)`, then push a full
snapshot (all entities as upserts through the outbox in batches of 500) and re-`Register`. Receivers
apply merge rules — converges because every device holds a full copy.

### D7 — Digest reconcile for count mismatches
If manifests share `(epoch, lastSeenId)` but counts differ for a type: `RequestDigest(co, type)` →
each peer answers `Digest(count, sha256(sorted id:updatedAt))`. On mismatch, exchange
`id:updatedAt` lists for that type and push missing/newer entries. If no peer is online, mark the
type "Pendiente de verificar" in the panel and retry on next `PeersChanged`.

### D8 — Correlativo seeding
After every completed sync: for each DTE type, `next = max(localNext, serverMax + 1)`. Wired into
invoice creation (same seam the derived-note/`SyncLocal` re-mint uses). Phase-2 option (leases via
server) is NOT implemented here.

### D9 — Gating & startup: the Pro+Sync tier
`canUseDeviceSync(selectCurrentTier())` (new gate: tier `proSync` or `enterprise` — canonical values
`free|pro|pro_sync|enterprise`; plain Pro buys ad-free only, NOT sync) + valid app JWT decide whether
`syncV2Service` starts at all. The tier may originate from an in-app N1CO purchase or the
centralized web flow (landing page); entitlement refresh on app start/login updates it. Free/plain
Pro: Settings shows the panel in a locked state with the standard upgrade prompt and zero network
traffic.

### D10 — Retirement of v1 push
After v2 pilot is stable (server decommission phase), delete `syncMiddleware`'s direct v1 POSTs and
`cloudSyncService.ts`; until then v1 stays dormant (flag) so rollback is trivial.

## Risks / Trade-offs

- **`updatedAt` inconsistency in slices** (customers/companies stamp it, some paths forget): the
  outbox middleware stamps `u` authoritatively at capture time, decoupling correctness from slice
  discipline. Sweep task normalizes slices anyway.
- **appStorage is a single JSON file**: outbox + sync state add write volume to
  `app-storage.json`. Mitigation: batch outbox writes (debounced 500 ms), atomic IPC writes already
  in `main.cjs`. If it becomes a hotspot, move the outbox to a separate file (storage seam already
  isolates keys).
- **Reconnect storms** after server epoch resets: the 0–30 s stagger is mandatory; tests assert it.
- **SignalR over Electron**: renderer WebSocket through the standard Chromium stack; no Electron
  net-binding needed. The chat `getSignalRAccessToken` precedent stays untouched.
- **Clock skew across devices** affects LWW: mitigated by `(updatedAt, deviceId)` determinism and by
  write-once MH ids; conflicts are surfaced, not silently resolved the wrong way.

## Implementation decisions (2026-09-24/25, Desktop build)

The Desktop client runs the SAME engine as Android (`src/services/sync/syncV2Service.ts` is
byte-identical to App.ReactNative's apart from one import path) and the same pure modules
(`protocol`, `sha256`, `payloadCodec`, `mergeEngine`, `digestService`); the merge conformance
fixture `src/__tests__/sync/fixtures/merge-conformance.json` is a byte-identical copy. The
cross-platform decisions (outbox refs, capture seam, version-map tombstones, `co{NIT}` /
`co{NIT}test` keys, company-relative payloads, acknowledged-dominance merge, cursor = last
applied id, correlativo rules) are recorded in App.ReactNative
`openspec/changes/add-device-sync-v2/design.md` §I1–I10. Desktop-specific:

- **E1 — Capture allowlist** adds `addInvoices`, `markAsContingency`,
  `applyInvoiceStockDeduction`; deliberately excludes `delete*ByCompany` (deleting a company on
  one device must never tombstone its data on the owner's other devices). Product reducers now
  stamp `updatedAt` (incl. stock deduction). Compras capture via `ComprasDatabase.setChangeListener`
  (emits on insert/update/link/delete; `upsertFromSync`/`deleteFromSync` never emit); an update
  arriving with a stale `updatedAt` is re-stamped.
- **E2 — Hub transport skips negotiate** (`skipNegotiation` + WebSockets): browsers apply CORS to
  fetch but not WebSockets, so the Electron `app://` renderer and the web build reach the hub
  without relay CORS; the upgrade request still wakes the scale-to-zero container. REST fallback
  and `GET status` still need relay CORS (server review item).
- **E3 — Sequential numeroControl seeding.** Desktop's default numeroControl sequence is
  time-derived (never collides); with `useSequentialControlNumbers` the submission modal takes
  `max(nextSequenceNumber, relayFloor[docType] + 1)` and `seedSequenceFloor` moves the counter
  past it. Time-derived sequences (≥ 1e9) are excluded from the manifest maxima on both platforms;
  `nextSequenceNumber` is device-local (never synced — a peer's LWW company edit can't rewind it).
- **E4 — Numeric enums are platform-local.** Desktop `InvoiceType` event values are 17/18 (RN
  11/12); incoming invoices re-derive `invoiceType`/`relatedInvoiceType` from the MH
  `documentType` code. Desktop's `InvoiceStatus.Contingencia` (6) is a pre-acknowledgement state
  for the lattice.
- **E5 — Tiers.** `SubscriptionTier` gains `pro_sync`/`enterprise`; `isPaidTier` covers every paid
  tier; `canUseDeviceSync` = Pro+Sync/Enterprise only.
- **E6 — Lifecycle.** `useSyncV2Lifecycle` (App shell): opt-in auto-connect, company switch moves the
  session, entitlement loss or logout closes it, `beforeunload` makes one best-effort REST flush.
- **E7 — Tests.** Jest `src/__tests__/sync/*` (conformance, primitives, capture, two-device engine
  suite over an in-memory relay); Playwright `pro/11-device-sync.spec.ts` against a REAL local
  Invoices.SyncApi + Node SignalR peer; `pro/12-full-sync-desktop-android.spec.ts` phases A/C of the
  cross-client scenario orchestrated by App.ReactNative `scripts/e2e-full-sync.sh` with Detox
  `e2e/sync-v2-full.e2e.js` as phase B.
- **E8 — Reviewed relay contract (2026-09-25 API review).** Same engine and in-memory test relay as
  RN (App.ReactNative design I11): paging on `Pull.hasMore`, peer catch-up on `truncated`,
  `PeersChanged` carrying the online list (newcomer included, drops a disconnected device at once),
  caller-only `EpochReset` on a stale Register (ignored once the epoch is adopted), digest answers
  routed to the requester, and `rate_limited` retried with 1/2/4/8/8 s back-off (REST 429 maps to
  it). The relay now serves CORS for `app://dist` + configured origins (`Sync:AllowedOrigins`), so the
  REST fallback and `GET status` work from the Electron renderer (closes the E2 server item).
