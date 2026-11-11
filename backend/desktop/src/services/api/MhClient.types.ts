// Types for direct government API communication
// Mirrors the .NET MHClient.Service types

export interface MhAuthResponse {
  status: string;
  body: {
    token: string;
    /** Token extracted from response - includes "Bearer " prefix in some cases */
    roles: string[];
    /** Set when status is ERROR (e.g. a rejected user/password). */
    codigoMsg?: string;
    descripcionMsg?: string;
  };
}

export interface MhCredentials {
  /** NIT of the company (used as username) */
  userName: string;
  /** Government API password (plain text) */
  password: string;
}

export interface DTESubmitParams {
  /** Environment code: "00" (test) or "01" (production) */
  ambiente: string;
  /** Send ID — must be a positive integer per MH schema. Stringified
   *  versions are silently rejected as a generic Spring 400 Bad Request
   *  with no descripcionMsg; pass a `number`, not a `string`. */
  idEnvio: number;
  /** DTE version */
  version: number;
  /** Document or event type code: "01", "03", "05", "06", "04", "08", "11", "14", "17", "18" */
  tipoDte: string;
  /** Must be null — the codigoGeneracion is inside the signed DTE documento */
  codigoGeneracion: null;
  /** JWS RS512 signed DTE document */
  documento: string;
}

export interface DTEEventSubmitParams {
  /** Environment code: "00" (test) or "01" (production) */
  ambiente: string;
  /** Send ID — must be a positive integer per MH schema. */
  idEnvio: number;
  /** Event schema version */
  version: number;
  /** CAT-002 event type code: "17" or "18" */
  tipoEvento: string;
  /** Event generation code */
  codigoGeneracion: string;
  /** JWS RS512 signed event document */
  documento: string;
}

export interface DTEInvalidateParams {
  /** Environment code */
  ambiente: string;
  /** Send ID — numeric, same constraints as DTESubmitParams.idEnvio */
  idEnvio: number;
  /** DTE version */
  version: number;
  /** Document type: always "invalidacion" type */
  tipoDte: string;
  /** JWS RS512 signed invalidation document */
  documento: string;
}

export interface DTESearchParams {
  /** NIT del emisor (without dashes) */
  nitEmisor: string;
  /** Tipo de DTE (e.g. "01", "03", "14") */
  tdte: string;
  /** Codigo de generacion of the DTE to search */
  codigoGeneracion: string;
}

export interface DTEResponse {
  version: number;
  ambiente: string;
  versionApp: number;
  estado: string;
  codigoGeneracion: string;
  selloRecibido: string | null;
  fhProcesamiento: string;
  fechaTransmision?: string;
  horaTransmision?: string;
  clasificaMsg: string;
  codigoMsg: string;
  descripcionMsg: string;
  observaciones: string[];
}

export interface MhApiConfig {
  /** Base URL for the government API */
  baseUrl: string;
  /** Whether this is production environment */
  isProduction: boolean;
}
