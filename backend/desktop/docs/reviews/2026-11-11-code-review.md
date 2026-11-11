# Code review: SparkleWash PRs #10 and #11 plus the uncommitted iOS redesign (2026-11-11)

Scope: `git diff 3f3635f..HEAD` on main, and `/Users/jorgeflores/github/carwash/SparkleWash-iOS` compared with the `qa` worktree.
Verified by reading code. Also ran `dotnet test backend/carwash.sln` (68 passed, 1 skipped), `npx tsc --noEmit` (clean) and `npx jest src/__tests__/carwash` (89 passed).
Not run: Playwright, Postgres-backed API paths (no test covers them), a Release iOS build.
Paths are relative to the repo root (the `qa` worktree). `D/` means `backend/desktop/`.

Counts: critical 0, high 2, medium 11, low 9.

---

## High

### H1. A real taxpayer's MH test private key, certificate password hash and MH password are committed to a public repo (CONFIRMED, security-sensitive)
- `D/playwright/fixtures/certificates/06141404941342.crt` holds a PKCS#8 private key plus the `<clave>` (SHA-512 of the certificate password) for NIT 06141404941342.
- `D/playwright/fixtures/mh-test-credentials.ts:27` holds `mhPassword: '<redacted>'`, and line 38 holds the proxy API key. The header comment says "safe to check in because the dotnet repo already has them".
- `gh repo view` reports the repo as PUBLIC. Anyone can sign DTEs and authenticate to MH test as that NIT. If any of these values were reused outside test, they are compromised.
- Fix: remove the file and values from the tree. Purge git history (filter-repo/BFG) or at least rotate the MH password and certificate. Load the values from CI secrets or a gitignored fixture. `.gitignore` already lists `*.pfx` and `*.key` but not `*.crt`.

### H2. A carwash payment can be silently lost after the sale is already taken (CONFIRMED)
- `D/src/pages/pos/PosRegisterPage.tsx:809` does `Promise.resolve(dispatch(recordJobPayment(...))).catch(...)`. An RTK `createAsyncThunk` never rejects its returned promise. Rejections (`rejectWithValue`) resolve to a `rejected` action, so the `.catch` is dead code and the cashier gets no warning.
- Silent-loss paths:
  - `simpleWrite` returns "El servicio ya no existe" when the job is not in state (for example trimmed by `capJobs`, or removed by a refresh).
  - A 4xx from the server (job cancelled in the meantime, 403 for a viewer role) goes through `rollbackFailed`, which discards the outbox entry.
  - A payment on a local walk-in whose walk-in failed is marked failed in `CarwashOutbox.runFlush` (`carwashSlice.ts` only reports it through `syncError`).
- Result: the customer is charged and the ticket is saved, but the job stays "Por cobrar", with no retry and no toast.
- Fix: await the thunk, inspect `.meta.requestStatus`, and toast a warning that names the job. Keep the payment in the outbox as failed with a visible retry, rather than rolling back and discarding. Never discard a payment entry.

---

## Medium

### M1. A concurrent 401 from the SSE stream and the poll forces a spurious sign-out, and can leave state inconsistent (CONFIRMED by trace)
- `D/src/services/carwash/CarwashSyncService.ts:164-188`. `start()` calls `connect()` and then `syncNow()` immediately. If the saved token is invalid server-side (API restart or scale-to-zero with in-memory sessions, or role removed), both the stream `onOpen(401)` (line 214) and the refresh 401 call `handleUnauthorized`.
- The first call sets `reLoginAttempted = true` and awaits `silentReLogin`. The second call sees the flag, calls `stop(false)` and `onSignedOut()`, and clears the session and keychain entry.
- The first call then finishes: `exchangeIdToken` has already saved the new session and dispatched `sessionChanged`. Redux shows signed-in, but the service is stopped and sync is dead until restart.
- Separately, the flag is reset to `false` right after a successful re-login (line 184). If the new token is also 401 (for example sessions held per instance behind a load balancer), this loops forever with no delay. The header comment promises "ONE silent re-login".
- Fix: keep a single in-flight promise (`this.reLogin ??= ...`) that all callers await. Reset the flag only after a request succeeds with the new token, and add a backoff.

