// Product slice - complete implementation

import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { ProductState } from '../../types';
import { Product, StockMovement } from '../../types/product';
import { roundStockQuantity } from '../../services/inventory/invoiceStockRules';
import { applyStockDelta, ledgerOf, ledgerStock, shownStock } from '../../services/sync/stockLedger';
import { generateUuidV4, getCachedDeviceId } from '../../services/sync/deviceId';

// Stock changes are recorded in the product's convergent ledger under this
// device's id (store/index.ts warms the id at start-up; a change in the first
// milliseconds falls back to a per-session id — harmless for the counter).
let sessionDeviceId: string | null = null;
const stockDeviceId = (): string =>
  getCachedDeviceId() ?? (sessionDeviceId ??= `session-${generateUuidV4()}`);

/** Move a tracked product's stock to `newStock` as a local delta in its ledger. */
function setTrackedStock(product: Product, newStock: number): void {
  const ledger = applyStockDelta(ledgerOf(product), stockDeviceId(), newStock - shownStock(product));
  const value = ledgerStock(ledger);
  product.stockLedger = ledger;
  product.stock = value;
  product.stockQuantity = value;
}

const initialState: ProductState = {
  products: [],
  stockMovements: [],
  categories: [],
  brands: [],
  suppliers: [],
  currentProduct: null,
  loading: false,
  error: null,
  searchTerm: '',
  filters: {},
};

function normalizeProduct(product: Product): Product {
  const isService = !!product.isService;
  const trackInventory = !isService && (product.trackInventory ?? product.hasInventory ?? true);
  // Fractional stock (0.5 kg) survives: a floor here dropped the half left by a fractional sale on the next product edit.
  const parsedStock = Math.max(0, roundStockQuantity(product.stockQuantity ?? product.stock ?? 0));
  const threshold = !isService && trackInventory
    ? Math.max(1, Math.floor(product.lowStockThreshold ?? product.minStock ?? 5))
    : undefined;

  return {
    ...product,
    isService,
    trackInventory,
    hasInventory: trackInventory,
    stock: parsedStock,
    stockQuantity: parsedStock,
    lowStockThreshold: threshold,
    minStock: threshold,
  };
}

type InvoiceStockItem = {
  productId: string;
  quantity: number;
  productName?: string;
};

