const { app, BrowserWindow, Menu, dialog, globalShortcut, protocol, net, ipcMain, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const url = require('url');
const https = require('https');
const { execFile } = require('child_process');
const { createGoogleOAuthService } = require('./googleOAuthService.cjs');
const { imapAutoDetect, collectDteAttachments } = require('./imapAttachments.cjs');
const { mhFetch } = require('./mhProxy.cjs');
const { carwashFetch, startCarwashEvents } = require('./carwashProxy.cjs');

// Register app:// as a privileged secure scheme so Chromium grants the renderer
// a secure context (window.crypto.subtle) even when loaded via the custom
// protocol. Must be called synchronously at module load, before app.whenReady().
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

// Load .env for the Electron main process. Vite loads .env for the renderer,
// but the main process runs under Node and needs dotenv explicitly so IPC
// handlers (Google OAuth, etc.) can read VITE_* variables.
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
} catch (err) {
  console.warn('[Main] dotenv not available:', err.message);
}

// ── Identity / data isolation ──────────────────────────────────────────────
// SparkleWash must never share userData, safeStorage keychain entries or storage
// with an installed Facturas Simples app. Set the name and pin userData BEFORE
// anything calls app.getPath('userData') (storage/secrets paths are computed at
// module load below). The safeStorage keychain item is derived from the app name
// ("SparkleWash Safe Storage").
app.setName('SparkleWash');
// An explicit --user-data-dir (Playwright e2e, support) wins over the pinned default.
if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', path.join(app.getPath('appData'), 'SparkleWash'));
}
if (process.platform === 'darwin' || process.platform === 'win32') {
  try { app.setAboutPanelOptions({ applicationName: 'Car Spa', applicationVersion: app.getVersion(), copyright: 'Car Spa' }); } catch { /* optional */ }
}

let mainWindow;
let autoUpdater = null;
const isDev = !app.isPackaged;
// DevTools let anyone at the keyboard edit persisted state — e.g. switch off
// local-user control or read the PIN hashes — so installed builds disable them.
// Support can re-enable for a session with FS_ENABLE_DEVTOOLS=1.
const devToolsEnabled = isDev || process.env.FS_ENABLE_DEVTOOLS === '1';
const dialogApprovedFiles = new Set();
const dialogApprovedDirectories = new Set();

function rememberApprovedPath(filePath) {
  if (!filePath || typeof filePath !== 'string') return;
  const resolved = path.resolve(filePath);
  dialogApprovedFiles.add(resolved);
}

function rememberApprovedDirectory(dirPath) {
  if (!dirPath || typeof dirPath !== 'string') return;
  dialogApprovedDirectories.add(path.resolve(dirPath));
}

function isPathInside(childPath, parentPath) {
  const child = path.resolve(childPath);
  const parent = path.resolve(parentPath);
  const rel = path.relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function assertAllowedFilePath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Ruta inválida');
  }
  const resolved = path.resolve(filePath);
  const userData = path.resolve(app.getPath('userData'));
  if (isPathInside(resolved, userData)) return resolved;
  if (dialogApprovedFiles.has(resolved)) return resolved;
  for (const dir of dialogApprovedDirectories) {
    if (isPathInside(resolved, dir)) return resolved;
  }
  throw new Error('Ruta no autorizada. Seleccione el archivo mediante el diálogo de la aplicación.');
}

function assertAllowedDirectoryPath(dirPath) {
  if (!dirPath || typeof dirPath !== 'string') {
    throw new Error('Ruta inválida');
  }
  const resolved = path.resolve(dirPath);
  const userData = path.resolve(app.getPath('userData'));
  if (isPathInside(resolved, userData)) return resolved;
  if (dialogApprovedDirectories.has(resolved)) return resolved;
  throw new Error('Directorio no autorizado. Seleccione la ruta mediante el diálogo de la aplicación.');
}

// In dev mode, mirror all main-process + renderer log/warn/error output to a
// stable file path so external tooling can tail it. Production builds keep
// console-only behaviour.
const DEBUG_LOG_PATH = '/tmp/fs-electron-debug.log';
let debugLogStream = null;
if (isDev) {
  try {
    const fs = require('fs');
    debugLogStream = fs.createWriteStream(DEBUG_LOG_PATH, { flags: 'a' });
    debugLogStream.write(`\n=== session start ${new Date().toISOString()} ===\n`);
  } catch (err) {
    console.warn('[Main] debug log file unavailable:', err.message);
  }
}

const log = (...args) => {
  console.log('[Main]', ...args);
  if (debugLogStream) {
    const line = `[${new Date().toISOString()}] [Main] ${args
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ')}\n`;
    debugLogStream.write(line);
  }
};

// Bare MIME types only — no "; charset=..." suffix. Electron copies `mimeType`
// verbatim into the navigation's mime type, and Chromium does not recognise
// "text/html; charset=utf-8" as HTML, so the packaged app rendered index.html
// as plain text (stuck showing the page source). Charset goes in `charset`.
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.cjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

const UTF8_MIME_TYPES = new Set(['text/html', 'application/javascript', 'text/css', 'application/json', 'image/svg+xml']);

function isLikelyHtmlRoute(pathname) {
  return !path.basename(pathname).includes('.');
}

function resolveMimeType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

