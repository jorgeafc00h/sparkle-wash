export type AccountDirection = 'receivable' | 'payable';

export type AccountSourceType = 'invoice' | 'compra' | 'manual' | 'adjustment';

export type AccountStatus = 'open' | 'partial' | 'paid' | 'overdue' | 'void';

export type AccountAgingBucket = 'current' | 'dueToday' | 'days1To30' | 'days31To60' | 'days61To90' | 'days90Plus';

export interface AccountPartySnapshot {
  id?: string;
  name: string;
  taxId?: string;
  email?: string;
  phone?: string;
}

export interface AccountEntry {
  id: string;
  companyId: string;
  direction: AccountDirection;
  sourceType: AccountSourceType;
  sourceId: string;
  party: AccountPartySnapshot;
  documentType: string;
  documentNumber: string;
  controlNumber?: string;
  generationCode?: string;
  issueDate: string;
  dueDate: string;
  currency: 'USD';
  originalAmount: number;
  adjustmentAmount: number;
  paidAmount: number;
  balance: number;
  status: AccountStatus;
  agingBucket: AccountAgingBucket;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AccountPayment {
  id: string;
  companyId: string;
  entryId: string;
  direction: AccountDirection;
  paymentDate: string;
  amount: number;
  methodCode: string;
  reference?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AccountSummary {
  receivableTotal: number;
  receivableOverdue: number;
  payableTotal: number;
  payableOverdue: number;
  currentReceivables: number;
  currentPayables: number;
  receivableCount: number;
  payableCount: number;
}

export interface AccountPaymentInput {
  entryId: string;
  companyId: string;
  direction: AccountDirection;
  paymentDate: string;
  amount: number;
  methodCode: string;
  reference?: string;
  notes?: string;
}
