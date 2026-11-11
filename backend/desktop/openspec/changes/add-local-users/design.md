# Design — Local users + local audit trail

## D1. Owner = the Gmail account; users are local

`localUsersSlice` holds `{ enabled, owner, users, activeUserId }`. Enabling requires a signed-in
Google account (`auth.isAuthenticated && user.email`); the owner is snapshotted
(`googleUserId/email/name`) and the admin `LocalUser` is created with `role: 'admin'`. Every user
carries `ownerEmail`. Re-enabling for the **same** owner keeps the directory and the admin id (so
history stays attributed); a **different** Gmail account starts a fresh directory. The admin can
never be deactivated, restricted or deleted.

Enforcement keys off the local directory, not the live Google session: signing out of Google or
switching to guest mode does not bypass the lock. `selectLocalUsersEnabled` also requires an active
admin, so a corrupted directory can never lock everybody out.

## D2. Sessions and PINs

`activeUserId` is excluded from the persist whitelist → the app always starts locked. PINs are
hashed with the pure-TS SHA-256 already shared with Device Sync (salt + 1 000 iterations; works in
the `app://` renderer without `crypto.subtle`). `unlockLocalUser` is a thunk so the PIN never travels
inside a Redux action (and therefore never reaches devtools, persistence or the audit middleware).
This is internal control for a shared register, not a security boundary against someone with file
access to the machine.

After unlocking, if the current route is off-limits for the new user (the previous user locked on
an admin screen), the lock screen navigates to the user's first permitted screen.

## D3. One route → permission map

`services/localUsers/permissions.ts` owns the ordered pattern list (specific routes before their
`/:id` siblings), `routeAccess`, `canAccessPath`, `hasPermission`, `firstAllowedRoute` and the
presets. It has its own tiny matcher (no router import) so Jest can load it. Consumers:
`AppShell` (lock screen → access check → `/home` redirects to the landing, anything else renders
`AccessDenied`), `Sidebar` (locks items by `permission`/`adminOnly`),
`SettingsPage` (cards disabled by their `href`), and pages via `useCan`/`usePermissionCheck`.
Restricted sidebar tabs are **disabled, not hidden** (lock icon, `aria-disabled`, `data-locked="permission"`,
"Sin permiso" tooltip): users see the app's full shape and know to ask the admin; the guard still
blocks typed URLs. Action buttons inside an allowed screen are hidden instead (a view-only user
simply has no "Nuevo DTE").

## D4. Audit lives outside the entities

The "audit properties" are stored in the `audit` slice keyed `${entityType}:${entityId}`
(`createdBy/createdAt/updatedBy/updatedAt`) plus a newest-first event log capped at 3 000.
Keeping them off the entity objects means:

- Device Sync payloads, the byte-identical merge engine and the DTE JSON never see them
  ("local purposes only" by construction);
- a relay upsert that replaces an entity verbatim cannot erase local authorship.

The slice persists with `throttle: 500` so bulk writes (production-access batches) coalesce.

## D5. Capture seam (mirrors Device Sync capture)

`auditCaptureMiddleware` uses an allowlist of local-write action types (same shape as
`services/sync/capture.ts`); after the reducer runs it diffs the collection by reference to find
created/updated/deleted entities and credits them to `selectAuditActor` (active local user → Gmail
account → "Usuario principal"). `sync*` relay actions, bulk loads, `delete*ByCompany` and stock
side effects of a sale are not listed. Invoice updates that only touch bookkeeping fields
(control number, totals, seals, transmission dates) or move to the transient `Sincronizando` state
are ignored; status transitions get specific summaries. Product writes that only change stock are
classified as `stock`. `localUsers/*` actions produce user-management and sign-in events.

Tickets and compras live in appStorage databases; `installAuditCapture` subscribes to their change
listeners (relay writes never emit). Background email imports pass `{ origin: 'import' }` to
`insertCompra` and are credited to a system actor ("Importación automática (correo)"); their
auto-verify re-save is not logged. Tickets and Z closings are log-only (no per-record stamps):
one ticket per sale would grow the persisted slice without bound, and main.cjs caps each storage
key at 5 MB. Their events gained an optional `kind` so the log can tell a
sale from a reprint; `ComprasDatabase.addChangeListener` adds observers without displacing the
single sync listener.
