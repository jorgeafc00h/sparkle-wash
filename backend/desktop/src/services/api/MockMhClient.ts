// MockMhClient — in-memory mock for government API (MhClient interface)
// Used in E2E tests via seed-mock-api=true launch arg.
// Scenarios let tests exercise error paths without a real gov API.
//
// NEVER import this module in production code paths — only activated via uiTestSeeder.

import {
  MhCredentials,
  DTESubmitParams,
  DTEEventSubmitParams,
  DTEInvalidateParams,
  DTEResponse,
  MhApiConfig,
} from './MhClient.types';

export type MockScenario =
  | 'success'          // All calls succeed (default)
  | 'auth-failure'     // authenticate() throws 401 error
  | 'dte-rejected'     // submitDTE() returns estado: 'RECHAZADO' with observaciones
  | 'timeout'          // Requests hang for 95 s (simulates timeout)
  | 'duplicate-control'// submitDTE() returns codigoMsg: 'ALREADY_EXISTS'
  | 'server-error';    // submitDTE() returns 500-class error

let currentScenario: MockScenario = 'success';

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const makeSello = () =>
  Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

const makeCodigoGeneracion = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16).toUpperCase();
  });

const makeFhProcesamiento = () => new Date().toISOString().replace('T', ' ').substring(0, 19);

export class MockMhClient {
  private config: MhApiConfig;

  constructor(isProduction = false) {
    this.config = {
      baseUrl: isProduction ? 'https://api.dtes.mh.gob.sv' : 'https://apitest.dtes.mh.gob.sv',
      isProduction,
    };
  }

  static setScenario(scenario: MockScenario): void {
    currentScenario = scenario;
    console.log(`[MockMhClient] Scenario set to: ${scenario}`);
  }

  static getScenario(): MockScenario {
    return currentScenario;
  }

  static reset(): void {
    currentScenario = 'success';
  }

  async authenticate(_credentials: MhCredentials): Promise<string> {
    await delay(200);

    if (currentScenario === 'auth-failure') {
      const err = new Error('Error al autenticar usuario, verifique sus credenciales de hacienda');
      (err as Error & { status: number }).status = 401;
      throw err;
    }

    if (currentScenario === 'timeout') {
      await delay(95_000);
    }

    return `mock-token-${Date.now()}`;
  }

  async validateCredentials(_credentials: MhCredentials): Promise<{ valid: boolean; statusCode?: number }> {
    await delay(100);
    if (currentScenario === 'auth-failure') return { valid: false, statusCode: 401 };
    return { valid: true, statusCode: 200 };
  }

  async getToken(_credentials: MhCredentials, _forceRefresh = false): Promise<string> {
    if (currentScenario === 'auth-failure') {
      return this.authenticate(_credentials);
    }
    return `mock-cached-token-${Date.now()}`;
  }

  async submitDTE(params: DTESubmitParams, _credentials: MhCredentials): Promise<DTEResponse> {
    await delay(300);

    if (currentScenario === 'timeout') {
      await delay(95_000);
    }

    if (currentScenario === 'server-error') {
      const err = new Error('Internal Server Error');
      (err as Error & { status: number }).status = 500;
      throw err;
    }

    if (currentScenario === 'auth-failure') {
      const err = new Error('Error al autenticar usuario, verifique sus credenciales de hacienda');
      (err as Error & { status: number }).status = 401;
      throw err;
    }

    if (currentScenario === 'dte-rejected') {
      return {
        version: params.version,
        ambiente: params.ambiente,
        versionApp: 1,
        estado: 'RECHAZADO',
        codigoGeneracion: params.documento.substring(0, 36),
        selloRecibido: null,
        fhProcesamiento: makeFhProcesamiento(),
        clasificaMsg: 'ERROR',
        codigoMsg: 'DTE_REJECTED',
        descripcionMsg: 'El documento no cumple con las validaciones requeridas',
        observaciones: [
          'El número de control ya fue utilizado',
          'Verifique la integridad del documento',
        ],
      };
    }

    if (currentScenario === 'duplicate-control') {
      return {
        version: params.version,
        ambiente: params.ambiente,
        versionApp: 1,
        estado: 'RECHAZADO',
        codigoGeneracion: '',
        selloRecibido: null,
        fhProcesamiento: makeFhProcesamiento(),
        clasificaMsg: 'ERROR',
        codigoMsg: 'ALREADY_EXISTS',
        descripcionMsg: 'YA EXISTE UN REGISTRO CON ESE VALOR',
        observaciones: ['El número de control ya existe en el sistema'],
      };
    }

    // Default: success
    return {
      version: params.version,
      ambiente: params.ambiente,
      versionApp: 1,
      estado: 'PROCESADO',
      codigoGeneracion: makeCodigoGeneracion(),
      selloRecibido: makeSello(),
      fhProcesamiento: makeFhProcesamiento(),
      clasificaMsg: 'ACEPTADO',
      codigoMsg: 'DTE_ACCEPTED',
      descripcionMsg: 'DTE recibido y procesado correctamente',
      observaciones: [],
    };
  }

