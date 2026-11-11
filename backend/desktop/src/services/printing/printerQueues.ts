// Picks the OS print queue that looks like a USB thermal ticket printer, so
// Settings can preselect it (and suggest it when a network test times out —
// users with a USB printer kept testing the default network connection).

/**
 * Queue names the main process accepts (electron/thermalPrinterService.cjs
 * PRINTER_NAME_RE — keep both identical; a Jest test compares them): Unicode
 * letters, digits, spaces, "-_.#()" and the shared-printer form
 * "\\server\queue", not starting with "-". Anything else is refused there with
 * "Nombre de impresora inválido", so it must never be suggested or preselected.
 */
export const PRINTER_NAME_PATTERN =
  /^(?:\\\\[\p{L}\p{N}._-]{1,63}\\)?[\p{L}\p{N}_.#()][\p{L}\p{M}\p{N} _.#()-]{0,159}$/u;

export function isUsablePrinterName(name: string): boolean {
  return PRINTER_NAME_PATTERN.test(name);
}

// Not bare "epson": EPSON L-series inkjets are common in the same offices.
const THERMAL_QUEUE = /\btm-?[tuhml]\d|receipt|recibo|ticket|\bpos\b|thermal|t[ée]rmica|xprinter|\bxp-|bixol[oó]n|\bstar\b|\btsp|\b(58|80) ?mm/i;
const NOT_A_PRINTER = /pdf|xps|onenote|fax|microsoft|send to|anydesk|teamviewer/i;

export function looksLikeThermalQueue(name: string): boolean {
  return THERMAL_QUEUE.test(name) && !NOT_A_PRINTER.test(name);
}

/** The thermal-looking queue to preselect — only one the main process will accept. */
export function suggestThermalQueue(queues: string[]): string | null {
  return queues.find((q) => looksLikeThermalQueue(q) && isUsablePrinterName(q)) ?? null;
}
