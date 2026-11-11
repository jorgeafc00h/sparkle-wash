// Local users — internal user control for a shared installation.
//
// The Gmail account signed in when user control is enabled becomes the owner:
// it gets the admin local user (sees and manages everything) and every other
// local user is linked to it (`ownerEmail`). Users unlock the app with a PIN;
// the active session is runtime-only (not persisted), so the app always starts
// locked once user control is on. Nothing here is synced or sent anywhere.

import { createSlice, nanoid, PayloadAction } from '@reduxjs/toolkit';
import type {
  LocalUser,
  LocalUsersOwner,
  LocalUsersState,
  ScreenPermission,
} from '@/types/localUsers';
import { createPinSalt, hashPin, verifyPin } from '@/services/localUsers/pinHash';
import { normalizePermissions } from '@/services/localUsers/permissions';

const initialState: LocalUsersState = {
  enabled: false,
  owner: null,
  users: [],
  activeUserId: null,
};

const sameEmail = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

const normalizeUsername = (username: string) => username.trim().toLowerCase();

/** The username already taken by another user, if any (case-insensitive). */
export function findUsernameConflict(
  users: readonly LocalUser[],
  username: string,
  exceptId?: string,
): LocalUser | undefined {
  const wanted = normalizeUsername(username);
  return users.find((user) => user.id !== exceptId && normalizeUsername(user.username) === wanted);
}

/** Lock-screen helper: derives a username from the Gmail address (local part). */
export function usernameFromEmail(email: string): string {
  return normalizeUsername(email.split('@')[0] || 'admin').replace(/[^a-z0-9._-]/g, '') || 'admin';
}

interface PinCredentials {
  pinHash: string;
  pinSalt: string;
}

const credentialsFor = (pin: string): PinCredentials => {
  const pinSalt = createPinSalt();
  return { pinSalt, pinHash: hashPin(pin, pinSalt) };
};

export interface NewLocalUserInput {
  displayName: string;
  username: string;
  pin: string;
  permissions: readonly ScreenPermission[];
}

export interface LocalUserUpdate {
  id: string;
  displayName?: string;
  username?: string;
  permissions?: readonly ScreenPermission[];
  isActive?: boolean;
}

