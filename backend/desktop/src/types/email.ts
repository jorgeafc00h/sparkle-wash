// Email account types matching Swift implementation

export interface EmailAccount {
  companyOwnerId: string;
  nit: string;
  dui: string;
  email: string;
  password: string; // Will be encrypted
  imapServer: string;
  imapPort: number;
  useSsl: boolean;
  provider: string;
  lastProcessedMonth: number;
}

export interface CreateEmailAccountInput {
  email: string;
  password: string;
  nit: string;
  dui?: string;
  imapServer?: string;
  imapPort?: number;
  useSsl?: boolean;
  provider?: string;
  lastProcessedMonth?: number;
}

export interface UpdateEmailAccountInput extends Partial<CreateEmailAccountInput> {
  companyOwnerId: string;
}