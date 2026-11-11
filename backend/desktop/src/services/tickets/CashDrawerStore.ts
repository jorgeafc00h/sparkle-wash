// Cash drawer — "Abrir caja" sessions and cash in/out movements per register.
// Device-local (NOT synced): appStorage key `pos_cash_{companyId}`, kept apart
// from the ticket database. The Z closes the open session and reads its float
// and movements for the arqueo (ClosingService.computeCashSummary).
// See openspec/changes/add-pos-phase-2/design.md §6.

import { appStorage } from '../storage/ElectronStorage';
import { round2, type CashMovement, type CashSession } from '@/types/ticket';

interface CashDbShape {
  sessions: CashSession[];
  movements: CashMovement[];
}

const storageKey = (companyId: string): string => `pos_cash_${companyId}`;

const cache = new Map<string, CashDbShape>();
const inflight = new Map<string, Promise<CashDbShape>>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.warn('CashDrawerStore: listener failed', error);
    }
  }
}

async function load(companyId: string): Promise<CashDbShape> {
  const cached = cache.get(companyId);
  if (cached) return cached;
  const pending = inflight.get(companyId);
  if (pending) return pending;
  const promise = (async () => {
    let db: CashDbShape = { sessions: [], movements: [] };
    try {
      const raw = await appStorage.getItem(storageKey(companyId));
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<CashDbShape>;
        db = {
          sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
          movements: Array.isArray(parsed.movements) ? parsed.movements : [],
        };
      }
    } catch {
      // Corrupt JSON: keep a copy aside, start clean (the register must open).
      try {
        const raw = await appStorage.getItem(storageKey(companyId));
        if (raw) await appStorage.setItem(`${storageKey(companyId)}.corrupt-${Date.now()}`, raw);
      } catch {
        // best effort
      }
    }
    cache.set(companyId, db);
    inflight.delete(companyId);
    return db;
  })();
  inflight.set(companyId, promise);
  return promise;
}

async function persist(companyId: string): Promise<void> {
  const db = cache.get(companyId);
  if (!db) return;
  try {
    await appStorage.setItem(storageKey(companyId), JSON.stringify(db));
  } catch (error) {
    // Drop the mutated cache so the next read reflects what reached disk.
    cache.delete(companyId);
    throw error;
  }
}

let counter = 0;
const newId = (prefix: string): string => {
  counter = (counter + 1) % 1296;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36).padStart(2, '0')}${Math.random().toString(36).slice(2, 6)}`;
};

const parseAmount = (value: number): number => {
  const amount = round2(Number(value));
  if (!Number.isFinite(amount)) throw new Error('Monto inválido.');
  return amount;
};

export const CASH_SESSION_REQUIRED_MESSAGE = 'Abre la caja antes de registrar entradas o salidas de efectivo.';

export class CashDrawerStore {
  /** Subscribe to every write (UI refresh). Returns unsubscribe. */
  static subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  static async getOpenSession(companyId: string, registerId: string): Promise<CashSession | null> {
    const db = await load(companyId);
    return db.sessions.find((s) => s.registerId === registerId && !s.closedAt) ?? null;
  }

  static async getSessions(companyId: string, registerId?: string): Promise<CashSession[]> {
    const db = await load(companyId);
    return db.sessions
      .filter((s) => !registerId || s.registerId === registerId)
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  }

  static async getSession(companyId: string, sessionId: string): Promise<CashSession | null> {
    const db = await load(companyId);
    return db.sessions.find((s) => s.id === sessionId) ?? null;
  }

  /** "Abrir caja" with a float. Refused while this register already has an open session. */
  static async openSession(input: { companyId: string; registerId: string; openingFloat: number; openedBy?: string }): Promise<CashSession> {
    const openingFloat = parseAmount(input.openingFloat);
    if (openingFloat < 0) throw new Error('El fondo inicial no puede ser negativo.');
    const db = await load(input.companyId);
    if (db.sessions.some((s) => s.registerId === input.registerId && !s.closedAt)) {
      throw new Error('La caja ya está abierta.');
    }
    const session: CashSession = {
      id: newId('cash'),
      companyId: input.companyId,
      registerId: input.registerId,
      openedAt: new Date().toISOString(),
      openedBy: input.openedBy,
      openingFloat,
    };
    db.sessions.push(session);
    await persist(input.companyId);
    notify();
    return session;
  }

  /** Cash in / out during the open session of this register. */
  static async addMovement(input: {
    companyId: string;
    registerId: string;
    kind: 'IN' | 'OUT';
    amount: number;
    reason: string;
    createdBy?: string;
  }): Promise<CashMovement> {
    const amount = parseAmount(input.amount);
    if (amount <= 0) throw new Error('El monto debe ser mayor que cero.');
    const reason = input.reason.trim();
    if (!reason) throw new Error('Indica el motivo.');
    const db = await load(input.companyId);
    const session = db.sessions.find((s) => s.registerId === input.registerId && !s.closedAt);
    if (!session) throw new Error(CASH_SESSION_REQUIRED_MESSAGE);
    const movement: CashMovement = {
      id: newId('cmov'),
      companyId: input.companyId,
      registerId: input.registerId,
      sessionId: session.id,
      kind: input.kind === 'OUT' ? 'OUT' : 'IN',
      amount,
      reason,
      createdAt: new Date().toISOString(),
      createdBy: input.createdBy,
    };
    db.movements.push(movement);
    await persist(input.companyId);
    notify();
    return movement;
  }

  static async getMovements(companyId: string, sessionId: string): Promise<CashMovement[]> {
    const db = await load(companyId);
    return db.movements.filter((m) => m.sessionId === sessionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** The Z closed the session (idempotent). */
  static async closeSession(companyId: string, sessionId: string, closingId: string, closedAt: string): Promise<void> {
    const db = await load(companyId);
    const session = db.sessions.find((s) => s.id === sessionId);
    if (!session || session.closedAt) return;
    session.closedAt = closedAt;
    session.closingId = closingId;
    await persist(companyId);
    notify();
  }

  static async deleteCompanyData(companyId: string): Promise<void> {
    cache.delete(companyId);
    inflight.delete(companyId);
    await appStorage.removeItem(storageKey(companyId));
    notify();
  }

  /** Test hook: forget the in-memory copies (simulates an app restart). */
  static resetCacheForTests(): void {
    cache.clear();
    inflight.clear();
  }
}
