import { defineConfig } from '@playwright/test';

/**
 * Dedicated config for capturing clean 1920x1080 marketing footage of the
 * onboarding spine. Records video at full HD, runs slow enough that every
 * transition is visible, and reuses the already-running Vite dev server.
 *
 * Run:
 *   npx playwright test --config playwright.demo.config.ts
 */
export default defineConfig({
  testDir: './playwright/tests/demo',
  timeout: 300_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 1920, height: 1080 },
    screenshot: 'off',
    trace: 'off',
    video: { mode: 'on', size: { width: 1920, height: 1080 } },
    launchOptions: { slowMo: 0 },
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: 'demo-desktop-hd',
      use: {
        browserName: 'chromium',
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
