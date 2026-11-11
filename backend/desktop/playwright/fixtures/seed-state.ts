/**
 * Redux persist state seeding for Playwright E2E tests.
 *
 * The Desktop app uses redux-persist with localStorage (redux-persist default storage).
 * Keys: persist:auth, persist:companies, persist:invoices, persist:customers,
 *       persist:products, persist:catalogs, persist:subscription, persist:app, persist:compras,
 *       persist:accounts
 *
 * redux-persist double-encode format:
 *   - Each individual value is JSON.stringify'd first
 *   - Then the container object is JSON.stringify'd again
 */

import { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const PERSIST_KEY_PREFIX = 'persist:';

// Bundled catalog data — same JSON the app loads at boot. Pre-seeding into
// `persist:catalogs` avoids LocationDropdowns triggering an async
// `syncCatalogs()` on mount (which races test polling and times out).
const __seedDir = dirname(fileURLToPath(import.meta.url));
// Only the catalogs the test UI actually reads. The full bundled JSON is
// 244 KB, doubles after redux-persist re-encoding, and starves the page
// boot of cycles. CAT-019 (economic activities) alone is 65 KB so we
// exclude it here — none of the failing UI tests depend on it.
const NEEDED_CATALOG_IDS = new Set([
  'CAT-002', // document/event types
  'CAT-008', // tipoEstablecimiento
  'CAT-012', // departamentos
  'CAT-013', // municipios (16 KB but used by every customer/company form)
  'CAT-023', // operaciones especiales
  'CAT-024', // motivo del evento
]);

const BUNDLED_CATALOGS: Array<Record<string, unknown>> = (() => {
  try {
    const path = resolve(__seedDir, '..', '..', 'src', 'data', 'catalogs.json');
    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    const all: Array<Record<string, unknown>> =
      Array.isArray(raw) ? raw : raw.catalogs ?? [];
    return all.filter((c) => NEEDED_CATALOG_IDS.has(c.id as string));
  } catch {
    return [];
  }
})();

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

export const TEST_USER = {
  id: 'guest-user-001',
  email: 'test@facturassimples.com',
  firstName: 'Test',
  lastName: 'User',
  phone: '7700-0000',
  avatar: '',
  isEmailVerified: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

export const TEST_COMPANY = {
  id: '1',
  // Values match the real registered taxpayer for the test certificate
  // (Invoices.Api/Test/certificates/06141404941342.crt). NIT + NRC + activity
  // code are what MH cross-references during submit; if any of them don't
  // resolve to a registered contribuyente, MH returns codigoMsg 008.
  nombre: 'Jorge Flores',
  nombreComercial: 'K Labs',
  nit: '0614-140494-134-2',
  nrc: '3238005',
  correo: 'jorgeafc00h@gmail.com',
  telefono: '7730-5680',
  complemento: 'Calle Mano de Leon',
  departamentoCode: '06',
  departamento: 'San Salvador',
  municipioCode: '14',
  municipio: 'San Salvador',
  distritoCode: '14',
  distrito: 'San Salvador',
  codActividad: '45209',
  descActividad: 'Reparaciones de vehículos n.c.p.',
  tipoEstablecimiento: '07',
  establecimiento: 'Predio',
  codEstableMH: 'M001',
  codEstable: '0001',
  codPuntoVentaMH: 'P001',
  codPuntoVenta: '0001',
  // FE-specific (CAT-021 Recinto Fiscal, CAT-022 Régimen).
  recintoFiscal: '01',
  regimenFiscal: '01',
  environment: 'DEVELOPMENT',
  isTestAccount: true,
  hasValidCertificate: false,
  hasApiCredentials: false,
  ivaPercentage: 13,
  currentInvoiceNumber: 1,
  currentCCFNumber: 1,
  status: 'ACTIVE',
  isDefault: true,
  userId: 'guest',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

export const SAMPLE_CUSTOMERS = [
  {
    id: 'cust-001',
    firstName: 'Maria',
    lastName: 'Gonzalez',
    nationalId: '01234567-8',
    nit: '',
    nrc: '',
    email: 'maria@test.com',
    phone: '7700-1234',
    department: 'San Salvador',
    municipality: 'San Salvador',
    districtCode: '14',
    district: 'San Salvador',
    address: 'Col. Escalon #123',
    customerType: 0,
    companyId: '1',
    businessName: '',
    isActive: true,
    hasContributorRetention: false,
    createdAt: '2026-01-10T00:00:00.000Z',
    updatedAt: '2026-01-10T00:00:00.000Z',
  },
  {
    id: 'cust-002',
    firstName: 'Empresa',
    lastName: 'XYZ',
    nationalId: '',
    nit: '0614-020203-101-1',
    nrc: '1481520',
    email: 'admin@empresaxyz.com',
    phone: '2521-7426',
    department: 'La Libertad',
    municipality: 'Santa Tecla',
    districtCode: '11',
    district: 'Santa Tecla',
    address: 'Blvd. Constitución #500',
    customerType: 1,
    companyId: '1',
    businessName: 'Empresa XYZ S.A. de C.V.',
    isActive: true,
    hasContributorRetention: true,
    createdAt: '2026-01-12T00:00:00.000Z',
    updatedAt: '2026-01-12T00:00:00.000Z',
  },
  {
    id: 'cust-003',
    firstName: 'Ana',
    lastName: 'Lopez',
    nationalId: '11223344-5',
    nit: '',
    nrc: '',
    email: 'ana@test.com',
    phone: '7800-9012',
    department: 'Sonsonate',
    municipality: 'Sonsonate',
    districtCode: '15',
    district: 'Sonsonate',
    address: 'Av. Roosevelt #77',
    customerType: 0,
    companyId: '1',
    businessName: '',
    isActive: true,
    hasContributorRetention: false,
    createdAt: '2026-01-15T00:00:00.000Z',
    updatedAt: '2026-01-15T00:00:00.000Z',
  },
  {
    id: 'cust-004',
    firstName: 'Carlos',
    lastName: 'Mendoza',
    nationalId: '55667788-9',
    nit: '',
    nrc: '',
    email: 'carlos@test.com',
    phone: '7655-4321',
    department: 'San Miguel',
    municipality: 'San Miguel',
    address: 'Calle Sirama #8',
    customerType: 0,
    companyId: '1',
    businessName: '',
    isActive: true,
    hasContributorRetention: false,
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  },
  {
    id: 'cust-005',
    firstName: 'Gobierno',
    lastName: 'Central',
    nationalId: '',
    nit: '0614-000000-000-0',
    nrc: '',
    email: 'gobierno@gob.sv',
    phone: '2222-0000',
    department: 'San Salvador',
    municipality: 'San Salvador',
    address: 'Casa Presidencial, Col. San Benito',
    customerType: 2,
    companyId: '1',
    businessName: 'Gobierno Central',
    isActive: true,
    hasContributorRetention: false,
    createdAt: '2026-02-05T00:00:00.000Z',
    updatedAt: '2026-02-05T00:00:00.000Z',
  },
];

export const SAMPLE_PRODUCTS = [
  {
    id: 'prod-001',
    productName: 'Servicio de Consultoría',
    description: 'Asesoría empresarial',
    productCode: 'SRV-001',
    unitPrice: 150.00,
    cost: 80.00,
    unitOfMeasure: 'HORA',
    taxCategory: 'GRAVADO',
    isService: true,
    trackInventory: false,
    hasInventory: false,
    status: 'ACTIVE',
    companyId: '1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'prod-002',
    productName: 'Laptop Dell Inspiron',
    description: 'Laptop 15 pulgadas, 16GB RAM',
    productCode: 'EQUIP-001',
    barcode: '7891234567890',
    unitPrice: 850.00,
    cost: 600.00,
    unitOfMeasure: 'UNIDAD',
    taxCategory: 'GRAVADO',
    isService: false,
    stock: 10,
    stockQuantity: 10,
    trackInventory: true,
    hasInventory: true,
    minStock: 2,
    lowStockThreshold: 2,
    status: 'ACTIVE',
    companyId: '1',
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
  {
    id: 'prod-003',
    productName: 'Papel Bond A4',
    description: 'Resma 500 hojas',
    productCode: 'OFIC-001',
    unitPrice: 5.50,
    cost: 3.00,
    unitOfMeasure: 'CAJA',
    taxCategory: 'GRAVADO',
    isService: false,
    stock: 100,
    stockQuantity: 100,
    trackInventory: true,
    hasInventory: true,
    minStock: 10,
    lowStockThreshold: 10,
    status: 'ACTIVE',
    companyId: '1',
    createdAt: '2026-01-03T00:00:00.000Z',
    updatedAt: '2026-01-03T00:00:00.000Z',
  },
  {
    id: 'prod-004',
    productName: 'Mantenimiento TI',
    description: 'Servicio mensual de soporte técnico',
    productCode: 'SRV-002',
    unitPrice: 200.00,
    unitOfMeasure: 'SERVICIO',
    taxCategory: 'GRAVADO',
    isService: true,
    trackInventory: false,
    hasInventory: false,
    status: 'ACTIVE',
    companyId: '1',
    createdAt: '2026-01-04T00:00:00.000Z',
    updatedAt: '2026-01-04T00:00:00.000Z',
  },
  {
    id: 'prod-005',
    productName: 'Silla de Oficina',
    description: 'Silla ergonómica con ruedas',
    productCode: 'MOB-001',
    unitPrice: 120.00,
    cost: 70.00,
    unitOfMeasure: 'UNIDAD',
    taxCategory: 'GRAVADO',
    isService: false,
    stock: 5,
    stockQuantity: 5,
    trackInventory: true,
    hasInventory: true,
    minStock: 5,
    lowStockThreshold: 5,
    status: 'ACTIVE',
    companyId: '1',
    createdAt: '2026-01-05T00:00:00.000Z',
    updatedAt: '2026-01-05T00:00:00.000Z',
  },
];

// InvoiceType enum: Factura=0, CCF=1, NotaCredito=2, SujetoExcluido=3, NotaDebito=4
// InvoiceStatus enum: Nueva=0, Sincronizando=1, Completada=2, Anulada=3, Modificada=4, ErrorEnvio=5

export const SAMPLE_INVOICES = [
  {
    id: 'inv-001',
    invoiceNumber: 'INV-001',
    controlNumber: 'DTE-01-M001-000000001',
    generationCode: '11111111-1111-4111-8111-111111111111',
    receptionSeal: 'SELLO-RECIBIDO-INV-001',
    fechaTransmision: '2026-03-01T10:05:00.000Z',
    date: '2026-03-01',
    paymentCondition: 2,
    paymentTermCode: '01',
    paymentTermPeriod: 30,
    invoiceType: 0, // InvoiceType.Factura
    status: 2, // InvoiceStatus.Completada
    companyId: '1',
    customerId: 'cust-001',
    customer: { id: 'cust-001', firstName: 'Maria', lastName: 'Gonzalez', nationalId: '01234567-8' },
    items: [
      {
        id: 'inv-001_detail_1',
        invoiceId: 'inv-001',
        productId: 'prod-001',
        productName: 'Servicio de Consultoría',
        quantity: 2,
        unitPrice: 150.00,
        obsItem: '',
      }
    ],
    totals: { subTotal: 265.49, ivaAmount: 34.51, totalPagar: 300.00, totalAmount: 300.00 },
    totalAmount: 300.00,
    totalAmountIncludingTax: 300.00,
    documentType: '01',
    createdAt: '2026-03-01T10:00:00.000Z',
    updatedAt: '2026-03-01T10:00:00.000Z',
  },
  {
    id: 'inv-002',
    invoiceNumber: 'INV-002',
    controlNumber: 'DTE-03-M001-000000001',
    generationCode: '22222222-2222-4222-8222-222222222222',
    receptionSeal: 'SELLO-RECIBIDO-INV-002',
    fechaTransmision: '2026-03-10T09:05:00.000Z',
    date: '2026-03-10',
    invoiceType: 1, // InvoiceType.CCF
    status: 2, // InvoiceStatus.Completada
    companyId: '1',
    customerId: 'cust-002',
    customer: { id: 'cust-002', businessName: 'Empresa XYZ S.A. de C.V.', nit: '0614-020203-101-1' },
    items: [
      {
        id: 'inv-002_detail_1',
        invoiceId: 'inv-002',
        productId: 'prod-002',
        productName: 'Laptop Dell Inspiron',
        quantity: 1,
        unitPrice: 850.00,
        obsItem: '',
      }
    ],
    totals: { subTotal: 752.21, ivaAmount: 97.79, totalPagar: 850.00, totalAmount: 850.00 },
    totalAmount: 850.00,
    totalAmountIncludingTax: 850.00,
    documentType: '03',
    createdAt: '2026-03-10T09:00:00.000Z',
    updatedAt: '2026-03-10T09:00:00.000Z',
  },
  {
    id: 'inv-003',
    invoiceNumber: 'INV-003',
    controlNumber: '',
    date: '2026-04-01',
    invoiceType: 0, // InvoiceType.Factura
    status: 0, // InvoiceStatus.Nueva
    companyId: '1',
    customerId: 'cust-003',
    customer: { id: 'cust-003', firstName: 'Ana', lastName: 'Lopez', nationalId: '11223344-5' },
    items: [
      {
        id: 'inv-003_detail_1',
        invoiceId: 'inv-003',
        productId: 'prod-003',
        productName: 'Papel Bond A4',
        quantity: 5,
        unitPrice: 5.50,
        obsItem: '',
      }
    ],
    totals: { subTotal: 24.34, ivaAmount: 3.16, totalPagar: 27.50, totalAmount: 27.50 },
    totalAmount: 27.50,
    totalAmountIncludingTax: 27.50,
    documentType: '01',
    createdAt: '2026-04-01T14:00:00.000Z',
    updatedAt: '2026-04-01T14:00:00.000Z',
  },
];

export const SAMPLE_COMPRAS = [
  {
    id: 'compra-001',
    companyId: '1',
    emisorNit: '0614-030303-101-1',
    emisorNrc: '7654321',
    emisorNombre: 'Proveedor Demo S.A. de C.V.',
    tipoDte: '03',
    codigoGeneracion: '33333333-3333-4333-8333-333333333333',
    numeroControl: 'DTE-03-PROV-000000001',
    selloRecibido: 'SELLO-COMPRA-001',
    fecha: '2026-03-15',
    paymentCondition: 2,
    paymentTermCode: '01',
    paymentTermPeriod: 30,
    totalGravada: 100,
    totalIva: 13,
    totalPagar: 113,
    source: 'manual',
    items: [],
    createdAt: '2026-03-15T10:00:00.000Z',
    updatedAt: '2026-03-15T10:00:00.000Z',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a plain state object to redux-persist's double-encoded format.
 * redux-persist JSON.stringify's each value individually, then stores the container as JSON.
 */
function toReduxPersistFormat(state: Record<string, unknown>): string {
  const doubleEncoded: Record<string, string> = {};
  for (const [key, value] of Object.entries(state)) {
    doubleEncoded[key] = JSON.stringify(value);
  }
  return JSON.stringify(doubleEncoded);
}

function buildAuthState(hasCompletedOnboarding = true) {
  return toReduxPersistFormat({
    user: TEST_USER,
    isAuthenticated: false,
    isGuestMode: true,
    hasCompletedOnboarding,
    loading: false,
    error: null,
    token: null,
    refreshToken: null,
    selectedCompanyId: TEST_COMPANY.id,
    _persist: { version: -1, rehydrated: true },
  });
}

function buildAppState() {
  return toReduxPersistFormat({
    isInitialized: true,
    isOnline: true,
    currentTheme: 'light',
    language: 'es',
    environment: 'development',
    syncStatus: 'idle',
    notifications: [],
    _persist: { version: -1, rehydrated: true },
  });
}

function buildCompaniesState(companies = [TEST_COMPANY]) {
  return toReduxPersistFormat({
    companies,
    selectedCompanyId: companies[0]?.id ?? null,
    currentCompany: companies[0] ?? null,
    loading: false,
    error: null,
    _persist: { version: -1, rehydrated: true },
  });
}

function buildCustomersState(customers: unknown[] = []) {
  return toReduxPersistFormat({
    customers,
    selectedCustomerId: null,
    lastUpdatedAt: null,
    loading: false,
    error: null,
    searchTerm: '',
    filters: { isActive: true },
    _persist: { version: -1, rehydrated: true },
  });
}

function buildProductsState(products: unknown[] = []) {
  return toReduxPersistFormat({
    products,
    stockMovements: [],
    categories: [],
    brands: [],
    suppliers: [],
    currentProduct: null,
    filters: {},
    loading: false,
    error: null,
    searchTerm: '',
    _persist: { version: -1, rehydrated: true },
  });
}

function buildInvoicesState(invoices: unknown[] = []) {
  return toReduxPersistFormat({
    invoices,
    selectedInvoiceId: null,
    pendingSync: [],
    lastSyncDate: null,
    currentInvoice: null,
    filters: {},
    loading: false,
    error: null,
    searchTerm: '',
    _persist: { version: -1, rehydrated: true },
  });
}

function buildCatalogsState() {
  return toReduxPersistFormat({
    catalogs: BUNDLED_CATALOGS,
    syncInfo: {},
    lastFullSync: new Date().toISOString(),
    filters: {},
    loading: false,
    error: null,
    searchTerm: '',
    _persist: { version: -1, rehydrated: true },
  });
}

function buildSubscriptionState(tier: 'lite' | 'adfree' | 'pro' = 'pro') {
  return toReduxPersistFormat({
    tier,
    isInitialized: true,
    loading: false,
    error: null,
    availableProducts: [],
    activeSubscription: null,
    purchaseInProgress: false,
    _persist: { version: -1, rehydrated: true },
  });
}

function buildComprasState(compras: unknown[] = []) {
  return toReduxPersistFormat({
    compras,
    monthlyTotal: null,
    dbInitialized: true,
    loading: false,
    error: null,
    searchTerm: '',
    dateFrom: null,
    dateTo: null,
    selectedCompraId: null,
    linkedGmailEmail: null,
    syncState: null,
    _persist: { version: -1, rehydrated: true },
  });
}

function buildAccountsState() {
  return toReduxPersistFormat({
    entries: [],
    payments: [],
    activeDirection: 'receivable',
    searchTerm: '',
    statusFilter: 'all',
    error: null,
    lastUpdatedAt: null,
    _persist: { version: -1, rehydrated: true },
  });
}

// ---------------------------------------------------------------------------
// Seed helpers — inject localStorage BEFORE page load via addInitScript
// This avoids race conditions where redux-persist overwrites seeded data.
// ---------------------------------------------------------------------------

/**
 * Inject localStorage entries as an init script so they are set
 * before any JavaScript runs on the page (before redux-persist initializes).
 * Pattern: addInitScript → goto → waitForAppReady.
 */
async function injectLocalStorageAndGoto(
  page: Page,
  entries: Record<string, string>,
  path = '/',
): Promise<void> {
  // addInitScript runs before any page script — perfect for seeding localStorage
  await page.addInitScript((data) => {
    for (const [key, value] of Object.entries(data as Record<string, string>)) {
      window.localStorage.setItem(key, value);
    }
  }, entries);

  await page.goto(path);
  await waitForAppReady(page);
}

/**
 * Seed empty app state: guest user, company set, no data entities.
 * Defaults to Lite tier; pass a higher tier for tests that exercise features
 * gated behind paid plans (e.g. creating extra companies past the Lite cap).
 */
export async function seedEmptyAppState(
  page: Page,
  tier: 'lite' | 'adfree' | 'pro' = 'lite',
): Promise<void> {
  const entries: Record<string, string> = {
    [`${PERSIST_KEY_PREFIX}auth`]: buildAuthState(true),
    [`${PERSIST_KEY_PREFIX}app`]: buildAppState(),
    [`${PERSIST_KEY_PREFIX}companies`]: buildCompaniesState([TEST_COMPANY]),
    [`${PERSIST_KEY_PREFIX}customers`]: buildCustomersState([]),
    [`${PERSIST_KEY_PREFIX}products`]: buildProductsState([]),
    [`${PERSIST_KEY_PREFIX}invoices`]: buildInvoicesState([]),
    [`${PERSIST_KEY_PREFIX}catalogs`]: buildCatalogsState(),
    [`${PERSIST_KEY_PREFIX}subscription`]: buildSubscriptionState(tier),
    [`${PERSIST_KEY_PREFIX}compras`]: buildComprasState([]),
    [`${PERSIST_KEY_PREFIX}accounts`]: buildAccountsState(),
  };

  await injectLocalStorageAndGoto(page, entries);
}

/**
 * Seed populated app state: guest user + 5 customers + 5 products + 3 invoices + 1 company.
 */
export async function seedPopulatedAppState(page: Page): Promise<void> {
  const entries: Record<string, string> = {
    [`${PERSIST_KEY_PREFIX}auth`]: buildAuthState(true),
    [`${PERSIST_KEY_PREFIX}app`]: buildAppState(),
    [`${PERSIST_KEY_PREFIX}companies`]: buildCompaniesState([TEST_COMPANY]),
    [`${PERSIST_KEY_PREFIX}customers`]: buildCustomersState(SAMPLE_CUSTOMERS),
    [`${PERSIST_KEY_PREFIX}products`]: buildProductsState(SAMPLE_PRODUCTS),
    [`${PERSIST_KEY_PREFIX}invoices`]: buildInvoicesState(SAMPLE_INVOICES),
    [`${PERSIST_KEY_PREFIX}catalogs`]: buildCatalogsState(),
    [`${PERSIST_KEY_PREFIX}subscription`]: buildSubscriptionState('pro'),
    [`${PERSIST_KEY_PREFIX}compras`]: buildComprasState([]),
    [`${PERSIST_KEY_PREFIX}accounts`]: buildAccountsState(),
  };

  await injectLocalStorageAndGoto(page, entries);
}

/**
 * Seed populated state with one compra so Cobros y pagos can derive both
 * receivable and payable ledger rows locally.
 */
export async function seedFinanceAppState(page: Page): Promise<void> {
  const entries: Record<string, string> = {
    [`${PERSIST_KEY_PREFIX}auth`]: buildAuthState(true),
    [`${PERSIST_KEY_PREFIX}app`]: buildAppState(),
    [`${PERSIST_KEY_PREFIX}companies`]: buildCompaniesState([TEST_COMPANY]),
    [`${PERSIST_KEY_PREFIX}customers`]: buildCustomersState(SAMPLE_CUSTOMERS),
    [`${PERSIST_KEY_PREFIX}products`]: buildProductsState(SAMPLE_PRODUCTS),
    [`${PERSIST_KEY_PREFIX}invoices`]: buildInvoicesState(SAMPLE_INVOICES),
    [`${PERSIST_KEY_PREFIX}catalogs`]: buildCatalogsState(),
    [`${PERSIST_KEY_PREFIX}subscription`]: buildSubscriptionState('pro'),
    [`${PERSIST_KEY_PREFIX}compras`]: buildComprasState(SAMPLE_COMPRAS),
    [`${PERSIST_KEY_PREFIX}accounts`]: buildAccountsState(),
    compras_db_1: JSON.stringify(SAMPLE_COMPRAS),
  };

  await injectLocalStorageAndGoto(page, entries);
}

/**
 * Seed state with no company (for testing onboarding/company creation flow).
 */
export async function seedNoCompanyState(page: Page): Promise<void> {
  const noCompanyAuth = toReduxPersistFormat({
    user: TEST_USER,
    isAuthenticated: false,
    isGuestMode: true,
    hasCompletedOnboarding: false,
    loading: false,
    error: null,
    token: null,
    refreshToken: null,
    selectedCompanyId: null,
    _persist: { version: -1, rehydrated: true },
  });

  const entries: Record<string, string> = {
    [`${PERSIST_KEY_PREFIX}auth`]: noCompanyAuth,
    [`${PERSIST_KEY_PREFIX}app`]: buildAppState(),
    [`${PERSIST_KEY_PREFIX}companies`]: toReduxPersistFormat({
      companies: [],
      selectedCompanyId: null,
      currentCompany: null,
      loading: false,
      error: null,
      _persist: { version: -1, rehydrated: true },
    }),
    [`${PERSIST_KEY_PREFIX}customers`]: buildCustomersState([]),
    [`${PERSIST_KEY_PREFIX}products`]: buildProductsState([]),
    [`${PERSIST_KEY_PREFIX}invoices`]: buildInvoicesState([]),
    [`${PERSIST_KEY_PREFIX}catalogs`]: buildCatalogsState(),
    [`${PERSIST_KEY_PREFIX}subscription`]: buildSubscriptionState('lite'),
    [`${PERSIST_KEY_PREFIX}compras`]: buildComprasState([]),
    [`${PERSIST_KEY_PREFIX}accounts`]: buildAccountsState(),
  };

  await page.addInitScript((data) => {
    for (const [key, value] of Object.entries(data as Record<string, string>)) {
      window.localStorage.setItem(key, value);
    }
  }, entries);

  await page.goto('/#/');
  await page.waitForLoadState('domcontentloaded');
}

// ---------------------------------------------------------------------------
// App-ready wait helper (re-exported here for convenience)
// ---------------------------------------------------------------------------

export async function waitForAppReady(page: Page, timeout = 20000): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout });
  // Wait for sidebar (authenticated) or welcome page
  await page.waitForSelector(
    '[data-testid="sidebar-inicio"], [data-testid="welcome"], [data-testid="onboarding"]',
    { timeout, state: 'visible' },
  );
}
