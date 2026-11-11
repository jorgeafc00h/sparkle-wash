/// <reference types="vite/client" />

interface GoogleClientCredentials {
  clientId: string;
  clientSecret: string;
}

interface GoogleSignInOptions extends GoogleClientCredentials {
  /** Extra scopes beyond `openid email profile` (allow-listed in main). */
  scopes?: string[];
  loginHint?: string;
}

interface GoogleTokenResult {
  idToken?: string;
  accessToken: string;
  /** Space-separated scopes Google actually granted (granular consent). */
  scope: string;
  expiresIn: number;
  accountId: string;
  email?: string;
}

interface ElectronAPI {
  // Google Authentication — system browser + loopback, PKCE + client secret
  // (Google's token endpoint requires the Desktop client's secret). Refresh
  // tokens never reach the renderer: they live in the main-process keychain.
  googleSignIn: (options: GoogleSignInOptions) => Promise<GoogleTokenResult | { error: string }>;
  googleCancelSignIn?: () => Promise<boolean>;
  googleReopenSignIn?: () => Promise<boolean>;
  googleRefreshToken?: (options: GoogleClientCredentials & { accountId: string; scope?: string }) =>
    Promise<GoogleTokenResult | { error: string; reauthRequired?: boolean }>;
  googleSignOut: (options?: { accountId?: string; revoke?: boolean }) => Promise<{ success: boolean }>;

  // 3DS Authentication
  open3DSPopup: (url: string) => Promise<void>;
  on3DSComplete: (callback: (result: { status: string }) => void) => void;
  removeAll3DSListeners: () => void;

  // Platform
  getPlatform: () => 'electron' | 'web';

  // File dialogs
  showSaveDialog: (options: {
    title?: string;
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }) => Promise<string | null>;
  showOpenDialog: (options: {
    title?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
    properties?: Array<'openFile' | 'openDirectory' | 'multiSelections'>;
  }) => Promise<string[] | null>;

  // File I/O
  readFile: (filePath: string, encoding?: string) => Promise<string>;
  writeFile: (filePath: string, data: string, encoding?: string) => Promise<void>;
  appendFile: (filePath: string, data: string, encoding?: string) => Promise<void>;
  listDir: (dirPath: string) => Promise<string[]>;
  getAppPath: (name: 'documents' | 'userData' | 'temp') => Promise<string>;

  // Secure storage (keytar)
  secureGet: (service: string, account: string) => Promise<string | null>;
  secureSet: (service: string, account: string, password: string) => Promise<void>;
  secureDelete: (service: string, account: string) => Promise<boolean>;

  // Database (better-sqlite3)
  dbExec: (sql: string) => Promise<void>;
  dbRun: (sql: string, params?: unknown[]) => Promise<{ changes: number; lastInsertRowid: number }>;
  dbQuery: (sql: string, params?: unknown[]) => Promise<unknown[]>;
  dbGet: (sql: string, params?: unknown[]) => Promise<unknown | undefined>;

  // PDF generation
  printToPDF: (html: string, options?: { landscape?: boolean; pageSize?: string }) => Promise<Uint8Array>;

  // Consulta Pública MH proxy — avoids renderer CORS in dev
  consultaPublicaFetch?: (url: string) => Promise<{
    ok: boolean;
    status: number;
    body?: string;
    error?: string;
  }>;

  // MH DTE submission proxy — avoids renderer CORS in dev
  mhFetch?: (config: {
    url: string;
    method?: 'POST';
    headers?: Record<string, string>;
    body: unknown;
  }) => Promise<{
    ok: boolean;
    status: number;
    body?: string;
    error?: string;
    /** Non-sensitive failure class from electron/mhProxy.cjs (timeout, dns, tls, redirect…). */
    errorKind?: string;
    errorCode?: string;
  }>;

  // Azure OpenAI proxy — keeps API key out of the renderer's network panel
  // and bypasses CORS in dev. The main process whitelists the host suffix
  // so callers can't repurpose the bridge.
  azureOpenAiFetch?: (config: {
    url: string;
    apiKey: string;
    body: unknown;
  }) => Promise<{
    ok: boolean;
    status: number;
    body?: string;
    error?: string;
  }>;

  // Ollama local-server proxy — same purpose as the Azure bridge but
  // restricted to localhost / 127.0.0.1 / *.local hosts.
  ollamaFetch?: (config: {
    url: string;
    body: unknown;
  }) => Promise<{
    ok: boolean;
    status: number;
    body?: string;
    error?: string;
  }>;

  // IMAP sync — free tier alt to Gmail API (no cloud dependency)
  imapTestConnection?: (config: {
    user: string;
    password: string;
    host?: string;
    port?: number;
    tls?: boolean;
  }) => Promise<{ ok: boolean; host?: string; port?: number; error?: string }>;

  imapFetchAttachments?: (config: {
    user: string;
    password: string;
    host?: string;
    port?: number;
    tls?: boolean;
    afterDate?: string;
  }) => Promise<{
    ok: boolean;
    error?: string;
    /** Messages over the size cap / that mailparser could not read (not fatal). */
    skippedTooLarge?: number;
    unreadable?: number;
    messages: Array<{
      uid: number;
      messageId: string;
      date?: string;
      subject?: string;
      attachments: Array<{
        filename: string;
        kind: 'json' | 'txt' | 'pdf';
        size: number;
        contentBase64: string;
      }>;
    }>;
  }>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
