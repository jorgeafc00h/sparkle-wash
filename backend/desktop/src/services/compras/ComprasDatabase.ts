// ComprasDatabase — Implementación en memoria con persistencia via appStorage
// Reemplaza el stub original con almacenamiento real

import type { Compra, ComprasFilters, ComprasMonthlyTotal, CompanyGmailAccount } from '@/types/compras';
import { appStorage } from '../storage/ElectronStorage';
import { SecureStorageService } from '../security/SecureStorageService';
import { DTEJsonParser, type ParsedDTE } from './DTEJsonParser';

// ── Claves de storage ─────────────────────────────────────────────────────────

function comprasKey(companyId: string): string {
  return `compras_db_${companyId}`;
}

function gmailKey(companyId: string): string {
  return `compras_gmail_${companyId}`;
}

// Última sincronización manual (Gmail/IMAP) por empresa — usada para
// aplicar el rate limit diario del tier Lite (free).
function lastManualSyncKey(companyId: string): string {
  return `compras_last_manual_sync_${companyId}`;
}

// ── Cache en memoria ──────────────────────────────────────────────────────────
// Map<companyId, Compra[]>
const cache = new Map<string, Compra[]>();
// Set de companyIds cuya data ya fue cargada desde storage
const loaded = new Set<string>();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loadCompanyData(companyId: string): Promise<Compra[]> {
  if (loaded.has(companyId)) {
    return cache.get(companyId) ?? [];
  }

  try {
    const raw = await appStorage.getItem(comprasKey(companyId));
    if (raw) {
      const data = JSON.parse(raw) as Compra[];
      cache.set(companyId, Array.isArray(data) ? data : []);
    } else {
      cache.set(companyId, []);
    }
  } catch {
    // JSON corrupto: se guarda aparte antes de empezar vacío — el siguiente
    // persist lo sobrescribiría para siempre.
    try {
      const raw = await appStorage.getItem(comprasKey(companyId));
      if (raw) await appStorage.setItem(`${comprasKey(companyId)}.corrupt-${Date.now()}`, raw);
    } catch {
      // best effort
    }
    cache.set(companyId, []);
  }

  loaded.add(companyId);
  return cache.get(companyId)!;
}

async function persistCompanyData(companyId: string): Promise<void> {
  const data = cache.get(companyId) ?? [];
  try {
    await appStorage.setItem(comprasKey(companyId), JSON.stringify(data));
  } catch (error) {
    // El llamador ya modificó el cache: se descarta para que la próxima lectura
    // recargue lo que realmente quedó en disco.
    cache.delete(companyId);
    loaded.delete(companyId);
    throw error;
  }
}

function matchesFilters(compra: Compra, filters: ComprasFilters): boolean {
  if (compra.companyId !== filters.companyId) return false;

  if (filters.searchTerm) {
    const term = filters.searchTerm.toLowerCase();
    const inNit = compra.emisorNit.toLowerCase().includes(term);
    const inNombre = compra.emisorNombre.toLowerCase().includes(term);
    const inControl = compra.numeroControl.toLowerCase().includes(term);
    const inCodGen = compra.codigoGeneracion.toLowerCase().includes(term);
    if (!inNit && !inNombre && !inControl && !inCodGen) return false;
  }

  if (filters.dateFrom && compra.fecha < filters.dateFrom) return false;
  if (filters.dateTo && compra.fecha > filters.dateTo) return false;
  if (filters.tipoDte && compra.tipoDte !== filters.tipoDte) return false;
  if (filters.source && compra.source !== filters.source) return false;

  return true;
}

// ── Device Sync v2: captura de cambios locales ──────────────────────────────
// Toda mutación LOCAL (importación, alta manual, verificación, vínculo, borrado)
// notifica al outbox de sincronización. Las escrituras del relay
// (upsertFromSync/deleteFromSync) nunca notifican, así un cambio recibido no se
// reenvía como eco.

