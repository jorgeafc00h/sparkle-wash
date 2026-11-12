// Receipt model shared by the on-screen preview and the Electron main
// ESC/POS builder. The layout is computed ONCE here as styled blocks
// (single source of truth): the web preview flattens them to monospace text
// and the main process maps them 1:1 to ESC/POS commands. Pure JSON — the
// renderer never touches ESC/POS bytes.

import { formatTicketNumber } from '../tickets/ticketNumber';

export type ReceiptKind = 'TICKET' | 'TEST' | 'Z_REPORT' | 'RETURN_SLIP' | 'WORK_ORDER';

export interface ReceiptBlock {
  text: string;
  align: 'left' | 'center' | 'right';
  doubleHeight?: boolean;
  bold?: boolean;
}

export interface ReceiptPayload {
  kind: ReceiptKind;
  companyId: string;
  companyName: string;
  companyNit?: string;
  companyAddress?: string;
  companyPhone?: string;
  headerLines: string[];
  footerLines: string[];
  paper: { widthMm: 80 | 58 };
  cut: boolean;
  /**
   * Pulse the cash drawer after printing. Set only for a SALE receipt paid in
   * cash with the drawer enabled in the printer settings — never for
   * reprints, test pages or Z reports.
   */
  cashDrawerKick?: boolean;
  /** Reprint of an already-issued ticket → "REIMPRESIÓN / COPIA" marker. */
  copy?: boolean;
  /** Filled by buildReceiptBlocks() before crossing the IPC boundary. */
  blocks?: ReceiptBlock[];
  ticket?: {
    sequential: number;
    /** Register code at sale time → "Ticket C1-000123" (legacy: "Ticket #000123"). */
    registerCode?: string;
    id: string;
    completedAt: string;
    cashierName?: string;
    customerName?: string;
    lines: Array<{
      productName: string;
      quantity: number;
      unitPrice: number;
      lineTotal: number;
      discount?: number;
      obs?: string;
    }>;
    discountTotal?: number;
    roundingAdjustment?: number;
    totalAmount: number;
    taxIncluded: number;
    payments: Array<{
      methodLabel: string;
      amount: number;
      tendered?: number;
      change?: number;
      detail?: string;
    }>;
    excludedFromLibros: boolean;
    /** VOID ticket → "*** ANULADO ***" (only ever printed as a reprint). */
    voided?: boolean;
    voidedAt?: string;
    voidReason?: string;
  };
  zReport?: {
    label: string;
    from: string;
    to: string;
    ticketCount: number;
    voidedCount: number;
    grossTotal: number;
    ivaIncluded: number;
    byMethod: Array<{ methodLabel: string; count: number; amount: number; cashTendered: number; cashChange: number; refundAmount?: number }>;
    /** Tickets sold in an earlier Z and voided in this one (refunds). */
    priorVoidCount?: number;
    priorVoidAmount?: number;
    /** grossTotal − priorVoidAmount − refunds. */
    netTotal?: number;
    /** POS Phase 2 — register the Z belongs to ("C1"). */
    registerLabel?: string;
    /** Σ line + ticket discounts of the range's sales. */
    discountTotal?: number;
    /** Partial returns registered in the range. */
    refundCount?: number;
    refundAmount?: number;
    /** Per cashier (name, sales count, amount). */
    byCashier?: Array<{ name: string; count: number; amount: number }>;
    /** Per product summary (top products + "Otros"). */
    byProduct?: Array<{ name: string; quantity: number; amount: number }>;
    /** Arqueo de efectivo. */
    cash?: {
      openingFloat: number;
      cashSales: number;
      cashRefunds: number;
      cashIn: number;
      cashOut: number;
      expected: number;
      counted?: number;
      difference?: number;
    };
  };
  /** Carwash work ticket ("ORDEN DE TRABAJO") — one per car detailing. */
  workOrder?: {
    /** Work-ticket number ("OT-C1-000045"). */
    ticketNumber: string;
    plate: string;
    vehicleClassName: string;
    packageName: string;
    services: string[];
    employees: string[];
    customerName?: string;
    note?: string;
    createdAt: string;
    cashierName?: string;
    priceUsd: number;
    paidUsd: number;
    /** Short id for reference / support ("A1B2C3D4"). */
    shortId: string;
    /** "COPIA CLIENTE" / "COPIA VEHÍCULO" when several copies print. */
    copyLabel?: string;
  };
  /** Non-fiscal partial-return slip ("COMPROBANTE DE DEVOLUCIÓN"). */
  returnSlip?: {
    /** Display number of the original ticket ("C1-000123" / "#000123"). */
    ticketNumber: string;
    returnId: string;
    createdAt: string;
    cashierName?: string;
    customerName?: string;
    reason: string;
    lines: Array<{ productName: string; quantity: number; amount: number }>;
    refundMethodLabel: string;
    refundAmount: number;
  };
}

