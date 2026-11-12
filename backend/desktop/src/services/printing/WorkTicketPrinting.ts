// Carwash work ticket ("orden de trabajo") — one printed ticket per car
// detailing. Pure builder (`buildWorkTicketReceipt`) + a never-throwing
// printer (`printWorkTicket`) that prints N copies through the shared
// receipt pipeline (ReceiptDocument blocks → ESC/POS).

import type { Company } from '@/types/company';
import type { CarwashJob } from '../carwash/types';
import type { PosSettings } from '../tickets/PosSettingsStore';
import type { ReceiptPayload } from './ReceiptDocument';
import { printReceipt, previewReceiptText } from './PosPrinting';
import type { PrintResult } from './ThermalPrinterBridge';

export interface WorkTicketOptions {
  companyName: string;
  companyPhone?: string;
  companyAddress?: string;
  registerCode?: string;
  cashierName?: string;
  /** Footer line(s) — "Presente este ticket al retirar su vehículo". */
  footer: string | string[];
  paper: { widthMm: 80 | 58; cut?: boolean };
  /** "COPIA CLIENTE" / "COPIA VEHÍCULO" … */
  copyLabel?: string;
  companyId?: string;
  /** Human name of `job.vehicleClass` (the job only carries the class id). */
  vehicleClassName?: string;
}

export const WORK_TICKET_COPY_LABELS = ['COPIA CLIENTE', 'COPIA VEHÍCULO', 'COPIA CAJA'] as const;

/** Labels for N copies: a single copy carries no label. */
export function workTicketCopyLabels(copies: number): Array<string | undefined> {
  const n = Math.max(1, Math.min(3, Math.floor(Number.isFinite(copies) ? copies : 1)));
  if (n === 1) return [undefined];
  return Array.from({ length: n }, (_, i) => WORK_TICKET_COPY_LABELS[i]);
}

/** Last-resort id → readable fallback when the catalog has no class name ("suv" → "Suv"). */
function prettyClassName(id: string): string {
  const spaced = id.replace(/[-_]+/g, ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : '-';
}

export function shortJobId(id: string): string {
  return id.replace(/^local-/, '').replace(/-/g, '').slice(0, 8).toUpperCase();
}

export function buildWorkTicketReceipt(job: CarwashJob, opts: WorkTicketOptions): ReceiptPayload {
  const footerLines = Array.isArray(opts.footer) ? opts.footer : opts.footer ? [opts.footer] : [];
  const employees = Array.from(new Set((job.assignments ?? []).map((a) => a.employeeName).filter(Boolean)));
  return {
    kind: 'WORK_ORDER',
    companyId: opts.companyId ?? '',
    companyName: opts.companyName,
    companyAddress: opts.companyAddress,
    companyPhone: opts.companyPhone,
    headerLines: [],
    footerLines,
    paper: { widthMm: opts.paper.widthMm },
    cut: opts.paper.cut ?? true,
    workOrder: {
      ticketNumber: job.ticketNumber || `OT-${opts.registerCode ?? 'C1'}-PENDIENTE`,
      plate: job.plate,
      vehicleClassName: opts.vehicleClassName || prettyClassName(job.vehicleClass),
      packageName: job.packageName,
      services: [...(job.services ?? [])],
      employees,
      customerName: job.customerName || undefined,
      note: job.note || undefined,
      createdAt: job.arrivalAt,
      cashierName: opts.cashierName,
      priceUsd: job.priceUsd,
      paidUsd: job.paidUsd ?? 0,
      shortId: shortJobId(job.id),
      copyLabel: opts.copyLabel,
    },
  };
}

export interface PrintWorkTicketOptions extends Omit<WorkTicketOptions, 'paper' | 'copyLabel' | 'companyName'> {
  company?: Pick<Company, 'id' | 'nombre' | 'nombreComercial' | 'telefono' | 'direccion' | 'complemento'> | null;
  companyName?: string;
  /** Copies to print (1–3). */
  copies?: number;
}

/** One payload per copy — shared by the printer and the on-screen preview. */
export function buildWorkTicketCopies(job: CarwashJob, settings: PosSettings, opts: PrintWorkTicketOptions): ReceiptPayload[] {
  const company = opts.company;
  const base: Omit<WorkTicketOptions, 'copyLabel'> = {
    companyId: company?.id ?? opts.companyId,
    companyName: opts.companyName || company?.nombreComercial || company?.nombre || 'Car Spa',
    companyPhone: opts.companyPhone ?? company?.telefono,
    companyAddress: opts.companyAddress ?? (company?.complemento || company?.direccion),
    registerCode: opts.registerCode,
    cashierName: opts.cashierName,
    footer: opts.footer,
    vehicleClassName: opts.vehicleClassName,
    paper: { widthMm: settings.printer?.paper.widthMm ?? 80, cut: settings.printer?.paper.cut ?? true },
  };
  return workTicketCopyLabels(opts.copies ?? 1).map((copyLabel) => buildWorkTicketReceipt(job, { ...base, copyLabel }));
}

export interface PrintWorkTicketResult {
  ok: boolean;
  /** Copies that reached the printer. */
  printed: number;
  error?: string;
}

/** Print every copy sequentially. Never throws. */
export async function printWorkTicket(
  job: CarwashJob,
  settings: PosSettings,
  opts: PrintWorkTicketOptions,
): Promise<PrintWorkTicketResult> {
  let printed = 0;
  try {
    for (const payload of buildWorkTicketCopies(job, settings, opts)) {
      const result: PrintResult = await printReceipt(payload, settings);
      if (!result.ok) return { ok: false, printed, error: result.error ?? 'Error de impresión' };
      printed += 1;
    }
    return { ok: true, printed };
  } catch (err) {
    return { ok: false, printed, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Plain-text preview of the first copy (web / no printer). */
export function previewWorkTicketText(job: CarwashJob, settings: PosSettings, opts: PrintWorkTicketOptions): string {
  return previewReceiptText(buildWorkTicketCopies(job, settings, { ...opts, copies: 1 })[0]);
}
