import { createHashRouter, Navigate } from 'react-router-dom';

// Layout
import { AppShell } from '@/components/layout/AppShell';
import { RequireCompany } from '@/components/layout/RequireCompany';

// Auth / public pages
import WelcomePage from '@/pages/auth/WelcomePage';
import OnboardingPage from '@/pages/auth/OnboardingPage';

// Home
import DashboardPage from '@/pages/home/DashboardPage';

// Invoices
import InvoiceListPage from '@/pages/invoices/InvoiceListPage';
import InvoiceDetailPage from '@/pages/invoices/InvoiceDetailPage';
import AddInvoicePage from '@/pages/invoices/AddInvoicePage';
import EditInvoicePage from '@/pages/invoices/EditInvoicePage';
import InvoiceExportPage from '@/pages/invoices/InvoiceExportPage';
import LibrosIVAPage from '@/pages/invoices/LibrosIVAPage';
import ContingencyPage from '@/pages/invoices/ContingencyPage';
import InvalidationPage from '@/pages/invoices/InvalidationPage';

// Customers
import CustomerListPage from '@/pages/customers/CustomerListPage';
import CustomerDetailPage from '@/pages/customers/CustomerDetailPage';
import CustomerFormPage from '@/pages/customers/CustomerFormPage';

// Products
import ProductListPage from '@/pages/products/ProductListPage';
import ProductDetailPage from '@/pages/products/ProductDetailPage';
import ProductFormPage from '@/pages/products/ProductFormPage';
import StockAdjustmentPage from '@/pages/products/StockAdjustmentPage';

// POS (tickets)
import PosRegisterPage from '@/pages/pos/PosRegisterPage';
import TicketListPage from '@/pages/pos/TicketListPage';
import ClosingPage from '@/pages/pos/ClosingPage';
import ConsolidatePage from '@/pages/pos/ConsolidatePage';

// Carwash (SparkleWash)
import CarwashBoardPage from '@/pages/carwash/CarwashBoardPage';

// Companies
import CompanyListPage from '@/pages/companies/CompanyListPage';
import CompanyDetailPage from '@/pages/companies/CompanyDetailPage';
import CreateCompanyPage from '@/pages/companies/CreateCompanyPage';
import CompanyConfigPage from '@/pages/companies/CompanyConfigPage';
import RequestProductionAccessPage from '@/pages/companies/RequestProductionAccessPage';

// Compras
import ComprasListPage from '@/pages/compras/ComprasListPage';
import CompraDetailPage from '@/pages/compras/CompraDetailPage';
import AddCompraPage from '@/pages/compras/AddCompraPage';
import ComprasSettingsPage from '@/pages/compras/ComprasSettingsPage';
import ComprasExportPage from '@/pages/compras/ComprasExportPage';

// Accounts
import AccountsPage from '@/pages/accounts/AccountsPage';

// Settings
import SettingsPage from '@/pages/settings/SettingsPage';
import CatalogsPage from '@/pages/settings/CatalogsPage';
import CatalogDetailPage from '@/pages/settings/CatalogDetailPage';
import SyncLogsPage from '@/pages/settings/SyncLogsPage';
import SincronizacionPage from '@/pages/settings/SincronizacionPage';
import ProfilePage from '@/pages/settings/ProfilePage';
import AccountSummaryPage from '@/pages/settings/AccountSummaryPage';
import GoogleDriveExportPage from '@/pages/settings/GoogleDriveExportPage';
import PrinterSettingsPage from '@/pages/settings/PrinterSettingsPage';
import ProductCategoriesPage from '@/pages/settings/ProductCategoriesPage';
import CarwashSettingsPage from '@/pages/settings/CarwashSettingsPage';
import LocalUsersPage from '@/pages/settings/LocalUsersPage';
import AuditLogPage from '@/pages/settings/AuditLogPage';

// Chat
import ChatPage from '@/pages/chat/ChatPage';

// Purchases
import DiscountCouponPage from '@/pages/purchases/DiscountCouponPage';
import ChangePaymentMethodPage from '@/pages/purchases/ChangePaymentMethodPage';

