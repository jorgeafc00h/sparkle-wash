import { API_ENDPOINTS } from '../config/api';
import { InvoiceService } from '../services/api/InvoiceService';
import { getMhClient } from '../services/api/MhClient';
import { getSignerService } from '../services/signing/SignerService';
import { DTE_Base } from '../types/dte';

const mockPost = jest.fn();

jest.mock('../services/api/HttpClient', () => ({
  HttpClient: jest.fn(),
  ApiError: class ApiError extends Error {
    statusCode?: number;
    details?: unknown;

    constructor(message: string, statusCode?: number, details?: unknown) {
      super(message);
      this.statusCode = statusCode;
      this.details = details;
    }
  },
  getHttpClient: jest.fn(() => ({
    post: mockPost,
  })),
}));

jest.mock('../services/api/MhClient', () => ({
  getMhClient: jest.fn(),
}));

jest.mock('../services/signing/SignerService', () => ({
  getSignerService: jest.fn(),
}));

jest.mock('../services/api/SyncLogger', () => ({
  SyncLogger: {
    logSyncRequest: jest.fn(),
    logSyncResponse: jest.fn(),
    logSyncError: jest.fn(),
  },
}));

jest.mock('../services/auth/AuthProviderService', () => ({
  __esModule: true,
  default: {
    getToken: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('../services/sync/CloudSyncService', () => ({
  __esModule: true,
  default: {
    syncInvoice: jest.fn(),
  },
  getTableName: jest.fn(() => 'co06141404941342'),
}));

jest.mock('../services/telemetry/TelemetryService', () => ({
  TelemetryService: {
    trackDependency: jest.fn(),
    trackEvent: jest.fn(),
    trackException: jest.fn(),
  },
}));

jest.mock('../utils/logger', () => ({
  logger: {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

function makeEventPayload(tipoEvento: '17' | '18'): DTE_Base {
  return {
    identificacion: {
      version: 1,
      ambiente: '00',
      tipoModelo: 1,
      tipoOperacion: 1,
      tipoEvento,
      codigoGeneracion: `${tipoEvento}${tipoEvento}${tipoEvento}${tipoEvento}${tipoEvento}${tipoEvento}${tipoEvento}${tipoEvento}-1111-4111-8111-111111111111`,
      fecEmi: '2026-06-10',
      horEmi: '10:00:00',
      tipoMoneda: 'USD',
    },
    emisor: {
      nit: '06141404941342',
      nombre: 'Jorge Flores',
    },
    cuerpoDocumento: [],
    resumen: {},
    apendice: null,
  } as unknown as DTE_Base;
}

const credentials = {
  user: '06141404941342',
  credential: 'mh-password',
  key: 'cert-password',
  invoiceNumber: 'DTE-18-M001P001-000000000000123',
};

describe('InvoiceService event routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPost.mockResolvedValue({ estado: 'PROCESADO' });
    (getSignerService as jest.Mock).mockReturnValue({
      signAsync: jest.fn().mockResolvedValue({ status: 'OK', body: 'signed-event-jws' }),
    });
    (getMhClient as jest.Mock).mockReturnValue({
      submitDTE: jest.fn().mockResolvedValue({
        version: 1,
        ambiente: '00',
        versionApp: 1,
        estado: 'PROCESADO',
        codigoGeneracion: 'AAAAAAAA-1111-4111-8111-AAAAAAAAAAAA',
        selloRecibido: 'SELLO-EVENTO',
        fhProcesamiento: '2026-06-10 10:00:00',
        clasificaMsg: 'ACEPTADO',
        codigoMsg: 'EVENT_ACCEPTED',
        descripcionMsg: 'Evento recibido',
        observaciones: [],
      }),
      submitEvent: jest.fn().mockResolvedValue({
        version: 1,
        ambiente: '00',
        versionApp: 1,
        estado: 'PROCESADO',
        codigoGeneracion: 'AAAAAAAA-1111-4111-8111-AAAAAAAAAAAA',
        selloRecibido: 'SELLO-EVENTO',
        fhProcesamiento: '2026-06-10 10:00:00',
        clasificaMsg: 'ACEPTADO',
        codigoMsg: 'EVENT_ACCEPTED',
        descripcionMsg: 'Evento recibido',
        observaciones: [],
      }),
    });
  });

  it.each([
    ['17', API_ENDPOINTS.DOCUMENT_DTE_OPERACIONES_ESPECIALES_SYNC],
    ['18', API_ENDPOINTS.DOCUMENT_DTE_RETORNO_SYNC],
  ] as const)('posts tipoEvento %s payloads to the event-specific API route', async (tipoEvento, endpoint) => {
    const service = new InvoiceService(false);

    await service.Sync(makeEventPayload(tipoEvento), credentials);

    expect(mockPost).toHaveBeenCalledWith(
      endpoint,
      expect.objectContaining({
        identificacion: expect.objectContaining({ tipoEvento }),
      }),
      expect.any(Object),
    );
    expect(mockPost.mock.calls[0][1].identificacion.tipoDte).toBeUndefined();
  });

  it('submits local event payloads to MH using tipoEvento as the envelope type', async () => {
    const service = new InvoiceService(false);
    const mhClient = getMhClient(false);

    await service.SyncLocal(makeEventPayload('18'), credentials);

    expect(mhClient.submitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tipoEvento: '18',
        version: 1,
        documento: 'signed-event-jws',
      }),
      expect.any(Object),
    );
    expect(mhClient.submitDTE).not.toHaveBeenCalled();
  });
});
