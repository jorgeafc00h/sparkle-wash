// Local users + audit selectors.

import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '../index';
import type { AuditActor, AuditEntityType, AuditEvent, LocalUser } from '@/types/localUsers';
import { auditKey } from '../slices/auditSlice';

export const selectLocalUsersState = (state: RootState) => state.localUsers;

export const selectLocalUsers = createSelector([selectLocalUsersState], (localUsers): LocalUser[] =>
  [...localUsers.users].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
    return a.displayName.localeCompare(b.displayName, 'es');
  }),
);

/**
 * User control is in force only with an active admin — a directory without one
 * (shouldn't happen) must never lock everybody out.
 */
export const selectLocalUsersEnabled = createSelector(
  [selectLocalUsersState],
  (localUsers) => localUsers.enabled && localUsers.users.some((user) => user.role === 'admin' && user.isActive),
);

export const selectLocalUsersOwner = createSelector([selectLocalUsersState], (localUsers) => localUsers.owner);

/** The user operating the app, or null (locked, or user control off). */
export const selectActiveLocalUser = createSelector(
  [selectLocalUsersState, selectLocalUsersEnabled],
  (localUsers, enabled): LocalUser | null => {
    if (!enabled || !localUsers.activeUserId) return null;
    const user = localUsers.users.find((item) => item.id === localUsers.activeUserId);
    return user && user.isActive ? user : null;
  },
);

export const selectIsLocalSessionLocked = createSelector(
  [selectLocalUsersEnabled, selectActiveLocalUser],
  (enabled, activeUser) => enabled && !activeUser,
);

/**
 * The user whose permissions apply: null means "no restrictions" (user control
 * off). Pair with `hasPermission`/`canAccessPath`.
 */
export const selectPermissionSubject = createSelector(
  [selectLocalUsersEnabled, selectActiveLocalUser],
  (enabled, activeUser): LocalUser | null => (enabled ? activeUser : null),
);

/** Admin = the Gmail owner session, or anyone when user control is off. */
export const selectIsLocalAdmin = createSelector(
  [selectLocalUsersEnabled, selectActiveLocalUser],
  (enabled, activeUser) => !enabled || activeUser?.role === 'admin',
);

const GUEST_ACTOR: AuditActor = { id: 'principal', name: 'Usuario principal', role: 'admin' };

/**
 * Who gets credited with a change right now: the unlocked local user; with user
 * control off, the signed-in Gmail account (or the single guest user).
 */
export const selectAuditActor = createSelector(
  [selectActiveLocalUser, (state: RootState) => state.auth.user],
  (activeUser, authUser): AuditActor => {
    if (activeUser) return { id: activeUser.id, name: activeUser.displayName, role: activeUser.role };
    if (authUser?.email) {
      const name = `${authUser.firstName ?? ''} ${authUser.lastName ?? ''}`.trim() || authUser.email;
      return { id: `google:${authUser.id || authUser.email}`, name, role: 'admin' };
    }
    return GUEST_ACTOR;
  },
);

export const selectAuditStamps = (state: RootState) => state.audit.stamps;
export const selectAuditEvents = (state: RootState) => state.audit.events;

export const selectAuditStamp = (entityType: AuditEntityType, entityId: string | undefined) => (state: RootState) =>
  entityId ? state.audit.stamps[auditKey(entityType, entityId)] : undefined;

export const selectEntityAuditEvents = (entityType: AuditEntityType, entityId: string | undefined) =>
  createSelector([selectAuditEvents], (events): AuditEvent[] =>
    entityId ? events.filter((event) => event.entityType === entityType && event.entityId === entityId) : [],
  );