export const router = createHashRouter([
  // -------------------------------------------------------------------------
  // Public routes (no sidebar)
  // -------------------------------------------------------------------------
  {
    path: '/welcome',
    element: <WelcomePage />,
  },
  {
    path: '/onboarding',
    element: <OnboardingPage />,
  },

  // -------------------------------------------------------------------------
  // Protected routes (with AppShell sidebar layout)
  // -------------------------------------------------------------------------
  {
    element: <AppShell />,
    children: [
      // Root redirect
      { index: true, element: <Navigate to="/home" replace /> },

      // Home
      { path: '/home', element: <DashboardPage /> },

      // Companies (always accessible — needed to create the first one)
      { path: '/companies', element: <CompanyListPage /> },
      { path: '/companies/add', element: <CreateCompanyPage /> },
      { path: '/companies/:id', element: <CompanyDetailPage /> },
      { path: '/companies/:id/config', element: <CompanyConfigPage /> },
      { path: '/companies/:id/request-production', element: <RequestProductionAccessPage /> },

      // ── Routes below require a configured company ──────────────────────
      {
        element: <RequireCompany mode="redirect" />,
        children: [
          // Invoices
          { path: '/invoices', element: <InvoiceListPage /> },
          { path: '/invoices/add', element: <AddInvoicePage /> },
          { path: '/invoices/export', element: <InvoiceExportPage /> },
          { path: '/invoices/libros-iva', element: <LibrosIVAPage /> },
          { path: '/invoices/contingency', element: <ContingencyPage /> },
          { path: '/invoices/:id', element: <InvoiceDetailPage /> },
          { path: '/invoices/:id/edit', element: <EditInvoicePage /> },
          { path: '/invoices/:id/invalidate', element: <InvalidationPage /> },

          // Customers
          { path: '/customers', element: <CustomerListPage /> },
          { path: '/customers/add', element: <CustomerFormPage /> },
          { path: '/customers/:id', element: <CustomerDetailPage /> },
          { path: '/customers/:id/edit', element: <CustomerFormPage /> },

          // Products
          { path: '/products', element: <ProductListPage /> },
          { path: '/products/add', element: <ProductFormPage /> },
          { path: '/products/stock-adjustment', element: <StockAdjustmentPage /> },
          { path: '/products/:id', element: <ProductDetailPage /> },
          { path: '/products/:id/edit', element: <ProductFormPage /> },

          // Carwash workboard (work tickets)
          { path: '/carwash', element: <CarwashBoardPage /> },

          // POS — tickets (counter sales; not DTEs)
          { path: '/pos', element: <PosRegisterPage /> },
          { path: '/pos/tickets', element: <TicketListPage /> },
          { path: '/pos/closing', element: <ClosingPage /> },
          { path: '/pos/consolidate', element: <ConsolidatePage /> },

          // Compras
          { path: '/compras', element: <ComprasListPage /> },
          { path: '/compras/add', element: <AddCompraPage /> },
          { path: '/compras/settings', element: <ComprasSettingsPage /> },
          { path: '/compras/export', element: <ComprasExportPage /> },
          { path: '/compras/:id', element: <CompraDetailPage /> },

          // Accounts
          { path: '/accounts', element: <AccountsPage /> },
        ],
      },

      // Settings
      { path: '/settings', element: <SettingsPage /> },
      { path: '/settings/catalogs', element: <CatalogsPage /> },
      { path: '/settings/catalogs/:id', element: <CatalogDetailPage /> },
      { path: '/settings/sync-logs', element: <SyncLogsPage /> },
      { path: '/settings/sync', element: <SincronizacionPage /> },
      { path: '/settings/profile', element: <ProfilePage /> },
      { path: '/settings/account', element: <AccountSummaryPage /> },
      { path: '/settings/google-drive', element: <GoogleDriveExportPage /> },
      { path: '/settings/printer', element: <PrinterSettingsPage /> },
      { path: '/settings/carwash', element: <CarwashSettingsPage /> },
      { path: '/settings/categories', element: <ProductCategoriesPage /> },
      // Local users + activity log (admin only — enforced in AppShell)
      { path: '/settings/users', element: <LocalUsersPage /> },
      { path: '/settings/audit', element: <AuditLogPage /> },

      // Chat
      { path: '/chat', element: <ChatPage /> },

      // Purchases / Promo
      { path: '/settings/promo', element: <DiscountCouponPage /> },
      { path: '/settings/account/change-card', element: <ChangePaymentMethodPage /> },

      // Unknown hash routes (typos, stale deep links from old app versions)
      // fall back to Home instead of rendering a blank screen inside the shell.
      { path: '*', element: <Navigate to="/home" replace /> },
    ],
  },
]);
