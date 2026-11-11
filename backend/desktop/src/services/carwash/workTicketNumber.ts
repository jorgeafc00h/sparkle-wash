// Work-ticket numbers: OT-{registerCode}-{seq:6}, e.g. OT-C1-000045.
// The counter is persisted per register code and strictly monotonic (it never
// reuses a number, even if a ticket is later cancelled).

import { appStorage } from '../storage/ElectronStorage';

export const WORK_TICKET_COUNTER_KEY_PREFIX = 'carwash_ticket_seq_v1:';

export interface CounterStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export function normalizeRegisterCode(code: string | null | undefined): string {
  const cleaned = String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return cleaned || 'C1';
}

export function formatWorkTicketNumber(registerCode: string, seq: number): string {
  const safeSeq = Math.max(0, Math.floor(seq));
  return `OT-${normalizeRegisterCode(registerCode)}-${String(safeSeq).padStart(6, '0')}`;
}

// Serializes concurrent calls so two walk-ins never read the same counter.
let chain: Promise<unknown> = Promise.resolve();

export function nextWorkTicketNumber(registerCode: string, storage: CounterStorage = appStorage): Promise<string> {
  const code = normalizeRegisterCode(registerCode);
  const run = async (): Promise<string> => {
    const key = `${WORK_TICKET_COUNTER_KEY_PREFIX}${code}`;
    const raw = await storage.getItem(key);
    const current = Number.parseInt(raw ?? '0', 10);
    const next = (Number.isFinite(current) && current > 0 ? current : 0) + 1;
    await storage.setItem(key, String(next));
    return formatWorkTicketNumber(code, next);
  };
  const result = chain.then(run, run);
  chain = result.catch(() => undefined);
  return result;
}
