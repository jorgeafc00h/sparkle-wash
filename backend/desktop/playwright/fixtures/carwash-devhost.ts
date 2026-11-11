/**
 * Real SparkleWash API for desktop end-to-end specs.
 *
 * Starts `backend/src/carwash-api.DevHost` (the production `Program.BuildApp` with a dev-only
 * token verifier; refuses to start outside Development) on a free port with isolated temp data.
 * Staff sign in with `dev:<numeric subject>:<email>` tokens; subject 1001 is an operator.
 */

import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DEV_HOST_PROJECT = path.join(BACKEND_ROOT, 'src/carwash-api.DevHost');

export const DEV_TOKEN = 'dev:1001:op@example.com';
export const hasDotnet = spawnSync('dotnet', ['--version'], { stdio: 'ignore' }).status === 0;

export interface DevHost {
  url: string;
  stop(): void;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))));
    });
  });
}

export async function startDevHost(timeoutMs = 200_000): Promise<DevHost> {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'sparklewash-e2e-'));
  const url = `http://127.0.0.1:${await freePort()}`;
  const child: ChildProcess = spawn('dotnet', ['run', '--project', DEV_HOST_PROJECT, '--urls', url], {
    cwd: BACKEND_ROOT,
    env: {
      ...process.env,
      ASPNETCORE_ENVIRONMENT: 'Development',
      SPARKLEWASH_GOOGLE_CLIENT_ID: 'dev',
      SPARKLEWASH_STAFF_ROLES: '1001=operator',
      SPARKLEWASH_CORS_ORIGINS: 'http://127.0.0.1:5173',
      SPARKLEWASH_TENANTS_DIR: path.join(dataDir, 'tenants'),
      SPARKLEWASH_ARRIVALS_FILE: path.join(dataDir, 'arrivals.json'),
      SPARKLEWASH_JOBS_FILE: path.join(dataDir, 'jobs.json'),
      SPARKLEWASH_OPERATIONS_FILE: path.join(dataDir, 'operations.json'),
      SPARKLEWASH_DEVICES_FILE: path.join(dataDir, 'devices.json'),
      SPARKLEWASH_DATA_FILE: path.join(dataDir, 'stations.json'),
      SPARKLEWASH_PHOTO_DIR: path.join(dataDir, 'photos'),
      SPARKLEWASH_N1CO_WEBHOOK_FILE: path.join(dataDir, 'n1co.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout?.on('data', (chunk) => { log += chunk; });
  child.stderr?.on('data', (chunk) => { log += chunk; });
  const stop = () => {
    child.kill('SIGTERM');
    rmSync(dataDir, { recursive: true, force: true });
  };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode != null) break;
    try {
      if ((await fetch(`${url}/healthz`)).ok) return { url, stop };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  stop();
  throw new Error(`DevHost did not become healthy\n${log.slice(-4000)}`);
}

/** Authorization header for direct API calls (stands in for the iOS app / web console). */
export async function apiHeaders(request: APIRequestContext, url: string): Promise<Record<string, string>> {
  const res = await request.post(`${url}/api/auth/google`, { data: { idToken: DEV_TOKEN } });
  expect(res.ok()).toBeTruthy();
  const { sessionToken } = await res.json();
  return { Authorization: `Bearer ${sessionToken}` };
}

/** In-app navigation: page.goto would re-run the seed init script and reset persisted state. */
export async function navigate(page: Page, hash: string): Promise<void> {
  await page.evaluate((h) => { window.location.hash = h; }, hash);
}

/** Point the desktop at the API and sign in with the dev token (Configuración → SparkleWash). */
export async function connectDesktop(page: Page, url: string): Promise<void> {
  await navigate(page, '#/settings/carwash');
  await expect(page.getByTestId('carwash-settings')).toBeVisible();
  await page.getByTestId('carwash-api-url').fill(url);
  await page.getByTestId('carwash-save').click();
  await page.getByTestId('carwash-dev-token-input').fill(DEV_TOKEN);
  await page.getByTestId('carwash-dev-token-submit').click();
  await expect(page.getByTestId('carwash-session')).toBeVisible({ timeout: 15_000 });
}

export async function createWalkIn(page: Page, plate: string, vehicleClass: string, packageId: string): Promise<void> {
  await page.getByTestId('carwash-new-service').click();
  await page.getByTestId('carwash-plate-input').fill(plate);
  await page.getByTestId(`carwash-class-${vehicleClass}`).click();
  await page.getByTestId(`carwash-package-${packageId}`).click();
  await page.getByTestId('carwash-create').click();
}
