// companySlice → MhClient → TelemetryService → LocalLogger reads import.meta.env, which
// ts-jest's CommonJS build can't parse — stub the logging layer.
jest.mock('@/services/logging/LocalLogger', () => ({
  LocalLogger: { initialize: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), log: jest.fn() },
}));
jest.mock('@/services/telemetry/TelemetryService', () => ({
  TelemetryService: { initialize: jest.fn(), trackEvent: jest.fn(), trackException: jest.fn(), trackTrace: jest.fn() },
  default: { initialize: jest.fn(), trackEvent: jest.fn(), trackException: jest.fn(), trackTrace: jest.fn() },
}));
jest.mock('@/services/storage/ElectronStorage', () => {
  const map = new Map<string, string>();
  const storage = {
    getItem: jest.fn(async (key: string) => (map.has(key) ? map.get(key)! : null)),
    setItem: jest.fn(async (key: string, value: string) => {
      map.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      map.delete(key);
    }),
    clear: jest.fn(async () => {
      map.clear();
    }),
    getAllKeys: jest.fn(async () => Array.from(map.keys())),
  };
  return { appStorage: storage, electronPersistStorage: storage };
});

import { addCustomer, deleteCustomer, deleteCustomersByCompany, syncUpsertCustomer, hydrateCustomers } from '@/store/slices/customerSlice';
import { addProduct, updateProduct, applyInvoiceStockDeduction, applyTicketStockDeduction, restoreTicketStock, deleteProductsByCompany, setProducts } from '@/store/slices/productSlice';
import { addInvoice, deleteInvoicesByCompany, markAsContingency, setInvoiceStatus, syncUpsertInvoice } from '@/store/slices/invoiceSlice';
import { hydrateCompanies, seedSequenceFloor, syncMergeCompany } from '@/store/slices/companySlice';
import { InvoiceStatus, InvoiceType } from '@/types';
import { SubscriptionTier } from '@/services/subscription/SubscriptionTypes';
import { canUseDeviceSync, getAppBranding, getMaxCompanies, isPaidTier, canUseLibrosIVA } from '@/services/subscription/FeatureGate';
import { captureCompraChange } from '@/services/sync/capture';
import { ComprasDatabase } from '@/services/compras/ComprasDatabase';
import { COMPANY_DEVICE_LOCAL_FIELDS, serializeForWire } from '@/services/sync/entityAdapters';
import { createSyncTestStore, makeCompany, setTier, TEST_NIT } from './helpers/syncFakeRelay';

const CO = `co${TEST_NIT}`;

const setup = (tier: SubscriptionTier = SubscriptionTier.ProSync) => {
  const store = createSyncTestStore();
  store.dispatch(hydrateCompanies([makeCompany('company_1')]));
  store.dispatch(setTier(tier));
  return store;
};

const outboxOf = (store: ReturnType<typeof setup>) => store.getState().syncV2.companies[CO]?.outbox ?? {};

const customer = { firstName: 'Ana', lastName: 'López', nationalId: '', nit: '', email: 'a@x.com', phone: '7', documentType: '13', companyId: 'company_1' } as never;
const product = (id: string) => ({
  id, productName: 'P', unitPrice: 1, companyId: 'company_1', trackInventory: true, stockQuantity: 10, stock: 10,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
}) as never;
const invoice = { id: 'inv-1', invoiceNumber: 'DTE-01-M001P001-000000000000001', date: '2026-09-24', invoiceType: InvoiceType.Factura, companyId: 'company_1', items: [] } as never;

