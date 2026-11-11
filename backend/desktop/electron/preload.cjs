// Preload script — exposes a safe IPC bridge to the renderer
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Google Authentication ──────────────────────────────────────────────
  // System-browser OAuth (loopback + PKCE + client secret); refresh tokens stay in main.
  googleSignIn: (options) => ipcRenderer.invoke('auth:google-signin', options),
  googleCancelSignIn: () => ipcRenderer.invoke('auth:google-cancel'),
  googleReopenSignIn: () => ipcRenderer.invoke('auth:google-reopen'),
  googleRefreshToken: (options) => ipcRenderer.invoke('auth:google-refresh', options),
  googleSignOut: (options) => ipcRenderer.invoke('auth:google-signout', options),

  // ── 3DS Authentication ─────────────────────────────────────────────────
  open3DSPopup: (url) => ipcRenderer.invoke('open-3ds-popup', url),
  on3DSComplete: (callback) => {
    ipcRenderer.on('3ds-complete', (_event, result) => callback(result));
  },
  removeAll3DSListeners: () => {
    ipcRenderer.removeAllListeners('3ds-complete');
  },

  // ── Platform ───────────────────────────────────────────────────────────
  getPlatform: () => 'electron',

  // ── File Dialogs ───────────────────────────────────────────────────────
  showSaveDialog: (options) => ipcRenderer.invoke('dialog:save', options),
  showOpenDialog: (options) => ipcRenderer.invoke('dialog:open', options),

  // ── File I/O ───────────────────────────────────────────────────────────
  readFile: (filePath, encoding) => ipcRenderer.invoke('fs:read', filePath, encoding),
  writeFile: (filePath, data, encoding) => ipcRenderer.invoke('fs:write', filePath, data, encoding),
  appendFile: (filePath, data, encoding) => ipcRenderer.invoke('fs:append', filePath, data, encoding),
  listDir: (dirPath) => ipcRenderer.invoke('fs:list-dir', dirPath),
  getAppPath: (name) => ipcRenderer.invoke('app:getPath', name),

  // ── Secure Storage (OS keychain via Electron safeStorage) ─────────────
  secureGet: (service, account) => ipcRenderer.invoke('secure:get', service, account),
  secureSet: (service, account, password) => ipcRenderer.invoke('secure:set', service, account, password),
  secureDelete: (service, account) => ipcRenderer.invoke('secure:delete', service, account),
  secureIsAvailable: () => ipcRenderer.invoke('secure:isAvailable'),

  // ── Database (better-sqlite3 — to be added in Phase 11) ───────────────
  dbExec: (sql) => ipcRenderer.invoke('db:exec', sql),
  dbRun: (sql, params) => ipcRenderer.invoke('db:run', sql, params),
  dbQuery: (sql, params) => ipcRenderer.invoke('db:query', sql, params),
  dbGet: (sql, params) => ipcRenderer.invoke('db:get', sql, params),

  // ── Persistent Storage (replaces localStorage for app:// protocol) ────
  storage: {
    getItem: (key) => ipcRenderer.invoke('storage:getItem', key),
    setItem: (key, value) => ipcRenderer.invoke('storage:setItem', key, value),
    removeItem: (key) => ipcRenderer.invoke('storage:removeItem', key),
    clear: () => ipcRenderer.invoke('storage:clear'),
    getAllKeys: () => ipcRenderer.invoke('storage:getAllKeys'),
    key: (index) => ipcRenderer.invoke('storage:key', index),
    length: () => ipcRenderer.invoke('storage:length'),
  },

  // ── Crypto (Node built-in — works on all platforms) ───────────────────
  sha512: (text) => ipcRenderer.invoke('crypto:sha512', text),

  // ── Consulta Pública MH proxy (bypasses renderer CORS in dev) ─────────
  consultaPublicaFetch: (url) => ipcRenderer.invoke('consulta-publica:fetch', url),

  // ── MH DTE submission proxy (bypasses renderer CORS in dev) ───────────
  mhFetch: (config) => ipcRenderer.invoke('mh:fetch', config),

  // ── SparkleWash carwash API proxy + SSE bridge ────────────────────────
  carwashFetch: (config) => ipcRenderer.invoke('carwash:fetch', config),
  carwashEventsStart: (config) => ipcRenderer.invoke('carwash:events-start', config),
  carwashEventsStop: () => ipcRenderer.invoke('carwash:events-stop'),
  onCarwashEvent: (callback) => {
    const listener = (_event, msg) => callback(msg);
    ipcRenderer.on('carwash:event', listener);
    return () => ipcRenderer.removeListener('carwash:event', listener);
  },
  removeCarwashEventListeners: () => ipcRenderer.removeAllListeners('carwash:event'),

  // ── Azure OpenAI proxy (vision OCR for compras) ───────────────────────
  // Routes the call through the main process so the API key never lands in
  // the renderer's network panel and so we sidestep CORS in Vite dev.
  azureOpenAiFetch: (config) => ipcRenderer.invoke('azure-openai:fetch', config),

  // ── Ollama proxy (local vision OCR for compras) ───────────────────────
  // Same purpose as the Azure bridge but targets Ollama's localhost server
  // (no API key, no key whitelist needed). Restricted to localhost variants
  // so the renderer can't repurpose the bridge for arbitrary HTTP.
  ollamaFetch: (config) => ipcRenderer.invoke('ollama:fetch', config),

  // ── IMAP sync (free tier alt to Gmail API — no cloud dependency) ──────
  imapTestConnection: (config) => ipcRenderer.invoke('imap:test-connection', config),
  imapFetchAttachments: (config) => ipcRenderer.invoke('imap:fetch-attachments', config),

  // ── PDF Generation ─────────────────────────────────────────────────────
  printToPDF: (html, options) => ipcRenderer.invoke('pdf:generate', html, options),

  // ── POS thermal printing (ESC/POS) ────────────────────────────────────
  printerList: () => ipcRenderer.invoke('printer:list'),
  printerStatus: (config) => ipcRenderer.invoke('printer:status', config),
  printerPrint: (config, payload) => ipcRenderer.invoke('printer:print', config, payload),
  printerDiagnose: (config) => ipcRenderer.invoke('printer:diagnose', config),

  // ── Menu Events ────────────────────────────────────────────────────────
  onMenuEvent: (channel, callback) => {
    ipcRenderer.on(channel, (_event, ...args) => callback(...args));
  },
  removeMenuListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },
});
