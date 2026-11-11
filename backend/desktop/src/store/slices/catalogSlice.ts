// Catalog slice for government catalog management

import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { CatalogState, Catalog, CatalogSyncInfo } from '../../types';
import { getCatalogService } from '../../services/api/CatalogService';

// Initial state
const initialState: CatalogState = {
  catalogs: [],
  syncInfo: {},
  loading: false,
  error: null,
  lastFullSync: undefined,
  searchTerm: '',
  filters: {},
};

// Async thunks
export const syncCatalogs = createAsyncThunk(
  'catalogs/syncCatalogs',
  async (params: { force?: boolean } = {}, { rejectWithValue, getState }) => {
    try {
      const catalogService = getCatalogService();
      
      // Check if sync is needed (unless forced)
      if (!params?.force) {
        const shouldSync = await catalogService.shouldSync();
        
        // Also check if we have catalogs in Redux store
        const state = getState() as any;
        const hasLocalCatalogs = state.catalogs.catalogs.length > 0;
        
        if (!shouldSync && hasLocalCatalogs) {
          console.log('📋 CatalogService: Catalogs are up to date, skipping sync');
          // Return empty result instead of throwing error
          return {
            catalogs: [],
            syncDate: new Date().toISOString(),
            skipped: true,
          };
        }
      }

      const catalogs = await catalogService.getCatalogs();
      
      // Update last sync date after successful fetch
      await catalogService.updateLastSyncDate();
      
      return {
        catalogs,
        syncDate: new Date().toISOString(),
      };
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to sync catalogs');
    }
  }
);

export const fetchCatalogById = createAsyncThunk(
  'catalogs/fetchCatalogById',
  async (catalogId: string, { rejectWithValue }) => {
    try {
      const catalogService = getCatalogService();
      const catalog = await catalogService.getCatalogById(catalogId);
      
      if (!catalog) {
        throw new Error(`Catalog ${catalogId} not found`);
      }
      
      return catalog;
    } catch (error: any) {
      return rejectWithValue(error.message || `Failed to fetch catalog ${catalogId}`);
    }
  }
);

export const searchCatalogOptions = createAsyncThunk(
  'catalogs/searchCatalogOptions',
  async (
    { catalogId, searchTerm, departamento }: {
      catalogId: string;
      searchTerm: string;
      departamento?: string;
    },
    { rejectWithValue }
  ) => {
    try {
      const catalogService = getCatalogService();
      const options = await catalogService.searchCatalogOptions(catalogId, searchTerm, departamento);
      
      return {
        catalogId,
        options,
        searchTerm,
        departamento,
      };
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to search catalog options');
    }
  }
);

export const getCatalogStats = createAsyncThunk(
  'catalogs/getCatalogStats',
  async (_, { rejectWithValue }) => {
    try {
      const catalogService = getCatalogService();
      const stats = await catalogService.getCatalogStats();
      
      return stats;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to get catalog stats');
    }
  }
);

export const loadCatalogsIntelligently = createAsyncThunk(
  'catalogs/loadCatalogsIntelligently',
  async (params: { isProduction?: boolean; force?: boolean } = {}, { rejectWithValue, getState, dispatch }) => {
    try {
      const catalogService = getCatalogService(params.isProduction);
      const state = getState() as any;
      const hasLocalCatalogs = state.catalogs.catalogs.length > 0;
      
      console.log('📋 CatalogSlice: Loading catalogs intelligently');
      console.log(`📋 Local catalogs available: ${hasLocalCatalogs}`);
      
      // Check if sync is needed (unless forced)
      if (!params?.force) {
        const shouldSync = await catalogService.shouldSync();
        
        if (!shouldSync && hasLocalCatalogs) {
          console.log('📋 CatalogSlice: Using cached catalogs, no sync needed');
          return {
            catalogs: state.catalogs.catalogs,
            syncDate: state.catalogs.lastFullSync || new Date().toISOString(),
            fromCache: true
          };
        }
      }
      
      // Sync needed or forced
      console.log('📋 CatalogSlice: Fetching fresh catalogs from API');
      const freshCatalogs = await catalogService.getCatalogs();
      
      // Update last sync date after successful fetch
      await catalogService.updateLastSyncDate();
      
      return {
        catalogs: freshCatalogs,
        syncDate: new Date().toISOString(),
        fromCache: false
      };
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to load catalogs');
    }
  }
);