export interface CompraChangeEvent {
  op: 'upsert' | 'delete';
  id: string;
  companyId: string;
  updatedAt: string;
  codigoGeneracion?: string;
  numeroControl?: string;
  /** What kind of local write produced the event (read by the local audit log). */
  kind?: 'create' | 'update' | 'delete';
  /** Supplier name, for human-readable audit entries. */
  emisorNombre?: string;
  /** 'import' = written by the email import/auto-verify pass, not by a person. */
  origin?: CompraWriteOrigin;
}

export type CompraWriteOrigin = 'user' | 'import';

export type CompraChangeListener = (event: CompraChangeEvent) => void;

// The Device-Sync capture owns the single `changeListener` slot; any other
// observer (the local audit log) subscribes through `addChangeListener`.
let changeListener: CompraChangeListener | null = null;
const extraListeners = new Set<CompraChangeListener>();

function emitChange(
  op: CompraChangeEvent['op'],
  compra: Compra,
  updatedAt?: string,
  kind: CompraChangeEvent['kind'] = op === 'delete' ? 'delete' : 'update',
  origin: CompraWriteOrigin = 'user',
): void {
  if (!changeListener && extraListeners.size === 0) return;
  const event: CompraChangeEvent = {
    op,
    id: compra.id,
    companyId: compra.companyId,
    updatedAt: updatedAt ?? compra.updatedAt ?? new Date().toISOString(),
    codigoGeneracion: compra.codigoGeneracion,
    numeroControl: compra.numeroControl,
    kind,
    emisorNombre: compra.emisorNombreComercial || compra.emisorNombre,
    origin,
  };
  for (const listener of [changeListener, ...extraListeners]) {
    if (!listener) continue;
    try {
      listener(event);
    } catch (error) {
      console.warn('ComprasDatabase: change listener failed', error);
    }
  }
}

// ── Clase pública ─────────────────────────────────────────────────────────────

export class ComprasDatabase {
  static setChangeListener(listener: CompraChangeListener | null): void {
    changeListener = listener;
  }

  /** Additional observer (does not replace the sync listener). Returns an unsubscribe. */
  static addChangeListener(listener: CompraChangeListener): () => void {
    extraListeners.add(listener);
    return () => {
      extraListeners.delete(listener);
    };
  }

  /**
   * Inicializa la base de datos (no-op para implementación en memoria).
   */
  static async init(): Promise<void> {
    // No se requiere inicialización para almacenamiento en memoria
  }

  static async initialize(): Promise<void> {
    return ComprasDatabase.init();
  }

  /**
   * Obtiene compras aplicando los filtros indicados.
   */
  static async getCompras(filters: ComprasFilters): Promise<Compra[]> {
    const data = await loadCompanyData(filters.companyId);
    const result = data.filter((c) => matchesFilters(c, filters));
    // Ordenar por fecha descendente (más recientes primero)
    result.sort((a, b) => b.fecha.localeCompare(a.fecha));
    return result;
  }

  /**
   * Obtiene una compra por su ID.
   */
  static async getCompraById(id: string): Promise<Compra | null> {
    // Buscar en todo el cache
    for (const compras of cache.values()) {
      const found = compras.find((c) => c.id === id);
      if (found) return found;
    }

    // Si el cache está vacío o no se encontró, buscar en todas las claves conocidas
    const allKeys = await appStorage.getAllKeys();
    for (const key of allKeys) {
      if (!key.startsWith('compras_db_')) continue;
      const companyId = key.replace('compras_db_', '');
      const data = await loadCompanyData(companyId);
      const found = data.find((c) => c.id === id);
      if (found) return found;
    }

    return null;
  }

