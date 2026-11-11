import { MHAnnexExportService } from '../services/export/MHAnnexExportService';
import { InvoiceStatus, InvoiceType } from '../types';

describe('MHAnnexExportService documentType mapping', () => {
  it('uses the correct DTE code for invalidated 07, 09, and 15 documents', async () => {
    const invoices = [
      { invoiceType: InvoiceType.ComprobanteRetencion, generationCode: 'gen-07' },
      { invoiceType: InvoiceType.DocumentoContableLiquidacion, generationCode: 'gen-09' },
      { invoiceType: InvoiceType.ComprobanteDonacion, generationCode: 'gen-15' },
    ].map((invoice, index) => ({
      id: `inv-${index}`,
      invoiceNumber: `INV-${index}`,
      date: '2026-06-15',
      status: InvoiceStatus.Anulada,
      documentType: '',
      companyId: 'company-001',
      items: [],
      createdAt: '2026-06-15T00:00:00.000Z',
      updatedAt: '2026-06-15T00:00:00.000Z',
      ...invoice,
    }));

    const result = await MHAnnexExportService.exportMHAnexos(
      invoices,
      [],
      'Facturas Simples',
      { download: false },
    );

    const anulados = result.artifacts.find(artifact => artifact.fileName.startsWith('Anulados_'));
    expect(anulados).toBeDefined();

    const rows = anulados!.content.replace(/^\uFEFF/, '').trim().split('\n');
    expect(rows.map(row => row.split(';')[4])).toEqual(['07', '09', '15']);
  });
});
