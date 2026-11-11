# Project: App.Desktop (Facturas Simples Desktop)

Electron + Vite + React 19 + Redux Toolkit desktop client for Facturas Simples (El Salvador DTE
invoicing). Pilot platform for Device Sync v2 (together with the Android RN app).

## Language & Stack

- TypeScript, React 19, Redux Toolkit + redux-persist (persisted via `electronPersistStorage` →
  `userData/app-storage.json`, see `electron/main.cjs` IPC bridge + `src/services/storage/ElectronStorage.ts`;
  secrets in `userData/secrets.json` via safeStorage).
- Electron main process `electron/main.cjs`; HTTP via axios; **no websocket client yet**
  (`@microsoft/signalr` NOT installed — a SignalR URL builder exists for chat only,
  `src/services/chat/ChatService.ts`).
- Sync today: `src/services/sync/CloudSyncService.ts` — **push-only** v1 backup
  (`POST /sync/invoice|customer|company/{tableName}`, `POST /sync/batch/{tableName}`,
  `GET /sync/status`), table = `co{sanitized NIT}`. Triggered by
  `src/store/middleware/syncMiddleware.ts` on 8 Redux fulfilled actions, gated on
  `canUseAzureSync(tier)` + app JWT. No pull, no deviceId, no tombstones, `updatedAt` stamped
  inconsistently across slices, `invoiceSlice.pendingSync` queue unused by the middleware.
- Compras live OUTSIDE Redux: `src/services/compras/ComprasDatabase.ts` (appStorage key
  `compras_db_{companyId}`); `ComprasSyncManager.ts` is email-import sync, unrelated.
- Backend base URL: `src/config/api.ts` (`https://k-invoices-api-prod...azurecontainerapps.io/api`).

## Subscription / tier gating (paid feature seam)

- `SubscriptionTier` in `src/services/subscription/SubscriptionTypes.ts` (`lite|adfree|pro`).
- **`canUseAzureSync(tier)` in `src/services/subscription/FeatureGate.ts` → `tier === 'pro' || tier === 'adfree'`**
  (display names: Free / Pro $7 / Business $14).
- `useSubscription.ts` (`canAccessFeature('azureSync')`), `subscriptionSlice` (N1CO purchase flow),
  `selectCurrentTier` (`src/store/selectors/subscriptionSelectors.ts`) — this is what the sync
  middleware consults.

## Commands & tests

```bash
npm test                                   # Jest (ts-jest, node env) — src/__tests__/**/*.test.ts
npx jest src/__tests__/cloudSyncService.test.ts
npm run test:e2e                           # Playwright vs Vite dev server (61 specs)
npm run test:e2e:electron                  # Playwright _electron.launch (8 specs, packaged app)
```

Sync-relevant test precedent: `src/__tests__/cloudSyncService.test.ts` (unit, mocks axios) and
`playwright/tests/pro/04-cloud-sync.spec.ts` (route-intercepts `/api/sync/`, seeds Pro/Lite state via
`playwright/fixtures/pro-state.ts`).

## Constraints (non-negotiable)

1. Device sync v2 belongs to the **Pro+Sync** tier (canonical `free|pro|pro_sync|enterprise`;
   plain Pro is ad-free only — NO sync) — gate everything behind `canUseDeviceSync` + app JWT;
   Free/plain-Pro users see the upgrade prompt, never sync traffic. Nothing is stored in Azure
   Storage or SQL in the sync path.
2. Local-first: the app must stay fully usable offline; sync failures never block or lose local edits.
3. DTE invariants (MH): status lattice `Nueva < Sincronizando < Completada < Anulada` never regresses;
   `generationCode`/`controlNumber`/`receptionSeal`/`fechaTransmision` are write-once. Live-MH rules:
   `App.ReactNative/.specify/memory/constitution.md`.
4. Backend contract is defined server-side in
   `Invoices.Api/openspec/changes/add-device-sync-v2/` (hub `/hubs/sync`, REST `/api/v2/sync/*`,
   strategy: `App.ReactNative/docs/SYNC_V2_REDIS_SIGNALR_STRATEGY.md`).
5. No "Join Company" flows. Same-owner multi-device only.

## Spec workflow

OpenSpec (`openspec/`). Validate: `openspec validate --all --strict`. Active changes:
`add-device-sync-v2`, `add-pos-tickets` (proposal stage — POS tickets, thermal ESC/POS printing,
stock discharge, ticket→DTE consolidation).