### M2. POS discounts are not reflected in the payment recorded on the job (CONFIRMED)
- `D/src/services/carwash/posCarwashLines.ts:78-95` pays `round2(line.lineTotal)`.
- Line discounts are allowed on carwash lines (`changeLineDiscountPct`, `PosRegisterPage.tsx:~337`; only quantity is locked). A 10% line discount records a $13.50 payment on a $15 job. The job becomes "partial", keeps a $1.50 balance, reappears in "Lavados por cobrar", and invites a second charge.
- The ticket-level discount (`effectiveTicketDiscount`) and the cash rounding are never allocated to carwash lines. The job is recorded paid in full while the customer paid less, and the job's revenue is overstated.
- Fix: either forbid discounts on carwash lines, or allocate the ticket discount across lines and record the allocated amount. Treat the discount as settling the job (record the discount, or cap the balance) so the job closes.

### M3. NewServiceModal reports success and prints a work ticket for a walk-in the server rejected (CONFIRMED)
- `createWalkInJob` returns a fulfilled value with `syncError` set when the outbox entry is rejected (`D/src/store/slices/carwashSlice.ts:605`). `NewServiceModal.tsx:75-91` only uses `.unwrap()`, so a 400/403/409 shows "Servicio creado" and auto-prints an `OT-` ticket.
- The customer gets a ticket for a job that does not exist server-side. The cashier only sees a small "Error de sync" badge afterwards.
- Fix: check `job.syncError` before the success toast and the print. Warn the cashier instead.

### M4. Failed walk-ins are permanent, undiscardable and still chargeable in POS (CONFIRMED)
- `CarwashOutbox.retryFailed` and `discard` are never called from any UI (grep). A failed walk-in entry stays forever.
- `capJobs` always keeps `local-*` jobs. `selectUnpaidCarwashJobs` lists them, so the POS "Lavados por cobrar" offers a job that will never sync.
- Charging it makes the payment op fail with "El servicio local no se pudo sincronizar" (H2, silent).
- Fix: add "Reintentar" and "Descartar" actions on jobs with `syncError`. Exclude jobs with a failed or unsynced walk-in from the POS picker, or block charging them.

### M5. The outbox survives account and server switches and replays into the wrong tenant or server (PLAUSIBLE)
- `signOutCarwash` and the `apiBaseUrl`-change branch of `saveCarwashSettings` clear the session, but not the persisted outbox (`carwash_outbox_v1`). The persisted `jobs` also keep local and pending jobs (`sessionCleared`).
- If a different Google account (another carwash) signs in, or the URL is pointed at another server, the queued walk-ins and payments flush into that tenant or server. Tickets, plates and amounts leak across tenants. Payments to unknown ids fail with 404 or are marked failed.
- Fix: stamp each outbox entry (and local job) with the tenant id plus API origin at enqueue time. Flush only matching entries, or require the user to confirm and discard on switch.

### M6. A 409 on a walk-in is treated as success when only the plate matches (CONFIRMED)
- `D/src/services/carwash/CarwashOutbox.ts:281-286` accepts any 409 whose `job.plate` equals the local plate, even when it is "Plate already has an open job" for a different job.
- The local walk-in is remapped onto that server job. The package, price, employee, customer and note the cashier entered are silently dropped. A work-ticket number that was consumed is wasted.
- Fix: accept the 409 only when `job.transitions` contains this entry's idempotency key. Otherwise mark the entry failed with the server's message and surface the existing job to the cashier.

### M7. The release job can publish a half-empty release that is never repaired, and `releases/latest` is fragile (CONFIRMED logic)
- `.github/workflows/desktop-release.yml:114-130`: `gh release create "$tag" release/*` creates and publishes the release, then uploads assets. If an upload fails midway, the tag exists. Every later run hits "already published" and exits 0, so `latest.yml` or the `.exe` may stay missing. The link check at lines 131-144 only runs on the run that created the release.
- The landing button and the baked updater feed both use `/releases/latest/download/…`. Any later release in the repo that becomes "latest" (an API or iOS release, a manual release) makes the download and auto-update 404.
- Fix: create the release as a draft, upload, verify, then publish (`gh release edit --draft=false`). On rerun, verify the assets of an existing release. Use `--latest=false` for non-desktop releases, or point the feed and the landing page at a fixed `desktop-latest` tag.

