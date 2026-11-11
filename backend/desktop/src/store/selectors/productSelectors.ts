// Product selectors - placeholder for Phase 2

import { createSelector } from '@reduxjs/toolkit';
import { RootState } from '../index';

export const selectProducts = (state: RootState) => state.products;

export const selectAllProducts = createSelector(
  [selectProducts],
  (products) => products.products
);

export const selectStockMovements = createSelector(
  [selectProducts],
  (products) => products.stockMovements
);

export const selectProductStockMovements = (productId: string) =>
  createSelector([selectStockMovements], (movements) =>
    movements.filter((movement) => movement.productId === productId)
  );

export const selectCurrentProduct = createSelector(
  [selectProducts],
  (products) => products.currentProduct
);

export const selectProductsLoading = createSelector(
  [selectProducts],
  (products) => products.loading
);

export const selectProductsError = createSelector(
  [selectProducts],
  (products) => products.error
);

// ✅ OPTIMIZED: Current company's products
// Returns all products when no company is selected (single-company users)
export const selectCurrentCompanyProducts = createSelector(
  [selectAllProducts, (state: RootState) => state.companies.selectedCompanyId],
  (products, selectedCompanyId) =>
    selectedCompanyId
      ? products.filter((product) => product.companyId === selectedCompanyId)
      : products
);

// ✅ OPTIMIZED: Company-specific products selector
export const selectProductsByCompanyId = (companyId: string) =>
  createSelector([selectAllProducts], (products) =>
    products.filter((product) => product.companyId === companyId)
  );