  /**
   * Inserta una nueva compra.
   */
  static async insertCompra(compra: Compra, options: { origin?: CompraWriteOrigin } = {}): Promise<void> {
    const data = await loadCompanyData(compra.companyId);
    // Evitar duplicados por ID
    const idx = data.findIndex((c) => c.id === compra.id);
    let stored = compra;
    if (idx >= 0) {
      // Actualización (p.ej. verificación MH): si el llamador no avanzó updatedAt,
      // lo avanzamos — la sincronización resuelve por último-en-escribir.
      const previous = data[idx].updatedAt ?? '';
      if (!compra.updatedAt || compra.updatedAt <= previous) {
        stored = { ...compra, updatedAt: new Date().toISOString() };
      }
      data[idx] = stored;
    } else {
      data.push(stored);
    }
    cache.set(compra.companyId, data);
    await persistCompanyData(compra.companyId);
    emitChange('upsert', stored, undefined, idx >= 0 ? 'update' : 'create', options.origin);
  }

  // ── Device Sync v2: escrituras del relay (nunca notifican) ─────────────────

  /**
   * Guarda una compra fusionada desde otro dispositivo. `existingId` es el registro
   * local que el motor de fusión emparejó (por id, codigoGeneracion o numeroControl):
   * se conserva el id local para no romper vínculos ni cuentas por pagar.
   */
  static async upsertFromSync(compra: Compra, existingId?: string): Promise<void> {
    const data = await loadCompanyData(compra.companyId);
    const targetId = existingId ?? compra.id;
    const idx = data.findIndex((c) => c.id === targetId);
    const merged: Compra = idx >= 0
      ? { ...data[idx], ...compra, id: targetId, pdfPath: data[idx].pdfPath, ocrImageUri: data[idx].ocrImageUri }
      : { ...compra, id: targetId, pdfPath: undefined, ocrImageUri: undefined };
    if (idx >= 0) data[idx] = merged;
    else data.push(merged);
    cache.set(compra.companyId, data);
    await persistCompanyData(compra.companyId);
  }

  static async deleteFromSync(id: string): Promise<void> {
    for (const [companyId, compras] of cache.entries()) {
      const idx = compras.findIndex((c) => c.id === id);
      if (idx >= 0) {
        compras.splice(idx, 1);
        cache.set(companyId, compras);
        await persistCompanyData(companyId);
        return;
      }
    }
  }

  /**
   * Actualiza los campos de vinculación (linkedInvoiceId / linkedCustomerId /
   * linkNote) de una compra existente. Busca primero en el cache ya cargado
   * (rápido, cubre el caso común de venir de una pantalla que ya cargó la
   * empresa) y si no la encuentra recorre las claves `compras_db_*` conocidas
   * (mismo fallback que `getCompraById`). Devuelve la compra actualizada, o
   * `null` si no existe. Usamos un método dedicado (en vez de reusar
   * `insertCompra`, que es un upsert por objeto completo) para evitar
   * condiciones de carrera al re-persistir sólo los 3 campos de vínculo.
   */
  static async updateCompraLink(
    id: string,
    link: { linkedInvoiceId: string | null; linkedCustomerId: string | null; linkNote: string | null },
  ): Promise<Compra | null> {
    // Buscar en todo el cache ya cargado.
    for (const [companyId, compras] of cache.entries()) {
      const idx = compras.findIndex((c) => c.id === id);
      if (idx >= 0) {
        const updated: Compra = { ...compras[idx], ...link, updatedAt: new Date().toISOString() };
        compras[idx] = updated;
        cache.set(companyId, compras);
        await persistCompanyData(companyId);
        emitChange('upsert', updated);
        return updated;
      }
    }

    // No estaba en cache — recorrer las claves conocidas (empresas aún no cargadas).
    const allKeys = await appStorage.getAllKeys();
    for (const key of allKeys) {
      if (!key.startsWith('compras_db_')) continue;
      const companyId = key.replace('compras_db_', '');
      const data = await loadCompanyData(companyId);
      const idx = data.findIndex((c) => c.id === id);
      if (idx >= 0) {
        const updated: Compra = { ...data[idx], ...link, updatedAt: new Date().toISOString() };
        data[idx] = updated;
        cache.set(companyId, data);
        await persistCompanyData(companyId);
        emitChange('upsert', updated);
        return updated;
      }
    }

    return null;
  }

