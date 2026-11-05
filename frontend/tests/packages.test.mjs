import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCatalog } from '../src/api/packages.ts';

const fixture = JSON.parse(readFileSync(new URL('../../contracts/v1/service-packages.json', import.meta.url), 'utf8'));

test('shared menu has the exact vehicle prices and cumulative inclusions', () => {
  const catalog = parseCatalog(fixture);
  assert.deepEqual(catalog.packages.map(item => item.prices.car), [10, 15, 25, 35]);
  assert.deepEqual(catalog.packages.map(item => item.prices.suv), [12, 18, 30, 40]);
  assert.deepEqual(catalog.packages.map(item => item.prices.xl), [14, 21, 35, 45]);
  assert.deepEqual(catalog.packages.map(item => item.prices.pickup), [16, 24, 40, 50]);
  for (let i = 1; i < catalog.packages.length; i++)
    assert.deepEqual(catalog.packages[i].items.slice(0, catalog.packages[i - 1].items.length), catalog.packages[i - 1].items);
});

test('rejects an incomplete or negative-price menu', () => {
  assert.throws(() => parseCatalog({ ...fixture, packages: [] }));
  const malformed = structuredClone(fixture);
  malformed.packages[0].prices.car = -1;
  assert.throws(() => parseCatalog(malformed));
});
