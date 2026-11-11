// Company slice for multi-company management

import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { getMhClient } from '@/services/api/MhClient';
import { CompanyState, Company, CreateCompanyInput, UpdateCompanyInput, CompanyEnvironment, CompanyStatus } from '../../types';

// Initial state
const initialState: CompanyState = {
  companies: [],
  currentCompany: null,
  selectedCompanyId: null,
  companySettings: null,
  companyStats: null,
  loading: false,
  error: null,
  searchTerm: '',
  filters: {},
};

// Async thunks
export const fetchCompanies = createAsyncThunk(
  'companies/fetchCompanies',
  async (params: { refresh?: boolean } = {}, { rejectWithValue, getState }) => {
    try {
      // TODO: Implement actual API call when backend is ready
      // const companiesService = getCompaniesService();
      // const companies = await companiesService.getCompanies();
      
      // For now, companies are persisted by redux-persist
      // Return current state companies (redux-persist handles storage)
      const state = getState() as { companies: CompanyState };
      const existingCompanies = state.companies.companies;
      
      console.log('CompanySlice: fetchCompanies returning companies:', existingCompanies.length);
      return existingCompanies;
    } catch (error: any) {
      console.error('CompanySlice: fetchCompanies error:', error);
      return rejectWithValue(error.message || 'Failed to fetch companies');
    }
  }
);

export const fetchCompanyById = createAsyncThunk<Company | null, string>(
  'companies/fetchCompanyById',
  async (companyId: string, { rejectWithValue }) => {
    try {
      // TODO: Implement actual API call
      // const companiesService = getCompaniesService();
      // const company = await companiesService.getCompanyById(companyId);
      
      // Return null - no company found
      return null;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to fetch company');
    }
  }
);

export const createCompany = createAsyncThunk(
  'companies/createCompany',
  async (companyData: CreateCompanyInput, { rejectWithValue }) => {
    try {
      // TODO: Implement actual API call
      // const companiesService = getCompaniesService();
      // const company = await companiesService.createCompany(companyData);
      
      // Mock creation
      const newCompany: Company = {
        id: `company_${Date.now()}`,
        ...companyData,
        direccion: companyData.complemento || '', // direccion is alias for complemento
        hasValidCertificate: false,
        hasApiCredentials: false,
        currentInvoiceNumber: 1,
        currentCCFNumber: 1,
        status: CompanyStatus.Active,
        isDefault: false, // Will be set in the fulfilled reducer if it's the first company
        userId: 'user1', // TODO: Get from auth state
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as Company;
      
      return newCompany;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to create company');
    }
  }
);

export const updateCompany = createAsyncThunk(
  'companies/updateCompany',
  async (companyData: UpdateCompanyInput, { getState, rejectWithValue }) => {
    try {
      // Critical: MERGE the partial input with the existing company instead
      // of constructing a fresh object. The previous implementation defaulted
      // every unspecified field to '' (or 1, or a hardcoded MH code), which
      // wiped nombre/NIT/NRC/dirección/etc. whenever a caller updated only
      // certificate fields (or any subset). See bug 2026-04-14.
      const state = getState() as { companies: CompanyState };
      const existing = state.companies.companies.find((c) => c.id === companyData.id);
      if (!existing) {
        return rejectWithValue(`Company ${companyData.id} not found`);
      }

      // Strip undefined values so they don't overwrite existing fields with
      // `undefined`. Empty string IS a valid clear (intentional) — only
      // `undefined` is treated as "no change".
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(companyData)) {
        if (v !== undefined) patch[k] = v;
      }

      const updatedCompany: Company = {
        ...existing,
        ...patch,
        id: existing.id, // never let id be overwritten
        updatedAt: new Date().toISOString(),
      } as Company;

      // Keep `direccion` alias in sync when complemento is touched.
      if (patch.complemento !== undefined) {
        updatedCompany.direccion = patch.complemento as string;
      }

      return updatedCompany;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to update company');
    }
  }
);

export const deleteCompany = createAsyncThunk(
  'companies/deleteCompany',
  async (companyId: string, { rejectWithValue }) => {
    try {
      // TODO: Implement actual API call
      // const companiesService = getCompaniesService();
      // await companiesService.deleteCompany(companyId);
      
      return companyId;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to delete company');
    }
  }
);

export const setDefaultCompany = createAsyncThunk(
  'companies/setDefaultCompany',
  async (companyId: string, { rejectWithValue }) => {
    try {
      // TODO: Implement actual API call
      // const companiesService = getCompaniesService();
      // await companiesService.setDefaultCompany(companyId);
      
      return companyId;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to set default company');
    }
  }
);

