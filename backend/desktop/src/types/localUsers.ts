// Local users (internal user control) + local audit trail.
//
// Local users are people who share this installation (cashiers, billing staff,
// the accountant). They are NOT cloud accounts: every one of them belongs to the
// Gmail account that enabled user control (the owner/admin), they authenticate
// with a local PIN, and they never leave this device. The audit types record who
// created/changed what — kept locally in the `audit` slice, never synced and never
// sent to Hacienda or the API.

/** Screen-level permission keys (see services/localUsers/permissions.ts). */
export type ScreenPermission =
  | 'dashboard'
  | 'invoices.view'
  | 'invoices.create'
  | 'invoices.invalidate'
  | 'invoices.export'
  | 'customers'
  | 'products'
  | 'products.stock'
  | 'carwash'
  | 'pos.sell'
  | 'pos.tickets'
  /** Action permission (no route): void POS tickets. */
  | 'pos.void'
  /** Action permission (no route): partial returns of POS tickets ("Devoluciones"). */
  | 'pos.return'
  /** Action permission (no route): cash in/out of the drawer ("Entradas/salidas de efectivo"). */
  | 'pos.cash'
  | 'pos.closing'
  | 'pos.consolidate'
  | 'compras'
  | 'librosIva'
  | 'accounts'
  | 'catalogs'
  | 'companies'
  | 'settings'
  | 'account'
  | 'chat';

export type LocalUserRole = 'admin' | 'user';

export interface LocalUser {
  id: string;
  displayName: string;
  /** Unique (case-insensitive) short name shown on the lock screen. */
  username: string;
  role: LocalUserRole;
  /** Gmail account (admin) this user belongs to. */
  ownerEmail: string;
  /** Salted, iterated SHA-256 of the PIN — never the PIN itself. */
  pinHash: string;
  pinSalt: string;
  /** Screens this user can open. Ignored for the admin (admin sees everything). */
  permissions: ScreenPermission[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

/** The Gmail account that owns the local user directory. */
export interface LocalUsersOwner {
  googleUserId: string;
  email: string;
  name: string;
}

export interface LocalUsersState {
  enabled: boolean;
  owner: LocalUsersOwner | null;
  users: LocalUser[];
  /** Who is operating the app right now. Runtime-only: the app locks on restart. */
  activeUserId: string | null;
}

/** Who performed a change (a snapshot: names survive user renames/deletes). */
export interface AuditActor {
  id: string;
  name: string;
  /** 'system' = unattended work (background email import), not a person. */
  role: LocalUserRole | 'system';
}

export type AuditEntityType = 'invoice' | 'customer' | 'product' | 'ticket' | 'closing' | 'compra' | 'company' | 'user';

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'status'
  | 'stock'
  | 'void'
  | 'complete'
  | 'consolidate'
  | 'login'
  | 'logout'
  | 'login_failed';

/** Per-entity "audit properties": who created it and who touched it last. */
export interface AuditStamp {
  createdBy?: AuditActor;
  createdAt?: string;
  updatedBy?: AuditActor;
  updatedAt?: string;
}

export interface AuditEvent {
  id: string;
  at: string;
  actor: AuditActor;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  companyId?: string;
  /** Human-readable label of the entity at the time of the change (e.g. "Factura DTE-01-…"). */
  entityLabel?: string;
  /** Short Spanish description of what changed. */
  summary: string;
}

export interface AuditState {
  /** Keyed by `${entityType}:${entityId}`. */
  stamps: Record<string, AuditStamp>;
  /** Newest first, capped (see AUDIT_EVENT_LIMIT). */
  events: AuditEvent[];
}
