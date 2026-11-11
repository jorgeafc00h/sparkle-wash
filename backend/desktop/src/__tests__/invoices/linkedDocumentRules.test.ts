import { eligibleParents, REQUIRED_PARENT_MESSAGE } from '@/services/invoices/linkedDocumentRules';
import { InvoiceStatus, InvoiceType } from '@/types/invoice';

const docs = [
  { id: 'fe', invoiceType: InvoiceType.Factura, status: InvoiceStatus.Completada },
  { id: 'ccf', invoiceType: InvoiceType.CCF, status: InvoiceStatus.Completada },
  { id: 'ccf-mod', invoiceType: InvoiceType.CCF, status: InvoiceStatus.Modificada },
  { id: 'ccf-anul', invoiceType: InvoiceType.CCF, status: InvoiceStatus.Anulada },
  { id: 'ccf-draft', invoiceType: InvoiceType.CCF, status: InvoiceStatus.Nueva },
  { id: 'fse', invoiceType: InvoiceType.SujetoExcluido, status: InvoiceStatus.Completada },
];

it('an NC or ND can only correct an accepted CCF (Completada or Modificada)', () => {
  expect(eligibleParents(docs, InvoiceType.NotaCredito).map((d) => d.id)).toEqual(['ccf', 'ccf-mod']);
  expect(eligibleParents(docs, InvoiceType.NotaDebito).map((d) => d.id)).toEqual(['ccf', 'ccf-mod']);
  expect(REQUIRED_PARENT_MESSAGE[InvoiceType.NotaCredito]).toMatch(/CCF/);
});

it('an NR or CL relates to a CCF or Factura; other types keep every accepted document', () => {
  expect(eligibleParents(docs, InvoiceType.NotaRemision).map((d) => d.id)).toEqual(['fe', 'ccf', 'ccf-mod']);
  expect(eligibleParents(docs, InvoiceType.ComprobanteLiquidacion).map((d) => d.id)).toEqual(['fe', 'ccf', 'ccf-mod']);
  expect(eligibleParents(docs, InvoiceType.ComprobanteRetencion).map((d) => d.id)).toEqual(['fe', 'ccf', 'ccf-mod', 'fse']);
});
