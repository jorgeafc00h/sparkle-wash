import { CARWASH_OUTBOX_KEY, CarwashOutbox } from '@/services/carwash/CarwashOutbox';
import { FakeClient, asClient, httpError, makeJob, memoryStorage } from './testUtils';

function setup() {
  const storage = memoryStorage();
  let n = 0;
  const make = () => new CarwashOutbox({ storage, uuid: () => `id-${++n}`, now: () => new Date('2026-11-11T12:00:00Z') });
  return { storage, outbox: make(), make, client: new FakeClient() };
}

const walkIn = (plate: string, local: string) => ({
  kind: 'walk-in' as const,
  localJobId: local,
  input: { plate, vehicleClass: 'sedan', packageId: 'basic', ticketNumber: `OT-C1-${plate}` },
});

describe('CarwashOutbox', () => {
  it('replays entries in seq order with their idempotency keys', async () => {
    const { outbox, client } = setup();
    client.jobs.push(makeJob({ id: 'j1', status: 'queued' }));
    await outbox.enqueue({ kind: 'transition', jobId: 'j1', status: 'in_progress' });
    await outbox.enqueue({ kind: 'transition', jobId: 'j1', status: 'completed' });
    await outbox.enqueue({ kind: 'payment', jobId: 'j1', payment: { method: 'cash', amountUsd: 12.5 } });
    const res = await outbox.flush(asClient(client));
    expect(res).toMatchObject({ sent: 3, stopped: null, remaining: 0 });
    expect(client.calls.map((c) => c.method)).toEqual(['transitionJob', 'transitionJob', 'recordPayment']);
    const keys = client.calls.map((c) => c.args[c.args.length - 1] as string);
    expect(new Set(keys).size).toBe(3);
    expect(res.jobs[0].paymentStatus).toBe('paid');
  });

  it('keeps everything on a network error and resumes later', async () => {
    const { outbox, client } = setup();
    client.jobs.push(makeJob({ id: 'j1', status: 'queued' }));
    await outbox.enqueue({ kind: 'transition', jobId: 'j1', status: 'in_progress' });
    await outbox.enqueue({ kind: 'transition', jobId: 'j1', status: 'completed' });
    client.online = false;
    const offline = await outbox.flush(asClient(client));
    expect(offline).toMatchObject({ sent: 0, stopped: 'network', remaining: 2 });
    expect((await outbox.list())[0].attempts).toBe(1);
    client.online = true;
    expect(await outbox.flush(asClient(client))).toMatchObject({ sent: 2, stopped: null, remaining: 0 });
  });

  it('stops on 401 without discarding or failing the entry', async () => {
    const { outbox, client } = setup();
    client.jobs.push(makeJob({ id: 'j1', status: 'queued' }));
    await outbox.enqueue({ kind: 'transition', jobId: 'j1', status: 'in_progress' });
    client.failNext.transitionJob = httpError(401);
    const res = await outbox.flush(asClient(client));
    expect(res).toMatchObject({ sent: 0, stopped: 'unauthorized', remaining: 1 });
    const [entry] = await outbox.list();
    expect(entry.failed).toBeFalsy();
  });

  it('marks 4xx entries failed (kept, visible) and continues with the rest', async () => {
    const { outbox, client } = setup();
    client.jobs.push(makeJob({ id: 'j1', status: 'queued' }), makeJob({ id: 'j2', status: 'queued', plate: 'Z' }));
    await outbox.enqueue({ kind: 'transition', jobId: 'j1', status: 'completed' });
    await outbox.enqueue({ kind: 'transition', jobId: 'j2', status: 'in_progress' });
    client.failNext.transitionJob = httpError(409, { error: 'Invalid transition' });
    const res = await outbox.flush(asClient(client));
    expect(res.sent).toBe(1);
    expect(res.failed).toHaveLength(1);
    expect(res.remaining).toBe(0);
    const [failed] = await outbox.failedEntries();
    expect(failed).toMatchObject({ failed: true, lastError: 'Invalid transition' });
    // A later flush does not retry failed entries until asked to.
    await outbox.flush(asClient(client));
    expect(client.calls).toHaveLength(2);
    await outbox.retryFailed(failed.id);
    expect((await outbox.flush(asClient(client))).sent).toBe(1);
  });

  it('remaps local ids in later queued ops and returns the mapping', async () => {
    const { outbox, client } = setup();
    await outbox.enqueue(walkIn('ABC1', 'local-1'));
    await outbox.enqueue({ kind: 'transition', jobId: 'local-1', status: 'queued' });
    await outbox.enqueue({ kind: 'payment', jobId: 'local-1', payment: { method: 'cash', amountUsd: 12.5 } });
    // Make the transition legal for the fake server (arrived → queued is not validated there).
    const res = await outbox.flush(asClient(client));
    expect(res.idMap).toEqual({ 'local-1': 'srv-w1' });
    expect(client.calls.map((c) => [c.method, c.args[0]])).toEqual([
      ['createWalkIn', expect.objectContaining({ plate: 'ABC1' })],
      ['transitionJob', 'srv-w1'],
      ['recordPayment', 'srv-w1'],
    ]);
    expect(await outbox.resolveJobId('local-1')).toBe('srv-w1');
    // An op enqueued afterwards for the same local id is rewritten on the way in.
    const late = await outbox.enqueue({ kind: 'ticket', jobId: 'local-1', ticketNumber: 'X-1' });
    expect(late.op).toMatchObject({ jobId: 'srv-w1' });
  });

  it('fails ops that depend on a walk-in that failed', async () => {
    const { outbox, client } = setup();
    await outbox.enqueue(walkIn('BAD', 'local-9'));
    await outbox.enqueue({ kind: 'transition', jobId: 'local-9', status: 'queued' });
    client.failNext.createWalkIn = httpError(400, { error: 'Invalid plate' });
    const res = await outbox.flush(asClient(client));
    expect(res.failed).toHaveLength(2);
    expect(client.calls).toHaveLength(1);
  });

  it('treats a 409 whose job carries this walk-in\'s ticket AND plate as success', async () => {
    const { outbox, client } = setup();
    client.jobs.push(makeJob({ id: 'srv-existing', plate: 'ABC1', status: 'queued', ticketNumber: 'OT-C1-ABC1' }));
    await outbox.enqueue(walkIn('ABC1', 'local-1'));
    await outbox.enqueue({ kind: 'transition', jobId: 'local-1', status: 'in_progress' });
    const res = await outbox.flush(asClient(client));
    expect(res.failed).toEqual([]);
    expect(res.idMap).toEqual({ 'local-1': 'srv-existing' });
    expect(client.calls[1].args[0]).toBe('srv-existing');
  });

  it('treats a 409 whose job was opened with this entry\'s idempotency key as success', async () => {
    const { outbox, client } = setup();
    const entry = await outbox.enqueue(walkIn('ABC1', 'local-1'));
    client.failNext.createWalkIn = httpError(409, {
      error: 'reused',
      job: makeJob({ id: 'srv-mine', plate: 'ABC1', transitions: [{ status: 'arrived', at: 'x', actor: 'a', idempotencyKey: entry.idempotencyKey }] }),
    });
    const res = await outbox.flush(asClient(client));
    expect(res.failed).toEqual([]);
    expect(res.idMap).toEqual({ 'local-1': 'srv-mine' });
  });

  it('fails a 409 for another open job of the same plate (stale camera job) instead of adopting it', async () => {
    const { outbox, client } = setup();
    client.jobs.push(makeJob({ id: 'srv-stale', plate: 'ABC1', status: 'queued', ticketNumber: null, packageId: 'quick' }));
    await outbox.enqueue(walkIn('ABC1', 'local-1'));
    await outbox.enqueue({ kind: 'payment', jobId: 'local-1', payment: { method: 'cash', amountUsd: 35 } });
    const res = await outbox.flush(asClient(client));
    expect(res.idMap).toEqual({});
    expect(res.failed.map((e) => e.op.kind)).toEqual(['walk-in', 'payment']);
    expect(client.calls.filter((c) => c.method === 'recordPayment')).toHaveLength(0);
  });

  it('only sends the signed-in scope\'s entries and claims unscoped ones', async () => {
    const { outbox, client } = setup();
    client.jobs.push(makeJob({ id: 'j1', status: 'queued' }), makeJob({ id: 'j2', status: 'queued', plate: 'Z' }));
    await outbox.enqueue({ kind: 'transition', jobId: 'j1', status: 'in_progress' }, 'http://api|tenant-a');
    await outbox.enqueue({ kind: 'transition', jobId: 'j2', status: 'in_progress' }, null);
    const asB = await outbox.flush(asClient(client), 'http://api|tenant-b');
    expect(asB).toMatchObject({ sent: 1, remaining: 0 });
    expect(client.calls.map((c) => c.args[0])).toEqual(['j2']);
    expect(await outbox.pendingCount('http://api|tenant-b')).toBe(0);
    expect(await outbox.pendingCount('http://api|tenant-a')).toBe(1);
    const asA = await outbox.flush(asClient(client), 'http://api|tenant-a');
    expect(asA).toMatchObject({ sent: 1, remaining: 0 });
    expect(client.calls.map((c) => c.args[0])).toEqual(['j2', 'j1']);
  });

  it('does not wipe the stored queue when the first storage read fails', async () => {
    const { storage, make, client } = setup();
    client.jobs.push(makeJob({ id: 'j1', status: 'queued' }));
    const first = make();
    await first.enqueue({ kind: 'transition', jobId: 'j1', status: 'in_progress' });
    let failures = 1;
    const flakyStorage = {
      getItem: (k: string) => (failures-- > 0 ? Promise.reject(new Error('ipc')) : storage.getItem(k)),
      setItem: storage.setItem,
    };
    const reopened = new CarwashOutbox({ storage: flakyStorage, uuid: () => `r-${Math.random()}` });
    await expect(reopened.enqueue({ kind: 'transition', jobId: 'j1', status: 'completed' })).rejects.toThrow('ipc');
    await reopened.enqueue({ kind: 'transition', jobId: 'j1', status: 'completed' });
    expect((await reopened.list()).map((e) => (e.op as { status: string }).status)).toEqual(['in_progress', 'completed']);
  });

  it('keeps a copy of a corrupt outbox before starting empty', async () => {
    const { storage, make } = setup();
    storage.map.set(CARWASH_OUTBOX_KEY, '{not json');
    const outbox = make();
    expect(await outbox.list()).toEqual([]);
    expect(storage.map.get(`${CARWASH_OUTBOX_KEY}.corrupt`)).toBe('{not json');
  });

  it('fails a 409 whose job is a different vehicle and ticket', async () => {
    const { outbox, client } = setup();
    client.failNext.createWalkIn = httpError(409, { error: 'reused', job: makeJob({ id: 'other', plate: 'ZZZ', ticketNumber: 'OT-C1-9' }) });
    await outbox.enqueue(walkIn('ABC1', 'local-1'));
    const res = await outbox.flush(asClient(client));
    expect(res.failed).toHaveLength(1);
    expect(res.idMap).toEqual({});
  });

  it('retries server errors (5xx) later instead of failing them', async () => {
    const { outbox, client } = setup();
    client.jobs.push(makeJob({ id: 'j1', status: 'queued' }));
    await outbox.enqueue({ kind: 'transition', jobId: 'j1', status: 'in_progress' });
    client.failNext.transitionJob = httpError(503);
    expect(await outbox.flush(asClient(client))).toMatchObject({ stopped: 'server', remaining: 1 });
    expect((await outbox.flush(asClient(client))).sent).toBe(1);
  });

  it('survives a restart (persistence round trip incl. failed entries and id map)', async () => {
    const { outbox, make, client, storage } = setup();
    client.jobs.push(makeJob({ id: 'j1', status: 'queued' }));
    await outbox.enqueue(walkIn('ABC1', 'local-1'));
    await outbox.enqueue({ kind: 'transition', jobId: 'j1', status: 'in_progress' });
    client.online = false;
    await outbox.flush(asClient(client));
    expect(storage.map.has(CARWASH_OUTBOX_KEY)).toBe(true);

    const reloaded = make();
    const entries = await reloaded.list();
    expect(entries.map((e) => [e.seq, e.op.kind, e.attempts])).toEqual([[1, 'walk-in', 1], [2, 'transition', 0]]);
    expect((await reloaded.enqueue({ kind: 'transition', jobId: 'j1', status: 'completed' })).seq).toBe(3);
    client.online = true;
    const res = await reloaded.flush(asClient(client));
    expect(res.idMap).toEqual({ 'local-1': 'srv-w1' });
    expect(await make().resolveJobId('local-1')).toBe('srv-w1');
  });

  it('a flush requested mid-flight still sends entries enqueued meanwhile', async () => {
    const { outbox, client } = setup();
    client.jobs.push(makeJob({ id: 'j1', status: 'queued' }));
    await outbox.enqueue({ kind: 'transition', jobId: 'j1', status: 'in_progress' });
    const first = outbox.flush(asClient(client));
    await outbox.enqueue({ kind: 'transition', jobId: 'j1', status: 'completed' });
    const second = outbox.flush(asClient(client));
    await Promise.all([first, second]);
    expect(client.calls).toHaveLength(2);
    expect(await outbox.pendingCount()).toBe(0);
  });
});
