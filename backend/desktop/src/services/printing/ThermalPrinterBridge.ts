// Renderer → main bridge for thermal printing. The main process owns the
// ESC/POS bytes and the transports; the renderer only sends pure payloads
// plus the per-company printer config. Falls back gracefully on web/dev.

import type { ReceiptPayload } from './ReceiptDocument';
import { withBlocks } from './ReceiptDocument';
import type { PosPrinterSettings } from '../tickets/PosSettingsStore';

export interface PrintResult {
  ok: boolean;
  transport?: string;
  error?: string;
  /** Where a spooler (USB) print failed, e.g. "StartDocPrinter", "timeout". */
  stage?: string;
  /** Win32 / socket error code, when there is one. */
  code?: string;
}

export interface PrinterDiagnosticStep {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'error' | 'skip';
  detail: string;
  hint?: string;
  ms?: number;
}

export interface PrinterDiagnostics {
  ok: boolean;
  transport?: string;
  platform?: string;
  steps: PrinterDiagnosticStep[];
  ms?: number;
  error?: string;
}

interface PrinterElectronApi {
  printerList?: () => Promise<string[]>;
  printerPrint?: (config: unknown, payload: ReceiptPayload) => Promise<PrintResult>;
  printerStatus?: (config: unknown) => Promise<{ ok: boolean; error?: string }>;
  printerDiagnose?: (config: unknown) => Promise<PrinterDiagnostics>;
}

function api(): PrinterElectronApi | null {
  const bridge = (window as unknown as { electronAPI?: PrinterElectronApi }).electronAPI;
  return bridge?.printerPrint ? bridge : null;
}

export const thermalPrinterBridge = {
  isAvailable(): boolean {
    return api() !== null;
  },

  async listPrinters(): Promise<string[]> {
    return (await api()?.printerList?.()) ?? [];
  },

  async status(config: PosPrinterSettings): Promise<{ ok: boolean; error?: string }> {
    const bridge = api();
    if (!bridge?.printerStatus) {
      return { ok: false, error: 'Impresión térmica solo está disponible en la app de escritorio.' };
    }
    try {
      return await bridge.printerStatus(config);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  /** Step-by-step connection check (Settings → Impresora de tickets). */
  async diagnose(config: PosPrinterSettings): Promise<PrinterDiagnostics> {
    const bridge = api();
    if (!bridge?.printerDiagnose) {
      return { ok: false, steps: [], error: 'El diagnóstico solo está disponible en la app de escritorio.' };
    }
    try {
      const result = await bridge.printerDiagnose(config);
      return { ...result, steps: Array.isArray(result?.steps) ? result.steps : [] };
    } catch (error) {
      return { ok: false, steps: [], error: error instanceof Error ? error.message : String(error) };
    }
  },

  async print(config: PosPrinterSettings, payload: ReceiptPayload): Promise<PrintResult> {
    const bridge = api();
    if (!bridge?.printerPrint) {
      return { ok: false, error: 'Impresión térmica solo está disponible en la app de escritorio.' };
    }
    try {
      return await bridge.printerPrint(config, withBlocks(payload));
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};
