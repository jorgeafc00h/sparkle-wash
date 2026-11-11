// Purchase types matching Swift implementation

export interface PurchaseTransaction {
  id: string;
  transactionId: string;
  productId: string;
  purchaseDate: string;
  creditsGranted: number;
  amount: number;
  currency: string;
  status: PurchaseStatus;
  companyNit: string;
  receiptData?: string;
}

export enum PurchaseStatus {
  Pending = 'pending',
  Completed = 'completed',
  Failed = 'failed',
  Refunded = 'refunded'
}

export interface PurchaseResponse {
  purchases: PurchaseTransaction[];
  totalCredits: number;
  availableCredits: number;
  lastPurchaseDate?: string;
}

export interface InAppPurchaseProduct {
  productId: string;
  localizedTitle: string;
  localizedDescription: string;
  price: string;
  priceLocale: string;
  credits: number;
}

export interface PurchaseRequest {
  productId: string;
  companyNit: string;
  userId: string;
}