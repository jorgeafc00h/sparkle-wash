# Add Local Users — internal user control linked to the Gmail admin + local audit trail

## Why

Shops share one Desktop install between several people (cashier, billing staff, the accountant).
Today everyone works as the same person: there is no way to restrict what a cashier can open, and
no record of who created an invoice, edited a customer or voided a ticket. The owner wants simple
**internal** user control — not cloud accounts — to see who did what.

## What Changes

- **Local users, owned by the Gmail admin.** The Google account signed in when user control is
  enabled (Configuración → Usuarios y permisos) becomes the owner: it gets the **admin** local user
  (sees and manages everything) and every user it creates is linked to it (`ownerEmail`). Users are
  device-local, unlock with a 4–8 digit PIN (salted/iterated SHA-256, never stored in clear) and
  are never synced or sent to the API.
- **Lock screen.** With user control on, the app starts locked ("¿Quién está usando la app?") —
  the active session is not persisted. The sidebar shows who is signed in with a switch-user
  button. The admin can also unlock with the owner Google account if the PIN is forgotten.
  5 wrong PINs → 30 s cooldown.
- **Screen permissions.** 20 grantable screen permissions (Inicio, ver/crear/anular facturas,
  exportar, clientes, productos, ajustes de inventario, POS venta/tickets/cierre/consolidar,
  compras, Libros IVA, cobros y pagos, catálogos, empresas, configuración, perfil/suscripción,
  chat) with presets (Cajero, Facturación, Contador). One route→permission map drives the
  AppShell guard ("Acceso restringido"), the sidebar/settings grid (restricted tabs and cards stay
  visible but disabled, with a lock and a "Sin permiso" tooltip) and
  in-page actions (e.g. "Nuevo DTE", edit/send/duplicate, invalidate/contingency, stock adjust).
  User management and the activity log are admin-only.
- **Local audit properties.** Every record gets "Creado por / Última modificación por" (actor
  snapshot + timestamp) and a capped activity log (3 000 events) of creates, edits, status
  changes (transmitted, voided, contingency), deletes, POS sales/voids, compras, company edits,
  user management and sign-ins (incl. failed PINs). Shown on invoice/customer/product/compra
  detail screens, as a "Creado por" column + filter on the DTE list, and in
  Configuración → Usuarios → Historial de actividad. POS tickets carry the cashier name (`cashierName`, printed
  as "Cajero: …"); stock movements record the actor instead of `desktop-user`.
- With user control **off** nothing is restricted; changes are credited to the Gmail account (or
  "Usuario principal" in guest mode).

## Impact

- New: `localUsers` + `audit` slices (persisted; `activeUserId` deliberately not), 
  `services/localUsers/{permissions,pinHash,auditCapture}.ts`, lock screen / access-denied /
  audit components, `/settings/users`, `/settings/audit`.
- `TicketDatabase`/`ComprasDatabase` change events gained optional `kind` (+ label fields);
  `ComprasDatabase.addChangeListener` lets the audit log observe without displacing the Device
  Sync listener. Sync payloads, the merge engine and the DTE JSON are untouched — the audit data
  lives outside the entities by design.
- Not in scope: syncing users/audit across devices, per-company user lists, backend accounts.
