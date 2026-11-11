// MHSchemaValidator
// Validates Company and Customer records against the MH (Ministerio de
// Hacienda) DTE schemas. Used by the company / customer forms to BLOCK saves
// of records that would later be rejected by MH at submission time. Returns
// a list of `{ field, message }` objects so the caller can attach inline
// errors and surface a toast summary.
//
// Constraints lifted from the .NET DTOs:
//   `Invoices.Api/src/Infrastructure/DTO/DTE_.cs` (Emisor, Direccion,
//    Receptor) and `DTE_SE.cs` (EmisorSE).

import type { Company } from '@/types/company';
import type { Customer } from '@/types/customer';

export interface FieldError {
  field: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: FieldError[];
}

// Regexes matching the C# `[RegularExpression]` attributes on the Emisor /
// Receptor DTOs. Comments next to each call out the field this gates.
const NIT_RE = /^([0-9]{14}|[0-9]{9}|[0-9]{4}-[0-9]{6}-[0-9]{3}-[0-9])$/; // Emisor.Nit + Receptor.Nit (digits or dashed form)
const NRC_RE = /^[0-9]{1,8}$/; // Emisor.Nrc + Receptor.Nrc
const COD_ACTIVIDAD_RE = /^[0-9]{2,6}$/; // Emisor.CodActividad + Receptor.CodActividad
const TIPO_ESTABLECIMIENTO_ALLOWED = new Set(['01', '02', '04', '07', '20']); // Emisor.TipoEstablecimiento
const DEPARTAMENTO_RE = /^(0[1-9]|1[0-4])$/; // Direccion.Departamento (CAT-012 codes)
const MUNICIPIO_RE = /^[0-9]{2}$/; // Direccion.Municipio
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // Emisor.Correo + Receptor.Correo
const DUI_RE = /^[0-9]{8}-[0-9]$/; // Customer.nationalId — DUI canonical form

// Validates a Company record against the MH `Emisor` schema. Used by
// CompanyConfigPage's basic-info / location / activity save handlers + the
// CreateCompanyPage wizard final step.
export function validateCompanyForMH(company: Pick<
  Company,
  | 'nit'
  | 'nrc'
  | 'nombre'
  | 'codActividad'
  | 'descActividad'
  | 'tipoEstablecimiento'
  | 'departamentoCode'
  | 'municipioCode'
  | 'complemento'
  | 'telefono'
  | 'correo'
>): ValidationResult {
  const errors: FieldError[] = [];

  if (!company.nit || !NIT_RE.test(company.nit.trim())) {
    errors.push({
      field: 'nit',
      message: 'NIT debe tener 9 o 14 dígitos (acepta el formato NNNN-NNNNNN-NNN-N).',
    });
  }
  if (!company.nrc || !NRC_RE.test(company.nrc.trim())) {
    errors.push({ field: 'nrc', message: 'NRC debe ser de 1 a 8 dígitos.' });
  }
  if (!company.nombre || company.nombre.trim().length < 1) {
    errors.push({ field: 'nombre', message: 'Razón social requerida.' });
  }
  if (
    !company.codActividad ||
    !COD_ACTIVIDAD_RE.test(company.codActividad) ||
    company.codActividad.length < 2
  ) {
    errors.push({
      field: 'codActividad',
      message: 'Código de actividad económica debe ser de 2 a 6 dígitos (CAT-019).',
    });
  }
  if (!company.descActividad || company.descActividad.trim().length < 5) {
    errors.push({
      field: 'descActividad',
      message: 'Descripción de actividad debe tener al menos 5 caracteres.',
    });
  }
  if (!company.tipoEstablecimiento || !TIPO_ESTABLECIMIENTO_ALLOWED.has(company.tipoEstablecimiento)) {
    errors.push({
      field: 'tipoEstablecimiento',
      message: 'Tipo de establecimiento debe ser 01, 02, 04, 07 o 20 (CAT-008).',
    });
  }
  if (!company.departamentoCode || !DEPARTAMENTO_RE.test(company.departamentoCode)) {
    errors.push({
      field: 'departamentoCode',
      message: 'Departamento debe ser un código de 2 dígitos (CAT-012, 01-14).',
    });
  }
  if (!company.municipioCode || !MUNICIPIO_RE.test(company.municipioCode)) {
    errors.push({
      field: 'municipioCode',
      message: 'Municipio debe ser un código de 2 dígitos (CAT-013).',
    });
  }
  if (!company.complemento || company.complemento.trim().length < 1) {
    errors.push({
      field: 'complemento',
      message: 'Dirección (complemento) requerida.',
    });
  }
  const phoneDigits = (company.telefono ?? '').replace(/\D/g, '');
  if (phoneDigits.length < 8) {
    errors.push({ field: 'telefono', message: 'Teléfono debe tener al menos 8 dígitos.' });
  }
  if (!company.correo || !EMAIL_RE.test(company.correo.trim())) {
    errors.push({ field: 'correo', message: 'Correo electrónico inválido.' });
  }

  return { ok: errors.length === 0, errors };
}

