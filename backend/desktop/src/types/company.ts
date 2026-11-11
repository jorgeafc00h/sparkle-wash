// Company types matching Swift implementation

export enum CompanyEnvironment {
  Development = 'DEVELOPMENT',
  Production = 'PRODUCTION'
}

export enum CompanyStatus {
  Active = 'ACTIVE',
  Inactive = 'INACTIVE',
  Suspended = 'SUSPENDED',
  PendingApproval = 'PENDING_APPROVAL'
}

export interface Company {
  id: string;
  // Basic Info (Step 1 - matches Swift AddCompanyView)
  nit?: string; // Optional in Swift
  nombre: string; // "Nombres y Apellidos" - required 
  nombreComercial: string; // "Nombre Comercial" - required
  nrc?: string; // Optional in Swift
  
  // Contact & Location Info (Step 2 - matches Swift AddCompanyView2)
  correo: string; // Email - required
  telefono?: string; // Phone - optional
  complemento: string; // Address - required
  direccion: string; // Address - alias for complemento
  departamentoCode: string; // Department code
  departamento: string; // Department name 
  municipioCode: string; // Municipality code
  municipio: string; // Municipality name
  distritoCode?: string; // District code (CAT-008, Normativa 2.0)
  distrito?: string; // District name
  
  // Economic Activity & Establishment (Step 3 - matches Swift AddCompanyView3)
  codActividad: string; // Economic activity code
  descActividad: string; // Economic activity description
  tipoEstablecimiento: string; // Establishment type code
  establecimiento: string; // Establishment type description
  descTipoEstablecimiento?: string; // Description of establishment type
  // MH codes with defaults from Swift
  codEstableMH: string; // Default "M001"
  codEstable: string; // Default ""
  codPuntoVentaMH: string; // Default "P001" 
  codPuntoVenta: string; // Default ""
  
  // Certificate Info (Step 4 - matches Swift AddCompanyView4)
  certificatePath?: string;
  certificatePassword?: string;

  // Export-specific fields for FacturaExportacion
  recintoFiscal?: string;
  regimenFiscal?: string;
  tipoRegimen?: string;

  // Hacienda API credentials (stored securely, encrypted)
  credentials?: string; // Encrypted API credentials from Hacienda
  
  // Invoice Logo (matches Swift Company.swift)
  invoiceLogo?: string; // Base64 encoded logo image
  logoWidth?: number; // Logo width in pixels, default 100
  logoHeight?: number; // Logo height in pixels, default 100
  
  // Environment and certificates
  environment: CompanyEnvironment;
  isTestAccount: boolean; // Matches Swift Company.isTestAccount, true = test environment
  hasValidCertificate: boolean;
  /** True once the .crt XML file has been uploaded (before validation) */
  hasCertificateFile?: boolean;
  certificateExpiryDate?: Date;
  certificateSubject?: string;
  certificateIssuer?: string;
  // Visual branding
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  // Tax settings
  taxRegistrationNumber?: string;
  ivaPercentage: number; // Default 13%
  retentionPercentage?: number;
  /**
   * Designated by the DGII as agente de percepción de IVA (Código Tributario
   * art. 163): CCF of US$100.00+ gravado base to receptors that are not grandes
   * contribuyentes add 1% percepción. Default off.
   */
  isPerceptionAgent?: boolean;
  // Invoice settings
  invoicePrefix?: string;
  ccfPrefix?: string;
  creditNotePrefix?: string;
  debitNotePrefix?: string;
  currentInvoiceNumber: number;
  currentCCFNumber: number;
  // Sequential control number support. When `useSequentialControlNumbers`
  // is true, MH numeroControl uses `nextSequenceNumber` (zero-padded to 15
  // digits) instead of the time-derived sequence — produces clean values
  // like DTE-03-M001P001-000000000000001 vs DTE-03-M001P001-077392415650447.
  // Trade-off: requires single-device use to avoid collisions.
  useSequentialControlNumbers?: boolean;
  nextSequenceNumber?: number;
  // API credentials (stored securely)
  hasApiCredentials: boolean;
  credentialsLastTestedAt?: string; // ISO string — set after a successful validation
  // Status and metadata
  status: CompanyStatus;
  isDefault: boolean; // Default selected company
  isProduction?: boolean;
  userId: string; // Owner user ID
  createdAt: string; // ISO string for Redux serialization
  updatedAt: string; // ISO string for Redux serialization  
  lastSyncDate?: string; // ISO string for Redux serialization
}

export interface CreateCompanyInput {
  // Basic Info (Step 1)
  nit?: string;
  nombre: string;
  nombreComercial: string;
  nrc?: string;
  
  // Contact & Location Info (Step 2)
  correo: string;
  telefono?: string;
  complemento: string;
  departamentoCode: string;
  departamento: string;
  municipioCode: string;
  municipio: string;
  distritoCode?: string;
  distrito?: string;
  
