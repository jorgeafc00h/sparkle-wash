// GmailImportService — Importa DTEs adjuntos desde Gmail
// Portado desde la app React Native

import type { Compra } from '@/types/compras';
import { decodeBase64ToText as decodeAttachmentBase64 } from './textDecoding';
import { CompraSource } from '@/types/compras';
import { DTEJsonParser } from './DTEJsonParser';
import { ComprasDatabase } from './ComprasDatabase';
import { isAddressedToCompany, resolveCompanyIdentity } from './receptorMatch';
import { CompraVerificationService } from './CompraVerificationService';

// ── Tipos internos Gmail ───────────────────────────────────────────────────────

interface GmailMessageHeader {
  name: string;
  value: string;
}

interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailMessageHeader[];
  body?: {
    attachmentId?: string;
    size?: number;
    data?: string;
  };
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
}

export interface GmailMessageDetail {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  payload?: GmailMessagePart;
}

interface GmailAttachmentResponse {
  attachmentId?: string;
  size?: number;
  data?: string;
}

// ── Constantes ────────────────────────────────────────────────────────────────

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1';

// Búsqueda: mensajes con adjuntos JSON, TXT o PDF. Algunos proveedores envían
// el DTE en un archivo .txt cuyo contenido es JSON — se maneja igual que .json.
// El filtro fino por extensión y el emparejamiento JSON↔PDF se hacen del lado del cliente.
const GMAIL_SEARCH_QUERY = 'has:attachment (filename:json OR filename:txt OR filename:pdf)';

// Extensiones aceptadas para contenido DTE (ambas se intentan parsear como JSON)
const JSON_LIKE_EXTENSIONS = ['.json', '.txt'];

export interface SyncDateRange {
  /** Fecha desde (inclusive, formato YYYY-MM-DD). Si no se indica, sin límite inferior. */
  afterDate?: string;
  /** Fecha hasta (inclusive, formato YYYY-MM-DD). Si no se indica, sin límite superior. */
  beforeDate?: string;
}

export interface SyncResult {
  imported: number;
  skipped: number;
  errors: number;
  /** DTEs addressed to another NIT/NRC (shared inbox) — not imported. */
  receptorMismatch?: number;
  /** true si la sincronización falló por token inválido o scope insuficiente (401/403). */
  authError?: boolean;
  /** true si el usuario (o el proyecto GCP) agotó su cuota diaria de Gmail API (HTTP 429). */
  quotaExceeded?: boolean;
  /** Mensaje descriptivo del error no recuperable (si lo hubo). */
  errorMessage?: string;
}

/** Error interno que representa una falla de autenticación irrecuperable sin re-auth. */
class GmailAuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'GmailAuthError';
    this.status = status;
  }
}

/** Error interno cuando Gmail responde HTTP 429 — cuota de API agotada. */
class GmailQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GmailQuotaError';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function decodeBase64Url(data: string): string {
  // Gmail usa base64url (- en lugar de +, _ en lugar de /).
  // Antes esto devolvía `atob(...)` directamente: una cadena binaria latin1, de
  // modo que TODO nombre acentuado en UTF-8 se guardaba como mojibake
  // ("CAFÉ" → "CAFÃ‰"). decodeAttachmentBase64 detecta el charset real.
  return decodeAttachmentBase64(data);
}

// Convierte base64url a base64 estándar con padding — formato que Node.js
// espera en fs.writeFile(..., 'base64') para escribir bytes binarios.
function base64UrlToPaddedBase64(data: string): string {
  let b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  return b64;
}

function hasExtension(filename: string | undefined, ext: string): boolean {
  return !!filename && filename.toLowerCase().endsWith(ext);
}

function hasAnyExtension(filename: string | undefined, exts: string[]): boolean {
  return exts.some((ext) => hasExtension(filename, ext));
}

// Convierte "YYYY-MM-DD" al formato "YYYY/MM/DD" que espera la búsqueda de Gmail.
function toGmailDate(isoDate: string | undefined): string | undefined {
  if (!isoDate) return undefined;
  return isoDate.replace(/-/g, '/');
}

function stripExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.substring(0, idx) : filename;
}

function flattenParts(part: GmailMessagePart): GmailMessagePart[] {
  const results: GmailMessagePart[] = [];
  if (part.filename && part.body?.attachmentId) {
    results.push(part);
  }
  if (part.parts) {
    for (const child of part.parts) {
      results.push(...flattenParts(child));
    }
  }
  return results;
}

// Guarda los bytes de un PDF en userData/purchases/{companyId}/{codigoGeneracion}.pdf.
// Retorna la ruta absoluta en disco, o null cuando no estamos en Electron
// (ej. `npm run dev` sin el shell de Electron) o si la escritura falla.
async function savePdfLocally(
  companyId: string,
  codigoGeneracion: string,
  base64urlData: string,
): Promise<string | null> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api?.writeFile || !api?.getAppPath) {
    return null;
  }
  try {
    const userData = await api.getAppPath('userData');
    const safeCodGen = codigoGeneracion.replace(/[^A-Za-z0-9-]/g, '_');
    const targetPath = `${userData}/purchases/${companyId}/${safeCodGen}.pdf`;
    const base64 = base64UrlToPaddedBase64(base64urlData);
    await api.writeFile(targetPath, base64, 'base64');
    return targetPath;
  } catch (err) {
    console.warn('GmailImportService: error al guardar PDF local', err);
    return null;
  }
}

// ── Servicio ──────────────────────────────────────────────────────────────────

