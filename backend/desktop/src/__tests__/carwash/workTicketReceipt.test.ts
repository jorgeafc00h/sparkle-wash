// Carwash work ticket ("ORDEN DE TRABAJO"): layout, copies, 58 mm wrapping,
// El Salvador time and the ESC/POS mapping of the new WORK_ORDER kind.
jest.mock('@/services/telemetry/TelemetryService', () => ({ TelemetryService: { trackEvent: jest.fn() } }));
jest.mock('@/services/logging/LocalLogger', () => ({ LocalLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), event: jest.fn() } }));

import {
  buildWorkTicketCopies,
  buildWorkTicketReceipt,
  previewWorkTicketText,
  printWorkTicket,
  workTicketCopyLabels,
} from '@/services/printing/WorkTicketPrinting';
import { RECEIPT_DISCLAIMER, buildReceiptBlocks, colsForWidth, renderReceiptText, withBlocks } from '@/services/printing/ReceiptDocument';
import { thermalPrinterBridge } from '@/services/printing/ThermalPrinterBridge';
import { normalizePosSettings, TM_T20II_PRESET } from '@/services/tickets/PosSettingsStore';
import type { CarwashJob } from '@/services/carwash/types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const escpos = require('../../../electron/thermalPrinterService.cjs');

const job = (over: Partial<CarwashJob> = {}): CarwashJob => ({
  id: 'local-1a2b3c4d-0000',
  arrivalId: 'a1',
  plate: 'P123-456',
  vehicleClass: 'suv',
  packageId: 'full',
  packageName: 'Lavado completo',
  services: ['Lavado exterior', 'Aspirado interior', 'Brillo de llantas'],
  priceUsd: 12.5,
  currency: 'USD',
  status: 'arrived',
  arrivalAt: '2026-10-31T21:45:00.000Z', // 15:45 in El Salvador (UTC-6)
  startedAt: null,
  completedAt: null,
  cancelledAt: null,
  elapsedSeconds: 0,
  activeSeconds: null,
  transitions: [],
  assignments: [{ employeeId: 'e1', employeeName: 'Carlos Pérez', assignedAt: '2026-10-31T21:46:00.000Z' }],
  ticketNumber: 'OT-C1-000045',
  customerName: 'María López',
  note: 'Rayón en puerta derecha',
  payments: [],
  paidUsd: 0,
  paymentStatus: 'unpaid',
  ...over,
});

const baseOpts = {
  companyName: 'Car Spa',
  companyPhone: '2222-3333',
  companyAddress: 'Col. Escalón, San Salvador',
  registerCode: 'C1',
  cashierName: 'Ana',
  footer: 'Presente este ticket al retirar su vehículo',
  vehicleClassName: 'Camioneta',
};
const text = (j: CarwashJob, widthMm: 80 | 58 = 80, extra = {}) =>
  renderReceiptText(withBlocks(buildWorkTicketReceipt(j, { ...baseOpts, paper: { widthMm }, ...extra })));

describe('work ticket layout', () => {
  it('prints header, big title + number, plate, class, package, services, employee, customer, note, time, price and disclaimer', () => {
    const payload = withBlocks(buildWorkTicketReceipt(job(), { ...baseOpts, paper: { widthMm: 80 } }));
    expect(payload.kind).toBe('WORK_ORDER');
    const out = renderReceiptText(payload);
    for (const expected of [
      'CAR SPA',
      'Tel 2222-3333',
      'ORDEN DE TRABAJO',
      'OT-C1-000045',
      'P123-456',
      'Vehículo: Camioneta',
      'Paquete: Lavado completo',
      '- Lavado exterior',
      '- Aspirado interior',
      'Atiende: Carlos Pérez',
      'Cliente: María López',
      'Nota: Rayón en puerta derecha',
      'Cajero: Ana',
      '31/10/2026 15:45',
      'Presente este ticket al retirar su vehículo',
      RECEIPT_DISCLAIMER,
      'Ref 1A2B3C4D',
    ]) expect(out).toContain(expected);
    expect(out).toMatch(/PRECIO\s+\$12\.50/);
    expect(out).toContain('PENDIENTE DE PAGO');
  });

  it('title, ticket number and plate are double height; plate is bold', () => {
    const blocks = buildReceiptBlocks(buildWorkTicketReceipt(job(), { ...baseOpts, paper: { widthMm: 80 } }));
    const find = (t: string) => blocks.find((b) => b.text === t)!;
    expect(find('ORDEN DE TRABAJO')).toMatchObject({ doubleHeight: true, bold: true });
    expect(find('OT-C1-000045')).toMatchObject({ doubleHeight: true });
    expect(find('P123-456')).toMatchObject({ doubleHeight: true, bold: true });
  });

  it('shows the payment status: PAGADO, ABONO and PENDIENTE', () => {
    expect(text(job({ paidUsd: 12.5, paymentStatus: 'paid' }))).toContain('PAGADO $12.50');
    const partial = text(job({ paidUsd: 5, paymentStatus: 'partial' }));
    expect(partial).toMatch(/ABONO\s+\$5\.00/);
    expect(partial).toContain('PENDIENTE $7.50');
    expect(text(job())).toContain('PENDIENTE DE PAGO');
  });

  it('omits optional lines and falls back to the class id when no class name is given', () => {
    const out = text(job({ customerName: null, note: null, assignments: [] }), 80, { vehicleClassName: undefined });
    expect(out).not.toContain('Cliente:');
    expect(out).not.toContain('Nota:');
    expect(out).not.toContain('Atiende:');
    expect(out).toContain('Vehículo: Suv');
  });

  it('stamps El Salvador time, not the machine zone (late evening crosses UTC midnight)', () => {
    expect(text(job({ arrivalAt: '2026-11-01T03:30:00.000Z' }))).toContain('31/10/2026 21:30');
  });

  it('wraps every line within 32 columns on 58 mm paper', () => {
    const long = job({
      customerName: 'María Fernanda de los Ángeles Hernández Rodríguez',
      note: 'Cliente pide cuidado especial con los asientos de cuero y el tablero',
      packageName: 'Paquete premium con encerado y pulido de faros',
      services: ['Lavado exterior con shampoo especial de alta espuma', 'Aspirado interior completo'],
      assignments: [
        { employeeId: 'e1', employeeName: 'Carlos Alberto Pérez', assignedAt: '' },
        { employeeId: 'e2', employeeName: 'José Luis Martínez', assignedAt: '' },
      ],
    });
    const payload = withBlocks(buildWorkTicketReceipt(long, { ...baseOpts, companyName: 'Autolavado Car Spa El Paraíso', paper: { widthMm: 58 } }));
    const cols = colsForWidth(58);
    for (const block of payload.blocks!) expect([block.text, block.text.length <= cols]).toEqual([block.text, true]);
    expect(renderReceiptText(payload)).toContain('María Fernanda');
  });
});