  // Economic Activity & Establishment (Step 3)
  codActividad: string;
  descActividad: string;
  tipoEstablecimiento: string;
  establecimiento: string;
  codEstableMH: string;
  codEstable: string;
  codPuntoVentaMH: string;
  codPuntoVenta: string;
  tipoRegimen?: string;
  
  // Certificate Info (Step 4)
  certificatePath?: string;
  certificatePassword?: string;
  
  environment: CompanyEnvironment;
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  ivaPercentage?: number;
  retentionPercentage?: number;
  invoicePrefix?: string;
  ccfPrefix?: string;
  creditNotePrefix?: string;
  debitNotePrefix?: string;
}

export interface UpdateCompanyInput extends Partial<CreateCompanyInput> {
  id: string;
  status?: CompanyStatus;
  isDefault?: boolean;
  hasValidCertificate?: boolean;
  hasCertificateFile?: boolean;
  certificateExpiryDate?: Date;
  certificateSubject?: string;
  certificateIssuer?: string;
  hasApiCredentials?: boolean;
  credentialsLastTestedAt?: string;
  currentInvoiceNumber?: number;
  currentCCFNumber?: number;
  useSequentialControlNumbers?: boolean;
  nextSequenceNumber?: number;
  invoiceLogo?: string;
  logoWidth?: number;
  logoHeight?: number;
  isPerceptionAgent?: boolean;
}

// Company summary for lists and pickers
export interface CompanySummary {
  id: string;
  businessName: string;
  tradeName?: string;
  nit: string;
  environment: CompanyEnvironment;
  status: CompanyStatus;
  hasValidCertificate: boolean;
  isDefault: boolean;
  logoUrl?: string;
}

// Company credentials (stored securely)
export interface CompanyCredentials {
  companyId: string;
  nit: string;
  username: string;
  password: string;
  certificateKey?: string;
  apiKey?: string;
  environment: CompanyEnvironment;
  createdAt: Date;
  updatedAt: Date;
}

// Certificate information
export interface CompanyCertificate {
  companyId: string;
  certificateData: string; // Base64 encoded
  privateKey?: string; // Encrypted
  subject: string;
  issuer: string;
  validFrom: Date;
  validTo: Date;
  serialNumber: string;
  fingerprint: string;
  isValid: boolean;
  environment: CompanyEnvironment;
  createdAt: Date;
  updatedAt: Date;
}

// Company settings
export interface CompanySettings {
  companyId: string;
  // Invoice settings
  autoGenerateNumbers: boolean;
  allowBackdatedInvoices: boolean;
  requireCustomerForInvoices: boolean;
  defaultInvoiceTerms?: string;
  defaultInvoiceNotes?: string;
  // Email settings
  emailFromName?: string;
  emailFromAddress?: string;
  emailSignature?: string;
  autoSendInvoices: boolean;
  // Backup settings
  autoBackupEnabled: boolean;
  backupFrequency?: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  // Notification settings
  notifyOnInvoiceCompleted: boolean;
  notifyOnCertificateExpiry: boolean;
  notifyOnSyncErrors: boolean;
  // Other settings
  timezone: string;
  currency: string;
  dateFormat: string;
  numberFormat: string;
  updatedAt: Date;
}

// Company statistics
export interface CompanyStats {
  companyId: string;
  totalInvoices: number;
  totalRevenue: number;
  totalCustomers: number;
  totalProducts: number;
  averageInvoiceAmount: number;
  monthlyRevenue: { month: string; revenue: number }[];
  topCustomers: { customerId: string; customerName: string; totalSpent: number }[];
  topProducts: { productId: string; productName: string; totalSold: number }[];
  lastCalculated: Date;
}

// Company search and filter types
export interface CompanyFilters {
  status?: CompanyStatus[];
  environment?: CompanyEnvironment[];
  hasValidCertificate?: boolean;
  city?: string;
  department?: string;
  userId?: string;
}

export interface CompanySearchParams extends CompanyFilters {
  searchTerm?: string;
  page?: number;
  limit?: number;
  sortBy?: 'businessName' | 'nit' | 'createdAt' | 'lastSyncDate';
  sortOrder?: 'asc' | 'desc';
}

// Company state for Redux
export interface CompanyState {
  companies: Company[];
  currentCompany: Company | null;
  selectedCompanyId: string | null;
  companySettings: CompanySettings | null;
  companyStats: CompanyStats | null;
  loading: boolean;
  error: string | null;
  searchTerm: string;
  filters: CompanyFilters;
}

// Company validation types
export interface CompanyValidationErrors {
  businessName?: string;
  nit?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  department?: string;
  economicActivity?: string;
  environment?: string;
}

// Production access request
export interface ProductionAccessRequest {
  id: string;
  companyId: string;
  requestedBy: string;
  requestDate: Date;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  approvedBy?: string;
  approvalDate?: Date;
  rejectionReason?: string;
  businessJustification: string;
  expectedVolume: number;
  documents: string[]; // URLs to uploaded documents
  createdAt: Date;
  updatedAt: Date;
}
