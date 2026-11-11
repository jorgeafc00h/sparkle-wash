/**
 * Shared helpers for the coverage/ specs (not a spec file — Playwright only
 * collects *.spec.ts). Everything here is hermetic: no real Google, MH or
 * Invoices.Api traffic leaves the browser.
 */

import { expect, type Page, type Route } from '@playwright/test';
import {
  TEST_COMPANY,
  SAMPLE_CUSTOMERS,
  SAMPLE_PRODUCTS,
  SAMPLE_INVOICES,
  TEST_USER,
} from '../../fixtures/seed-state';

export { TEST_COMPANY, SAMPLE_CUSTOMERS, SAMPLE_PRODUCTS, SAMPLE_INVOICES, TEST_USER };

/** Invoices.Api host the dev build talks to (src/config/api.ts → development.baseUrl). */
export const API_HOST = 'k-invoices-api-prod.orangesand-e6d7151a.southcentralus.azurecontainerapps.io';

/** redux-persist double encoding (each value JSON-encoded, then the container). */
export function persist(state: Record<string, unknown>): string {
  const encoded: Record<string, string> = {};
  for (const [k, v] of Object.entries(state)) encoded[k] = JSON.stringify(v);
  encoded._persist = JSON.stringify({ version: -1, rehydrated: true });
  return JSON.stringify(encoded);
}

/** Writes raw localStorage entries before any app script runs. */
export async function seedStorage(page: Page, entries: Record<string, string>): Promise<void> {
  await page.addInitScript((data) => {
    for (const [key, value] of Object.entries(data as Record<string, string>)) {
      window.localStorage.setItem(key, value);
    }
  }, entries);
}

/**
 * Fails every request that leaves the dev server with a 503 so a spec can never
 * reach production services by accident. Register spec-specific routes AFTER
 * this — Playwright gives the most recently registered matching route priority.
 */
export async function blockExternalNetwork(page: Page): Promise<void> {
  await page.route(
    (url) => url.protocol.startsWith('http') && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost',
    (route: Route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
}

export function productsState(products: unknown[] = SAMPLE_PRODUCTS): string {
  return persist({
    products,
    stockMovements: [],
    categories: [],
    brands: [],
    suppliers: [],
    currentProduct: null,
  });
}

export function subscriptionState(tier: 'lite' | 'adfree' | 'pro' | 'pro_sync' = 'pro'): string {
  return persist({ tier, activeSubscription: null, isInitialized: true, availableProducts: [] });
}

export function invoicesState(invoices: unknown[]): string {
  return persist({ invoices, selectedInvoiceId: null, pendingSync: [], lastSyncDate: null });
}

/** ISO date (yyyy-mm-dd) for today in local time — what the app's date pickers default to. */
export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A Completada document transmitted now (inside every invalidation window). */
export function completedToday<T extends Record<string, unknown>>(base: T, overrides: Record<string, unknown> = {}): T {
  const now = new Date().toISOString();
  return { ...base, date: todayIso(), fechaTransmision: now, createdAt: now, updatedAt: now, ...overrides };
}

/**
 * Records every DTE the (mock) Hacienda client receives. The mock signer turns
 * the DTE JSON into the JWS payload verbatim, so decoding `documento` yields
 * exactly the JSON that would have gone to MH.
 */
export async function captureMhSubmissions(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const w = window as unknown as { __mhSent?: unknown[] };
    if (w.__mhSent) return;
    w.__mhSent = [];
    const mod = await import('/src/services/api/MockMhClient.ts');
    const proto = mod.MockMhClient.prototype as Record<string, (...args: unknown[]) => unknown>;
    for (const method of ['submitDTE', 'submitEvent', 'invalidateDTE']) {
      const original = proto[method];
      proto[method] = function patched(this: unknown, params: unknown, credentials: unknown) {
        w.__mhSent!.push({ method, params });
        return original.call(this, params, credentials);
      };
    }
  });
}

export interface MhSubmission {
  method: string;
  params: { documento: string; tipoDte?: string; tipoEvento?: string };
  dte: any;
}

export async function mhSubmissions(page: Page): Promise<MhSubmission[]> {
  const raw = await page.evaluate(() => (window as unknown as { __mhSent?: unknown[] }).__mhSent ?? []);
  return (raw as Array<{ method: string; params: MhSubmission['params'] }>).map((entry) => {
    const payload = entry.params.documento.split('.')[1];
    return { ...entry, dte: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) };
  });
}

/** Reads the persisted invoices slice (after redux-persist flushed it). */
export async function persistedInvoices(page: Page): Promise<any[]> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('persist:invoices');
    if (!raw) return [];
    const outer = JSON.parse(raw) as Record<string, string>;
    return JSON.parse(outer.invoices ?? '[]');
  });
}

export async function persistedProducts(page: Page): Promise<any[]> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('persist:products');
    if (!raw) return [];
    const outer = JSON.parse(raw) as Record<string, string>;
    return JSON.parse(outer.products ?? '[]');
  });
}

/** Money text like "$1,234.56" → 1234.56 */
export function money(text: string | null | undefined): number {
  const match = (text ?? '').replace(/,/g, '').match(/-?\$?\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!match) throw new Error(`No money amount in "${text}"`);
  return Number(match[1]);
}

/** On-screen totals card (InvoiceTotals) of the current page. */
export async function screenTotals(page: Page): Promise<{ subTotal: number; iva: number; total: number; retencionIva?: number }> {
  const read = async (id: string) => money(await page.getByTestId(id).locator('span').last().textContent());
  const retention = page.getByTestId('inv-totals-retencion-iva');
  return {
    subTotal: await read('inv-totals-subtotal'),
    iva: await read('inv-totals-iva'),
    total: await read('inv-totals-total'),
    retencionIva: (await retention.count()) ? Math.abs(await read('inv-totals-retencion-iva')) : undefined,
  };
}

/**
 * Creates a document through AddInvoicePage (type card → customer → products)
 * and returns the new invoice as persisted. Uses the same selectors the
 * existing invoices/* specs rely on.
 */
export async function createInvoiceViaUi(
  page: Page,
  opts: { typeCard: string | RegExp; customer: string; products: string[] },
): Promise<any> {
  const before = new Set((await persistedInvoices(page)).map((i) => i.id));
  await page.goto('/#/invoices/add');
  await expect(page.getByTestId('add-invoice')).toBeVisible({ timeout: 10_000 });
  await page.getByText(opts.typeCard).first().click();
  await expect(page.getByText('Información General')).toBeVisible({ timeout: 5_000 });

  await page.locator('input[placeholder="Buscar cliente..."]').fill(opts.customer);
  await page.locator(`text=${opts.customer}`).first().click();

  for (const product of opts.products) {
    await page.getByRole('button', { name: /Agregar/i }).click();
    await page.locator('input[placeholder^="Buscar producto"]').last().fill(product);
    await page.locator(`text=${product}`).first().click();
    await page.waitForTimeout(200);
  }

  await page.getByTestId('btn-save').click();
  await expect(page).toHaveURL(/#\/invoices$/, { timeout: 8_000 });
  let created: any = null;
  await expect
    .poll(async () => {
      created = (await persistedInvoices(page)).find((i) => !before.has(i.id)) ?? null;
      return created?.id ?? null;
    }, { timeout: 5_000 })
    .not.toBeNull();
  return created;
}