describe('Desktop sync capture seam', () => {
  it('captures Desktop-specific local writes: contingency marking and stock deduction', async () => {
    const store = setup();
    store.dispatch(addInvoice(invoice));
    // Desktop's addInvoice mints its own id (unlike RN it ignores input.id).
    const invoiceId = store.getState().invoices.invoices[0].id;
    store.dispatch(addProduct(product('prod-1')));
    await new Promise((resolve) => setTimeout(resolve, 5));
    store.dispatch(markAsContingency(invoiceId));
    store.dispatch(applyInvoiceStockDeduction({
      invoiceId,
      items: [{ productId: 'prod-1', quantity: 2, productName: 'P' }] as never,
      createdAt: new Date().toISOString(),
      createdBy: 'test',
    }));
    const outbox = outboxOf(store);
    expect(outbox[`invoice:${invoiceId}`]).toMatchObject({ op: 'upsert' });
    expect(outbox['product:prod-1']).toMatchObject({ op: 'upsert' });
    expect(store.getState().products.products[0].updatedAt > '2026-01-01T00:00:00.000Z').toBe(true);
    store.dispatch(setInvoiceStatus({ id: invoiceId, status: InvoiceStatus.Completada }));
    expect(outboxOf(store)[`invoice:${invoiceId}`].u >= outbox[`invoice:${invoiceId}`].u).toBe(true);
  });

  it('captures POS ticket stock movements (sale deduction + void restore)', () => {
    const store = setup();
    store.dispatch(addProduct(product('prod-pos')));
    expect(outboxOf(store)['product:prod-pos']).toMatchObject({ op: 'upsert' });

    // A POS sale deducts stock — the product upsert (with bumped updatedAt)
    // must land in the outbox or the phone's inventory silently diverges.
    store.dispatch(applyTicketStockDeduction({
      ticketId: 'tkt_pos_1',
      ticketSequential: 1,
      items: [{ productId: 'prod-pos', quantity: 3, productName: 'P' }] as never,
      createdAt: new Date().toISOString(),
      createdBy: 'cashier',
    }));
    expect(store.getState().products.products[0].stockQuantity).toBe(7);
    expect(outboxOf(store)['product:prod-pos']).toMatchObject({ op: 'upsert' });
    const deductedAt = outboxOf(store)['product:prod-pos'].u;

    // Voiding restores stock — captured too, never older than the deduction.
    store.dispatch(restoreTicketStock({
      ticketId: 'tkt_pos_1',
      ticketSequential: 1,
      items: [{ productId: 'prod-pos', quantity: 3, productName: 'P' }] as never,
      createdAt: new Date().toISOString(),
      createdBy: 'cashier',
    }));
    expect(store.getState().products.products[0].stockQuantity).toBe(10);
    expect(outboxOf(store)['product:prod-pos'].u >= deductedAt).toBe(true);
  });

  it('stamps product edits so LWW never discards them', () => {
    const store = setup();
    store.dispatch(addProduct(product('prod-2')));
    store.dispatch(updateProduct({ ...(product('prod-2') as object), productName: 'Renombrado' } as never));
    const stored = store.getState().products.products[0];
    expect(stored.updatedAt > '2026-01-01T00:00:00.000Z').toBe(true);
    expect(outboxOf(store)['product:prod-2'].u).toBe(stored.updatedAt);
  });

  it('never tombstones a company\'s data when the company is deleted on this device', () => {
    const store = setup();
    store.dispatch(addCustomer(customer));
    store.dispatch(addProduct(product('prod-3')));
    store.dispatch(addInvoice(invoice));
    const before = Object.keys(outboxOf(store)).length;
    store.dispatch(deleteInvoicesByCompany('company_1'));
    store.dispatch(deleteCustomersByCompany('company_1'));
    store.dispatch(deleteProductsByCompany('company_1'));
    const refs = Object.values(outboxOf(store));
    expect(refs).toHaveLength(before);
    expect(refs.every((ref) => ref.op === 'upsert')).toBe(true);
  });

  it('captures single deletes as tombstones', () => {
    const store = setup();
    store.dispatch(addCustomer(customer));
    const id = store.getState().customers.customers[0].id;
    store.dispatch(deleteCustomer(id));
    expect(outboxOf(store)[`customer:${id}`]).toMatchObject({ op: 'delete' });
  });

  it('never re-captures relay writes or bulk loads', () => {
    const store = setup();
    store.dispatch(syncUpsertCustomer({ ...(customer as object), id: 'remote-c', updatedAt: '2026-09-24T10:00:00.000Z' } as never));
    store.dispatch(syncUpsertInvoice({ ...(invoice as object), id: 'remote-i', updatedAt: '2026-09-24T10:00:00.000Z' } as never));
    store.dispatch(syncMergeCompany({ id: 'company_1', changes: { nombreComercial: 'Desde el teléfono' } }));
    store.dispatch(seedSequenceFloor({ companyId: 'company_1', floor: 118 }));
    store.dispatch(hydrateCustomers([{ ...(customer as object), id: 'bulk-c' } as never]));
    store.dispatch(setProducts([product('bulk-p')]));
    expect(outboxOf(store)).toEqual({});
    expect(store.getState().companies.companies[0].nombreComercial).toBe('Desde el teléfono');
  });

  it('captures nothing for tiers without device sync', () => {
    for (const tier of [SubscriptionTier.Lite, SubscriptionTier.AdFree, SubscriptionTier.Pro]) {
      const store = setup(tier);
      store.dispatch(addCustomer(customer));
      store.dispatch(addInvoice(invoice));
      expect(store.getState().syncV2.companies).toEqual({});
    }
  });

  it('captures compras through the ComprasDatabase listener, never relay writes', async () => {
    const store = setup();
    ComprasDatabase.setChangeListener((event) => captureCompraChange(store.getState as never, store.dispatch as never, event));
    const compra = {
      id: 'cmp-1', companyId: 'company_1', emisorNit: '1', emisorNombre: 'Proveedor', tipoDte: '03',
      codigoGeneracion: 'abc-123', numeroControl: 'DTE-03-X-1', fecha: '2026-09-24', totalGravada: 100,
      totalIva: 13, totalPagar: 113, source: 'manual', items: [], createdAt: '2026-09-24T00:00:00.000Z',
      updatedAt: '2026-09-24T00:00:00.000Z',
    } as never;
    await ComprasDatabase.insertCompra(compra);
    expect(outboxOf(store)['purchase:cmp-1']).toMatchObject({ op: 'upsert', k: 'cg:ABC-123' });

    await ComprasDatabase.upsertFromSync({ ...(compra as object), id: 'cmp-2', codigoGeneracion: 'zzz' } as never);
    expect(outboxOf(store)['purchase:cmp-2']).toBeUndefined();

    await ComprasDatabase.deleteCompra('cmp-1');
    expect(outboxOf(store)['purchase:cmp-1']).toMatchObject({ op: 'delete' });
    ComprasDatabase.setChangeListener(null);
  });

  it('keeps the sequential counter and certificate state on this device', () => {
    const wire = serializeForWire('company', {
      id: 'co', nextSequenceNumber: 40, certificatePassword: 'x', hasCertificateFile: true, nombre: 'Empresa',
    } as never, '2026-09-24T00:00:00.000Z');
    for (const field of ['nextSequenceNumber', 'certificatePassword', 'hasCertificateFile', 'id']) {
      expect(wire).not.toHaveProperty(field);
    }
    expect(COMPANY_DEVICE_LOCAL_FIELDS).toContain('nextSequenceNumber');
    expect(wire).toMatchObject({ nombre: 'Empresa' });
  });

  it('seeds the sequential numeroControl counter above the relay floor', () => {
    const store = setup();
    store.dispatch(seedSequenceFloor({ companyId: 'company_1', floor: 118 }));
    expect(store.getState().companies.companies[0].nextSequenceNumber).toBe(119);
    store.dispatch(seedSequenceFloor({ companyId: 'company_1', floor: 50 }));
    expect(store.getState().companies.companies[0].nextSequenceNumber).toBe(119);
  });
});

describe('Desktop tier gates — Pro+Sync', () => {
  it('device sync is Pro+Sync / Enterprise only', () => {
    expect(canUseDeviceSync(SubscriptionTier.Lite)).toBe(false);
    expect(canUseDeviceSync(SubscriptionTier.AdFree)).toBe(false);
    expect(canUseDeviceSync(SubscriptionTier.Pro)).toBe(false);
    expect(canUseDeviceSync(SubscriptionTier.ProSync)).toBe(true);
    expect(canUseDeviceSync(SubscriptionTier.Enterprise)).toBe(true);
  });

  it('Pro+Sync and Enterprise keep every paid feature', () => {
    for (const tier of [SubscriptionTier.ProSync, SubscriptionTier.Enterprise]) {
      expect(isPaidTier(tier)).toBe(true);
      expect(canUseLibrosIVA(tier)).toBe(true);
      expect(getMaxCompanies(tier)).toBe(Infinity);
    }
    expect(getAppBranding(SubscriptionTier.ProSync)).toBe('Facturas Simples Pro+Sync');
  });
});
