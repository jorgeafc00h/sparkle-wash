// CompanyEmisorSanitizer
// Bridges incomplete company configs to the strict MH `Emisor` schema for the
// production-access homologation batch. The user's company config is often
// missing or has malformed values for descActividad / tipoEstablecimiento /
// direccion fields — fields the regular invoice flow surfaces to the user via
// the company form, but which the homologation batch can't ask for at run
// time. Rather than fail every test invoice with cryptic MH 096s, we
// substitute MH-schema-valid defaults here so the batch can complete.
//
// Constraints lifted from `Invoices.Api/src/Infrastructure/DTO/DTE_.cs`
// (`Emisor` + `Direccion`) and `DTE_SE.cs` (`EmisorSE`).

import { Company } from '@/types/company';
import { Customer } from '@/types/customer';

const TIPO_ESTABLECIMIENTO_ALLOWED = new Set(['01', '02', '04', '07', '20']);
const DEPARTAMENTO_RE = /^(0[1-9]|1[0-4])$/;
const MUNICIPIO_RE = /^[0-9]{2}$/;
const COD_ACTIVIDAD_RE = /^[0-9]{2,6}$/;

// Defaults pulled from `Invoices.Api/Test/Integration/InvoiceTagging/DTE_FSE.json`
// — known-good values MH's homologation accepts.
const DEFAULTS = {
  descActividad: 'Otras actividades de servicios personales n.c.p.',
  tipoEstablecimiento: '07',
  complemento: 'San Salvador, El Salvador',
  departamentoCode: '06',
  municipioCode: '14',
  codActividad: '96099',
  telefono: '00000000',
};

export interface SanitizeEmisorResult {
  company: Company;
  warnings: string[];
}

export function sanitizeCompanyForEmisor(company: Company): SanitizeEmisorResult {
  const warnings: string[] = [];
  const fixed: Company = { ...company };

  if (!fixed.descActividad || fixed.descActividad.trim().length < 5) {
    warnings.push(
      `descActividad ("${fixed.descActividad ?? ''}") < 5 chars — using "${DEFAULTS.descActividad}"`,
    );
    fixed.descActividad = DEFAULTS.descActividad;
  }

  if (!TIPO_ESTABLECIMIENTO_ALLOWED.has(fixed.tipoEstablecimiento)) {
    warnings.push(
      `tipoEstablecimiento "${fixed.tipoEstablecimiento ?? ''}" not in {01,02,04,07,20} — using "07"`,
    );
    fixed.tipoEstablecimiento = DEFAULTS.tipoEstablecimiento;
  }

  if (!fixed.complemento || fixed.complemento.trim().length === 0) {
    warnings.push(`direccion.complemento empty — using "${DEFAULTS.complemento}"`);
    fixed.complemento = DEFAULTS.complemento;
    // Keep `direccion` alias in sync (CreateCompanyInput uses both keys).
    fixed.direccion = DEFAULTS.complemento;
  }

  if (!fixed.departamentoCode || !DEPARTAMENTO_RE.test(fixed.departamentoCode)) {
    warnings.push(
      `direccion.departamento "${fixed.departamentoCode ?? ''}" invalid — using "06"`,
    );
    fixed.departamentoCode = DEFAULTS.departamentoCode;
  }

  if (!fixed.municipioCode || !MUNICIPIO_RE.test(fixed.municipioCode)) {
    warnings.push(
      `direccion.municipio "${fixed.municipioCode ?? ''}" invalid — using "14"`,
    );
    fixed.municipioCode = DEFAULTS.municipioCode;
  }

  if (
    !fixed.codActividad ||
    !COD_ACTIVIDAD_RE.test(fixed.codActividad) ||
    fixed.codActividad.length < 5
  ) {
    warnings.push(
      `codActividad "${fixed.codActividad ?? ''}" not 5–6 digits — using "96099"`,
    );
    fixed.codActividad = DEFAULTS.codActividad;
  }

  // Telefono: MH requires 8–30 chars on emisor (digits-only stripping happens
  // in the mapper). Accept a raw value that has at least 8 digits in it.
  const telDigits = (fixed.telefono ?? '').replace(/\D/g, '');
  if (telDigits.length < 8) {
    warnings.push(`telefono "${fixed.telefono ?? ''}" < 8 digits — using "${DEFAULTS.telefono}"`);
    fixed.telefono = DEFAULTS.telefono;
  }

  // codEstableMH / codPuntoVentaMH: MH requires the keys present and ≤4 chars.
  // Empty strings pass length but the mapper emits null when empty — that's
  // accepted. Only normalize if a non-empty value exceeds the length.
  if (fixed.codEstableMH && fixed.codEstableMH.length > 4) {
    warnings.push(`codEstableMH "${fixed.codEstableMH}" > 4 chars — truncating`);
    fixed.codEstableMH = fixed.codEstableMH.slice(0, 4);
  }
  if (fixed.codPuntoVentaMH && fixed.codPuntoVentaMH.length > 4) {
    warnings.push(`codPuntoVentaMH "${fixed.codPuntoVentaMH}" > 4 chars — truncating`);
    fixed.codPuntoVentaMH = fixed.codPuntoVentaMH.slice(0, 4);
  }

  return { company: fixed, warnings };
}

export interface SanitizeReceptorResult {
  customer: Customer | undefined;
  warnings: string[];
}