// ── Auto-updater (fail-safe) ───────────────────────────────────────────────
// macOS: Squirrel.Mac only installs an update for an app that carries a real Developer ID
// signature. CI builds made without the signing secrets are ad-hoc signed, so the install
// step fails after the download and the user silently stays on their old version. For
// those builds skip the background install and point the user at the stable DMG instead.
// The updater is opt-in: it only starts when a SparkleWash feed is configured, either
// at runtime with SPARKLEWASH_UPDATE_URL (generic provider) or baked at build time via a
// `publish` config (electron-builder then ships resources/app-update.yml). This build never
// points at the Facturas Simples feed.
let manualUpdateOnly = false;
const UPDATE_FEED_URL = (process.env.SPARKLEWASH_UPDATE_URL || '').trim();
const bakedFeedConfigured = () => {
  try { return fs.existsSync(path.join(process.resourcesPath || '', 'app-update.yml')); } catch { return false; }
};
const updateChannelConfigured = () => Boolean(UPDATE_FEED_URL) || bakedFeedConfigured();
// Feed base for the manual macOS download: the runtime override, else the `url:` that
// electron-builder baked into resources/app-update.yml from builder.config.json `publish`.
const bakedFeedUrl = () => {
  try {
    const yml = fs.readFileSync(path.join(process.resourcesPath || '', 'app-update.yml'), 'utf8');
    const m = /^url:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(yml);
    return m ? m[1] : '';
  } catch { return ''; }
};
const macDownloadUrl = () => {
  const feed = UPDATE_FEED_URL || bakedFeedUrl();
  return feed ? `${feed.replace(/\/+$/, '')}/SparkleWash-latest-mac.dmg` : null;
};

const isAdHocSignedMacApp = () =>
  new Promise((resolve) => {
    if (process.platform !== 'darwin') return resolve(false);
    const bundlePath = path.resolve(process.execPath, '..', '..', '..');
    // codesign prints its details on stderr; an error means the bundle is not signed at all.
    execFile('/usr/bin/codesign', ['-dv', bundlePath], (err, _stdout, stderr) => {
      resolve(Boolean(err) || /Signature=adhoc|TeamIdentifier=not set/.test(stderr));
    });
  });

function initAutoUpdater() {
  if (autoUpdater) return autoUpdater;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
    if (UPDATE_FEED_URL) autoUpdater.setFeedURL({ provider: 'generic', url: UPDATE_FEED_URL });
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-available', (info) => {
      log('Update available:', info.version);
      if (!manualUpdateOnly || !mainWindow) return;
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Actualización disponible',
        message: `Car Spa ${info.version} está disponible.`,
        detail: 'Descarga el instalador y arrástralo a Aplicaciones para reemplazar la versión actual. Tus datos se conservan.',
        buttons: ['Descargar', 'Más tarde'],
        defaultId: 0,
      }).then(({ response }) => {
        const dl = macDownloadUrl();
        if (response === 0 && dl) shell.openExternal(dl);
      });
    });
    autoUpdater.on('update-downloaded', (info) => {
      log('Update downloaded:', info.version);
      if (mainWindow) {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Actualización disponible',
          message: `Versión ${info.version} descargada.`,
          detail: 'Se instalará al cerrar la aplicación. ¿Reiniciar ahora?',
          buttons: ['Reiniciar ahora', 'Más tarde'],
          defaultId: 0,
        }).then(({ response }) => {
          if (response === 0) autoUpdater.quitAndInstall(false, true);
        });
      }
    });
    autoUpdater.on('error', (err) => log('Updater error:', err.message));
  } catch (err) {
    log('electron-updater not available:', err.message);
    autoUpdater = null;
  }
  return autoUpdater;
}

// ── Register custom protocol to serve dist/ as a local web server ──────────
function setupLocalServing() {
  const distPath = path.join(__dirname, '..', 'dist');
  log('dist path:', distPath);

  protocol.registerBufferProtocol('app', (request, callback) => {
    try {
      const reqUrl = new URL(request.url);
      let requestPath = decodeURIComponent(reqUrl.pathname || '/');
      if (requestPath.startsWith('/')) requestPath = requestPath.slice(1);

      let relativePath = requestPath || 'index.html';
      const isReservedOriginPath =
        relativePath === 'api' ||
        relativePath.startsWith('api/') ||
        relativePath === 'chathub' ||
        relativePath.startsWith('chathub/');

      const directCandidate = path.join(distPath, relativePath);
      if (!fs.existsSync(directCandidate) && !isReservedOriginPath && isLikelyHtmlRoute(relativePath)) {
        relativePath = 'index.html';
      }

      const fullPath = path.resolve(path.join(distPath, relativePath));
      const normalizedDist = path.resolve(distPath);
      if (!isPathInside(fullPath, normalizedDist)) {
        log('Blocked path:', fullPath);
        callback({ statusCode: 403, mimeType: 'text/plain', data: Buffer.from('Forbidden', 'utf-8') });
        return;
      }

      fs.readFile(fullPath, (err, data) => {
        if (err) {
          log('Protocol read error:', err.message, fullPath);
          callback({
            statusCode: 404,
            mimeType: 'text/plain',
            charset: 'utf-8',
            data: Buffer.from('Not Found', 'utf-8'),
          });
          return;
        }

        const mimeType = resolveMimeType(fullPath);
        callback({
          statusCode: 200,
          mimeType,
          ...(UTF8_MIME_TYPES.has(mimeType) ? { charset: 'utf-8' } : {}),
          headers: {
            'Access-Control-Allow-Origin': '*',
          },
          data,
        });
      });
    } catch (err) {
      log('Protocol handler error:', err.message);
      callback({ statusCode: 500, mimeType: 'text/plain', data: Buffer.from('Internal Error', 'utf-8') });
    }
  });
}

