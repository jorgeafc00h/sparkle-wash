// Build + send ticket/Z receipts through the thermal bridge. Shared by the
// POS register, ticket list reprint and the cierre page.

import type { Company } from '@/types/company';
import type { CashClosing, PaymentMethod, Ticket, TicketReturn } from '@/types/ticket';
import { formatTicketNumber } from '../tickets/ticketNumber';
import type { PosSettings } from '../tickets/PosSettingsStore';
import type { ReceiptPayload } from './ReceiptDocument';
import { renderReceiptText } from './ReceiptDocument';
import { thermalPrinterBridge, type PrintResult } from './ThermalPrinterBridge';
import { TelemetryService } from '../telemetry/TelemetryService';
import { LocalLogger } from '../logging/LocalLogger';
import { TelemetryEvent } from '../../config/telemetryConfig';

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  EFECTIVO: 'EFECTIVO',
  TARJETA_POS: 'TARJETA',
  OTRO: 'OTRO',
};

export interface TicketReceiptOptions {
  /**
   * 'sale' = the receipt printed right after the sale (opens the cash drawer
   * when paid in cash and enabled); 'reprint' = any later print, stamped
   * "REIMPRESIÓN / COPIA" and never opening the drawer. VOID tickets are
   * always printed as a copy.
   */
  purpose?: 'sale' | 'reprint';
}

export function buildTicketReceipt(
  ticket: Ticket,
  company: Company,
  settings: PosSettings,
  options: TicketReceiptOptions = {},
): ReceiptPayload {
  const printer = settings.printer;
  const voided = ticket.status === 'VOID';
  const isSale = (options.purpose ?? 'sale') === 'sale' && !voided;
  return {
    kind: 'TICKET',
    companyId: company.id,
    companyName: company.nombreComercial || company.nombre,
    companyNit: company.nit,
    companyAddress: company.complemento || company.direccion,
    companyPhone: company.telefono,
    headerLines: printer?.headerLines ?? [],
    footerLines: printer?.footerLines ?? ['Factura disponible a solicitud.'],
    paper: { widthMm: printer?.paper.widthMm ?? 80 },
    cut: printer?.paper.cut ?? true,
    copy: !isSale,
    cashDrawerKick: isSale && !!printer?.cashDrawerKick && ticket.payments.some((p) => p.method === 'EFECTIVO'),
    ticket: {
      sequential: ticket.sequential,
      registerCode: ticket.registerCode,
      id: ticket.id,
      completedAt: ticket.completedAt ?? ticket.createdAt,
      cashierName: ticket.cashierName,
      customerName: ticket.customerName,
      lines: ticket.items.map((l) => ({
        productName: l.productName,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
        discount: l.discount,
        obs: l.obs,
      })),
      discountTotal: ticket.discountTotal,
      roundingAdjustment: ticket.roundingAdjustment,
      totalAmount: ticket.totalAmount,
      taxIncluded: ticket.taxIncluded,
      payments: ticket.payments.map((p) => ({
        methodLabel: METHOD_LABELS[p.method] ?? p.method,
        amount: p.amount,
        tendered: p.tendered,
        change: p.change,
        detail: p.method === 'TARJETA_POS'
          ? [p.posCardType, p.posLast4 ? `****${p.posLast4}` : undefined, p.posAuthCode ? `Auth ${p.posAuthCode}` : undefined, p.posReference ? `Ref ${p.posReference}` : undefined]
              .filter(Boolean).join(' · ')
          : undefined,
      })),
      excludedFromLibros: !!ticket.excludeFromLibrosIVA,
      voided,
      voidedAt: voided ? ticket.voidedAt : undefined,
      voidReason: voided ? ticket.voidReason : undefined,
    },
  };
}

