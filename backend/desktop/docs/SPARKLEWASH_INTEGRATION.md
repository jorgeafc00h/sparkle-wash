# SparkleWash Desktop — integration contract

SparkleWash Desktop is a custom build of the Facturas Simples desktop app (Electron + Vite + React 19 +
Redux Toolkit), copied from `FACTURAS SIMPLES/App.Desktop` at release 1.4.6. It keeps every Facturas
Simples feature (DTE invoicing, customers, products/inventory, compras, POS tickets, cash drawer, closings,
consolidation, local users, device sync, printing) and adds the carwash workflow on top:

1. **Each car detailing is a work ticket ("orden de trabajo").** The cashier opens a walk-in service
   (plate, vehicle class, package, optional employee/customer). The desktop assigns a work-ticket number
   (`OT-{registerCode}-{seq:6}`, e.g. `OT-C1-000045`), prints it on the thermal printer and sends the job
   to the SparkleWash API.
2. **The API is the shared source of truth.** Jobs created on the desktop appear in the iOS app (it
   polls `/api/jobs` every ~9 s) and the web console (it listens to `/api/events`). Status changes made on
   iOS/web flow back to the desktop through `/api/events` (SSE) with polling as a fallback.
3. **Punto de venta charges the job.** In the POS register the cashier adds a carwash job to the cart
   (a quick line linked by `carwashJobId`). Completing the sale records a payment on the job
   (`POST /api/jobs/{id}/payments`) with the POS sale ticket number as reference, so iOS shows it as paid.
4. **Offline first.** Every write goes through a durable, ordered outbox with idempotency keys. A walk-in
   created offline gets a local id `local-<uuid>`, prints immediately, and is remapped to the server id
   when it syncs; queued operations that reference the local id are rewritten.

## API additions (backend/src/carwash-api)

All JSON is camelCase (`JsonSerializerDefaults.Web`). Staff routes need `Authorization: Bearer <session>`
from `POST /api/auth/google`; writes need the `operator` or `admin` role.

### Job fields (added to `JobRecord`/`JobView`, all optional for older jobs)

| Field | Type | Notes |
|---|---|---|
| `source` | `"camera" \| "desktop-pos" \| null` | `null` on legacy jobs means camera/console |
| `ticketNumber` | `string \| null` | Work-ticket number, write-once, 1–32 chars `[A-Za-z0-9-]` |
| `customerName` | `string \| null` | ≤ 80 chars |
| `note` | `string \| null` | ≤ 200 chars |
| `payments` | `JobPayment[]` | Always an array in `JobView` (empty when none) |
| `paidUsd` | `number` | Sum of payments |
| `paymentStatus` | `"unpaid" \| "partial" \| "paid"` | `paid` when `paidUsd >= priceUsd` |
| `paidAt` | `string \| null` | ISO time the job became fully paid |

`JobPayment`: `{ id, method: "cash"|"card"|"transfer"|"other", amountUsd, ticketNumber: string|null,
reference: string|null, recordedAt, actor, idempotencyKey }`.

### `POST /api/jobs/walk-in`

Headers: `Idempotency-Key` (8–128 chars). Body:
`{ plate, vehicleClass, packageId, employeeId?, ticketNumber?, customerName?, note?, source? }`
(`source` defaults to `"desktop-pos"`).

Creates a staff-entered arrival (already confirmed, no photo, camera id `pos-counter`), opens the job with
the package/price snapshot, assigns the employee when given, and publishes `jobs` + `arrivals`.

- `201` → `JobView` created. `200` → `JobView` replay of the same key with the same plate/package.
- `409` → `{ error, job }` when the plate already has an open job or the key was reused differently.
- `400` invalid plate/class/package/employee/ticket number. `401`/`403` auth.

### `POST /api/jobs/{id}/ticket`

Body `{ ticketNumber }`. Write-once: `200` → `JobView` when set or identical; `409` when a different
ticket number is already set; `404` unknown job. Publishes `jobs`.

### `POST /api/jobs/{id}/payments`

Headers: `Idempotency-Key`. Body `{ method, amountUsd, ticketNumber?, reference? }` where
`0 < amountUsd ≤ 100000`. `201` → `JobView`; `200` → replay; `409` when the key was reused differently or
the job is cancelled; `404` unknown job. Publishes `jobs`.

## Desktop module layout (backend/desktop)

| Path | Owner | What |
|---|---|---|
| `src/services/carwash/types.ts` | shared | DTOs, settings, outbox op types (the contract below) |
| `src/services/carwash/CarwashApiClient.ts` | data layer | Typed client; Electron uses the main-process proxy |
| `electron/carwashProxy.cjs` | data layer | IPC `carwash:fetch` + `carwash:events-*` (no CORS, token stays in main/secure storage) |
| `src/services/carwash/CarwashSettingsStore.ts` | data layer | API URL, register code, auto-print, copies; session token in secure storage |
| `src/services/carwash/CarwashOutbox.ts` | data layer | Durable ordered outbox, idempotency keys, local-id remap |
| `src/services/carwash/CarwashSyncService.ts` | data layer | SSE + polling fallback, outbox flush, refresh |
| `src/services/carwash/workTicketNumber.ts` | data layer | `OT-{registerCode}-{seq:6}` counter (persisted) |
| `src/store/slices/carwashSlice.ts` | data layer | Redux state, thunks, selectors (API below) |
| `src/services/printing/WorkTicketPrinting.ts` | UI layer | `buildWorkTicketReceipt(job, opts)` → `ReceiptPayload` (`kind: 'WORK_ORDER'`) |
| `src/pages/carwash/*`, `src/components/carwash/*` | UI layer | Workboard, new-service modal, settings page |
| `src/pages/pos/PosRegisterPage.tsx` | UI layer | "Cobrar lavado": job → cart line with `carwashJobId`; sale → payment |

### `carwashSlice` public API (the UI codes against these names)

State key `carwash` in the root store. Thunks (all `createAsyncThunk`):

- `initCarwash()` — load settings + cached jobs/packages/employees, start sync if signed in.
- `saveCarwashSettings(partial: Partial<CarwashSettings>)`
- `signInCarwash()` — Google sign-in (existing desktop OAuth) → `POST /api/auth/google`.
- `signOutCarwash()`
- `refreshCarwash()` — packages, jobs, summary, employees.
- `createWalkInJob(input: WalkInInput)` → resolves `CarwashJob` (local or server copy, always with `ticketNumber`).
- `transitionJob({ jobId, status })`
- `assignJobEmployee({ jobId, employeeId })`
- `attachJobTicket({ jobId, ticketNumber })`
- `recordJobPayment({ jobId, payment: JobPaymentInput })`
- `flushCarwashOutbox()`

Selectors: `selectCarwash`, `selectCarwashSettings`, `selectCarwashSession`, `selectCarwashPackages`,
`selectCarwashEmployees`, `selectCarwashJobs`, `selectCarwashJobsByStatus`, `selectUnpaidCarwashJobs`,
`selectCarwashSummary`, `selectCarwashSyncStatus`, `selectCarwashJobById(id)`.