const productSlice = createSlice({
  name: 'products',
  initialState,
  reducers: {
    // Loading states
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    
    // Error handling
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    clearError: (state) => {
      state.error = null;
    },

    // Search and filters
    setSearchTerm: (state, action: PayloadAction<string>) => {
      state.searchTerm = action.payload;
    },
    setFilters: (state, action: PayloadAction<any>) => {
      state.filters = action.payload;
    },

    // Product CRUD operations
    // Local writes stamp updatedAt here: Device Sync v2 resolves conflicts
    // last-writer-wins on updatedAt, so a stale timestamp would lose to every peer.
    addProduct: (state, action: PayloadAction<Product>) => {
      const timestamp = new Date().toISOString();
      const normalized = {
        ...normalizeProduct(action.payload),
        createdAt: action.payload.createdAt || timestamp,
        updatedAt: timestamp,
      };
      state.products.push(normalized);
      
      // Add category if it doesn't exist
      if (normalized.category && !state.categories.includes(normalized.category)) {
        state.categories.push(normalized.category);
      }
    },
    
    updateProduct: (state, action: PayloadAction<Product>) => {
      const index = state.products.findIndex(p => p.id === action.payload.id);
      if (index !== -1) {
        const existing = state.products[index];
        // Strictly newer than the version it replaces: two edits in the same
        // millisecond must still be two LWW versions (and the sync capture can
        // then stamp the outbox with the entity's own updatedAt).
        const nowMs = Date.now();
        const previousMs = existing.updatedAt ? Date.parse(existing.updatedAt) : NaN;
        const stampMs = Number.isFinite(previousMs) && previousMs >= nowMs ? previousMs + 1 : nowMs;
        const normalized: Product = { ...normalizeProduct(action.payload), updatedAt: new Date(stampMs).toISOString() };
        // The stored ledger is authoritative (the payload may carry a copy read
        // before a peer's sale arrived); an edited stock level — product form or
        // "Ajuste de inventario" — becomes a local delta, never an absolute
        // overwrite that would erase another register's unseen sales.
        if (normalized.trackInventory && shownStock(normalized) !== shownStock(existing)) {
          const ledger = applyStockDelta(ledgerOf(existing), stockDeviceId(), shownStock(normalized) - shownStock(existing));
          const value = ledgerStock(ledger);
          normalized.stockLedger = ledger;
          normalized.stock = value;
          normalized.stockQuantity = value;
        } else {
          normalized.stockLedger = existing.stockLedger;
          if (existing.stockLedger) {
            normalized.stock = existing.stock;
            normalized.stockQuantity = existing.stockQuantity;
          }
        }
        state.products[index] = normalized;
        
        // Update category if it doesn't exist
        if (normalized.category && !state.categories.includes(normalized.category)) {
          state.categories.push(normalized.category);
        }
      }
    },
    
    deleteProduct: (state, action: PayloadAction<string>) => {
      state.products = state.products.filter(p => p.id !== action.payload);
    },

    deleteProductsByCompany: (state, action: PayloadAction<string>) => {
      const companyId = action.payload;
      const productIds = new Set(
        state.products.filter((p) => p.companyId === companyId).map((p) => p.id),
      );
      state.products = state.products.filter((p) => p.companyId !== companyId);
      state.stockMovements = state.stockMovements.filter((m) => !productIds.has(m.productId));
      if (state.currentProduct?.companyId === companyId) {
        state.currentProduct = null;
      }
    },

    // Bulk operations
    setProducts: (state, action: PayloadAction<Product[]>) => {
      state.products = action.payload.map(normalizeProduct);

      // UNION with the managed list — replacing it would wipe categories the
      // user created in Configuración ahead of assigning products to them.
      const categories = new Set(state.categories);
      state.products.forEach(product => {
        if (product.category) {
          categories.add(product.category);
        }
      });
      state.categories = Array.from(categories);
    },

    recordStockMovement: (state, action: PayloadAction<StockMovement>) => {
      state.stockMovements.unshift(action.payload);
      // Keep last 5000 entries to cap persisted payload size.
      if (state.stockMovements.length > 5000) {
        state.stockMovements = state.stockMovements.slice(0, 5000);
      }
    },

    applyInvoiceStockDeduction: (
      state,
      action: PayloadAction<{
        invoiceId: string;
        items: InvoiceStockItem[];
        createdAt: string;
        createdBy: string;
      }>
    ) => {
      const { invoiceId, items, createdAt, createdBy } = action.payload;
      // Idempotent per invoice: a second completion of the same invoice (double
      // submit, a re-run contingency batch) must not discharge the stock again —
      // and an invoice whose stock was already restored (Anulada) never
      // discharges again either (its `_in_` movements share the prefix).
      // WHICH invoices discharge is decided by invoiceStockRules
      // (invoiceStockDeductionPayload) before this action is dispatched.
      if (state.stockMovements.some((m) => m.referenceId === invoiceId && m.id.startsWith(`${invoiceId}_`))) {
        return;
      }
      let movementIndex = 0;

      for (const item of items) {
        const product = state.products.find((p) => p.id === item.productId);
        if (!product || product.isService || !product.trackInventory) continue;

        // Fractional quantities (0.5 kg, 2.5 m) are real sales: the old floor()
        // discharged nothing for 0.5 and 2 for 2.5.
        const qty = Math.max(0, roundStockQuantity(item.quantity));
        if (qty <= 0) continue;

        const previousStock = Math.max(0, roundStockQuantity(product.stockQuantity ?? product.stock ?? 0));
        const newStock = Math.max(0, roundStockQuantity(previousStock - qty));
        // The ledger records what actually left (an oversold line clamps at 0),
        // so restoreInvoiceStock puts back exactly that.
        const deducted = roundStockQuantity(previousStock - newStock);
        const movementId = `${invoiceId}_${product.id}_${movementIndex}`;
        movementIndex += 1;

        setTrackedStock(product, newStock);
        product.updatedAt = createdAt;

        const shortfall = roundStockQuantity(qty - deducted);
        state.stockMovements.unshift({
          id: movementId,
          productId: product.id,
          type: 'OUT',
          quantity: deducted,
          previousStock,
          newStock,
          reason: `Salida por factura ${item.productName ? `"${item.productName}"` : ''}${shortfall > 0 ? ` (facturadas ${qty}, ${shortfall} sin stock)` : ''}`.trim(),
          referenceId: invoiceId,
          createdAt,
          createdBy,
        });
      }

      if (state.stockMovements.length > 5000) {
        state.stockMovements = state.stockMovements.slice(0, 5000);
      }
    },

    /**
     * Invalidation (Anulada): put back exactly what this invoice discharged,
     * read from its own OUT movements (`referenceId = invoiceId`). Idempotent —
     * a second dispatch finds the `${invoiceId}_in_` movements and stops. An
     * invoice that never discharged (NC, FSE, POS consolidation, a remission's
     * Factura) has no OUT movements, so nothing moves.
     */
    restoreInvoiceStock: (
      state,
      action: PayloadAction<{
        invoiceId: string;
        createdAt: string;
        createdBy: string;
        reason?: string;
      }>
    ) => {
      const { invoiceId, createdAt, createdBy, reason } = action.payload;
      const outPrefix = `${invoiceId}_`;
      const inPrefix = `${invoiceId}_in_`;
      const own = state.stockMovements.filter((m) => m.referenceId === invoiceId);
      if (own.some((m) => m.id.startsWith(inPrefix))) return;

      const toRestore = new Map<string, number>();
      for (const m of own) {
        if (m.type !== 'OUT' || !m.id.startsWith(outPrefix) || m.id.startsWith(inPrefix)) continue;
        // Older movements may predate the "record what was deducted" rule —
        // previousStock − newStock is what actually left in every version.
        const applied = Number.isFinite(m.previousStock) && Number.isFinite(m.newStock)
          ? m.previousStock - m.newStock
          : m.quantity;
        const qty = Math.max(0, roundStockQuantity(applied));
        if (qty <= 0) continue;
        toRestore.set(m.productId, roundStockQuantity((toRestore.get(m.productId) ?? 0) + qty));
      }

      let movementIndex = 0;
      for (const [productId, qty] of toRestore) {
        const product = state.products.find((p) => p.id === productId);
        if (!product) continue;

        const previousStock = Math.max(0, roundStockQuantity(product.stockQuantity ?? product.stock ?? 0));
        const newStock = roundStockQuantity(previousStock + qty);
        const movementId = `${inPrefix}${productId}_${movementIndex}`;
        movementIndex += 1;

        setTrackedStock(product, newStock);
        product.updatedAt = createdAt;

        state.stockMovements.unshift({
          id: movementId,
          productId,
          type: 'IN',
          quantity: qty,
          previousStock,
          newStock,
          reason: reason ?? 'Reingreso por invalidación de factura',
          referenceId: invoiceId,
          createdAt,
          createdBy,
        });
      }

      if (state.stockMovements.length > 5000) {
        state.stockMovements = state.stockMovements.slice(0, 5000);
      }
    },

    // Current product selection
    setCurrentProduct: (state, action: PayloadAction<Product | null>) => {
      state.currentProduct = action.payload;
    },

    // ── POS tickets: stock discharge / restore ────────────────────────────
    // Mirrors applyInvoiceStockDeduction but references the POS ticket id, so
    // inventory ledgers distinguish counter sales from invoiced sales.
    //
    // Both reducers are idempotent per ticket (a double dispatch — StrictMode,
    // a retried sale, a second void click — changes nothing) and the ledger
    // records what was ACTUALLY moved: an oversold sale (ALLOW mode) clamps the
    // stock at 0 and logs only the deducted units, and a void restores exactly
    // the ticket's own OUT movements — never units that were never there.

    applyTicketStockDeduction: (
      state,
      action: PayloadAction<{
        ticketId: string;
        ticketSequential: number;
        items: InvoiceStockItem[];
        createdAt: string;
        createdBy: string;
      }>
    ) => {
      const { ticketId, ticketSequential, items, createdAt, createdBy } = action.payload;
      const outPrefix = `${ticketId}_`;
      const inPrefix = `${ticketId}_in_`;
      if (state.stockMovements.some((m) =>
        m.referenceId === ticketId && m.type === 'OUT' && m.id.startsWith(outPrefix) && !m.id.startsWith(inPrefix))) {
        return;
      }
      let movementIndex = 0;

      for (const item of items) {
        const product = state.products.find((p) => p.id === item.productId);
        if (!product || product.isService || !product.trackInventory) continue;

        const qty = Math.max(0, roundStockQuantity(Number(item.quantity) || 0));
        if (qty <= 0) continue;

        const previousStock = Math.max(0, roundStockQuantity(product.stockQuantity ?? product.stock ?? 0));
        const newStock = Math.max(0, roundStockQuantity(previousStock - qty));
        const deducted = roundStockQuantity(previousStock - newStock);
        const movementId = `${ticketId}_${product.id}_${movementIndex}`;
        movementIndex += 1;

        setTrackedStock(product, newStock);
        product.updatedAt = createdAt;

        const name = item.productName ? ` "${item.productName}"` : '';
        const shortfall = roundStockQuantity(qty - deducted);
        state.stockMovements.unshift({
          id: movementId,
          productId: product.id,
          type: 'OUT',
          // Logged even when 0 were available: the oversell stays visible in
          // the ledger and anchors the idempotency check.
          quantity: deducted,
          previousStock,
          newStock,
          reason: `Salida por ticket POS #${ticketSequential}${name}${shortfall > 0 ? ` (vendidas ${qty}, ${shortfall} sin stock)` : ''}`,
          referenceId: ticketId,
          createdAt,
          createdBy,
        });
      }

      if (state.stockMovements.length > 5000) {
        state.stockMovements = state.stockMovements.slice(0, 5000);
      }
    },

    restoreTicketStock: (
      state,
      action: PayloadAction<{
        ticketId: string;
        ticketSequential: number;
        items: InvoiceStockItem[];
        createdAt: string;
        createdBy: string;
        /**
         * Units the ticket's partial returns already gave back (per product,
         * from `ticket.returns`): a void after a partial return restores only
         * the remainder (restoreTicketReturnStock restocked the rest).
         */
        returnedItems?: InvoiceStockItem[];
      }>
    ) => {
      const { ticketId, ticketSequential, items, createdAt, createdBy, returnedItems } = action.payload;
      const outPrefix = `${ticketId}_`;
      const inPrefix = `${ticketId}_in_`;
      const own = state.stockMovements.filter((m) => m.referenceId === ticketId);
      if (own.some((m) => m.type === 'IN' && m.id.startsWith(inPrefix))) return;

      // Units to put back per product: the ticket's own OUT movements. Without
      // any (the sale happened on another register and only the ticket synced,
      // or the ledger was trimmed) fall back to the ticket's quantities.
      const outs = own.filter((m) => m.type === 'OUT' && m.id.startsWith(outPrefix) && !m.id.startsWith(inPrefix));
      const toRestore = new Map<string, { quantity: number; productName?: string }>();
      if (outs.length > 0) {
        for (const m of outs) {
          const entry = toRestore.get(m.productId) ?? { quantity: 0 };
          entry.quantity = roundStockQuantity(entry.quantity + Math.max(0, roundStockQuantity(Number(m.quantity) || 0)));
          toRestore.set(m.productId, entry);
        }
      } else {
        for (const item of items) {
          const entry = toRestore.get(item.productId) ?? { quantity: 0, productName: item.productName };
          entry.quantity = roundStockQuantity(entry.quantity + Math.max(0, roundStockQuantity(Number(item.quantity) || 0)));
          toRestore.set(item.productId, entry);
        }
      }
      for (const returned of returnedItems ?? []) {
        const entry = toRestore.get(returned.productId);
        if (!entry) continue;
        entry.quantity = Math.max(0, roundStockQuantity(entry.quantity - Math.max(0, roundStockQuantity(Number(returned.quantity) || 0))));
      }

      let movementIndex = 0;
      for (const [productId, { quantity: qty }] of toRestore) {
        const product = state.products.find((p) => p.id === productId);
        if (!product || product.isService || !product.trackInventory) continue;
        if (qty <= 0) continue;

        const previousStock = Math.max(0, roundStockQuantity(product.stockQuantity ?? product.stock ?? 0));
        const newStock = roundStockQuantity(previousStock + qty);
        const movementId = `${ticketId}_in_${product.id}_${movementIndex}`;
        movementIndex += 1;

        setTrackedStock(product, newStock);
        product.updatedAt = createdAt;

        state.stockMovements.unshift({
          id: movementId,
          productId: product.id,
          type: 'IN',
          quantity: qty,
          previousStock,
          newStock,
          reason: `Anulación ticket POS #${ticketSequential}`,
          referenceId: ticketId,
          createdAt,
          createdBy,
        });
      }

      if (state.stockMovements.length > 5000) {
        state.stockMovements = state.stockMovements.slice(0, 5000);
      }
    },

    /**
     * Partial return (POS Phase 2 design §8): put the returned units of ONE
     * return back in stock. Idempotent per return id (movement referenceId =
     * returnId; ids `${ticketId}_ret_${returnId}_…`). When this device holds
     * the sale's own OUT movements, a product is restocked at most what the
     * sale deducted minus what earlier returns of the ticket already put back
     * (an oversold sale never creates phantom units); without them (the sale
     * was rung on another register) the returned quantities are used.
     */
    restoreTicketReturnStock: (
      state,
      action: PayloadAction<{
        ticketId: string;
        returnId: string;
        ticketSequential: number;
        items: InvoiceStockItem[];
        createdAt: string;
        createdBy: string;
        /** Display label for the ledger reason (e.g. "C1-000123"); defaults to #sequential. */
        ticketLabel?: string;
      }>
    ) => {
      const { ticketId, returnId, ticketSequential, items, createdAt, createdBy, ticketLabel } = action.payload;
      const retPrefix = `${ticketId}_ret_`;
      const ownPrefix = `${retPrefix}${returnId}_`;
      if (state.stockMovements.some((m) => m.referenceId === returnId || m.id.startsWith(ownPrefix))) return;

      const outPrefix = `${ticketId}_`;
      const inPrefix = `${ticketId}_in_`;
      const outs = state.stockMovements.filter((m) =>
        m.referenceId === ticketId && m.type === 'OUT' && m.id.startsWith(outPrefix) && !m.id.startsWith(inPrefix));
      const deducted = new Map<string, number>();
      for (const m of outs) deducted.set(m.productId, roundStockQuantity((deducted.get(m.productId) ?? 0) + Math.max(0, Number(m.quantity) || 0)));
      const alreadyBack = new Map<string, number>();
      for (const m of state.stockMovements) {
        if (m.type === 'IN' && m.id.startsWith(retPrefix)) {
          alreadyBack.set(m.productId, roundStockQuantity((alreadyBack.get(m.productId) ?? 0) + Math.max(0, Number(m.quantity) || 0)));
        }
      }

      const requested = new Map<string, { quantity: number; productName?: string }>();
      for (const item of items) {
        const entry = requested.get(item.productId) ?? { quantity: 0, productName: item.productName };
        entry.quantity = roundStockQuantity(entry.quantity + Math.max(0, roundStockQuantity(Number(item.quantity) || 0)));
        requested.set(item.productId, entry);
      }

      let movementIndex = 0;
      for (const [productId, { quantity: wanted, productName }] of requested) {
        const product = state.products.find((p) => p.id === productId);
        if (!product || product.isService || !product.trackInventory) continue;
        const qty = outs.length > 0
          ? Math.min(wanted, Math.max(0, roundStockQuantity((deducted.get(productId) ?? 0) - (alreadyBack.get(productId) ?? 0))))
          : wanted;
        if (qty <= 0) continue;

        const previousStock = Math.max(0, roundStockQuantity(product.stockQuantity ?? product.stock ?? 0));
        const newStock = roundStockQuantity(previousStock + qty);
        setTrackedStock(product, newStock);
        product.updatedAt = createdAt;

        const name = productName ? ` "${productName}"` : '';
        state.stockMovements.unshift({
          id: `${ownPrefix}${product.id}_${movementIndex}`,
          productId: product.id,
          type: 'IN',
          quantity: qty,
          previousStock,
          newStock,
          reason: `Devolución ticket POS ${ticketLabel ?? `#${ticketSequential}`}${name}`,
          referenceId: returnId,
          createdAt,
          createdBy,
        });
        movementIndex += 1;
      }

      if (state.stockMovements.length > 5000) {
        state.stockMovements = state.stockMovements.slice(0, 5000);
      }
    },

    // Categories management
    addCategory: (state, action: PayloadAction<string>) => {
      if (!state.categories.includes(action.payload)) {
        state.categories.push(action.payload);
      }
    },

    /**
     * Remove a category from the managed list. Refused while any product still
     * uses it (App.ReactNative parity) — the caller must reassign or delete
     * those products first. Returns silently on refusal; the UI derives the
     * same guard to disable the button.
     */
    deleteCategory: (state, action: PayloadAction<string>) => {
      if (state.products.some(p => p.category === action.payload)) return;
      state.categories = state.categories.filter(c => c !== action.payload);
    },

    /**
     * Rename a category in the MANAGED LIST ONLY. Products are NOT touched
     * here on purpose: the caller rewrites each affected product through
     * updateProduct so every change reaches the Device-Sync outbox (bulk
     * edits inside a single custom action would never be captured).
     */
    renameCategory: (state, action: PayloadAction<{ from: string; to: string }>) => {
      const { from, to } = action.payload;
      if (!to || state.categories.includes(to)) return;
      state.categories = state.categories.map(c => (c === from ? to : c));
    },

    // Reset state
    resetProducts: () => initialState,

    // Device Sync v2 relay writes (verbatim, never captured) — see invoiceSlice.syncUpsertInvoice.
    syncUpsertProduct: (state, action: PayloadAction<Product>) => {
      const incoming = action.payload;
      const index = state.products.findIndex(p => p.id === incoming.id);
      if (index === -1) {
        state.products.push(incoming);
      } else {
        state.products[index] = incoming;
      }
      if (incoming.category && !state.categories.includes(incoming.category)) {
        state.categories.push(incoming.category);
      }
      if (state.currentProduct?.id === incoming.id) {
        state.currentProduct = incoming;
      }
    },
    syncRemoveProduct: (state, action: PayloadAction<string>) => {
      state.products = state.products.filter(p => p.id !== action.payload);
      if (state.currentProduct?.id === action.payload) {
        state.currentProduct = null;
      }
    },
  },
});

export const {
  setLoading,
  setError,
  clearError,
  setSearchTerm,
  setFilters,
  addProduct,
  updateProduct,
  deleteProduct,
  deleteProductsByCompany,
  setProducts,
  recordStockMovement,
  applyInvoiceStockDeduction,
  restoreInvoiceStock,
  applyTicketStockDeduction,
  restoreTicketStock,
  restoreTicketReturnStock,
  setCurrentProduct,
  addCategory,
  deleteCategory,
  renameCategory,
  resetProducts,
  syncUpsertProduct,
  syncRemoveProduct,
} = productSlice.actions;

export default productSlice.reducer;
