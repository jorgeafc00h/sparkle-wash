// Local audit trail — every local write is credited to the user operating the
// app; relay writes, bookkeeping and stock side effects are not. The audit lives
// in its own slice, so the entities (and therefore Sync payloads) never change.

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

import { configureStore } from '@reduxjs/toolkit';
import invoiceReducer, { addInvoice, deleteInvoice, syncUpsertInvoice, updateInvoice } from '@/store/slices/invoiceSlice';
import customerReducer, { addCustomer, updateCustomer } from '@/store/slices/customerSlice';
import productReducer, { addProduct, applyTicketStockDeduction, updateProduct } from '@/store/slices/productSlice';
import localUsersReducer, {
  addLocalUser,
  enableLocalUsers,
  lockLocalSession,
  unlockLocalUser,
  updateLocalUser,
} from '@/store/slices/localUsersSlice';
import auditReducer, { AUDIT_EVENT_LIMIT, auditKey, recordAuditEvents } from '@/store/slices/auditSlice';
import {
  auditCaptureMiddleware,
  computeCollectionAudit,
  describeCompraChange,
  describeTicketChange,
  type AuditCaptureState,
} from '@/services/localUsers/auditCapture';
import { InvoiceStatus, InvoiceType, type Invoice } from '@/types/invoice';
import type { Product } from '@/types/product';
import type { CreateCustomerInput } from '@/types/customer';

const OWNER = { googleUserId: 'g-1', email: 'owner@gmail.com', name: 'Jorge Owner' };