// ── Error page ─────────────────────────────────────────────────────────────
function errorPageHTML(errorMsg) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body { font-family: 'IBM Plex Sans', 'Segoe UI', sans-serif; background: #fef2f2; color: #991b1b;
    display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .box { text-align: center; max-width: 520px; padding: 40px; }
  h2 { margin-bottom: 12px; }
  pre { background: #fee2e2; padding: 12px; border-radius: 8px; font-size: 11px;
    text-align: left; overflow-x: auto; margin: 16px 0; white-space: pre-wrap; word-break: break-all; }
  p { color: #7f1d1d; font-size: 14px; }
  .hint { color: #9ca3af; font-size: 11px; margin-top: 20px; }
</style></head><body>
<div class="box">
  <h2>Error al iniciar</h2>
  <p>La aplicación no pudo cargar correctamente.</p>
  <pre>${errorMsg}</pre>
  <p>Presione <strong>Ctrl+Shift+I</strong> para ver detalles técnicos.</p>
  <div class="hint">userData: ${app.getPath('userData')}</div>
</div></body></html>`)}`;
}

// ── App Menu ───────────────────────────────────────────────────────────────
function createAppMenu() {
  const template = [
    {
      label: 'Archivo',
      submenu: [
        { label: 'Nueva Factura', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('menu:new-invoice') },
        { label: 'Nuevo Cliente', accelerator: 'CmdOrCtrl+Shift+N', click: () => mainWindow?.webContents.send('menu:new-customer') },
        { type: 'separator' },
        { label: 'Exportar...', accelerator: 'CmdOrCtrl+E', click: () => mainWindow?.webContents.send('menu:export') },
        { type: 'separator' },
        { label: 'Salir', accelerator: 'CmdOrCtrl+Q', role: 'quit' },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { label: 'Deshacer', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Rehacer', accelerator: 'CmdOrCtrl+Shift+Z', role: 'redo' },
        { type: 'separator' },
        { label: 'Cortar', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Copiar', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Pegar', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: 'Seleccionar todo', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { label: 'Recargar', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: 'Forzar recarga', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
        { type: 'separator' },
        { label: 'Acercar', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
        { label: 'Alejar', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: 'Tamaño real', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        ...(devToolsEnabled
          ? [
              { type: 'separator' },
              { label: 'Herramientas de desarrollo', accelerator: 'F12', role: 'toggleDevTools' },
            ]
          : []),
      ],
    },
    {
      label: 'Ayuda',
      submenu: [
        { label: 'Manual de usuario', click: () => shell.openExternal('https://polite-ocean-090c2fd10.6.azurestaticapps.net/docs/manual/') },
        { type: 'separator' },
        { label: `Acerca de Car Spa v${app.getVersion()}`, enabled: false },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ── Window ─────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 375,
    minHeight: 667,
    title: 'Car Spa',
    show: false,
    icon: path.join(__dirname, '..', 'public', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      scrollBounce: true,
      preload: path.join(__dirname, 'preload.cjs'),
      devTools: devToolsEnabled,
    },
    backgroundColor: '#f8fafc',
  });

  // Error handlers
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log('Renderer crashed:', details.reason);
    mainWindow.loadURL(errorPageHTML(`Renderer crash: ${details.reason}`));
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    log('Load failed:', errorCode, errorDescription, validatedURL);
    if (errorCode === -3) return; // ERR_ABORTED — navigation cancelled
    mainWindow.loadURL(errorPageHTML(`Load failed (${errorCode}): ${errorDescription}\nURL: ${validatedURL}`));
  });

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    // Surface WARN/ERROR to the main-process console as before.
    if (level >= 2) log(`[Renderer ${level === 2 ? 'WARN' : 'ERROR'}] ${message}`);
    // Mirror EVERY renderer console message to the debug log file so external
    // tooling can correlate with main-process events. Includes log/info too —
    // we want full context when diagnosing MH submission failures.
    if (debugLogStream) {
      const levelName = ['LOG', 'INFO', 'WARN', 'ERROR'][level] ?? `L${level}`;
      const where = sourceId ? `${sourceId}:${line}` : '';
      debugLogStream.write(
        `[${new Date().toISOString()}] [Renderer ${levelName}] ${message}${where ? ' (' + where + ')' : ''}\n`,
      );
    }
  });

  // In development, load from Vite dev server; in production, use app:// protocol.
  // FORCE_APP_PROTOCOL=1 forces the app:// path even in dev — test-only flag used
  // by playwright/tests/electron/01b-validate-certificate-packaged.spec.ts to
  // exercise the packaged-build code path without a full electron-builder run.
  if (isDev && process.env.FORCE_APP_PROTOCOL !== '1') {
    log('Loading from Vite dev server');
    // UI-test runs pass --uitesting (see playwright/fixtures/electron-launch.ts):
    // the renderer reads the flag and disables telemetry/ads for hermetic tests.
    const uitesting = process.argv.includes('--uitesting') ? '/?uitesting=1' : '';
    mainWindow.loadURL('http://localhost:5173' + uitesting);
  } else {
    log('Loading app via app:// protocol');
    mainWindow.loadURL('app://dist/index.html');
  }

  // Show window only after first paint — eliminates white flash
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Open all external links (target="_blank") in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://') || url.startsWith('mailto:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    const allowed =
      targetUrl.startsWith('app://dist/') ||
      (isDev && targetUrl.startsWith('http://localhost:5173'));
    if (!allowed) {
      event.preventDefault();
      if (
        targetUrl.startsWith('https://') ||
        targetUrl.startsWith('http://') ||
        targetUrl.startsWith('mailto:')
      ) {
        shell.openExternal(targetUrl);
      }
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
  log('userData:', app.getPath('userData'));
}

// ── IPC Handlers ──────────────────────────────────────────────────────────

// ── Persistent Storage (IPC bridge for app:// protocol) ─────────────────
// On Windows, localStorage is denied for custom protocols like app://
// This provides a file-backed key-value store accessible via preload bridge

const storagePath = path.join(app.getPath('userData'), 'app-storage.json');
let storageCache = {};

// Crash-safe JSON files: write a temp file, keep the previous good copy as
// `.bak`, then rename over the target (rename replaces atomically on the same
// volume). A plain writeFileSync truncates first — a power cut mid-write left a
// half-written file that the next launch parsed as "empty" and then overwrote.
function writeJsonFileAtomicSync(filePath, data, mode) {
  const tmpPath = `${filePath}.tmp`;
  const options = mode ? { encoding: 'utf-8', mode } : 'utf-8';
  fs.writeFileSync(tmpPath, data, options);
  try {
    if (fs.existsSync(filePath)) fs.copyFileSync(filePath, `${filePath}.bak`);
  } catch (err) {
    log('Backup copy failed:', err.message);
  }
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    // Windows can refuse the replace while antivirus/indexers hold the file.
    log('Atomic rename failed, writing in place:', err.message);
    fs.writeFileSync(filePath, data, options);
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

// Reads a JSON store; a corrupt file is moved aside (never silently replaced)
// and the `.bak` copy is used instead.
function readJsonFileWithBackupSync(filePath, label) {
  for (const candidate of [filePath, `${filePath}.bak`]) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
      if (parsed && typeof parsed === 'object') {
        if (candidate !== filePath) log(`${label}: recovered from backup ${candidate}`);
        return parsed;
      }
    } catch (err) {
      const aside = `${candidate}.corrupt-${Date.now()}`;
      log(`${label}: ${candidate} unreadable (${err.message}); moved to ${aside}`);
      try { fs.renameSync(candidate, aside); } catch { /* ignore */ }
    }
  }
  return {};
}

function loadStorageSync() {
  storageCache = readJsonFileWithBackupSync(storagePath, 'Storage');
}

let flushTimer = null;
function writeStorageNow() {
  try {
    writeJsonFileAtomicSync(storagePath, JSON.stringify(storageCache));
  } catch (err) {
    log('Storage flush error:', err.message);
  }
}
function flushStorage() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    writeStorageNow();
  }, 100);
}
// Quitting within the 100 ms debounce used to drop the last write.
function flushStorageSync() {
  if (!flushTimer) return;
  clearTimeout(flushTimer);
  flushTimer = null;
  writeStorageNow();
}

// ── Secure Storage ─────────────────────────────────────────────────────────
// Uses Electron safeStorage (OS-level encryption: macOS Keychain, Windows
// DPAPI, libsecret on Linux). Ciphertext is persisted next to the regular
// storage file so secrets survive restarts. Falls back to plaintext only when
// safeStorage reports unavailable (rare — mostly headless Linux sessions).
const secretsPath = path.join(app.getPath('userData'), 'secrets.json');
let secretsCache = readJsonFileWithBackupSync(secretsPath, 'Secrets');
let secretsFlushTimer = null;
function writeSecretsNow() {
  try {
    writeJsonFileAtomicSync(secretsPath, JSON.stringify(secretsCache), 0o600);
  } catch (err) {
    log('Secrets flush error:', err.message);
  }
}
function flushSecrets() {
  clearTimeout(secretsFlushTimer);
  secretsFlushTimer = setTimeout(() => {
    secretsFlushTimer = null;
    writeSecretsNow();
  }, 100);
}
function flushSecretsSync() {
  if (!secretsFlushTimer) return;
  clearTimeout(secretsFlushTimer);
  secretsFlushTimer = null;
  writeSecretsNow();
}
function secretKey(service, account) {
  return `${service || 'default'}::${account || 'default'}`;
}
function secureSetValue(service, account, password) {
  if (!password) return false;
  const key = secretKey(service, account);
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      const buf = safeStorage.encryptString(String(password));
      secretsCache[key] = { enc: true, v: buf.toString('base64') };
    } else {
      // Degraded mode — persist plaintext so the feature still works but flag it
      secretsCache[key] = { enc: false, v: String(password) };
      log('safeStorage unavailable; secret stored unencrypted:', key);
    }
    flushSecrets();
    return true;
  } catch (err) {
    log('secure:set error:', err.message);
    return false;
  }
}
function secureGetValue(service, account) {
  const key = secretKey(service, account);
  const entry = secretsCache[key];
  if (!entry) return null;
  try {
    if (entry.enc && safeStorage && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(entry.v, 'base64'));
    }
    return entry.v;
  } catch (err) {
    log('secure:get error:', err.message);
    return null;
  }
}
function secureDeleteValue(service, account) {
  delete secretsCache[secretKey(service, account)];
  flushSecrets();
  return true;
}
// Google refresh tokens (googleOAuthService, service 'google-oauth') never leave
// the main process — the renderer's generic keychain bridge can't read or
// overwrite them.
const MAIN_ONLY_SECRET_SERVICES = new Set(['google-oauth']);
const rendererMaySecret = (service) => typeof service === 'string' && !MAIN_ONLY_SECRET_SERVICES.has(service);
ipcMain.handle('secure:set', (_event, service, account, password) =>
  rendererMaySecret(service) ? secureSetValue(service, account, password) : false);
