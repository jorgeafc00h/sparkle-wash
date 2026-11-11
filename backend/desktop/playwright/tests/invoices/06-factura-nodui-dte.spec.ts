import { test, expect } from '@playwright/test';
import { TEST_COMPANY } from '../../fixtures/seed-state';

test.describe('Factura without DUI — DTE mapping', () => {
  test('DTE 01 sends nullable receptor tipoDocumento and numDocumento when customer has no DUI', async ({ page }) => {
    await page.goto('/');

    const dte = await page.evaluate(async (company) => {
      const { InvoiceGenerationService } = await import('/src/services/invoiceGeneration/InvoiceGenerationService.ts');
      const now = new Date().toISOString();
      const customer = {
        id: 'cust-no-dui',
        firstName: 'Consumidor',
        lastName: 'Sin DUI',
        nationalId: '',
        nit: '',
        documentType: 'DUI',
        email: 'cliente@example.com',
        phone: '70000000',
        address: 'San Salvador',
        departmentCode: '06',
        municipalityCode: '14',
        hasContributorRetention: false,
        customerType: 0,
        isActive: true,
        companyId: company.id,
        createdAt: now,
        updatedAt: now,
      };
      const invoice = {
        id: 'inv-no-dui',
        invoiceNumber: 'FND001',
        date: now,
        status: 0,
        customerId: customer.id,
        customer,
        invoiceType: 0,
        documentType: '01',
        companyId: company.id,
        items: [{
          id: 'line-no-dui',
          invoiceId: 'inv-no-dui',
          productId: 'prod-service',
          productName: 'Servicio de diagnostico',
          obsItem: '',
          quantity: 1,
          unitPrice: 100,
          total: 100,
          createdAt: now,
          updatedAt: now,
        }],
        totals: {
          totalAmount: 100,
          subTotal: 100,
          tax: 11.5,
          totalWithoutTax: 88.5,
          totalPagar: 100,
          isCCF: false,
          totalItems: 1,
          version: 2,
        },
        createdAt: now,
        updatedAt: now,
      };

      return InvoiceGenerationService.buildDTEPayload(invoice, company, '00', {
        explicitSequence: 123,
      });
    }, TEST_COMPANY);

    expect(dte.identificacion.tipoDte).toBe('01');
    expect(dte.receptor.tipoDocumento).toBeNull();
    expect(dte.receptor.numDocumento).toBeNull();
    expect(dte.receptor.nit).toBeUndefined();
  });
});
