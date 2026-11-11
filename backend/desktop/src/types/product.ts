import type { StockLedger } from '../services/sync/stockLedger';
// Product types matching Swift implementation

export enum ProductStatus {
  Active = 'ACTIVE',
  Inactive = 'INACTIVE',
  Discontinued = 'DISCONTINUED'
}

export enum UnitOfMeasure {
  UNIDAD = 'UND',
  METRO = 'MT',
  KILOGRAMO = 'KG',
  LITRO = 'LT',
  CAJA = 'CJ',
  DOCENA = 'DOC',
  HORA = 'HR',
  SERVICIO = 'SRV',
  METRO_CUADRADO = 'M2',
  METRO_CUBICO = 'M3',
  GRAMO = 'GR',
  TONELADA = 'TON',
  GALÓN = 'GAL',
  PULGADA = 'PULG',
  PIE = 'PIE',
  YARDA = 'YD'
}

export enum TaxCategory {
  GRAVADO = 'GRAVADO',
  EXENTO = 'EXENTO',
  NO_GRAVADO = 'NO_GRAVADO',
  EXPORTACION = 'EXPORTACION'
}

export interface Product {
  id: string;
  productName: string;
  description?: string;
  productCode?: string; // Internal SKU/code
  barcode?: string;
  /** Convergent stock counter synced with the product (src/services/sync/stockLedger.ts). */
  stockLedger?: StockLedger;
  unitPrice: number;
  cost?: number; // Purchase cost
  unitOfMeasure: UnitOfMeasure;
  taxCategory: TaxCategory;
  taxRate?: number; // Specific tax rate if different from standard
  status: ProductStatus;
  stock?: number;
  minStock?: number;
  maxStock?: number;
  hasInventory?: boolean;
  stockQuantity?: number;
  trackInventory?: boolean;
  lowStockThreshold?: number;
  category?: string;
  // Product photo as a JPEG data-URI (services/images/resizeImage keeps it under
  // the Device Sync envelope budget — see PRODUCT_PHOTO_MAX_DATA_URL_CHARS).
  photoUrl?: string;
  // Categories and classification
  categoryId?: string;
  brandId?: string;
  supplierId?: string;
  // Government catalog references
  tipoItem?: string; // Catalog item type
  codigoTributo?: string; // Tax code from government catalog
  uniMedida?: string; // Unit of measure code for DTE
  numeroTarifa?: string; // Tariff number for exports
  companyId: string;
  isActive: boolean;
  isService?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductInput {
  productName: string;
  description?: string;
  productCode?: string;
  barcode?: string;
  unitPrice: number;
  cost?: number;
  unitOfMeasure: UnitOfMeasure;
  taxCategory: TaxCategory;
  taxRate?: number;
  stock?: number;
  minStock?: number;
  maxStock?: number;
  trackInventory?: boolean;
  lowStockThreshold?: number;
  categoryId?: string;
  brandId?: string;
  supplierId?: string;
  tipoItem?: string;
  codigoTributo?: string;
  uniMedida?: string;
  numeroTarifa?: string;
  companyId: string;
}

export interface UpdateProductInput extends Partial<CreateProductInput> {
  id: string;
  status?: ProductStatus;
  isActive?: boolean;
}

// Product summary for lists and pickers
export interface ProductSummary {
  id: string;
  productName: string;
  productCode?: string;
  unitPrice: number;
  unitOfMeasure: UnitOfMeasure;
  taxCategory: TaxCategory;
  stock?: number;
  status: ProductStatus;
  isActive: boolean;
}

// Product with calculations (for invoice items)
export interface ProductWithCalculations extends Product {
  quantity: number;
  lineTotal: number;
  lineTotalWithoutTax: number;
  lineTax: number;
}

// Product categories
export interface ProductCategory {
  id: string;
  name: string;
  description?: string;
  parentCategoryId?: string;
  isActive: boolean;
  companyId: string;
  createdAt: string;
  updatedAt: string;
}

// Product brands
export interface ProductBrand {
  id: string;
  name: string;
  description?: string;
  logoUrl?: string;
  isActive: boolean;
  companyId: string;
  createdAt: string;
  updatedAt: string;
}

// Product suppliers
export interface ProductSupplier {
  id: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  isActive: boolean;
  companyId: string;
  createdAt: string;
  updatedAt: string;
}

// Product search and filter types
export interface ProductFilters {
  status?: ProductStatus[];
  taxCategory?: TaxCategory[];
  categoryId?: string;
  brandId?: string;
  supplierId?: string;
  priceMin?: number;
  priceMax?: number;
  hasStock?: boolean;
  isActive?: boolean;
  companyId?: string;
}

export interface ProductSearchParams extends ProductFilters {
  searchTerm?: string;
  page?: number;
  limit?: number;
  sortBy?: 'productName' | 'unitPrice' | 'stock' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
}

// Product state for Redux
export interface ProductState {
  products: Product[];
  stockMovements: StockMovement[];
  categories: string[];
  brands: ProductBrand[];
  suppliers: ProductSupplier[];
  currentProduct: Product | null;
  loading: boolean;
  error: string | null;
  searchTerm: string;
  filters: ProductFilters;
}

// Product validation types
export interface ProductValidationErrors {
  productName?: string;
  unitPrice?: string;
  unitOfMeasure?: string;
  taxCategory?: string;
  productCode?: string;
  stock?: string;
  lowStockThreshold?: string;
}

// Stock movement types
export interface StockMovement {
  id: string;
  productId: string;
  type: 'IN' | 'OUT' | 'ADJUSTMENT';
  quantity: number;
  previousStock: number;
  newStock: number;
  reason: string;
  referenceId?: string; // Invoice ID, purchase order, etc.
  createdAt: string;
  createdBy: string;
}
