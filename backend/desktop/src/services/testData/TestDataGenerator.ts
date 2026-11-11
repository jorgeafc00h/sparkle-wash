/**
 * TestDataGenerator — Genera datos de prueba para desarrollo y modo demo
 *
 * Crea una empresa, clientes, productos y facturas con información
 * realista de El Salvador (nombres, NITs, NRCs, direcciones, productos).
 *
 * Basado en el RN original: App.ReactNative/FacturasSimplesRN/src/services/testData/TestDataGenerator.ts
 */

import { Customer, CustomerType, CustomerDocumentType } from '@/types/customer';
import { Product, UnitOfMeasure, TaxCategory, ProductStatus } from '@/types/product';
import { Invoice, InvoiceType, InvoiceStatus, InvoiceDetail } from '@/types/invoice';
import { Company, CompanyEnvironment, CompanyStatus } from '@/types/company';
import { computeTotals } from '@/utils/invoiceTotals';
import { AppDispatch } from '@/store';
import { hydrateCompanies, setSelectedCompany } from '@/store/slices/companySlice';
import { hydrateCustomers } from '@/store/slices/customerSlice';
import { setProducts } from '@/store/slices/productSlice';
import { hydrateInvoices } from '@/store/slices/invoiceSlice';

// ── Datos de muestra ──────────────────────────────────────────────────────────

const FIRST_NAMES = [
  'Juan', 'María', 'Carlos', 'Ana', 'Luis', 'Sofía',
  'Miguel', 'Lucía', 'Javier', 'Isabel', 'Diego', 'Marcela',
  'Antonio', 'Verónica', 'Pedro', 'Natalia', 'Héctor', 'Claudia',
  'Roberto', 'Patricia',
];

const LAST_NAMES = [
  'Pérez', 'García', 'Rodríguez', 'López', 'Martínez',
  'Hernández', 'González', 'Ramírez', 'Sánchez', 'Torres',
  'Flores', 'Sequeira', 'Díaz', 'Vázquez', 'Jiménez', 'Álvarez',
  'Castro', 'Rivas', 'Mendoza', 'Mejía',
];

const BUSINESS_NAMES = [
  'Comercial ABC, S.A. de C.V.',
  'Distribuidora El Sol',
  'Panadería La Esperanza',
  'Ferretería San Miguel',
  'Librería Minerva',
  'Farmacia La Salud',
  'Tienda El Progreso',
  'Supermercado La Colonia',
];

const DEPARTMENTS: Array<{
  code: string;
  name: string;
  municipios: Array<{ code: string; districtCode: string; name: string }>;
}> = [
  {
    code: '06',
    name: 'San Salvador',
    municipios: [
      { code: '23', districtCode: '14', name: 'San Salvador' },
      { code: '23', districtCode: '8', name: 'Mejicanos' },
      { code: '23', districtCode: '19', name: 'Ciudad Delgado' },
      { code: '22', districtCode: '17', name: 'Soyapango' },
    ],
  },
  {
    code: '05',
    name: 'La Libertad',
    municipios: [
      { code: '28', districtCode: '11', name: 'Santa Tecla' },
      { code: '26', districtCode: '1', name: 'Antiguo Cuscatlán' },
    ],
  },
  {
    code: '02',
    name: 'Santa Ana',
    municipios: [
      { code: '15', districtCode: '10', name: 'Santa Ana' },
      { code: '17', districtCode: '3', name: 'Chalchuapa' },
    ],
  },
  {
    code: '12',
    name: 'San Miguel',
    municipios: [
      { code: '22', districtCode: '17', name: 'San Miguel' },
    ],
  },
];

const PRODUCTS_CATALOG: Array<{ name: string; price: number; unit: UnitOfMeasure }> = [
  { name: 'Pan Francés',           price: 0.10,  unit: UnitOfMeasure.UNIDAD },
  { name: 'Café Molido 250g',      price: 2.50,  unit: UnitOfMeasure.UNIDAD },
  { name: 'Leche Entera 1L',       price: 1.20,  unit: UnitOfMeasure.LITRO  },
  { name: 'Arroz Fortuna 1lb',     price: 0.85,  unit: UnitOfMeasure.UNIDAD },
  { name: 'Frijoles Rojos 1lb',    price: 0.90,  unit: UnitOfMeasure.KILOGRAMO },
  { name: 'Aceite Vegetal 1L',     price: 2.75,  unit: UnitOfMeasure.LITRO  },
  { name: 'Azúcar Morena 1lb',     price: 0.65,  unit: UnitOfMeasure.KILOGRAMO },
  { name: 'Sal Refinada 500g',     price: 0.50,  unit: UnitOfMeasure.KILOGRAMO },
  { name: 'Papel Bond A4 (resma)', price: 6.50,  unit: UnitOfMeasure.UNIDAD },
  { name: 'Servicio de Asesoría',  price: 50.00, unit: UnitOfMeasure.SERVICIO },
  { name: 'Fotocopia',             price: 0.05,  unit: UnitOfMeasure.UNIDAD },
  { name: 'Bolígrafo BIC',         price: 0.35,  unit: UnitOfMeasure.UNIDAD },
  { name: 'Detergente en Polvo',   price: 3.25,  unit: UnitOfMeasure.UNIDAD },
  { name: 'Jabón de Baño',         price: 0.80,  unit: UnitOfMeasure.UNIDAD },
  { name: 'Toalla Absorbente',     price: 4.50,  unit: UnitOfMeasure.UNIDAD },
];