export function buildZReceipt(closing: CashClosing, company: Company, settings: PosSettings): ReceiptPayload {
  const printer = settings.printer;
  return {
    kind: 'Z_REPORT',
    companyId: company.id,
    companyName: company.nombreComercial || company.nombre,
    companyNit: company.nit,
    companyAddress: company.complemento || company.direccion,
    companyPhone: company.telefono,
    headerLines: printer?.headerLines ?? [],
    footerLines: printer?.footerLines ?? [],
    paper: { widthMm: printer?.paper.widthMm ?? 80 },
    cut: printer?.paper.cut ?? true,
    zReport: {
      label: 'CIERRE DE CAJA (Z)',
      from: closing.from || closing.closedAt,
      to: closing.closedAt,
      ticketCount: closing.totals.ticketCount,
      voidedCount: closing.totals.voidedCount,
      grossTotal: closing.totals.grossTotal,
      ivaIncluded: closing.totals.ivaIncluded,
      priorVoidCount: closing.totals.priorVoidCount ?? 0,
      priorVoidAmount: closing.totals.priorVoidAmount ?? 0,
      netTotal: closing.totals.netTotal,
      registerLabel: closing.registerCode || undefined,
      discountTotal: closing.totals.discountTotal ?? 0,
      refundCount: closing.totals.refunds?.count ?? 0,
      refundAmount: closing.totals.refunds?.amount ?? 0,
      byCashier: Object.entries(closing.totals.byCashier ?? {})
        .sort((a, b) => b[1].amount - a[1].amount || a[0].localeCompare(b[0]))
        .map(([name, row]) => ({ name, count: row.count, amount: row.amount })),
      byProduct: (closing.totals.byProduct ?? []).map((row) => ({ name: row.name, quantity: row.quantity, amount: row.amount })),
      cash: closing.cash
        ? {
            openingFloat: closing.cash.openingFloat,
            cashSales: closing.cash.cashSales,
            cashRefunds: closing.cash.cashRefunds,
            cashIn: closing.cash.cashIn,
            cashOut: closing.cash.cashOut,
            expected: closing.cash.expected,
            counted: closing.cash.counted,
            difference: closing.cash.difference,
          }
        : undefined,
      byMethod: (Object.keys(closing.totals.byMethod) as PaymentMethod[])
        .filter((m) => closing.totals.byMethod[m].count > 0 || (closing.totals.byMethod[m].refundCount ?? 0) > 0)
        .map((m) => ({
          methodLabel: METHOD_LABELS[m],
          count: closing.totals.byMethod[m].count,
          amount: closing.totals.byMethod[m].amount,
          cashTendered: closing.totals.byMethod[m].cashTendered,
          cashChange: closing.totals.byMethod[m].cashChange,
          refundAmount: closing.totals.byMethod[m].refundAmount ?? 0,
        })),
    },
  };
}

/** Non-fiscal "COMPROBANTE DE DEVOLUCIÓN" for one partial return. */
export function buildReturnReceipt(
  ticket: Ticket,
  ret: TicketReturn,
  company: Company,
  settings: PosSettings,
  options: { copy?: boolean } = {},
): ReceiptPayload {
  const printer = settings.printer;
  const lineById = new Map(ticket.items.map((l) => [l.id, l]));
  return {
    kind: 'RETURN_SLIP',
    companyId: company.id,
    companyName: company.nombreComercial || company.nombre,
    companyNit: company.nit,
    companyAddress: company.complemento || company.direccion,
    companyPhone: company.telefono,
    headerLines: printer?.headerLines ?? [],
    footerLines: [],
    paper: { widthMm: printer?.paper.widthMm ?? 80 },
    cut: printer?.paper.cut ?? true,
    copy: !!options.copy,
    returnSlip: {
      ticketNumber: formatTicketNumber(ticket),
      returnId: ret.id,
      createdAt: ret.createdAt,
      cashierName: ret.createdBy,
      customerName: ticket.customerName,
      reason: ret.reason,
      lines: ret.lines.map((l) => ({
        productName: lineById.get(l.lineId)?.productName ?? 'Producto',
        quantity: l.quantity,
        amount: l.amount,
      })),
      refundMethodLabel: METHOD_LABELS[ret.refund.method] ?? ret.refund.method,
      refundAmount: ret.refund.amount,
    },
  };
}

/** Print (if configured). Never throws — returns the result for toasts. */
export async function printReceipt(
  payload: ReceiptPayload,
  settings: PosSettings,
): Promise<PrintResult> {
  if (!settings.printer) {
    const result: PrintResult = { ok: false, error: 'Sin impresora configurada (Configuración → Impresora de tickets)' };
    TelemetryService.trackEvent(TelemetryEvent.TicketPrintFailed, {
      reason: 'no-printer-configured',
      kind: payload.kind,
    });
    LocalLogger.warn('printing', 'Print skipped — no printer configured', { kind: payload.kind });
    return result;
  }

  const transport = settings.printer.transport;
  const startedAt = Date.now();
  const result = await thermalPrinterBridge.print(settings.printer, payload);
  const durationMs = Date.now() - startedAt;

  if (result.ok) {
    TelemetryService.trackEvent(TelemetryEvent.TicketPrintCompleted, {
      kind: payload.kind,
      transport: transport ?? 'unknown',
      durationMs,
    });
    LocalLogger.event('printing', 'Receipt printed', { kind: payload.kind, transport, durationMs });
  } else {
    TelemetryService.trackEvent(TelemetryEvent.TicketPrintFailed, {
      kind: payload.kind,
      transport: transport ?? 'unknown',
      durationMs,
      error: result.error?.slice(0, 200),
      stage: result.stage,
      code: result.code,
    });
    LocalLogger.error('printing', 'Receipt print failed', undefined, {
      kind: payload.kind,
      transport,
      durationMs,
      error: result.error,
      stage: result.stage,
      code: result.code,
    });
  }
  return result;
}

/** On-screen preview text (web-safe). */
export function previewReceiptText(payload: ReceiptPayload): string {
  return renderReceiptText(payload);
}
