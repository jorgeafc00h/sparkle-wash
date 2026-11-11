// Catalog selectors for accessing catalog state

import { createSelector } from '@reduxjs/toolkit';
import { RootState } from '../index';
import { GovernmentCatalogId } from '../../types';

// Base selectors
export const selectCatalogs = (state: RootState) => state.catalogs;

// Derived selectors
export const selectAllCatalogs = createSelector(
  [selectCatalogs],
  (catalogs) => catalogs.catalogs
);

export const selectCatalogsLoading = createSelector(
  [selectCatalogs],
  (catalogs) => catalogs.loading
);

export const selectCatalogsError = createSelector(
  [selectCatalogs],
  (catalogs) => catalogs.error
);

export const selectCatalogsSyncInfo = createSelector(
  [selectCatalogs],
  (catalogs) => catalogs.syncInfo
);

export const selectLastFullSync = createSelector(
  [selectCatalogs],
  (catalogs) => catalogs.lastFullSync
);

// Catalog by ID selector factory
export const selectCatalogById = (catalogId: string) => createSelector(
  [selectAllCatalogs],
  (catalogs) => catalogs.find(catalog => catalog.id === catalogId) || null
);

// Specific government catalogs
export const selectMunicipalitiesCatalog = createSelector(
  [selectAllCatalogs],
  (catalogs) => catalogs.find(catalog => catalog.id === GovernmentCatalogId.MUNICIPALITIES) || null
);

export const selectDepartmentsCatalog = createSelector(
  [selectAllCatalogs],
  (catalogs) => catalogs.find(catalog => catalog.id === GovernmentCatalogId.DEPARTMENTS) || null
);

export const selectEconomicActivitiesCatalog = createSelector(
  [selectAllCatalogs],
  (catalogs) => catalogs.find(catalog => catalog.id === GovernmentCatalogId.ECONOMIC_ACTIVITIES) || null
);

export const selectUnitsOfMeasureCatalog = createSelector(
  [selectAllCatalogs],
  (catalogs) => catalogs.find(catalog => catalog.id === GovernmentCatalogId.UNIT_OF_MEASURE) || null
);

export const selectTaxCodesCatalog = createSelector(
  [selectAllCatalogs],
  (catalogs) => catalogs.find(catalog => catalog.id === GovernmentCatalogId.TAX_CODES) || null
);

export const selectItemTypesCatalog = createSelector(
  [selectAllCatalogs],
  (catalogs) => catalogs.find(catalog => catalog.id === GovernmentCatalogId.ITEM_TYPES) || null
);

// Options selectors
export const selectMunicipalities = createSelector(
  [selectMunicipalitiesCatalog],
  (catalog) => catalog?.options || []
);

export const selectDepartments = createSelector(
  [selectDepartmentsCatalog],
  (catalog) => catalog?.options || []
);

export const selectEconomicActivities = createSelector(
  [selectEconomicActivitiesCatalog],
  (catalog) => catalog?.options || []
);

export const selectUnitsOfMeasure = createSelector(
  [selectUnitsOfMeasureCatalog],
  (catalog) => catalog?.options || []
);

export const selectTaxCodes = createSelector(
  [selectTaxCodesCatalog],
  (catalog) => catalog?.options || []
);

export const selectItemTypes = createSelector(
  [selectItemTypesCatalog],
  (catalog) => catalog?.options || []
);

// Municipalities by department selector factory
export const selectMunicipalitiesByDepartment = (departmentCode: string) => createSelector(
  [selectMunicipalities],
  (municipalities) => municipalities.filter(municipality => 
    municipality.departamento === departmentCode
  )
);

// Sync status selectors
export const selectCatalogSyncStatus = (catalogId: string) => createSelector(
  [selectCatalogsSyncInfo],
  (syncInfo) => syncInfo[catalogId] || null
);

