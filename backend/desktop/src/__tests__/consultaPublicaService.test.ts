import { ConsultaPublicaService } from '../services/compras/ConsultaPublicaService';
import { Compra, CompraSource } from '../types/compras';

const makeCompra = (): Compra => ({
  id: 'compra-1',
  companyId: 'company-1',
  emisorNit: '06140101991011',
  emisorNombre: 'Proveedor SA de CV',
  tipoDte: '03',
  codigoGeneracion: 'A1111111-2222-3333-4444-555555555555',
  numeroControl: 'DTE-03-M001P001-000000000000001',
  fecha: '2026-06-01',
  totalGravada: 100,
  totalIva: 13,
  totalPagar: 113,
  source: CompraSource.Email,
  items: [],
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
});

const makeMhResponse = (overrides: Record<string, unknown> = {}) => ({
  action: 'OK',
  estadoDoc: 'Transmitido Satisfactoriamente',
  descripcionEstado: 'Documento Recibido',
  codGen: 'A1111111-2222-3333-4444-555555555555',
  selloVal: 'SELLO-MH',
  tipoDte: '03',
  nombDte: 'COMPROBANTE DE CREDITO FISCAL',
  invalidacion: null,
  documento: {
    resumen: {
      totalPagar: 113,
      montoTotalOperacion: 113,
    },
  },
  ...overrides,
});

describe('ConsultaPublicaService purchase verification', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn();
  });

  it('uses production consulta publica and ambiente=01 even for test-mode callers', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(makeMhResponse()),
    });

    await ConsultaPublicaService.verifyCompra(makeCompra(), false);

    const url = String((global.fetch as jest.Mock).mock.calls[0][0]);
    expect(url).toContain('/prod/consultas/publica/simple/1');
    expect(url).toContain('ambiente=01');
  });

  it('marks transmitted documents as verified', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(makeMhResponse()),
    });

    await expect(ConsultaPublicaService.verifyCompra(makeCompra(), false)).resolves.toEqual(
      expect.objectContaining({
        verified: true,
        estado: 'Transmitido Satisfactoriamente',
      }),
    );
  });

  it('does not mark rejected documents as verified', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(makeMhResponse({ estadoDoc: 'Rechazado' })),
    });

    await expect(ConsultaPublicaService.verifyCompra(makeCompra(), true)).resolves.toEqual(
      expect.objectContaining({
        verified: false,
        estado: 'Rechazado',
      }),
    );
  });
});
