import QRCode from 'qrcode';
import { InvoicePDFGenerator } from '../services/pdf/InvoicePDFGenerator';
import { Company, CompanyEnvironment, CompanyStatus } from '../types/company';
import { Invoice, InvoiceStatus, InvoiceType } from '../types/invoice';

jest.mock('qrcode', () => ({
  __esModule: true,
  default: { toDataURL: jest.fn(async () => 'data:image/png;base64,AAAA') },
}));
jest.mock('@/assets/facturasSimples.png', () => 'logo.png', { virtual: true });

const company = (overrides: Partial<Company>): Company => ({
  id: 'company-1',
  nit: '06141404941342',
  nombre: 'Jorge Flores',
  nombreComercial: 'Facturas Simples',
  nrc: '3174',
  correo: 'test@example.com',
  telefono: '22222222',
  complemento: 'San Salvador',
  direccion: 'San Salvador',
  departamentoCode: '06',
  departamento: 'San Salvador',
  municipioCode: '14',
  municipio: 'San Salvador',
  codActividad: '62020',
  descActividad: 'Consultoria en informatica',
  tipoEstablecimiento: '01',
  establecimiento: 'Casa matriz',
  codEstableMH: 'M001',
  codEstable: '',
  codPuntoVentaMH: 'P001',
  codPuntoVenta: '',
  environment: CompanyEnvironment.Development,
  isTestAccount: false,
  hasValidCertificate: true,
  ivaPercentage: 13,
  currentInvoiceNumber: 1,
  currentCCFNumber: 1,
  hasApiCredentials: true,
  status: CompanyStatus.Active,
  isDefault: true,
  userId: 'user-1',
  createdAt: '2026-06-09T00:00:00.000Z',
  updatedAt: '2026-06-09T00:00:00.000Z',
  ...overrides,
});

const invoice: Invoice = {
  id: 'invoice-1',
  invoiceNumber: '00001',
  date: '2026-06-10T16:30:00.000Z',
  status: InvoiceStatus.Completada,
  invoiceType: InvoiceType.Factura,
  documentType: '01',
  generationCode: '11111111-1111-4111-8111-111111111111',
  controlNumber: 'DTE-01-M001P001-000000000000001',
  receptionSeal: 'SELLO',
  companyId: 'company-1',
  items: [
    {
      id: 'item-1',
      invoiceId: 'invoice-1',
      productId: 'product-1',
      productName: 'Servicio',
      quantity: 1,
      unitPrice: 113,
      obsItem: '',
      createdAt: '2026-06-10T16:30:00.000Z',
      updatedAt: '2026-06-10T16:30:00.000Z',
    },
  ],
  totalAmount: 113,
  totalAmountIncludingTax: 113,
  createdAt: '2026-06-10T16:30:00.000Z',
  updatedAt: '2026-06-10T16:30:00.000Z',
} as Invoice;

const qrUrlFor = async (c: Company): Promise<string> => {
  const toDataURL = (QRCode as any).toDataURL as jest.Mock;
  toDataURL.mockClear();
  await InvoicePDFGenerator.getPreviewHTML(invoice, c);
  return toDataURL.mock.calls[0][0];
};

describe('InvoicePDFGenerator QR ambiente', () => {
  it('points a production company (environment only, no legacy flag) at the production portal', async () => {
    // Regression: the QR read company.isProduction, which only promoteToProduction
    // sets — any other production company printed a QR for Hacienda's TEST portal.
    const url = await qrUrlFor(company({ environment: CompanyEnvironment.Production }));
    expect(url).toContain('https://admin.factura.gob.sv/consultaPublica');
    expect(url).toContain('ambiente=01');
  });

  it('test companies use the official consulta pública host with ambiente=00 (Manual Técnico v2.0 §5)', async () => {
    const url = await qrUrlFor(company({ environment: CompanyEnvironment.Development }));
    expect(url).toContain('https://admin.factura.gob.sv/consultaPublica?');
    expect(url).toContain('ambiente=00');
  });
});