ipcMain.handle('secure:get', (_event, service, account) =>
  rendererMaySecret(service) ? secureGetValue(service, account) : null);
ipcMain.handle('secure:delete', (_event, service, account) =>
  rendererMaySecret(service) ? secureDeleteValue(service, account) : false);
ipcMain.handle('secure:isAvailable', () => {
  try {
    return !!(safeStorage && safeStorage.isEncryptionAvailable());
  } catch {
    return false;
  }
});

ipcMain.handle('storage:getItem', (_event, key) => storageCache[key] ?? null);
// Each redux slice / per-company database is ONE key (all invoices, all tickets…),
// so the cap must leave room for years of data: 5 MB was ~2,000 CCFs, after which
// every write failed and new documents vanished on restart. Failures now surface
// in the renderer (storageHealth) instead of being swallowed.
const MAX_STORAGE_VALUE_BYTES = 64 * 1024 * 1024;
ipcMain.handle('storage:setItem', (_event, key, value) => {
  if (typeof value !== 'string') throw new Error('storage:setItem expects a string value');
  if (Buffer.byteLength(value, 'utf8') > MAX_STORAGE_VALUE_BYTES) {
    throw new Error(`storage value exceeds ${MAX_STORAGE_VALUE_BYTES} bytes`);
  }
  storageCache[key] = value;
  flushStorage();
});
ipcMain.handle('storage:removeItem', (_event, key) => { delete storageCache[key]; flushStorage(); });
ipcMain.handle('storage:clear', () => { storageCache = {}; flushStorage(); });
ipcMain.handle('storage:getAllKeys', () => Object.keys(storageCache));
ipcMain.handle('storage:key', (_event, index) => Object.keys(storageCache)[index] ?? null);
ipcMain.handle('storage:length', () => Object.keys(storageCache).length);

