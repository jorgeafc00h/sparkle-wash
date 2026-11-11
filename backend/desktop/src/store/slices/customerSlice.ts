// Customer slice aligned with SwiftUI functionality

import { PayloadAction, createSlice, createAsyncThunk, nanoid } from '@reduxjs/toolkit';
import {
  CustomerState,
  Customer,
  CreateCustomerInput,
  UpdateCustomerInput,
  CustomerFilters,
} from '../../types';
import { DEFAULT_COMPANY_ID } from '../../data/fixtures';

const now = () => new Date().toISOString();

// Async thunks for customer operations
export const fetchCustomers = createAsyncThunk(
  'customers/fetchCustomers',
  async (params: { refresh?: boolean } = {}, { rejectWithValue, getState }) => {
    try {
      // TODO: Implement actual API call
      // const customersService = getCustomersService();
      // const customers = await customersService.getCustomers();
      
      // For now, return existing customers from state to preserve created customers
      // When backend is implemented, this will fetch from API
      const state = getState() as { customers: CustomerState };
      const existingCustomers = state.customers.customers;
      
      return existingCustomers;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to fetch customers');
    }
  }
);

export const createCustomer = createAsyncThunk(
  'customers/createCustomer',
  async (customerInput: CreateCustomerInput, { rejectWithValue }) => {
    try {
      // TODO: Implement actual API call
      // const customersService = getCustomersService();
      // const customer = await customersService.createCustomer(customerInput);
      
      // For now, create customer locally
      const customer = buildCustomer(customerInput);
      return customer;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to create customer');
    }
  }
);

export const updateCustomerAsync = createAsyncThunk(
  'customers/updateCustomerAsync',
  async (input: UpdateCustomerInput, { rejectWithValue }) => {
    try {
      // TODO: Implement actual API call
      // const customersService = getCustomersService();
      // const customer = await customersService.updateCustomer(input);
      
      // For now, update locally
      return input;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to update customer');
    }
  }
);

export const deleteCustomerAsync = createAsyncThunk(
  'customers/deleteCustomerAsync',
  async (customerId: string, { rejectWithValue }) => {
    try {
      // TODO: Implement actual API call
      // const customersService = getCustomersService();
      // await customersService.deleteCustomer(customerId);
      
      // For now, delete locally
      return customerId;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to delete customer');
    }
  }
);