/**
 * Promote a test company to production by CLONING it into a new Company
 * record (mirrors the iOS `validateProductionAccount` flow). The test company
 * is left untouched so its historical DTEs / customers / products remain
 * attached to it. The new production company starts with a clean slate —
 * no certificate, no API credentials, invoice counters back to 1 — forcing
 * the user to configure production-grade secrets deliberately.
 *
 * If a production Company already exists for the same NIT, it is returned
 * and no new record is created (matches the iOS duplicate-guard).
 */
export type PromoteToProductionResult =
  | { kind: 'reused'; companyId: string }
  | { kind: 'created'; company: Company };

export const promoteToProduction = createAsyncThunk<PromoteToProductionResult, string>(
  'companies/promoteToProduction',
  async (sourceId, { getState, rejectWithValue }) => {
    try {
    const state = getState() as { companies: CompanyState };
    const source = state.companies.companies.find((c) => c.id === sourceId);
    if (!source) return rejectWithValue(`Company ${sourceId} not found`);
    if (!source.nit) {
      return rejectWithValue(
        'La empresa no tiene NIT. Configúralo antes de promover a producción.',
      );
    }

    // Duplicate guard: if a prod company already exists for this NIT, reuse.
    const existingProd = state.companies.companies.find(
      (c) =>
        c.nit === source.nit &&
        c.environment === CompanyEnvironment.Production &&
        c.isTestAccount !== true,
    );
    if (existingProd) {
      return { kind: 'reused', companyId: existingProd.id };
    }

    const now = new Date().toISOString();
    const clone: Company = {
      // New identity
      id: `company_${Date.now()}`,
      // Identity fields copied verbatim from the test company
      nit: source.nit,
      nombre: source.nombre,
      nombreComercial: source.nombreComercial,
      nrc: source.nrc,
      correo: source.correo,
      telefono: source.telefono,
      complemento: source.complemento,
      direccion: source.direccion,
      departamentoCode: source.departamentoCode,
      departamento: source.departamento,
      municipioCode: source.municipioCode,
      municipio: source.municipio,
      distritoCode: source.distritoCode,
      distrito: source.distrito,
      codActividad: source.codActividad,
      descActividad: source.descActividad,
      tipoEstablecimiento: source.tipoEstablecimiento,
      establecimiento: source.establecimiento,
      descTipoEstablecimiento: source.descTipoEstablecimiento,
      codEstableMH: source.codEstableMH,
      codEstable: source.codEstable,
      codPuntoVentaMH: source.codPuntoVentaMH,
      codPuntoVenta: source.codPuntoVenta,
      recintoFiscal: source.recintoFiscal,
      regimenFiscal: source.regimenFiscal,
      invoiceLogo: source.invoiceLogo,
      logoUrl: source.logoUrl,
      logoWidth: source.logoWidth,
      logoHeight: source.logoHeight,
      primaryColor: source.primaryColor,
      secondaryColor: source.secondaryColor,
      taxRegistrationNumber: source.taxRegistrationNumber,
      ivaPercentage: source.ivaPercentage ?? 13,
      retentionPercentage: source.retentionPercentage,
      invoicePrefix: source.invoicePrefix,
      ccfPrefix: source.ccfPrefix,
      creditNotePrefix: source.creditNotePrefix,
      debitNotePrefix: source.debitNotePrefix,
      userId: source.userId,
      // Environment / operational fields — clean slate for production
      environment: CompanyEnvironment.Production,
      isTestAccount: false,
      isProduction: true,
      hasValidCertificate: false,
      certificatePath: undefined,
      certificatePassword: undefined,
      certificateExpiryDate: undefined,
      certificateSubject: undefined,
      certificateIssuer: undefined,
      credentials: undefined,
      hasApiCredentials: false,
      currentInvoiceNumber: 1,
      currentCCFNumber: 1,
      status: CompanyStatus.Active,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
      lastSyncDate: undefined,
    };

      return { kind: 'created', company: clone };
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to promote company to production');
    }
  },
);

/**
 * Why a credentials check failed: Hacienda answered and said no, or Hacienda
 * could not be reached (offline / 5xx) — the UI tells the user different
 * things for each, and neither case saves anything.
 */
export interface CredentialsCheckFailure {
  kind: 'rejected' | 'unreachable';
  message: string;
}

