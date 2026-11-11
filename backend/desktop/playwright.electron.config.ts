import { defineConfig } from '@playwright/test';

/**
 * Electron-mode Playwright config.
 *
 * Runs a separate test directory (`playwright/tests/electron/`) against the
 * packaged Electron main process via `_electron.launch(...)`. The renderer
 * still points at the Vite dev server, but because Electron's renderer has
 * web-security concessions (and access to the `electronAPI` preload bridge),
 * tests can hit the real MH government API without CORS issues.
 *
 * Workers are forced to 1 — Electron maintains a shared user-data dir and
 * multiple parallel launches would collide on storage and ports.
 *
 * Run with:  npx playwright test --config playwright.electron.config.ts
 * Mock mode: MH_MOCK=1 npx playwright test --config playwright.electron.config.ts
 *            (default is real MH — see playwright/fixtures/electron-launch.ts)
 */
export default defineConfig({
  testDir: './playwright/tests/electron',
  timeout: 180_000, // 3 min per test — MH test endpoint can take 30-90s
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: 'list',
  use: {
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'electron' }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