// ── Google OAuth (system browser + loopback, see googleOAuthService.cjs) ──

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (process.platform === 'darwin') app.focus({ steal: true });
}

const googleOAuth = createGoogleOAuthService({
  openExternal: (authUrl) => shell.openExternal(authUrl),
  secrets: { get: secureGetValue, set: secureSetValue, delete: secureDeleteValue },
  log,
  onBrowserReturned: focusMainWindow,
});

// The renderer passes the client id/secret: process.env.VITE_* is not
// available in the packaged main process (.env is not shipped). In dev the
// main process also reads them from .env/.env.local via dotenv.
function withClientCredentials(options) {
  return {
    ...(options || {}),
    clientId: options?.clientId || process.env.VITE_GOOGLE_CLIENT_ID || '',
    clientSecret: options?.clientSecret || process.env.VITE_GOOGLE_CLIENT_SECRET || '',
  };
}
ipcMain.handle('auth:google-signin', (_event, options) => googleOAuth.signIn(withClientCredentials(options)));
ipcMain.handle('auth:google-cancel', () => googleOAuth.cancel());
ipcMain.handle('auth:google-reopen', () => googleOAuth.reopen());
ipcMain.handle('auth:google-refresh', (_event, options) => googleOAuth.refresh(withClientCredentials(options)));
ipcMain.handle('auth:google-signout', (_event, options) => googleOAuth.signOut(options));

// ── 3DS Authentication Popup ──────────────────────────────────────────────

// 3DS Authentication Popup
//
// N1CO redirects to one of several patterns after the issuer's 3DS challenge:
//   * our own backend endpoint (`/subscription/n1co/3ds-complete?status=...`)
//     when we pass it as `returnUrl` — most reliable
//   * N1CO-hosted `authentication.complete` URL — observed pattern
//   * Any URL with a `status=SUCCESS|FAILED` query — common payment-API convention
//
// We watch both `will-redirect` AND `did-navigate` since some challenges land
// the success page via fetch / form submission rather than a server redirect.
ipcMain.handle('open-3ds-popup', async (_event, authUrl) => {
  log('Opening 3DS popup:', authUrl);
  const popup = new BrowserWindow({
    width: 500,
    height: 650,
    parent: mainWindow,
    modal: true,
    title: 'Autenticación de Pago',
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  // Tracks whether we've already decided the outcome so the popup's `closed`
  // event doesn't double-fire as CANCELLED after a successful detection.
  let resolved = false;
  const sendResult = (status) => {
    if (resolved) return;
    resolved = true;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('3ds-complete', { status });
    }
  };

  // Returns 'SUCCESS' / 'FAILED' if `url` is a recognised 3DS terminal page,
  // otherwise null. Match in priority order — most specific first.
  const classify = (url) => {
    if (!url) return null;
    try {
      const u = new URL(url);
      const path = u.pathname.toLowerCase();
      const status = (u.searchParams.get('status') || '').toUpperCase();

      // 1. Our own backend completion endpoint — definitive.
      if (path.endsWith('/subscription/n1co/3ds-complete')) {
        return status === 'SUCCESS' || status === 'SUCCEEDED' ? 'SUCCESS' : 'FAILED';
      }
      // 2. N1CO-hosted completion page.
      if (path.includes('authentication.complete') || u.hostname.includes('n1co')) {
        if (status === 'SUCCESS' || status === 'SUCCEEDED') return 'SUCCESS';
        if (status === 'FAILED' || status === 'FAILURE' || status === 'CANCELLED') return 'FAILED';
      }
      // 3. Generic status= query on any URL.
      if (status === 'SUCCESS' || status === 'SUCCEEDED') return 'SUCCESS';
      if (status === 'FAILED' || status === 'FAILURE') return 'FAILED';
    } catch {
      // URL parse failed — fall through to substring matching as last resort.
      if (url.includes('authentication.complete') || url.includes('status=SUCCESS')) return 'SUCCESS';
      if (url.includes('status=FAILED') || url.includes('status=FAILURE')) return 'FAILED';
    }
    return null;
  };

  const handleUrl = (url) => {
    log('3DS navigation:', url);
    const outcome = classify(url);
    if (outcome) {
      sendResult(outcome);
      // Defer close so the user briefly sees the result page on Electron's
      // schedule (and our auto-close HTML's setTimeout completes).
      setTimeout(() => { try { popup.close(); } catch (_) {} }, 200);
    }
  };

  popup.webContents.on('will-redirect', (_e, redirectUrl) => handleUrl(redirectUrl));
  popup.webContents.on('did-navigate', (_e, navUrl) => handleUrl(navUrl));
  popup.webContents.on('did-redirect-navigation', (_e, navUrl) => handleUrl(navUrl));

  popup.on('closed', () => {
    // Only emit CANCELLED if no outcome was detected by URL matching.
    // Prevents a race where the user closes the popup after success but
    // before the `did-navigate` fired (rare but possible).
    if (!resolved && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('3ds-complete', { status: 'CANCELLED' });
    }
  });

  popup.loadURL(authUrl);
});

// File dialogs
ipcMain.handle('dialog:save', async (_event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, options);
  if (result.canceled || !result.filePath) return null;
  rememberApprovedPath(result.filePath);
  return result.filePath;
});