export const CREDENTIALS_REJECTED_MESSAGE =
  'Hacienda rechazó el usuario o la contraseña. Verifícalos en el portal de Hacienda.';

export const validateCredentials = createAsyncThunk<
  { companyId: string; isValid: true },
  {
    companyId: string;
    credentials: { user: string; password: string };
    /** Validate against the company's own MH environment (test vs production). */
    isProduction?: boolean;
  },
  { rejectValue: CredentialsCheckFailure }
>(
  'companies/validateCredentials',
  async ({ companyId, credentials, isProduction }, { rejectWithValue }) => {
    const rejected = (): CredentialsCheckFailure => ({ kind: 'rejected', message: CREDENTIALS_REJECTED_MESSAGE });
    // Failure-injection hook for negative-path Playwright tests.
    if (
      typeof localStorage !== 'undefined' &&
      localStorage.getItem('__mock_mh_auth_fail') === 'true'
    ) {
      return rejectWithValue(rejected());
    }
    // Mock hook for Playwright tests — short-circuit without network call.
    if (
      typeof localStorage !== 'undefined' &&
      localStorage.getItem('__mock_mh_api') === 'true'
    ) {
      return { companyId, isValid: true };
    }

    // Straight against MH's /seguridad/auth of the company's environment —
    // calling getMhClient() without it reused whichever client existed and
    // defaulted to the TEST API, so production credentials were checked
    // against the wrong environment.
    let outcome: { valid: boolean; statusCode?: number };
    try {
      outcome = await getMhClient(isProduction ?? false).validateCredentials({
        userName: credentials.user,
        password: credentials.password,
      });
    } catch {
      outcome = { valid: false, statusCode: 0 };
    }
    if (outcome.valid) return { companyId, isValid: true };
    const code = outcome.statusCode;
    if (code === 400 || code === 401 || code === 403 || (code !== undefined && code >= 200 && code < 300)) {
      return rejectWithValue(rejected());
    }
    return rejectWithValue({
      kind: 'unreachable',
      message: `No se pudo contactar a Hacienda${code && code > 0 ? ` (HTTP ${code})` : ''}. Revisa tu conexión e intenta de nuevo.`,
    });
  }
);