### M8. The SSE stream has no idle or heartbeat watchdog (PLAUSIBLE)
- The main process and the fetch stream (`D/electron/carwashProxy.cjs:145-170`, `CarwashEventStream.ts:54-87`) never time out. When the laptop sleeps, the NAT drops, or the connection goes half-open, the read just hangs.
- `streamLive` stays true, so the 15 s polling in `startPolling` (line 270) is suppressed. The board stops updating, with the "En vivo" badge still shown.
- Fix: track the last data or comment line time. If nothing arrives within roughly 2x the server heartbeat, close the stream and fall back to polling and reconnect.

### M9. The work-ticket counter is per-device, and the default register code `C1` collides across machines (CONFIRMED)
- `D/src/services/carwash/workTicketNumber.ts`: the counter lives in local app storage and the default `registerCode` is `C1` (`types.ts:156`). Two cash registers that keep the default both emit `OT-C1-000001`.
- Wiping or reinstalling userData resets the counter and reuses numbers.
- The API only enforces write-once per job, not uniqueness (`JobStore.SetTicketAsync` and walk-in create). Duplicate printed ticket numbers for different cars are accepted.
- Fix: enforce unique `ticket_number` per tenant (index plus 409), and have the desktop retry with the next number. Or prompt for a unique register code on first run.

### M10. The `carwash:fetch` IPC proxy can reach any http(s) host, and the base URL is not validated (security-sensitive, PLAUSIBLE)
- `D/electron/carwashProxy.cjs:22-42`. The renderer chooses `baseUrl`, and main sends an authenticated request and returns status, headers and body. The path is limited to `/api/`, but the host is not limited.
- A compromised renderer (XSS or a malicious dependency) gets a CORS-free request primitive against localhost, LAN and metadata endpoints (169.254.169.254), with the response readable. `mhProxy.cjs` pins hosts; this one does not.
- `redirect:'error'` is good. Plain `http:` is accepted, so the bearer token can travel in cleartext. `CarwashSettingsPage` and `sanitizeCarwashSettings` do not validate the scheme.
- Fix: keep the saved API origin in the main process (set only via the settings IPC) and reject calls with another origin. Require https except for loopback and `localhost`. Optionally block private IP ranges unless the dev flag is on.

### M11. A packaged build can silently point at `http://localhost:8080` (CONFIRMED)
- `DEFAULT_CARWASH_SETTINGS.apiBaseUrl` is `http://localhost:8080` (`types.ts:155`). `.github/workflows/desktop-release.yml:61-68` only warns when the Google IDs are missing and does nothing when `vars.SPARKLEWASH_DESKTOP_API_URL` is unset.
- The released installer ships with sync pointed at localhost and no hint to the user.
- Fix: fail the release build (not only warn) when `VITE_SPARKLEWASH_API_URL` is empty on main. Also check that it starts with `https://`.

---

## Low

### L1. Replays of `POST /api/jobs/walk-in` ignore changed ticket, customer, note and employee
- `Program.cs:~475-533`, `JobStore.CreateAsync` (`sameKey` compares only arrival id and package id). A retry with the same key and a different `ticketNumber`, `customerName`, `note` or `employeeId` returns 200 with the original data instead of 409.
- Mid-sequence failures leave state behind:
  - On the Postgres path each store call is its own transaction (arrival add, confirm, create, link, assign). A failure after confirm leaves a confirmed arrival with no job. The retry heals it, but the arrival is visible in the review queue in the meantime.
  - `Changes.Publish` only runs on the `Created` result, so a retry that completes the work after an earlier crash publishes nothing to SSE clients.
- Fix: compare all stored fields on replay (or document last-write-ignored). Publish on a healed replay too.

### L2. Payment amounts are not constrained to cents, and overpayment is allowed
- `Program.cs:563`, `JobStore.AddPaymentAsync`. `amountUsd` of 0.001 is accepted and stored in jsonb. `paid >= price` uses exact decimal sums, so 9.999 against a $10 job reads "partial".
- There is no cap relative to the balance, and payments can be added to jobs that are not started or completed. Two registers with different keys both pay the full balance.
- Fix: reject more than 2 decimals (or round to cents) and reject amounts above the remaining balance, or record them as overpayment explicitly.