ipcMain.handle('dialog:open', async (_event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options);
  if (result.canceled) return null;
  for (const filePath of result.filePaths) {
    try {
      const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
      if (stat?.isDirectory()) {
        rememberApprovedDirectory(filePath);
      } else {
        rememberApprovedPath(filePath);
      }
    } catch {
      rememberApprovedPath(filePath);
    }
  }
  return result.filePaths;
});

// File I/O
ipcMain.handle('fs:read', async (_event, filePath, encoding = 'utf-8') => {
  return fs.promises.readFile(assertAllowedFilePath(filePath), encoding);
});

ipcMain.handle('fs:write', async (_event, filePath, data, encoding = 'utf-8') => {
  const allowedPath = assertAllowedFilePath(filePath);
  const dir = path.dirname(allowedPath);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(allowedPath, data, encoding);
});

ipcMain.handle('app:getPath', (_event, name) => {
  const allowedNames = new Set(['userData', 'documents', 'downloads', 'desktop', 'temp']);
  if (!allowedNames.has(name)) {
    throw new Error('Ruta de aplicación no permitida');
  }
  return app.getPath(name);
});

// Append to a file (used by LocalLogger for session log files)
ipcMain.handle('fs:append', async (_event, filePath, data, encoding = 'utf-8') => {
  const allowedPath = assertAllowedFilePath(filePath);
  const dir = path.dirname(allowedPath);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.appendFile(allowedPath, data, encoding);
});

// List files in a directory (used by LogExportService to collect log files)
ipcMain.handle('fs:list-dir', async (_event, dirPath) => {
  try {
    return await fs.promises.readdir(assertAllowedDirectoryPath(dirPath));
  } catch {
    return [];
  }
});

// POS thermal printing — ESC/POS receipts over network TCP 9100 or the OS
// spooler (raw job). Pure-JS byte builder (node-thermal-printer used as a
// buffer builder only); config/payload validation lives in the service.
//
// Loaded defensively: this require runs before app.whenReady() is registered,
// so a throw here (e.g. the module missing from app.asar, as in 1.2.0/1.3.0)
// would leave the app with no window AND no auto-updater to deliver the fix.
let thermalPrinter = null;
let thermalPrinterLoadError = null;
try {
  thermalPrinter = require('./thermalPrinterService.cjs');
} catch (err) {
  thermalPrinterLoadError = String(err.message).split('\n')[0]; // drop the require stack
  log('Thermal printer service not available:', err.message);
}
const printerUnavailable = () => ({
  ok: false,
  error: `Impresión térmica no disponible en esta instalación: ${thermalPrinterLoadError}`,
});
ipcMain.handle('printer:list', () => (thermalPrinter ? thermalPrinter.listPrinters() : []));
ipcMain.handle('printer:status', (_event, config) => (thermalPrinter ? thermalPrinter.status(config) : printerUnavailable()));
ipcMain.handle('printer:print', (_event, config, payload) => (thermalPrinter ? thermalPrinter.handlePrint(config, payload) : printerUnavailable()));
ipcMain.handle('printer:diagnose', (_event, config) => (thermalPrinter ? thermalPrinter.diagnose(config) : printerUnavailable()));

// IMAP — fetch DTE attachments (.json, .txt, .pdf) from a user's mailbox
// without going through Gmail API. Enables offline-friendly sync with no
// per-project quota (the user authenticates with an app password directly
// against their provider's IMAP server).
//
// Runs in the main process because browsers/renderers cannot open TCP
// sockets. Uses `imap-simple` (wraps `imap`) + `mailparser` for attachments.
//
// Request payloads are sanitized server-side; credentials never leave the
// Node process beyond the outbound TLS to the IMAP provider.
let imapSimple = null;
let mailparser = null;
try {
  imapSimple = require('imap-simple');
  mailparser = require('mailparser');
} catch (err) {
  log('IMAP libraries not available:', err.message);
}

function buildImapConfig(input) {
  const host = input.host || imapAutoDetect(input.user)?.host;
  const port = input.port || imapAutoDetect(input.user)?.port || 993;
  const localImapPort = Number(process.env.GREENMAIL_IMAP_PORT || process.env.IMAP_E2E_IMAP_PORT || 1143);
  const isLocalPlainImap =
    process.env.PLAYWRIGHT_TEST === '1' &&
    ['localhost', '127.0.0.1', '::1'].includes(String(host)) &&
    Number(port) === localImapPort;
  const tls = input.tls ?? (isLocalPlainImap ? false : imapAutoDetect(input.user)?.tls ?? true);
  const imap = {
    user: input.user,
    password: input.password,
    host,
    port,
    tls,
    authTimeout: 10000,
  };
  if (tls) {
    imap.tlsOptions = { rejectUnauthorized: true, servername: host };
  }
  return {
    imap,
  };
}

// Opens INBOX strictly READ-ONLY. imap-simple's own openBox() cannot pass the
// readOnly flag, so it issues SELECT — which grants the session write authority
// over the user's real mailbox. EXAMINE is SELECT without write access, so no
// future flag/expunge/move call can ever become destructive. The Compras UI
// promises "solo lectura"; this makes the protocol actually guarantee it.
function openInboxReadOnly(conn) {
  return new Promise((resolve, reject) => {
    conn.imap.openBox('INBOX', true, (err, box) => (err ? reject(err) : resolve(box)));
  });
}

