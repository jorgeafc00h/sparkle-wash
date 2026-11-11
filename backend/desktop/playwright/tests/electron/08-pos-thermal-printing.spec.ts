/**
 * POS thermal printing — Electron integration (openspec add-pos-tickets, task 3.7).
 *
 * HOW THIS IS TESTED WITHOUT A REAL PRINTER:
 *
 * A "virtual thermal printer" is a plain TCP server the spec starts on an
 * ephemeral localhost port speaking the only part of the protocol we rely on:
 * it accepts the connection and swallows the raw ESC/POS bytes, recording
 * them for assertions. The REAL chain is exercised end-to-end —
 * renderer payment → IPC `printer:print` → main-process ESC/POS builder
 * (node-thermal-printer + init/codepage header) → net.Socket TCP 9100
 * transport. No physical printer, no mocks inside the app.
 *
 * REAL-PRINTER MODE (opt-in): set FS_POS_PRINTER_HOST (and optionally
 * FS_POS_PRINTER_PORT, default 9100) to a printer on your LAN — e.g. the
 * Epson TM-T20II. The "prints on a configured real printer" test then sends
 * the receipt to that device and asserts the main process reports success
 * (paper output is verified by the human running the suite). Without the env
 * vars that test is skipped, so CI stays hermetic.
 *
 *   FS_POS_PRINTER_HOST=192.168.1.50 npm run test:e2e:electron -- \
 *     playwright/tests/electron/08-pos-thermal-printing.spec.ts
 */

import { test, expect } from '@playwright/test';
import net from 'net';
import { closeElectron, launchElectron, type ElectronAppHandle } from '../../fixtures/electron-launch';

// ── Virtual thermal printer ────────────────────────────────────────────────

interface VirtualPrinter {
  port: number;
  chunks: Buffer[];
  connections: number;
  stop: () => Promise<void>;
}