describe('copies', () => {
  it('labels: one copy has none; 2 → CLIENTE/VEHÍCULO; 3 adds CAJA; clamps to 1–3', () => {
    expect(workTicketCopyLabels(1)).toEqual([undefined]);
    expect(workTicketCopyLabels(2)).toEqual(['COPIA CLIENTE', 'COPIA VEHÍCULO']);
    expect(workTicketCopyLabels(3)).toEqual(['COPIA CLIENTE', 'COPIA VEHÍCULO', 'COPIA CAJA']);
    expect(workTicketCopyLabels(9)).toHaveLength(3);
    expect(workTicketCopyLabels(0)).toHaveLength(1);
  });

  it('buildWorkTicketCopies yields one payload per copy with its label', () => {
    const settings = normalizePosSettings({ printer: { ...TM_T20II_PRESET, network: { host: '10.0.0.9', port: 9100, timeoutMs: 4000 } } });
    const copies = buildWorkTicketCopies(job(), settings, { footer: 'Gracias', copies: 2 });
    expect(copies.map((c) => c.workOrder?.copyLabel)).toEqual(['COPIA CLIENTE', 'COPIA VEHÍCULO']);
    expect(renderReceiptText(withBlocks(copies[1]))).toContain('*** COPIA VEHÍCULO ***');
  });
});

describe('printing', () => {
  const settings = normalizePosSettings({ printer: { ...TM_T20II_PRESET, network: { host: '10.0.0.9', port: 9100, timeoutMs: 4000 } } });

  afterEach(() => jest.restoreAllMocks());

  it('prints each copy and reports the count', async () => {
    const spy = jest.spyOn(thermalPrinterBridge, 'print').mockResolvedValue({ ok: true });
    const result = await printWorkTicket(job(), settings, { footer: 'x', copies: 3 });
    expect(result).toEqual({ ok: true, printed: 3 });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[0][1].kind).toBe('WORK_ORDER');
  });

  it('never throws: a failing printer or a thrown error becomes ok:false', async () => {
    jest.spyOn(thermalPrinterBridge, 'print').mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: 'Sin papel' });
    expect(await printWorkTicket(job(), settings, { footer: 'x', copies: 2 })).toEqual({ ok: false, printed: 1, error: 'Sin papel' });
    jest.spyOn(thermalPrinterBridge, 'print').mockRejectedValue(new Error('boom'));
    expect(await printWorkTicket(job(), settings, { footer: 'x' })).toMatchObject({ ok: false, error: 'boom' });
  });

  it('no printer configured → ok:false without throwing', async () => {
    const result = await printWorkTicket(job(), normalizePosSettings({}), { footer: 'x' });
    expect(result.ok).toBe(false);
  });

  it('web preview text of the first copy', () => {
    expect(previewWorkTicketText(job(), settings, { footer: 'Gracias', copies: 2 })).toContain('ORDEN DE TRABAJO');
  });
});

describe('ESC/POS mapping', () => {
  it('WORK_ORDER builds a buffer containing the plate and ticket number, never kicks the drawer', () => {
    const payload = withBlocks(buildWorkTicketReceipt(job(), { ...baseOpts, paper: { widthMm: 80 } }));
    const bytes: Buffer = escpos.buildBuffer(payload);
    const latin = bytes.toString('latin1');
    expect(latin).toContain('P123-456');
    expect(latin).toContain('OT-C1-000045');
    expect(latin).toContain('ORDEN DE TRABAJO');
    expect(bytes.includes(Buffer.from([0x1b, 0x70]))).toBe(false);
  });
});
