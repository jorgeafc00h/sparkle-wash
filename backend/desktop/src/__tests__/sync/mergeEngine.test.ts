// Same fixture file as App.ReactNative (byte-identical copy) — the cross-platform contract.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const conformance = require('./fixtures/merge-conformance.json');
import {
  compareVersions,
  deepEqual,
  invoiceStatusRank,
  isAcknowledgedInvoice,
  mergeChange,
  mergeInvoice,
  mergeLww,
  purchaseDedupeKey,
  RemoteChange,
  SyncEntity,
  VersionMeta,
} from '@/services/sync/mergeEngine';
import type { SyncEntityType } from '@/services/sync/protocol';

interface ConformanceCase {
  name: string;
  type: SyncEntityType;
  local: SyncEntity | null;
  localMeta: VersionMeta | null;
  remote: RemoteChange;
  expect: {
    kind: 'upsert' | 'delete' | 'skip';
    reason?: string;
    entity?: Record<string, unknown>;
    version?: { u: string; d: string };
    conflictFields: string[];
  };
}

const cases = conformance.cases as ConformanceCase[];

describe('mergeEngine — cross-platform conformance set', () => {
  it('ships a non-trivial shared fixture', () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
  });

  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
    const decision = mergeChange(
      testCase.type,
      testCase.local ?? undefined,
      testCase.localMeta ?? undefined,
      testCase.remote,
      conformance.selfDeviceId,
    );

    expect(decision.kind).toBe(testCase.expect.kind);
    expect(decision.conflicts.map(c => c.field).sort()).toEqual([...testCase.expect.conflictFields].sort());

    if (decision.kind === 'skip') {
      expect(decision.reason).toBe(testCase.expect.reason);
    }
    if (decision.kind === 'upsert') {
      expect(decision.entity).toMatchObject(testCase.expect.entity ?? {});
      expect(decision.version).toEqual(testCase.expect.version);
      // The stored entity always carries the version timestamp it was merged at.
      expect(decision.entity.updatedAt).toBe(decision.version.u);
    }
    if (decision.kind === 'delete') {
      expect(decision.version).toEqual(testCase.expect.version);
    }
  });
});

describe('mergeEngine — properties', () => {
  it('orders versions by time, then deviceId', () => {
    expect(compareVersions({ u: '2026-09-24T10:00:00.000Z', d: 'a' }, { u: '2026-09-24T09:00:00.000Z', d: 'z' })).toBe(1);
    expect(compareVersions({ u: '2026-09-24T10:00:00.000Z', d: 'a' }, { u: '2026-09-24T10:00:00.000Z', d: 'b' })).toBe(-1);
    expect(compareVersions({ u: '2026-09-24T10:00:00.000Z', d: 'b' }, { u: '2026-09-24T10:00:00.000Z', d: 'b' })).toBe(0);
    // Unparseable timestamps sort lowest instead of throwing.
    expect(compareVersions({ u: 'garbage', d: 'z' }, { u: '2026-01-01T00:00:00.000Z', d: 'a' })).toBe(-1);
  });

  it('converges on the same winner regardless of delivery order (LWW tie)', () => {
    const a = { id: 'x', name: 'from-a', updatedAt: '2026-09-24T10:00:00.000Z' };
    const b = { id: 'x', name: 'from-b', updatedAt: '2026-09-24T10:00:00.000Z' };
    // Device A holds a, receives b.
    const onA = mergeLww(a, { u: a.updatedAt, d: 'dev-a' }, { op: 'upsert', u: b.updatedAt, d: 'dev-b', entity: b }, 'dev-a');
    // Device B holds b, receives a.
    const onB = mergeLww(b, { u: b.updatedAt, d: 'dev-b' }, { op: 'upsert', u: a.updatedAt, d: 'dev-a', entity: a }, 'dev-b');
    const finalA = onA.kind === 'upsert' ? onA.entity : a;
    const finalB = onB.kind === 'upsert' ? onB.entity : b;
    expect(finalA.name).toBe('from-b');
    expect(finalB.name).toBe('from-b');
  });

  it('converges on the higher lattice state for acknowledged invoices in both directions', () => {
    const completada = { id: 'i', status: 2, receptionSeal: 'S', generationCode: 'G', items: [], updatedAt: '2026-09-24T13:10:00.000Z' };
    const anulada = { id: 'i', status: 3, receptionSeal: 'S', generationCode: 'G', items: [], updatedAt: '2026-09-24T13:00:00.000Z' };
    const onA = mergeInvoice(completada, undefined, { op: 'upsert', u: anulada.updatedAt, d: 'dev-b', entity: anulada }, 'dev-a');
    const onB = mergeInvoice(anulada, undefined, { op: 'upsert', u: completada.updatedAt, d: 'dev-a', entity: completada }, 'dev-b');
    expect(onA.kind).toBe('upsert');
    expect(onB.kind).toBe('upsert');
    if (onA.kind === 'upsert' && onB.kind === 'upsert') {
      expect(onA.entity.status).toBe(3);
      expect(onB.entity.status).toBe(3);
      expect(onA.version.u).toBe(onB.version.u);
    }
  });

  it('is idempotent: re-applying the same remote version is a no-op', () => {
    const remote = { id: 'c', name: 'n', updatedAt: '2026-09-24T10:00:00.000Z' };
    const first = mergeLww(undefined, undefined, { op: 'upsert', u: remote.updatedAt, d: 'p', entity: remote }, 'self');
    expect(first.kind).toBe('upsert');
    const again = mergeLww(remote, { u: remote.updatedAt, d: 'p' }, { op: 'upsert', u: remote.updatedAt, d: 'p', entity: remote }, 'self');
    expect(again).toMatchObject({ kind: 'skip', reason: 'stale' });
  });

  it('ranks statuses with only acknowledged states protected', () => {
    expect(invoiceStatusRank(0)).toBe(0);
    expect(invoiceStatusRank(1)).toBe(0);
    expect(invoiceStatusRank(4)).toBe(0);
    expect(invoiceStatusRank(5)).toBe(0);
    expect(invoiceStatusRank(2)).toBe(2);
    expect(invoiceStatusRank(3)).toBe(3);
    expect(isAcknowledgedInvoice({ id: 'x', status: 0, receptionSeal: 'SEAL' })).toBe(true);
    expect(isAcknowledgedInvoice({ id: 'x', status: 1 })).toBe(false);
  });

  it('derives purchase dedupe keys codigoGeneracion → numeroControl', () => {
    expect(purchaseDedupeKey({ id: 'a', codigoGeneracion: ' abc-1 ', numeroControl: 'N' })).toBe('cg:ABC-1');
    expect(purchaseDedupeKey({ id: 'a', codigoGeneracion: '', numeroControl: 'dte-03-1' })).toBe('nc:DTE-03-1');
    expect(purchaseDedupeKey({ id: 'a' })).toBeUndefined();
  });

  it('compares plain data structurally, ignoring undefined keys', () => {
    expect(deepEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
  });
});