// imap-simple's search() resolves only once it has received exactly as many
// `message` events as SEARCH returned UIDs. If the server emits fewer — routine
// when a message is expunged between SEARCH and FETCH on an active mailbox — the
// promise never settles, and since ipcRenderer.invoke has no timeout the renderer
// spins on "Sincronizando compras…" until the app is restarted. Bound it.
const IMAP_SEARCH_TIMEOUT_MS = 120000;

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

// Skip messages whose full RFC822 body is larger than this. imap-simple buffers
// every matched body as a JS string simultaneously, and each attachment is then
// re-encoded to base64 and structured-cloned across IPC — on "Todo el historial"
// against a mailbox of PDF-bearing DTE mail that is hundreds of MB in the main
// process. The old code documented this cap but never implemented it.
const IMAP_MAX_MESSAGE_BYTES = 5 * 1024 * 1024;

function formatImapSearchDate(date) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${date.getUTCDate()}-${months[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}

ipcMain.handle('imap:test-connection', async (_event, input) => {
  if (!imapSimple) return { ok: false, error: 'IMAP no disponible en este build' };
  try {
    const config = buildImapConfig(input);
    const conn = await imapSimple.connect(config);
    try {
      await openInboxReadOnly(conn);
    } finally {
      await conn.end();
    }
    return { ok: true, host: config.imap.host, port: config.imap.port };
  } catch (err) {
    return { ok: false, error: err.message || 'Error al conectar' };
  }
});

// Fetch messages with likely-DTE attachments since `afterDate` (YYYY-MM-DD).
// Opens the mailbox read-only (EXAMINE), bounds the search, and skips messages
// larger than IMAP_MAX_MESSAGE_BYTES to protect the main process from huge
// attachments. Each attachment is base64-encoded so the renderer can decode.
ipcMain.handle('imap:fetch-attachments', async (_event, input) => {
  if (!imapSimple || !mailparser) {
    return { ok: false, error: 'IMAP no disponible en este build', messages: [] };
  }
  try {
    const config = buildImapConfig(input);
    const afterDate = input.afterDate ? new Date(input.afterDate) : null;

    const conn = await imapSimple.connect(config);
    const outMessages = [];
    let skippedTooLarge = 0;
    let unreadable = 0;
    try {
      await openInboxReadOnly(conn);

      // SINCE <date> narrows the server-side fetch.
      const searchCriteria = afterDate
        ? [['SINCE', formatImapSearchDate(afterDate)]]
        : ['ALL'];
      const fetchOptions = {
        bodies: [''],
        markSeen: false,
        struct: true,
      };

      const results = await withTimeout(
        conn.search(searchCriteria, fetchOptions),
        IMAP_SEARCH_TIMEOUT_MS,
        'La búsqueda IMAP excedió el tiempo de espera',
      );

      for (const msg of results) {
        // Enforce the size cap this handler always claimed to have.
        if (Number(msg.attributes?.size) > IMAP_MAX_MESSAGE_BYTES) {
          skippedTooLarge += 1;
          continue;
        }
        const rawBody = msg.parts.find((p) => p.which === '')?.body;
        if (!rawBody) continue;

        // One malformed message must not abort the whole batch.
        try {
          const parsed = await mailparser.simpleParser(rawBody);
          const attachments = await collectDteAttachments(parsed, mailparser.simpleParser);
          if (attachments.length === 0) continue;

          outMessages.push({
            uid: msg.attributes.uid,
            // Namespace the fallback: a bare UID can collide with another mailbox's
            // UID or a Gmail-imported row and be silently skipped by dedup.
            messageId: parsed.messageId || `imap_${msg.attributes.uid}`,
            date: parsed.date ? parsed.date.toISOString() : undefined,
            subject: parsed.subject,
            attachments,
          });
        } catch (parseErr) {
          unreadable += 1;
          log('[IMAP] mensaje ilegible omitido:', msg.attributes?.uid, parseErr.message);
        }
      }
    } finally {
      // Always release the socket — a search timeout used to leak it.
      try {
        await conn.end();
      } catch (endErr) {
        log('[IMAP] error al cerrar la conexión:', endErr.message);
      }
    }

    if (skippedTooLarge > 0) {
      log(`[IMAP] ${skippedTooLarge} mensaje(s) omitido(s) por exceder ${IMAP_MAX_MESSAGE_BYTES} bytes`);
    }
    return { ok: true, messages: outMessages, skippedTooLarge, unreadable };
  } catch (err) {
    return { ok: false, error: err.message || 'Error IMAP', messages: [] };
  }
});

// Consulta Pública MH — proxy GET requests through the main process so the
// renderer (served via http://localhost:5173 in dev) isn't blocked by CORS.
// The MH public API does not set Access-Control-Allow-Origin headers, so a
// browser fetch() from the Vite dev server fails. Node's fetch has no CORS.
ipcMain.handle('consulta-publica:fetch', async (_event, url) => {
  try {
    if (typeof url !== 'string' || !url.startsWith('https://admin.factura.gob.sv/')) {
      return { ok: false, status: 0, error: 'URL no permitida' };
    }
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body: text,
    };
  } catch (err) {
    return { ok: false, status: 0, error: err.message || 'Error de red' };
  }
});

// MH DTE submission + /seguridad/auth proxy — POST through the main process
// so the renderer is not blocked by CORS. Allowlist, timeouts (auth 30 s,
// DTE 5 min), no redirects and failure classification live in mhProxy.cjs.
ipcMain.handle('mh:fetch', (_event, config) => mhFetch(config));

