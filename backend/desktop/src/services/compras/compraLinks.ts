// compraLinks — pure helpers for compra → sales invoice / customer linking.
//
// A compra (purchase) can be linked to at most one target: either a sales
// invoice (which auto-fills the invoice's customer too) or a customer
// directly. These helpers are pure and framework-free so they can be unit
// tested in isolation and reused from both the Redux slice and the detail
// pages. Mirrors the same-named helpers in the RN/iOS apps (see
// spec-shared-contract.md — "same four pure helpers").

import type { Compra } from '@/types/compras';

/** True when the compra has an active link to either an invoice or a customer. */
export function isCompraLinked(compra: Compra): boolean {
  return !!(compra.linkedInvoiceId || compra.linkedCustomerId);
}

/**
 * Compras linked to a specific invoice, scoped to the given company
 * (defense in depth — callers should already be passing a company-scoped
 * list, but ComprasDatabase's cache can span multiple companies).
 */
export function comprasLinkedToInvoice(
  compras: Compra[],
  invoiceId: string,
  companyId: string,
): Compra[] {
  return compras.filter(
    (c) => c.companyId === companyId && c.linkedInvoiceId === invoiceId,
  );
}

/** Compras linked to a specific customer, scoped to the given company. */
export function comprasLinkedToCustomer(
  compras: Compra[],
  customerId: string,
  companyId: string,
): Compra[] {
  return compras.filter(
    (c) => c.companyId === companyId && c.linkedCustomerId === customerId,
  );
}

/** Sum of `totalPagar` across the given (already-filtered) compras. */
export function linkedMaterialsTotal(compras: Compra[]): number {
  return compras.reduce((sum, c) => sum + (c.totalPagar ?? 0), 0);
}