export const RECEIPT_DISCLAIMER = 'Documento no fiscal — no es factura ni DTE';
export const RECEIPT_VOID_MARK = '*** ANULADO ***';
export const RECEIPT_COPY_MARK = 'REIMPRESIÓN / COPIA';
export const RECEIPT_RETURN_TITLE = 'COMPROBANTE DE DEVOLUCIÓN';
export const RECEIPT_WORK_ORDER_TITLE = 'ORDEN DE TRABAJO';

/** Receipts are always stamped in El Salvador time, whatever the PC's zone. */
export const RECEIPT_TIME_ZONE = 'America/El_Salvador';

export function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

/**
 * Unit price as typed: 2 decimals normally, up to 4 when the price has more
 * (0.3333) so "3 x $0.3333 = $1.00" adds up on paper.
 */
export function unitMoney(value: number): string {
  const four = Math.round((value + Number.EPSILON) * 10000) / 10000;
  if (Math.abs(four - Math.round(four * 100) / 100) < 1e-9) return money(four);
  return `$${four.toFixed(4).replace(/0+$/, '')}`;
}

/** "31/10/2026 15:45" in El Salvador time — 16 chars, fits 58 mm next to the ticket number. */
export function receiptDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('es-SV', {
      timeZone: RECEIPT_TIME_ZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

function padLine(left: string, right: string, cols: number): string {
  const space = cols - left.length - right.length;
  if (space < 1) return `${left} ${right}`.slice(0, cols);
  return left + ' '.repeat(space) + right;
}

function centerLine(text: string, cols: number): string {
  if (text.length >= cols) return text.slice(0, cols);
  const pad = Math.floor((cols - text.length) / 2);
  return ' '.repeat(pad) + text;
}

function wrapText(text: string, cols: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if ((current + (current ? ' ' : '') + word).length <= cols) {
      current += (current ? ' ' : '') + word;
    } else {
      if (current) lines.push(current);
      current = word.length > cols ? word.slice(0, cols) : word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function colsForWidth(widthMm: 80 | 58): number {
  return widthMm === 80 ? 48 : 32;
}

/**
 * Layout engine — the styled blocks both renderers consume.
 * Order and grouping here IS the printed receipt.
 */
export function buildReceiptBlocks(payload: ReceiptPayload): ReceiptBlock[] {
  const cols = colsForWidth(payload.paper.widthMm);
  const blocks: ReceiptBlock[] = [];
  const L = (text = '', opts: Partial<ReceiptBlock> = {}) => blocks.push({ text, align: 'left', ...opts });
  const C = (text = '', opts: Partial<ReceiptBlock> = {}) => blocks.push({ text, align: 'center', ...opts });
  const divider = () => L('-'.repeat(cols));
  const pad = (left: string, right: string, opts: Partial<ReceiptBlock> = {}) => L(padLine(left, right, cols), opts);

  // ── Store header ──
  for (const line of wrapText(payload.companyName.toUpperCase(), cols)) C(line, { doubleHeight: true });
  if (payload.companyNit) C(`NIT ${payload.companyNit}`);
  if (payload.companyAddress) for (const l of wrapText(payload.companyAddress, cols)) C(l);
  if (payload.companyPhone) C(`Tel ${payload.companyPhone}`);
  for (const l of payload.headerLines) for (const w of wrapText(l, cols)) C(w);
  divider();

  if (payload.kind === 'TEST') {
    C('PAGINA DE PRUEBA', { bold: true });
    C('Car Spa POS');
    divider();
    C('Si lee esto, la impresora');
    C('esta configurada correctamente.');
    divider();
    C(RECEIPT_DISCLAIMER);
  } else if (payload.kind === 'TICKET' && payload.ticket) {
    const t = payload.ticket;
    if (t.voided) C(RECEIPT_VOID_MARK, { doubleHeight: true, bold: true });
    if (payload.copy) C(RECEIPT_COPY_MARK, { bold: true });
    if (t.voided || payload.copy) divider();
    const number = `Ticket ${formatTicketNumber(t)}`;
    const when = receiptDateTime(t.completedAt);
    if (number.length + 1 + when.length <= cols) pad(number, when);
    else { L(number); L(when); }
    if (t.cashierName) L(`Cajero: ${t.cashierName}`.slice(0, cols));
    if (t.customerName) L(`Cliente: ${t.customerName}`.slice(0, cols));
    divider();

    // Each line prints its GROSS (qty × price) and, below it, its discount —
    // so the column adds up to the subtotal, which is net of line discounts.
    for (const line of t.lines) {
      L(line.productName.slice(0, cols));
      pad(`  ${line.quantity} x ${unitMoney(line.unitPrice)}`, money(round(line.lineTotal + (line.discount ?? 0))));
      if (line.discount) pad('  Descuento', `-${money(line.discount)}`);
      if (line.obs) L(`  * ${line.obs}`.slice(0, cols));
    }
    divider();

    const linesSubtotal = round(t.lines.reduce((s, l) => s + l.lineTotal, 0));
    pad('Subtotal (IVA incl.)', money(linesSubtotal));
    if (t.discountTotal) pad('Descuento', `-${money(t.discountTotal)}`);
    if (t.roundingAdjustment) pad('Redondeo', money(t.roundingAdjustment));
    pad('IVA incluido 13%', money(t.taxIncluded));
    pad('TOTAL', money(t.totalAmount), { doubleHeight: true, bold: true });

    for (const p of t.payments) {
      pad(p.methodLabel, money(p.amount));
      if (p.detail) L(`  ${p.detail}`.slice(0, cols));
      if (p.tendered !== undefined) pad('  Recibido', money(p.tendered));
      if (p.change !== undefined) pad('  Vuelto', money(p.change));
    }
    divider();
    if (t.voided) {
      C(RECEIPT_VOID_MARK, { doubleHeight: true, bold: true });
      if (t.voidedAt) C(`Anulado ${receiptDateTime(t.voidedAt)}`);
      if (t.voidReason) for (const w of wrapText(`Motivo: ${t.voidReason}`, cols)) C(w);
      divider();
    }
    for (const w of wrapText(RECEIPT_DISCLAIMER, cols)) C(w, { bold: true });
    if (t.excludedFromLibros) C('Excluida de libros IVA');
  } else if (payload.kind === 'Z_REPORT' && payload.zReport) {
    const z = payload.zReport;
    C(z.label, { doubleHeight: true, bold: true });
    pad('Desde', receiptDateTime(z.from));
    pad('Hasta', receiptDateTime(z.to));
    divider();
    if (z.registerLabel) pad('Caja', z.registerLabel);
    pad('Tickets', String(z.ticketCount));
    pad('Anulados', String(z.voidedCount));
    divider();
    for (const m of z.byMethod) {
      pad(m.methodLabel, money(m.amount), { bold: true });
      if (m.methodLabel === 'EFECTIVO' && m.cashTendered) {
        pad('  Efectivo recibido', money(m.cashTendered));
        pad('  Vuelto entregado', money(m.cashChange));
      }
      if (m.refundAmount) pad('  Devoluciones', `-${money(m.refundAmount)}`);
    }
    divider();
    if (z.discountTotal) pad('Descuentos otorgados', `-${money(z.discountTotal)}`);
    pad('IVA incluido', money(z.ivaIncluded));
    pad('VENTA TOTAL', money(z.grossTotal), { doubleHeight: true, bold: true });
    if (z.priorVoidCount) {
      pad(`Anulaciones cierres ant. (${z.priorVoidCount})`, `-${money(z.priorVoidAmount ?? 0)}`);
    }
    if (z.refundCount) {
      pad(`Devoluciones (${z.refundCount})`, `-${money(z.refundAmount ?? 0)}`);
    }
    if (z.priorVoidCount || z.refundCount) {
      pad('NETO DEL CIERRE', money(z.netTotal ?? z.grossTotal), { bold: true });
    }
    if (z.cash) {
      const c = z.cash;
      divider();
      C('ARQUEO DE EFECTIVO', { bold: true });
      pad('Fondo inicial', money(c.openingFloat));
      pad('Ventas en efectivo', money(c.cashSales));
      if (c.cashRefunds) pad('Devoluciones en efectivo', `-${money(c.cashRefunds)}`);
      if (c.cashIn) pad('Entradas de efectivo', money(c.cashIn));
      if (c.cashOut) pad('Salidas de efectivo', `-${money(c.cashOut)}`);
      pad('Efectivo esperado', money(c.expected), { bold: true });
      if (c.counted !== undefined) {
        pad('Efectivo contado', money(c.counted));
        const diff = c.difference ?? 0;
        const label = diff < 0 ? 'FALTANTE' : diff > 0 ? 'SOBRANTE' : 'CUADRA';
        pad(label, diff < 0 ? `-${money(-diff)}` : money(diff), { bold: true });
      } else {
        pad('Efectivo contado', 'sin conteo');
      }
    }
    if (z.byCashier && z.byCashier.length > 0) {
      divider();
      C('POR CAJERO', { bold: true });
      for (const row of z.byCashier) pad(`${row.name} (${row.count})`.slice(0, cols - 11), money(row.amount));
    }
    if (z.byProduct && z.byProduct.length > 0) {
      divider();
      C('POR PRODUCTO', { bold: true });
      for (const row of z.byProduct) {
        L(row.name.slice(0, cols));
        pad(`  ${row.quantity}`, money(row.amount));
      }
    }
    divider();
    C('Cierre registrado.');
  } else if (payload.kind === 'WORK_ORDER' && payload.workOrder) {
    const w = payload.workOrder;
    C(RECEIPT_WORK_ORDER_TITLE, { doubleHeight: true, bold: true });
    if (w.copyLabel) C(`*** ${w.copyLabel} ***`, { bold: true });
    for (const line of wrapText(w.ticketNumber, cols)) C(line, { doubleHeight: true, bold: true });
    divider();
    for (const line of wrapText(w.plate, cols)) C(line, { doubleHeight: true, bold: true });
    for (const line of wrapText(`Vehículo: ${w.vehicleClassName}`, cols)) L(line);
    for (const line of wrapText(`Paquete: ${w.packageName}`, cols)) L(line, { bold: true });
    for (const service of w.services) {
      wrapText(service, cols - 2).forEach((line, i) => L(`${i === 0 ? '- ' : '  '}${line}`));
    }
    divider();
    if (w.employees.length > 0) for (const line of wrapText(`Atiende: ${w.employees.join(', ')}`, cols)) L(line);
    if (w.customerName) for (const line of wrapText(`Cliente: ${w.customerName}`, cols)) L(line);
    if (w.note) for (const line of wrapText(`Nota: ${w.note}`, cols)) L(line);
    if (w.cashierName) L(`Cajero: ${w.cashierName}`.slice(0, cols));
    const when = receiptDateTime(w.createdAt);
    if (when) pad('Ingreso', when);
    divider();
    pad('PRECIO', money(w.priceUsd), { doubleHeight: true, bold: true });
    if (w.paidUsd >= w.priceUsd - 0.005 && w.priceUsd >= 0) {
      C(`PAGADO ${money(w.paidUsd)}`, { bold: true });
    } else if (w.paidUsd > 0) {
      pad('ABONO', money(w.paidUsd));
      C(`PENDIENTE ${money(round(w.priceUsd - w.paidUsd))}`, { bold: true });
    } else {
      C('PENDIENTE DE PAGO', { bold: true });
    }
    divider();
    C(`Ref ${w.shortId}`);
    for (const w2 of wrapText(RECEIPT_DISCLAIMER, cols)) C(w2, { bold: true });
  } else if (payload.kind === 'RETURN_SLIP' && payload.returnSlip) {
    const r = payload.returnSlip;
    C(RECEIPT_RETURN_TITLE, { doubleHeight: true, bold: true });
    if (payload.copy) C(RECEIPT_COPY_MARK, { bold: true });
    divider();
    pad(`Ticket ${r.ticketNumber}`, receiptDateTime(r.createdAt));
    if (r.cashierName) L(`Cajero: ${r.cashierName}`.slice(0, cols));
    if (r.customerName) L(`Cliente: ${r.customerName}`.slice(0, cols));
    divider();
    for (const line of r.lines) {
      L(line.productName.slice(0, cols));
      pad(`  ${line.quantity} unidad(es)`, `-${money(line.amount)}`);
    }
    divider();
    pad('REEMBOLSO', money(r.refundAmount), { doubleHeight: true, bold: true });
    pad(r.refundMethodLabel, money(r.refundAmount));
    for (const w of wrapText(`Motivo: ${r.reason}`, cols)) L(w);
    divider();
    L('Firma cliente:');
    L();
    L('_'.repeat(Math.min(cols, 32)));
    divider();
    for (const w of wrapText(RECEIPT_DISCLAIMER, cols)) C(w, { bold: true });
  }

  L();
  for (const l of payload.footerLines) for (const w of wrapText(l, cols)) C(w);
  return blocks;
}

/**
 * Flatten blocks to monospace text — the on-screen "what you see is what
 * prints" preview and the Jest-asserted layout.
 */
export function renderReceiptText(payload: ReceiptPayload): string {
  const cols = colsForWidth(payload.paper.widthMm);
  const blocks = payload.blocks ?? buildReceiptBlocks(payload);
  return blocks
    .map((b) => {
      if (b.align === 'center') return centerLine(b.text, cols);
      if (b.align === 'right') return b.text.padStart(cols, ' ');
      return b.text;
    })
    .join('\n');
}

/** Attach the rendered blocks to the payload before sending it over IPC. */
export function withBlocks(payload: ReceiptPayload): ReceiptPayload {
  return { ...payload, blocks: buildReceiptBlocks(payload) };
}
