/**
 * Marketing capture spec — Desktop App "Cobros y pagos" (Cuentas por Cobrar /
 * Cuentas por Pagar) feature spine.
 *
 * Records ONE continuous 1920x1080 video walking the real local accounts flow:
 *   1. Nav to Cobros y pagos → land on the dashboard (default "Por cobrar")
 *   2. The four metric cards (receivable / overdue / payable / overdue)
 *   3. The accounts table + Antigüedad (aging) column
 *   4. Switch segment to "Por pagar" (cuentas por pagar a proveedores)
 *   5. Back to "Por cobrar"; open a receivable row → PaymentModal; fill amount,
 *      método, referencia (paced) → submit
 *   6. The updated balance row + "Cobro registrado" toast
 *
 * Alongside the video it writes a coordinate sidecar timeline JSON so the
 * editor can overlay Spanish captions on the exact on-screen target boxes.
 *
 * Run:
 *   npx playwright test --config playwright.demo.config.ts demo-cuentas.spec.ts --workers=1
 */

import { test, type Page, type Locator } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { seedFinanceAppState } from '../../fixtures/seed-state';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR =
  '/Users/jorgeflores/github/FACTURAS SIMPLES/App.ReactNative/Marketing/social-meta-2026/onboarding-videos/source-footage/cuentas-desktop-hd';

// ---------------------------------------------------------------------------
// Sidecar timeline
// ---------------------------------------------------------------------------

interface SidecarEvent {
  t: number;
  label: string;
  caption: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const events: SidecarEvent[] = [];
let startMs = 0;

async function record(locator: Locator, label: string, caption: string): Promise<void> {
  let box: { x: number; y: number; width: number; height: number } | null = null;
  try {
    box = await locator.boundingBox({ timeout: 2000 });
  } catch {
    box = null;
  }
  // Always push an event so the editor has a caption + timestamp per beat.
  // Fall back to a centered box when the live geometry is unavailable.
  const fb = { x: 660, y: 480, width: 600, height: 120 };
  const b = box ?? fb;
  events.push({
    t: Number(((Date.now() - startMs) / 1000).toFixed(2)),
    label,
    caption,
    x: Math.round(b.x),
    y: Math.round(b.y),
    w: Math.round(b.width),
    h: Math.round(b.height),
  });
}

function writeSidecar(): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const sidecar = { videoW: 1920, videoH: 1080, events };
  writeFileSync(
    resolve(OUTPUT_DIR, 'cuentas-fullflow.timeline.json'),
    JSON.stringify(sidecar, null, 2),
    'utf-8',
  );
  writeFileSync(
    resolve(__dir, 'last-run-cuentas-timeline.json'),
    JSON.stringify(sidecar, null, 2),
    'utf-8',
  );
}

