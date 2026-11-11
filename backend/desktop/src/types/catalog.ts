// Government catalog types matching Swift implementation

export interface CatalogOption {
  id: string;
  code: string;
  description: string;
  departamento?: string;
  municipality?: string;
  catalogId: string;
  isActive: boolean;
  sortOrder?: number;
}

export interface Catalog {
  id: string;
  name: string;
  description?: string;
  version?: string;
  lastUpdated?: string;
  isActive: boolean;
  options: CatalogOption[];
  totalOptions: number;
}

// Government catalog IDs (from the API)
export enum GovernmentCatalogId {
  ENVIRONMENTS = 'CAT-001', // Ambiente de destino
  DOCUMENT_EVENT_TYPES = 'CAT-002', // Tipo de Documento / Evento
  BILLING_MODELS = 'CAT-003', // Modelo de Facturación
  TRANSMISSION_TYPES = 'CAT-004', // Tipo de Transmisión
  CONTINGENCY_TYPES = 'CAT-005', // Tipo de Contingencia
  IVA_WITHHOLDING = 'CAT-006', // Retención IVA MH
  DOCUMENT_GENERATION_TYPES = 'CAT-007', // Tipo de Generación del Documento
  DISTRICTS = 'CAT-008', // Distrito
  ESTABLISHMENT_TYPES = 'CAT-009', // Tipo de establecimiento
  MEDICAL_SERVICE_TYPES = 'CAT-010', // Código tipo de Servicio (Médico)
  ITEM_TYPES = 'CAT-011', // Tipo de ítem
  DEPARTMENTS = 'CAT-012', // Departments (departamentos) - matches Swift
  MUNICIPALITIES = 'CAT-013', // Municipalities (municipios) - matches Swift  
  ECONOMIC_ACTIVITIES = 'CAT-019', // Economic activities
  DOCUMENT_TYPES = 'CAT-002', // Document/event types
  PAYMENT_CONDITIONS = 'CAT-016', // Condición de la Operación
  PAYMENT_FORMS = 'CAT-017', // Forma de Pago
  PAYMENT_METHODS = 'CAT-017', // Legacy alias for payment form callers
  PAYMENT_TERMS = 'CAT-018', // Plazo
  UNIT_OF_MEASURE = 'CAT-014', // Units of measure
  TAX_CODES = 'CAT-015', // Tax codes
  COUNTRIES = 'CAT-020', // Countries - fixed to match Swift
  PERSON_TYPES = 'CAT-029', // Person types (Tipo de Persona) - added from Swift  
  ASSOCIATED_DOCUMENTS = 'CAT-021', // Documentos Asociados
  RECIPIENT_DOCUMENT_TYPES = 'CAT-022', // Tipo de documento de identificación
  SPECIAL_OPERATIONS = 'CAT-023', // Operaciones Especiales
  INVALID_REASONS = 'CAT-024', // Motivo del evento
  REMISSION_TITLES = 'CAT-025', // Título a que se remiten los bienes
  DONATION_TYPES = 'CAT-026', // Tipo de Donación
  CUSTOMS_OFFICES = 'CAT-027', // Recinto fiscal
  REGIMES = 'CAT-028', // Régimen
  TRANSPORT_TYPES = 'CAT-030', // Transporte
  INCOTERMS = 'CAT-031', // INCOTERMS
  FISCAL_DOMICILES = 'CAT-032', // Domicilio Fiscal
  REGIME_TYPES = 'CAT-033', // Tipo de Régimen
}

// DTO for API responses
export interface CatalogOptionDTO {
  code: string;
  description: string;
  departamento?: string;
  municipality?: string;
}

export interface CatalogDTO {
  id: string;
  name: string;
  options: CatalogOptionDTO[];
}

export interface CatalogCollection {
  catalogs: CatalogDTO[];
}

// Catalog sync information
export interface CatalogSyncInfo {
  catalogId: string;
  lastSyncDate: string;
  version?: string;
  status: 'SYNCING' | 'SUCCESS' | 'FAILED';
  error?: string;
  recordCount: number;
}

// Specific catalog types for easier use

// Municipality
export interface Municipality {
  code: string;
  name: string;
  departmentCode: string;
  departmentName: string;
}

// Economic Activity
export interface EconomicActivity {
  code: string;
  description: string;
  category?: string;
}

// Document Type
export interface DocumentType {
  code: string;
  description: string;
  requiresNumber: boolean;
  maxLength?: number;
}

// Payment Form
export interface PaymentForm {
  code: string;
  description: string;
  requiresDetails: boolean;
}

// Payment Method
export interface PaymentMethod {
  code: string;
  description: string;
  paymentFormCode: string;
}

// Unit of Measure
export interface UnitOfMeasureOption {
  code: string;
  description: string;
  symbol?: string;
  type: 'WEIGHT' | 'LENGTH' | 'VOLUME' | 'QUANTITY' | 'TIME' | 'AREA';
}

// Tax Code
export interface TaxCode {
  code: string;
  description: string;
  rate?: number;
  type: 'IVA' | 'EXEMPT' | 'EXPORT' | 'OTHER';
}

// Item Type
export interface ItemType {
  code: string;
  description: string;
  category: 'GOODS' | 'SERVICES';
}

// Country
export interface Country {
  code: string;
  name: string;
  iso2: string;
  iso3: string;
}

// Department
export interface Department {
  code: string;
  name: string;
  countryCode: string;
}

// Currency
export interface CurrencyOption {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
}

// Invalidation Reason
export interface InvalidationReason {
  code: string;
  description: string;
  requiresDocuments: boolean;
}

// Contingency Type
export interface ContingencyType {
  code: string;
  description: string;
  maxDays: number;
}

// Catalog search and filter types
export interface CatalogFilters {
  catalogId?: string;
  isActive?: boolean;
  hasOptions?: boolean;
  lastUpdatedFrom?: string;
  lastUpdatedTo?: string;
}

export interface CatalogSearchParams extends CatalogFilters {
  searchTerm?: string;
  page?: number;
  limit?: number;
  sortBy?: 'name' | 'lastUpdated' | 'totalOptions';
  sortOrder?: 'asc' | 'desc';
}

export interface CatalogOptionFilters {
  catalogId: string;
  departamento?: string;
  isActive?: boolean;
}

export interface CatalogOptionSearchParams extends CatalogOptionFilters {
  searchTerm?: string;
  page?: number;
  limit?: number;
  sortBy?: 'code' | 'description' | 'sortOrder';
  sortOrder?: 'asc' | 'desc';
}

// Catalog state for Redux
export interface CatalogState {
  catalogs: Catalog[];
  syncInfo: { [catalogId: string]: CatalogSyncInfo };
  loading: boolean;
  error: string | null;
  lastFullSync?: string;
  searchTerm: string;
  filters: CatalogFilters;
}

// Helper types for specific catalog lookups
export interface CatalogLookupResult {
  found: boolean;
  option?: CatalogOption;
  catalog?: Catalog;
}

// Validation types
export interface CatalogValidationErrors {
  catalogId?: string;
  code?: string;
  description?: string;
}