const localUsersSlice = createSlice({
  name: 'localUsers',
  initialState,
  reducers: {
    /**
     * Turns user control on for the signed-in Gmail account. Re-enabling for the
     * same owner keeps the existing users (and the admin's id, so audit history
     * stays attributed); a different Gmail account starts a fresh directory.
     */
    enableLocalUsers: {
      reducer(
        state,
        action: PayloadAction<{ owner: LocalUsersOwner; adminId: string; now: string } & PinCredentials>,
      ) {
        const { owner, adminId, now, pinHash, pinSalt } = action.payload;
        if (!owner.email) return;
        if (state.owner && !sameEmail(state.owner.email, owner.email)) {
          state.users = [];
        }
        state.owner = owner;
        const admin = state.users.find((user) => user.role === 'admin');
        if (admin) {
          admin.displayName = owner.name || admin.displayName;
          admin.ownerEmail = owner.email;
          admin.pinHash = pinHash;
          admin.pinSalt = pinSalt;
          admin.isActive = true;
          admin.updatedAt = now;
          admin.lastLoginAt = now;
        } else {
          const username = findUsernameConflict(state.users, usernameFromEmail(owner.email))
            ? `admin-${adminId.slice(-4)}`
            : usernameFromEmail(owner.email);
          state.users.unshift({
            id: adminId,
            displayName: owner.name || owner.email,
            username,
            role: 'admin',
            ownerEmail: owner.email,
            pinHash,
            pinSalt,
            permissions: [],
            isActive: true,
            createdAt: now,
            updatedAt: now,
            lastLoginAt: now,
          });
        }
        for (const user of state.users) user.ownerEmail = owner.email;
        state.enabled = true;
        state.activeUserId = state.users.find((user) => user.role === 'admin')!.id;
      },
      prepare(input: { owner: LocalUsersOwner; pin: string }) {
        return {
          payload: {
            owner: input.owner,
            adminId: `lu_${nanoid(10)}`,
            now: new Date().toISOString(),
            ...credentialsFor(input.pin),
          },
        };
      },
    },

    /** Turns user control off (single-user mode). The directory is kept for re-enabling. */
    disableLocalUsers(state) {
      state.enabled = false;
      state.activeUserId = null;
    },

    addLocalUser: {
      reducer(
        state,
        action: PayloadAction<Omit<LocalUser, 'ownerEmail' | 'role' | 'isActive' | 'updatedAt'>>,
      ) {
        if (!state.enabled || !state.owner) return;
        const input = action.payload;
        if (!input.displayName || !input.username) return;
        if (findUsernameConflict(state.users, input.username)) return;
        state.users.push({
          ...input,
          role: 'user',
          ownerEmail: state.owner.email,
          isActive: true,
          updatedAt: input.createdAt,
        });
      },
      prepare(input: NewLocalUserInput) {
        return {
          payload: {
            id: `lu_${nanoid(10)}`,
            displayName: input.displayName.trim(),
            username: normalizeUsername(input.username),
            permissions: normalizePermissions(input.permissions),
            createdAt: new Date().toISOString(),
            ...credentialsFor(input.pin),
          },
        };
      },
    },

    updateLocalUser: {
      reducer(state, action: PayloadAction<LocalUserUpdate & { now: string }>) {
        const { id, now, ...changes } = action.payload;
        const user = state.users.find((item) => item.id === id);
        if (!user) return;
        if (changes.displayName !== undefined && changes.displayName.trim()) {
          user.displayName = changes.displayName.trim();
        }
        if (
          changes.username !== undefined &&
          changes.username.trim() &&
          !findUsernameConflict(state.users, changes.username, id)
        ) {
          user.username = normalizeUsername(changes.username);
        }
        // The admin always has full access and can never be deactivated.
        if (user.role !== 'admin') {
          if (changes.permissions) user.permissions = normalizePermissions(changes.permissions);
          if (changes.isActive !== undefined) {
            user.isActive = changes.isActive;
            if (!user.isActive && state.activeUserId === id) state.activeUserId = null;
          }
        }
        user.updatedAt = now;
      },
      prepare(update: LocalUserUpdate) {
        return { payload: { ...update, now: new Date().toISOString() } };
      },
    },

    resetLocalUserPin: {
      reducer(state, action: PayloadAction<{ id: string; now: string } & PinCredentials>) {
        const user = state.users.find((item) => item.id === action.payload.id);
        if (!user) return;
        user.pinHash = action.payload.pinHash;
        user.pinSalt = action.payload.pinSalt;
        user.updatedAt = action.payload.now;
      },
      prepare(input: { id: string; pin: string }) {
        return { payload: { id: input.id, now: new Date().toISOString(), ...credentialsFor(input.pin) } };
      },
    },

    deleteLocalUser(state, action: PayloadAction<string>) {
      const user = state.users.find((item) => item.id === action.payload);
      if (!user || user.role === 'admin') return;
      state.users = state.users.filter((item) => item.id !== action.payload);
      if (state.activeUserId === action.payload) state.activeUserId = null;
    },

    /** PIN (or owner Google account) verified — start a session. */
    localSessionStarted(state, action: PayloadAction<{ userId: string; at: string; method: 'pin' | 'google' }>) {
      const user = state.users.find((item) => item.id === action.payload.userId);
      if (!state.enabled || !user || !user.isActive) return;
      state.activeUserId = user.id;
      user.lastLoginAt = action.payload.at;
    },

    /** Wrong PIN — no state change; recorded by the audit log. */
    localLoginFailed(_state, _action: PayloadAction<{ userId: string; at: string }>) {},

    lockLocalSession(state) {
      state.activeUserId = null;
    },
  },
});

export const {
  enableLocalUsers,
  disableLocalUsers,
  addLocalUser,
  updateLocalUser,
  resetLocalUserPin,
  deleteLocalUser,
  localSessionStarted,
  localLoginFailed,
  lockLocalSession,
} = localUsersSlice.actions;

/**
 * Verifies a PIN and starts the session. Returns whether it unlocked.
 * (A plain thunk so the PIN never travels inside an action.)
 */
export const unlockLocalUser =
  (userId: string, pin: string) =>
  (
    dispatch: (action: ReturnType<typeof localSessionStarted> | ReturnType<typeof localLoginFailed>) => unknown,
    getState: () => { localUsers: LocalUsersState },
  ): boolean => {
    const { localUsers } = getState();
    const user = localUsers.users.find((item) => item.id === userId);
    const at = new Date().toISOString();
    if (!localUsers.enabled || !user || !user.isActive) return false;
    if (!verifyPin(pin, user)) {
      dispatch(localLoginFailed({ userId, at }));
      return false;
    }
    dispatch(localSessionStarted({ userId, at, method: 'pin' }));
    return true;
  };

export default localUsersSlice.reducer;
