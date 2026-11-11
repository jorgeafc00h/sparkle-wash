import { DTEJsonParser } from '../services/compras/DTEJsonParser';
import { CompraSource } from '../types/compras';

const baseDte = {
  identificacion: {
    tipoDte: '03',
    codigoGeneracion: '12345678-1234-4123-8123-123456789ABC',
    numeroControl: 'DTE-03-M001P001-000000000000001',
    fecEmi: '2026-06-20',
  },
  emisor: {
    nit: '06140101011011',
    nrc: '123456',
    nombre: 'Proveedor Demo',
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
    totalGravada: 100,
    totalIva: 13,
    totalPagar: 113,
  },
};

describe('DTEJsonParser payment terms', () => {
  it('defaults imported compras to contado when payment metadata is absent', () => {
    const compra = DTEJsonParser.parseDTEObject(baseDte, 'company-001', CompraSource.Manual);

    expect(compra).toMatchObject({
      paymentCondition: 1,
      paymentTermCode: null,
      paymentTermPeriod: null,
      openInAccounts: false,
    });
    expect(compra?.dueDate).toBeUndefined();
  });

  it('persists credit condition, plazo, periodo and computed due date from resumen.pagos', () => {
    const compra = DTEJsonParser.parseDTEObject({
      ...baseDte,
      resumen: {
        ...baseDte.resumen,
        condicionOperacion: 2,
        pagos: [
          {
            plazo: '01',
            periodo: 45,
          },
        ],
      },
    }, 'company-001', CompraSource.Email);

    expect(compra).toMatchObject({
      paymentCondition: 2,
      paymentTermCode: '01',
      paymentTermPeriod: 45,
      dueDate: '2026-08-04',
    });
  });

  it('normalizes invalid payment condition values to contado', () => {
    const compra = DTEJsonParser.parseDTEObject({
      ...baseDte,
      resumen: {
        ...baseDte.resumen,
        condicionOperacion: 9,
        pagos: [{ plazo: '01', periodo: 30 }],
      },
    }, 'company-001', CompraSource.Manual);

    expect(compra).toMatchObject({
      paymentCondition: 1,
      paymentTermCode: null,
      paymentTermPeriod: null,
    });
    expect(compra?.dueDate).toBeUndefined();
  });
});
