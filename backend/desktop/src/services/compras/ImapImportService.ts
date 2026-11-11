// ImapImportService — Importa DTEs desde IMAP directo, sin Gmail API.
//
// Alternativa al flujo OAuth + Gmail API para el Tier Lite (gratis):
// no hay cuota compartida, no depende de verificación OAuth de Google,
// y funciona con cualquier proveedor IMAP (Gmail con app-password,
// Outlook, Yahoo, iCloud, o un servidor corporativo).
//
// Toda la parte de red corre en el proceso main de Electron (Node); este
// módulo solo arma el contrato, decodifica, parsea, y persiste vía
// ComprasDatabase + auto-verificación con Consulta Pública MH.

import type { Compra } from '@/types/compras';
import { decodeBase64ToText as decodeAttachmentBase64 } from './textDecoding';
import { CompraSource } from '@/types/compras';
import { DTEJsonParser } from './DTEJsonParser';
import { ComprasDatabase } from './ComprasDatabase';
import { isAddressedToCompany, resolveCompanyIdentity } from './receptorMatch';
import { CompraVerificationService } from './CompraVerificationService';
import type { SyncDateRange } from './GmailImportService';

// Keychain/DPAPI service key (Electron safeStorage) under which IMAP
// credentials are stored per company. Exported so every caller that only
// needs to read/check credentials (ComprasSyncManager, ComprasSettingsPage)
// shares this exact key instead of duplicating the string literal.
export const IMAP_SECURE_SERVICE = 'sparklewash.imap';

export interface ImapCredentials {
  user: string;
  password: string;
  host?: string;
  port?: number;
  tls?: boolean;
}

interface ImapAttachmentPart {
  filename: string;
  kind: 'json' | 'txt' | 'pdf';
  size: number;
  contentBase64: string;
}

export interface ImapSyncResult {
  imported: number;
  skipped: number;
  errors: number;
  /** DTEs addressed to another NIT/NRC (shared inbox) — not imported. */
  receptorMismatch?: number;
  authError?: boolean;
  errorMessage?: string;
}

export interface ImapSyncOptions {
  autoVerify?: boolean;
  isProduction?: boolean;
  /**
   * Fires as messages are fetched/processed. `total` is only known once the
   * IMAP fetch IPC call resolves (mirrors ImapService.fetchAttachments in the
   * Swift app: onProgress(0, total) right after search, then per message).
   */
  onProgress?: (processed: number, total: number) => void;
  /**
   * Fires during the deferred MH-verification pass that runs AFTER the
   * import loop finishes. `total` = number of newly-imported compras queued
   * for verification (mirrors ImapPurchaseSyncManager.verifyRecent).
   */
  onVerifyProgress?: (current: number, total: number) => void;
}

/**
 * Internal signal thrown when the main-process IMAP fetch itself fails
 * (connection/auth/etc.) so the outer sync method can short-circuit with the
 * same ImapSyncResult shape existing callers already handle.
 */
class ImapFetchFailure extends Error {
  authError: boolean;
  constructor(message: string, authError: boolean) {
    super(message);
    this.name = 'ImapFetchFailure';
    this.authError = authError;
  }
}

function hasElectronImap(): boolean {
  if (typeof window === 'undefined') return false;
  return !!window.electronAPI?.imapFetchAttachments;
}

function shouldSkipAutoVerifyForTests(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage?.getItem('__skip_compra_auto_verify') === 'true';
}

async function savePdfLocally(
  companyId: string,
  codigoGeneracion: string,
  base64Data: string,
): Promise<string | null> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api?.writeFile || !api?.getAppPath) return null;
  try {
    const userData = await api.getAppPath('userData');
    const safeCodGen = codigoGeneracion.replace(/[^A-Za-z0-9-]/g, '_');
    const targetPath = `${userData}/purchases/${companyId}/${safeCodGen}.pdf`;
    await api.writeFile(targetPath, base64Data, 'base64');
    return targetPath;
  } catch (err) {
    console.warn('ImapImportService: error al guardar PDF local', err);
    return null;
  }
}

// Decodifica base64 a texto (para contenido JSON/TXT), tolerando charsets
// legacy. El TextDecoder('utf-8') no fatal que había aquí convertía los bytes
// ISO-8859-1/Windows-1252 en U+FFFD, importando la compra con el nombre del
// emisor corrupto en la lista, en la búsqueda, en el CSV y en originalJson.
function decodeBase64ToText(base64: string): string {
  return decodeAttachmentBase64(base64);
}

function stripExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.substring(0, idx) : filename;
}

// Servidores IMAP conocidos por dominio de correo. Usado por
// ImapImportService.detectImapSettings para mostrar el servidor resuelto en
// la UI de Ajustes ANTES de probar la conexión — la resolución que realmente
// se usa al conectar vive en electron/main.cjs (imapAutoDetect), este mapa es
// solo un espejo para mostrarlo en el cliente. Mirrors RN's
// ImapImportService.detectImapSettings and Swift's ImapCredentials.autoDetect.
const KNOWN_IMAP_SERVERS: Record<string, { server: string; port: number; ssl: boolean }> = {
  'gmail.com': { server: 'imap.gmail.com', port: 993, ssl: true },
  'googlemail.com': { server: 'imap.gmail.com', port: 993, ssl: true },
  'outlook.com': { server: 'outlook.office365.com', port: 993, ssl: true },
  'hotmail.com': { server: 'outlook.office365.com', port: 993, ssl: true },
  'live.com': { server: 'outlook.office365.com', port: 993, ssl: true },
  'office365.com': { server: 'outlook.office365.com', port: 993, ssl: true },
  'yahoo.com': { server: 'imap.mail.yahoo.com', port: 993, ssl: true },
  'yahoo.es': { server: 'imap.mail.yahoo.com', port: 993, ssl: true },
  'icloud.com': { server: 'imap.mail.me.com', port: 993, ssl: true },
  'me.com': { server: 'imap.mail.me.com', port: 993, ssl: true },
  'aol.com': { server: 'imap.aol.com', port: 993, ssl: true },
};

