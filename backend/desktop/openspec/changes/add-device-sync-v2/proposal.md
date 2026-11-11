# Add Device Sync v2 — Desktop client (Electron)

## Why

Cloud sync today is a push-only v1 backup into Azure Table Storage (`CloudSyncService`): the Desktop
never pulls, deletes don't propagate to other devices, there is no device identity, and a second
device (e.g. the user's Android phone running the RN app) never sees Desktop changes in real time.
Device sync across the owner's devices is the defining capability of the new **Pro+Sync** tier
(purchased via N1CO, in-app or through the centralized landing-page flow) — it is NOT part of Free
or plain Pro (ad-free), and nothing is stored in Azure Storage or SQL in the sync path. The server
side (SignalR hub `/hubs/sync` — in-memory relay — + REST fallback) is being added to
Invoices.Api (`Invoices.Api/openspec/changes/add-device-sync-v2/`). Desktop is a **pilot platform**
together with Android.

## What Changes

- **Device identity** — persistent `deviceId` (crypto UUID) stored once in appStorage
  (`userData/app-storage.json` via `ElectronStorage`), plus platform/appVersion metadata.
- **Outbox** — a persisted per-company outbox (`sync_outbox_{companyId}` in appStorage) capturing
  every local change for invoices, customers, products, compras and companies (upserts AND deletes as
  tombstones), written by a new outbox middleware alongside `syncMiddleware`.
- **Real-time client** — add `@microsoft/signalr`; new `SyncV2Service` connects to `/hubs/sync` with
  the internal app JWT (`AuthProviderService.getToken()` → `access_token`), reconnects with backoff,
  runs the loop: `Register` → flush outbox (`Push`) → `Pull` since cursor → apply → `ReportManifest`.
  Connection lives while the app is open (desktop has no background suspension).
- **Merge engine** — pure functions in `src/services/sync/mergeEngine.ts`: last-writer-wins on
  `(updatedAt, deviceId)`, DTE status lattice + write-once MH ids enforced locally, tombstones win,
  compras dedupe by `codigoGeneracion`→`numeroControl`, plain LWW for customers/products.
- **Correlativo seeding** — after each sync, next correlativo per DTE type =
  `max(local, server max) + 1`.
- **Reconcile** — handle `EpochReset` (drop cursor, staggered 0–30 s, full snapshot push) and count
  mismatches via `RequestDigest`/`Digest` exchange.
- **UI** — a *Sincronización* panel in Settings (`SyncLogsPage` sibling): per-device manifests
  (counts, last sync, online state), pending-outbox count, "Pendiente de verificar" for unresolved
  digests, and a **Pro+Sync** gate (locked panel + upgrade prompt for Free/plain-Pro).
- **Tier model** — extend `SubscriptionTier`/`subscriptionConfig` with the new `proSync` tier
  (canonical `free|pro|pro_sync|enterprise`) + N1CO product id (e.g.
  `n1co.facturassimples.prosync.monthly`); new gate `canUseDeviceSync(tier)` (Pro+Sync/Enterprise)
  — distinct from the legacy `canUseAzureSync` seam.
- **Offline fallback** — debounced (≈2 s) outbox flush while connected; opportunistic REST flush
  against `/api/v2/sync/{co}/push` when the socket is down; outbox never cleared until the server
  acks. v1 `CloudSyncService` push path is retired once v2 is stable (decommission phase).
- **Wiring** — `@microsoft/signalr` dependency; `SyncV2Service` started/stopped by a `syncSlice`
  lifecycle on app start and auth changes.

## Capabilities

### New Capabilities
- `device-sync`: Desktop as a sync v2 peer — device identity, persisted outbox, SignalR
  register/push/pull loop, local merge rules honoring DTE invariants, correlativo seeding, epoch
  reset/digest reconcile, per-device status UI, paid-tier gating, offline REST fallback.

### Modified Capabilities

(none — v1 cloud backup has no OpenSpec baseline in this repo; its retirement is covered by the
decommission tasks inside this change and the `cloud-sync-v1` delta in Invoices.Api.)

## Impact

- **New code**: `src/services/sync/{deviceIdService,outbox,syncV2Service,mergeEngine,digestService}.ts`,
  `src/store/slices/syncV2Slice.ts`, outbox middleware, `SincronizacionPanel` component,
  correlativo seeding hook into invoice creation.
- **Changed code**: `package.json` (+`@microsoft/signalr`), `syncMiddleware.ts` (delegating to
  outbox), invoice/customer/product/company slices (consistent `updatedAt` stamping + `deletedAt`
  tombstones), Settings navigation (panel entry), `src/config/api.ts` (hub URL).
- **Tests**: new Jest unit suites (merge engine, outbox, deviceId, gating, digest) and Playwright
  specs (hub-mocked relay flows, offline/reconnect, epoch reset, gating) mirroring
  `playwright/tests/pro/04-cloud-sync.spec.ts`; existing `cloudSyncService.test.ts` and 61 e2e specs
  must stay green.
- **Out of scope**: server implementation (Invoices.Api change), Android RN client (its own repo
  change), MH/DTE submission behavior, email import sync (`ComprasSyncManager`), Enterprise
  restore-from-backup client work (follows `Invoices.Api add-enterprise-tier`).
