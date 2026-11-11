/**
 * Product categories — managed-list reducers (2026-09 category filter work).
 *
 * Categories are a plain string on each product (App.ReactNative parity), so
 * they sync inside the product payload; what these tests pin down is the
 * managed picker list: auto-add on save, union on hydration (user-created
 * empty categories survive), and the delete/rename guards.
 */

import reducer, {
  addProduct,
  updateProduct,
  setProducts,
  addCategory,
  deleteCategory,
  renameCategory,
  syncUpsertProduct,
} from '../../store/slices/productSlice';
import { ProductState } from '../../types';
import { Product, UnitOfMeasure, TaxCategory, ProductStatus } from '../../types/product';

const baseProduct = (overrides: Partial<Product> = {}): Product => ({
  id: 'prod_x',
  productName: 'Cable HDMI',
  unitPrice: 9.5,
  unitOfMeasure: UnitOfMeasure.UNIDAD,
  taxCategory: TaxCategory.GRAVADO,
  status: ProductStatus.Active,
  companyId: 'co1',
  isActive: true,
  createdAt: '2026-09-28T00:00:00.000Z',
  updatedAt: '2026-09-28T00:00:00.000Z',
  ...overrides,
});

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

describe('product categories — managed list', () => {
  it('auto-adds the category when a product is created or updated', () => {
    let state = reducer(initialState, addProduct(baseProduct({ category: 'Accesorios' })));
    expect(state.categories).toEqual(['Accesorios']);

    state = reducer(state, updateProduct(baseProduct({ id: 'prod_x', category: 'Cables' })));
    expect(state.categories).toEqual(['Accesorios', 'Cables']);
  });

  it('keeps categories added ahead of use when hydrated (setProducts unions)', () => {
    // The user creates "Bebidas" in Configuración before any product uses it.
    let state = reducer(initialState, addCategory('Bebidas'));
    // Later, a sync/hydration lands products with their own categories.
    state = reducer(
      state,
      setProducts([baseProduct({ id: 'p1', category: 'Accesorios' }), baseProduct({ id: 'p2' })]),
    );
    expect(state.categories).toContain('Bebidas'); // not wiped by hydration
    expect(state.categories).toContain('Accesorios'); // derived from products
  });

  it('refuses to delete a category while any product uses it', () => {
    let state = reducer(initialState, setProducts([baseProduct({ category: 'Accesorios' })]));
    state = reducer(state, deleteCategory('Accesorios'));
    expect(state.categories).toContain('Accesorios');
    expect(state.products[0].category).toBe('Accesorios');

    state = reducer(state, setProducts([]));
    state = reducer(state, deleteCategory('Accesorios'));
    expect(state.categories).not.toContain('Accesorios');
  });

  it('renames the managed list WITHOUT touching products (caller rewrites via updateProduct)', () => {
    let state = reducer(initialState, setProducts([baseProduct({ category: 'Accesorios' })]));
    state = reducer(state, renameCategory({ from: 'Accesorios', to: 'Cables' }));
    expect(state.categories).toEqual(['Cables']);
    // Deliberate: bulk edits inside one action would never reach the sync
    // outbox — the settings page rewrites products with updateProduct instead.
    expect(state.products[0].category).toBe('Accesorios');
  });

  it('ignores a rename onto an existing name', () => {
    let state = reducer(initialState, setProducts([baseProduct({ id: 'p1', category: 'A' }), baseProduct({ id: 'p2', category: 'B' })]));
    state = reducer(state, renameCategory({ from: 'A', to: 'B' }));
    expect(state.categories).toEqual(['A', 'B']);
  });

  it('learns categories from Device-Sync relay writes', () => {
    const state = reducer(
      initialState,
      syncUpsertProduct(baseProduct({ id: 'peer-1', category: 'Repuestos' })),
    );
    expect(state.categories).toContain('Repuestos');
  });
});