const buildCustomer = (input: CreateCustomerInput): Customer => {
  const timestamp = now();
  return {
    id: input?.companyId ? `${input.companyId}_${nanoid(6)}` : `cust_${nanoid(8)}`,
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    businessName: input.businessName?.trim() || `${input.firstName} ${input.lastName}`,
    nationalId: input.nationalId.trim(),
    nit: input.nit.trim(), // Added missing nit property
    documentType: input.documentType,
    email: input.email.trim().toLowerCase(),
    phone: input.phone.trim(),
    address: input.address?.trim(),
    city: input.city?.trim(),
    department: input.department?.trim(),
    departmentCode: input.departmentCode,
    municipality: input.municipality?.trim() ?? input.city?.trim(),
    municipalityCode: input.municipalityCode,
    district: input.district?.trim(),
    districtCode: input.districtCode,
    country: input.country ?? 'El Salvador',
    postalCode: input.postalCode,
    hasContributorRetention: !!input.hasContributorRetention,
    isLargeTaxpayer: input.isLargeTaxpayer || undefined,
    customerType: input.customerType,
    isActive: true,
    companyId: input.companyId,
    codActividad: input.codActividad,
    descActividad: input.descActividad,
    taxRegistrationNumber: input.taxRegistrationNumber,
    nrc: input.nrc,
    documentTypeCatalogCode: input.documentTypeCatalogCode,
    // Export information fields
    codPais: input.codPais,
    nombrePais: input.nombrePais,
    tipoPersona: input.tipoPersona,
    tipoDocumento: input.tipoDocumento,
    shouldSyncToCloud: input.shouldSyncToCloud ?? true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

const initialState: CustomerState = {
  customers: [], // Start with empty customers array
  currentCustomer: null,
  selectedCustomerId: null,
  loading: false,
  error: null,
  searchTerm: '',
  filters: {
    // companyId will be set by component when company is selected
    // No hardcoded default company to avoid cross-company data leaks
    isActive: true,
  },
  lastUpdatedAt: now(),
};

const customerSlice = createSlice({
  name: 'customers',
  initialState,
  reducers: {
    clearError(state) {
      state.error = null;
    },
    setSearchTerm(state, action: PayloadAction<string>) {
      state.searchTerm = action.payload;
    },
    setFilters(state, action: PayloadAction<CustomerFilters>) {
      state.filters = {
        ...state.filters,
        ...action.payload,
      };
    },
    addCustomer: {
      reducer(state, action: PayloadAction<Customer>) {
        state.customers.push(action.payload);
        state.currentCustomer = action.payload;
        state.selectedCustomerId = action.payload.id;
        state.lastUpdatedAt = now();
      },
      prepare(input: CreateCustomerInput) {
        return { payload: buildCustomer(input) };
      },
    },
    updateCustomer(state, action: PayloadAction<UpdateCustomerInput>) {
      const { id, ...updates } = action.payload;
      const customerIndex = state.customers.findIndex(c => c.id === id);
      if (customerIndex === -1) {
        state.error = 'Cliente no encontrado';
        return;
      }

      const existing = state.customers[customerIndex];
      const updatedCustomer: Customer = {
        ...existing,
        ...updates,
        businessName: updates.businessName?.trim() ?? existing.businessName,
        firstName: updates.firstName?.trim() ?? existing.firstName,
        lastName: updates.lastName?.trim() ?? existing.lastName,
        email: updates.email?.trim().toLowerCase() ?? existing.email,
        updatedAt: now(),
      };

      state.customers[customerIndex] = updatedCustomer;

      if (state.currentCustomer?.id === id) {
        state.currentCustomer = updatedCustomer;
      }
      state.lastUpdatedAt = updatedCustomer.updatedAt;
    },
    deleteCustomer(state, action: PayloadAction<string>) {
      const id = action.payload;
      state.customers = state.customers.filter(customer => customer.id !== id);

      if (state.currentCustomer?.id === id) {
        state.currentCustomer = null;
      }

      if (state.selectedCustomerId === id) {
        state.selectedCustomerId = state.customers.length ? state.customers[0].id : null;
      }

      state.lastUpdatedAt = now();
    },
    deleteCustomersByCompany(state, action: PayloadAction<string>) {
      const companyId = action.payload;
      state.customers = state.customers.filter(customer => customer.companyId !== companyId);

      if (state.currentCustomer?.companyId === companyId) {
        state.currentCustomer = null;
      }

      if (
        state.selectedCustomerId &&
        !state.customers.some(customer => customer.id === state.selectedCustomerId)
      ) {
        state.selectedCustomerId = state.customers.length ? state.customers[0].id : null;
      }

      state.lastUpdatedAt = now();
    },
    setCurrentCustomer(state, action: PayloadAction<string | null>) {
      state.selectedCustomerId = action.payload;
      state.currentCustomer = action.payload
        ? state.customers.find(customer => customer.id === action.payload) || null
        : null;
    },
    // Device Sync v2 relay writes (verbatim, never captured) — see invoiceSlice.syncUpsertInvoice.
    syncUpsertCustomer(state, action: PayloadAction<Customer>) {
      const incoming = action.payload;
      const index = state.customers.findIndex(customer => customer.id === incoming.id);
      if (index === -1) {
        state.customers.push(incoming);
      } else {
        state.customers[index] = incoming;
      }
      if (state.currentCustomer?.id === incoming.id) {
        state.currentCustomer = incoming;
      }
    },
    syncRemoveCustomer(state, action: PayloadAction<string>) {
      const id = action.payload;
      state.customers = state.customers.filter(customer => customer.id !== id);
      if (state.currentCustomer?.id === id) {
        state.currentCustomer = null;
      }
      if (state.selectedCustomerId === id) {
        state.selectedCustomerId = state.customers.length ? state.customers[0].id : null;
      }
    },
    hydrateCustomers(state, action: PayloadAction<Customer[]>) {
      state.customers = action.payload;
      state.currentCustomer = action.payload.find(c => c.id === state.selectedCustomerId) || null;
      state.loading = false;
      state.error = null;
      state.lastUpdatedAt = now();
    },
    resetCustomers() {
      return initialState;
    },
  },
  extraReducers: (builder) => {
    // Fetch customers
    builder
      .addCase(fetchCustomers.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchCustomers.fulfilled, (state, action) => {
        state.loading = false;
        state.customers = action.payload;
        state.error = null;
        state.lastUpdatedAt = now();
      })
      .addCase(fetchCustomers.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });

    // Create customer
    builder
      .addCase(createCustomer.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createCustomer.fulfilled, (state, action) => {
        state.loading = false;
        state.customers.push(action.payload);
        state.currentCustomer = action.payload;
        state.selectedCustomerId = action.payload.id;
        state.error = null;
        state.lastUpdatedAt = now();
      })
      .addCase(createCustomer.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });

    // Update customer async
    builder
      .addCase(updateCustomerAsync.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updateCustomerAsync.fulfilled, (state, action) => {
        state.loading = false;
        const { id, ...updates } = action.payload;
        const customerIndex = state.customers.findIndex(c => c.id === id);
        if (customerIndex !== -1) {
          const existing = state.customers[customerIndex];
          const updatedCustomer = {
            ...existing,
            ...updates,
            updatedAt: now(),
          };
          state.customers[customerIndex] = updatedCustomer;
          if (state.currentCustomer?.id === id) {
            state.currentCustomer = updatedCustomer;
          }
        }
        state.error = null;
        state.lastUpdatedAt = now();
      })
      .addCase(updateCustomerAsync.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });

    // Delete customer async
    builder
      .addCase(deleteCustomerAsync.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(deleteCustomerAsync.fulfilled, (state, action) => {
        state.loading = false;
        const customerId = action.payload;
        state.customers = state.customers.filter(customer => customer.id !== customerId);
        if (state.currentCustomer?.id === customerId) {
          state.currentCustomer = null;
        }
        if (state.selectedCustomerId === customerId) {
          state.selectedCustomerId = state.customers.length ? state.customers[0].id : null;
        }
        state.error = null;
        state.lastUpdatedAt = now();
      })
      .addCase(deleteCustomerAsync.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });
  },
});

export const {
  clearError,
  setSearchTerm,
  setFilters,
  addCustomer,
  updateCustomer,
  deleteCustomer,
  deleteCustomersByCompany,
  setCurrentCustomer,
  hydrateCustomers,
  syncUpsertCustomer,
  syncRemoveCustomer,
  resetCustomers,
} = customerSlice.actions;

export default customerSlice.reducer;