  /**
   * Elimina una compra por ID.
   */
  static async deleteCompra(id: string): Promise<void> {
    // Buscar en todo el cache cargado
    for (const [companyId, compras] of cache.entries()) {
      const idx = compras.findIndex((c) => c.id === id);
      if (idx >= 0) {
        const [removed] = compras.splice(idx, 1);
        cache.set(companyId, compras);
        await persistCompanyData(companyId);
        emitChange('delete', removed, new Date().toISOString());
        return;
      }
    }
  }

  static async deleteCompanyData(companyId: string): Promise<void> {
    cache.delete(companyId);
    loaded.delete(companyId);
    await Promise.all([
      appStorage.removeItem(comprasKey(companyId)),
      appStorage.removeItem(gmailKey(companyId)),
      appStorage.removeItem(lastManualSyncKey(companyId)),
      SecureStorageService.removeGmailCredentials(companyId),
    ]);
  }

  // ── Backfill: campos de desglose fiscal del DTE ──────────────────────────
  //
  // Compras guardadas antes de agregar los campos de desglose fiscal
  // (totalNoSuj/totalExenta/subTotal/ivaRete1/reteRenta/montoTotalOperacion/
  // tipoMoneda/horaEmision/receptor*) no los tienen, aunque su DTE fuente
  // (originalJson) sigue teniendo esos datos. Esto re-parsea originalJson
  // para cada compra a la que le falte al menos uno de esos campos y los
  // rellena, reusando DTEJsonParser.parseDTEObject como única fuente de
  // verdad para que el valor de backfill sea idéntico al de una sync nueva.
  //
  // Idempotente y barato de re-ejecutar: solo re-persiste las empresas que
  // tuvieron al menos un cambio; si ya está todo backfilled, es una sola
  // pasada en memoria sin escritura a storage. NO se ejecuta automáticamente
  // (ComprasDatabase.init/initialize son no-op) — llamar explícitamente
  // (p.ej. desde una acción de configuración o un hook de actualización de
  // la app) para evitar una reescritura completa de storage en cada arranque.
  static async backfillTaxBreakdownFields(companyId?: string): Promise<{ scanned: number; updated: number }> {
    let scanned = 0;
    let updated = 0;

    const companyIds: string[] = [];
    if (companyId) {
      companyIds.push(companyId);
    } else {
      const allKeys = await appStorage.getAllKeys();
      for (const key of allKeys) {
        if (key.startsWith('compras_db_')) {
          companyIds.push(key.replace('compras_db_', ''));
        }
      }
    }

    for (const cid of companyIds) {
      const data = await loadCompanyData(cid);
      let changed = false;

      for (let i = 0; i < data.length; i++) {
        const c = data[i];
        if (!c.originalJson) continue;

        const missingAField =
          c.totalNoSuj === undefined ||
          c.totalExenta === undefined ||
          c.subTotal === undefined ||
          c.ivaRete1 === undefined ||
          c.reteRenta === undefined ||
          c.montoTotalOperacion === undefined ||
          c.tipoMoneda === undefined ||
          c.receptorNit === undefined ||
          c.horaEmision === undefined ||
          c.receptorNombre === undefined ||
          c.receptorNrc === undefined;
        if (!missingAField) continue;

        scanned++;
        try {
          const dte = JSON.parse(c.originalJson) as ParsedDTE;
          const parsed = DTEJsonParser.parseDTEObject(dte, cid);
          if (!parsed) continue;

          data[i] = {
            ...c,
            totalNoSuj: parsed.totalNoSuj,
            totalExenta: parsed.totalExenta,
            subTotal: parsed.subTotal,
            ivaRete1: parsed.ivaRete1,
            reteRenta: parsed.reteRenta,
            montoTotalOperacion: parsed.montoTotalOperacion,
            tipoMoneda: parsed.tipoMoneda,
            horaEmision: parsed.horaEmision,
            receptorNit: parsed.receptorNit,
            receptorNombre: parsed.receptorNombre,
            receptorNrc: parsed.receptorNrc,
          };
          changed = true;
          updated++;
        } catch {
          // originalJson no parseable — se deja la compra sin tocar
        }
      }

      if (changed) {
        cache.set(cid, data);
        await persistCompanyData(cid);
      }
    }

    return { scanned, updated };
  }

