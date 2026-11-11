// Device Sync v2 selectors.

import type { RootState } from '../index';
import { companySyncKey } from '../../services/sync/protocol';

const EMPTY_MAXIMA: Record<string, number> = {};

/**
 * Highest sequential correlativo per DTE type code reported by ANY of the owner's
 * devices for the company (max-only). Seeds the sequential numeroControl counter so two
 * devices never mint the same number for the same document type.
 */
export const selectSyncCorrelativoMaxima = (state: RootState, companyId?: string): Record<string, number> => {
  const company = companyId
    ? state.companies.companies.find((candidate) => candidate.id === companyId)
    : state.companies.currentCompany;
  const co = companySyncKey(company);
  return (co && state.syncV2?.companies?.[co]?.correlativoMaxima) || EMPTY_MAXIMA;
};
