// Which completed documents a linked DTE may reference — shared by the create
// (AddInvoicePage) and edit (EditInvoicePage) pickers, mirroring the detail
// page's "Generar …" actions (InvoiceDetailPage canCreateNC/ND/NR/CL):
//   - Nota de Crédito / Débito adjust a CCF (MH can't relate them to a Factura).
//   - Nota de Remisión / Comprobante de Liquidación relate to a CCF or Factura.
// Types without an entry (CR, DCL, …) keep every completed document.

import { Invoice, InvoiceStatus, InvoiceType } from '../../types/invoice';

export const RELATED_PARENT_TYPES: Partial<Record<InvoiceType, ReadonlySet<InvoiceType>>> = {
  [InvoiceType.NotaCredito]: new Set([InvoiceType.CCF]),
  [InvoiceType.NotaDebito]: new Set([InvoiceType.CCF]),
  [InvoiceType.NotaRemision]: new Set([InvoiceType.CCF, InvoiceType.Factura]),
  [InvoiceType.ComprobanteLiquidacion]: new Set([InvoiceType.CCF, InvoiceType.Factura]),
};

/** Linked types that cannot be issued without their parent (MH requires documentoRelacionado). */
export const REQUIRED_PARENT_MESSAGE: Partial<Record<InvoiceType, string>> = {
  [InvoiceType.NotaCredito]: 'Selecciona el CCF que corrige esta Nota de Crédito.',
  [InvoiceType.NotaDebito]: 'Selecciona el CCF que corrige esta Nota de Débito.',
};

/** A parent must be accepted by MH (Completada, or Modificada by an earlier note). */
export function isLinkableParentStatus(status: InvoiceStatus): boolean {
  return status === InvoiceStatus.Completada || status === InvoiceStatus.Modificada;
}

/** Completed documents a `childType` document may reference. */
export function eligibleParents<T extends Pick<Invoice, 'invoiceType' | 'status'>>(
  invoices: T[],
  childType: InvoiceType | null | undefined,
): T[] {
  const completed = invoices.filter((inv) => isLinkableParentStatus(inv.status));
  const allowed = childType != null ? RELATED_PARENT_TYPES[childType] : undefined;
  return allowed ? completed.filter((inv) => allowed.has(inv.invoiceType)) : completed;
}
