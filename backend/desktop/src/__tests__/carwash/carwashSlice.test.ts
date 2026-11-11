// carwashSlice with a fake API: offline-first walk-ins, optimistic writes, rollback.

jest.mock('@/services/storage/ElectronStorage', () => {
  const map = new Map<string, string>();
  return {
    __map: map,
    appStorage: {
      getItem: async (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: async (k: string, v: string) => {
        map.set(k, v);
      },
      removeItem: async (k: string) => {
        map.delete(k);
      },
    },
  };
});

import { configureStore } from '@reduxjs/toolkit';
import { CarwashOutbox } from '@/services/carwash/CarwashOutbox';
import { nextWorkTicketNumber } from '@/services/carwash/workTicketNumber';
import reducer, {
  __setCarwashDepsForTests,
  assignJobEmployee,
  attachJobTicket,
  createWalkInJob,
  flushCarwashOutbox,
  getCarwashSyncService,
  initCarwash,
  recordJobPayment,
  refreshCarwash,
  saveCarwashSettings,
  selectCarwashJobById,
  selectCarwashJobs,
  selectCarwashJobsByStatus,
  selectCarwashSession,
  selectCarwashSyncStatus,
  selectUnpaidCarwashJobs,
  signInCarwash,
  signInCarwashWithToken,
  signOutCarwash,
  transitionJob,
} from '@/store/slices/carwashSlice';
import { FakeClient, asClient, httpError, makeJob, memoryStorage } from './testUtils';

const storageMock = jest.requireMock('@/services/storage/ElectronStorage') as { __map: Map<string, string> };

function setup(opts: { googleToken?: string | null } = {}) {
  storageMock.__map.clear();
  const client = new FakeClient();
  const outboxStorage = memoryStorage();
  const counters = memoryStorage();
  let n = 0;
  const outbox = new CarwashOutbox({ storage: outboxStorage, uuid: () => `u${++n}` });
  const stream = { opens: 0 };
  __setCarwashDepsForTests({
    client: asClient(client),
    outbox,
    nextTicket: (code) => nextWorkTicketNumber(code, counters),
    uuid: () => `u${++n}`,
    getGoogleIdToken: async () => (opts.googleToken === undefined ? 'dev:s1:a@b.c' : opts.googleToken),
    openStream: () => {
      stream.opens += 1;
      return { close: () => undefined };
    },
  });
  const store = configureStore({ reducer: { carwash: reducer }, middleware: (gdm) => gdm({ serializableCheck: false, immutableCheck: false }) });
  return { store, client, outbox, stream };
}

afterEach(() => {
  getCarwashSyncService()?.stop(false);
  __setCarwashDepsForTests(null);
});

async function signedInStore() {
  const ctx = setup();
  ctx.client.jobs.push(makeJob({ id: 'srv-1', status: 'queued', priceUsd: 12.5 }));
  await ctx.store.dispatch(signInCarwashWithToken('dev:s1:a@b.c'));
  // initial sync (flush + refresh) is awaited inside start(); give it a tick
  await new Promise((r) => setTimeout(r, 10));
  return ctx;
}

describe('carwashSlice', () => {
  it('signs in with a dev token, loads catalog/jobs/employees and persists the session', async () => {
    const { store, client } = await signedInStore();
    const state = store.getState();
    expect(selectCarwashSession(state)).toMatchObject({ sessionToken: 'tok', role: 'operator', email: 'a@b.c' });
    expect(client.token).toBe('tok');
    expect(state.carwash.packages?.packages).toHaveLength(1);
    expect(state.carwash.employees).toHaveLength(1);
    expect(selectCarwashJobs(state).map((j) => j.id)).toEqual(['srv-1']);
    expect(selectCarwashSyncStatus(state).state).not.toBe('signed-out');
    expect(JSON.stringify([...storageMock.__map.entries()])).toContain('carwash_session');
  });

  it('signInCarwash exchanges the Google token; failures surface a Spanish message', async () => {
    const ctx = setup();
    const ok = await ctx.store.dispatch(signInCarwash());
    expect(ok.type).toBe('carwash/signIn/fulfilled');
    expect(selectCarwashSession(ctx.store.getState())).not.toBeNull();

    const bad = setup({ googleToken: null });
    const res = await bad.store.dispatch(signInCarwash());
    expect(res.type).toBe('carwash/signIn/rejected');
    expect(bad.store.getState().carwash.error).toMatch(/Google/);
  });

  it('signOutCarwash clears the session and server data but keeps unsent local jobs', async () => {
    const { store, client } = await signedInStore();
    client.online = false;
    await store.dispatch(createWalkInJob({ plate: 'ZZ1', vehicleClass: 'sedan', packageId: 'basic' }));
    client.online = true;
    await store.dispatch(signOutCarwash());
    expect(selectCarwashSession(store.getState())).toBeNull();
    expect(selectCarwashJobs(store.getState()).map((j) => j.plate)).toEqual(['ZZ1']);
    expect(selectCarwashSyncStatus(store.getState()).state).toBe('signed-out');
  });

  it('initCarwash restores a saved session and settings', async () => {
    const first = await signedInStore();
    await first.store.dispatch(saveCarwashSettings({ registerCode: 'b2', pollSeconds: 30 }));
    getCarwashSyncService()?.stop(false);
    // New store, same persisted storage = app restart.
    const store = configureStore({ reducer: { carwash: reducer }, middleware: (gdm) => gdm({ serializableCheck: false, immutableCheck: false }) });
    await store.dispatch(initCarwash());
    expect(store.getState().carwash.initialized).toBe(true);
    expect(store.getState().carwash.settings).toMatchObject({ registerCode: 'B2', pollSeconds: 30 });
    expect(selectCarwashSession(store.getState())?.sessionToken).toBe('tok');
  });

  describe('offline-first walk-in', () => {
    it('assigns the ticket, creates a local job and syncs it later, replacing the local copy', async () => {
      const { store, client, outbox } = await signedInStore();
      client.online = false;
      const job = await store
        .dispatch(createWalkInJob({ plate: 'abc-123', vehicleClass: 'sedan', packageId: 'basic', employeeId: 'e1', customerName: 'Luis' }))
        .unwrap();
      expect(job.id.startsWith('local-')).toBe(true);
      expect(job).toMatchObject({ plate: 'ABC123', ticketNumber: 'OT-C1-000001', priceUsd: 12.5, packageName: 'Básico', pendingSync: true });
      expect(job.assignments[0].employeeName).toBe('Ana');
      expect(await outbox.pendingCount()).toBe(1);
      expect(selectCarwashJobs(store.getState()).some((j) => j.id === job.id)).toBe(true);

      // A follow-up change on the local job is queued against the local id.
      await store.dispatch(transitionJob({ jobId: job.id, status: 'queued' })).unwrap();
      expect(await outbox.pendingCount()).toBe(2);

      client.online = true;
      await store.dispatch(flushCarwashOutbox());
      const jobs = selectCarwashJobs(store.getState());
      expect(jobs.find((j) => j.id === job.id)).toBeUndefined();
      const synced = jobs.find((j) => j.plate === 'ABC123')!;
      expect(synced.id).toBe('srv-w1');
      expect(synced).toMatchObject({ pendingSync: false, ticketNumber: 'OT-C1-000001', status: 'queued' });
      expect(await outbox.pendingCount()).toBe(0);
      expect(client.calls.find((c) => c.method === 'transitionJob')!.args[0]).toBe('srv-w1');
    });

    it('resolves with the server copy when online', async () => {
      const { store } = await signedInStore();
      const job = await store.dispatch(createWalkInJob({ plate: 'N1', vehicleClass: 'sedan', packageId: 'basic' })).unwrap();
      expect(job.id).toBe('srv-w1');
      expect(job.ticketNumber).toBe('OT-C1-000001');
      expect(job.pendingSync).toBe(false);
    });

    it('numbers consecutive walk-ins monotonically and rejects unknown packages / empty plates', async () => {
      const { store } = await signedInStore();
      const a = await store.dispatch(createWalkInJob({ plate: 'A1', vehicleClass: 'sedan', packageId: 'basic' })).unwrap();
      const b = await store.dispatch(createWalkInJob({ plate: 'B1', vehicleClass: 'sedan', packageId: 'basic' })).unwrap();
      expect([a.ticketNumber, b.ticketNumber]).toEqual(['OT-C1-000001', 'OT-C1-000002']);
      const nope = await store.dispatch(createWalkInJob({ plate: 'C1', vehicleClass: 'sedan', packageId: 'nope' }));
      expect(nope.type).toBe('carwash/createWalkIn/rejected');
      const empty = await store.dispatch(createWalkInJob({ plate: ' - ', vehicleClass: 'sedan', packageId: 'basic' }));
      expect(empty.type).toBe('carwash/createWalkIn/rejected');
    });

    it('keeps a rejected walk-in visible with its error', async () => {
      const { store, client } = await signedInStore();
      client.failNext.createWalkIn = httpError(400, { error: 'Invalid plate' });
      const job = await store.dispatch(createWalkInJob({ plate: 'BAD', vehicleClass: 'sedan', packageId: 'basic' })).unwrap();
      expect(job.syncError).toBe('Invalid plate');
      const stored = selectCarwashJobById(job.id)(store.getState())!;
      expect(stored).toMatchObject({ id: job.id, syncError: 'Invalid plate', pendingSync: false });
    });
  });

  describe('optimistic writes', () => {
    it('applies a transition locally while offline and confirms it on flush', async () => {
      const { store, client } = await signedInStore();
      client.online = false;
      const job = await store.dispatch(transitionJob({ jobId: 'srv-1', status: 'in_progress' })).unwrap();
      expect(job).toMatchObject({ status: 'in_progress', pendingSync: true });
      client.online = true;
      await store.dispatch(flushCarwashOutbox());
      expect(selectCarwashJobById('srv-1')(store.getState())).toMatchObject({ status: 'in_progress', pendingSync: false });
    });

    it('rolls back and marks the job when the server rejects the transition', async () => {
      const { store, client, outbox } = await signedInStore();
      client.failNext.transitionJob = httpError(409, { error: 'Transición inválida' });
      const res = await store.dispatch(transitionJob({ jobId: 'srv-1', status: 'in_progress' }));
      expect(res.type).toBe('carwash/transition/rejected');
      expect(res.payload).toBe('Transición inválida');
      expect(selectCarwashJobById('srv-1')(store.getState())).toMatchObject({
        status: 'queued',
        pendingSync: false,
        syncError: 'Transición inválida',
      });
      expect(await outbox.pendingCount()).toBe(0);
      expect(await outbox.failedEntries()).toHaveLength(0);
    });

    it('rejects transitions the workflow does not allow', async () => {
      const { store } = await signedInStore();
      const res = await store.dispatch(transitionJob({ jobId: 'srv-1', status: 'completed' }));
      expect(res.type).toBe('carwash/transition/rejected');
    });

    it('assigns an employee, attaches a ticket and records a payment optimistically', async () => {
      const { store, client } = await signedInStore();
      client.online = false;
      await store.dispatch(assignJobEmployee({ jobId: 'srv-1', employeeId: 'e1' })).unwrap();
      await store.dispatch(attachJobTicket({ jobId: 'srv-1', ticketNumber: 'OT-C1-000077' })).unwrap();
      const partial = await store.dispatch(recordJobPayment({ jobId: 'srv-1', payment: { method: 'cash', amountUsd: 5 } })).unwrap();
      expect(partial).toMatchObject({ paymentStatus: 'partial', paidUsd: 5, ticketNumber: 'OT-C1-000077' });
      expect(partial.assignments[0].employeeName).toBe('Ana');
      expect(selectUnpaidCarwashJobs(store.getState())).toHaveLength(1);
      const paid = await store
        .dispatch(recordJobPayment({ jobId: 'srv-1', payment: { method: 'card', amountUsd: 7.5, ticketNumber: 'C1-000123' } }))
        .unwrap();
      expect(paid).toMatchObject({ paymentStatus: 'paid', paidUsd: 12.5 });
      expect(selectUnpaidCarwashJobs(store.getState())).toHaveLength(0);

      client.online = true;
      client.calls = [];
      await store.dispatch(flushCarwashOutbox());
      const calls = client.calls.map((c) => c.method).filter((m) => ['assignEmployee', 'setJobTicket', 'recordPayment'].includes(m));
      expect(calls).toEqual(['assignEmployee', 'setJobTicket', 'recordPayment', 'recordPayment']);
      expect(selectCarwashJobById('srv-1')(store.getState())).toMatchObject({ paymentStatus: 'paid', pendingSync: false });
    });

    it('rolls back a rejected payment', async () => {
      const { store, client } = await signedInStore();
      client.failNext.recordPayment = httpError(409, { error: 'Job cancelled' });
      const res = await store.dispatch(recordJobPayment({ jobId: 'srv-1', payment: { method: 'cash', amountUsd: 5 } }));
      expect(res.type).toBe('carwash/recordPayment/rejected');
      expect(selectCarwashJobById('srv-1')(store.getState())).toMatchObject({ paidUsd: 0, paymentStatus: 'unpaid', syncError: 'Job cancelled' });
    });
  });

  describe('refresh and selectors', () => {
    it('refresh keeps local pending jobs and an unsent optimistic copy', async () => {
      const { store, client } = await signedInStore();
      client.online = false;
      await store.dispatch(createWalkInJob({ plate: 'L1', vehicleClass: 'sedan', packageId: 'basic' }));
      await store.dispatch(transitionJob({ jobId: 'srv-1', status: 'in_progress' }));
      client.online = true;
      // Direct refresh (no flush): server still says "queued", the optimistic copy must survive.
      await store.dispatch(refreshCarwash());
      const jobs = selectCarwashJobs(store.getState());
      expect(jobs.some((j) => j.plate === 'L1')).toBe(true);
      expect(jobs.find((j) => j.id === 'srv-1')?.status).toBe('in_progress');
    });

    it('groups by status and bounds the cache to 300 server jobs', async () => {
      const ctx = setup();
      for (let i = 0; i < 320; i += 1) {
        ctx.client.jobs.push(makeJob({ id: `j${i}`, plate: `P${i}`, arrivalAt: new Date(2026, 0, 1, 0, 0, i).toISOString(), status: i % 2 ? 'queued' : 'arrived' }));
      }
      await ctx.store.dispatch(signInCarwashWithToken('dev:s1:a@b.c'));
      await new Promise((r) => setTimeout(r, 10));
      const state = ctx.store.getState();
      expect(selectCarwashJobs(state)).toHaveLength(300);
      expect(selectCarwashJobs(state)[0].id).toBe('j319');
      const grouped = selectCarwashJobsByStatus(state);
      expect(grouped.arrived.length + grouped.queued.length).toBe(300);
    });

    it('refresh rejects when signed out', async () => {
      const { store } = setup();
      const res = await store.dispatch(refreshCarwash());
      expect(res.type).toBe('carwash/refresh/rejected');
    });
  });

  it('changing the API URL drops the session (it belongs to another server)', async () => {
    const { store } = await signedInStore();
    await store.dispatch(saveCarwashSettings({ apiBaseUrl: 'http://other.example/' }));
    expect(store.getState().carwash.settings.apiBaseUrl).toBe('http://other.example');
    expect(selectCarwashSession(store.getState())).toBeNull();
  });
});