export const selectOverallSyncStatus = createSelector(
  [selectCatalogsSyncInfo],
  (syncInfo) => {
    const syncStatuses = Object.values(syncInfo);
    
    if (syncStatuses.length === 0) {
      return 'NOT_SYNCED';
    }
    
    if (syncStatuses.some(status => status.status === 'SYNCING')) {
      return 'SYNCING';
    }
    
    if (syncStatuses.every(status => status.status === 'SUCCESS')) {
      return 'SUCCESS';
    }
    
    if (syncStatuses.some(status => status.status === 'FAILED')) {
      return 'PARTIAL_FAILURE';
    }
    
    return 'UNKNOWN';
  }
);

export const selectCatalogStats = createSelector(
  [selectAllCatalogs],
  (catalogs) => {
    const totalCatalogs = catalogs.length;
    const totalOptions = catalogs.reduce((sum, catalog) => sum + catalog.options.length, 0);
    const avgOptionsPerCatalog = totalCatalogs > 0 ? Math.round(totalOptions / totalCatalogs) : 0;
    
    const catalogsBySize = catalogs.map(catalog => ({
      id: catalog.id,
      name: catalog.name,
      optionsCount: catalog.options.length,
    })).sort((a, b) => b.optionsCount - a.optionsCount);
    
    return {
      totalCatalogs,
      totalOptions,
      avgOptionsPerCatalog,
      largestCatalog: catalogsBySize[0] || null,
      smallestCatalog: catalogsBySize[catalogsBySize.length - 1] || null,
    };
  }
);

// Check if catalogs are available
export const selectHasCatalogs = createSelector(
  [selectAllCatalogs],
  (catalogs) => catalogs.length > 0
);

// Check if sync is needed (catalogs are old or missing)
export const selectNeedsSync = createSelector(
  [selectLastFullSync, selectAllCatalogs],
  (lastSync, catalogs) => {
    if (catalogs.length === 0) return true;
    
    if (!lastSync) return true;
    
    // Check if last sync was more than 24 hours ago
    const lastSyncDate = new Date(lastSync);
    const hoursSinceLastSync = (Date.now() - lastSyncDate.getTime()) / (1000 * 60 * 60);
    return hoursSinceLastSync > 24;
  }
);

// Search and filter selectors
export const selectCatalogsSearchTerm = createSelector(
  [selectCatalogs],
  (catalogs) => catalogs.searchTerm
);

export const selectCatalogsFilters = createSelector(
  [selectCatalogs],
  (catalogs) => catalogs.filters
);

export const selectFilteredCatalogs = createSelector(
  [selectAllCatalogs, selectCatalogsSearchTerm, selectCatalogsFilters],
  (catalogs, searchTerm, filters) => {
    let filteredCatalogs = [...catalogs];

    // Apply search term
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filteredCatalogs = filteredCatalogs.filter(catalog =>
        catalog.name.toLowerCase().includes(term) ||
        catalog.id.toLowerCase().includes(term) ||
        catalog.description?.toLowerCase().includes(term)
      );
    }

    // Apply filters
    if (filters.isActive !== undefined) {
      filteredCatalogs = filteredCatalogs.filter(catalog =>
        catalog.isActive === filters.isActive
      );
    }

    if (filters.hasOptions !== undefined) {
      const hasOptions = filters.hasOptions;
      filteredCatalogs = filteredCatalogs.filter(catalog =>
        hasOptions ? catalog.options.length > 0 : catalog.options.length === 0
      );
    }

    return filteredCatalogs;
  }
);

// Critical catalogs check (required for DTE generation)
export const selectCriticalCatalogsAvailable = createSelector(
  [selectAllCatalogs],
  (catalogs) => {
    const criticalCatalogIds = [
      GovernmentCatalogId.MUNICIPALITIES,
      GovernmentCatalogId.DEPARTMENTS,
      GovernmentCatalogId.UNIT_OF_MEASURE,
      GovernmentCatalogId.TAX_CODES,
      GovernmentCatalogId.ITEM_TYPES,
    ];

    const availableCriticalCatalogs = criticalCatalogIds.filter(id =>
      catalogs.some(catalog => catalog.id === id && catalog.options.length > 0)
    );

    return {
      available: availableCriticalCatalogs.length,
      total: criticalCatalogIds.length,
      isComplete: availableCriticalCatalogs.length === criticalCatalogIds.length,
      missing: criticalCatalogIds.filter(id => !availableCriticalCatalogs.includes(id)),
    };
  }
);