export class GmailImportService {
  /**
   * Sincroniza compras para una empresa desde Gmail.
   * Busca mensajes con adjuntos JSON y los importa como Compras.
   */
  /**
   * Sincroniza compras desde Gmail. Por defecto además verifica automáticamente
   * cada compra nueva contra la Consulta Pública del MH. Pasar `autoVerify:false`
   * si el llamador quiere verificar en batch más tarde.
   */
  static async syncComprasForCompany(
    companyId: string,
    accessToken: string,
    dateRange?: SyncDateRange,
    options?: { autoVerify?: boolean; isProduction?: boolean },
  ): Promise<SyncResult> {
    const autoVerify = options?.autoVerify ?? true;
    const isProduction = options?.isProduction ?? true;
    let imported = 0;
    let skipped = 0;
    let errors = 0;
    // DTEs addressed to another taxpayer (shared inbox) are skipped and reported.
    const companyIdentity = resolveCompanyIdentity(companyId);
    let receptorMismatch = 0;

    try {
      // De-dup vía DB: existsByGmailMessageId filtra mensajes ya importados
      // antes de llamar getMessageDetail, ahorrando ~5 unidades de cuota por
      // mensaje repetido. En sync repetido esto reduce el costo de N*5 a ~0.
      const messages = await GmailImportService.searchMessages(accessToken, dateRange);

      for (const message of messages) {
        try {
          // Verificar si ya fue importado
          const alreadyExists = await ComprasDatabase.existsByGmailMessageId(message.id, companyId);
          if (alreadyExists) {
            skipped++;
            continue;
          }

          const detail = await GmailImportService.getMessageDetail(accessToken, message.id);
          if (!detail.payload) {
            skipped++;
            continue;
          }

          const allParts = flattenParts(detail.payload);
          // Aceptamos .json y .txt como contenedores de DTE JSON — algunos
          // proveedores envían el JSON con extensión .txt.
          const jsonLikeParts = allParts.filter((p) => hasAnyExtension(p.filename, JSON_LIKE_EXTENSIONS));
          const pdfParts = allParts.filter((p) => hasExtension(p.filename, '.pdf'));

          if (jsonLikeParts.length === 0) {
            // Sin JSON/TXT no hay DTE que registrar; los PDFs huérfanos se ignoran.
            skipped++;
            continue;
          }

          // Pre-descarga los PDFs una sola vez para emparejarlos con los JSON del mismo correo.
          const pdfCache: Array<{ stem: string; data: string }> = [];
          for (const pdf of pdfParts) {
            const attId = pdf.body?.attachmentId;
            if (!attId || !pdf.filename) continue;
            try {
              const raw = await GmailImportService.getAttachmentRaw(accessToken, message.id, attId);
              if (raw) pdfCache.push({ stem: stripExtension(pdf.filename), data: raw });
            } catch (pdfErr) {
              console.warn('GmailImportService: error descargando PDF', pdfErr);
            }
          }
          const usedPdfIndexes = new Set<number>();

          let messageImported = false;
          for (const part of jsonLikeParts) {
            try {
              const attachmentId = part.body?.attachmentId;
              if (!attachmentId) continue;

              const content = await GmailImportService.getAttachment(
                accessToken,
                message.id,
                attachmentId,
              );

              if (!content) continue;

              const compra = DTEJsonParser.parse(content, companyId, CompraSource.Email, message.id);
              if (!compra) continue;
              if (!isAddressedToCompany(compra, companyIdentity)) {
                receptorMismatch++;
                continue;
              }

              // Verificar duplicado por codigoGeneracion (solo en esta empresa)
              const codGenExists = await ComprasDatabase.existsByCodigoGeneracion(
                compra.codigoGeneracion,
                companyId,
              );
              if (codGenExists) {
                skipped++;
                continue;
              }

              // Emparejar PDF con el DTE: primero por nombre (contiene codigoGeneracion),
              // como fallback cualquier PDF no usado del mismo correo (caso típico: 1 JSON + 1 PDF).
              let pdfIdx = pdfCache.findIndex(
                (p, i) => !usedPdfIndexes.has(i) && p.stem.includes(compra.codigoGeneracion),
              );
              if (pdfIdx < 0) {
                pdfIdx = pdfCache.findIndex((_, i) => !usedPdfIndexes.has(i));
              }
              if (pdfIdx >= 0) {
                usedPdfIndexes.add(pdfIdx);
                const savedPath = await savePdfLocally(
                  companyId,
                  compra.codigoGeneracion,
                  pdfCache[pdfIdx].data,
                );
                if (savedPath) compra.pdfPath = savedPath;
              }

              await ComprasDatabase.insertCompra(compra, { origin: 'import' });
              messageImported = true;

              // Auto-verificación contra Consulta Pública del MH.
              // Se hace después del insert para que la compra quede visible
              // inmediatamente, y se re-guarda cuando llega el sello.
              // Fallos de red aquí NO afectan el contador de imported/errors
              // porque el CompraVerificationService atrapa sus propios errores.
              if (autoVerify) {
                try {
                  const verified = await CompraVerificationService.verifyCompra(
                    compra,
                    isProduction,
                  );
                  if (verified !== compra) {
                    await ComprasDatabase.insertCompra(verified, { origin: 'import' });
                  }
                } catch (verifyErr) {
                  console.warn('GmailImportService: auto-verify falló', verifyErr);
                }
              }
            } catch (attachErr) {
              if (attachErr instanceof GmailAuthError || attachErr instanceof GmailQuotaError) throw attachErr;
              console.warn('GmailImportService: error procesando adjunto', attachErr);
              errors++;
            }
          }

          if (messageImported) imported++;
          else skipped++;
        } catch (msgErr) {
          if (msgErr instanceof GmailAuthError || msgErr instanceof GmailQuotaError) throw msgErr;
          console.warn('GmailImportService: error procesando mensaje', message.id, msgErr);
          errors++;
        }
      }
    } catch (error) {
      console.error('GmailImportService.syncComprasForCompany: error general', error);
      if (error instanceof GmailAuthError) {
        return {
          imported,
          skipped,
          errors: errors + 1,
          authError: true,
          errorMessage:
            error.status === 401
              ? 'Token de Gmail inválido o expirado. Vuelve a conectar la cuenta.'
              : 'Permiso insuficiente (scope). Reconecta Gmail y otorga el permiso "Leer tus mensajes de Gmail".',
        };
      }
      if (error instanceof GmailQuotaError) {
        return {
          imported,
          skipped,
          errors: errors + 1,
          quotaExceeded: true,
          errorMessage: error.message,
        };
      }
      errors++;
      return {
        imported,
        skipped,
        errors,
        errorMessage: (error as Error)?.message ?? 'Error de sincronización',
      };
    }

    return { imported, skipped, errors, receptorMismatch };
  }

