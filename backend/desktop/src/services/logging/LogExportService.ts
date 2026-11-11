/**
 * LogExportService — collects local session log files and either saves them
 * to disk (user-chosen path) or uploads them to the backend API for storage
 * in Azure Blob Storage.
 */

import axios from 'axios';
import { LocalLogger } from './LocalLogger';
import { API_CONFIG, API_HEADERS } from '../../config/api';
import { APP_VERSION } from '../../config/appVersion';

export interface ExportResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

export interface UploadResult {
  success: boolean;
  blobName?: string;
  error?: string;
}

function hasElectron(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI?.listDir;
}

export interface CollectLogsOptions {
  /**
   * Cap the combined size of the collected logs (bytes). When exceeded the
   * TAIL is kept — the most recent entries are the useful ones for triage.
   * Keeps support-ticket payloads inside Azure Table property limits.
   */
  maxBytes?: number;
}

/**
 * Concatenate every session log file in chronological order. Exported so the
 * support-ticket flow can attach the same content the user can export by hand.
 */
export async function collectLogs(options?: CollectLogsOptions): Promise<string> {
  if (!hasElectron()) return '';

  const logsDir = await LocalLogger.getLogsDir();
  if (!logsDir) return '';

  // Flush the current session buffer before reading
  await LocalLogger.flushNow();

  try {
    const files = await window.electronAPI!.listDir!(logsDir);
    const logFiles = (files ?? [])
      .filter((f: string) => f.endsWith('.log'))
      .sort(); // chronological by filename (fs-YYYY-MM-DDTHH-MM-SS.log)

    const parts: string[] = [];
    for (const fileName of logFiles) {
      try {
        const content = await window.electronAPI!.readFile!(`${logsDir}/${fileName}`);
        if (content?.trim()) {
          parts.push(`# ${fileName}\n${content}`);
        }
      } catch {
        // Skip unreadable files silently
      }
    }
    let combined = parts.join('\n');
    const maxBytes = options?.maxBytes;
    if (maxBytes && combined.length > maxBytes) {
      combined = combined.slice(combined.length - maxBytes);
      // Start at a line boundary so the first (truncated) line stays parseable
      const newline = combined.indexOf('\n');
      combined = newline >= 0 ? combined.slice(newline + 1) : combined;
      combined = `[…truncated — showing the last ${maxBytes} bytes]\n${combined}`;
    }
    return combined;
  } catch {
    return '';
  }
}

async function collectAllLogs(): Promise<string> {
  return collectLogs();
}

export const LogExportService = {
  /**
   * Export all session logs to a file chosen by the user via save dialog.
   */
  async exportToFile(): Promise<ExportResult> {
    if (!hasElectron()) {
      return { success: false, error: 'Solo disponible en la app de escritorio' };
    }

    try {
      const content = await collectAllLogs();
      if (!content) {
        return { success: false, error: 'No hay registros disponibles' };
      }

      const dateStr = new Date().toISOString().slice(0, 10);
      const savePath = await window.electronAPI!.showSaveDialog!({
        title: 'Exportar registros del sistema',
        defaultPath: `sparklewash-logs-${dateStr}.log`,
        filters: [
          { name: 'Archivos de registro', extensions: ['log', 'txt'] },
          { name: 'Todos los archivos', extensions: ['*'] },
        ],
      });

      if (!savePath) return { success: false, error: 'Cancelado' };

      await window.electronAPI!.writeFile!(savePath, content);
      LocalLogger.event('settings', 'Logs exported to file', { bytes: content.length });
      return { success: true, filePath: savePath };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  },

  /**
   * Upload all session logs to the backend API for Azure Blob Storage.
   * The backend stores them at app-logs/{date}/{filename}.
   */
  async uploadToServer(nit?: string): Promise<UploadResult> {
    try {
      const content = await collectAllLogs();
      if (!content) {
        return { success: false, error: 'No hay registros disponibles' };
      }

      const isProduction = import.meta.env.PROD;
      const baseUrl = isProduction
        ? API_CONFIG.production.baseUrl
        : API_CONFIG.development.baseUrl;

      const dateStr = new Date().toISOString().slice(0, 10);
      const filename = `fs-logs-${dateStr}-${Date.now()}.log`;

      const response = await axios.post<{ blobName: string }>(
        `${baseUrl}/logs/upload`,
        {
          filename,
          content,
          metadata: {
            appVersion: APP_VERSION,
            nit: nit ?? 'unknown',
            ts: new Date().toISOString(),
            environment: isProduction ? 'production' : 'development',
          },
        },
        {
          headers: {
            [API_HEADERS.API_KEY]: API_CONFIG.apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 30_000,
        },
      );

      LocalLogger.event('settings', 'Logs uploaded to server', { filename, nit });
      return { success: true, blobName: response.data?.blobName };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      LocalLogger.error('settings', 'Log upload failed', err);
      return { success: false, error: msg };
    }
  },
};
