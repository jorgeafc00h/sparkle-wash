// Central export for all types

// Core entity types
export * from './invoice';
export * from './customer';
export * from './product';
export * from './company';
export * from './catalog';
export * from './dte';
export * from './email';
export * from './promo';
export * from './purchase';
export * from './chat';
export * from './accounts';

// API and service types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: string[];
  pagination?: PaginationInfo;
}

export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface ApiError {
  message: string;
  statusCode: number;
  code?: string;
  details?: unknown;
}

// Common utility types
export interface SelectOption {
  label: string;
  value: string | number;
  disabled?: boolean;
  icon?: string;
}

export interface ListItem {
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  imageUrl?: string;
  icon?: string;
  badge?: string;
  isActive?: boolean;
}

// Form types
export interface FormField {
  name: string;
  label: string;
  type: 'text' | 'email' | 'password' | 'number' | 'date' | 'select' | 'multiselect' | 'textarea';
  placeholder?: string;
  required?: boolean;
  validation?: ValidationRule[];
  options?: SelectOption[];
  disabled?: boolean;
  hidden?: boolean;
}

export interface ValidationRule {
  type: 'required' | 'email' | 'min' | 'max' | 'pattern' | 'custom';
  value?: unknown;
  message: string;
}

export interface FormState {
  values: { [key: string]: unknown };
  errors: { [key: string]: string };
  touched: { [key: string]: boolean };
  isValid: boolean;
  isSubmitting: boolean;
}

// Auth state types
export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isGuestMode: boolean;
  hasCompletedOnboarding: boolean;
  loading: boolean;
  error: string | null;
  token: string | null;
  refreshToken: string | null;
  selectedCompanyId: string | null;
  linkedProviders: AuthProvider[];
  providerLinking: AuthProviderLinkingState | null;
}

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  avatar?: string;
  isEmailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type AuthProvider = 'google' | 'apple' | 'email' | string;

export interface AuthProviderLinkingState {
  required: boolean;
  provider: AuthProvider;
  email?: string;
  message: string;
  linkToken?: string;
}

export interface AppState {
  isInitialized: boolean;
  isOnline: boolean;
  currentTheme: 'light' | 'dark' | 'system';
  language: string;
  environment: 'development' | 'production';
  isUITesting: boolean;
  lastSyncDate?: string;
  syncStatus: 'idle' | 'syncing' | 'success' | 'error';
  notifications: AppNotification[];
}

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  timestamp: string;
  read: boolean;
  actionUrl?: string;
}

// Storage types
export interface StorageKeys {
  AUTH_TOKEN: 'auth_token';
  REFRESH_TOKEN: 'refresh_token';
  SELECTED_COMPANY: 'selected_company';
  USER_PREFERENCES: 'user_preferences';
  CATALOG_SYNC_DATE: 'catalog_sync_date';
  OFFLINE_DATA: 'offline_data';
}

export interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  language: string;
  notifications: {
    push: boolean;
    email: boolean;
    invoice: boolean;
    sync: boolean;
  };
  display: {
    currency: string;
    dateFormat: string;
    timeFormat: string;
  };
}

// Sync types
export interface SyncStatus {
  lastSyncDate?: Date;
  isOnline: boolean;
  pendingUploads: number;
  pendingDownloads: number;
  errors: SyncError[];
}

export interface SyncError {
  id: string;
  type: 'UPLOAD' | 'DOWNLOAD' | 'VALIDATION';
  entityType: 'INVOICE' | 'CUSTOMER' | 'PRODUCT' | 'CATALOG';
  entityId: string;
  message: string;
  timestamp: Date;
  retryCount: number;
}

// File and media types
export interface FileUpload {
  id: string;
  name: string;
  size: number;
  type: string;
  uri: string;
  base64?: string;
  uploadProgress: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
}