// Slice
const catalogSlice = createSlice({
  name: 'catalogs',
  initialState,
  reducers: {
    // Clear error
    clearError: (state) => {
      state.error = null;
    },
    
    // Set search term
    setSearchTerm: (state, action: PayloadAction<string>) => {
      state.searchTerm = action.payload;
    },
    
    // Set filters
    setFilters: (state, action: PayloadAction<CatalogState['filters']>) => {
      state.filters = action.payload;
    },
    
    // Update sync info for a specific catalog
    updateSyncInfo: (state, action: PayloadAction<CatalogSyncInfo>) => {
      state.syncInfo[action.payload.catalogId] = action.payload;
    },
    
    // Mark catalog sync as started
    startCatalogSync: (state, action: PayloadAction<string>) => {
      const catalogId = action.payload;
      state.syncInfo[catalogId] = {
        catalogId,
        lastSyncDate: new Date().toISOString(),
        status: 'SYNCING',
        recordCount: 0,
      };
    },
    
    // Mark catalog sync as completed
    completeCatalogSync: (state, action: PayloadAction<{ catalogId: string; recordCount: number }>) => {
      const { catalogId, recordCount } = action.payload;
      if (state.syncInfo[catalogId]) {
        state.syncInfo[catalogId].status = 'SUCCESS';
        state.syncInfo[catalogId].recordCount = recordCount;
      }
    },
    
    // Mark catalog sync as failed
    failCatalogSync: (state, action: PayloadAction<{ catalogId: string; error: string }>) => {
      const { catalogId, error } = action.payload;
      if (state.syncInfo[catalogId]) {
        state.syncInfo[catalogId].status = 'FAILED';
        state.syncInfo[catalogId].error = error;
      }
    },
    
    // Reset catalog state
    resetCatalogs: (state) => {
      Object.assign(state, initialState);
    },
    
    // Cache catalogs locally (for offline access)
    cacheCatalogs: (state, action: PayloadAction<Catalog[]>) => {
      state.catalogs = action.payload;
      state.lastFullSync = new Date().toISOString();
      console.log('📋 Cached catalogs locally:', action.payload.length);
    },
    
    // Check if catalogs are available offline
    checkOfflineAvailability: (state) => {
      // Update availability based on existing catalogs
      const isAvailable = state.catalogs.length > 0;
      console.log(`📱 Catalogs offline availability: ${isAvailable}`);
    },
  },
  extraReducers: (builder) => {
    // Sync catalogs
    builder
      .addCase(syncCatalogs.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(syncCatalogs.fulfilled, (state, action) => {
        state.loading = false;
        
        // Only update catalogs if we actually fetched new data (not skipped)
        if (!action.payload.skipped) {
          state.catalogs = action.payload.catalogs;
          state.lastFullSync = action.payload.syncDate;
          
          // Update sync info for all catalogs
          action.payload.catalogs.forEach((catalog: Catalog) => {
            state.syncInfo[catalog.id] = {
              catalogId: catalog.id,
              lastSyncDate: action.payload.syncDate,
              status: 'SUCCESS',
              recordCount: catalog.options.length,
            };
          });
        }
      })
      .addCase(syncCatalogs.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });

    // Fetch catalog by ID
    builder
      .addCase(fetchCatalogById.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchCatalogById.fulfilled, (state, action) => {
        state.loading = false;
        
        // Update or add catalog
        const existingIndex = state.catalogs.findIndex(c => c.id === action.payload.id);
        if (existingIndex !== -1) {
          state.catalogs[existingIndex] = action.payload;
        } else {
          state.catalogs.push(action.payload);
        }
      })
      .addCase(fetchCatalogById.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });

    // Search catalog options
    builder
      .addCase(searchCatalogOptions.fulfilled, (state, action) => {
        // Update catalog with search results
        const { catalogId, options } = action.payload;
        const catalog = state.catalogs.find(c => c.id === catalogId);
        
        if (catalog) {
          // Store search results (could be used for caching search results)
          console.log(`Search completed for ${catalogId}: ${options.length} results`);
        }
      });

    // Get catalog stats
    builder
      .addCase(getCatalogStats.fulfilled, (state, action) => {
        const stats = action.payload;
        
        // Update record counts in sync info
        Object.entries(stats).forEach(([catalogId, count]) => {
          if (state.syncInfo[catalogId]) {
            state.syncInfo[catalogId].recordCount = count;
          }
        });
      });

    // Load catalogs intelligently (cache-aware)
    builder
      .addCase(loadCatalogsIntelligently.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(loadCatalogsIntelligently.fulfilled, (state, action) => {
        state.loading = false;
        
        if (action.payload.fromCache) {
          console.log('📋 CatalogSlice: Loaded from cache');
        } else {
          console.log('📋 CatalogSlice: Loaded fresh data from API');
          state.catalogs = action.payload.catalogs;
          state.lastFullSync = action.payload.syncDate;
          
          // Update sync info for all catalogs
          action.payload.catalogs.forEach((catalog: Catalog) => {
            state.syncInfo[catalog.id] = {
              catalogId: catalog.id,
              lastSyncDate: action.payload.syncDate,
              status: 'SUCCESS',
              recordCount: catalog.options.length,
            };
          });
        }
      })
      .addCase(loadCatalogsIntelligently.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });
  },
});

// Actions
export const {
  clearError,
  setSearchTerm,
  setFilters,
  updateSyncInfo,
  startCatalogSync,
  completeCatalogSync,
  failCatalogSync,
  resetCatalogs,
  cacheCatalogs,
  checkOfflineAvailability,
} = catalogSlice.actions;

// Note: loadCatalogsIntelligently is exported above with createAsyncThunk

// Selectors
export const selectCatalogs = (state: any) => state.catalogs.catalogs;
export const selectCatalogById = (state: any, catalogId: string) => 
  state.catalogs.catalogs.find((catalog: Catalog) => catalog.id === catalogId);
export const selectCatalogsAvailableOffline = (state: any) => 
  state.catalogs.catalogs.length > 0;
export const selectLastFullSync = (state: any) => state.catalogs.lastFullSync;
export const selectCatalogLoading = (state: any) => state.catalogs.loading;

export default catalogSlice.reducer;