### L3. Voiding or returning a POS ticket that contains a carwash line does not touch the job
- No carwash code is referenced from the ticket void and return code (grep). The job stays "paid", and the API has no refund or void-payment endpoint.
- Fix: add a payment reversal endpoint and call it from void and return. Short term, show a warning on void.

### L4. Held (suspended) sales keep stale carwash lines
- A resumed hold keeps `carwashJobId` and the old `unitPrice`. The job may have been paid at another register in the meantime, and nothing revalidates `jobBalanceUsd` on resume or at pay time, so it can be charged twice.
- Fix: refresh the balances of carwash lines on resume and in `completeSale`.

### L5. Stale refresh can overwrite a just-flushed local write
- `refreshOnly` (SSE-triggered) can race a `queueWrite` flush. A GET issued before the write returns old data, and `refreshed` is dispatched after `flushApplied` cleared `pendingSync`, so `carwashSlice.ts:178-183` overwrites the new status. The next SSE refresh (about 500 ms) corrects it. Cosmetic flicker.

### L6. `carwash:events-start` registers a new `sender.once('destroyed')` listener on every start
- `D/electron/main.cjs:1102-1110`. Reconnects accumulate listeners (small leak, and a MaxListeners warning after about 10 reconnects). Also, `stopCarwashEvents(sender.id)` runs in `destroyed`.
- Fix: capture `const id = sender.id`, register the listener once per webContents, or use a Set.

### L7. Session token storage falls back to plaintext
- `CarwashSettingsStore.saveCarwashSession` ignores the boolean result of `secureSet`. In `main.cjs` `secureSetValue`, if `safeStorage` is unavailable it stores the token unencrypted in `secrets.json` (0600). This is acceptable, but the token cannot be revoked client-side except via `DELETE /api/auth/session` on sign-out. Consider a warning in the UI when `secure:isAvailable` is false.

### L8. Deployment workflow edge cases (`deploy-ibm-code-engine.yml`)
- Lines ~56-58: if `VITE_GOOGLE_CLIENT_ID` is empty, `grep -Fqx ""` matches any blank line in the id list. A job-level guard that the var is non-empty would make this robust.
- Lines ~247-255: the merge appends `\nSPARKLEWASH_GOOGLE_CLIENT_ID=...` with a leading blank line, and the `ibmcloud ce secret --from-env-file` parser may reject blank lines. If the secret is stored with CRLF line endings, `\r` stays in the ids (the earlier `sed 's/ *$//'` does not strip `\r`).
- The `.next` temp file is not covered by the `trap`.
- The id regex `^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$` rejects IDs containing `_` or `-` after the first dash. Verify against the real ids.

### L9. `desktop-release.yml`: PR builds embed secrets, and the shipped client secret is public by design
- On same-repo PRs, `npm run build` runs PR-controlled code with `SPARKLEWASH_DESKTOP_GOOGLE_CLIENT_SECRET` in its environment. PR artifacts (14-day retention) and the public release both contain it in the bundle (`VITE_*`). Google treats Desktop-client secrets as non-confidential, so this is acceptable only if the OAuth client is of Desktop type and uses PKCE. Do not reuse that client for anything else.
- Fix (optional): do not pass secrets on `pull_request`. Build without them, or use `pull_request_target` with a trusted checkout only.
- Also dead code: `macDownloadUrl()` in `main.cjs` points at `SparkleWash-latest-mac.dmg`, which no workflow produces.

---

## Looks good (checked and sound)