  /**
   * Obtiene los totales del mes indicado para una empresa.
   */
  static async getMonthlyTotals(
    companyId: string,
    yearOrDateFrom?: number | string,
    monthOrDateTo?: number | string,
  ): Promise<ComprasMonthlyTotal> {
    const data = await loadCompanyData(companyId);

    let year: number;
    let month: number;

    if (typeof yearOrDateFrom === 'number' && typeof monthOrDateTo === 'number') {
      year = yearOrDateFrom;
      month = monthOrDateTo;
    } else {
      const now = new Date();
      year = now.getFullYear();
      month = now.getMonth() + 1;
    }

    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    // Uso interno no forma parte de los totales fiscales del mes.
    const monthlyData = data.filter((c) => c.fecha.startsWith(monthStr) && c.internalUse !== true);

    const totalGravada = monthlyData.reduce((acc, c) => acc + c.totalGravada, 0);
    const totalIva = monthlyData.reduce((acc, c) => acc + c.totalIva, 0);
    const totalPagar = monthlyData.reduce((acc, c) => acc + c.totalPagar, 0);

    return {
      year,
      month,
      totalGravada,
      totalIva,
      totalPagar,
      count: monthlyData.length,
    };
  }

  /**
   * Obtiene la cuenta Gmail vinculada a la empresa.
   */
  static async getLinkedGmail(companyId: string): Promise<CompanyGmailAccount | null> {
    try {
      const raw = await appStorage.getItem(gmailKey(companyId));
      if (!raw) return null;
      const account = JSON.parse(raw) as CompanyGmailAccount;
      const secureCreds = await SecureStorageService.getGmailCredentials(companyId);

      if ((account.accessToken || account.refreshToken) && !secureCreds) {
        await SecureStorageService.setGmailCredentials(companyId, {
          accessToken: account.accessToken,
          refreshToken: account.refreshToken,
        });
        delete account.accessToken;
        delete account.refreshToken;
        await appStorage.setItem(gmailKey(companyId), JSON.stringify(account));
      }

      const migratedCreds = secureCreds ?? await SecureStorageService.getGmailCredentials(companyId);
      return {
        ...account,
        accessToken: migratedCreds?.accessToken,
        refreshToken: migratedCreds?.refreshToken,
      };
    } catch {
      return null;
    }
  }

  /**
   * Vincula una cuenta Gmail a la empresa.
   */
  static async linkGmail(
    companyId: string,
    email: string,
    accessToken?: string,
    refreshToken?: string,
    meta: { googleAccountId?: string; tokenExpiresAt?: number } = {},
  ): Promise<void> {
    const existing = await ComprasDatabase.getLinkedGmail(companyId);
    const account: CompanyGmailAccount = {
      companyId,
      email,
      googleAccountId: meta.googleAccountId ?? existing?.googleAccountId,
      tokenExpiresAt: meta.tokenExpiresAt,
      lastHistoryId: existing?.lastHistoryId,
      linkedAt: existing?.linkedAt ?? new Date().toISOString(),
    };
    if (accessToken || refreshToken || existing?.accessToken || existing?.refreshToken) {
      await SecureStorageService.setGmailCredentials(companyId, {
        accessToken: accessToken ?? existing?.accessToken,
        refreshToken: refreshToken ?? existing?.refreshToken,
      });
    }
    await appStorage.setItem(gmailKey(companyId), JSON.stringify(account));
  }

