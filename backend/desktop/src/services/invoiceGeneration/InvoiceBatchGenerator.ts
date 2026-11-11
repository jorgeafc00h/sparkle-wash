/**
 * InvoiceBatchGenerator — produces batches of test invoices for the
 * "Request Production Access" flow (one batch per DTE type).
 *
 * Ported from the React Native app's InvoiceGenerationService. Kept separate
 * from the existing `InvoiceGenerationService` (which handles single-invoice
 * signing/submission) so the two responsibilities don't collide.
 */

import { Invoice, InvoiceType, InvoiceStatus, InvoiceDetail } from '@/types/invoice';
import { Customer, CustomerType, CustomerDocumentType } from '@/types/customer';
import { Product } from '@/types/product';
import { Company } from '@/types/company';
import { computeTotals } from '@/utils/invoiceTotals';

export interface GenerationProgress {
  current: number;
  total: number;
  percentage: number;
}
export type ProgressCallback = (p: GenerationProgress) => void;

// ── internal helpers ─────────────────────────────────────────────────────────

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16).toUpperCase();
  });
}

function shortId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function docTypeCode(type: InvoiceType): string {
  const map: Record<InvoiceType, string> = {
    [InvoiceType.Factura]: '01',
    [InvoiceType.CCF]: '03',
    [InvoiceType.NotaRemision]: '04',
    [InvoiceType.NotaCredito]: '05',
    [InvoiceType.NotaDebito]: '06',
    [InvoiceType.ComprobanteRetencion]: '07',
    [InvoiceType.ComprobanteLiquidacion]: '08',
    [InvoiceType.DocumentoContableLiquidacion]: '09',
    [InvoiceType.FacturaExportacion]: '11',
    [InvoiceType.SujetoExcluido]: '14',
    [InvoiceType.ComprobanteDonacion]: '15',
    [InvoiceType.EventoOperacionesEspeciales]: '17',
    [InvoiceType.EventoRetorno]: '18',
  };
  return map[type] ?? '01';
}

function schemaVersion(type: InvoiceType): number {
  const map: Record<InvoiceType, number> = {
    [InvoiceType.Factura]: 2,
    [InvoiceType.CCF]: 4,
    [InvoiceType.NotaRemision]: 4,
    [InvoiceType.NotaCredito]: 4,
    [InvoiceType.NotaDebito]: 4,
    [InvoiceType.ComprobanteRetencion]: 2,
    [InvoiceType.ComprobanteLiquidacion]: 2,
    [InvoiceType.DocumentoContableLiquidacion]: 2,
    [InvoiceType.FacturaExportacion]: 3,
    [InvoiceType.SujetoExcluido]: 2,
    [InvoiceType.ComprobanteDonacion]: 2,
    [InvoiceType.EventoOperacionesEspeciales]: 1,
    [InvoiceType.EventoRetorno]: 1,
  };
  return map[type] ?? 1;
}

function controlNumber(company: Company, type: InvoiceType, invoiceNumber: string): string {
  const tc = docTypeCode(type);
  const establ = company.codEstableMH || 'TEST';
  const pos = company.codPuntoVentaMH || '001';
  return `DTE-${tc}-${establ}${pos}-${invoiceNumber.padStart(15, '0')}`;
}

function calcTotals(items: InvoiceDetail[], type: InvoiceType) {
  const isCCF = type === InvoiceType.CCF;
  let subtotal = 0;
  let tax = 0;
  let total = 0;

  for (const it of items) {
    const itemTotal = Math.round(it.quantity * it.unitPrice * 100) / 100;
    if (isCCF) {
      const itemTax = Math.round((itemTotal - itemTotal / 1.13) * 100) / 100;
      subtotal += itemTotal - itemTax;
      tax += itemTax;
      total += itemTotal;
    } else if (
      type === InvoiceType.SujetoExcluido ||
      type === InvoiceType.FacturaExportacion
    ) {
      subtotal += itemTotal;
      total += itemTotal;
    } else {
      const itemTax = Math.round((itemTotal - itemTotal / 1.13) * 100) / 100;
      tax += itemTax;
      total += itemTotal;
      subtotal = total - tax;
    }
  }

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    tax: Math.round(tax * 100) / 100,
    total: Math.round(total * 100) / 100,
    totalAmount: Math.round(total * 100) / 100,
  };
}

function formatSVDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}

function svDateToNoonIso(svDate: string): string {
  const [year, month, day] = svDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0)).toISOString();
}

