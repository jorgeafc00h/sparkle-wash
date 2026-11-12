# Car Spa Desktop

Car Spa (formerly SparkleWash).

Aplicación de escritorio (Electron + Vite + React 19 + Redux Toolkit) de Car Spa: punto de venta,
órdenes de lavado y facturación electrónica (DTE de El Salvador). Es una versión personalizada de la app de
escritorio de Facturas Simples 1.4.6 que conserva todas sus funciones y agrega el flujo de lavado de autos,
sincronizado con la API de Car Spa (`backend/src/carwash-api`), la app iOS y la consola web.

- Contrato de integración con la API: [docs/SPARKLEWASH_INTEGRATION.md](docs/SPARKLEWASH_INTEGRATION.md)
- Notas para desarrollo (estructura, reglas): [CLAUDE.md](CLAUDE.md)
- Revisiones y documentación heredada: [docs/upstream/](docs/upstream/)

## Ejecutar

```bash
npm ci
cp .env.example .env     # completa las variables (ver abajo)
npm run dev              # renderer en el navegador (Vite, http://localhost:5173)
npm run dev:electron     # Vite + ventana de Electron
```

Para probar contra la API local: `cd ../ && dotnet run --project src/carwash-api` (puerto 8080 por defecto).

## Pruebas y verificación

```bash
npm run lint             # tsc --noEmit
npx jest                 # pruebas unitarias
npm run build            # tsc -b && vite build
npm run test:e2e:electron  # Playwright contra Electron (requiere dist/ y entorno)
```

## Instaladores

```bash
npm run build:electron                                   # build + electron-builder (Windows NSIS/zip o macOS dmg/zip)
npx electron-builder --config electron/builder.config.json --dir   # solo empaquetar (sin instalador)
node scripts/verify-packaged-app.cjs electron-dist/mac-universal/SparkleWash.app/Contents/Resources/app.asar
```

Salida en `electron-dist/` (ignorado por git): `SparkleWash-Setup-<versión>.exe`, `SparkleWash-<versión>-universal.dmg`.
Sin firma de código el instalador de Windows muestra SmartScreen y macOS exige firma Developer ID + notarización
(`CSC_LINK`/`CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`). Para una compilación local sin firmar:
`CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --config electron/builder.config.json -c.mac.notarize=false`.

Regenerar iconos: `public/icon.png` (1024) es la fuente; `icon.icns` con `sips` + `iconutil`; `icon.ico` con
`node scripts/make-ico.cjs public/icon.ico <png...>`.

## Variables de entorno

Solo las `VITE_*` llegan al renderer (se incluyen al compilar). Ver `.env.example`.

| Variable | Uso |
|---|---|
| `VITE_SPARKLEWASH_API_URL` | Origen de la API de Car Spa (por defecto `http://localhost:8080`; en dev puede ser `/carwash-api` con el proxy de Vite) |
| `VITE_SPARKLEWASH_API_PROXY_TARGET` | Destino del proxy de Vite en desarrollo |
| `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_CLIENT_SECRET` | Cliente OAuth tipo *Desktop* de Google. **La API de Car Spa debe aceptar este client id**: añádelo a `SPARKLEWASH_GOOGLE_CLIENT_ID` (lista separada por comas) o el inicio de sesión del personal fallará |
| `VITE_GOOGLE_REDIRECT_URI` | Solo flujo web/dev |
| `VITE_API_BASE_URL`, `VITE_SYNC_API_URL`, `VITE_CHAT_API_URL` | Servicios de Facturas Simples (ver abajo) |
| `SPARKLEWASH_UPDATE_URL` | Feed de actualizaciones (proveedor genérico) leído por el proceso principal. Vacío = sin actualizaciones automáticas |

### Actualizaciones automáticas

Opt-in. El actualizador solo arranca si hay un feed de Car Spa: `SPARKLEWASH_UPDATE_URL` en tiempo de ejecución, o el
`publish` horneado al empaquetar (`app-update.yml`). El feed oficial son los GitHub Releases del repositorio:
`https://github.com/jorgeafc00h/sparkle-wash/releases/latest/download` (proveedor genérico). Nunca apunta al feed de
Facturas Simples.

### Instalador de Windows (GitHub Actions)

`.github/workflows/desktop-release.yml` compila el instalador en `windows-latest` en cada cambio de `backend/desktop`
(también en los PR) y, desde `main`, publica el release `desktop-v<versión>` con `SparkleWash-Setup-<versión>.exe`,
su `.blockmap`, `latest.yml`, el zip y el alias estable `SparkleWash-Setup-latest.exe` (el botón "Descargar para Windows"
de la página web). Para publicar una versión nueva, sube `"version"` en `package.json`; si el tag ya existe, el job no
publica nada. Variables del repositorio: `SPARKLEWASH_DESKTOP_GOOGLE_CLIENT_ID`, `SPARKLEWASH_DESKTOP_API_URL`; secreto:
`SPARKLEWASH_DESKTOP_GOOGLE_CLIENT_SECRET`. El instalador aún no está firmado (SmartScreen avisa en la primera ejecución).

### Aislamiento de datos

El nombre de la app es `SparkleWash` y `userData` se fija a `<appData>/SparkleWash` (con `--user-data-dir` se respeta).
`app-storage.json`, `secrets.json` y el elemento de llavero de `safeStorage` ("SparkleWash Safe Storage") no se comparten con
una instalación de Facturas Simples, y los servicios de almacenamiento seguro se llaman `SparkleWash*`.

### Servicios de Facturas Simples que se siguen usando

Sin cambios en esta versión: hosts de API (`Invoices.Api`, `VITE_API_BASE_URL`), chat de soporte, relay de sincronización
(`VITE_SYNC_API_URL`), cliente OAuth de Google, claves de telemetría (Application Insights), planes/suscripciones (N1CO,
IDs de producto), enlace del manual de usuario y el pie "Versión Gratis" de los PDF. Las llamadas al Ministerio de Hacienda
y los textos legales de los DTE no cambian.