const authUser = {
  id: 'g-1',
  email: 'owner@gmail.com',
  firstName: 'Jorge',
  lastName: 'Owner',
  isEmailVerified: true,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const makeStore = (withGoogleUser = true) =>
  configureStore({
    reducer: {
      auth: (state = { user: withGoogleUser ? authUser : null }) => state,
      companies: (state = { companies: [] }) => state,
      invoices: invoiceReducer,
      customers: customerReducer,
      products: productReducer,
      localUsers: localUsersReducer,
      audit: auditReducer,
    },
    middleware: (getDefault) => getDefault({ serializableCheck: false, immutableCheck: false }).concat(auditCaptureMiddleware),
  });

type Store = ReturnType<typeof makeStore>;

const newInvoice = (store: Store): Invoice => {
  store.dispatch(
    addInvoice({
      invoiceNumber: '00042',
      date: '2026-10-07',
      invoiceType: InvoiceType.Factura,
      companyId: 'co1',
      items: [{ quantity: 2, productId: 'p1', productName: 'Café', unitPrice: 5 }],
    }),
  );
  return store.getState().invoices.invoices[0];
};

const product = (overrides: Partial<Product> = {}): Product =>
  ({
    id: 'p1',
    productName: 'Café',
    unitPrice: 5,
    companyId: 'co1',
    isActive: true,
    stock: 10,
    stockQuantity: 10,
    trackInventory: true,
    createdAt: '2026-10-07T00:00:00.000Z',
    updatedAt: '2026-10-07T00:00:00.000Z',
    ...overrides,
  }) as Product;

/** Owner enables user control, creates Ana (cashier) and Ana signs in. */
const withAnaSignedIn = (store: Store) => {
  store.dispatch(enableLocalUsers({ owner: OWNER, pin: '1234' }));
  store.dispatch(addLocalUser({ displayName: 'Ana Pérez', username: 'ana', pin: '5555', permissions: ['invoices.view', 'invoices.create'] }));
  store.dispatch(lockLocalSession());
  const ana = store.getState().localUsers.users.find((user) => user.username === 'ana')!;
  expect(unlockLocalUser(ana.id, '5555')(store.dispatch, store.getState)).toBe(true);
  return ana;
};

const stampOf = (store: Store, type: 'invoice' | 'customer' | 'product', id: string) =>
  store.getState().audit.stamps[auditKey(type, id)];

describe('who created / modified each record', () => {
  it('credits invoice creation and edits to the signed-in local user', () => {
    const store = makeStore();
    const ana = withAnaSignedIn(store);
    const invoice = newInvoice(store);

    expect(stampOf(store, 'invoice', invoice.id)).toMatchObject({
      createdBy: { id: ana.id, name: 'Ana Pérez', role: 'user' },
      updatedBy: { id: ana.id },
    });
    expect(store.getState().audit.events[0]).toMatchObject({
      action: 'create',
      entityType: 'invoice',
      entityId: invoice.id,
      companyId: 'co1',
      entityLabel: 'Factura #00042',
      actor: { name: 'Ana Pérez' },
    });

    // The admin signs in and transmits it: creator stays Ana, last modifier is the admin.
    store.dispatch(lockLocalSession());
    const admin = store.getState().localUsers.users.find((user) => user.role === 'admin')!;
    unlockLocalUser(admin.id, '1234')(store.dispatch, store.getState);
    store.dispatch(updateInvoice({ id: invoice.id, status: InvoiceStatus.Completada }));

    const stamp = stampOf(store, 'invoice', invoice.id);
    expect(stamp.createdBy?.name).toBe('Ana Pérez');
    expect(stamp.updatedBy).toMatchObject({ id: admin.id, role: 'admin' });
    expect(store.getState().audit.events[0]).toMatchObject({ action: 'status', summary: 'Transmitió a Hacienda (Completada)' });
  });

  it('does not touch the entity itself (sync payloads stay identical)', () => {
    const store = makeStore();
    withAnaSignedIn(store);
    const invoice = newInvoice(store);
    expect(Object.keys(invoice)).not.toEqual(expect.arrayContaining(['createdBy']));
    expect(JSON.stringify(invoice)).not.toContain('Ana');
  });

  it('ignores transient/bookkeeping writes and relay writes', () => {
    const store = makeStore();
    withAnaSignedIn(store);
    const invoice = newInvoice(store);
    const before = store.getState().audit.events.length;

    store.dispatch(updateInvoice({ id: invoice.id, status: InvoiceStatus.Sincronizando }));
    store.dispatch(updateInvoice({ id: invoice.id, controlNumber: 'DTE-01-0001', generationCode: 'ABC' } as never));
    store.dispatch(syncUpsertInvoice({ ...invoice, observaciones: 'from phone', updatedAt: '2030-01-01T00:00:00.000Z' }));
    expect(store.getState().audit.events).toHaveLength(before);

    store.dispatch(updateInvoice({ id: invoice.id, observaciones: 'Entregar el lunes' }));
    expect(store.getState().audit.events).toHaveLength(before + 1);
    expect(store.getState().audit.events[0]).toMatchObject({ action: 'update', summary: 'Editó el documento' });
  });

  it('logs deletions and drops the stamp', () => {
    const store = makeStore();
    withAnaSignedIn(store);
    const invoice = newInvoice(store);
    store.dispatch(deleteInvoice(invoice.id));
    expect(stampOf(store, 'invoice', invoice.id)).toBeUndefined();
    expect(store.getState().audit.events[0]).toMatchObject({ action: 'delete', entityId: invoice.id, summary: 'Eliminó Factura #00042' });
  });

  it('audits customers and products, classifying stock-only product edits', () => {
    const store = makeStore();
    const ana = withAnaSignedIn(store);

    store.dispatch(addCustomer({
      firstName: 'Luis',
      lastName: 'Gómez',
      nationalId: '01234567-8',
      nit: '',
      email: 'luis@example.com',
      phone: '7777-1111',
      companyId: 'co1',
    } as unknown as CreateCustomerInput));
    const customer = store.getState().customers.customers.at(-1)!;
    expect(stampOf(store, 'customer', customer.id)?.createdBy?.id).toBe(ana.id);
    store.dispatch(updateCustomer({ id: customer.id, phone: '7777-0000' } as never));
    expect(store.getState().audit.events[0]).toMatchObject({ entityType: 'customer', action: 'update' });

    store.dispatch(addProduct(product()));
    store.dispatch(updateProduct(product({ stock: 7, stockQuantity: 7, updatedAt: '2026-10-07T01:00:00.000Z' })));
    expect(store.getState().audit.events[0]).toMatchObject({ entityType: 'product', action: 'stock', summary: 'Ajustó inventario: 10 → 7' });
    store.dispatch(updateProduct(product({ stock: 7, stockQuantity: 7, unitPrice: 6 })));
    expect(store.getState().audit.events[0]).toMatchObject({ entityType: 'product', action: 'update' });

    // Sale side effects are not separate audit events.
    const count = store.getState().audit.events.length;
    store.dispatch(applyTicketStockDeduction({ ticketId: 't1', ticketSequential: 1, items: [{ productId: 'p1', quantity: 1 }], createdAt: 'x', createdBy: 'POS' }));
    expect(store.getState().audit.events).toHaveLength(count);
  });

  it('credits the Gmail account when user control is off', () => {
    const store = makeStore();
    const invoice = newInvoice(store);
    expect(stampOf(store, 'invoice', invoice.id)?.createdBy).toEqual({ id: 'google:g-1', name: 'Jorge Owner', role: 'admin' });

    const guest = makeStore(false);
    const guestInvoice = newInvoice(guest);
    expect(stampOf(guest, 'invoice', guestInvoice.id)?.createdBy?.name).toBe('Usuario principal');
  });
});

describe('user management and sign-ins', () => {
  it('logs enabling, user creation, permission changes, sign-ins and failed PINs', () => {
    const store = makeStore();
    const ana = withAnaSignedIn(store);
    unlockLocalUser(ana.id, '0000')(store.dispatch, store.getState);
    store.dispatch(lockLocalSession());
    const admin = store.getState().localUsers.users.find((user) => user.role === 'admin')!;
    unlockLocalUser(admin.id, '1234')(store.dispatch, store.getState);
    store.dispatch(updateLocalUser({ id: ana.id, permissions: ['pos.sell'] }));

    const log = store.getState().audit.events.map((event) => `${event.actor.name}: ${event.summary}`).reverse();
    expect(log).toEqual([
      'Jorge Owner: Activó el control de usuarios',
      'Jorge Owner: Creó el usuario Ana Pérez (@ana)',
      'Jorge Owner: Cerró sesión',
      'Ana Pérez: Inició sesión',
      'Ana Pérez: Intento de acceso con PIN incorrecto',
      'Ana Pérez: Cerró sesión',
      'Jorge Owner: Inició sesión',
      'Jorge Owner: Cambió los permisos',
    ]);
    // Sessions don't stamp the user record; management actions do.
    expect(store.getState().audit.stamps[auditKey('user' as never, ana.id)]?.updatedBy?.name).toBe('Jorge Owner');
  });
});

describe('ticket and compra events', () => {
  const ticketEvent = { op: 'upsert' as const, id: 't1', companyId: 'co1', updatedAt: 'x', sequential: 12, totalAmount: 9.5 };

  it('describes sales, voids and skips bookkeeping', () => {
    expect(describeTicketChange({ ...ticketEvent, status: 'COMPLETED', kind: 'create' })).toEqual({ action: 'create', summary: 'Registró la venta ticket #12 por $9.50' });
    expect(describeTicketChange({ ...ticketEvent, status: 'VOID', kind: 'void' })).toEqual({ action: 'void', summary: 'Anuló el ticket #12' });
    expect(describeTicketChange({ ...ticketEvent, status: 'COMPLETED', kind: 'print' })).toBeNull();
    expect(describeTicketChange({ ...ticketEvent, status: 'CONSOLIDATED', kind: 'consolidate' })).toBeNull();
    expect(describeTicketChange({ ...ticketEvent, status: 'COMPLETED' })).toBeNull();
  });

  it('describes compras by supplier', () => {
    const event = { op: 'upsert' as const, id: 'c1', companyId: 'co1', updatedAt: 'x', emisorNombre: 'Distribuidora SV' };
    expect(describeCompraChange({ ...event, kind: 'create' })).toEqual({ action: 'create', summary: 'Registró la compra de Distribuidora SV' });
    expect(describeCompraChange({ ...event, op: 'delete', kind: 'delete' })?.action).toBe('delete');
  });
});

describe('review hardening', () => {
  const actor = { id: 'lu_ana', name: 'Ana', role: 'user' as const };

  it('background email imports are labelled as imports and their auto-verify re-save is not logged', () => {
    const event = { op: 'upsert' as const, id: 'c1', companyId: 'co1', updatedAt: 'x', emisorNombre: 'Distribuidora SV', origin: 'import' as const };
    expect(describeCompraChange({ ...event, kind: 'create' })).toEqual({ action: 'create', summary: 'Importó del correo la compra de Distribuidora SV' });
    expect(describeCompraChange({ ...event, kind: 'update' })).toBeNull();
    // The same verification triggered by a person is still an edit.
    expect(describeCompraChange({ ...event, origin: 'user', kind: 'update' })?.action).toBe('update');
  });

  it('tickets and cash closings are log-only — no per-record stamps', () => {
    const store = makeStore();
    store.dispatch(recordAuditEvents([
      { actor, action: 'create', entityType: 'ticket', entityId: 't1', summary: 'venta' },
      { actor, action: 'create', entityType: 'closing', entityId: 'z1', summary: 'cierre Z' },
    ]));
    expect(store.getState().audit.events).toHaveLength(2);
    expect(store.getState().audit.stamps).toEqual({});
  });

  it('company selection/default flips and credential-test timestamps are not configuration edits', () => {
    const company = { id: 'co1', nombreComercial: 'K Labs', isDefault: false, updatedAt: 'a' } as never as AuditCaptureState['companies']['companies'][number];
    const state = (companies: unknown[]) => ({ companies: { companies } }) as unknown as AuditCaptureState;
    const bookkeeping = { ...company, isDefault: true, credentialsLastTestedAt: 'now', updatedAt: 'b' };
    expect(computeCollectionAudit(state([company]), state([bookkeeping]), 'company', actor)).toEqual([]);
    const edited = { ...company, telefono: '2222-0000', updatedAt: 'b' };
    expect(computeCollectionAudit(state([company]), state([edited]), 'company', actor)).toEqual([
      expect.objectContaining({ action: 'update', entityType: 'company', summary: 'Actualizó la configuración de la empresa' }),
    ]);
  });
});

describe('log retention', () => {
  it('keeps the newest AUDIT_EVENT_LIMIT events', () => {
    const store = makeStore();
    const actor = { id: 'a', name: 'A', role: 'user' as const };
    const batch = Array.from({ length: AUDIT_EVENT_LIMIT + 5 }, (_, i) => ({
      actor,
      action: 'update' as const,
      entityType: 'product' as const,
      entityId: `p${i}`,
      summary: `edit ${i}`,
    }));
    store.dispatch(recordAuditEvents(batch));
    const events = store.getState().audit.events;
    expect(events).toHaveLength(AUDIT_EVENT_LIMIT);
    expect(events[0].summary).toBe(`edit ${AUDIT_EVENT_LIMIT + 4}`);
  });
});