// Type into a field at a human pace, recording the target box first.
async function typeInto(
  page: Page,
  locator: Locator,
  text: string,
  label: string,
  caption: string,
): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await record(locator, label, caption);
  await locator.click();
  await locator.fill('');
  await locator.pressSequentially(text, { delay: 60 });
  await page.waitForTimeout(500);
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test('cobros y pagos full flow — beats 1 to 6', async ({ page }) => {
  test.setTimeout(180_000);

  try {
    // Seed populated finance state (receivable Maria Gonzalez DTE-01-M001-000000001
    // + payable Proveedor Demo S.A. de C.V. DTE-03-PROV-000000001) BEFORE load.
    // seedFinanceAppState injects localStorage via addInitScript then navigates
    // to '/' and waits for the sidebar.
    await seedFinanceAppState(page);
    startMs = Date.now();
    await page.waitForTimeout(1200); // let the shell settle on camera

    // ── BEAT 1 — Navigate to Cobros y pagos (default "Por cobrar") ───────────
    const navItem = page.getByTestId('sidebar-cobros-pagos');
    await record(navItem, 'beat1-nav', 'Controla lo que te deben y lo que debes');
    await navItem.click();
    await page.getByTestId('cuentas.desktop').waitFor({ state: 'visible', timeout: 12_000 });
    await page.getByText('DTE-01-M001-000000001').waitFor({ state: 'visible', timeout: 12_000 });
    await page.waitForTimeout(1200);
    // Hold on the landed dashboard with the heading framed.
    await record(
      page.getByRole('heading', { name: 'Cobros y pagos' }),
      'beat1-dashboard',
      'Controla lo que te deben y lo que debes',
    );
    await page.waitForTimeout(8500);

    // ── BEAT 2 — The four metric cards ───────────────────────────────────────
    const cardsGroup = page.locator('.grid').filter({
      has: page.getByTestId('cuentas.summary.receivable'),
    }).first();
    await record(cardsGroup, 'beat2-cards', 'Resumen: por cobrar, vencidas y vencimientos');
    await page.getByTestId('cuentas.summary.receivable').scrollIntoViewIfNeeded();
    await page.waitForTimeout(2200);
    await record(page.getByTestId('cuentas.summary.receivable'), 'beat2-receivable', 'Resumen: por cobrar, vencidas y vencimientos');
    await page.waitForTimeout(1600);
    await record(page.getByTestId('cuentas.summary.receivableOverdue'), 'beat2-receivable-overdue', 'Resumen: por cobrar, vencidas y vencimientos');
    await page.waitForTimeout(1600);
    await record(page.getByTestId('cuentas.summary.payable'), 'beat2-payable', 'Resumen: por cobrar, vencidas y vencimientos');
    await page.waitForTimeout(1600);
    await record(page.getByTestId('cuentas.summary.payableOverdue'), 'beat2-payable-overdue', 'Resumen: por cobrar, vencidas y vencimientos');
    await page.waitForTimeout(1800);

    // ── BEAT 3 — Accounts table + Antigüedad (aging) column ──────────────────
    const table = page.getByTestId('data-table');
    await table.scrollIntoViewIfNeeded();
    await record(table, 'beat3-table', 'Antigüedad de cada saldo, de un vistazo');
    await page.waitForTimeout(2200);
    // Spotlight the Antigüedad column header.
    const agingHeader = page.getByRole('columnheader', { name: 'Antigüedad' }).first();
    const agingVisible = await agingHeader.isVisible({ timeout: 2000 }).catch(() => false);
    await record(
      agingVisible ? agingHeader : table,
      'beat3-aging-column',
      'Antigüedad de cada saldo, de un vistazo',
    );
    await page.waitForTimeout(7000);

    // ── BEAT 4 — Switch to "Por pagar" (cuentas por pagar a proveedores) ─────
    const porPagar = page.getByTestId('cuentas.segment.porPagar');
    await record(porPagar, 'beat4-segment-porPagar', 'Cambia a cuentas por pagar a proveedores');
    await porPagar.click();
    await page.getByText('DTE-03-PROV-000000001').waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForTimeout(1200);
    await record(
      page.getByText('Proveedor Demo S.A. de C.V.'),
      'beat4-payable-row',
      'Cambia a cuentas por pagar a proveedores',
    );
    await page.waitForTimeout(8000);

    // ── BEAT 5 — Back to "Por cobrar", open a receivable → PaymentModal ──────
    const porCobrar = page.getByTestId('cuentas.segment.porCobrar');
    await record(porCobrar, 'beat5-segment-porCobrar', 'Registra un cobro o un pago en segundos');
    await porCobrar.click();
    const receivableDoc = page.getByText('DTE-01-M001-000000001');
    await receivableDoc.waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForTimeout(1000);
    await record(receivableDoc, 'beat5-open-row', 'Registra un cobro o un pago en segundos');
    await receivableDoc.click();
    await page.getByTestId('cuentas.payment.modal').waitFor({ state: 'visible', timeout: 8000 });
    await page.waitForTimeout(1200);
    await record(page.getByTestId('cuentas.payment.modal'), 'beat5-modal', 'Registra un cobro o un pago en segundos');
    await page.waitForTimeout(1400);

    // Fill the payment form (paced).
    await typeInto(
      page,
      page.getByTestId('cuentas.payment.amount'),
      '100',
      'beat5-amount',
      'Registra un cobro o un pago en segundos',
    );
    await page.waitForTimeout(800);

    const methodSelect = page.getByTestId('cuentas.payment.method');
    await record(methodSelect, 'beat5-method', 'Registra un cobro o un pago en segundos');
    await methodSelect.selectOption('03'); // Transferencia
    await page.waitForTimeout(900);

    await typeInto(
      page,
      page.getByTestId('cuentas.payment.reference'),
      'TRANSF-000123',
      'beat5-reference',
      'Registra un cobro o un pago en segundos',
    );
    await page.waitForTimeout(1000);

    const submit = page.getByTestId('cuentas.payment.submit');
    await record(submit, 'beat5-submit', 'Registra un cobro o un pago en segundos');
    await submit.click();
    await page.waitForTimeout(900);

    // ── BEAT 6 — Updated balance row + "Cobro registrado" toast ──────────────
    const toast = page.getByText('Cobro registrado');
    const toastVisible = await toast.isVisible({ timeout: 6000 }).catch(() => false);
    await record(
      toastVisible ? toast : page.getByTestId('cuentas.desktop'),
      'beat6-toast',
      'El saldo se actualiza al instante, sin tocar el DTE',
    );
    await page.waitForTimeout(2000);

    // Spotlight the updated balance ($200.00 remaining after $100 cobro on $300).
    const dataTable = page.getByTestId('data-table');
    const balanceCell = dataTable.getByText('$200.00').first();
    const balanceVisible = await balanceCell.isVisible({ timeout: 4000 }).catch(() => false);
    await record(
      balanceVisible ? balanceCell : dataTable,
      'beat6-updated-balance',
      'El saldo se actualiza al instante, sin tocar el DTE',
    );
    await page.waitForTimeout(7000);

    writeSidecar();
  } finally {
    try {
      writeSidecar();
    } catch {
      /* ignore */
    }
  }
});
