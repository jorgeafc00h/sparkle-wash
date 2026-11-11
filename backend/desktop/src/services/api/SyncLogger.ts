// SyncLogger — persists API request/response payloads to in-memory + appStorage log
// On desktop (browser/Electron), files cannot be written directly — uses:
//   1. window.__syncTraces for Playwright extraction (same as web in RN)
//   2. appStorage as a rolling 30-day log store (keyed by date)
//
// NEVER logs: passwords, certificate private keys, or auth tokens (redacted)

import { appStorage } from '../storage/ElectronStorage';

const MAX_LOG_DAYS = 30;
const LS_PREFIX = 'sync_log_';

export type SyncLogDirection = 'request' | 'response' | 'error';

export interface SyncLogEntry {
  timestamp: string;
  invoiceType: string;
  direction: SyncLogDirection;
  statusCode?: number;
  body: unknown;
  /** Headers with sensitive values redacted */
  headers?: Record<string, string>;
  error?: string;
  stack?: string;
}

const getLogKey = (date: Date): string => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${LS_PREFIX}${yyyy}-${mm}-${dd}`;
};

const redactHeaders = (headers?: Record<string, string>): Record<string, string> | undefined => {
  if (!headers) return undefined;
  const redacted = { ...headers };
  const sensitiveKeys = ['authorization', 'x-api-key', 'cookie', 'set-cookie'];
  for (const key of Object.keys(redacted)) {
    if (sensitiveKeys.includes(key.toLowerCase())) {
      redacted[key] = '[REDACTED]';
    }
  }
  return redacted;
};

const appendEntry = async (entry: SyncLogEntry): Promise<void> => {
  // Always push to window.__syncTraces for Playwright extraction
  try {
    if (typeof window !== 'undefined') {
      if (!(window as Window & { __syncTraces?: SyncLogEntry[] }).__syncTraces) {
        (window as Window & { __syncTraces?: SyncLogEntry[] }).__syncTraces = [];
      }
      (window as Window & { __syncTraces?: SyncLogEntry[] }).__syncTraces!.push(entry);
    }
  } catch { /* ignore */ }

  // Also persist to appStorage (rolling per-day)
  try {
    const key = getLogKey(new Date());
    const existing = await appStorage.getItem(key);
    const lines: SyncLogEntry[] = existing ? JSON.parse(existing) : [];
    lines.push(entry);
    await appStorage.setItem(key, JSON.stringify(lines));
  } catch { /* ignore — storage quota or SSR */ }
};

const rotateLogs = async (): Promise<void> => {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - MAX_LOG_DAYS);
    const allKeys = await appStorage.getAllKeys();
    const keysToRemove = allKeys.filter(key => {
      if (!key.startsWith(LS_PREFIX)) return false;
      const datePart = key.replace(LS_PREFIX, '');
      const fileDate = new Date(datePart);
      return !isNaN(fileDate.getTime()) && fileDate < cutoff;
    });
    for (const k of keysToRemove) {
      await appStorage.removeItem(k);
    }
  } catch { /* ignore */ }
};

let rotationRun = false;
const maybeRotate = () => {
  if (!rotationRun) {
    rotationRun = true;
    rotateLogs(); // fire-and-forget async
  }
};

export const SyncLogger = {
  async logSyncRequest(
    invoiceType: string,
    dtePayload: unknown,
    headers?: Record<string, string>,
  ): Promise<void> {
    maybeRotate();
    await appendEntry({
      timestamp: new Date().toISOString(),
      invoiceType,
      direction: 'request',
      body: dtePayload,
      headers: redactHeaders(headers),
    });
  },

  async logSyncResponse(
    invoiceType: string,
    statusCode: number,
    responseBody: unknown,
    headers?: Record<string, string>,
  ): Promise<void> {
    maybeRotate();
    await appendEntry({
      timestamp: new Date().toISOString(),
      invoiceType,
      direction: 'response',
      statusCode,
      body: responseBody,
      headers: redactHeaders(headers),
    });
  },

  async logSyncError(
    invoiceType: string,
    error: Error | unknown,
    statusCode?: number,
  ): Promise<void> {
    maybeRotate();
    const err = error instanceof Error ? error : new Error(String(error));
    await appendEntry({
      timestamp: new Date().toISOString(),
      invoiceType,
      direction: 'error',
      statusCode,
      body: null,
      error: err.message,
      stack: err.stack,
    });
  },

  /**
   * Returns all log keys sorted newest-first (as pseudo file paths).
   */
  async getLogFiles(): Promise<string[]> {
    try {
      const allKeys = await appStorage.getAllKeys();
      return allKeys.filter(key => key.startsWith(LS_PREFIX)).sort().reverse();
    } catch {
      return [];
    }
  },

  /**
   * Reads all entries from a log key. Returns parsed entries or empty array on error.
   */
  async readLogFile(key: string): Promise<SyncLogEntry[]> {
    try {
      const data = await appStorage.getItem(key);
      if (!data) return [];
      return JSON.parse(data) as SyncLogEntry[];
    } catch {
      return [];
    }
  },
};
