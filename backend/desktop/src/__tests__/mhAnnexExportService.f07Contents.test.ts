// F-07 annex contents: NC/ND belong to Anexo 1 with signed amounts, FE
// purchases give no crédito fiscal (out of Anexo 3), issued FSE are Anexo 5
// purchases, customer razón social + digits-only NIT, SV calendar dates.

import { MHAnnexExportService, NOTA_CREDITO_AMOUNT_SIGN } from '../services/export/MHAnnexExportService';
import { InvoiceStatus, InvoiceType, type Invoice } from '../types/invoice';
import type { Customer } from '../types/customer';
import type { Compra } from '../types/compras';

const CCF_CUSTOMER = {
  id: 'cust-ccf',
  firstName: 'Juan',
  lastName: 'Pérez',
  businessName: 'Distribuidora El Sol, S.A. de C.V.',
  nit: '0614-020203-101-1',
  nrc: '148152-0',
  nationalId: '',
  companyId: 'co',
} as unknown as Customer;

const FSE_SUPPLIER = {
  id: 'cust-fse',
  firstName: 'María',
  lastName: 'López',
  nit: '',
  nationalId: '01234567-8',
  companyId: 'co',
} as unknown as Customer;

const TYPE_CODE: Partial<Record<InvoiceType, string>> = {
  [InvoiceType.CCF]: '03', [InvoiceType.NotaCredito]: '05', [InvoiceType.NotaDebito]: '06',
  [InvoiceType.SujetoExcluido]: '14', [InvoiceType.Factura]: '01',
};

function inv(id: string, invoiceType: InvoiceType, over: Partial<Invoice> = {}): Invoice {
  return {
    id,
    invoiceNumber: id,
    controlNumber: `DTE-${TYPE_CODE[invoiceType]}-M001P001-000000000000001`,
    generationCode: 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE',
    receptionSeal: 'SELLO1',
    date: '2026-10-01',
    status: InvoiceStatus.Completada,
    invoiceType,
    documentType: TYPE_CODE[invoiceType] ?? '01',
    companyId: 'co',
    items: [],
    totals: { totalAmount: 113, tax: 13, subTotal: 100, reteRenta: 11.3, totalPagar: 113, ivaRete1: 0, totalWithoutTax: 100, isCCF: true, totalItems: 1, version: 1 },
    createdAt: '',
    updatedAt: '',
    ...over,
  } as Invoice;
}

function purchase(id: string, tipoDte: string, over: Partial<Compra> = {}): Compra {
  return {
    id,
    companyId: 'co',
    emisorNit: '0614-111111-111-1',
    emisorNombre: `Proveedor ${id}`,
    tipoDte,
    codigoGeneracion: `${id.padEnd(8, '0').slice(0, 8).toUpperCase()}-0000-4000-8000-000000000000`,
    numeroControl: 'X',
    fecha: '2026-10-15',
    totalGravada: 200,
    totalIva: 26,
    totalPagar: 226,
    source: 'manual',
    items: [],
    ...over,
  } as Compra;
}

const rows = (content: string | undefined) =>
  (content ?? '').replace(/^﻿/, '').split('\n').filter(Boolean).map((l) => l.split(';'));

async function exportAll(invoices: Invoice[], compras: Compra[] = [], customers: Customer[] = []) {
  const result = await MHAnnexExportService.exportMHAnexos(invoices, compras, 'Co', { download: false, customers });
  const byName: Record<string, string> = {};
  for (const a of result.artifacts) byName[a.fileName.split('_')[0]] = a.content;
  return { result, byName };
}

describe('Anexo 1 — ventas a contribuyentes', () => {
  it('includes CCF, NC and ND with their document type; NC amounts subtract', async () => {
    const { byName, result } = await exportAll(
      [
        inv('ccf', InvoiceType.CCF, { customerId: CCF_CUSTOMER.id }),
        inv('nc', InvoiceType.NotaCredito, { customer: CCF_CUSTOMER, date: '2026-10-05' }),
        inv('nd', InvoiceType.NotaDebito, { customer: CCF_CUSTOMER, date: '2026-10-06' }),
        inv('nc-draft', InvoiceType.NotaCredito, { status: InvoiceStatus.Nueva }),
      ],
      [],
      [CCF_CUSTOMER],
    );
    const a1 = rows(byName.Anexo1);
    expect(result.counts.anexo1).toBe(3);
    expect(a1.map((r) => r[2])).toEqual(['03', '05', '06']);
    for (const r of a1) expect(r).toHaveLength(20);

    const [ccf, nc, nd] = a1;
    expect(ccf.slice(11, 13)).toEqual(['100.00', '13.00']);
    expect(ccf[15]).toBe('113.00');
    expect(NOTA_CREDITO_AMOUNT_SIGN).toBe(-1);
    expect(nc.slice(11, 13)).toEqual(['-100.00', '-13.00']);
    expect(nc[15]).toBe('-113.00');
    expect(nc[9]).toBe('0.00'); // never "-0.00"
    expect(nd.slice(11, 13)).toEqual(['100.00', '13.00']);
  });

  it('uses the razón social and a digits-only NIT, resolving a customerId-only document', async () => {
    const { byName } = await exportAll([inv('ccf', InvoiceType.CCF, { customerId: CCF_CUSTOMER.id })], [], [CCF_CUSTOMER]);
    const [row] = rows(byName.Anexo1);
    expect(row[7]).toBe('06140202031011');
    expect(row[8]).toBe('DISTRIBUIDORA EL SOL, S.A. DE C.V.');
  });

  it('falls back to the digits-only NRC when the customer has no NIT', async () => {
    const { byName } = await exportAll([inv('ccf', InvoiceType.CCF, { customer: { ...CCF_CUSTOMER, nit: '' } })]);
    expect(rows(byName.Anexo1)[0][7]).toBe('1481520');
  });

  it('dates rows on the El Salvador calendar day (19:30 SV on Oct 31 is not Nov 1)', async () => {
    const { byName } = await exportAll([inv('ccf', InvoiceType.CCF, { date: '2026-11-01T01:30:00.000Z' })]);
    expect(rows(byName.Anexo1)[0][0]).toBe('31/10/2026');
  });
});