function normalizeEmissionDate(value?: Date | string): string {
  if (!value) return svDateToNoonIso(formatSVDate(new Date()));

  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return svDateToNoonIso(value);
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? svDateToNoonIso(formatSVDate(new Date()))
      : svDateToNoonIso(formatSVDate(parsed));
  }

  return svDateToNoonIso(formatSVDate(value));
}

interface RelatedDoc {
  type: string;
  number: string;
  date: Date | string;
  relatedInvoiceType?: InvoiceType;
}

/** Single-invoice generator — mirrors RN `TestDataGenerator.generateInvoice`. */
function generateSingleInvoice(
  type: InvoiceType,
  customer: Customer,
  products: Product[],
  company: Company,
  invoiceNumber: string,
  related?: RelatedDoc,
  emissionDate?: Date | string,
): Invoice {
  const nowIso = new Date().toISOString();
  const emissionIso = normalizeEmissionDate(emissionDate);
  const items: InvoiceDetail[] = products.map((p) => ({
    id: shortId(),
    productId: p.id,
    productName: p.productName,
    quantity: Math.floor(Math.random() * 5) + 1,
    unitPrice: p.unitPrice,
    obsItem: '',
    createdAt: nowIso,
    updatedAt: nowIso,
  }));

  const totals = calcTotals(items, type);
  const isCCF = type === InvoiceType.CCF;

  const invoice: Invoice = {
    id: shortId(),
    invoiceNumber,
    date: emissionIso,
    dueDate: emissionIso,
    status: InvoiceStatus.Nueva,
    customerId: customer.id,
    customer,
    invoiceType: type,
    companyId: company.id,
    items,
    generationCode: uuid(),
    controlNumber: controlNumber(company, type, invoiceNumber),
    documentType: docTypeCode(type),
    // Spread flat fields for compatibility, but also set the nested totals object
    // so DTEMappingService.mapStandardInvoice uses precise decimal values instead
    // of the integer-rounding fallback in calculateTotals().
    ...totals,
    // Canonical totals (same computeTotals the editor and the DTE mapper use):
    // the hand-built object had FSE reteRenta 0 and an un-netted totalPagar,
    // which the mapper now reads straight from the stored totals.
    totals: { ...computeTotals(items, type, false), isCCF, version: schemaVersion(type) },
    createdAt: nowIso,
    updatedAt: nowIso,
  } as Invoice;

  if (related) {
    (invoice as any).relatedDocumentType = related.type;
    (invoice as any).relatedDocumentNumber = related.number;
    (invoice as any).relatedDocumentDate = normalizeEmissionDate(related.date);
    if (related.relatedInvoiceType !== undefined) {
      (invoice as any).relatedInvoiceType = related.relatedInvoiceType;
    }
  }

  return invoice;
}

async function tick() {
  await new Promise((r) => setTimeout(r, 10));
}

function reportProgress(cb: ProgressCallback | undefined, current: number, total: number) {
  cb?.({ current, total, percentage: (current / total) * 100 });
}

// ── simple (no-dependency) DTE types ─────────────────────────────────────────

async function generateSimple(
  type: InvoiceType,
  batchSize: number,
  customers: Customer[],
  products: Product[],
  company: Company,
  startingNumber: number,
  onProgress?: ProgressCallback,
): Promise<Invoice[]> {
  const invoices: Invoice[] = [];
  // Keep emission date aligned with submission date; MH currently rejects
  // backdated payloads in this homologation flow.
  const spreadDates = false;
  // SujetoExcluido performs better with natural-person receptors.
  const seCustomers = customers.filter(
    (c) => c.customerType === CustomerType.Individual || c.documentType === CustomerDocumentType.DUI,
  );
  const pool = type === InvoiceType.SujetoExcluido && seCustomers.length > 0
    ? seCustomers
    : customers;
  for (let i = 0; i < batchSize; i++) {
    const customer = pool[Math.floor(Math.random() * pool.length)];
    const invoiceNumber = String(startingNumber + i).padStart(5, '0');
    const emissionDate = spreadDates
      ? new Date(Date.now() - i * 24 * 60 * 60 * 1000)
      : undefined;
    invoices.push(generateSingleInvoice(type, customer, products, company, invoiceNumber, undefined, emissionDate));
    reportProgress(onProgress, i + 1, batchSize);
    await tick();
  }
  return invoices;
}

// ── CCF-dependent types (Nota Crédito, Nota Débito, Comprobantes) ────────────

/**
 * NC/ND mappers emit `documentoRelacionado.tipoGeneracion = 2` (electronic),
 * which MH validates against parent's UUID `codigoGeneracion`. CL items emit
 * `tipoGeneracion = 1` (físico) which expects the `numeroControl` string. CR
 * auto-detects (UUID → 2, controlNumber → 1). DCL ignores this field
 * altogether (cuerpoDocumento is a periodLiquidacion summary).
 */
