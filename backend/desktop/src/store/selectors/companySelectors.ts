// Company selectors for accessing company state

import { createSelector } from '@reduxjs/toolkit';
import { RootState } from '../index';
import { Company, CompanyEnvironment, CompanyStatus } from '../../types';

// Base selectors
export const selectCompanies = (state: RootState) => state.companies;

// Derived selectors
export const selectAllCompanies = createSelector(
  [selectCompanies],
  (companies) => companies.companies
);

// currentCompany can be null after redux-persist rehydration even when
// selectedCompanyId is set. Fall back to deriving from selectedCompanyId.
export const selectCurrentCompany = createSelector(
  [selectCompanies],
  (companies) => {
    if (companies.currentCompany) return companies.currentCompany;
    if (companies.selectedCompanyId) {
      return companies.companies.find(c => c.id === companies.selectedCompanyId) ?? null;
    }
    return null;
  }
);

export const selectSelectedCompanyId = createSelector(
  [selectCompanies],
  (companies) => companies.selectedCompanyId
);

export const selectCompaniesLoading = createSelector(
  [selectCompanies],
  (companies) => companies.loading
);

export const selectCompaniesError = createSelector(
  [selectCompanies],
  (companies) => companies.error
);

export const selectCompaniesSearchTerm = createSelector(
  [selectCompanies],
  (companies) => companies.searchTerm
);

export const selectCompaniesFilters = createSelector(
  [selectCompanies],
  (companies) => companies.filters
);

// Company by ID selector factory
export const selectCompanyById = (companyId: string) => createSelector(
  [selectAllCompanies],
  (companies) => companies.find(company => company.id === companyId) || null
);

// Filtered and searched companies
export const selectFilteredCompanies = createSelector(
  [selectAllCompanies, selectCompaniesSearchTerm, selectCompaniesFilters],
  (companies, searchTerm, filters) => {
    let filteredCompanies = [...companies];

    // Apply search term
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filteredCompanies = filteredCompanies.filter(company =>
        company.nombre.toLowerCase().includes(term) ||
        company.nombreComercial?.toLowerCase().includes(term) ||
        company.nit?.toLowerCase().includes(term) ||
        company.correo.toLowerCase().includes(term)
      );
    }

    // Apply filters
    if (filters.status && filters.status.length > 0) {
      filteredCompanies = filteredCompanies.filter(company =>
        filters.status!.includes(company.status)
      );
    }

    if (filters.environment && filters.environment.length > 0) {
      filteredCompanies = filteredCompanies.filter(company =>
        filters.environment!.includes(company.environment)
      );
    }

    if (filters.hasValidCertificate !== undefined) {
      filteredCompanies = filteredCompanies.filter(company =>
        company.hasValidCertificate === filters.hasValidCertificate
      );
    }

    if (filters.city) {
      filteredCompanies = filteredCompanies.filter(company =>
        company.municipio.toLowerCase().includes(filters.city!.toLowerCase())
      );
    }

    if (filters.department) {
      filteredCompanies = filteredCompanies.filter(company =>
        company.departamento === filters.department
      );
    }

    return filteredCompanies;
  }
);

// Company categorization selectors
export const selectCompaniesByEnvironment = createSelector(
  [selectAllCompanies],
  (companies) => {
    return companies.reduce((acc, company) => {
      const env = company.environment;
      if (!acc[env]) {
        acc[env] = [];
      }
      acc[env].push(company);
      return acc;
    }, {} as Record<CompanyEnvironment, Company[]>);
  }
);

export const selectCompaniesByStatus = createSelector(
  [selectAllCompanies],
  (companies) => {
    return companies.reduce((acc, company) => {
      const status = company.status;
      if (!acc[status]) {
        acc[status] = [];
      }
      acc[status].push(company);
      return acc;
    }, {} as Record<CompanyStatus, Company[]>);
  }
);

// Statistics selectors
export const selectCompaniesStats = createSelector(
  [selectAllCompanies],
  (companies) => {
    const total = companies.length;
    const active = companies.filter(c => c.status === CompanyStatus.Active).length;
    const withCertificates = companies.filter(c => c.hasValidCertificate).length;
    const production = companies.filter(c => c.environment === CompanyEnvironment.Production).length;
    const development = companies.filter(c => c.environment === CompanyEnvironment.Development).length;

    return {
      total,
      active,
      inactive: total - active,
      withCertificates,
      withoutCertificates: total - withCertificates,
      production,
      development,
      certificatePercentage: total > 0 ? Math.round((withCertificates / total) * 100) : 0,
      productionPercentage: total > 0 ? Math.round((production / total) * 100) : 0,
    };
  }
);

// Default company selector
export const selectDefaultCompany = createSelector(
  [selectAllCompanies],
  (companies) => companies.find(company => company.isDefault) || null
);

// Companies with expiring certificates
export const selectCompaniesWithExpiringCertificates = createSelector(
  [selectAllCompanies],
  (companies) => {
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    return companies.filter(company =>
      company.hasValidCertificate &&
      company.certificateExpiryDate &&
      new Date(company.certificateExpiryDate) <= thirtyDaysFromNow
    );
  }
);

// Production ready companies
export const selectProductionReadyCompanies = createSelector(
  [selectAllCompanies],
  (companies) => companies.filter(company =>
    company.status === CompanyStatus.Active &&
    company.hasValidCertificate &&
    company.hasApiCredentials &&
    company.environment === CompanyEnvironment.Production
  )
);

// Companies needing setup
export const selectCompaniesNeedingSetup = createSelector(
  [selectAllCompanies],
  (companies) => companies.filter(company =>
    !company.hasValidCertificate ||
    !company.hasApiCredentials ||
    company.status === CompanyStatus.PendingApproval
  )
);

// Company display info selector factory
export const selectCompanyDisplayInfo = (companyId: string) => createSelector(
  [selectCompanyById(companyId)],
  (company) => {
    if (!company) {
      return {
        displayName: 'Unknown Company',
        subtitle: '',
        initials: 'UC',
        statusColor: '#666666',
      };
    }

    const displayName = company.nombreComercial || company.nombre;
    const subtitle = `${company.nit} • ${company.environment}`;
    const initials = company.nombre
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .substring(0, 2)
      .toUpperCase();

    let statusColor = '#666666';
    switch (company.status) {
      case CompanyStatus.Active:
        statusColor = '#34C759';
        break;
      case CompanyStatus.Inactive:
        statusColor = '#FF9500';
        break;
      case CompanyStatus.Suspended:
        statusColor = '#FF3B30';
        break;
      case CompanyStatus.PendingApproval:
        statusColor = '#2563EB';
        break;
    }

    return {
      displayName,
      subtitle,
      initials,
      statusColor,
    };
  }
);

// Has companies selector
export const selectHasCompanies = createSelector(
  [selectAllCompanies],
  (companies) => companies.length > 0
);

// Selected company with validation
export const selectSelectedCompany = createSelector(
  [selectAllCompanies, selectSelectedCompanyId],
  (companies, selectedId) => {
    if (!selectedId) return null;
    return companies.find(company => company.id === selectedId) || null;
  }
);

export const selectIsValidCompanySelected = createSelector(
  [selectSelectedCompany],
  (company) => {
    return !!(company && 
      company.status === CompanyStatus.Active &&
      company.hasValidCertificate &&
      company.hasApiCredentials
    );
  }
);