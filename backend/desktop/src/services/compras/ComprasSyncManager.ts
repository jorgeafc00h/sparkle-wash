// ComprasSyncManager — Gestor de sincronización de compras.
//
// TANTO el sync periódico en segundo plano (startForCompany/startSync) COMO el
// manual (syncComprasNow de comprasSlice) resuelven la fuente con syncPreferred:
// IMAP es la PREFERIDA cuando la empresa tiene credenciales guardadas; Gmail
// (cuenta vinculada) queda como respaldo — mirrors PurchasesView.syncPreferred
// (Swift).
//
// El intervalo de "Frecuencia de Sincronización" (ComprasSettingsPage) existe
// para proteger la cuota diaria COMPARTIDA de la API de Gmail; IMAP no tiene esa
// cuota, así que el intervalo simplemente lo limita de más — nunca de menos.
//
// Antes el sync periódico era Gmail-only. Tras migrar Compras a IMAP por
// defecto eso dejó a las empresas configuradas SOLO con IMAP —el caso normal
// hoy— sin ninguna sincronización automática: el selector de frecuencia no
// hacía absolutamente nada para ellas.

import { GmailImportService, type SyncDateRange, type SyncResult } from './GmailImportService';
import { ComprasDatabase } from './ComprasDatabase';
import { getGmailAccessToken, GMAIL_RECONNECT_MESSAGE } from './GmailAuthService';
import { ImapImportService, type ImapSyncResult } from './ImapImportService';

// ── Estado del manager ────────────────────────────────────────────────────────

let syncTimer: ReturnType<typeof setInterval> | null = null;
let running = false;

export type ComprasSyncSource = 'imap' | 'gmail' | 'none';

export interface ComprasSyncPreferredResult {
  source: ComprasSyncSource;
  imported: number;
  skipped: number;
  errors: number;
  receptorMismatch?: number;
  authError?: boolean;
  quotaExceeded?: boolean;
  errorMessage?: string;
}

export interface SyncPreferredOptions {
  dateRange?: SyncDateRange;
  isProduction?: boolean;
  autoVerify?: boolean;
  /** Streaming import progress — only fires with a real total for the IMAP path. */
  onProgress?: (processed: number, total: number) => void;
  /** Deferred MH-verification progress — IMAP path only (see ImapImportService). */
  onVerifyProgress?: (current: number, total: number) => void;
}

// ── Clase pública ─────────────────────────────────────────────────────────────

export class ComprasSyncManager {
  /**
   * Indica si la empresa tiene credenciales IMAP guardadas. IMAP es la
   * fuente preferida de sincronización cuando existen.
   */
  static async hasImapCredentials(companyId: string): Promise<boolean> {
    return ImapImportService.hasCredentials(companyId);
  }

  /**
   * Sincroniza compras usando la fuente preferida de la empresa: IMAP si hay
   * credenciales guardadas, Gmail (cuenta vinculada) como respaldo. Cuando
   * ninguna está configurada, retorna `source: 'none'` sin error de red.
   */
  static async syncPreferred(
    companyId: string,
    options: SyncPreferredOptions = {},
  ): Promise<ComprasSyncPreferredResult> {
    const { dateRange, isProduction, autoVerify, onProgress, onVerifyProgress } = options;

    const imapCreds = await ImapImportService.loadCredentials(companyId);
    if (imapCreds) {
      const result: ImapSyncResult = await ImapImportService.syncComprasForCompany(
        companyId,
        imapCreds,
        dateRange,
        { autoVerify, isProduction, onProgress, onVerifyProgress },
      );
      return { source: 'imap', ...result };
    }

    const gmailAccount = await ComprasDatabase.getLinkedGmail(companyId);
    if (gmailAccount) {
      // Background-safe: renews from the refresh token, never opens a browser.
      const accessToken = await getGmailAccessToken(companyId);
      if (!accessToken) {
        return {
          source: 'gmail',
          imported: 0,
          skipped: 0,
          errors: 1,
          authError: true,
          errorMessage: GMAIL_RECONNECT_MESSAGE,
        };
      }
      // Gmail REST no tiene progreso incremental hoy — una única señal
      // indeterminada para que la UI muestre el spinner "Sincronizando
      // compras…" (la barra determinada solo aparece cuando hay progreso
      // real, igual que en Swift: el banner determinado depende únicamente
      // del manager IMAP).
      onProgress?.(0, 0);
      const result: SyncResult = await GmailImportService.syncComprasForCompany(
        companyId,
        accessToken,
        dateRange,
        { autoVerify, isProduction },
      );
      return { source: 'gmail', ...result };
    }

    return {
      source: 'none',
      imported: 0,
      skipped: 0,
      errors: 0,
      errorMessage: 'No hay una fuente de correo configurada (IMAP o Gmail).',
    };
  }

  /**
   * Inicia una sincronización puntual Gmail-only para la empresa indicada.
   *
   * NOTA: sin llamadas hoy — el thunk startComprasSync usa startForCompany.
   * Se conserva por compatibilidad; para una sincronización puntual nueva usa
   * syncPreferred, que resuelve IMAP primero.
   */
  static async startSync(companyId: string, dateRange?: SyncDateRange): Promise<void> {
    try {
      const accessToken = await getGmailAccessToken(companyId);
      if (!accessToken) {
        console.warn('ComprasSyncManager.startSync: no hay cuenta Gmail vinculada o sin token');
        return;
      }

      running = true;
      await GmailImportService.syncComprasForCompany(companyId, accessToken, dateRange);
    } catch (error) {
      console.error('ComprasSyncManager.startSync: error', error);
    } finally {
      running = false;
    }
  }

  /**
   * Inicia la sincronización periódica para una empresa.
   * frequencyMinutes = 0 significa solo manual (no programa timer).
   * El callback se llama después de cada ciclo con el resultado o el error.
   */
  static async startForCompany(
    companyId: string,
    frequencyMinutes: number,
    callback: (result: { imported: number } | null, error: unknown) => void,
  ): Promise<void> {
    // Limpiar timer anterior si existe
    ComprasSyncManager.stop();

    if (frequencyMinutes <= 0) {
      // Solo manual: ejecutar una vez inmediatamente
      try {
        running = true;
        const result = await ComprasSyncManager.syncPreferred(companyId);
        running = false;
        if (result.source === 'none') {
          callback(null, null);
        } else {
          callback({ imported: result.imported }, null);
        }
      } catch (error) {
        running = false;
        callback(null, error);
      }
      return;
    }

    // Sincronizar periódicamente
    const intervalMs = frequencyMinutes * 60 * 1000;

    const runSync = async () => {
      // Reentrancy guard: a slow pass must not overlap the next interval tick.
      if (running) return;
      try {
        running = true;
        const result = await ComprasSyncManager.syncPreferred(companyId);
        running = false;
        if (result.source === 'none') {
          callback(null, null);
          return;
        }
        callback({ imported: result.imported }, null);
      } catch (error) {
        running = false;
        callback(null, error);
      }
    };

    // Ejecutar inmediatamente y luego cada intervalo
    await runSync();
    syncTimer = setInterval(runSync, intervalMs);
  }

  /**
   * Detiene el timer de sincronización periódica.
   */
  static stop(): void {
    if (syncTimer !== null) {
      clearInterval(syncTimer);
      syncTimer = null;
    }
    running = false;
  }

  static async stopSync(): Promise<void> {
    ComprasSyncManager.stop();
  }

  /**
   * Indica si hay una sincronización en curso.
   */
  static isRunning(): boolean {
    return running;
  }
}
