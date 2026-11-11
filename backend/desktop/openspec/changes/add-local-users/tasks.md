# Tasks — add-local-users

## 1. Domain
- [x] 1.1 Types (`src/types/localUsers.ts`): users, owner, permissions, audit actor/stamp/event
- [x] 1.2 `services/localUsers/permissions.ts` — catalog, presets, route map, access helpers
- [x] 1.3 `services/localUsers/pinHash.ts` — salted iterated SHA-256 + constant-length compare
- [x] 1.4 `localUsersSlice` (enable/disable, add/update/reset PIN/delete, sessions, `unlockLocalUser` thunk)
- [x] 1.5 `auditSlice` (stamps + capped log) and selectors (`selectAuditActor`, stamps, events)
- [x] 1.6 Persist configs (`activeUserId` not persisted; audit throttled)

## 2. Audit capture
- [x] 2.1 `auditCaptureMiddleware` (invoices, customers, products, companies, localUsers)
- [x] 2.2 Ticket + compra listeners (`installAuditCapture`), `kind` on change events,
      `ComprasDatabase.addChangeListener`
- [x] 2.3 POS `cashierName` + stock-movement `createdBy` use the active user

## 3. UI
- [x] 3.1 Lock screen (PIN, cooldown, Google unlock for the owner, land on permitted screen)
- [x] 3.2 AppShell guard + `AccessDenied`; Sidebar filtering + signed-in user footer
- [x] 3.3 Configuración → Usuarios y permisos (enable, create/edit, presets, reset PIN, (de)activate, delete, disable)
- [x] 3.4 Historial de actividad (`/settings/audit`, formerly "Bitácora") with user/type/company filters and links to records
- [x] 3.5 `AuditInfo` on invoice/customer/product/compra detail; "Creado por" column + filter on the DTE list
- [x] 3.6 Permission-aware actions (new DTE, edit/send/delete/duplicate/linked docs, invalidate/contingency, stock adjust, consolidate shortcut)

## 4. Tests
- [x] 4.1 Jest: `src/__tests__/localUsers/{permissions,localUsersSlice,auditCapture}.test.ts`
- [x] 4.2 Playwright: `playwright/tests/settings/03-local-users.spec.ts`

## 5. Review (2026-10-07)
- [x] 5.1 Restricted tabs/settings cards disabled (lock + tooltip) instead of hidden
- [x] 5.2 Email-imported compras credited to "Importación automática"; auto-verify re-save not logged
- [x] 5.3 Tickets + Z closings log-only (no per-record stamps); Z closing audited; cashier shown on ticket list/detail
- [x] 5.4 Company bookkeeping writes (`isDefault`, `credentialsLastTestedAt`, `lastSyncDate`) not logged as edits
- [x] 5.5 Playwright web suite expanded to 10 flows; Electron `10-local-users-restart.spec.ts` (real restart)
