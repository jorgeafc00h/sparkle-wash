// DTEJsonParser — DTE tax-breakdown fields (resumen) — Libro de Compras (F-07 anexo)
//
// Verifies totalNoSuj/totalExenta/subTotal/ivaRete1/reteRenta/
// montoTotalOperacion/tipoMoneda/horaEmision/receptor* are extracted from the
// DTE `resumen`/`receptor`/`identificacion` exactly as SwiftUI does, and that
// a DTE lacking them still parses cleanly (fields left undefined).

import { DTEJsonParser } from '../services/compras/DTEJsonParser';
import { CompraSource } from '../types/compras';

const baseDte = {
  identificacion: {
    tipoDte: '03',
    codigoGeneracion: '12345678-1234-4123-8123-123456789ABC',
    numeroControl: 'DTE-03-M001P001-000000000000001',
    fecEmi: '2026-06-20',
    horEmi: '14:22:10',
  },
  emisor: {
    nit: '06140101011011',
    nrc: '123456',
    nombre: 'Proveedor Demo',
  },
  receptor: {
    nit: '06140101991022',
    nombre: 'Mi Empresa',
    nrc: '999999-1',
  },
  cuerpoDocumento: [
    {
      numItem: 1,
      descripcion: 'Servicio',
      cantidad: 1,
      precioUni: 100,
      ventaGravada: 100,
      ivaItem: 13,
    },
  ],
  resumen: {
    totalNoSuj: 5,
    totalExenta: 10,
    totalGravada: 100,
    subTotal: 115,
    totalIva: 13,
    ivaRete1: 1.15,
    reteRenta: 2.5,
    totalPagar: 124.35,
    montoTotalOperacion: 124.35,
    tipoMoneda: 'USD',
  },
};

