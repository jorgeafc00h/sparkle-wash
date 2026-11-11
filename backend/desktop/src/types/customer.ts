// Customer types matching Swift implementation

export enum CustomerType {
  Individual = 0,
  Business = 1,
  Government = 2
}

export enum CustomerDocumentType {
  DUI = 'DUI',
  NIT = 'NIT',
  PASSPORT = 'PASSPORT',
  CARNET_RESIDENTE = 'CARNET_RESIDENTE',
  OTHER = 'OTHER'
}

export interface Customer {
  id: string;
  firstName: string;
  lastName: string;
  name?: string;
  businessName?: string;
  nationalId: string;
  nit: string; // Added missing nit property
  documentType: CustomerDocumentType;
  email: string;
  phone: string;
  address?: string;
  city?: string;
  department?: string;
  departmentCode?: string;
  municipality?: string;
  municipalityCode?: string;
  district?: string;
  districtCode?: string;
  country?: string;
  postalCode?: string;
  hasContributorRetention: boolean;
  /** Gran contribuyente: never charged the 1% IVA percepción. */
  isLargeTaxpayer?: boolean;
  customerType: CustomerType;
  isActive: boolean;
  companyId: string;
  codActividad?: string;
  descActividad?: string;
  documentTypeCatalogCode?: string;
  taxRegistrationNumber?: string;
  nrc?: string;
  documentNumber?: string;
  // Export information fields (matches Swift hasExportInvoiceSettings section)
  hasExportInvoiceSettings?: boolean;
  codPais?: string;
  nombrePais?: string;
  tipoPersona?: string;
  tipoDocumento?: string;
  shouldSyncToCloud?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCustomerInput {
  firstName: string;
  lastName: string;
  businessName?: string;
  nationalId: string;
  nit: string; // Added missing nit property
  documentType: CustomerDocumentType;
  email: string;
  phone: string;
  address?: string;
  city?: string;
  department?: string;
  departmentCode?: string;
  municipality?: string;
  municipalityCode?: string;
  district?: string;
  districtCode?: string;
  country?: string;
  postalCode?: string;
  hasContributorRetention?: boolean;
  isLargeTaxpayer?: boolean;
  customerType: CustomerType;
  companyId: string;
  codActividad?: string;
  descActividad?: string;
  taxRegistrationNumber?: string;
  nrc?: string;
  documentTypeCatalogCode?: string;
  // Export information fields (matches Swift hasExportInvoiceSettings)
  hasExportInvoiceSettings?: boolean;
  codPais?: string;
  nombrePais?: string;
  tipoPersona?: string;
  tipoDocumento?: string;
  shouldSyncToCloud?: boolean;
}

export interface UpdateCustomerInput extends Partial<CreateCustomerInput> {
  id: string;
  isActive?: boolean;
}

// Customer summary for lists and pickers
export interface CustomerSummary {
  id: string;
  firstName: string;
  lastName: string;
  businessName?: string;
  nationalId: string;
  nit: string; // Added missing nit property
  email: string;
  phone: string;
  customerType: CustomerType;
  isActive: boolean;
  department?: string;
  municipality?: string;
}

// Customer search and filter types
export interface CustomerFilters {
  customerType?: CustomerType[];
  hasContributorRetention?: boolean;
  isActive?: boolean;
  companyId?: string;
  city?: string;
  department?: string;
  departmentCode?: string;
  municipalityCode?: string;
  searchTerm?: string;
}

export interface CustomerSearchParams extends CustomerFilters {
  searchTerm?: string;
  page?: number;
  limit?: number;
  sortBy?: 'firstName' | 'lastName' | 'businessName' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
}

// Customer state for Redux
export interface CustomerState {
  customers: Customer[];
  currentCustomer: Customer | null;
  selectedCustomerId: string | null;
  loading: boolean;
  error: string | null;
  searchTerm: string;
  filters: CustomerFilters;
  lastUpdatedAt?: string;
}

// Customer validation types
export interface CustomerValidationErrors {
  firstName?: string;
  lastName?: string;
  businessName?: string;
  nationalId?: string;
  email?: string;
  phone?: string;
  address?: string;
  documentType?: string;
}

// Helper function types
export interface CustomerDisplayInfo {
  displayName: string;
  subtitle: string;
  initials: string;
}
