import { isUsablePrinterName, looksLikeThermalQueue, PRINTER_NAME_PATTERN, suggestThermalQueue } from '@/services/printing/printerQueues';

describe('suggestThermalQueue', () => {
  it('picks the Epson TM / receipt / POS queue', () => {
    expect(suggestThermalQueue(['Microsoft Print to PDF', 'EPSON TM-T20II Receipt5', 'Fax'])).toBe('EPSON TM-T20II Receipt5');
    expect(suggestThermalQueue(['POS-80C'])).toBe('POS-80C');
    expect(suggestThermalQueue(['XP-58 (copy 1)'])).toBe('XP-58 (copy 1)');
    expect(suggestThermalQueue(['Impresora térmica'])).toBe('Impresora térmica');
  });

  it('ignores office printers and virtual queues', () => {
    expect(looksLikeThermalQueue('EPSON L3150 Series')).toBe(false);
    expect(looksLikeThermalQueue('HP LaserJet Pro M404')).toBe(false);
    expect(looksLikeThermalQueue('Microsoft XPS Document Writer')).toBe(false);
    expect(suggestThermalQueue(['OneNote (Desktop)', 'EPSON L3150 Series'])).toBeNull();
  });
});

describe('only names the main process accepts are suggested', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const main = require('../../../electron/thermalPrinterService.cjs');

  it('renderer and main process share the same queue-name pattern', () => {
    expect(PRINTER_NAME_PATTERN.source).toBe(main.PRINTER_NAME_RE.source);
    expect(PRINTER_NAME_PATTERN.flags).toBe(main.PRINTER_NAME_RE.flags);
  });

  it('a preselected thermal queue always passes the print validator', () => {
    const queues = ['Recibo Bixolón', 'POS-80C #2', 'Impresora térmica', '\\\\PC-CAJA\\TM-T20II Receipt', 'XP-58 (copy 1)'];
    for (const q of queues) {
      expect(suggestThermalQueue([q])).toBe(q);
      expect(main.validateConfig({ transport: 'spooler', spooler: { printerName: q } })).toBeNull();
    }
  });

  it('skips a thermal-looking queue whose name would be refused and picks the next usable one', () => {
    expect(isUsablePrinterName('POS [caja] 80mm')).toBe(false);
    expect(suggestThermalQueue(['POS [caja] 80mm', 'Recibo Bixolón'])).toBe('Recibo Bixolón');
    expect(suggestThermalQueue(['POS "caja"'])).toBeNull();
  });
});
