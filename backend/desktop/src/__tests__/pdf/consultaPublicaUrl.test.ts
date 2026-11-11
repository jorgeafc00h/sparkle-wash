jest.mock('@/assets/facturasSimples.png', () => 'logo.png', { virtual: true });
jest.mock('qrcode', () => ({ toDataURL: jest.fn() }));

import { consultaPublicaUrl } from '@/services/pdf/InvoicePDFGenerator';
import { CompanyEnvironment } from '@/types/company';

const codGen = 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D';

describe('consultaPublicaUrl (DTE QR, Manual Técnico v2.0 §5)', () => {
  it('uses the official host for BOTH ambientes and a zero-padded fechaEmi', () => {
    expect(consultaPublicaUrl({ generationCode: codGen, date: '2026-01-09T15:00:00.000Z' }, { environment: CompanyEnvironment.Development }))
      .toBe(`https://admin.factura.gob.sv/consultaPublica?ambiente=00&codGen=${codGen}&fechaEmi=2026-01-09`);
    expect(consultaPublicaUrl({ generationCode: codGen, date: '2026-01-09' }, { environment: CompanyEnvironment.Production }))
      .toBe(`https://admin.factura.gob.sv/consultaPublica?ambiente=01&codGen=${codGen}&fechaEmi=2026-01-09`);
  });

  it('uses the El Salvador calendar date (a 23:30 sale stays on its local day)', () => {
    // 2026-03-02 05:30 UTC = 2026-03-01 23:30 in El Salvador (UTC−6)
    expect(consultaPublicaUrl({ generationCode: codGen, date: '2026-03-02T05:30:00.000Z' }, { environment: CompanyEnvironment.Production }))
      .toContain('fechaEmi=2026-03-01');
  });

  it('is empty before the invoice has a codigoGeneracion', () => {
    expect(consultaPublicaUrl({ generationCode: undefined, date: '2026-01-09' }, { environment: CompanyEnvironment.Production })).toBe('');
  });
});
