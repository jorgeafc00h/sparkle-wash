import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './playwright/tests',
  // Electron specs require the `electronFor` fixture and a launched main
  // process — they only run via `playwright.electron.config.ts`.
  // demo/ holds marketing-video captures: they need 1920x1080 + long timeouts
  // and write footage into App.ReactNative/Marketing, so they run through
  // their own configs (`npm run test:e2e:demo`, `npm run test:e2e:demo-electron`).
  testIgnore: ['**/electron/**', '**/demo/**'],
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', viewport: { width: 1366, height: 768 } } },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 10000,
  },
});