  async submitEvent(params: DTEEventSubmitParams, credentials: MhCredentials): Promise<DTEResponse> {
    const response = await this.submitDTE(
      {
        ambiente: params.ambiente,
        idEnvio: params.idEnvio,
        version: params.version,
        tipoDte: params.tipoEvento,
        codigoGeneracion: null,
        documento: params.documento,
      },
      credentials,
    );

    return {
      ...response,
      codigoMsg: response.codigoMsg === 'DTE_ACCEPTED' ? 'EVENT_ACCEPTED' : response.codigoMsg,
      descripcionMsg: response.descripcionMsg === 'DTE recibido y procesado correctamente'
        ? 'Evento recibido y procesado correctamente'
        : response.descripcionMsg,
    };
  }

  async invalidateDTE(params: DTEInvalidateParams, _credentials: MhCredentials): Promise<DTEResponse> {
    await delay(200);

    if (currentScenario === 'auth-failure' || currentScenario === 'server-error') {
      throw new Error('Mock invalidation error');
    }

    return {
      version: params.version,
      ambiente: params.ambiente,
      versionApp: 1,
      estado: 'PROCESADO',
      codigoGeneracion: makeCodigoGeneracion(),
      selloRecibido: makeSello(),
      fhProcesamiento: makeFhProcesamiento(),
      clasificaMsg: 'ACEPTADO',
      codigoMsg: 'ANULATION_ACCEPTED',
      descripcionMsg: 'Anulación procesada correctamente',
      observaciones: [],
    };
  }

  async submitContingency(params: DTESubmitParams, _credentials: MhCredentials): Promise<DTEResponse> {
    await delay(200);

    if (currentScenario === 'timeout') {
      await delay(95_000);
    }

    if (currentScenario === 'server-error') {
      const err = new Error('Internal Server Error');
      (err as Error & { status: number }).status = 500;
      throw err;
    }

    if (currentScenario === 'auth-failure') {
      const err = new Error('Error al autenticar usuario, verifique sus credenciales de hacienda');
      (err as Error & { status: number }).status = 401;
      throw err;
    }

    if (currentScenario === 'dte-rejected') {
      return {
        version: params.version,
        ambiente: params.ambiente,
        versionApp: 1,
        estado: 'RECHAZADO',
        codigoGeneracion: '',
        selloRecibido: null,
        fhProcesamiento: makeFhProcesamiento(),
        clasificaMsg: 'ERROR',
        codigoMsg: 'CONTINGENCY_REJECTED',
        descripcionMsg: 'La solicitud de contingencia no cumple con las validaciones requeridas',
        observaciones: ['Verifique el evento de contingencia y los documentos relacionados'],
      };
    }

    return {
      version: params.version,
      ambiente: params.ambiente,
      versionApp: 1,
      estado: 'PROCESADO',
      codigoGeneracion: makeCodigoGeneracion(),
      selloRecibido: makeSello(),
      fhProcesamiento: makeFhProcesamiento(),
      clasificaMsg: 'ACEPTADO',
      codigoMsg: 'CONTINGENCY_ACCEPTED',
      descripcionMsg: 'Contingencia recibida y procesada correctamente',
      observaciones: [],
    };
  }

  async searchDTE(_params: { codigoGeneracion: string }, _credentials: MhCredentials): Promise<unknown> {
    await delay(150);
    return { estado: 'PROCESADO', encontrado: true };
  }

  getConfig(): MhApiConfig {
    return { ...this.config };
  }

  updateEnvironment(_isProduction: boolean): void {
    this.config.isProduction = _isProduction;
  }
}
