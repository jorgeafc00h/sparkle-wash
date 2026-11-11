/**
 * End-to-end verification of the Libros IVA (MH F-07) export.
 *
 * Generates a realistic monthly dataset — 3 invoices per DTE type + linked
 * documents (notas de crédito/débito/remisión/etc. referencing parent CCFs)
 * + one Anulada per type + a mix of Anexo 3 / Anexo 5 purchases — and then
 * drives `MHAnnexExportService.exportMHAnexos` inside the browser. We parse
 * the returned CSV artifacts and assert shape, counts, and per-column values
 * against the v15 F-07 spec.
 */

import { test, expect, Page } from '@playwright/test';
import {
  seedPopulatedAppState,
  TEST_COMPANY,
  waitForAppReady,
} from '../../fixtures/seed-state';

// Keep all seeded documents inside one calendar month so the LibrosIVAPage
// filter matches. Use the first of the current month so the test is not
// sensitive to the day it runs.
const now = new Date();
const PERIOD_YEAR = now.getFullYear();
const PERIOD_MONTH_IDX = now.getMonth();
const PERIOD_MONTH = PERIOD_MONTH_IDX + 1;

function dateAt(day: number, hour = 10): string {
  return new Date(Date.UTC(PERIOD_YEAR, PERIOD_MONTH_IDX, day, hour)).toISOString();
}

