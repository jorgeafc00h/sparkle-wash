import { API_CONFIG, API_ENDPOINTS, getApiConfig, getDTEEndpoint } from '../config/api';

const PROD_ACA_API_BASE =
  'https://k-invoices-api-prod.orangesand-e6d7151a.southcentralus.azurecontainerapps.io/api';

describe('Normativa 2 API endpoint routing', () => {
  it('keeps Desktop development API traffic on the deployed ACA API while MH ambiente stays test', () => {
    expect(getApiConfig(false).baseUrl).toBe(PROD_ACA_API_BASE);
    expect(getApiConfig(false).environmentCode).toBe('00');
    expect(API_CONFIG.governmentApi.test).toBe('https://apitest.dtes.mh.gob.sv');
  });

  it('routes standard DTE types through the latest v2 sync endpoint', () => {
    for (const tipoDte of ['01', '03', '04', '05', '06', '07', '08', '09', '11', '14', '15']) {
      expect(getDTEEndpoint(tipoDte)).toBe('/document/dte/v2/sync');
    }
  });

  it('routes new event types through their dedicated endpoints', () => {
    expect(getDTEEndpoint('17')).toBe(API_ENDPOINTS.DOCUMENT_DTE_OPERACIONES_ESPECIALES_SYNC);
    expect(getDTEEndpoint('18')).toBe(API_ENDPOINTS.DOCUMENT_DTE_RETORNO_SYNC);
    expect(getDTEEndpoint(undefined, '17')).toBe(API_ENDPOINTS.DOCUMENT_DTE_OPERACIONES_ESPECIALES_SYNC);
    expect(getDTEEndpoint(undefined, '18')).toBe(API_ENDPOINTS.DOCUMENT_DTE_RETORNO_SYNC);
    expect(getDTEEndpoint('01', '18')).toBe(API_ENDPOINTS.DOCUMENT_DTE_RETORNO_SYNC);
  });

  it('uses latest backend endpoints for invalidation and contingency reports', () => {
    expect(API_ENDPOINTS.DOCUMENT_DTE_INVALIDATE).toBe('/document/dte/invalidate/v3');
    expect(API_ENDPOINTS.DOCUMENT_CONTINGENCY).toBe('/document/contingencia/report');
  });
});
