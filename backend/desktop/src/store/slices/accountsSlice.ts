import { createSlice, nanoid, PayloadAction } from '@reduxjs/toolkit';
import { AccountDirection, AccountEntry, AccountPayment, AccountPaymentInput } from '@/types/accounts';
import { Compra } from '@/types/compras';
import { Customer } from '@/types/customer';
import { Invoice } from '@/types/invoice';
import { AccountsLedgerService } from '@/services/accounts/AccountsLedgerService';

interface AccountsState {
  entries: AccountEntry[];
  payments: AccountPayment[];
  activeDirection: AccountDirection;
  searchTerm: string;
  statusFilter: 'all' | AccountEntry['status'];
  error: string | null;
  lastUpdatedAt?: string;
}

const initialState: AccountsState = {
  entries: [],
  payments: [],
  activeDirection: 'receivable',
  searchTerm: '',
  statusFilter: 'all',
  error: null,
};

const accountsSlice = createSlice({
  name: 'accounts',
  initialState,
  reducers: {
    reconcileAccountsFromDocuments(
      state,
      action: PayloadAction<{
        companyId: string;
        invoices: Invoice[];
        compras: Compra[];
        customers?: Customer[];
        today?: string;
      }>,
    ) {
      const { companyId, invoices, compras, customers, today } = action.payload;
      const preservedManualEntries = state.entries.filter(
        (entry) => entry.companyId !== companyId || entry.sourceType === 'manual',
      );
      const generatedEntries = AccountsLedgerService.buildEntriesFromDocuments({
        companyId,
        invoices,
        compras,
        customers,
        existingEntries: state.entries,
        payments: state.payments,
        today,
      });
      state.entries = [...preservedManualEntries, ...generatedEntries];
      state.lastUpdatedAt = new Date().toISOString();
      state.error = null;
    },
    recordAccountPayment: {
      reducer(state, action: PayloadAction<AccountPayment>) {
        const entry = state.entries.find((item) => item.id === action.payload.entryId);
        if (!entry) {
          state.error = 'Cuenta no encontrada';
          return;
        }
        const error = AccountsLedgerService.validatePayment(entry, action.payload.amount);
        if (error) {
          state.error = error;
          return;
        }

        state.payments.unshift(action.payload);
        const paidAmount = Math.round((entry.paidAmount + action.payload.amount) * 100) / 100;
        const balance = Math.max(
          0,
          Math.round((entry.originalAmount + entry.adjustmentAmount - paidAmount) * 100) / 100,
        );
        entry.paidAmount = paidAmount;
        entry.balance = balance;
        entry.status = balance <= 0.005
          ? 'paid'
          : new Date(`${entry.dueDate}T00:00:00`).getTime() < new Date().setHours(0, 0, 0, 0)
            ? 'overdue'
            : paidAmount > 0
              ? 'partial'
              : entry.status;
        entry.updatedAt = action.payload.updatedAt;
        state.lastUpdatedAt = action.payload.updatedAt;
        state.error = null;
      },
      prepare(input: AccountPaymentInput) {
        const now = new Date().toISOString();
        return {
          payload: {
            id: `pay_${nanoid(10)}`,
            companyId: input.companyId,
            entryId: input.entryId,
            direction: input.direction,
            paymentDate: input.paymentDate,
            amount: Math.round(input.amount * 100) / 100,
            methodCode: input.methodCode,
            reference: input.reference?.trim() || undefined,
            notes: input.notes?.trim() || undefined,
            createdAt: now,
            updatedAt: now,
          } satisfies AccountPayment,
        };
      },
    },
    setAccountsActiveDirection(state, action: PayloadAction<AccountDirection>) {
      state.activeDirection = action.payload;
    },
    setAccountsSearchTerm(state, action: PayloadAction<string>) {
      state.searchTerm = action.payload;
    },
    setAccountsStatusFilter(state, action: PayloadAction<AccountsState['statusFilter']>) {
      state.statusFilter = action.payload;
    },
    clearAccountsError(state) {
      state.error = null;
    },
    clearAccountsForCompany(state, action: PayloadAction<string>) {
      const companyId = action.payload;
      state.entries = state.entries.filter((entry) => entry.companyId !== companyId);
      state.payments = state.payments.filter((payment) => payment.companyId !== companyId);
      state.lastUpdatedAt = new Date().toISOString();
    },
  },
});

export const {
  reconcileAccountsFromDocuments,
  recordAccountPayment,
  setAccountsActiveDirection,
  setAccountsSearchTerm,
  setAccountsStatusFilter,
  clearAccountsError,
  clearAccountsForCompany,
} = accountsSlice.actions;

export default accountsSlice.reducer;