// ── Generador ─────────────────────────────────────────────────────────────────

export class TestDataGenerator {

  // ── Empresa ────────────────────────────────────────────────────────────────

  /**
   * Genera una empresa de demostración para El Salvador.
   */
  static generateCompany(): Company {
    const now = new Date().toISOString();
    return {
      id: 'demo_company_01',
      nombre: 'Comercial ABC, S.A. de C.V.',
      nombreComercial: 'Comercial ABC',
      nit: '0614-010190-001-5',
      nrc: '12345-6',
      correo: 'facturacion@comercialabc.com.sv',
      telefono: '2222-3333',
      complemento: 'Col. Escalón, Calle La Reforma #123, San Salvador',
      direccion: 'Col. Escalón, Calle La Reforma #123, San Salvador',
      departamentoCode: '06',
      departamento: 'San Salvador',
      municipioCode: '14',
      municipio: 'San Salvador',
      distritoCode: '14',
      distrito: 'San Salvador',
      codActividad: '46900',
      descActividad: 'Venta al por mayor de otros productos',
      tipoEstablecimiento: '02',
      establecimiento: 'Casa Matriz',
      descTipoEstablecimiento: 'Casa Matriz',
      codEstableMH: 'M001',
      codEstable: '',
      codPuntoVentaMH: 'P001',
      codPuntoVenta: '',
      environment: CompanyEnvironment.Development,
      isTestAccount: true,
      hasValidCertificate: false,
      hasApiCredentials: false,
      ivaPercentage: 13,
      currentInvoiceNumber: 1,
      currentCCFNumber: 1,
      status: CompanyStatus.Active,
      isDefault: true,
      isProduction: false,
      userId: 'demo_user',
      createdAt: now,
      updatedAt: now,
    };
  }

  // ── Clientes ───────────────────────────────────────────────────────────────

  /**
   * Genera N clientes de demostración con datos salvadoreños.
   * @param companyId - ID de la empresa
   * @param count - Cantidad de clientes a generar (por defecto 10)
   */
  static generateCustomers(companyId: string, count = 10): Customer[] {
    return Array.from({ length: count }, (_, i) => {
      const firstName = this.pick(FIRST_NAMES);
      const lastName  = this.pick(LAST_NAMES);
      const dept      = this.pick(DEPARTMENTS);
      const mun       = this.pick(dept.municipios);
      const now       = new Date().toISOString();

      // MH validates `receptor.nit` against its taxpayer registry — random
      // synthetic NITs trip "[009] NIT CONTRIBUYENTE NO EXISTE". Pin to a
      // known-registered test NIT so CCF/dependent submissions reach
      // PROCESADO. Multiple customers sharing one NIT is fine for the
      // generated production-access batch (MH doesn't enforce uniqueness
      // across documents) but obviously not for real production data.
      const nit = '0614-020203-101-1';

      // Keep the same deterministic 9-digit DUI pattern used by the Swift
      // production-access generator (0372160XX). Mapping will format this as
      // XXXXXXXX-X where needed.
      const nationalId = `0372160${String(i + 1).padStart(2, '0')}`;

      // NRC must match the registered contribuyente for the pinned NIT,
      // otherwise MH responds "[receptor.nrc] NO CORRESPONDE A CONTRIBUYENTE".
      const nrc = '1481520';

      const isBusinessCustomer = i % 3 === 0;

      const customer: Customer = {
        id: `demo_customer_${companyId}_${i + 1}`,
        firstName,
        lastName,
        name: `${firstName} ${lastName}`,
        businessName: isBusinessCustomer ? this.pick(BUSINESS_NAMES) : undefined,
        nationalId,
        nit,
        nrc: isBusinessCustomer ? nrc : undefined,
        documentType: isBusinessCustomer ? CustomerDocumentType.NIT : CustomerDocumentType.DUI,
        // MH's email validator rejects local-parts with accents (María →
        // "maría1@…" gets "Campo #/receptor/correo no cumple el formato
        // requerido"). Strip diacritics for the email only — display name
        // keeps accents.
        email: `${firstName
          .normalize('NFD')
          .replace(/\p{Diacritic}/gu, '')
          .toLowerCase()}${i + 1}@ejemplo.com.sv`,
        phone: `7${String(700 + i).padStart(3, '0')}-${String(1000 + i).padStart(4, '0')}`,
        address: `Calle Principal #${i + 10}, ${mun.name}`,
        department: dept.name,
        departmentCode: dept.code,
        municipality: mun.name,
        municipalityCode: mun.code,
        district: mun.name,
        districtCode: mun.districtCode,
        codActividad: '73100',
        descActividad: 'Publicidad',
        hasContributorRetention: isBusinessCustomer && i % 5 === 0,
        customerType: isBusinessCustomer ? CustomerType.Business : CustomerType.Individual,
        isActive: true,
        companyId,
        createdAt: now,
        updatedAt: now,
      };

      return customer;
    });
  }