describe('exento / no sujeto buckets', () => {
  it('Anexo 1 puts exento sales in their own column and the whole document in P', async () => {
    const { byName } = await exportAll([inv('ccf', InvoiceType.CCF, {
      customer: CCF_CUSTOMER,
      totals: { totalAmount: 143, tax: 13, subTotal: 100, reteRenta: 0, totalPagar: 143, ivaRete1: 0, totalWithoutTax: 100, isCCF: true, totalItems: 2, version: 1, totalGravada: 100, totalExenta: 30, totalNoSuj: 0 },
    })]);
    const [row] = rows(byName.Anexo1);
    expect([row[9], row[10], row[11], row[12], row[15], row[17]]).toEqual(['30.00', '0.00', '100.00', '13.00', '143.00', '4']);
  });

  it('Anexo 2 never counts exento / no sujeto inside gravadas or twice in the total', async () => {
    const { byName } = await exportAll([inv('fe', InvoiceType.Factura, {
      totals: { totalAmount: 163, tax: 13, subTotal: 100, reteRenta: 0, totalPagar: 163, ivaRete1: 0, totalWithoutTax: 100, isCCF: false, totalItems: 3, version: 1, totalGravada: 113, totalExenta: 30, totalNoSuj: 20 },
    })]);
    const [row] = rows(byName.Anexo2);
    expect(row).toHaveLength(23);
    // K exentas, M no sujetas, N gravadas (IVA incl.), P exportación, T total, U tipo operación
    expect([row[10], row[12], row[13], row[15], row[19], row[20]]).toEqual(['30.00', '20.00', '113.00', '0.00', '163.00', '4']);
  });
});

describe('Anexo 2 — consumidor final', () => {
  it('groups by El Salvador calendar day', async () => {
    const { byName } = await exportAll([
      inv('f1', InvoiceType.Factura, { date: '2026-10-31' }),
      inv('f2', InvoiceType.Factura, { date: '2026-11-01T01:30:00.000Z' }), // Oct 31 19:30 SV
    ]);
    const a2 = rows(byName.Anexo2);
    expect(a2).toHaveLength(1);
    expect(a2[0][0]).toBe('31/10/2026');
  });
});

describe('Anexo 3 — compras con crédito fiscal', () => {
  it('excludes Factura (01) purchases and signs received NC (05)', async () => {
    const { byName, result } = await exportAll([], [
      purchase('c03', '03'),
      purchase('c01', '01', { totalGravada: 88.5, totalIva: 11.5, totalPagar: 100 }),
      purchase('c05', '05', { totalGravada: 50, totalIva: 6.5, totalPagar: 56.5 }),
    ]);
    const a3 = rows(byName.Anexo3);
    expect(result.counts.anexo3).toBe(2);
    expect(a3.map((r) => r[2])).toEqual(['03', '05']);
    expect(a3[0][4]).toBe('06141111111111'); // digits-only NIT
    expect(a3[0][13]).toBe('26.00');
    expect(a3[1].slice(9, 10)).toEqual(['-50.00']);
    expect(a3[1][13]).toBe('-6.50');
    expect(a3[1][14]).toBe('-50.00');
  });
});

describe('Anexo 5 — compras a sujetos excluidos', () => {
  it('includes the FSE the company issued (plus tipo 14 compras, without duplicates)', async () => {
    const issued = inv('fse', InvoiceType.SujetoExcluido, {
      customerId: FSE_SUPPLIER.id,
      generationCode: '11111111-2222-4333-8444-555555555555',
      totals: { totalAmount: 50, tax: 0, subTotal: 50, reteRenta: 5, totalPagar: 45, ivaRete1: 0, totalWithoutTax: 50, isCCF: false, totalItems: 1, version: 1 },
    });
    const { byName, result } = await exportAll(
      [issued, inv('fse-draft', InvoiceType.SujetoExcluido, { status: InvoiceStatus.Nueva })],
      [
        purchase('c14', '14', { emisorNit: '01234567-9' }),
        // Same document already issued here → not repeated.
        purchase('dup', '14', { codigoGeneracion: '11111111-2222-4333-8444-555555555555' }),
      ],
      [FSE_SUPPLIER],
    );
    const a5 = rows(byName.Anexo5);
    expect(result.counts.anexo5).toBe(2);
    expect(a5).toHaveLength(2);
    const [fse] = a5;
    expect(fse).toHaveLength(13);
    expect(fse.slice(0, 4)).toEqual(['2', '012345678', 'María López', '01/10/2026']);
    expect(fse[4]).toBe('SELLO1');
    expect(fse[5]).toBe('11111111222243338444555555555555');
    expect(fse[6]).toBe('50.00');
    expect(fse[12]).toBe('5');
  });
});
