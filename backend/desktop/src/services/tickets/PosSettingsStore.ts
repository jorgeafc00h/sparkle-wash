// Per-company POS settings (printer config + shop behavior), stored via
// appStorage like the ticket database. Kept out of Redux: it is read-mostly
// configuration, and the printer config is passed per IPC call so the main
// process stays stateless.

import { appStorage } from '../storage/ElectronStorage';
import { normalizeRegisterCode } from './ticketNumber';
import {
  DEFAULT_SCALE_BARCODES,
  normalizeScaleBarcodeSettings,
  type ScaleBarcodeSettings,
} from './scaleBarcode';

export interface PosPrinterSettings {
  transport: 'network' | 'spooler';
  network: { host: string; port: number; timeoutMs: number };
  spooler: { printerName: string };
  paper: { widthMm: 80 | 58; copies: number; cut: boolean };
  headerLines: string[];
  footerLines: string[];
  cashDrawerKick: boolean;
}

export interface PosSettings {
  /** null → printing disabled (tickets saved without paper). */
  printer: PosPrinterSettings | null;
  oversell: 'BLOCK' | 'ALLOW';
  roundingMode: 'NONE' | 'NEAREST_0.05';
  /**
   * This device as a register (POS Phase 2 design §1): name shown on the
   * register and the Z ("Caja 1"). Settings are per company AND per device
   * (appStorage is never synced), so each register keeps its own name and
   * code. Absent = defaults (registerSettingsOf).
   */
  registerName?: string;
  /**
   * Short code printed before ticket numbers ("C1" → C1-000123). Empty by
   * default: a single register keeps the familiar #000123 until a second
   * register joins and each one gets a code.
   */
  registerCode?: string;
  /** Scale (weight/price-embedded EAN-13) labels — absent = disabled. */
  scaleBarcodes?: ScaleBarcodeSettings;
}

export const DEFAULT_REGISTER_NAME = 'Caja 1';

export interface PosRegisterSettings {
  name: string;
  /** '' = no code (display #000123). */
  code: string;
}

export function normalizeRegisterName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim().slice(0, 40) : '';
  return name || DEFAULT_REGISTER_NAME;
}

/** This register's name/code with defaults applied. */
export function registerSettingsOf(settings: Pick<PosSettings, 'registerName' | 'registerCode'>): PosRegisterSettings {
  return { name: normalizeRegisterName(settings.registerName), code: normalizeRegisterCode(settings.registerCode) };
}

/** Scale-label settings with defaults applied (disabled when never configured). */
export function scaleSettingsOf(settings: Pick<PosSettings, 'scaleBarcodes'>): ScaleBarcodeSettings {
  return settings.scaleBarcodes ? normalizeScaleBarcodeSettings(settings.scaleBarcodes) : DEFAULT_SCALE_BARCODES;
}

export const DEFAULT_POS_SETTINGS: PosSettings = {
  printer: null,
  oversell: 'BLOCK',
  roundingMode: 'NONE',
};

export const TM_T20II_PRESET: PosPrinterSettings = {
  transport: 'network',
  // No sample IP: a filled-in example looked configured and only timed out.
  network: { host: '', port: 9100, timeoutMs: 4000 },
  spooler: { printerName: '' },
  paper: { widthMm: 80, copies: 1, cut: true },
  headerLines: ['¡Gracias por su compra!'],
  footerLines: ['Factura disponible a solicitud.'],
  cashDrawerKick: false,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const stringLines = (value: unknown, fallback: string[]): string[] =>
  Array.isArray(value) ? value.filter((line): line is string => typeof line === 'string').slice(0, 20) : fallback;

/**
 * Printer settings as stored may be partial (older builds, hand edits, a
 * half-saved form): every missing or malformed field falls back to the preset
 * default, so the register never crashes on `printer.paper.widthMm` after a
 * sale was already saved. Returns null when there is no printer object.
 */
export function normalizePrinterSettings(raw: unknown): PosPrinterSettings | null {
  if (!isRecord(raw)) return null;
  const preset = TM_T20II_PRESET;
  const network = isRecord(raw.network) ? raw.network : {};
  const spooler = isRecord(raw.spooler) ? raw.spooler : {};
  const paper = isRecord(raw.paper) ? raw.paper : {};
  const port = Number(network.port);
  const timeoutMs = Number(network.timeoutMs);
  const copies = Number(paper.copies);
  return {
    transport: raw.transport === 'spooler' ? 'spooler' : 'network',
    network: {
      host: typeof network.host === 'string' ? network.host.trim() : preset.network.host,
      port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : preset.network.port,
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs >= 500 && timeoutMs <= 60000 ? timeoutMs : preset.network.timeoutMs,
    },
    spooler: {
      printerName: typeof spooler.printerName === 'string' ? spooler.printerName : preset.spooler.printerName,
    },
    paper: {
      widthMm: paper.widthMm === 58 ? 58 : 80,
      copies: Number.isInteger(copies) && copies >= 1 && copies <= 3 ? copies : preset.paper.copies,
      cut: typeof paper.cut === 'boolean' ? paper.cut : preset.paper.cut,
    },
    headerLines: stringLines(raw.headerLines, preset.headerLines),
    footerLines: stringLines(raw.footerLines, preset.footerLines),
    cashDrawerKick: raw.cashDrawerKick === true,
  };
}

/** Full settings with every field validated (missing → defaults). */
export function normalizePosSettings(raw: unknown): PosSettings {
  const parsed = isRecord(raw) ? raw : {};
  return {
    printer: normalizePrinterSettings(parsed.printer),
    oversell: parsed.oversell === 'ALLOW' ? 'ALLOW' : 'BLOCK',
    roundingMode: parsed.roundingMode === 'NEAREST_0.05' ? 'NEAREST_0.05' : 'NONE',
    // Optional sections stay absent until configured (defaults via the *Of helpers).
    ...(typeof parsed.registerName === 'string' && parsed.registerName.trim()
      ? { registerName: normalizeRegisterName(parsed.registerName) }
      : {}),
    ...(normalizeRegisterCode(parsed.registerCode) ? { registerCode: normalizeRegisterCode(parsed.registerCode) } : {}),
    ...(isRecord(parsed.scaleBarcodes) ? { scaleBarcodes: normalizeScaleBarcodeSettings(parsed.scaleBarcodes) } : {}),
  };
}

function key(companyId: string): string {
  return `pos_settings_${companyId}`;
}

const cache = new Map<string, PosSettings>();

export class PosSettingsStore {
  static async get(companyId: string): Promise<PosSettings> {
    if (cache.has(companyId)) return cache.get(companyId)!;
    let settings = DEFAULT_POS_SETTINGS;
    try {
      const raw = await appStorage.getItem(key(companyId));
      if (raw) settings = normalizePosSettings(JSON.parse(raw));
    } catch {
      // Corrupt JSON — defaults.
    }
    cache.set(companyId, settings);
    return settings;
  }

  static async save(companyId: string, settings: PosSettings): Promise<void> {
    const normalized = normalizePosSettings(settings);
    cache.set(companyId, normalized);
    await appStorage.setItem(key(companyId), JSON.stringify(normalized));
  }

  static async clearCache(): Promise<void> {
    cache.clear();
  }
}
