// Promo code types matching Swift implementation

export interface PromoCodeRequest {
  userId: string;
  email: string;
  nit?: string;
  promoCodeRequest?: string;
}

export interface PromoResponse {
  success: boolean;
  message: string;
  orderReference?: string;
  promoCode?: string;
  expiryDate?: string;
  creditsGranted?: number;
}

export interface PromoStatus {
  orderReference: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  promoCode?: string;
  creditsGranted?: number;
  appliedDate?: string;
  expiryDate?: string;
  rejectionReason?: string;
}