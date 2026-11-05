import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStations, parseAlerts, pressureState, soapState } from '../src/api/stations.ts';
const station = { stationId: 'b4c3', name: 'Bay 1', status: 'idle', pressurePsi: 52, soapLevelDm: 20, timestamp: '2026-10-16T12:00:00Z' };
test('accepts the flat API contract and empty fleets', () => {
  assert.deepEqual(parseStations([station]), [station]); assert.deepEqual(parseStations([]), []);
});
test('rejects the original nested array and malformed telemetry', () => {
  for (const value of [[[station]], [{}], [{ ...station, pressurePsi: null }], [{ ...station, timestamp: 'bad' }], [station, station]]) assert.throws(() => parseStations(value));
});
test('matches pressure and soap thresholds at boundaries', () => {
  assert.deepEqual([44,45,60,61].map(pressureState), ['warning','good','good','danger']);
  assert.deepEqual([34,35,55,56].map(soapState), ['danger','warning','warning','good']);
});
test('rejects malformed alerts', () => { assert.throws(() => parseAlerts([{}])); assert.deepEqual(parseAlerts([]), []); });