  // ── Productos ──────────────────────────────────────────────────────────────

  /**
   * Genera N productos de demostración con artículos comunes salvadoreños.
   * @param companyId - ID de la empresa
   * @param count - Cantidad de productos a generar (por defecto usa el catálogo completo)
   */
  static generateProducts(companyId: string, count = PRODUCTS_CATALOG.length): Product[] {
    const now = new Date().toISOString();
    const limit = Math.min(count, PRODUCTS_CATALOG.length);
    return Array.from({ length: limit }, (_, i) => {
      const catalog = PRODUCTS_CATALOG[i % PRODUCTS_CATALOG.length];
      const product: Product = {
        id: `demo_product_${companyId}_${i + 1}`,
        productName: catalog.name,
        description: `${catalog.name} — producto de muestra`,
        productCode: `PROD${String(i + 1).padStart(3, '0')}`,
        unitPrice: catalog.price,
        unitOfMeasure: catalog.unit,
        taxCategory: TaxCategory.GRAVADO,
        status: ProductStatus.Active,
        isActive: true,
        tipoItem: '1',
        uniMedida: '59',
        companyId,
        createdAt: now,
        updatedAt: now,
      };
      return product;
    });
  }

  // ── Facturas ───────────────────────────────────────────────────────────────

  /**
   * Genera N facturas con datos realistas.
   * @param companyId - ID de la empresa
   * @param customers - Lista de clientes disponibles
   * @param products - Lista de productos disponibles
   * @param count - Cantidad de facturas a generar (por defecto 20)
   */
  static generateInvoices(
    companyId: string,
    customers: Customer[],
    products: Product[],
    count = 20,
  ): Invoice[] {
    if (customers.length === 0 || products.length === 0) return [];

    const invoiceTypes = [
      InvoiceType.Factura,
      InvoiceType.Factura,
      InvoiceType.Factura, // más comunes
      InvoiceType.CCF,
      InvoiceType.CCF,
    ];

    return Array.from({ length: count }, (_, i) => {
      const customer  = customers[i % customers.length];
      const invoiceType = this.pick(invoiceTypes);
      const numProducts = Math.min((i % 3) + 1, products.length);
      const selectedProducts = products.slice(0, numProducts);

      const items: InvoiceDetail[] = selectedProducts.map((p, j) => ({
        id:          `demo_item_${companyId}_${i + 1}_${j + 1}`,
        productId:   p.id,
        productName: p.productName,
        quantity:    (j + 1) * (1 + (i % 3)),
        unitPrice:   p.unitPrice,
        obsItem:     '',
        createdAt:   new Date().toISOString(),
        updatedAt:   new Date().toISOString(),
      }));

      const totals = this.calculateTotals(items, invoiceType);

      // Fecha en los últimos 90 días
      const daysAgo = Math.floor(Math.random() * 90);
      const invoiceDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

      const invoiceNumber = String(i + 1).padStart(10, '0');
      const typeCode      = this.getDocTypeCode(invoiceType);

      const invoice: Invoice = {
        id:             `demo_invoice_${companyId}_${i + 1}`,
        invoiceNumber,
        date:           invoiceDate.toISOString(),
        status:         i % 7 === 0 ? InvoiceStatus.Nueva : InvoiceStatus.Completada,
        customerId:     customer.id,
        customer,
        invoiceType,
        documentType:   typeCode,
        companyId,
        items,
        generationCode: this.generateUUID(),
        controlNumber:  `DTE-${typeCode}-M001P001-${invoiceNumber}`,
        receptionSeal:  i % 7 === 0 ? undefined : `SEAL${String(i + 1).padStart(10, '0')}`,
        ...totals,
        // Canonical totals — the DTE mapper reads retention/renta from them.
        totals: {
          ...computeTotals(items, invoiceType, Boolean(customer.hasContributorRetention)),
          version:        this.getSchemaVersion(invoiceType),
        },
        createdAt:  invoiceDate.toISOString(),
        updatedAt:  invoiceDate.toISOString(),
      };

      return invoice;
    });
  }

