# sync-peer — headless Desktop device peer

The App.Desktop **sync stack with no UI**: the real `SyncV2Engine`
(`src/services/sync/syncV2Service.ts` — the byte-identical copy shared with the RN app),
the real capture middleware, the real Redux slices and entity adapters, wired to a real
SignalR connection. Scenario steps dispatch the same actions the Desktop UI dispatches
(`applyInvoiceStockDeduction`, `updateProduct`, …), so a "Desktop sale" here exercises
exactly the production code path — deduction, capture, LWW merge, wire codec, session
loop, digest — only the rendering is absent.

Use it where booting the full Electron app is not the point: CI, containers, and the
centralized cross-device matrix (relay + emulator + peer in one test cell).

## What it proves (built-in scenario)

1. Seeds the Pruebas company (NIT 06141404941342 → group `co06141404941342test`) and
   `Adaptador USB-C` (40 units, threshold 8).
2. Opens a sync session → pushes the snapshot (company + product).
3. Completes a "sale" of 38 units via the real
   `products/applyInvoiceStockDeduction` action → stock 2, captured into the outbox,
   flushed through the live session.
4. Keeps the session open for `SYNC_PEER_WAIT_MS` — incoming changes (e.g. the phone's
   "Ajustar Stock") apply live; every state change is logged.
5. Dumps final state as JSON and optionally asserts
   `SYNC_PEER_EXPECT_STOCK` for `uitest-product-001`.

## Run

```bash
# Local, no relay — verifies the store + deduction + capture plumbing headless:
npx tsx tools/sync-peer/sync-peer.ts --selftest

# Against a local relay (e.g. dotnet run Invoices.SyncApi on :5098):
SYNC_PEER_URL=http://127.0.0.1:5098 npx tsx tools/sync-peer/sync-peer.ts

# Containers — relay + peer (see docker-compose.yml). The relay Dockerfile's COPY paths
# are repo-root-relative, so its build context is the Invoices.Api REPO ROOT:
#   docker build -t fs-sync-relay:local \
#     -f "<path to Invoices.Api>/Invoices.SyncApi/Dockerfile" "<path to Invoices.Api>"
docker compose -f tools/sync-peer/docker-compose.yml up --build
```

### Environment

| Variable | Default | Meaning |
|---|---|---|
| `SYNC_PEER_URL` | — | Relay origin (required unless `--selftest`) |
| `SYNC_PEER_TOKEN` | minted | Internal JWT; minted from the signing key when absent |
| `SYNC_PEER_SIGNING_KEY` | `detox-sync-signing-key-…` | HS256 key shared with the relay (test default) |
| `SYNC_PEER_COMPANIES` | `co06141404941342test` | Company keys in the token |
| `SYNC_PEER_TIER` | `pro_sync` | Token tier |
| `SYNC_PEER_NIT` | `06141404941342` | NIT of the seeded company |
| `SYNC_PEER_WAIT_MS` | `20000` | Live wait window for incoming changes |
| `SYNC_PEER_EXPECT_STOCK` | — | Final-stock assertion for `uitest-product-001` |
| `SYNC_PEER_DEVICE_ID` | persisted | Stable device identity (tmp file per host) |

## Centralized cross-device testing

The full matrix ("product stock visible from the phone") runs three real things at once:

| Piece | How | Where |
|---|---|---|
| Relay | `Invoices.SyncApi` container (`fs-sync-relay:local`) | docker compose, port 5099 |
| Desktop peer | this harness (`fs-sync-peer:local`) | docker compose |
| Android phone | Detox `e2e/sync-v2-stock.e2e.js` on the emulator | host (`SYNC_E2E_EXTERNAL=1 SYNC_E2E_PORT=5099`) |

Verified recipe (2026-09-26, dev Mac):

```bash
# 1. Relay image (context = Invoices.Api repo root, see the note above).
docker build -t fs-sync-relay:local -f "<Invoices.Api>/Invoices.SyncApi/Dockerfile" "<Invoices.Api>"

# 2. Cell up: peer registers, pushes its snapshot + sale, then waits for the phone.
cd App.Desktop
SYNC_PEER_WAIT_MS=240000 SYNC_PEER_EXPECT_STOCK=7 \
  docker compose -f tools/sync-peer/docker-compose.yml up -d --build

# 3. Phone joins the shared relay through the published port.
cd ../App.ReactNative/FacturasSimplesRN
SYNC_E2E_EXTERNAL=1 SYNC_E2E_PORT=5099 \
  SYNC_E2E_SIGNING_KEY=detox-sync-signing-key-0123456789abcdef \
  npm run test:detox:android -- e2e/sync-v2-stock.e2e.js

# 4. Peer converges on the phone's adjustment and exits:
#    [sync-peer] assertion OK: uitest-product-001 stock === 7   (exit 0)
docker compose -f ../../App.Desktop/tools/sync-peer/docker-compose.yml logs desktop-peer
```

When the full Electron app *is* the point, use the existing Playwright cross-client run
instead: `App.ReactNative/FacturasSimplesRN/scripts/e2e-full-sync.sh` (phases A/B/C
through one relay). This harness covers the always-on, container-friendly middle ground.

## Notes

- `src/config/viteEnv.ts` returns an empty env under bare Node (`import.meta.env` is
  undefined there) so the sync modules load outside Vite — a no-op in the browser.
- Desktop `updateProduct` **replaces** the whole entity (no partial merge): always
  dispatch it with the full product, or the capture seam drops the write (no
  `companyId` → no company group). The harness uses `applyInvoiceStockDeduction`,
  which mutates in place and keeps the mapping.
