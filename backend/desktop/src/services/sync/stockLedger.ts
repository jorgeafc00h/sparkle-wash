// Product stock as a convergent counter (Device Sync v2, 2026-11-01).
//
// Products used to sync stock as an absolute number merged last-writer-wins:
// two registers selling the same product concurrently from stock 10 (2 and 3
// units) both ended at 7 instead of 5 — one register's sale was lost. The
// ledger travels inside the product payload (no new entity type, no relay
// change) and merges field-wise:
//
//   stock = base + Σ devices[d].in − Σ devices[d].out
//
// • `devices[d]` are grow-only totals per device (a PN-counter): each device
//   only ever increases its own entry, and a merge takes the max per device,
//   so every register's sales and restocks survive any delivery order.
// • `base` is the level the counters start from; it is replaced only by an
//   absolute write from a peer that does not keep a ledger (older app
//   versions), last-writer-wins by (baseAt, baseBy).
//
// Pure and dependency-free: byte-identical in App.Desktop and App.ReactNative
// (like mergeEngine/protocol/sha256/payloadCodec/digestService).

export interface StockLedgerDevice {
  in: number;
  out: number;
}

export interface StockLedger {
  base: number;
  /** ISO time of the write the base came from. */
  baseAt: string;
  /** Device (or 'init') that set the base — tie-breaker for equal baseAt. */
  baseBy: string;
  devices: Record<string, StockLedgerDevice>;
}

export interface StockLedgerCarrier {
  stock?: number;
  stockQuantity?: number;
  updatedAt?: string;
  createdAt?: string;
  stockLedger?: StockLedger;
}

const DECIMALS = 10_000; // stock keeps 4 decimals (0.5 kg, 1.250 kg)

export const roundStock = (value: number): number =>
  Number.isFinite(value) ? Math.round(value * DECIMALS) / DECIMALS : 0;

const toMillis = (iso: string | undefined): number => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : 0;
};

/** Level the carrier shows today (stockQuantity wins over the legacy `stock`). */
export const shownStock = (carrier: StockLedgerCarrier): number =>
  roundStock(carrier.stockQuantity ?? carrier.stock ?? 0);

/** Raw counter value (may go below zero after concurrent oversells). */
export const ledgerLevel = (ledger: StockLedger): number => {
  let level = ledger.base;
  for (const entry of Object.values(ledger.devices)) level += entry.in - entry.out;
  return roundStock(level);
};

/** What the product shows: the counter value, never below zero. */
export const ledgerStock = (ledger: StockLedger): number => Math.max(0, ledgerLevel(ledger));

/**
 * The ledger of a product, created lazily from its current level. Two devices
 * initialising from the same synced copy produce the same base (same level,
 * same updatedAt, `init`), so their later sales merge cleanly.
 */
export const ledgerOf = (carrier: StockLedgerCarrier): StockLedger =>
  carrier.stockLedger
    ? {
        base: carrier.stockLedger.base,
        baseAt: carrier.stockLedger.baseAt,
        baseBy: carrier.stockLedger.baseBy,
        devices: { ...carrier.stockLedger.devices },
      }
    : {
        base: shownStock(carrier),
        baseAt: carrier.updatedAt ?? carrier.createdAt ?? new Date(0).toISOString(),
        baseBy: 'init',
        devices: {},
      };

/** Record a local stock change of `delta` units by `deviceId` (sale < 0, restock > 0). */
export const applyStockDelta = (ledger: StockLedger, deviceId: string, delta: number): StockLedger => {
  const d = roundStock(delta);
  if (d === 0) return ledger;
  const current = ledger.devices[deviceId] ?? { in: 0, out: 0 };
  const next: StockLedgerDevice = d > 0
    ? { in: roundStock(current.in + d), out: current.out }
    : { in: current.in, out: roundStock(current.out - d) };
  return { ...ledger, devices: { ...ledger.devices, [deviceId]: next } };
};

/** True when the carrier's shown stock is what its own ledger says. */
export const ledgerMatches = (carrier: StockLedgerCarrier): boolean =>
  !!carrier.stockLedger && ledgerStock(carrier.stockLedger) === shownStock(carrier);