// Validates a Customer record against the MH `Receptor` schema.
//
// Customer records are softer than companies: a user may save a contact
// before they have every DTE-relevant field (email, DUI, address). The
// submission-time sanitizer (`sanitizeCustomerForReceptor`) fills any gap
// with MH-valid placeholders, so the form here only needs to (a) require a
// name (basic UX), and (b) validate FORMAT when a value IS provided —
// rejecting "abc" as an email or "123" as a DUI before it lands in the
// store. Empty / missing values pass validation and are back-filled later.
export function validateCustomerForMH(customer: Pick<
  Customer,
  | 'firstName'
  | 'lastName'
  | 'name'
  | 'businessName'
  | 'nationalId'
  | 'nit'
  | 'email'
  | 'phone'
  | 'address'
  | 'departmentCode'
  | 'municipalityCode'
  | 'codActividad'
  | 'descActividad'
  | 'nrc'
>): ValidationResult {
  const errors: FieldError[] = [];

  // Only hard requirement: there has to be a name. Everything else is
  // optional at customer-creation time.
  const fullName =
    customer.name?.trim() ||
    `${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim() ||
    customer.businessName?.trim();
  if (!fullName || fullName.length === 0) {
    errors.push({
      field: 'firstName',
      message: 'Nombre del cliente requerido.',
    });
  }

  // Format checks — only run when a value IS provided.
  if (customer.nationalId && customer.nationalId.trim().length > 0) {
    if (!DUI_RE.test(customer.nationalId.trim())) {
      errors.push({
        field: 'nationalId',
        message: 'DUI debe tener el formato NNNNNNNN-N.',
      });
    }
  }
  if (customer.nit && customer.nit.trim().length > 0) {
    if (!NIT_RE.test(customer.nit.trim())) {
      errors.push({
        field: 'nit',
        message: 'NIT debe tener 9 o 14 dígitos (acepta el formato NNNN-NNNNNN-NNN-N).',
      });
    }
  }
  if (customer.email && customer.email.trim().length > 0) {
    if (!EMAIL_RE.test(customer.email.trim())) {
      errors.push({ field: 'email', message: 'Correo electrónico inválido.' });
    }
  }
  if (customer.phone && customer.phone.trim().length > 0) {
    const phoneDigits = customer.phone.replace(/\D/g, '');
    if (phoneDigits.length < 8) {
      errors.push({ field: 'phone', message: 'Teléfono debe tener al menos 8 dígitos.' });
    }
  }
  if (customer.departmentCode && customer.departmentCode.trim().length > 0) {
    if (!DEPARTAMENTO_RE.test(customer.departmentCode)) {
      errors.push({
        field: 'departmentCode',
        message: 'Departamento debe ser un código de 2 dígitos (CAT-012, 01-14).',
      });
    }
  }
  if (customer.municipalityCode && customer.municipalityCode.trim().length > 0) {
    if (!MUNICIPIO_RE.test(customer.municipalityCode)) {
      errors.push({
        field: 'municipalityCode',
        message: 'Municipio debe ser un código de 2 dígitos (CAT-013).',
      });
    }
  }
  if (
    customer.codActividad &&
    customer.codActividad.trim().length > 0 &&
    (!COD_ACTIVIDAD_RE.test(customer.codActividad) || customer.codActividad.length < 2)
  ) {
    errors.push({
      field: 'codActividad',
      message: 'Código de actividad inválido (debe ser 2-6 dígitos).',
    });
  }
  if (customer.descActividad && customer.descActividad.trim().length > 0 && customer.descActividad.trim().length < 5) {
    errors.push({
      field: 'descActividad',
      message: 'Descripción de actividad debe tener al menos 5 caracteres.',
    });
  }
  if (customer.nrc && customer.nrc.trim().length > 0 && !NRC_RE.test(customer.nrc.trim())) {
    errors.push({ field: 'nrc', message: 'NRC debe ser de 1 a 8 dígitos.' });
  }

  return { ok: errors.length === 0, errors };
}

// Convenience helper: format a list of errors as a single multi-line toast
// string. Returns null when no errors.
export function formatErrors(errors: FieldError[]): string | null {
  if (errors.length === 0) return null;
  return errors.map((e) => `• ${e.message}`).join('\n');
}
