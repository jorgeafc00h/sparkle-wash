// Purchases imported from a mailbox must be addressed to the company: a shared
// inbox (or a TEST/PROD company pair) also receives DTEs issued to other
// NITs, and importing them into the selected company corrupts Compras and the
// Libros IVA.

import type { Compra } from '@/types/compras';

export interface CompanyTaxIdentity {
  nit?: string;
  nrc?: string;
}

type CompanyIdentityResolver = (companyId: string) => CompanyTaxIdentity | null | undefined;

let resolver: CompanyIdentityResolver | null = null;

/** Wired once from the store so background syncs can look up the company. */
export function setCompanyIdentityResolver(fn: CompanyIdentityResolver | null): void {
  resolver = fn;
}

export function resolveCompanyIdentity(companyId: string): CompanyTaxIdentity | null {
  return resolver?.(companyId) ?? null;
}

const digits = (value?: string | null) => (value ?? '').replace(/\D/g, '');

/**
 * False only when the DTE clearly names another receptor. Missing data on
 * either side is accepted (consumidor final, DTE types without receptor), and
 * so is a 9-digit DUI vs a legacy 14-digit NIT — the same taxpayer can be
 * identified either way and the two can't be compared.
 */
export function isAddressedToCompany(
  compra: Pick<Compra, 'receptorNit' | 'receptorNrc'>,
  company: CompanyTaxIdentity | null,
): boolean {
  if (!company) return true;
  const receptorNit = digits(compra.receptorNit);
  const receptorNrc = digits(compra.receptorNrc);
  const companyNit = digits(company.nit);
  const companyNrc = digits(company.nrc);

  if (receptorNit && companyNit && receptorNit === companyNit) return true;
  if (receptorNrc && companyNrc && receptorNrc === companyNrc) return true;

  const nitComparable = !!receptorNit && receptorNit.length === companyNit.length;
  const nrcComparable = !!receptorNrc && !!companyNrc;
  return !nitComparable && !nrcComparable;
}
