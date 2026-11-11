// Count-mismatch reconcile helpers (design D6 / strategy §6.5): per-type digest =
// live count + SHA-256 over the sorted `key:updatedAt` lines. Identical on every platform
// (same line format, same sort, same pure-TS SHA-256), so equal data ⇒ equal hash.

import { sha256Hex } from './sha256';
import type { EntityDigest, SyncEntityType } from './protocol';

export interface DigestItem {
  /** Entity id — or, for purchases, the dedupe key (codigoGeneracion → numeroControl). */
  key: string;
  /** ISO updatedAt of the version held. */
  u: string;
}

const toMillis = (iso: string): number => {
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
};

/** Canonical line list: `key:u`, sorted by key (then u) with plain code-unit ordering. */
export const digestLines = (items: DigestItem[]): string[] =>
  items
    .map(item => `${item.key}:${item.u}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

export const buildDigest = (type: SyncEntityType, items: DigestItem[], includeItems = false): EntityDigest => {
  const lines = digestLines(items);
  return {
    type,
    count: lines.length,
    hash: sha256Hex(lines.join('\n')),
    ...(includeItems ? { items: lines } : {}),
  };
};

export const digestsMatch = (a: EntityDigest, b: EntityDigest): boolean =>
  a.type === b.type && a.count === b.count && a.hash === b.hash;

/** Parses `key:u` lines back into items (the key itself may contain ':'). */
export const parseDigestLines = (lines: string[]): DigestItem[] =>
  lines.map(line => {
    // u is an ISO timestamp, which itself contains ':' — split on the first ':' that starts it.
    const match = /^(.*):(\d{4}-\d{2}-\d{2}T.*)$/.exec(line);
    return match ? { key: match[1], u: match[2] } : { key: line, u: '' };
  });

export interface DigestDiff {
  /** Keys this device should push: the peer lacks them or holds an older version. */
  toPush: string[];
  /** Keys the peer holds that this device lacks or holds older — ask the peer to send. */
  toRequest: string[];
}

export const diffDigestItems = (mine: DigestItem[], theirs: DigestItem[]): DigestDiff => {
  const theirsByKey = new Map(theirs.map(item => [item.key, item]));
  const mineByKey = new Map(mine.map(item => [item.key, item]));
  const toPush: string[] = [];
  const toRequest: string[] = [];

  for (const item of mine) {
    const other = theirsByKey.get(item.key);
    if (!other || toMillis(item.u) > toMillis(other.u)) toPush.push(item.key);
  }
  for (const item of theirs) {
    const own = mineByKey.get(item.key);
    if (!own || toMillis(item.u) > toMillis(own.u)) toRequest.push(item.key);
  }
  return { toPush: toPush.sort(), toRequest: toRequest.sort() };
};
