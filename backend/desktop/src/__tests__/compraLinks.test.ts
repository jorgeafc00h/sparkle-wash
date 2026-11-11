import {
  isCompraLinked,
  comprasLinkedToInvoice,
  comprasLinkedToCustomer,
  linkedMaterialsTotal,
} from '../services/compras/compraLinks';
import { Compra, CompraSource } from '../types/compras';

const baseCompra = (overrides: Partial<Compra> = {}): Compra => ({
  id: 'compra-001',
  companyId: 'company-001',
  emisorNit: '0614-010101-101-1',
  emisorNombre: 'Proveedor Demo',
  tipoDte: '03',
  codigoGeneracion: 'COMPRA-GEN-001',
  numeroControl: 'DTE-03-COMPRA',
  fecha: '2026-06-20',
  totalGravada: 100,
  totalIva: 13,
  totalPagar: 113,
  source: CompraSource.Manual,
  items: [],
  createdAt: '2026-06-20T10:00:00.000Z',
  updatedAt: '2026-06-20T10:00:00.000Z',
  ...overrides,
});

describe('compraLinks', () => {
  describe('isCompraLinked', () => {
    it('is false when neither linkedInvoiceId nor linkedCustomerId is set', () => {
      expect(isCompraLinked(baseCompra())).toBe(false);
      expect(isCompraLinked(baseCompra({ linkedInvoiceId: null, linkedCustomerId: null }))).toBe(false);
    });

    it('is true when linkedInvoiceId is set', () => {
      expect(isCompraLinked(baseCompra({ linkedInvoiceId: 'invoice-001' }))).toBe(true);
    });

    it('is true when only linkedCustomerId is set', () => {
      expect(isCompraLinked(baseCompra({ linkedCustomerId: 'customer-001' }))).toBe(true);
    });
  });

  describe('comprasLinkedToInvoice', () => {
    it('returns only compras linked to the given invoice within the given company', () => {
      const compras = [
        baseCompra({ id: 'compra-a', linkedInvoiceId: 'invoice-001' }),
        baseCompra({ id: 'compra-b', linkedInvoiceId: 'invoice-002' }),
        baseCompra({ id: 'compra-c', linkedInvoiceId: 'invoice-001', companyId: 'company-002' }),
        baseCompra({ id: 'compra-d' }),
      ];

      const linked = comprasLinkedToInvoice(compras, 'invoice-001', 'company-001');

      expect(linked.map((c) => c.id)).toEqual(['compra-a']);
    });

    it('returns an empty array when nothing is linked to the invoice', () => {
      const compras = [baseCompra({ id: 'compra-a', linkedInvoiceId: 'invoice-999' })];
      expect(comprasLinkedToInvoice(compras, 'invoice-001', 'company-001')).toEqual([]);
    });
  });

  describe('comprasLinkedToCustomer', () => {
    it('returns only compras linked to the given customer within the given company', () => {
      const compras = [
        baseCompra({ id: 'compra-a', linkedCustomerId: 'customer-001' }),
        baseCompra({ id: 'compra-b', linkedCustomerId: 'customer-002' }),
        baseCompra({ id: 'compra-c', linkedCustomerId: 'customer-001', companyId: 'company-002' }),
      ];

      const linked = comprasLinkedToCustomer(compras, 'customer-001', 'company-001');

      expect(linked.map((c) => c.id)).toEqual(['compra-a']);
    });

    it('includes a compra linked via invoice auto-fill (same linkedCustomerId)', () => {
      // Linking to an invoice auto-fills linkedCustomerId from the invoice's
      // customer — that compra should still show up under the customer.
      const compras = [
        baseCompra({ id: 'compra-a', linkedInvoiceId: 'invoice-001', linkedCustomerId: 'customer-001' }),
      ];
      expect(comprasLinkedToCustomer(compras, 'customer-001', 'company-001').map((c) => c.id)).toEqual([
        'compra-a',
      ]);
    });
  });

  describe('linkedMaterialsTotal', () => {
    it('sums totalPagar across the given compras', () => {
      const compras = [
        baseCompra({ id: 'compra-a', totalPagar: 113 }),
        baseCompra({ id: 'compra-b', totalPagar: 50.5 }),
      ];
      expect(linkedMaterialsTotal(compras)).toBeCloseTo(163.5);
    });

    it('returns 0 for an empty list', () => {
      expect(linkedMaterialsTotal([])).toBe(0);
    });
  });
});
