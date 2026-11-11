import { createSelector } from '@reduxjs/toolkit';
import { AccountDirection, AccountEntry, AccountSummary } from '@/types/accounts';
import { RootState } from '../index';

export const selectAccountsState = (state: RootState) => state.accounts;

export const selectAllAccountEntries = createSelector(
  [selectAccountsState],
  (state) => state.entries,
);

export const selectAccountPayments = createSelector(
  [selectAccountsState],
  (state) => state.payments,
);

export const selectAccountsActiveDirection = createSelector(
  [selectAccountsState],
  (state) => state.activeDirection,
);

export const selectAccountsError = createSelector(
  [selectAccountsState],
  (state) => state.error,
);

export const selectAccountsForCompany = (companyId?: string) =>
  createSelector([selectAllAccountEntries], (entries) =>
    companyId ? entries.filter((entry) => entry.companyId === companyId) : [],
  );

export const selectAccountsByDirection = (companyId: string | undefined, direction: AccountDirection) =>
  createSelector([selectAccountsForCompany(companyId)], (entries) =>
    entries.filter((entry) => entry.direction === direction),
  );

export const selectFilteredAccounts = (companyId: string | undefined, direction: AccountDirection) =>
  createSelector([selectAccountsState, selectAccountsByDirection(companyId, direction)], (state, entries) => {
    const term = state.searchTerm.trim().toLowerCase();
    const status = state.statusFilter;
    return entries.filter((entry) => {
      if (status !== 'all' && entry.status !== status) return false;
      if (!term) return true;
      return [
        entry.party.name,
        entry.party.taxId,
        entry.documentNumber,
        entry.controlNumber,
        entry.generationCode,
        entry.documentType,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  });

export const selectAccountSummary = (companyId?: string) =>
  createSelector([selectAccountsForCompany(companyId)], (entries): AccountSummary => {
    const active = entries.filter((entry) => entry.status !== 'void' && entry.status !== 'paid');
    const isPastDue = (entry: AccountEntry) =>
      entry.agingBucket !== 'current' && entry.agingBucket !== 'dueToday';
    const sum = (direction: AccountDirection, predicate?: (entry: AccountEntry) => boolean) =>
      active
        .filter((entry) => entry.direction === direction && (!predicate || predicate(entry)))
        .reduce((total, entry) => total + entry.balance, 0);

    return {
      receivableTotal: sum('receivable'),
      receivableOverdue: sum('receivable', isPastDue),
      payableTotal: sum('payable'),
      payableOverdue: sum('payable', isPastDue),
      currentReceivables: sum(
        'receivable',
        (entry) => !isPastDue(entry) && (entry.status === 'open' || entry.status === 'partial'),
      ),
      currentPayables: sum(
        'payable',
        (entry) => !isPastDue(entry) && (entry.status === 'open' || entry.status === 'partial'),
      ),
      receivableCount: active.filter((entry) => entry.direction === 'receivable').length,
      payableCount: active.filter((entry) => entry.direction === 'payable').length,
    };
  });