describe('DTEJsonParser — DTE tax-breakdown fields', () => {
  it('populates totalNoSuj, totalExenta, subTotal, ivaRete1 and reteRenta from resumen', () => {
    const compra = DTEJsonParser.parseDTEObject(baseDte, 'company-001', CompraSource.Manual);

    expect(compra).not.toBeNull();
    expect(compra!.totalNoSuj).toBe(5);
    expect(compra!.totalExenta).toBe(10);
    expect(compra!.subTotal).toBe(115);
    expect(compra!.ivaRete1).toBe(1.15);
    expect(compra!.reteRenta).toBe(2.5);
    expect(compra!.montoTotalOperacion).toBe(124.35);
    expect(compra!.tipoMoneda).toBe('USD');
    expect(compra!.horaEmision).toBe('14:22:10');
    expect(compra!.receptorNit).toBe('06140101991022');
    expect(compra!.receptorNombre).toBe('Mi Empresa');
    expect(compra!.receptorNrc).toBe('999999-1');
  });

  it('falls back montoTotalOperacion to resumen.totalPagar when montoTotalOperacion is absent', () => {
    const compra = DTEJsonParser.parseDTEObject(
      {
        ...baseDte,
        resumen: { totalGravada: 100, totalIva: 13, totalPagar: 113 },
      },
      'company-001',
      CompraSource.Manual,
    );

    expect(compra).not.toBeNull();
    expect(compra!.montoTotalOperacion).toBe(113);
  });

  it('falls back receptorNit to receptor.numDocumento when receptor.nit is absent', () => {
    const compra = DTEJsonParser.parseDTEObject(
      {
        ...baseDte,
        receptor: { numDocumento: '123456789', nombre: 'Sujeto Excluido Comprador' },
      },
      'company-001',
      CompraSource.Manual,
    );

    expect(compra).not.toBeNull();
    expect(compra!.receptorNit).toBe('123456789');
  });

  it('defaults tipoMoneda to "USD" when resumen.tipoMoneda is absent', () => {
    const compra = DTEJsonParser.parseDTEObject(
      { ...baseDte, resumen: { totalGravada: 100, totalIva: 13, totalPagar: 113 } },
      'company-001',
      CompraSource.Manual,
    );

    expect(compra).not.toBeNull();
    expect(compra!.tipoMoneda).toBe('USD');
  });

  it('leaves the new tax-breakdown fields undefined when resumen/receptor lack them (no crash)', () => {
    const compra = DTEJsonParser.parseDTEObject(
      {
        identificacion: {
          tipoDte: '01',
          codigoGeneracion: 'CODIGO-GEN-NOTAX-001',
          numeroControl: 'DTE-01-0001',
          fecEmi: '2026-06-20',
        },
        emisor: { nombre: 'Emisor SA' },
        resumen: { totalGravada: 100, totalIva: 13, totalPagar: 113 },
      },
      'company-001',
      CompraSource.Manual,
    );

    expect(compra).not.toBeNull();
    expect(compra!.totalNoSuj).toBeUndefined();
    expect(compra!.totalExenta).toBeUndefined();
    expect(compra!.subTotal).toBeUndefined();
    expect(compra!.ivaRete1).toBeUndefined();
    expect(compra!.reteRenta).toBeUndefined();
    expect(compra!.horaEmision).toBeUndefined();
    expect(compra!.receptorNit).toBeUndefined();
    expect(compra!.receptorNombre).toBeUndefined();
    expect(compra!.receptorNrc).toBeUndefined();
    // montoTotalOperacion/tipoMoneda still resolve via their fallbacks
    expect(compra!.montoTotalOperacion).toBe(113);
    expect(compra!.tipoMoneda).toBe('USD');
  });

  it('handles a real-shape CCF DTE (mirrors RN fixture compras_fixture.json[0]) without crashing', () => {
    // Inlined from the RN suite's src/tests/fixtures/compras_fixture.json entry
    // 0 (a real "SUPER REPUESTOS EL SALVADOR" CCF) — inlined rather than
    // required across the sibling repo checkout, to keep this suite
    // self-contained.
    const realShapeDte = {
      identificacion: {
        version: 3,
        ambiente: '01',
        tipoDte: '03',
        numeroControl: 'DTE-03-S006P001-000000003346058',
        codigoGeneracion: '5BDEB003-E9B5-1AE4-B82A-0004AC1EA976',
        fecEmi: '2025-10-24',
        horEmi: '11:32:54',
        tipoMoneda: 'USD',
      },
      emisor: {
        nit: '06141511720027',
        nrc: '2755',
        nombre: 'SUPER REPUESTOS EL SALVADOR, S.A. DE C.V.',
      },
      receptor: {
        numDocumento: null,
        nit: '049832999',
        nrc: '3238005',
        nombre: 'SANDOVAL FLORES, DANIEL ERNESTO',
      },
      cuerpoDocumento: [
        { numItem: 1, descripcion: 'FILTRO DE ACEITE', cantidad: 1, precioUni: 5.0, ventaGravada: 5.0 },
      ],
      resumen: {
        totalNoSuj: 0,
        totalExenta: 0,
        totalGravada: 5.0,
        subTotal: 4.0,
        ivaPerci1: 0,
        ivaRete1: 0,
        reteRenta: 0,
        montoTotalOperacion: 4.52,
        condicionOperacion: 2,
      },
    };

    const compra = DTEJsonParser.parse(JSON.stringify(realShapeDte), 'company-001', CompraSource.Manual);

    expect(compra).not.toBeNull();
    expect(compra!.totalGravada).toBe(5.0);
    expect(compra!.subTotal).toBe(4.0);
    expect(compra!.montoTotalOperacion).toBe(4.52);
    expect(compra!.tipoMoneda).toBe('USD'); // resumen.tipoMoneda absent → default
    expect(compra!.receptorNit).toBe('049832999');
    expect(compra!.receptorNombre).toBe('SANDOVAL FLORES, DANIEL ERNESTO');
    expect(compra!.receptorNrc).toBe('3238005');
  });
});
