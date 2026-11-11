/**
 * LocalLogger — session-based file logger for SparkleWash Desktop.
 *
 * Writes structured JSONL entries to ${userData}/logs/fs-<timestamp>.log.
 * One file per app session. Buffers in memory, flushes to disk every 5s and
 * on errors/shutdown. Silent no-op in web/browser environments (no electronAPI).
 *
 * Privacy: never log passwords, certificates, raw DTE payloads, or customer PII.
 */

import { APP_VERSION } from '../../config/appVersion';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'event';

export interface LogEntry {
  ts: string;
  level: LogLevel;
  cat: string;
  msg: string;
  data?: Record<string, unknown>;
}

const FLUSH_INTERVAL_MS = 5_000;
const MAX_RETENTION_DAYS = 30;

let logFilePath: string | null = null;
let pendingEntries: LogEntry[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let isReady = false;

function now(): string {
  return new Date().toISOString();
}

function hasElectron(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI?.appendFile;
}

async function flushToDisk(): Promise<void> {
  if (!isReady || !logFilePath || pendingEntries.length === 0) return;
  const chunk = pendingEntries.splice(0);
  const lines = chunk.map((e) => JSON.stringify(e)).join('\n') + '\n';
  try {
    await window.electronAPI!.appendFile!(logFilePath, lines);
  } catch {
    // Re-queue so entries aren't lost on transient write errors
    pendingEntries.unshift(...chunk);
  }
}

async function pruneOldFiles(logsDir: string): Promise<void> {
  try {
    const files = await window.electronAPI!.listDir!(logsDir);
    const cutoff = Date.now() - MAX_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const name of files) {
      // Filename: fs-YYYY-MM-DDTHH-MM-SS.log
      const match = name.match(/^fs-(\d{4}-\d{2}-\d{2})/);
      if (match) {
        const fileDate = new Date(match[1]).getTime();
        if (!isNaN(fileDate) && fileDate < cutoff) {
          // No delete IPC — files will accumulate past the limit until one is added.
          // Acceptable trade-off; implement fs:delete when needed.
        }
      }
    }
  } catch {
    // Best-effort
  }
}

export const LocalLogger = {
  /**
   * Initialize the logger. Must be called once at app startup (App.tsx).
   * Creates the log file for this session and starts the flush timer.
   */
  async initialize(): Promise<void> {
    if (isReady || !hasElectron()) return;
    try {
      const userData = await window.electronAPI!.getAppPath!('userData');
      const logsDir = `${userData}/logs`;

      const stamp = new Date()
        .toISOString()
        .replace(/:/g, '-')
        .replace(/\.\d{3}Z$/, '');
      logFilePath = `${logsDir}/fs-${stamp}.log`;
      isReady = true;

      pruneOldFiles(logsDir);

      flushTimer = setInterval(flushToDisk, FLUSH_INTERVAL_MS);
      window.addEventListener('beforeunload', () => {
        if (flushTimer) clearInterval(flushTimer);
        flushToDisk();
      });

      LocalLogger.event('app', 'Session started', {
        version: APP_VERSION,
        env: import.meta.env.PROD ? 'production' : 'development',
        platform: 'electron',
      });
    } catch (err) {
      console.warn('[LocalLogger] init failed:', err);
    }
  },

  log(level: LogLevel, cat: string, msg: string, data?: Record<string, unknown>): void {
    if (!hasElectron()) return;
    const entry: LogEntry = { ts: now(), level, cat, msg };
    if (data && Object.keys(data).length > 0) entry.data = data;
    pendingEntries.push(entry);
    // Immediate flush on errors so we don't lose them
    if (level === 'error') void flushToDisk();
  },

  info(cat: string, msg: string, data?: Record<string, unknown>): void {
    LocalLogger.log('info', cat, msg, data);
  },

  warn(cat: string, msg: string, data?: Record<string, unknown>): void {
    LocalLogger.log('warn', cat, msg, data);
  },

  error(cat: string, msg: string, err?: unknown, data?: Record<string, unknown>): void {
    const extra: Record<string, unknown> = { ...data };
    if (err instanceof Error) {
      extra.error = err.message;
      if (err.stack) extra.stack = err.stack.slice(0, 800);
    } else if (err != null) {
      extra.error = String(err);
    }
    LocalLogger.log('error', cat, msg, Object.keys(extra).length > 0 ? extra : undefined);
  },

  event(cat: string, msg: string, data?: Record<string, unknown>): void {
    LocalLogger.log('event', cat, msg, data);
  },

  async flushNow(): Promise<void> {
    await flushToDisk();
  },

  getLogFilePath(): string | null {
    return logFilePath;
  },

  async getLogsDir(): Promise<string | null> {
    if (!hasElectron()) return null;
    try {
      const userData = await window.electronAPI!.getAppPath!('userData');
      return `${userData}/logs`;
    } catch {
      return null;
    }
  },
};
