import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseArrivals,
  parseJobs,
  parseEmployees,
  parseInventory,
  parseSummary
} from '../src/api/operations.ts';

test('parseArrivals accepts a valid arrivals list', () => {
  const list = parseArrivals([{
    id: 'a1', plateCandidate: null, confidence: null, cameraId: 'cam-1',
    receivedAt: '2026-05-01T10:00:00Z', photoId: null, confirmedPlate: 'ABC',
    vehicleClass: 'car'
  }]);
  assert.equal(list.length, 1);
  assert.equal(list[0].confirmedPlate, 'ABC');
  assert.equal(list[0].vehicleClass, 'car');
});

test('parseArrivals rejects an empty object', () => {
  assert.throws(() => parseArrivals({}), /Invalid operations list/);
});

test('parseArrivals rejects a malformed receivedAt', () => {
  assert.throws(() => parseArrivals([{ receivedAt: 'not-a-date', id: 'a1', cameraId: 'x' }]),
    /Invalid operations list/);
});

test('parseArrivals rejects confidence outside the 0–1 range', () => {
  assert.throws(() => parseArrivals([{ id: 'a1', cameraId: 'x', receivedAt: '2026-05-01T10:00:00Z', confidence: 1.5 }]),
    /Invalid operations list/);
});

test('parseJobs validates a complete job record', () => {
  const jobs = parseJobs([{
    id: 'j1', arrivalId: 'a1', plate: 'ABC', vehicleClass: 'car',
    packageId: 'shower', packageName: 'Shower', priceUsd: 12,
    status: 'queued', arrivalAt: '2026-05-01T10:00:00Z',
    elapsedSeconds: 5, activeSeconds: 3,
    services: ['rinse'],
    assignments: [{ employeeId: 'e1', employeeName: 'Sam' }]
  }]);
  assert.equal(jobs[0].status, 'queued');
  assert.equal(jobs[0].priceUsd, 12);
});

test('parseJobs rejects an unknown status', () => {
  assert.throws(() => parseJobs([{
    id: 'j1', arrivalId: 'a1', plate: 'ABC', vehicleClass: 'car',
    packageId: 'shower', packageName: 'Shower', priceUsd: 12,
    status: 'unknown', arrivalAt: '2026-05-01T10:00:00Z',
    elapsedSeconds: 5, activeSeconds: null, services: [], assignments: []
  }]), /Invalid operations list/);
});

test('parseJobs rejects negative price and elapsedSeconds', () => {
  assert.throws(() => parseJobs([{
    id: 'j1', arrivalId: 'a1', plate: 'ABC', vehicleClass: 'car',
    packageId: 'shower', packageName: 'Shower', priceUsd: -1,
    status: 'arrived', arrivalAt: '2026-05-01T10:00:00Z',
    elapsedSeconds: -5, activeSeconds: null, services: [], assignments: []
  }]), /Invalid operations list/);
});

test('parseEmployees accepts active and inactive staff', () => {
  const list = parseEmployees([
    { id: 'e1', name: 'Sam', active: true },
    { id: 'e2', name: 'Jo', active: false }
  ]);
  assert.equal(list.length, 2);
  assert.equal(list[1].active, false);
});

test('parseEmployees rejects a missing active flag', () => {
  assert.throws(() => parseEmployees([{ id: 'e1', name: 'Sam' }]), /Invalid operations list/);
});

test('parseInventory computes availability markers', () => {
  const list = parseInventory([{
    item: { id: 'i1', sku: 'S1', name: 'Soap', unit: 'L', reorderPoint: 5 },
    onHand: 3, reserved: 1, available: 2, needsReorder: true
  }]);
  assert.equal(list[0].available, 2);
  assert.equal(list[0].needsReorder, true);
});

test('parseInventory rejects missing on-hand numbers', () => {
  assert.throws(() => parseInventory([{
    item: { id: 'i1', sku: 'S1', name: 'Soap', unit: 'L', reorderPoint: 5 },
    onHand: null, reserved: 0, available: 0, needsReorder: false
  }]), /Invalid operations list/);
});

test('parseSummary validates aggregate counts', () => {
  const summary = parseSummary({
    total: 8, arrived: 2, queued: 1, inProgress: 3,
    completed: 2, cancelled: 0, arrivalsTodayUtc: 4,
    completedTodayUtc: 2, averageCompletedSeconds: 600
  });
  assert.equal(summary.inProgress, 3);
  assert.equal(summary.completedTodayUtc, 2);
});

test('parseSummary rejects negative totals', () => {
  assert.throws(() => parseSummary({
    total: -1, arrived: 0, queued: 0, inProgress: 0,
    completed: 0, cancelled: 0, arrivalsTodayUtc: 0,
    completedTodayUtc: 0, averageCompletedSeconds: null
  }), /Invalid job summary/);
});

test('parseSummary accepts a null average', () => {
  const summary = parseSummary({
    total: 0, arrived: 0, queued: 0, inProgress: 0,
    completed: 0, cancelled: 0, arrivalsTodayUtc: 0,
    completedTodayUtc: 0, averageCompletedSeconds: null
  });
  assert.equal(summary.averageCompletedSeconds, null);
});