export class ImapImportService {
  /**
   * Prueba las credenciales IMAP. No guarda nada.
   */
  static async testConnection(credentials: ImapCredentials): Promise<{
    ok: boolean;
    host?: string;
    port?: number;
    error?: string;
  }> {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api?.imapTestConnection) {
      return { ok: false, error: 'IMAP solo está disponible en la app de escritorio' };
    }
    return api.imapTestConnection(credentials);
  }

  /**
   * Auto-detecta host/puerto/SSL a partir del dominio del correo — usado por
   * la UI de Ajustes para mostrar el servidor resuelto antes de conectar.
   * Solo informativo: la conexión real vuelve a resolver esto server-side.
   */
  static detectImapSettings(email: string): { server: string; port: number; ssl: boolean } {
    const domain = email.split('@')[1]?.toLowerCase().trim() || '';
    if (!domain) return { server: '', port: 993, ssl: true };
    return KNOWN_IMAP_SERVERS[domain] || { server: `imap.${domain}`, port: 993, ssl: true };
  }

  /**
   * Carga las credenciales IMAP guardadas para una empresa desde el
   * almacenamiento seguro (Keychain/DPAPI vía Electron safeStorage), o
   * `null` si no hay ninguna guardada (o no estamos en Electron).
   */
  static async loadCredentials(companyId: string): Promise<ImapCredentials | null> {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api?.secureGet) return null;
    try {
      const raw = await api.secureGet(IMAP_SECURE_SERVICE, companyId);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as ImapCredentials;
      if (!parsed?.user || !parsed?.password) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Indica si la empresa tiene credenciales IMAP guardadas. IMAP es la
   * fuente PREFERIDA de sincronización cuando existen (ver ComprasSyncManager).
   */
  static async hasCredentials(companyId: string): Promise<boolean> {
    return (await ImapImportService.loadCredentials(companyId)) !== null;
  }

  /**
   * Sincroniza compras para una empresa usando IMAP. Misma semántica que
   * GmailImportService.syncComprasForCompany (.json + .txt + .pdf, pair
   * PDFs with JSON by codigoGeneracion).
   *
   * Fases (mirrors ImapPurchaseSyncManager.swift):
   *  1. Import — fetch + persist. Reports `onProgress(processed, total)`.
   *     If this is the company's FIRST sync (no compras known yet) with no
   *     explicit date range and the default window returns nothing, retries
   *     ONCE over ~10 years of history so the initial import "just works".
   *  2. Deferred verify — AFTER import completes, verifies each newly
   *     imported compra against Consulta Pública MH one at a time, saving
   *     after each (`onVerifyProgress(current, total)`) so ✓ badges fill
   *     progressively without blocking the (fast) import phase.
   */
  static async syncComprasForCompany(
    companyId: string,
    credentials: ImapCredentials,
    dateRange?: SyncDateRange,
    options?: ImapSyncOptions,
  ): Promise<ImapSyncResult> {
    if (!hasElectronImap()) {
      return {
        imported: 0,
        skipped: 0,
        errors: 1,
        errorMessage: 'IMAP solo está disponible en la app de escritorio',
      };
    }
    const autoVerify = (options?.autoVerify ?? true) && !shouldSkipAutoVerifyForTests();
    const isProduction = options?.isProduction ?? true;
    const onProgress = options?.onProgress;
    const onVerifyProgress = options?.onVerifyProgress;

    // Compras insertadas en cualquiera de los passes de import, en cola para
    // el pase de verificación diferida (fuera del loop de import para que un
    // "sync all" grande no quede bloqueado por N llamadas de red secuenciales).
    const pendingVerification: Compra[] = [];
    // DTEs addressed to another taxpayer (shared inbox) are skipped and reported.
    const companyIdentity = resolveCompanyIdentity(companyId);
    let receptorMismatch = 0;

    // Un pase de fetch + persistencia sobre una ventana de fechas dada.
    // Extraído para que el fallback de historial completo (más abajo) pueda
    // re-ejecutarlo sin duplicar la lógica de parseo/dedup/emparejamiento PDF.
    const runImportPass = async (
      afterDate?: string,
    ): Promise<{ imported: number; skipped: number; errors: number }> => {
      let imported = 0;
      let skipped = 0;
      let errors = 0;

      const api = window.electronAPI!;
      const result = await api.imapFetchAttachments!({ ...credentials, afterDate });
      if (!result.ok) {
        const msg = (result.error || '').toLowerCase();
        const authError = /auth|login|credenti|password/.test(msg);
        throw new ImapFetchFailure(result.error || 'Error IMAP', authError);
      }

      const total = result.messages.length;
      onProgress?.(0, total);
      let processed = 0;

      for (const message of result.messages) {
        try {
          // Dedup por messageId — si ya importamos ese correo, skip.
          // Reutilizamos existsByGmailMessageId ya que la semántica es la misma
          // (es un ID externo del proveedor, Gmail o IMAP).
          const alreadyExists = await ComprasDatabase.existsByGmailMessageId(message.messageId, companyId);
          if (alreadyExists) {
            skipped++;
          } else {
            const attachments: ImapAttachmentPart[] = message.attachments;
            const jsonLikeParts = attachments.filter(
              (a) => a.kind === 'json' || a.kind === 'txt',
            );
            const pdfParts: ImapAttachmentPart[] = attachments.filter((a) => a.kind === 'pdf');

            if (jsonLikeParts.length === 0) {
              skipped++;
            } else {
              const usedPdfIndexes = new Set<number>();
              let messageImported = false;

              for (const part of jsonLikeParts) {
                try {
                  const content = decodeBase64ToText(part.contentBase64);
                  if (!content) continue;

                  const compra = DTEJsonParser.parse(
                    content,
                    companyId,
                    CompraSource.Email,
                    message.messageId,
                  );
                  if (!compra) continue;
                  if (!isAddressedToCompany(compra, companyIdentity)) {
                    receptorMismatch++;
                    continue;
                  }

                  const codGenExists = await ComprasDatabase.existsByCodigoGeneracion(
                    compra.codigoGeneracion,
                    companyId,
                  );
                  if (codGenExists) {
                    skipped++;
                    continue;
                  }

                  // Emparejar PDF: primero por nombre con codigoGeneracion,
                  // como fallback cualquier PDF no usado del mismo correo.
                  let pdfIdx = pdfParts.findIndex(
                    (p, i) =>
                      !usedPdfIndexes.has(i) &&
                      stripExtension(p.filename).includes(compra.codigoGeneracion),
                  );
                  if (pdfIdx < 0) {
                    pdfIdx = pdfParts.findIndex((_, i) => !usedPdfIndexes.has(i));
                  }
                  if (pdfIdx >= 0) {
                    usedPdfIndexes.add(pdfIdx);
                    const savedPath = await savePdfLocally(
                      companyId,
                      compra.codigoGeneracion,
                      pdfParts[pdfIdx].contentBase64,
                    );
                    if (savedPath) compra.pdfPath = savedPath;
                  }

                  await ComprasDatabase.insertCompra(compra, { origin: 'import' });
                  messageImported = true;
                  // Verificación diferida (ver pase de abajo) — no bloquea el import.
                  pendingVerification.push(compra);
                } catch (attachErr) {
                  console.warn('ImapImportService: error procesando adjunto', attachErr);
                  errors++;
                }
              }

              if (messageImported) imported++;
              else skipped++;
            }
          }
        } catch (msgErr) {
          console.warn('ImapImportService: error procesando mensaje', msgErr);
          errors++;
        }
        processed++;
        onProgress?.(processed, total);
      }

      return { imported, skipped, errors };
    };

    let imported = 0;
    let skipped = 0;
    let errors = 0;

    try {
      const existingCount = await ComprasDatabase.getCount(companyId);
      const wasInitialSync = existingCount === 0;

      const first = await runImportPass(dateRange?.afterDate);
      imported += first.imported;
      skipped += first.skipped;
      errors += first.errors;

      // Initial-sync fallback: una cuenta nueva cuyas facturas son más
      // antiguas que la ventana default de 30 días mostraría la lista vacía.
      // Si el primer sync (sin rango explícito) no encuentra nada, reintenta
      // UNA vez sobre el historial completo (~10 años) para que el primer
      // import "simplemente funcione". Mirrors ImapPurchaseSyncManager.swift
      // (líneas ~110-122).
      if (!dateRange?.afterDate && wasInitialSync && imported === 0) {
        const fullHistory = new Date();
        fullHistory.setDate(fullHistory.getDate() - 3650);
        const fullHistoryIso = fullHistory.toISOString().slice(0, 10);
        try {
          const fallback = await runImportPass(fullHistoryIso);
          imported += fallback.imported;
          skipped += fallback.skipped;
          errors += fallback.errors;
        } catch (fallbackErr) {
          // Surface the same way the primary pass's failure does (below) instead
          // of only logging — a fallback failure (e.g. auth expiring mid-sync)
          // previously left the caller with `imported: 0` and no error signal.
          console.warn(
            'ImapImportService: fallback de historial completo falló',
            fallbackErr,
          );
          if (fallbackErr instanceof ImapFetchFailure) {
            return {
              imported,
              skipped,
              errors: errors + 1,
              receptorMismatch,
              authError: fallbackErr.authError,
              errorMessage: fallbackErr.message,
            };
          }
          return {
            imported,
            skipped,
            errors: errors + 1,
            errorMessage: (fallbackErr as Error)?.message ?? 'Error IMAP (historial completo)',
          };
        }
      }
    } catch (err) {
      if (err instanceof ImapFetchFailure) {
        return { imported: 0, skipped: 0, errors: 1, authError: err.authError, errorMessage: err.message };
      }
      console.error('ImapImportService.syncComprasForCompany: error general', err);
      return {
        imported,
        skipped,
        errors: errors + 1,
        errorMessage: (err as Error)?.message ?? 'Error IMAP',
      };
    }

    // Verificación diferida: las facturas ya están visibles (insertadas
    // arriba); el ✓ se llena después contra Consulta Pública MH, guardando
    // tras cada una para que la UI pueda refrescar progresivamente.
    if (autoVerify && pendingVerification.length > 0) {
      const total = pendingVerification.length;
      onVerifyProgress?.(0, total);
      for (let i = 0; i < pendingVerification.length; i++) {
        const compra = pendingVerification[i];
        try {
          // Re-read the current DB record instead of verifying the stale
          // in-memory snapshot captured at import time: verifyCompra() spreads
          // `...compra` under the verification fields it sets, so verifying the
          // stale object would silently revert a link (linkedInvoiceId /
          // linkedCustomerId / linkNote) the user set while this deferred pass
          // was still running.
          const current = (await ComprasDatabase.getCompraById(compra.id)) ?? compra;
          const verified = await CompraVerificationService.verifyCompra(current, isProduction);
          await ComprasDatabase.insertCompra(verified, { origin: 'import' });
        } catch (verifyErr) {
          console.warn('ImapImportService: auto-verify falló', verifyErr);
        }
        onVerifyProgress?.(i + 1, total);
      }
    }

    return { imported, skipped, errors, receptorMismatch };
  }
}
