// Ask Hacienda whether a DTE's codigoGeneracion is already PROCESADO, keeping
// "MH says no" apart from "MH could not be asked".
//
// InvoiceGenerationService.findProcessedOnMH folds both into `null` (fine for a
// retry, which then re-sends the SAME identifiers). Deleting an "Error de
// envío" draft is different: a transport failure can happen AFTER MH
// processed the document, so deleting it locally would lose the company's only
// copy of a valid fiscal document. The delete guard therefore needs the
// three-way answer below and refuses to delete while MH can't be consulted.

import { Invoice, InvoiceStatus } from '../../types/invoice';
import { Company, CompanyEnvironment } from '../../types/company';
import { SecureStorageService } from '../security/SecureStorageService';
import { getMhClient } from './MhClient';

export type MhDocumentLookup =
  | { state: 'processed'; selloRecibido: string; fechaTransmision?: string }
  | { state: 'not-processed' }
  | { state: 'unknown'; reason: string };

export async function lookupInvoiceOnMH(
  invoice: Pick<Invoice, 'generationCode' | 'documentType'>,
  company: Pick<Company, 'nit' | 'environment'>,
): Promise<MhDocumentLookup> {
  // Never got identifiers → nothing with a known codigoGeneracion reached MH.
  if (!invoice.generationCode) return { state: 'not-processed' };
  if (!company.nit) return { state: 'unknown', reason: 'La empresa no tiene NIT configurado.' };

  const isProduction = company.environment === CompanyEnvironment.Production;
  let credentials: { user: string; password: string } | null = null;
  try {
    credentials = await SecureStorageService.getCredentials(company.nit, isProduction);
  } catch {
    credentials = null;
  }
  if (!credentials?.password) {
    return { state: 'unknown', reason: 'No hay credenciales de Hacienda guardadas para consultar el documento.' };
  }

  const nitDigits = company.nit.replace(/\D/g, '');
  try {
    const response = await getMhClient(isProduction).searchDTE(
      { nitEmisor: nitDigits, tdte: invoice.documentType, codigoGeneracion: invoice.generationCode },
      { userName: credentials.user || nitDigits, password: credentials.password },
    );
    if (response?.estado === 'PROCESADO' && response.selloRecibido) {
      return {
        state: 'processed',
        selloRecibido: response.selloRecibido,
        fechaTransmision: response.fhProcesamiento || undefined,
      };
    }
    // MhClient answers a persistent 401 with estado "ERROR": MH wasn't asked.
    if (!response || response.estado === 'ERROR') {
      return { state: 'unknown', reason: 'Hacienda no aceptó las credenciales para la consulta.' };
    }
    return { state: 'not-processed' };
  } catch (err) {
    const detail = err instanceof Error && err.message ? ` (${err.message.slice(0, 120)})` : '';
    return { state: 'unknown', reason: `No se pudo conectar con Hacienda${detail}.` };
  }
}

/** True for drafts whose identifiers may already have reached MH. */
export function needsMhCheckBeforeDelete(invoice: Pick<Invoice, 'status' | 'generationCode'>): boolean {
  return invoice.status === InvoiceStatus.ErrorEnvio && !!invoice.generationCode;
}

export interface DeleteGuardResult<T> {
  /** Safe to delete: Nueva drafts, and ErrorEnvio drafts MH confirmed it doesn't hold. */
  deletable: T[];
  /** MH already PROCESSED these — never delete; re-send to complete them with MH's sello. */
  processed: T[];
  /** MH could not be consulted — kept until the check can run. */
  unverified: { invoice: T; reason: string }[];
}

/**
 * Sort draft invoices into deletable / processed-on-MH / unverifiable. Only
 * ErrorEnvio drafts that carry a codigoGeneracion are looked up.
 */
export async function guardDraftDeletion<T extends Pick<Invoice, 'status' | 'generationCode' | 'documentType'>>(
  invoices: T[],
  company: Pick<Company, 'nit' | 'environment'> | null | undefined,
  lookup: typeof lookupInvoiceOnMH = lookupInvoiceOnMH,
): Promise<DeleteGuardResult<T>> {
  const result: DeleteGuardResult<T> = { deletable: [], processed: [], unverified: [] };
  for (const invoice of invoices) {
    if (!needsMhCheckBeforeDelete(invoice)) {
      result.deletable.push(invoice);
      continue;
    }
    if (!company) {
      result.unverified.push({ invoice, reason: 'No hay empresa seleccionada.' });
      continue;
    }
    const answer = await lookup(invoice, company);
    if (answer.state === 'not-processed') result.deletable.push(invoice);
    else if (answer.state === 'processed') result.processed.push(invoice);
    else result.unverified.push({ invoice, reason: answer.reason });
  }
  return result;
}