  /**
   * Busca mensajes en Gmail con adjuntos JSON (DTEs).
   */
  static async searchMessages(
    accessToken: string,
    dateRange?: SyncDateRange,
  ): Promise<GmailMessage[]> {
    try {
      const parts: string[] = [GMAIL_SEARCH_QUERY];
      const afterGmail = toGmailDate(dateRange?.afterDate);
      const beforeGmail = toGmailDate(dateRange?.beforeDate);
      if (afterGmail) parts.push(`after:${afterGmail}`);
      if (beforeGmail) parts.push(`before:${beforeGmail}`);
      const query = parts.join(' ');

      // maxResults=500 es el máximo de Gmail — una sola llamada en lugar de
      // paginar. Sigue costando 5 unidades de cuota igual que maxResults=100.
      const params = new URLSearchParams({ q: query, maxResults: '500' });
      const url = `${GMAIL_API_BASE}/users/me/messages?${params.toString()}`;

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (response.status === 401 || response.status === 403) {
        throw new GmailAuthError(
          response.status,
          `Gmail search denied: HTTP ${response.status}`,
        );
      }
      if (response.status === 429) {
        throw new GmailQuotaError('Cuota diaria de Gmail API agotada. Intenta mañana.');
      }

      if (!response.ok) {
        console.warn(`GmailImportService.searchMessages: HTTP ${response.status}`);
        return [];
      }

      const data = await response.json();
      return (data.messages as GmailMessage[]) ?? [];
    } catch (error) {
      if (error instanceof GmailAuthError) throw error;
      console.error('GmailImportService.searchMessages: error', error);
      return [];
    }
  }

  /**
   * Obtiene el detalle completo de un mensaje de Gmail incluyendo partes/adjuntos.
   */
  static async getMessageDetail(
    accessToken: string,
    messageId: string,
  ): Promise<GmailMessageDetail> {
    // fields= limita el payload a lo estrictamente necesario (partes + adjuntos).
    // Misma cuota (5 unidades), ~60% menos bytes de transferencia.
    const fields = 'id,threadId,internalDate,payload(partId,mimeType,filename,body(attachmentId,size),parts(partId,mimeType,filename,body(attachmentId,size),parts(partId,mimeType,filename,body(attachmentId,size))))';
    const url = `${GMAIL_API_BASE}/users/me/messages/${messageId}?fields=${encodeURIComponent(fields)}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (response.status === 401 || response.status === 403) {
      throw new GmailAuthError(response.status, `Gmail message denied: HTTP ${response.status}`);
    }
    if (response.status === 429) {
      throw new GmailQuotaError('Cuota diaria de Gmail API agotada. Intenta mañana.');
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} al obtener detalle del mensaje ${messageId}`);
    }

    return response.json() as Promise<GmailMessageDetail>;
  }

  /**
   * Descarga el contenido crudo (base64url) de un adjunto, útil para binarios como PDF.
   */
  static async getAttachmentRaw(
    accessToken: string,
    messageId: string,
    attachmentId: string,
  ): Promise<string> {
    const url = `${GMAIL_API_BASE}/users/me/messages/${messageId}/attachments/${attachmentId}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (response.status === 401 || response.status === 403) {
      throw new GmailAuthError(response.status, `Gmail attachment denied: HTTP ${response.status}`);
    }
    if (response.status === 429) {
      throw new GmailQuotaError('Cuota diaria de Gmail API agotada. Intenta mañana.');
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} al descargar adjunto ${attachmentId}`);
    }

    const data = (await response.json()) as GmailAttachmentResponse;
    return data.data ?? '';
  }

  /**
   * Descarga y decodifica el contenido de un adjunto textual (p.ej. JSON).
   * Retorna el contenido decodificado como string.
   */
  static async getAttachment(
    accessToken: string,
    messageId: string,
    attachmentId: string,
  ): Promise<string> {
    const raw = await GmailImportService.getAttachmentRaw(accessToken, messageId, attachmentId);
    return raw ? decodeBase64Url(raw) : '';
  }
}