/**
 * The ledger a copy contributes to a merge. A copy without a ledger, or whose
 * shown stock disagrees with its ledger (written by an app version that edits
 * `stock` but merely carries the ledger along), is an absolute write: it
 * re-bases the counters at its version time.
 */
export const ledgerForMerge = (
  carrier: StockLedgerCarrier,
  versionAt: string,
  versionBy: string,
): StockLedger => {
  if (carrier.stockLedger && ledgerMatches(carrier)) return ledgerOf(carrier);
  const counters = carrier.stockLedger ? { ...carrier.stockLedger.devices } : {};
  const net = Object.values(counters).reduce((s, e) => s + e.in - e.out, 0);
  return { base: roundStock(shownStock(carrier) - net), baseAt: versionAt, baseBy: versionBy, devices: counters };
};

const newerBase = (a: StockLedger, b: StockLedger): StockLedger => {
  const ta = toMillis(a.baseAt);
  const tb = toMillis(b.baseAt);
  if (ta !== tb) return ta > tb ? a : b;
  if (a.baseBy !== b.baseBy) return a.baseBy > b.baseBy ? a : b;
  return a.base >= b.base ? a : b; // fully deterministic: merge order never matters
};

/** Convergent merge: max per device per direction, newest base. Commutative, associative, idempotent. */
export const mergeLedgers = (a: StockLedger, b: StockLedger): StockLedger => {
  const devices: Record<string, StockLedgerDevice> = {};
  for (const id of [...new Set([...Object.keys(a.devices), ...Object.keys(b.devices)])].sort()) {
    const x = a.devices[id] ?? { in: 0, out: 0 };
    const y = b.devices[id] ?? { in: 0, out: 0 };
    devices[id] = { in: Math.max(x.in, y.in), out: Math.max(x.out, y.out) };
  }
  const base = newerBase(a, b);
  return { base: base.base, baseAt: base.baseAt, baseBy: base.baseBy, devices };
};

/** A stock level written as an absolute number by a copy that keeps no (matching) ledger. */
export interface AbsoluteStockWrite {
  value: number;
  at: string;
  by: string;
}

export const absoluteWriteOf = (
  carrier: StockLedgerCarrier,
  versionAt: string,
  versionBy: string,
): AbsoluteStockWrite | null =>
  carrier.stockLedger && ledgerMatches(carrier) ? null : { value: shownStock(carrier), at: versionAt, by: versionBy };

const netOf = (devices: Record<string, StockLedgerDevice>): number =>
  Object.values(devices).reduce((s, e) => s + e.in - e.out, 0);

/**
 * Stock of two copies of a product, merged. Counters merge as a CRDT; an
 * absolute write (older app, or an app that edits `stock` while carrying the
 * ledger) that is STRICTLY newer than the merged base sets the shown level as
 * of that write: base = value − net of every counter known now. Deterministic
 * in both orders (writes are applied oldest first).
 */
export const mergeProductStock = (
  a: StockLedgerCarrier,
  aAt: string,
  aBy: string,
  b: StockLedgerCarrier,
  bAt: string,
  bBy: string,
): StockLedger => {
  const la = a.stockLedger ? ledgerOf(a) : null;
  const lb = b.stockLedger ? ledgerOf(b) : null;
  let merged: StockLedger = la && lb ? mergeLedgers(la, lb) : (la ?? lb ?? ledgerOf(a));
  const writes = [absoluteWriteOf(a, aAt, aBy), absoluteWriteOf(b, bAt, bBy)]
    .filter((w): w is AbsoluteStockWrite => !!w)
    .sort((x, y) => toMillis(x.at) - toMillis(y.at) || (x.by < y.by ? -1 : x.by > y.by ? 1 : x.value - y.value));
  for (const w of writes) {
    if (toMillis(w.at) > toMillis(merged.baseAt)) {
      merged = { ...merged, base: roundStock(w.value - netOf(merged.devices)), baseAt: w.at, baseBy: w.by };
    }
  }
  return merged;
};
