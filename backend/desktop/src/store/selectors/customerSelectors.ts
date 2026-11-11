// Customer selectors aligned with Swift functionality

import { createSelector } from '@reduxjs/toolkit';
import { RootState } from '../index';
import { CustomerType } from '../../types/customer';

export const selectCustomerState = (state: RootState) => state.customers;

export const selectAllCustomers = createSelector(
  [selectCustomerState],
  (state) => state.customers
);

export const selectCustomersLoading = createSelector(
  [selectCustomerState],
  (state) => state.loading
);

export const selectCustomersError = createSelector(
  [selectCustomerState],
  (state) => state.error
);

export const selectCustomerSearchTerm = createSelector(
  [selectCustomerState],
  (state) => state.searchTerm
);

export const selectCustomerFilters = createSelector(
  [selectCustomerState],
  (state) => state.filters
);

export const selectSelectedCustomerId = createSelector(
  [selectCustomerState],
  (state) => state.selectedCustomerId
);

export const selectCurrentCustomer = createSelector(
  [selectCustomerState],
  (state) => state.currentCustomer
);

export const selectCustomerById = (customerId: string) =>
  createSelector([selectAllCustomers], (customers) =>
    customers.find((customer) => customer.id === customerId) || null
  );

// ✅ OPTIMIZED: Current company's customers
// Returns all customers when no company is selected (single-company users)
export const selectCurrentCompanyCustomers = createSelector(
  [selectAllCustomers, (state: RootState) => state.companies.selectedCompanyId],
  (customers, selectedCompanyId) =>
    selectedCompanyId
      ? customers.filter((customer) => customer.companyId === selectedCompanyId)
      : customers
);

export const selectFilteredCustomers = createSelector(
  [selectCurrentCompanyCustomers, selectCustomerSearchTerm, selectCustomerFilters],
  (customers, searchTerm, filters) => {
    let results = [...customers];

    if (filters.isActive !== undefined) {
      results = results.filter((customer) => customer.isActive === filters.isActive);
    }

    if (filters.customerType && filters.customerType.length > 0) {
      results = results.filter((customer) => filters.customerType!.includes(customer.customerType));
    }

    if (filters.hasContributorRetention !== undefined) {
      results = results.filter(
        (customer) => customer.hasContributorRetention === filters.hasContributorRetention
      );
    }

    if (filters.departmentCode) {
      results = results.filter((customer) => customer.departmentCode === filters.departmentCode);
    }

    if (filters.municipalityCode) {
      results = results.filter((customer) => customer.municipalityCode === filters.municipalityCode);
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      results = results.filter((customer) => {
        const fullName = `${customer.firstName} ${customer.lastName}`.toLowerCase();
        return (
          fullName.includes(term) ||
          customer.businessName?.toLowerCase().includes(term) ||
          customer.email.toLowerCase().includes(term) ||
          customer.nationalId.toLowerCase().includes(term) ||
          customer.nrc?.toLowerCase().includes(term)
        );
      });
    }

    return results.sort((a, b) => a.firstName.localeCompare(b.firstName));
  }
);

export const selectCustomerSummaries = createSelector(
  [selectFilteredCustomers],
  (customers) =>
    customers.map((customer) => ({
      id: customer.id,
      displayName: customer.businessName || `${customer.firstName} ${customer.lastName}`,
      subtitle: `${customer.documentType}: ${customer.nationalId}`,
      type: customer.customerType,
      city: customer.city,
      department: customer.department,
      hasRetention: customer.hasContributorRetention,
    }))
);

export const selectCustomerStats = createSelector([selectAllCustomers], (customers) => {
  const total = customers.length;
  const actives = customers.filter((c) => c.isActive).length;
  const businesses = customers.filter((c) => c.customerType === CustomerType.Business).length;
  const individuals = customers.filter((c) => c.customerType === CustomerType.Individual).length;
  const withRetention = customers.filter((c) => c.hasContributorRetention).length;

  return {
    total,
    actives,
    inactive: total - actives,
    businesses,
    individuals,
    governments: customers.filter((c) => c.customerType === CustomerType.Government).length,
    withRetention,
    withoutRetention: total - withRetention,
  };
});

export const selectRecentCustomers = createSelector([selectAllCustomers], (customers) =>
  [...customers]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5)
);

// ✅ OPTIMIZED: Company-specific customers selector
export const selectCustomersByCompanyId = (companyId: string) =>
  createSelector([selectAllCustomers], (customers) =>
    customers.filter((customer) => customer.companyId === companyId)
  );