// SparkleWash carwash API proxy + SSE bridge (see carwashProxy.cjs). One event
// stream per window; the renderer parses frames and handles reconnects.
ipcMain.handle('carwash:fetch', (_event, config) => carwashFetch(config));
const carwashEventStreams = new Map();
// webContents ids that already have a 'destroyed' cleanup listener: the renderer restarts the
// stream on every reconnect, and one listener per start would pile up for the window's lifetime.
const carwashEventCleanup = new Set();
function stopCarwashEvents(webContentsId) {
  const handle = carwashEventStreams.get(webContentsId);
  if (handle) {
    carwashEventStreams.delete(webContentsId);
    handle.stop();
  }
}
ipcMain.handle('carwash:events-start', (event, config) => {
  const sender = event.sender;
  stopCarwashEvents(sender.id);
  const handle = startCarwashEvents(config, (msg) => {
    if (!sender.isDestroyed()) sender.send('carwash:event', msg);
  });
  carwashEventStreams.set(sender.id, handle);
  if (!carwashEventCleanup.has(sender.id)) {
    const id = sender.id;
    carwashEventCleanup.add(id);
    sender.once('destroyed', () => {
      carwashEventCleanup.delete(id);
      stopCarwashEvents(id);
    });
  }
  return true;
});
ipcMain.handle('carwash:events-stop', (event) => {
  stopCarwashEvents(event.sender.id);
  return true;
});

// Azure OpenAI proxy. The renderer hands us the deployment URL + key + body
// and we POST from the main process. This keeps the API key out of the
// renderer's network panel (devtools) and bypasses CORS in Vite dev mode.
// We restrict the URL prefix so the renderer can't repurpose this handler
// to send the key elsewhere.
ipcMain.handle('azure-openai:fetch', async (_event, config) => {
  try {
    if (!config || typeof config !== 'object') {
      return { ok: false, status: 0, error: 'Configuración inválida' };
    }
    const { url, apiKey, body } = config;
    if (typeof url !== 'string' || !url.startsWith('https://')) {
      return { ok: false, status: 0, error: 'URL no permitida' };
    }
    // Allow Azure OpenAI cognitive-services + AI-Foundry hosts. Both are
    // legitimate destinations for a deployment endpoint.
    const allowedHostSuffixes = ['.openai.azure.com', '.cognitiveservices.azure.com', '.services.ai.azure.com'];
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, status: 0, error: 'URL inválida' };
    }
    if (!allowedHostSuffixes.some((suffix) => parsed.hostname.endsWith(suffix))) {
      return { ok: false, status: 0, error: 'Host no permitido' };
    }
    if (typeof apiKey !== 'string' || apiKey.length < 8) {
      return { ok: false, status: 0, error: 'API key inválida' };
    }
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body: text,
    };
  } catch (err) {
    return { ok: false, status: 0, error: err.message || 'Error de red' };
  }
});

// Ollama proxy. Same idea as the Azure bridge but for the local Ollama
// server. We restrict to localhost / 127.0.0.1 / *.local so the renderer
// can't repurpose the bridge for arbitrary HTTP traffic. No API key needed
// — Ollama's local server is unauthenticated by default.
ipcMain.handle('ollama:fetch', async (_event, config) => {
  try {
    if (!config || typeof config !== 'object') {
      return { ok: false, status: 0, error: 'Configuración inválida' };
    }
    const { url, body } = config;
    if (typeof url !== 'string' || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      return { ok: false, status: 0, error: 'URL no permitida' };
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, status: 0, error: 'URL inválida' };
    }
    const allowedHosts = ['localhost', '127.0.0.1', '::1'];
    if (!allowedHosts.includes(parsed.hostname)) {
      return { ok: false, status: 0, error: 'Host no permitido (solo localhost / 127.0.0.1 / ::1)' };
    }
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body: text,
    };
  } catch (err) {
    return { ok: false, status: 0, error: err.message || 'Error de red' };
  }
});

// Crypto — SHA-512 via Node built-in (works on all platforms, no secure context needed)
ipcMain.handle('crypto:sha512', (_event, text) => {
  return require('crypto').createHash('sha512').update(text, 'utf8').digest('hex');
});

// PDF generation via hidden BrowserWindow
ipcMain.handle('pdf:generate', async (_event, html, options = {}) => {
  const pdfWin = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  try {
    await pdfWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    // Wait for fonts to be ready before printing; fall back to 200ms if unavailable.
    try {
      await pdfWin.webContents.executeJavaScript('document.fonts.ready');
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    const pdfData = await pdfWin.webContents.printToPDF({
      landscape: options.landscape || false,
      pageSize: options.pageSize || 'Letter',
      printBackground: true,
      // Zero margins: the invoice HTML carries its own 30pt text inset and
      // full-bleed section bands (mirrors the iOS UIGraphicsPDFRenderer
      // layout). Paper-margin insets used to clip ~29pt off the right side
      // of the 612pt-wide page, cutting the last items-table column.
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });

    return pdfData;
  } finally {
    try { if (!pdfWin.isDestroyed()) pdfWin.destroy(); } catch {}
  }
});

// ── App lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(() => {
  loadStorageSync();
  if (!isDev || process.env.FORCE_APP_PROTOCOL === '1') {
    setupLocalServing();
  }
  createAppMenu();
  createWindow();

  // Auto-update (delayed, production only)
  if (!isDev && !updateChannelConfigured()) {
    log('Auto-update skipped: no SparkleWash update feed configured (set SPARKLEWASH_UPDATE_URL or build with a publish config)');
  } else if (!isDev && initAutoUpdater()) {
    setTimeout(async () => {
      manualUpdateOnly = await isAdHocSignedMacApp();
      if (manualUpdateOnly) {
        autoUpdater.autoDownload = false;
        autoUpdater.autoInstallOnAppQuit = false;
        log('Ad-hoc signed macOS build: background install unsupported, prompting for manual download');
      }
      autoUpdater.checkForUpdates().catch((err) => log('Update check failed:', err.message));
    }, 5000);
  }
});

app.on('window-all-closed', () => { app.quit(); });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  flushStorageSync();
  flushSecretsSync();
});
app.on('activate', () => { if (mainWindow === null) createWindow(); });