// Customer-side counterpart. Customer document fields are optional for DTE 01
// when the customer has no DUI/NIT, so real customer records must keep that
// absence and let the mapper omit tipoDocumento/numDocumento. We still back-fill
// contact/location fields that MH requires and keep a synthetic document only
// for the exceptional case where an invoice has no customer at all.
//
// Defaults match the test fixture `DTE_FSE.json` shape (which MH accepts).
const RECEPTOR_DEFAULTS = {
  email: 'sin-correo@example.com',
  phone: '00000000',
  nationalId: '00000000-0',
  address: 'San Salvador, El Salvador',
  departmentCode: '06',
  municipalityCode: '14',
};

export function sanitizeCustomerForReceptor(
  customer: Customer | undefined,
): SanitizeReceptorResult {
  const warnings: string[] = [];
  // No customer at all — synthesize a complete MH-valid placeholder so the
  // mapper doesn't emit `undefined` for receptor.tipoDocumento /
  // telefono / correo / direccion fields. MH rejects every Factura/CCF/NRE
  // submission without a fully-populated receptor; we don't want a missing
  // customer at the form layer to translate into a cryptic [096] later.
  if (!customer) {
    warnings.push('invoice has no customer — using synthetic homologation placeholder');
    const placeholder: Customer = {
      id: '__placeholder__',
      firstName: 'Cliente',
      lastName: 'No Asignado',
      name: 'Cliente No Asignado',
      nationalId: RECEPTOR_DEFAULTS.nationalId,
      nit: '',
      documentType: 'DUI' as Customer['documentType'],
      email: RECEPTOR_DEFAULTS.email,
      phone: RECEPTOR_DEFAULTS.phone,
      address: RECEPTOR_DEFAULTS.address,
      departmentCode: RECEPTOR_DEFAULTS.departmentCode,
      municipalityCode: RECEPTOR_DEFAULTS.municipalityCode,
      hasContributorRetention: false,
      customerType: 0 as Customer['customerType'],
      isActive: true,
      companyId: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return { customer: placeholder, warnings };
  }
  const fixed: Customer = { ...customer };

  // numDocumento format depends on tipoDocumento. For natural persons we use
  // DUI (`NNNNNNNN-N`); for businesses NIT digits-only. If neither is present,
  // keep the document fields empty so DTE 01 can omit them.
  const hasNit = !!fixed.nit && /^[\d-]{9,17}$/.test(fixed.nit);
  const hasDui =
    !!fixed.nationalId &&
    (/^\d{8}-\d$/.test(fixed.nationalId) ||
      fixed.nationalId.replace(/\D/g, '').length === 9);
  if (!hasNit && !hasDui) {
    warnings.push(
      `customer "${fixed.name ?? fixed.firstName ?? fixed.id}" has no valid nationalId/nit — omitting receptor document fields`,
    );
    fixed.nationalId = '';
    fixed.nit = '';
  }

  if (!fixed.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fixed.email)) {
    warnings.push(
      `customer "${fixed.name ?? fixed.firstName ?? fixed.id}" email "${fixed.email ?? ''}" invalid — using placeholder`,
    );
    fixed.email = RECEPTOR_DEFAULTS.email;
  }

  const telDigits = (fixed.phone ?? '').replace(/\D/g, '');
  if (telDigits.length < 8) {
    warnings.push(
      `customer "${fixed.name ?? fixed.firstName ?? fixed.id}" phone "${fixed.phone ?? ''}" < 8 digits — using placeholder`,
    );
    fixed.phone = RECEPTOR_DEFAULTS.phone;
  }

  if (!fixed.address || fixed.address.trim().length === 0) {
    warnings.push(
      `customer "${fixed.name ?? fixed.firstName ?? fixed.id}" has empty address — using placeholder`,
    );
    fixed.address = RECEPTOR_DEFAULTS.address;
  }

  if (!fixed.departmentCode || !DEPARTAMENTO_RE.test(fixed.departmentCode)) {
    warnings.push(
      `customer "${fixed.name ?? fixed.firstName ?? fixed.id}" departmentCode "${fixed.departmentCode ?? ''}" invalid — using "06"`,
    );
    fixed.departmentCode = RECEPTOR_DEFAULTS.departmentCode;
  }

  if (!fixed.municipalityCode || !MUNICIPIO_RE.test(fixed.municipalityCode)) {
    warnings.push(
      `customer "${fixed.name ?? fixed.firstName ?? fixed.id}" municipalityCode "${fixed.municipalityCode ?? ''}" invalid — using "14"`,
    );
    fixed.municipalityCode = RECEPTOR_DEFAULTS.municipalityCode;
  }

  // codActividad/descActividad are only sent for CCF receptors. If the
  // customer is going to be used on a CCF and these are missing/invalid, the
  // mapper either emits them as null (Factura — accepted) or with the
  // customer's value (CCF — must be valid). Normalize when present so a
  // mistyped value doesn't crash CCF flows.
  if (
    fixed.codActividad &&
    (!COD_ACTIVIDAD_RE.test(fixed.codActividad) || fixed.codActividad.length < 5)
  ) {
    warnings.push(
      `customer "${fixed.name ?? fixed.firstName ?? fixed.id}" codActividad "${fixed.codActividad}" invalid — clearing (will be sent as null)`,
    );
    fixed.codActividad = undefined;
  }
  if (fixed.descActividad && fixed.descActividad.trim().length < 5) {
    warnings.push(
      `customer "${fixed.name ?? fixed.firstName ?? fixed.id}" descActividad "${fixed.descActividad}" < 5 chars — clearing`,
    );
    fixed.descActividad = undefined;
  }

  return { customer: fixed, warnings };
}