// Slice
const companySlice = createSlice({
  name: 'companies',
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
    setFilters: (state, action: PayloadAction<CompanyState['filters']>) => {
      state.filters = action.payload;
    },
    
    // Set selected company
    setSelectedCompany: (state, action: PayloadAction<string | null>) => {
      state.selectedCompanyId = action.payload;
      state.currentCompany = action.payload 
        ? state.companies.find(c => c.id === action.payload) || null
        : null;
    },
    
    // Update company locally (for optimistic updates)
    updateCompanyLocal: (state, action: PayloadAction<{ id: string; updates: Partial<Company> }>) => {
      const { id, updates } = action.payload;
      const companyIndex = state.companies.findIndex(c => c.id === id);

      if (companyIndex !== -1) {
        state.companies[companyIndex] = { ...state.companies[companyIndex], ...updates };

        // Update current company if it's the one being updated
        if (state.currentCompany?.id === id) {
          state.currentCompany = { ...state.currentCompany, ...updates };
        }
      }
    },

    // Atomically consume the next sequence number for sequential control
    // numbers. The CALLER reads `nextSequenceNumber` BEFORE dispatching this
    // action and uses that value; the action just bumps the counter so the
    // next consumer gets a fresh number. Increments by 1.
    consumeNextSequence: (state, action: PayloadAction<{ companyId: string }>) => {
      const company = state.companies.find(c => c.id === action.payload.companyId);
      if (company) {
        const current = company.nextSequenceNumber ?? 1;
        company.nextSequenceNumber = current + 1;
        if (state.currentCompany?.id === action.payload.companyId) {
          state.currentCompany = { ...state.currentCompany, nextSequenceNumber: current + 1 };
        }
      }
    },
    
    // Device Sync v2 relay write: another device of the owner edited this company's
    // settings. The adapter already stripped device-local fields (certificate, MH
    // credentials, logo, default flag, sequence counter), so the remaining fields merge
    // onto the LOCAL record — its id stays the local one. Never captured into the outbox.
    syncMergeCompany: (state, action: PayloadAction<{ id: string; changes: Partial<Company> }>) => {
      const { id, changes } = action.payload;
      const index = state.companies.findIndex(c => c.id === id);
      if (index === -1) return;
      const merged = { ...state.companies[index], ...changes, id };
      state.companies[index] = merged;
      if (state.currentCompany?.id === id) {
        state.currentCompany = merged;
      }
    },

    // Device Sync v2 correlativo seeding for sequential numeroControl: another device of
    // the owner already issued up to `floor` — the next local sequence starts above it.
    seedSequenceFloor: (state, action: PayloadAction<{ companyId: string; floor: number }>) => {
      const company = state.companies.find(c => c.id === action.payload.companyId);
      if (!company || !Number.isFinite(action.payload.floor)) return;
      const next = Math.max(company.nextSequenceNumber ?? 1, action.payload.floor + 1);
      company.nextSequenceNumber = next;
      if (state.currentCompany?.id === company.id) {
        state.currentCompany = { ...state.currentCompany, nextSequenceNumber: next };
      }
    },

    // Reset company state
    resetCompanies: (state) => {
      Object.assign(state, initialState);
    },

    // Hydrate companies directly (for UI testing / data seeding)
    hydrateCompanies: (state, action: PayloadAction<Company[]>) => {
      state.companies = action.payload;
      if (action.payload.length > 0) {
        const defaultCompany = action.payload.find(c => c.isDefault) ?? action.payload[0];
        state.currentCompany = defaultCompany;
        state.selectedCompanyId = defaultCompany.id;
      }
    },
    
    // Initialize default company selection (for app startup)
    initializeDefaultCompany: (state) => {
      console.log('CompanySlice: initializeDefaultCompany called', {
        selectedCompanyId: state.selectedCompanyId,
        companiesLength: state.companies.length,
        currentCompany: state.currentCompany?.id
      });
      
      // Set default company if no current company but companies exist
      if (!state.currentCompany && state.companies.length > 0) {
        // First try to find a company marked as default
        let defaultCompany = state.companies.find(c => c.isDefault);
        
        console.log('CompanySlice: Found default company?', !!defaultCompany);
        
        // If no default company, use the first company
        if (!defaultCompany) {
          defaultCompany = state.companies[0];
          console.log('CompanySlice: Using first company as default:', defaultCompany?.nombreComercial);
        }
        
        if (defaultCompany) {
          state.selectedCompanyId = defaultCompany.id;
          state.currentCompany = defaultCompany;
          console.log('CompanySlice: Default company selected:', defaultCompany.nombreComercial, 'ID:', defaultCompany.id);
        } else {
          console.error('CompanySlice: No companies available to select!');
        }
      } else if (state.selectedCompanyId && !state.currentCompany && state.companies.length > 0) {
        // Handle case where selectedCompanyId exists but currentCompany is null
        const selectedCompany = state.companies.find(c => c.id === state.selectedCompanyId);
        if (selectedCompany) {
          state.currentCompany = selectedCompany;
          console.log('CompanySlice: Restored currentCompany from selectedCompanyId:', selectedCompany.nombreComercial);
        } else {
          console.warn('CompanySlice: selectedCompanyId not found in companies, resetting to first company');
          const firstCompany = state.companies[0];
          state.selectedCompanyId = firstCompany.id;
          state.currentCompany = firstCompany;
        }
      } else {
        console.log('CompanySlice: Conditions not met for default selection', {
          hasCurrentCompany: !!state.currentCompany,
          hasCompanies: state.companies.length > 0,
          selectedCompanyId: state.selectedCompanyId
        });
      }
    },
  },
  extraReducers: (builder) => {
    // Fetch companies
    builder
      .addCase(fetchCompanies.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchCompanies.fulfilled, (state, action) => {
        state.loading = false;
        state.companies = action.payload;
        
        // Set default company if none selected
        if (!state.selectedCompanyId && action.payload.length > 0) {
          // First try to find a company marked as default
          let defaultCompany = action.payload.find(c => c.isDefault);
          
          // If no default company, use the first company
          if (!defaultCompany) {
            defaultCompany = action.payload[0];
            console.log('CompanySlice: No default company found, selecting first company:', defaultCompany.nombreComercial);
          } else {
            console.log('CompanySlice: Using default company:', defaultCompany.nombreComercial);
          }
          
          state.selectedCompanyId = defaultCompany.id;
          state.currentCompany = defaultCompany;
          console.log('CompanySlice: Selected company set to:', defaultCompany.nombreComercial);
        }
      })
      .addCase(fetchCompanies.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });

    // Fetch company by ID
    builder
      .addCase(fetchCompanyById.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchCompanyById.fulfilled, (state, action) => {
        state.loading = false;
        state.currentCompany = action.payload;
        
        // Update in companies array if exists and payload is not null
        if (action.payload) {
          const existingIndex = state.companies.findIndex(c => c.id === action.payload!.id);
          if (existingIndex !== -1) {
            state.companies[existingIndex] = action.payload;
          }
        }
      })
      .addCase(fetchCompanyById.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });

    // Create company
    builder
      .addCase(createCompany.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createCompany.fulfilled, (state, action) => {
        state.loading = false;
        
        // If this is the first company, mark it as default
        const isFirstCompany = state.companies.length === 0;
        const newCompany = { ...action.payload };
        
        if (isFirstCompany) {
          newCompany.isDefault = true;
          console.log('CompanySlice: Created first company, marking as default:', newCompany.nombreComercial);
        }
        
        state.companies.push(newCompany);
        state.currentCompany = newCompany;
        state.selectedCompanyId = newCompany.id;
        console.log('CompanySlice: Company created and selected:', newCompany.nombreComercial);
      })
      .addCase(createCompany.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });

    // Update company
    builder
      .addCase(updateCompany.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updateCompany.fulfilled, (state, action) => {
        state.loading = false;
        const updatedCompany = action.payload;
        const index = state.companies.findIndex(c => c.id === updatedCompany.id);
        
        if (index !== -1) {
          state.companies[index] = updatedCompany;
        }
        
        if (state.currentCompany?.id === updatedCompany.id) {
          state.currentCompany = updatedCompany;
        }
      })
      .addCase(updateCompany.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });

    // Promote to production (clone into a new company)
    builder.addCase(promoteToProduction.fulfilled, (state, action) => {
      const result = action.payload;
      if (result.kind === 'created') {
        state.companies.push(result.company);
        state.currentCompany = result.company;
        state.selectedCompanyId = result.company.id;
        // The promoted clone becomes the working company — make it the default
        // too, or the list keeps starring the TEST company while the sidebar
        // badge (and every new DTE/ticket) already point at PROD.
        state.companies.forEach(c => {
          c.isDefault = c.id === result.company.id;
        });
      } else {
        const reused =
          state.companies.find((c) => c.id === result.companyId) ?? null;
        if (reused) {
          state.currentCompany = reused;
          state.selectedCompanyId = reused.id;
          state.companies.forEach(c => {
            c.isDefault = c.id === reused.id;
          });
        }
      }
    });

    // Delete company
    builder
      .addCase(deleteCompany.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(deleteCompany.fulfilled, (state, action) => {
        state.loading = false;
        const deletedId = action.payload;
        state.companies = state.companies.filter(c => c.id !== deletedId);
        
        if (state.selectedCompanyId === deletedId) {
          const nextCompany = state.companies.find(c => c.isDefault) ?? state.companies[0] ?? null;
          state.selectedCompanyId = nextCompany?.id ?? null;
          state.currentCompany = nextCompany;
        } else if (state.currentCompany?.id === deletedId) {
          state.currentCompany =
            state.selectedCompanyId
              ? state.companies.find(c => c.id === state.selectedCompanyId) ?? null
              : null;
        }
      })
      .addCase(deleteCompany.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });

    // Set default company
    builder
      .addCase(setDefaultCompany.fulfilled, (state, action) => {
        const newDefaultId = action.payload;

        // Remove default from all companies
        state.companies.forEach(company => {
          company.isDefault = false;
        });

        // Set new default — and SELECT it. "Predeterminar" reads as "make this
        // my company" in the UI; leaving the selection elsewhere made the
        // sidebar badge, the star and the "Predeterminar" button disagree about
        // which company new DTEs/tickets belong to.
        const newDefaultCompany = state.companies.find(c => c.id === newDefaultId);
        if (newDefaultCompany) {
          newDefaultCompany.isDefault = true;
          state.currentCompany = newDefaultCompany;
          state.selectedCompanyId = newDefaultCompany.id;
        }
      });

    // Validate credentials
    builder
      .addCase(validateCredentials.fulfilled, (state, action) => {
        const { companyId, isValid } = action.payload;
        const company = state.companies.find(c => c.id === companyId);
        
        if (company) {
          company.hasApiCredentials = isValid;
        }
      });
  },
});

// Actions
export const {
  clearError,
  setSearchTerm,
  setFilters,
  setSelectedCompany,
  updateCompanyLocal,
  consumeNextSequence,
  resetCompanies,
  syncMergeCompany,
  seedSequenceFloor,
  hydrateCompanies,
  initializeDefaultCompany,
} = companySlice.actions;

export default companySlice.reducer;
