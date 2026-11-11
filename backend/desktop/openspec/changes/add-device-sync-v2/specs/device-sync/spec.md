# device-sync (Desktop client) — Delta

## ADDED Requirements

### Requirement: Persistent device identity
The Desktop app SHALL mint a random UUID `deviceId` on first sync use and persist it in
`app-storage.json` (Electron `userData`), reusing it across restarts and app updates for all sync
protocol calls.

#### Scenario: Identity is stable
- **WHEN** the app performs a sync, restarts, and syncs again
- **THEN** both syncs use the same `deviceId`

### Requirement: Pro+Sync tier gating of device sync
Device sync SHALL run only when the user's tier is **Pro+Sync** (or Enterprise) AND a valid internal
app JWT is present. Free and plain-Pro (ad-free only) users SHALL see the Sincronización panel in a
locked state with the upgrade prompt to Pro+Sync and the app SHALL make zero sync network calls for
them. The tier may be purchased in-app (N1CO) or via the centralized web purchase flow (landing
page) and is reflected in-app on entitlement refresh.

#### Scenario: Free user generates no sync traffic
- **WHEN** a Free-tier user edits invoices while device sync would otherwise trigger
- **THEN** no hub connection is opened and no `/api/v2/sync/` request is made, and the panel shows the upgrade prompt

#### Scenario: Plain Pro (ad-free) does not sync — upsell to Pro+Sync
- **WHEN** a plain Pro user opens the Sincronización panel
- **THEN** the panel is locked with an upgrade path to Pro+Sync (sync is not part of plain Pro)

#### Scenario: Pro+Sync user syncs
- **WHEN** a Pro+Sync user with a valid JWT opens the app
- **THEN** the sync service connects and begins the register/push/pull loop

### Requirement: Local changes captured as a durable outbox
Every local create, update AND delete of invoices, customers, products, compras and companies SHALL
be appended to a persisted per-company outbox as `{t, id, op, u, payload}` envelopes (deletes as
tombstones), and outbox entries SHALL be removed only after the server acknowledges them. Outbox
contents SHALL survive app crashes and restarts.

#### Scenario: Offline edits are never lost
- **WHEN** the user edits a customer and deletes an invoice while the network is down, then quits and relaunches
- **THEN** both envelopes are still in the outbox and are pushed on the next successful sync

### Requirement: Sync sessions relay changes in real time
Sync SHALL run as user-initiated sessions (the "Sincronizar" action in the Sincronización panel;
an ambient auto-connect option may exist but is off by default). Starting a session connects to
`/hubs/sync` — which may cold-start the server in seconds — then `Register`s with the manifest,
flushes the outbox via `Push` (batches ≤500), pulls on `ChangesAvailable`, and keeps the session
open for live relay while the user works (peer changes appear within 5 s; local-edit flushes
debounced ~2 s). A first connect after a server cold start SHALL transparently handle `EpochReset`
(drop cursor, staggered snapshot re-seed).

#### Scenario: Session cold start is transparent
- **WHEN** the user taps "Sincronizar" while the server is scaled to zero
- **THEN** the connection establishes within seconds, an epoch reset (if any) is handled
  automatically via snapshot re-seed, and the session proceeds

#### Scenario: Peer change appears live during a session
- **WHEN** the user's Android device pushes a new product while a Desktop sync session is open
- **THEN** the product appears in the Desktop UI without manual refresh

#### Scenario: Local edit relayed to peers
- **WHEN** the user edits an invoice during an open session
- **THEN** the change is pushed and connected peers receive it, with the outbox entry cleared after ack

### Requirement: Catch-up after offline or reconnect
On a sync session start (or reconnect/company switch), the app SHALL pull all log entries after its
persisted cursor in pages of ≤500, apply them, persist the new cursor only after a successful apply
batch, and then report a fresh manifest. If the server restarted since the last session (epoch
mismatch), the app SHALL perform the epoch-reset re-seed instead; outbox entries always persist
until acked, so nothing is lost between sessions.

#### Scenario: Day offline converges
- **WHEN** the app was closed for a day while the phone created 30 entities and both devices sync in an overlapping session
- **THEN** after the session all 30 entities exist locally with the peer's values where newer

### Requirement: Local merge honors DTE invariants
Incoming changes SHALL be applied with last-writer-wins on `(updatedAt, deviceId)`, with the DTE
status lattice `Nueva < Sincronizando < Completada < Anulada` never regressing, the MH write-once
fields (`generationCode`, `controlNumber`, `receptionSeal`, `fechaTransmision`) keeping their first
non-empty value (a conflicting later value surfaced as a conflict, not applied), items/totals of
`Completada`/`Anulada` documents immutable, tombstones overriding older upserts, and compras
deduplicated by `codigoGeneracion` then `numeroControl`.

#### Scenario: Status never regresses
- **WHEN** a peer delivers `Sincronizando` for an invoice that is locally `Completada` with an older `updatedAt`
- **THEN** the local invoice remains `Completada`

#### Scenario: Conflicting MH id surfaces as conflict
- **WHEN** a change carries a different `controlNumber` for an invoice that already has one
- **THEN** the merge is rejected, the existing value is kept, and the conflict is visible in the Sincronización panel

### Requirement: Correlativo seeding after sync
After each completed sync the app SHALL seed its next correlativo per DTE type as
`max(local next, server-reported max + 1)` so two devices of the same owner cannot mint the same
`numeroControl`.

#### Scenario: Devices split numbering without collision
- **WHEN** the server reports type 01 max correlativo 118 and the device's local next is 115
- **THEN** the device's next issued type 01 invoice uses correlativo ≥119

### Requirement: Epoch reset recovery
On `EpochReset(co, epoch)` the app SHALL drop its cursor, adopt the new epoch, wait a random 0–30 s
stagger, and push a full snapshot of its data through the outbox in ≤500-entry batches; received
snapshots SHALL go through the normal merge rules.

#### Scenario: Server state loss self-heals
- **WHEN** the hub broadcasts `EpochReset` to two online devices
- **THEN** both re-register with the new epoch and after both snapshots apply, both devices report equal counts

### Requirement: Count-mismatch digest reconcile
When a peer manifest shows different counts for an entity type at the same `(epoch, cursor)`, the
app SHALL run the digest exchange (`RequestDigest`/`Digest`: count + SHA-256 over sorted
`id:updatedAt`, then `id:updatedAt` list exchange) and push whatever is missing or newer; when no
peer is online the type SHALL be shown as "Pendiente de verificar" and retried on the next peer event.

#### Scenario: Divergent counts repaired
- **WHEN** both devices report the same cursor but customer counts 38 vs 37
- **THEN** the digest exchange identifies the missing customer and the device lacking it pulls/pushes it

### Requirement: Device status panel
Settings SHALL include a Sincronización panel listing each peer device's platform, appVersion, last
sync time, per-type counts, online state, the local pending-outbox count, and conflict/"Pendiente de
verificar" indicators.

#### Scenario: User inspects device status
- **WHEN** a Pro user opens Settings → Sincronización with an Android device also registered
- **THEN** both devices are listed with their counts and last-sync times

### Requirement: Offline REST fallback
When the hub connection is unavailable, the app SHALL opportunistically flush the outbox via
`POST /api/v2/sync/{co}/push` using the internal JWT, applying the same envelope limits, and SHALL
keep entries that fail so they retry later.

#### Scenario: Fallback push persists through failure
- **WHEN** the REST fallback push fails mid-way offline
- **THEN** unacked entries remain in the outbox and are retried on the next window
