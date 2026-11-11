// Local users — directory linked to the Gmail owner, PIN sessions, admin rules.

import { configureStore } from '@reduxjs/toolkit';
import localUsersReducer, {
  addLocalUser,
  deleteLocalUser,
  disableLocalUsers,
  enableLocalUsers,
  lockLocalSession,
  resetLocalUserPin,
  unlockLocalUser,
  updateLocalUser,
} from '@/store/slices/localUsersSlice';
import { hashPin, verifyPin } from '@/services/localUsers/pinHash';

const OWNER = { googleUserId: 'g-1', email: 'Owner@Gmail.com', name: 'Jorge Owner' };

const makeStore = () => configureStore({ reducer: { localUsers: localUsersReducer } });

const enabledStore = () => {
  const store = makeStore();
  store.dispatch(enableLocalUsers({ owner: OWNER, pin: '1234' }));
  return store;
};

const admin = (store: ReturnType<typeof makeStore>) =>
  store.getState().localUsers.users.find((user) => user.role === 'admin')!;

const byUsername = (store: ReturnType<typeof makeStore>, username: string) =>
  store.getState().localUsers.users.find((user) => user.username === username);

const unlock = (store: ReturnType<typeof makeStore>, userId: string, pin: string) =>
  unlockLocalUser(userId, pin)(store.dispatch, store.getState);

describe('pin hashing', () => {
  it('salts, never stores the PIN and verifies', () => {
    const hash = hashPin('1234', 'salt-a');
    expect(hash).not.toContain('1234');
    expect(hashPin('1234', 'salt-b')).not.toBe(hash);
    expect(verifyPin('1234', { pinHash: hash, pinSalt: 'salt-a' })).toBe(true);
    expect(verifyPin('4321', { pinHash: hash, pinSalt: 'salt-a' })).toBe(false);
  });
});

describe('enableLocalUsers', () => {
  it('makes the Gmail account the admin and starts its session', () => {
    const store = enabledStore();
    const state = store.getState().localUsers;
    expect(state.enabled).toBe(true);
    expect(state.owner?.email).toBe(OWNER.email);
    expect(state.users).toHaveLength(1);
    expect(admin(store)).toMatchObject({ role: 'admin', displayName: 'Jorge Owner', username: 'owner', ownerEmail: OWNER.email });
    expect(state.activeUserId).toBe(admin(store).id);
    expect(JSON.stringify(state)).not.toContain('"1234"');
  });

  it('re-enabling for the same owner keeps users and the admin id; another account starts fresh', () => {
    const store = enabledStore();
    const adminId = admin(store).id;
    store.dispatch(addLocalUser({ displayName: 'Ana', username: 'ana', pin: '5555', permissions: ['pos.sell'] }));
    store.dispatch(disableLocalUsers());
    expect(store.getState().localUsers.enabled).toBe(false);
    expect(store.getState().localUsers.activeUserId).toBeNull();

    store.dispatch(enableLocalUsers({ owner: { ...OWNER, email: 'owner@gmail.com' }, pin: '9999' }));
    expect(admin(store).id).toBe(adminId);
    expect(byUsername(store, 'ana')).toBeDefined();
    expect(unlock(store, adminId, '9999')).toBe(true);

    store.dispatch(enableLocalUsers({ owner: { googleUserId: 'g-2', email: 'other@gmail.com', name: 'Other' }, pin: '1111' }));
    expect(store.getState().localUsers.users).toHaveLength(1);
    expect(admin(store).ownerEmail).toBe('other@gmail.com');
  });
});

describe('managing users', () => {
  it('links every user to the owner account and rejects duplicate usernames', () => {
    const store = enabledStore();
    store.dispatch(addLocalUser({ displayName: 'Ana Pérez', username: 'Ana', pin: '5555', permissions: ['pos.sell', 'bogus' as never] }));
    store.dispatch(addLocalUser({ displayName: 'Otra Ana', username: 'ana', pin: '6666', permissions: ['dashboard'] }));
    const users = store.getState().localUsers.users;
    expect(users).toHaveLength(2);
    expect(byUsername(store, 'ana')).toMatchObject({ role: 'user', ownerEmail: OWNER.email, permissions: ['pos.sell'], isActive: true });
  });

  it('ignores adds while user control is off', () => {
    const store = makeStore();
    store.dispatch(addLocalUser({ displayName: 'Ana', username: 'ana', pin: '5555', permissions: ['pos.sell'] }));
    expect(store.getState().localUsers.users).toHaveLength(0);
  });

  it('the admin can never be deactivated, restricted or deleted', () => {
    const store = enabledStore();
    const adminId = admin(store).id;
    store.dispatch(updateLocalUser({ id: adminId, isActive: false, permissions: ['chat'] }));
    store.dispatch(deleteLocalUser(adminId));
    expect(admin(store)).toMatchObject({ id: adminId, isActive: true, permissions: [] });
  });

  it('deactivating or deleting the signed-in user locks the session', () => {
    const store = enabledStore();
    store.dispatch(addLocalUser({ displayName: 'Ana', username: 'ana', pin: '5555', permissions: ['pos.sell'] }));
    const ana = byUsername(store, 'ana')!;
    expect(unlock(store, ana.id, '5555')).toBe(true);
    store.dispatch(updateLocalUser({ id: ana.id, isActive: false }));
    expect(store.getState().localUsers.activeUserId).toBeNull();
    expect(unlock(store, ana.id, '5555')).toBe(false);

    store.dispatch(updateLocalUser({ id: ana.id, isActive: true }));
    expect(unlock(store, ana.id, '5555')).toBe(true);
    store.dispatch(deleteLocalUser(ana.id));
    expect(store.getState().localUsers.activeUserId).toBeNull();
  });
});

describe('sessions', () => {
  it('unlocks only with the right PIN and records the login time', () => {
    const store = enabledStore();
    store.dispatch(addLocalUser({ displayName: 'Ana', username: 'ana', pin: '5555', permissions: ['pos.sell'] }));
    store.dispatch(lockLocalSession());
    const ana = byUsername(store, 'ana')!;

    expect(unlock(store, ana.id, '0000')).toBe(false);
    expect(store.getState().localUsers.activeUserId).toBeNull();
    expect(unlock(store, ana.id, '5555')).toBe(true);
    expect(store.getState().localUsers.activeUserId).toBe(ana.id);
    expect(byUsername(store, 'ana')!.lastLoginAt).toBeDefined();
  });

  it('a reset PIN replaces the old one', () => {
    const store = enabledStore();
    store.dispatch(addLocalUser({ displayName: 'Ana', username: 'ana', pin: '5555', permissions: ['pos.sell'] }));
    const ana = byUsername(store, 'ana')!;
    store.dispatch(resetLocalUserPin({ id: ana.id, pin: '7777' }));
    expect(unlock(store, ana.id, '5555')).toBe(false);
    expect(unlock(store, ana.id, '7777')).toBe(true);
  });
});