- **API validation order and auth:** role checks (operator/admin) come before any write on all three routes. Idempotency-Key, plate, class, package/price, employee, ticket (`[A-Za-z0-9-]{1,32}`), customer (80), note (200) and source are validated before any state change. Every operation goes through `tenants.For(session.TenantId)`, so tenancy is correct.
- **Concurrency under the lock:** `JobStore.SetTicketAsync` and `AddPaymentAsync` run entirely under `_gate`. In Postgres each write takes `FOR UPDATE` on the tenant row inside one transaction, so same-key payment retries are serialised.
- **Payment replay semantics:** same key with identical body returns the existing job (200). A reused key with a different body returns 409. A cancelled job blocks new payments but still replays old ones. `PaidAt` is set once. `paymentStatus` and `paidUsd` math is consistent with the desktop (`paymentFields`) and iOS.
- **Walk-in replay:** an existing "pos-counter" arrival for the key is found first. `AddAsync` returning `Conflict` (digest differs by `CapturedAt`) is correctly ignored. Plate or class mismatch on replay gives 409. Dismissal on a lost plate race only happens for an arrival created in that call.
- **Postgres persistence:** migration 004 is idempotent (`IF NOT EXISTS`, `ON CONFLICT`). `SaveJobSql` column order matches `SELECT *` from `jsonb_populate_record`. The new fields round-trip through `Save` (snake_case) and `Jobs()` (payments re-deserialised with camelCase).
- **DevHost cannot ship or run in production:**
  - The root `Dockerfile` restores and publishes only `backend/src/carwash-api/WebApi.csproj`, and copies only that folder's sources.
  - `DevIdentityVerifier`'s constructor throws unless `ASPNETCORE_ENVIRONMENT=Development`, `Parse()` re-checks on every call, and `Main` exits first.
  - The production `Program.Main` never injects a verifier.
- **carwashProxy:** methods, `/api/` path, no `..`, no backslash/CRLF, header allowlist, 1 MB request cap, 8 MB response cap (checked while streaming), timeout via `AbortSignal.timeout`, and `redirect:'error'` all behave as intended. The token is never logged or echoed. One stream per window; the old one is aborted on restart; abort errors are suppressed. The IPC surface in `preload.cjs` is minimal and unsubscribes correctly.
- **CarwashOutbox:** ordered replay, durable persistence with serialised writes, local-id remap (also persisted in `idMap`), stop-on-network/5xx/401 behaviour, and a crash after send re-sends with the same idempotency key, which the API de-duplicates.
- **sseParser:** handles LF, CRLF and bare CR across chunk boundaries, comments and multi-line data. `CarwashEventStream` unsubscribes on `close()`.
- **Rebrand:** `app.setName` and the pinned `userData` run before any `getPath('userData')` use; the Playwright `--user-data-dir` override is respected. The updater is opt-in (runtime env var or baked `app-update.yml`), never the Facturas Simples feed, and a failing updater cannot block startup.
- **Web:** the landing download section matches the release asset names (`SparkleWash-Setup-latest.exe`, `latest.yml`). `Catalog.locale?` and `tagline?` are handled with fallbacks in `i18n/index.tsx`. Tests updated accordingly.
- **iOS (merged):** `JobDTO` and SparkleKit `Job` decode every new field as optional, so older APIs still decode. Payment-status logic falls back sensibly. Display strings do not break the existing accessibility identifiers.
- **Uncommitted iOS redesign:**
  - `DemoSupport.swift` is wrapped in `#if DEBUG`. The `#else` branch has only no-op stubs for `openTarget`/`scrollTarget`/`forLaunch`/`demoSignInIfRequested`, and nothing else in the app references `DemoSupport`. No `Release`-only settings in `project.yml` override this. Demo mode cannot be enabled in a Release build (I did not compile Release, so confirm in CI).
  - The new job-card "next action" button and the detail-bar button call the same `model.transition(job, to:)` as before. The idempotency key is derived inside `mutate` (`"<status>-<jobId>"` with a per-key UUID), so the key behaviour is unchanged. Completing now also asks for confirmation (new, safe).
  - Accessibility identifiers: none removed, `job-next-action` and `job-detail-next-action` added.
  - Force unwraps: only `DemoSupport.swift` (literal URL, DEBUG only) and the pre-existing `savedAt!` at `OperationsView.swift:510/514`, which is unchanged.
  - The UI language changed from English to Spanish in `Views.swift`/`OperationsView.swift`. No UI test in the repo depends on the old strings, but update any external test scripts.
- **CI desktop job:** runs `tsc --noEmit`, `jest --ci` and `npm run build` on Node 26, while the release job builds with Node 22 (low risk, but keep them aligned).