  /**
   * Desvincula la cuenta Gmail de la empresa.
   */
  static async unlinkGmail(companyId: string): Promise<void> {
    await Promise.all([
      appStorage.removeItem(gmailKey(companyId)),
      SecureStorageService.removeGmailCredentials(companyId),
    ]);
  }

  /**
   * Verifica si ya existe una compra con el codigoGeneracion dado. Con
   * `companyId` busca solo en esa empresa: un DTE importado en otra empresa
   * (p. ej. el clon TEST de la misma empresa PROD) no debe ocultarlo aquí.
   */
  static async existsByCodigoGeneracion(codigoGeneracion: string, companyId?: string): Promise<boolean> {
    if (companyId) {
      const data = await loadCompanyData(companyId);
      return data.some((c) => c.codigoGeneracion === codigoGeneracion);
    }
    for (const compras of cache.values()) {
      if (compras.some((c) => c.codigoGeneracion === codigoGeneracion)) return true;
    }

    // Buscar en storage si no está en cache
    const allKeys = await appStorage.getAllKeys();
    for (const key of allKeys) {
      if (!key.startsWith('compras_db_')) continue;
      const companyId = key.replace('compras_db_', '');
      const data = await loadCompanyData(companyId);
      if (data.some((c) => c.codigoGeneracion === codigoGeneracion)) return true;
    }

    return false;
  }

  /**
   * Verifica si ya existe una compra importada desde el mensaje Gmail/IMAP
   * indicado. Con `companyId` busca solo en esa empresa (buzón compartido).
   */
  static async existsByGmailMessageId(messageId: string, companyId?: string): Promise<boolean> {
    if (companyId) {
      const data = await loadCompanyData(companyId);
      return data.some((c) => c.gmailMessageId === messageId);
    }
    for (const compras of cache.values()) {
      if (compras.some((c) => c.gmailMessageId === messageId)) return true;
    }

    const allKeys = await appStorage.getAllKeys();
    for (const key of allKeys) {
      if (!key.startsWith('compras_db_')) continue;
      const companyId = key.replace('compras_db_', '');
      const data = await loadCompanyData(companyId);
      if (data.some((c) => c.gmailMessageId === messageId)) return true;
    }

    return false;
  }

  /**
   * Retorna el número total de compras registradas para una empresa.
   */
  static async getCount(companyId: string): Promise<number> {
    const data = await loadCompanyData(companyId);
    return data.length;
  }

  // ── Rate limit de sincronización manual (tier Lite) ──────────────────
  // El tier gratis está limitado a 1 sync manual cada 24h. Guardamos el
  // timestamp de la última sincronización exitosa por empresa.

  static async getLastManualSync(companyId: string): Promise<string | null> {
    try {
      const raw = await appStorage.getItem(lastManualSyncKey(companyId));
      return raw ?? null;
    } catch {
      return null;
    }
  }

  static async setLastManualSync(companyId: string, isoTimestamp: string): Promise<void> {
    await appStorage.setItem(lastManualSyncKey(companyId), isoTimestamp);
  }

  /**
   * Dado el timestamp de la última sync y la política del tier, calcula cuántos
   * ms faltan para la próxima sync permitida. Retorna 0 si ya está permitido.
   */
  static msUntilNextLiteSync(lastIso: string | null, cooldownHours = 24): number {
    if (!lastIso) return 0;
    const last = new Date(lastIso).getTime();
    if (Number.isNaN(last)) return 0;
    const cooldownMs = cooldownHours * 60 * 60 * 1000;
    const remaining = last + cooldownMs - Date.now();
    return Math.max(0, remaining);
  }
}