function relatedNumberFor(type: InvoiceType, parent: Invoice): string {
  switch (type) {
    case InvoiceType.ComprobanteLiquidacion:
    case InvoiceType.ComprobanteRetencion:
      return parent.controlNumber || parent.invoiceNumber;
    case InvoiceType.NotaCredito:
    case InvoiceType.NotaDebito:
    case InvoiceType.DocumentoContableLiquidacion:
    default:
      return parent.generationCode || parent.controlNumber || parent.invoiceNumber;
  }
}

/**
 * Replace a note's items with the parent's items so totalGravada and other
 * sums never exceed the parent — MH rejects "[016] resumen.totalGravada
 * MONTO ES MAYOR AL DOCUMENTO RELACIONADO" otherwise. Used for NC/ND only;
 * CL/CR have their own single-item logic.
 */
function noteWithParentItems(note: Invoice, parent: Invoice): Invoice {
  if (!parent.items || parent.items.length === 0) return note;
  const items: InvoiceDetail[] = parent.items.map((it) => ({
    ...it,
    id: shortId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
  const totals = calcTotals(items, note.invoiceType);
  const isCCF = note.invoiceType === InvoiceType.CCF;
  return {
    ...note,
    items,
    ...totals,
    totals: { ...computeTotals(items, note.invoiceType, false), isCCF, version: schemaVersion(note.invoiceType) },
  } as Invoice;
}

async function generateCCFDependent(
  type: InvoiceType,
  batchSize: number,
  ccfInvoices: Invoice[],
  customers: Customer[],
  products: Product[],
  company: Company,
  startingNumber: number,
  onProgress?: ProgressCallback,
): Promise<{ notes: Invoice[]; helperCCF: Invoice[] }> {
  const notes: Invoice[] = [];
  const helperCCF: Invoice[] = [];
  // Helper CCFs must use business customers (NIT + NRC required by CCF schema).
  const bizCustomers = customers.filter(
    (c) => c.customerType === CustomerType.Business && c.nit && c.nrc,
  );
  const ccfPool = bizCustomers.length > 0 ? bizCustomers : customers;
  const completedCCF = ccfInvoices.filter(
    (inv) => inv.invoiceType === InvoiceType.CCF && inv.status === InvoiceStatus.Completada,
  );

  // Both Comprobante de Retención (07) and Comprobante de Liquidación (08)
  // need one item per parent CCF — multiple items sharing the same
  // `numDocumento` trip MH's "[cuerpoDocumento.numeroDocumento] VALORES
  // REPETIDOS" (within doc) and "[204] No puede ingresar el mismo numero
  // documento con el mismo estado" (across docs that all reuse one
  // parent's controlNumber). Cap to a single high-priced product so CR's
  // 1% retention also clears MH's "ivaRetenido no cumple el mínimo
  // exclusivo" (a $0.10 product yields ivaRetenido=0 after rounding).
  const limitItems =
    type === InvoiceType.ComprobanteRetencion ||
    type === InvoiceType.ComprobanteLiquidacion;
  const noteProducts = limitItems
    ? [...products].sort((a, b) => b.unitPrice - a.unitPrice).slice(0, 1)
    : products;

  const available = Math.min(completedCCF.length, batchSize);
  const needed = batchSize - available;
  let idx = 0;
  let n = startingNumber;

  // For NC/ND, use the parent's items so totals never exceed the parent.
  // CL/CR use the single high-priced product (limitItems above).
  const inheritParentItems =
    type === InvoiceType.NotaCredito || type === InvoiceType.NotaDebito;

  for (let i = 0; i < available; i++) {
    const ccf = completedCCF[i];
    const num = String(n++).padStart(5, '0');
    let note = generateSingleInvoice(type, ccf.customer || customers[0], noteProducts, company, num, {
      type: ccf.documentType || '03',
      number: relatedNumberFor(type, ccf),
      date: ccf.date,
      relatedInvoiceType: InvoiceType.CCF,
    });
    if (inheritParentItems) note = noteWithParentItems(note, ccf);
    notes.push(note);
    reportProgress(onProgress, ++idx, batchSize);
    await tick();
  }

  for (let i = 0; i < needed; i++) {
    const customer = ccfPool[Math.floor(Math.random() * ccfPool.length)];
    const ccfNum = String(n++).padStart(5, '0');
    const ccf = generateSingleInvoice(InvoiceType.CCF, customer, products, company, ccfNum);
    (ccf as any).isHelperForCreditNote = true;
    helperCCF.push(ccf);

    const noteNum = String(n++).padStart(5, '0');
    let note = generateSingleInvoice(type, customer, noteProducts, company, noteNum, {
      type: ccf.documentType || '03',
      number: relatedNumberFor(type, ccf),
      date: ccf.date,
      relatedInvoiceType: InvoiceType.CCF,
    });
    if (inheritParentItems) note = noteWithParentItems(note, ccf);
    notes.push(note);
    reportProgress(onProgress, ++idx, batchSize);
    await tick();
  }

  return { notes, helperCCF };
}

// ── Nota Remisión (Factura or CCF as base) ───────────────────────────────────

async function generateNotaRemisionInternal(
  batchSize: number,
  baseInvoices: Invoice[],
  customers: Customer[],
  products: Product[],
  company: Company,
  startingNumber: number,
  onProgress?: ProgressCallback,
): Promise<{ remissionNotes: Invoice[]; helperInvoices: Invoice[] }> {
  const remissionNotes: Invoice[] = [];
  const helperInvoices: Invoice[] = [];
  const completedBase = baseInvoices.filter(
    (inv) =>
      (inv.invoiceType === InvoiceType.Factura || inv.invoiceType === InvoiceType.CCF) &&
      inv.status === InvoiceStatus.Completada,
  );

  const available = Math.min(completedBase.length, batchSize);
  const needed = batchSize - available;
  let idx = 0;
  let n = startingNumber;

  const enrich = (note: Invoice, i: number, customer: Customer) => {
    (note as any).nombEntrega = `Entrega ${i + 1}`;
    (note as any).docuEntrega = `DOC${i + 1}`;
    (note as any).receptor = customer.name || 'Receptor';
    (note as any).receptorDocu = customer.nationalId || '';
    (note as any).observaciones = `Nota de remisión de prueba ${i + 1}`;
  };

  for (let i = 0; i < available; i++) {
    const base = completedBase[i];
    const num = String(n++).padStart(5, '0');
    const note = generateSingleInvoice(
      InvoiceType.NotaRemision,
      base.customer || customers[0],
      products,
      company,
      num,
      {
        type: base.documentType || '01',
        number: base.generationCode || base.controlNumber || base.invoiceNumber,
        date: base.date,
        relatedInvoiceType: base.invoiceType,
      },
    );
    enrich(note, i, base.customer || customers[0]);
    remissionNotes.push(note);
    reportProgress(onProgress, ++idx, batchSize);
    await tick();
  }

  for (let i = 0; i < needed; i++) {
    const customer = customers[Math.floor(Math.random() * customers.length)];
    const baseNum = String(n++).padStart(5, '0');
    const base = generateSingleInvoice(
      InvoiceType.Factura,
      customer,
      products,
      company,
      baseNum,
    );
    helperInvoices.push(base);

    const num = String(n++).padStart(5, '0');
    const note = generateSingleInvoice(
      InvoiceType.NotaRemision,
      customer,
      products,
      company,
      num,
      {
        type: base.documentType || '01',
        number: base.generationCode || base.controlNumber || base.invoiceNumber,
        date: base.date,
        relatedInvoiceType: InvoiceType.Factura,
      },
    );
    enrich(note, available + i, customer);
    remissionNotes.push(note);
    reportProgress(onProgress, ++idx, batchSize);
    await tick();
  }

  return { remissionNotes, helperInvoices };
}

// ── Public API ───────────────────────────────────────────────────────────────

export class InvoiceBatchGenerator {
  static generateFacturas = (
    batchSize: number,
    customers: Customer[],
    products: Product[],
    company: Company,
    startingNumber: number,
    onProgress?: ProgressCallback,
  ) => generateSimple(InvoiceType.Factura, batchSize, customers, products, company, startingNumber, onProgress);

  static generateCreditosFiscales = (
    batchSize: number,
    customers: Customer[],
    products: Product[],
    company: Company,
    startingNumber: number,
    onProgress?: ProgressCallback,
  ) => {
    // CCF requires a business receptor with NIT and NRC; individual customers fail MH schema.
    const bizCustomers = customers.filter(
      (c) => c.customerType === CustomerType.Business && c.nit && c.nrc,
    );
    const pool = bizCustomers.length > 0 ? bizCustomers : customers;
    return generateSimple(InvoiceType.CCF, batchSize, pool, products, company, startingNumber, onProgress);
  };

  static generateSujetoExcluido = (
    batchSize: number,
    customers: Customer[],
    products: Product[],
    company: Company,
    startingNumber: number,
    onProgress?: ProgressCallback,
  ) => generateSimple(InvoiceType.SujetoExcluido, batchSize, customers, products, company, startingNumber, onProgress);

  static async generateFacturaExportacion(
    batchSize: number,
    customers: Customer[],
    products: Product[],
    company: Company,
    startingNumber: number,
    onProgress?: ProgressCallback,
  ): Promise<Invoice[]> {
    const invoices = await generateSimple(
      InvoiceType.FacturaExportacion,
      batchSize,
      customers,
      products,
      company,
      startingNumber,
      onProgress,
    );
    // Clone customer onto each invoice — the same Customer object is shared
    // across invoices and across runs (cached in `customersRef`). Once any
    // invoice gets dispatched, Immer freezes its `customer` property, so any
    // later in-place mutation here throws "Cannot add property X, object is
    // not extensible".
    return invoices.map((inv) => {
      if (!inv.customer) return inv;
      const c = inv.customer as any;
      return {
        ...inv,
        customer: {
          ...c,
          codPais: c.codPais || 'US',
          nombrePais: c.nombrePais || 'Estados Unidos',
          tipoPersona: c.tipoPersona || '1',
        },
      };
    });
  }

  static async generateCreditNotes(
    batchSize: number,
    ccfInvoices: Invoice[],
    customers: Customer[],
    products: Product[],
    company: Company,
    startingNumber: number,
    onProgress?: ProgressCallback,
  ) {
    const { notes, helperCCF } = await generateCCFDependent(
      InvoiceType.NotaCredito,
      batchSize,
      ccfInvoices,
      customers,
      products,
      company,
      startingNumber,
      onProgress,
    );
    return { creditNotes: notes, helperCCF };
  }

  static async generateDebitNotes(
    batchSize: number,
    ccfInvoices: Invoice[],
    customers: Customer[],
    products: Product[],
    company: Company,
    startingNumber: number,
    onProgress?: ProgressCallback,
  ) {
    const { notes, helperCCF } = await generateCCFDependent(
      InvoiceType.NotaDebito,
      batchSize,
      ccfInvoices,
      customers,
      products,
      company,
      startingNumber,
      onProgress,
    );
    return { debitNotes: notes, helperCCF };
  }

  static async generateComprobanteLiquidacion(
    batchSize: number,
    ccfInvoices: Invoice[],
    customers: Customer[],
    products: Product[],
    company: Company,
    startingNumber: number,
    onProgress?: ProgressCallback,
  ) {
    const { notes, helperCCF } = await generateCCFDependent(
      InvoiceType.ComprobanteLiquidacion,
      batchSize,
      ccfInvoices,
      customers,
      products,
      company,
      startingNumber,
      onProgress,
    );
    return { comprobantes: notes, helperCCF };
  }

  static async generateComprobanteRetencion(
    batchSize: number,
    ccfInvoices: Invoice[],
    customers: Customer[],
    products: Product[],
    company: Company,
    startingNumber: number,
    onProgress?: ProgressCallback,
  ) {
    const { notes, helperCCF } = await generateCCFDependent(
      InvoiceType.ComprobanteRetencion,
      batchSize,
      ccfInvoices,
      customers,
      products,
      company,
      startingNumber,
      onProgress,
    );
    return { comprobantes: notes, helperCCF };
  }

  static generateNotaRemision = generateNotaRemisionInternal;

  /** DTE 09 — Documento Contable de Liquidación. Requires completed CCF as base. */
  static async generateDocumentoContableLiquidacion(
    batchSize: number,
    ccfInvoices: Invoice[],
    customers: Customer[],
    products: Product[],
    company: Company,
    startingNumber: number,
    onProgress?: ProgressCallback,
  ) {
    const { notes, helperCCF } = await generateCCFDependent(
      InvoiceType.DocumentoContableLiquidacion,
      batchSize,
      ccfInvoices,
      customers,
      products,
      company,
      startingNumber,
      onProgress,
    );
    return { documentos: notes, helperCCF };
  }

  /** DTE 15 — Comprobante de Donación. */
  static generateComprobanteDonacion = (
    batchSize: number,
    customers: Customer[],
    products: Product[],
    company: Company,
    startingNumber: number,
    onProgress?: ProgressCallback,
  ) =>
    generateSimple(
      InvoiceType.ComprobanteDonacion,
      batchSize,
      customers,
      products,
      company,
      startingNumber,
      onProgress,
    );
}

export default InvoiceBatchGenerator;