  // ── Seed de la tienda Redux ────────────────────────────────────────────────

  /**
   * Inicializa el store Redux con datos de prueba.
   * Genera una empresa, 10 clientes, 15 productos y 20 facturas.
   *
   * @param dispatch - Función dispatch de Redux
   */
  static async seedStore(dispatch: AppDispatch): Promise<void> {
    const company   = this.generateCompany();
    const customers = this.generateCustomers(company.id, 10);
    const products  = this.generateProducts(company.id, 15);
    const invoices  = this.generateInvoices(company.id, customers, products, 20);

    dispatch(hydrateCompanies([company]));
    dispatch(setSelectedCompany(company.id));
    dispatch(hydrateCustomers(customers));
    dispatch(setProducts(products));
    dispatch(hydrateInvoices(invoices));
  }

  // ── Utilidades privadas ───────────────────────────────────────────────────

  private static pick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  private static generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16).toUpperCase();
    });
  }

  private static getDocTypeCode(type: InvoiceType): string {
    const map: Partial<Record<InvoiceType, string>> = {
      [InvoiceType.Factura]:                   '01',
      [InvoiceType.CCF]:                       '03',
      [InvoiceType.NotaRemision]:              '04',
      [InvoiceType.NotaCredito]:               '05',
      [InvoiceType.NotaDebito]:                '06',
      [InvoiceType.ComprobanteRetencion]:      '07',
      [InvoiceType.ComprobanteLiquidacion]:    '08',
      [InvoiceType.DocumentoContableLiquidacion]: '09',
      [InvoiceType.FacturaExportacion]:        '11',
      [InvoiceType.SujetoExcluido]:            '14',
      [InvoiceType.ComprobanteDonacion]:       '15',
      [InvoiceType.EventoOperacionesEspeciales]: '17',
      [InvoiceType.EventoRetorno]:             '18',
    };
    return map[type] ?? '01';
  }

  private static getSchemaVersion(type: InvoiceType): number {
    const map: Partial<Record<InvoiceType, number>> = {
      [InvoiceType.Factura]: 2,
      [InvoiceType.CCF]: 4,
      [InvoiceType.NotaRemision]: 4,
      [InvoiceType.NotaCredito]: 4,
      [InvoiceType.NotaDebito]: 4,
      [InvoiceType.ComprobanteRetencion]: 2,
      [InvoiceType.ComprobanteLiquidacion]: 2,
      [InvoiceType.DocumentoContableLiquidacion]: 2,
      [InvoiceType.FacturaExportacion]: 3,
      [InvoiceType.SujetoExcluido]: 2,
      [InvoiceType.ComprobanteDonacion]: 2,
      [InvoiceType.EventoOperacionesEspeciales]: 1,
      [InvoiceType.EventoRetorno]: 1,
    };
    return map[type] ?? 1;
  }

  private static calculateTotals(
    items: InvoiceDetail[],
    type: InvoiceType,
  ): { subtotal: number; tax: number; total: number; totalAmount: number } {
    const isCCF = type === InvoiceType.CCF;
    const noTax = type === InvoiceType.SujetoExcluido || type === InvoiceType.FacturaExportacion;

    let subtotal = 0;
    let tax      = 0;
    let total    = 0;

    for (const item of items) {
      const lineTotal = Math.round(item.quantity * item.unitPrice * 100) / 100;

      if (noTax) {
        subtotal += lineTotal;
        total    += lineTotal;
      } else if (isCCF) {
        const lineTax = Math.round((lineTotal - lineTotal / 1.13) * 100) / 100;
        subtotal += lineTotal - lineTax;
        tax      += lineTax;
        total    += lineTotal;
      } else {
        const lineTax = Math.round((lineTotal - lineTotal / 1.13) * 100) / 100;
        tax      += lineTax;
        total    += lineTotal;
        subtotal  = total - tax;
      }
    }

    return {
      subtotal:    Math.round(subtotal * 100) / 100,
      tax:         Math.round(tax      * 100) / 100,
      total:       Math.round(total    * 100) / 100,
      totalAmount: Math.round(total    * 100) / 100,
    };
  }
}
