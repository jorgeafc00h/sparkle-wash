import { defineConfig } from '@playwright/test';

/**
 * Dedicated config for capturing clean 1920x1080 (and 1080x1920 portrait)
 * MARKETING footage of the ELECTRON shell — specifically the
 * "Solicitar Autorización a Producción" flow with the per-type progress bars
 * animating.
 *
 * Unlike playwright.demo.config.ts (which records a Chromium `page` via
 * `video:{mode:'on'}`), the Electron window is NOT a Chromium browser context,
 * so `video.mode` does nothing here. Instead the capture spec passes
 * `recordVideo:{dir,size}` directly to `_electron.launch(...)` and saves the
 * resulting `window.video()` after the run.
 *
 * The renderer is served by the Vite dev server (main.cjs loads
 * http://localhost:5173 when !app.isPackaged), so we start `npm run dev` here.
 *
 * Run:
 *   npx playwright test --config playwright.demo-electron.config.ts --workers=1
 */
export default defineConfig({
  testDir: './playwright/tests/demo',
  testMatch: /demo-request-production\.spec\.ts/,
  timeout: 300_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    screenshot: 'off',
    trace: 'off',
  },
  projects: [{ name: 'demo-request-production-electron' }],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