function day(day: number): string {
  const mm = String(PERIOD_MONTH).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${PERIOD_YEAR}-${mm}-${dd}`;
}

const DOC_TYPE_CODE: Record<number, string> = {
  0: '01', 1: '03', 2: '05', 3: '14', 4: '06', 5: '04',
  6: '08', 7: '11', 8: '07', 9: '09', 10: '15',
};

const CUSTOMER_CCF = {
  id: 'cust-ccf',
  firstName: 'Empresa',
  lastName: 'Receptora',
  name: 'Empresa Receptora S.A.',
  businessName: 'Empresa Receptora S.A.',
  nit: '0614-020203-101-1',
  nrc: '1481520',
  email: 'receptor@test.com',
  phone: '2500-1234',
  companyId: TEST_COMPANY.id,
  isActive: true,
  hasContributorRetention: true,
  customerType: 1,
};

const CUSTOMER_CF = {
  id: 'cust-cf',
  firstName: 'Maria',
  lastName: 'Gonzalez',
  name: 'Maria Gonzalez',
  nationalId: '01234567-8',
  email: 'maria@test.com',
  phone: '7700-1234',
  companyId: TEST_COMPANY.id,
  isActive: true,
  customerType: 0,
};

function makeInvoice(
  type: number,
  idx: number,
  opts: {
    status?: number;
    parent?: { numeroControl: string; codigoGeneracion: string; fecha: string };
    sello?: string;
    dayOfMonth: number;
  },
) {
  const id = `${type}-${idx}`;
  const status = opts.status ?? 2; // Completada
  const unitPrice = 113; // IVA-inclusive $100 → tax 13
  const subTotal = 100;
  const tax = 13;
  const iso = dateAt(opts.dayOfMonth);
  const controlNumber = `DTE-${DOC_TYPE_CODE[type]}-M001P001-00000000000${(idx + 1).toString().padStart(4, '0')}`;
  const generationCode = `${type.toString().padStart(8, '0')}-0000-4000-8000-${idx.toString().padStart(12, '0')}`;
  const customer = type === 1 || type === 2 || type === 4 || type === 5 || type === 6 || type === 8 || type === 9
    ? CUSTOMER_CCF
    : CUSTOMER_CF;

  const invoice: any = {
    id,
    invoiceNumber: controlNumber,
    controlNumber,
    generationCode,
    receptionSeal: opts.sello ?? `SELLO-${type}-${idx}`,
    date: iso,
    invoiceType: type,
    status,
    companyId: TEST_COMPANY.id,
    customerId: customer.id,
    customer,
    items: [
      {
        id: `${id}-it1`,
        invoiceId: id,
        productId: 'prod-001',
        productName: 'Servicio de Prueba',
        quantity: 1,
        unitPrice,
        createdAt: iso,
        updatedAt: iso,
      },
    ],
    subtotal: subTotal,
    tax,
    totalAmount: subTotal,
    totalAmountIncludingTax: unitPrice,
    totals: {
      subTotal,
      tax,
      totalAmount: subTotal,
      totalPagar: unitPrice,
      ivaAmount: tax,
      totalItems: 1,
      isCCF: type === 1,
      version: type === 1 ? 3 : 1,
    },
    documentType: DOC_TYPE_CODE[type],
    createdAt: iso,
    updatedAt: iso,
  };

  if (opts.parent) {
    invoice.relatedDocumentType = '03';
    invoice.relatedDocumentNumber = opts.parent.codigoGeneracion;
    invoice.relatedDocumentDate = opts.parent.fecha;
    invoice.relatedInvoiceType = 1;
  }

  return invoice;
}

/**
 * Generate 3 invoices per DTE type. One of each type is marked Anulada so the
 * Anulados annex is populated for every type. Linked DTEs (NC/ND/NR/CL/CR/DCL)
 * reference CCF #1 of the same month as their parent.
 */
function buildMonthlyDataset() {
  const invoices: any[] = [];
  let dayCursor = 2;

  // Build CCFs first so we have parent codes for linked types.
  const parentCCFs: any[] = [];
  for (let i = 0; i < 3; i++) {
    const inv = makeInvoice(1, i, { dayOfMonth: dayCursor++ });
    parentCCFs.push(inv);
    invoices.push(inv);
  }

  const FACTURA = 0, CCF = 1, NC = 2, SE = 3, ND = 4, NR = 5, CL = 6, FE = 7, CR = 8, DCL = 9, CD = 10;
  const simpleTypes = [FACTURA, SE, FE, CD];
  for (const type of simpleTypes) {
    for (let i = 0; i < 3; i++) {
      invoices.push(makeInvoice(type, i, { dayOfMonth: dayCursor++ }));
    }
  }

  const linkedTypes = [NC, ND, NR, CL, CR, DCL];
  for (const type of linkedTypes) {
    for (let i = 0; i < 3; i++) {
      const parent = parentCCFs[i % parentCCFs.length];
      invoices.push(
        makeInvoice(type, i, {
          dayOfMonth: dayCursor++,
          parent: {
            numeroControl: parent.controlNumber,
            codigoGeneracion: parent.generationCode,
            fecha: parent.date,
          },
        }),
      );
    }
  }

  // Mark one extra invoice per major type as Anulada to exercise the Anulados
  // annex. Keep them inside the same period.
  const anuladoTypes = [FACTURA, CCF, NC, ND, FE];
  for (let i = 0; i < anuladoTypes.length; i++) {
    invoices.push(
      makeInvoice(anuladoTypes[i], 100 + i, {
        dayOfMonth: dayCursor++,
        status: 3, // Anulada
      }),
    );
  }

  // Compras: 4 tipoDTE 03 (Anexo 3), 1 tipoDTE 01 (Anexo 3), 3 tipoDTE 14 (Anexo 5).
  const compras: any[] = [];
  const baseFecha = day(15);
  for (let i = 0; i < 4; i++) {
    compras.push({
      id: `c-03-${i}`,
      companyId: TEST_COMPANY.id,
      emisorNit: `0614-111111-111-${i}`,
      emisorNombre: `Proveedor ${i}`,
      emisorNombreComercial: `Proveedor ${i}`,
      tipoDte: '03',
      codigoGeneracion: `A${i.toString().padStart(8, '0')}-0000-4000-8000-111111111111`,
      numeroControl: `DTE-03-M001P001-0000000000001${i}`,
      selloRecibido: `SEL-C03-${i}`,
      fecha: baseFecha,
      totalGravada: 200,
      totalIva: 26,
      totalPagar: 226,
      source: 'email',
      items: [],
      createdAt: new Date(baseFecha).toISOString(),
      updatedAt: new Date(baseFecha).toISOString(),
    });
  }
  compras.push({
    id: 'c-01-0',
    companyId: TEST_COMPANY.id,
    emisorNit: '0614-222222-222-2',
    emisorNombre: 'Proveedor Factura',
    tipoDte: '01',
    codigoGeneracion: 'B0000000-0000-4000-8000-222222222222',
    numeroControl: 'DTE-01-M001P001-000000000000001',
    selloRecibido: 'SEL-C01',
    fecha: baseFecha,
    totalGravada: 88.5,
    totalIva: 11.5,
    totalPagar: 100,
    source: 'email',
    items: [],
    createdAt: new Date(baseFecha).toISOString(),
    updatedAt: new Date(baseFecha).toISOString(),
  });
  for (let i = 0; i < 3; i++) {
    compras.push({
      id: `c-14-${i}`,
      companyId: TEST_COMPANY.id,
      emisorNit: `01234567-${i}`, // 9 chars → DUI path
      emisorNombre: `Sujeto Excluido ${i}`,
      tipoDte: '14',
      codigoGeneracion: `C${i.toString().padStart(8, '0')}-0000-4000-8000-333333333333`,
      numeroControl: `DTE-14-M001P001-0000000000002${i}`,
      selloRecibido: `SEL-C14-${i}`,
      fecha: baseFecha,
      totalGravada: 50,
      totalIva: 6.5,
      totalPagar: 56.5,
      source: 'manual',
      items: [],
      createdAt: new Date(baseFecha).toISOString(),
      updatedAt: new Date(baseFecha).toISOString(),
    });
  }

  return { invoices, compras };
}

/**
 * Parse a CSV artifact (as emitted by MHAnnexExportService) into rows of
 * semicolon-separated columns. Strips the UTF-8 BOM and drops blank tail rows.
 */
function parseCsv(content: string): string[][] {
  const stripped = content.replace(/^\uFEFF/, '');
  return stripped
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => l.split(';'));
}

async function seedWithDataset(page: Page, invoices: any[], compras: any[]) {
  // seedPopulatedAppState registers an init script that clobbers the invoice/
  // compra slices with empty arrays. addInitScripts run in registration order,
  // so we register ours AFTER that call and then reload — our script runs
  // last, overwriting the empty slices with our dataset.
  await seedPopulatedAppState(page);
  await page.addInitScript(
    ([invs, comps]: [any[], any[]]) => {
      const writeSlice = (key: string, body: Record<string, unknown>) => {
        const wrapped: Record<string, string> = {};
        for (const [k, v] of Object.entries(body)) wrapped[k] = JSON.stringify(v);
        wrapped._persist = JSON.stringify({ version: -1, rehydrated: true });
        localStorage.setItem(`persist:${key}`, JSON.stringify(wrapped));
      };
      // The Libro de Compras reads the company's full ledger from
      // ComprasDatabase (appStorage key compras_db_<companyId>), not the
      // Compras page's filtered redux view.
      const byCompany = new Map<string, any[]>();
      for (const c of comps) byCompany.set(c.companyId, [...(byCompany.get(c.companyId) ?? []), c]);
      for (const [companyId, list] of byCompany) localStorage.setItem(`compras_db_${companyId}`, JSON.stringify(list));
      writeSlice('invoices', {
        invoices: invs,
        loading: false,
        error: null,
        searchTerm: '',
        filters: {},
      });
      writeSlice('compras', {
        compras: comps,
        monthlyTotal: null,
        dbInitialized: true,
        loading: false,
        error: null,
        searchTerm: '',
        dateFrom: null,
        dateTo: null,
        selectedCompraId: null,
        linkedGmailEmail: null,
        syncState: null,
      });
    },
    [invoices, compras] as [any[], any[]],
  );
  await page.goto('/#/');
  await page.reload();
  await waitForAppReady(page);
}

test.describe('Libros IVA — end-to-end over a realistic monthly dataset', () => {
  test('populates 3+ docs per type, generates all 5 annexes, and shape-checks each CSV', async ({ page }) => {
    test.setTimeout(60_000);
    const { invoices, compras } = buildMonthlyDataset();

    await seedWithDataset(page, invoices, compras);

    // Drive the export via the real service (no file downloads in headless).
    const result = await page.evaluate(
      async ([invs, comps]: [any[], any[]]) => {
        const mod = await import('/src/services/export/MHAnnexExportService.ts');
        const svc = mod.MHAnnexExportService ?? mod.default;
        const out = await svc.exportMHAnexos(invs, comps, 'TestCo', { download: false });
        return {
          counts: out.counts,
          artifacts: out.artifacts.map((a: any) => ({
            fileName: a.fileName,
            content: a.content,
          })),
        };
      },
      [invoices, compras] as [any[], any[]],
    );

    const byName: Record<string, string> = {};
    for (const a of result.artifacts) byName[a.fileName.split('_')[0]] = a.content;

    // All five annexes must be present.
    expect(Object.keys(byName).sort()).toEqual(
      ['Anexo1', 'Anexo2', 'Anexo3', 'Anexo5', 'Anulados'],
    );

    // ── Anexo 1 — CCF + NC + ND (Completada) ──────────────────────────
    const a1 = parseCsv(byName.Anexo1);
    // 3 completed CCFs + 3 NC + 3 ND (the Anuladas are excluded). Notas de
    // crédito/débito adjust the CCFs, so they are rows of this annex with their
    // own document type; an NC subtracts.
    expect(a1).toHaveLength(9);
    expect(a1.filter((r) => r[2] === '03')).toHaveLength(3);
    expect(a1.filter((r) => r[2] === '05')).toHaveLength(3);
    expect(a1.filter((r) => r[2] === '06')).toHaveLength(3);
    for (const row of a1) {
      const sign = row[2] === '05' ? '-' : '';
      expect(row).toHaveLength(20); // v15 spec
      expect(row[1]).toBe('4'); // clase de documento
      expect(['03', '05', '06']).toContain(row[2]);
      expect(row[3]).toMatch(/^[A-Z0-9]+$/); // numeroControl (no hyphens)
      expect(row[5]).toMatch(/^[A-Fa-f0-9]+$/); // codigoGeneracion (no hyphens)
      expect(row[7]).toBe('06140202031011'); // NIT digits only
      expect(row[8]).toBe('EMPRESA RECEPTORA S.A.'); // razón social
      expect(row[11]).toBe(`${sign}100.00`); // ventas gravadas
      expect(row[12]).toBe(`${sign}13.00`); // débito fiscal
      expect(row[15]).toBe(`${sign}100.00`); // total ventas
      expect(row[17]).toBe('1'); // tipo de operación — solo gravada
      expect(row[19]).toBe('1'); // número de anexo
    }

    // ── Anexo 2 — Factura + FE grouped by day ─────────────────────────
    const a2 = parseCsv(byName.Anexo2);
    // 3 Facturas + 3 FE, each on its own day → 6 rows.
    expect(a2.length).toBe(6);
    for (const row of a2) {
      expect(row).toHaveLength(23); // v15 spec
      expect(row[1]).toBe('4');
      expect(['01', '11']).toContain(row[2]);
      expect(row[3]).toBe('N/A');
      expect(row[22]).toBe('2'); // número de anexo
    }

    // ── Anulados — one row per anulada ────────────────────────────────
    const anul = parseCsv(byName.Anulados);
    expect(anul).toHaveLength(5);
    for (const row of anul) {
      expect(row).toHaveLength(10);
      expect(row[0]).not.toBe(''); // col A = numeroControl (fixed bug)
      expect(row[1]).toBe('4');
      expect(row[5]).toBe('D');
      expect(row[6]).not.toBe(''); // col G = selloRecibido (fixed bug)
      expect(row[9]).toMatch(/^[A-Fa-f0-9]+$/);
    }

    // ── Anexo 3 — purchases with crédito fiscal (03; a Factura 01 gives none)
    const a3 = parseCsv(byName.Anexo3);
    expect(a3).toHaveLength(4); // 4× 03 — the 01 purchase is not in this annex
    for (const row of a3) {
      expect(row).toHaveLength(21); // v15 spec
      expect(row[1]).toBe('4');
      expect(row[2]).toBe('03');
      // Col O (index 14) is NET purchase amount, NOT totalPagar.
      expect(row[14]).toBe('200.00');
      // Col N (index 13) uses actual IVA from DTE.
      expect(row[13]).toBe('26.00');
      expect(row[20]).toBe('3'); // número de anexo
    }

    // ── Anexo 5 — compras sujetos excluidos ───────────────────────────
    // 3 FSE the company issued (the buyer issues the FSE) + 3 tipo 14 compras.
    const a5 = parseCsv(byName.Anexo5);
    expect(a5).toHaveLength(6);
    for (const row of a5) {
      expect(row).toHaveLength(13);
      expect(row[0]).toBe('2'); // DUI (9-digit NIT)
      expect(row[4]).not.toBe(''); // col E = selloRecibido (fixed bug)
      expect(row[12]).toBe('5'); // número de anexo
    }

    // Counts summary should match what we constructed.
    expect(result.counts).toEqual({
      anexo1: 9, // 3 CCF + 3 NC + 3 ND
      anexo2: 6, // Anexo 2 counts invoices (6), not groups (3)
      anexo3: 4,
      anexo5: 6, // 3 issued FSE + 3 tipo 14 compras
      anulados: 5,
    });
  });

  test('LibrosIVAPage export button produces artifacts for the seeded period', async ({ page }) => {
    test.setTimeout(60_000);
    const { invoices, compras } = buildMonthlyDataset();
    // A document dated the 1st (date-only) belongs to this month — parsing it
    // with `new Date()` read UTC midnight (the previous day in El Salvador).
    const firstOfMonth = { ...makeInvoice(0, 50, { dayOfMonth: 1 }), date: day(1) };
    // Another company's documents (e.g. a production company's TEST clone)
    // never enter this company's F-07.
    const otherCompanyInvoice = { ...makeInvoice(1, 60, { dayOfMonth: 3 }), id: 'other-co-ccf', companyId: 'other-company' };
    const otherCompanyCompra = { ...compras[0], id: 'other-co-compra', companyId: 'other-company' };
    await seedWithDataset(page, [...invoices, firstOfMonth, otherCompanyInvoice], [...compras, otherCompanyCompra]);

    await page.goto('/#/invoices/libros-iva');
    // Hash-only navigations don't re-run addInitScripts. Force a full reload
    // so redux-persist re-rehydrates from the overridden localStorage.
    await page.reload();
    await waitForAppReady(page);

    await expect(page.getByTestId('libros-iva')).toBeVisible();

    // The dataset's day cursor runs past the month's end (Date.UTC rolls into
    // the next month), so count by date — plus the one dated the 1st.
    const expectedTotal = invoices.filter((i) => {
      const d = new Date(i.date);
      return d.getFullYear() === PERIOD_YEAR && d.getMonth() === PERIOD_MONTH_IDX;
    }).length + 1;
    // The summary table's final row is the "Total" accumulator with cells:
    // [label, total, completados, anulados]. Anchor on the label to avoid
    // brittle sibling-index traversal if the table layout shifts.
    const totalRow = page.locator('tbody tr').filter({ hasText: 'Total' }).last();
    await expect(totalRow).toBeVisible();
    await expect(totalRow.locator('td').nth(1)).toHaveText(String(expectedTotal));
    // The purchase ledger comes from ComprasDatabase for THIS company only.
    await expect(page.getByText(`${expectedTotal} DTE · ${compras.length} compras`)).toBeVisible();
  });
});