async function startVirtualPrinter(): Promise<VirtualPrinter> {
  const chunks: Buffer[] = [];
  let connections = 0;
  const server = net.createServer((socket) => {
    connections += 1;
    socket.on('data', (data: Buffer) => chunks.push(data));
    // Real printers ACK silently; just keep the connection healthy.
    socket.on('error', () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as net.AddressInfo;
  return {
    port: address.port,
    chunks,
    connections,
    stop: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

// ── Seed helpers ───────────────────────────────────────────────────────────

const persist = (value: Record<string, unknown>) => {
  const encoded: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) encoded[k] = JSON.stringify(v);
  encoded._persist = JSON.stringify({ version: -1, rehydrated: true });
  return JSON.stringify(encoded);
};

const PRODUCTS = [
  {
    id: 'prod-pos-1',
    productName: 'Café grande',
    productCode: 'CAFE-01',
    barcode: '7891000000001',
    unitPrice: 3.0,
    unitOfMeasure: 'UNIDAD',
    taxCategory: 'GRAVADO',
    isService: false,
    stock: 50,
    stockQuantity: 50,
    trackInventory: true,
    hasInventory: true,
    status: 'ACTIVE',
    companyId: '1',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

function printerSettingsFor(port: number) {
  return JSON.stringify({
    printer: {
      transport: 'network',
      network: { host: '127.0.0.1', port, timeoutMs: 4000 },
      spooler: { printerName: '' },
      paper: { widthMm: 80, copies: 1, cut: true },
      headerLines: ['¡Gracias por su compra!'],
      footerLines: ['Factura disponible a solicitud.'],
      cashDrawerKick: false,
    },
    oversell: 'BLOCK',
    roundingMode: 'NONE',
  });
}

async function sellOneCoffee(window: Awaited<ReturnType<typeof launchElectron>>['window']) {
  await window.evaluate(() => { window.location.hash = '#/pos'; });
  await expect(window.getByTestId('pos-register')).toBeVisible({ timeout: 30_000 });
  await window.getByTestId('pos-search-input').fill('7891000000001');
  await window.getByTestId('pos-search-input').press('Enter');
  await expect(window.getByTestId('pos-cart-lines').locator('[data-testid^="pos-cart-line-"]')).toHaveCount(1);
  await window.getByTestId('btn-charge').click();
  await window.getByTestId('pay-cash-tendered').fill('10');
  await window.getByTestId('btn-confirm-payment').click();
  await expect(window.getByText(/Ticket #1 impreso/)).toBeVisible({ timeout: 30_000 });
}

// ── Tests ──────────────────────────────────────────────────────────────────

let handle: ElectronAppHandle | null = null;

test.afterAll(async () => {
  if (handle) await closeElectron(handle);
  handle = null;
});

test.describe('Virtual thermal printer (no hardware)', () => {
  let printer: VirtualPrinter;

  test.beforeAll(async () => {
    printer = await startVirtualPrinter();
  });

  test.afterAll(async () => {
    await printer.stop();
  });

  test('a POS sale prints real ESC/POS bytes over TCP 9100', async () => {
    handle = await launchElectron({
      mock: true,
      extraStorage: {
        'persist:products': persist({ products: PRODUCTS, stockMovements: [], categories: [], brands: [], suppliers: [], currentProduct: null, loading: false, error: null, searchTerm: '', filters: {} }),
        'persist:subscription': persist({ tier: 'pro', isInitialized: true, loading: false, error: null, availableProducts: [], activeSubscription: null, purchaseInProgress: false }),
        pos_settings_1: printerSettingsFor(printer.port),
      },
    });
    const { window } = handle;

    await sellOneCoffee(window);

    // The virtual printer received a connection with the raw ESC/POS job.
    await expect.poll(() => printer.chunks.length).toBeGreaterThan(0);
    const bytes = Buffer.concat(printer.chunks);

    // Deterministic printer state: ESC @ init + WPC1252 code page ( accents).
    expect(bytes[0]).toBe(0x1b);
    expect(bytes[1]).toBe(0x40);
    expect(bytes.subarray(2, 5)).toEqual(Buffer.from([0x1b, 0x74, 16]));

    const text = bytes.toString('latin1');
    expect(text).toContain('K LABS');                 // company (from seeded TEST_COMPANY)
    expect(text).toContain('Ticket #000001');
    expect(text).toContain('Café grande');            // accented text survives WPC1252
    expect(text).toContain('Documento no fiscal');    // non-fiscal disclaimer
    expect(text).toContain('TOTAL');
    expect(text).toContain('Vuelto');
    // Cut command (GS V) present.
    expect(bytes.includes(0x1d) && bytes.includes(0x56)).toBe(true);
  });

  test('a partial return prints the non-fiscal COMPROBANTE DE DEVOLUCIÓN over TCP 9100 (POS Phase 2)', async () => {
    const { window } = handle!;
    printer.chunks.length = 0;
    await window.evaluate(() => { window.location.hash = '#/pos/tickets'; });
    await expect(window.getByTestId('ticket-row-1')).toBeVisible({ timeout: 30_000 });
    await window.getByTestId('btn-return-ticket-1').click();
    await expect(window.getByTestId('return-dialog')).toBeVisible();
    await window.getByTestId('return-qty-0').fill('1');
    await expect(window.getByTestId('return-refund-total')).toContainText('$3.00');
    await window.getByTestId('return-reason').fill('Producto dañado');
    await window.getByTestId('btn-confirm-return').click();
    await expect(window.getByText(/Devolución registrada — reembolso \$3\.00/)).toBeVisible({ timeout: 30_000 });

    await expect.poll(() => printer.chunks.length, { timeout: 30_000 }).toBeGreaterThan(0);
    const bytes = Buffer.concat(printer.chunks);
    expect(bytes.subarray(0, 5)).toEqual(Buffer.from([0x1b, 0x40, 0x1b, 0x74, 16]));
    const text = bytes.toString('latin1'); // WPC1252 ⊃ Latin-1 for Ó/ñ
    expect(text).toContain('COMPROBANTE DE DEVOLUCIÓN');
    expect(text).toContain('Ticket #000001');
    expect(text).toContain('Café grande');
    expect(text).toContain('REEMBOLSO');
    expect(text).toContain('$3.00');
    expect(text).toContain('Motivo: Producto dañado');
    expect(text).toContain('Documento no fiscal');
    // A refund slip never pulses the cash drawer (ESC p).
    expect(bytes.includes(Buffer.from([0x1b, 0x70]))).toBe(false);
    expect(bytes.includes(0x1d) && bytes.includes(0x56)).toBe(true);
  });

  test('printer status probe succeeds against a reachable printer and fails on a closed port', async () => {
    // Reachable: the still-running virtual printer.
    const reachable = await handle!.window.evaluate((port) =>
      window.electronAPI!.printerStatus!({
        transport: 'network',
        network: { host: '127.0.0.1', port, timeoutMs: 1500 },
      }), printer.port);
    expect((reachable as { ok: boolean }).ok).toBe(true);

    // Unreachable: a port with nothing listening.
    const dead = await handle!.window.evaluate(() =>
      window.electronAPI!.printerStatus!({
        transport: 'network',
        network: { host: '127.0.0.1', port: 1, timeoutMs: 1000 },
      }));
    expect((dead as { ok: boolean }).ok).toBe(false);
  });

  test('diagnostics explain where the ticket stops (network and USB queue)', async () => {
    type Diag = { ok: boolean; steps: Array<{ id: string; status: string; detail: string; hint?: string }> };
    // window.electronAPI inside evaluate — the page has no access to test-scope helpers.
    // Reachable virtual printer: every step passes (ESC @ only — nothing printed).
    const ok = (await handle!.window.evaluate(([port]) => (window as unknown as { electronAPI: { printerDiagnose: (c: unknown) => Promise<unknown> } }).electronAPI.printerDiagnose({
      transport: 'network',
      network: { host: '127.0.0.1', port, timeoutMs: 1500 },
    }), [printer.port])) as Diag;
    expect(ok.ok).toBe(true);
    expect(ok.steps.find((s) => s.id === 'connect')?.status).toBe('ok');

    // Nothing listening: the refusal is named, with what to check.
    const refused = (await handle!.window.evaluate(() => (window as unknown as { electronAPI: { printerDiagnose: (c: unknown) => Promise<unknown> } }).electronAPI.printerDiagnose({
      transport: 'network',
      network: { host: '127.0.0.1', port: 1, timeoutMs: 1000 },
    }))) as Diag;
    expect(refused.ok).toBe(false);
    expect(refused.steps.find((s) => s.id === 'connect')?.hint).toContain('rechazó el puerto');

    // USB queue that does not exist on this machine: the queue step fails and
    // no job is attempted.
    const usb = (await handle!.window.evaluate(() => (window as unknown as { electronAPI: { printerDiagnose: (c: unknown) => Promise<unknown> } }).electronAPI.printerDiagnose({
      transport: 'spooler',
      spooler: { printerName: 'FS Impresora Inexistente' },
    }))) as Diag;
    expect(usb.ok).toBe(false);
    const queue = usb.steps.find((s) => s.id === 'queue');
    expect(queue?.status).toBe('error');
    expect(queue?.detail).toContain('FS Impresora Inexistente');
    expect(usb.steps.some((s) => s.id === 'raw-job')).toBe(false);
  });

  test('invalid printer config is rejected by the main-process validators', async () => {
    const bad = await handle!.window.evaluate(() =>
      window.electronAPI!.printerPrint!({
        transport: 'spooler',
        spooler: { printerName: 'Bad; rm -rf' }, // injection attempt
      }, { paper: { widthMm: 80 }, cut: true, blocks: [{ text: 'x', align: 'left' }] }));
    expect((bad as { ok: boolean; error: string }).ok).toBe(false);
    expect((bad as { error: string }).error).toContain('inválido');
  });

  test('print failure never loses the sale (printer goes offline)', async () => {
    // Kill the virtual printer mid-flight, then sell: the ticket must still
    // be persisted and the UI must offer the reprint path.
    const port = printer.port;
    await printer.stop();

    await handle!.window.evaluate(() => { window.location.hash = '#/pos'; });
    await expect(handle!.window.getByTestId('pos-register')).toBeVisible({ timeout: 30_000 });
    await handle!.window.getByTestId('pos-search-input').fill('7891000000001');
    await handle!.window.getByTestId('pos-search-input').press('Enter');
    await handle!.window.getByTestId('btn-charge').click();
    await handle!.window.getByTestId('btn-confirm-payment').click();

    await expect(handle!.window.getByText(/guardado — impresión falló/)).toBeVisible({ timeout: 30_000 });
    await handle!.window.evaluate(() => { window.location.hash = '#/pos/tickets'; });
    await expect(handle!.window.getByTestId('ticket-row-2')).toBeVisible({ timeout: 30_000 });

    // Restore for any subsequent tests in the file.
    const revived = await startVirtualPrinterOn(port);
    printer.chunks.push(...revived.buffer);
    Object.assign(printer, { stop: revived.stop, connections: printer.connections });
  });
});

/** Revive the listener on the SAME port after the offline test killed it. */
async function startVirtualPrinterOn(port: number): Promise<{ buffer: Buffer[]; stop: () => Promise<void> }> {
  const buffer: Buffer[] = [];
  const server = net.createServer((socket) => {
    socket.on('data', (data: Buffer) => buffer.push(data));
    socket.on('error', () => {});
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  return { buffer, stop: () => new Promise((resolve) => server.close(() => resolve())) };
}

test.describe('Real printer (opt-in via FS_POS_PRINTER_HOST)', () => {
  test.skip(!process.env.FS_POS_PRINTER_HOST, 'Set FS_POS_PRINTER_HOST to test against a physical ESC/POS printer');

  test('prints a test receipt on the configured real printer', async () => {
    const host = process.env.FS_POS_PRINTER_HOST!;
    const port = Number(process.env.FS_POS_PRINTER_PORT ?? 9100);

    handle = await launchElectron({
      mock: true,
      extraStorage: {
        'persist:products': persist({ products: PRODUCTS, stockMovements: [], categories: [], brands: [], suppliers: [], currentProduct: null, loading: false, error: null, searchTerm: '', filters: {} }),
        'persist:subscription': persist({ tier: 'pro', isInitialized: true, loading: false, error: null, availableProducts: [], activeSubscription: null, purchaseInProgress: false }),
        pos_settings_1: JSON.stringify({
          printer: {
            transport: 'network',
            network: { host, port, timeoutMs: 5000 },
            spooler: { printerName: '' },
            paper: { widthMm: 80, copies: 1, cut: true },
            headerLines: ['PRUEBA DE INTEGRACION'],
            footerLines: [],
            cashDrawerKick: false,
          },
          oversell: 'BLOCK',
          roundingMode: 'NONE',
        }),
      },
    });
    const { window } = handle;

    await window.evaluate(() => { window.location.hash = '#/settings/printer'; });
    await expect(window.getByTestId('printer-settings')).toBeVisible({ timeout: 30_000 });
    await window.getByTestId('btn-test-print').click();
    // Success toast: the OS-level result of the real print job.
    await expect(window.getByText(/Página de prueba enviada/)).toBeVisible({ timeout: 30_000 });
  });
});
